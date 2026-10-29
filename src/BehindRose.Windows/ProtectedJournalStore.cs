using System.Text.Json;
using BehindRose.Core;

namespace BehindRose.Windows;

public sealed class ProtectedJournalStore : IJournalStore
{
    public string Owner => WindowsState.UserSid;
    public static string BaseRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "BehindRose-NetworkAssistant-v2");
    public string Root => Path.Combine(BaseRoot, Owner);
    public string BackupRoot => Path.Combine(Root, "backups");
    // A journal contains before/after snapshots and an encoded envelope. Its
    // aggregate bound is independent of the much smaller live configuration cap.
    public const int MaxBackupFileBytes = 128 * 1024 * 1024;
    private const string UnreadableRecordsBlock = "存在无法读取的备份，配置修改与恢复已暂停。请保留原文件，先处理异常记录。";
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true, MaxDepth = 32 };
    private sealed record Envelope(string Sha256, string Data);
    public void EnsureDirectories()
    {
        if (!WindowsState.IsAdministrator) throw new UnauthorizedAccessException("需要配置进程创建备份目录。");
        SafeFiles.EnsureProtected(BaseRoot, null, true); SafeFiles.EnsureProtected(Root, Owner, true); SafeFiles.EnsureProtected(BackupRoot, Owner, true);
    }
    public IDisposable AcquireLock()
    {
        EnsureDirectories(); string path = Path.Combine(Root, "operation.lock"); SafeFiles.CheckPath(path);
        return new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
    }
    public void Save(Journal journal)
    {
        JournalValidation.Validate(journal, Owner);
        byte[] data = JsonSerializer.SerializeToUtf8Bytes(journal, Options);
        var envelope = new Envelope(Fingerprints.Bytes(data), Convert.ToBase64String(data));
        byte[] encoded = JsonSerializer.SerializeToUtf8Bytes(envelope, Options);
        // Reserve space for later state updates before accepting a new journal.
        int limit = journal.State == "prepared" ? MaxBackupFileBytes - 4096 : MaxBackupFileBytes;
        if (encoded.Length > limit) throw new InvalidDataException("单份备份超过允许的总大小（128 MiB），已拒绝写入该备份文件。");
        EnsureDirectories();
        SafeFiles.AtomicWrite(Path.Combine(BackupRoot, journal.Id + ".json"), encoded, MaxBackupFileBytes);
    }
    public Journal Load(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new InvalidDataException("备份编号无效。");
        SafeFiles.EnsureProtected(BaseRoot, null, false); SafeFiles.EnsureProtected(Root, Owner, false); SafeFiles.EnsureProtected(BackupRoot, Owner, false);
        var envelope = JsonSerializer.Deserialize<Envelope>(SafeFiles.Read(Path.Combine(BackupRoot, id + ".json"), MaxBackupFileBytes), Options) ?? throw new InvalidDataException("备份为空。");
        byte[] bytes = Convert.FromBase64String(envelope.Data);
        if (Fingerprints.Bytes(bytes) != envelope.Sha256) throw new InvalidDataException("备份完整性校验失败。");
        var journal = JsonSerializer.Deserialize<Journal>(bytes, Options) ?? throw new InvalidDataException("备份为空。");
        if (journal.Id != id) throw new InvalidDataException("备份编号不匹配。");
        JournalValidation.Validate(journal, Owner); return journal;
    }
    public IReadOnlyList<Journal> List()
    {
        var (records, unreadable) = ReadRecords();
        if (unreadable.Count != 0) throw new InvalidDataException(UnreadableRecordsBlock);
        return records;
    }
    public IReadOnlyList<BackupSummary> ListForDisplay()
    {
        var (records, unreadable) = ReadRecords();
        return records.Select(record => {
            var summary = BackupSummary.FromJournal(record);
            return unreadable.Count != 0 && summary.CanRestore
                ? summary with { CanRestore = false, RestoreBlockedReason = UnreadableRecordsBlock } : summary;
        }).Concat(unreadable).ToArray();
    }
    private (IReadOnlyList<Journal> Records, IReadOnlyList<BackupSummary> Unreadable) ReadRecords()
    {
        SafeFiles.CheckPath(BackupRoot);
        if (!Directory.Exists(BackupRoot)) return ([], []);
        SafeFiles.EnsureProtected(BaseRoot, null, false); SafeFiles.EnsureProtected(Root, Owner, false); SafeFiles.EnsureProtected(BackupRoot, Owner, false);
        var records = new List<Journal>(); var unreadable = new List<BackupSummary>();
        foreach (string file in Directory.GetFiles(BackupRoot, "*.json"))
        {
            string id = Path.GetFileNameWithoutExtension(file);
            try { records.Add(Load(id)); }
            catch (Exception ex) when (ex is InvalidDataException or IOException or UnauthorizedAccessException or JsonException or FormatException or ArgumentException or System.Security.SecurityException)
            {
                unreadable.Add(new(id, null, "unknown", "unreadable", [], false,
                    $"文件 {Path.GetFileName(file)} 损坏、过大或无法读取，不能恢复；请保留原文件供排查。"));
            }
        }
        return (records.OrderByDescending(record => record.CreatedAt).ToArray(), unreadable);
    }
    public void Report(string operationId, WorkerReport report)
    {
        if (!Guid.TryParseExact(operationId, "N", out _)) throw new InvalidDataException("操作编号无效。");
        SafeFiles.AtomicWrite(Path.Combine(Root, operationId + ".status.json"), JsonSerializer.SerializeToUtf8Bytes(report, Options));
    }
    public WorkerReport? ReadReport(string operationId)
    {
        if (!Guid.TryParseExact(operationId, "N", out _)) return null;
        var path = Path.Combine(Root, operationId + ".status.json");
        if (!File.Exists(path)) return null;
        SafeFiles.EnsureProtected(Root, Owner, false);
        return JsonSerializer.Deserialize<WorkerReport>(SafeFiles.Read(path), Options);
    }
}
public sealed record WorkerReport(string Phase, string Message, OperationResult? Result = null);

public static class Worker
{
    // No caller-supplied paths, registry keys, scripts, or executable names are accepted.
    public static int Run(string[] args)
    {
        if (args.Length != 7 || args[0] != "--worker" || args[1] is not ("apply" or "restore") || args[2] != WindowsState.UserSid || !WindowsState.IsAdministrator
            || !Guid.TryParseExact(args[3], "N", out _) || !int.TryParse(args[4], out int session) || session != ProcessSession()) return 90;
        var journals = new ProtectedJournalStore();
        try
        {
            using var operationLock = journals.AcquireLock();
            var state = new WindowsState(); var engine = new RepairEngine(state, journals);
            void Report(string text) => journals.Report(args[3], new("running", text));
            OperationResult result;
            if (args[1] == "apply")
            {
                if (!int.TryParse(args[5], out int flags)) return 90;
                var plan = RepairPlanner.Build(state, (RepairOptions)flags);
                if (plan.Fingerprint != args[6]) throw new InvalidOperationException("授权期间配置已变化，请重新生成修复建议。");
                if (plan.NeedsClashExit)
                {
                    var host = HostDiscovery.Find();
                    if (!host.Compatible) throw new InvalidOperationException(host.Note);
                }
                foreach (var change in plan.Changes) WindowsState.EnsurePolicyUnmanaged(change.Key);
                state.EnsureReady(plan.NeedsClashExit);
                using var fullBackup = plan.NeedsClashExit ? new ClashFullBackupService().ProtectRepair() : null;
                result = engine.Apply(plan, Report);
            }
            else
            {
                if (args[6] != "restore") return 90;
                using var fullBackup = journals.Load(args[5]).Changes.Any(x => Targets.IsFile(x.Key))
                    ? new ClashFullBackupService().ProtectRepair(false) : null;
                result = engine.Restore(args[5], Report);
            }
            journals.Report(args[3], new("complete", result.Message, result)); return result.Success ? 0 : 1;
        }
        catch (Exception ex)
        {
            try { journals.Report(args[3], new("failed", ex.Message, new(false, "failed", ex.Message))); } catch { }
            return 2;
        }
    }
    private static int ProcessSession() { using var own = System.Diagnostics.Process.GetCurrentProcess(); return own.SessionId; }
}
