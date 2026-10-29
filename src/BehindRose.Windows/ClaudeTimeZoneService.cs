using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using BehindRose.Core;

namespace BehindRose.Windows;

public sealed class ClaudeTimeZonePlan
{
    public ClaudeTimeZonePreview Preview { get; }
    [JsonIgnore] internal ClaudeTimeZoneValue Before { get; }
    [JsonIgnore] internal ClaudeTimeZoneValue After { get; }
    [JsonIgnore] internal string Binding { get; }
    [JsonIgnore] internal string? RestoreId { get; }
    [JsonIgnore] internal DateTimeOffset Expires { get; } = DateTimeOffset.UtcNow.AddMinutes(10);
    internal ClaudeTimeZonePlan(ClaudeTimeZonePreview preview, ClaudeTimeZoneValue before, ClaudeTimeZoneValue after, string binding, string? restoreId)
    { Preview = preview; Before = before; After = after; Binding = binding; RestoreId = restoreId; }
}

/// <summary>Optional time-zone action. No automatic execution and no network, proxy or location operations.</summary>
public sealed class ClaudeTimeZoneService
{
    private readonly IClaudeTimeZoneState state;
    private readonly IClaudeBackupProtector protector;
    private readonly string backupDirectory, binding;
    private readonly object gate = new();
    private bool completionUnknown;
    private const int BackupLimit = 64 * 1024;
    private sealed record Backup(int Version, string Id, DateTimeOffset CreatedAt, string State, string Binding,
        ClaudeTimeZoneValue Before, ClaudeTimeZoneValue After);

    public ClaudeTimeZoneService(IClaudeTimeZoneState? state = null, string? backupDirectory = null, IClaudeBackupProtector? protector = null)
    {
        this.state = state ?? new ClaudeTimeZoneWindowsState();
        this.protector = protector ?? new ClaudeConfigurationDpapiProtector();
        this.backupDirectory = LocalDirectory(backupDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BehindRose", "ClaudeTimeZone", "backups"));
        binding = Fingerprints.Bytes(Encoding.UTF8.GetBytes(this.backupDirectory.ToUpperInvariant()));
    }

    public static ClaudeTimeZoneService CreateDemo()
    {
        string root = LocalDirectory(Path.Combine(Path.GetTempPath(), "BehindRose-TimeZone-Demo-" + Guid.NewGuid().ToString("N")));
        return new(new DemoState(), Path.Combine(root, "backups"), new DemoProtector());
    }
    private sealed class DemoState : IClaudeTimeZoneState
    {
        private ClaudeTimeZoneValue value = new("UTC", "(UTC) 协调世界时");
        public ClaudeTimeZoneValue Read() => value;
        public ClaudeTimeZoneValue Resolve(string id, bool daylightSavingDisabled = false) => id switch
        {
            "UTC" => new(id, "(UTC) 协调世界时", daylightSavingDisabled),
            ClaudeTimeZoneGuidance.TaipeiId => new(id, ClaudeTimeZoneGuidance.TaipeiLabel, daylightSavingDisabled),
            _ => throw new InvalidDataException("演示环境不支持该时区。")
        };
        public void Write(ClaudeTimeZoneValue next) => value = Resolve(next.Id, next.DaylightSavingDisabled);
    }
    private sealed class DemoProtector : IClaudeBackupProtector
    {
        private readonly byte[] key = RandomNumberGenerator.GetBytes(32);
        public byte[] Protect(byte[] plaintext)
        {
            byte[] data = new byte[28 + plaintext.Length]; RandomNumberGenerator.Fill(data.AsSpan(0, 12));
            using var aes = new AesGcm(key, 16); aes.Encrypt(data.AsSpan(0, 12), plaintext, data.AsSpan(28), data.AsSpan(12, 16)); return data;
        }
        public byte[] Unprotect(byte[] ciphertext)
        {
            if (ciphertext.Length < 28) throw new CryptographicException("演示时区备份无效。");
            byte[] data = new byte[ciphertext.Length - 28];
            using var aes = new AesGcm(key, 16); aes.Decrypt(ciphertext.AsSpan(0, 12), ciphertext.AsSpan(28), ciphertext.AsSpan(12, 16), data); return data;
        }
    }

    public ClaudeTimeZoneStatus Inspect()
    {
        try
        {
            var current = Read();
            var target = state.Resolve(ClaudeTimeZoneGuidance.TaipeiId, current.DaylightSavingDisabled);
            bool blocked = completionUnknown || ListBackups().Any(item => item.State is "applying" or "completion-unknown" or "unreadable");
            return new(current.Id, current.Label, current.DaylightSavingDisabled, target.Id, target.Label,
                current.Id == target.Id, !blocked, blocked ? [.. ClaudeTimeZoneGuidance.Warnings(), "有未确认完成或无法读取的时区操作，已暂停自动应用与恢复，请先人工核对。"] : ClaudeTimeZoneGuidance.Warnings());
        }
        catch (Exception error) when (Expected(error))
        {
            return new("", "当前时区无法读取", false, ClaudeTimeZoneGuidance.TaipeiId, ClaudeTimeZoneGuidance.TaipeiLabel,
                false, false, [.. ClaudeTimeZoneGuidance.Warnings(), "无法安全读取 Windows 时区，本次不能自动配置。"]);
        }
    }

    public ClaudeTimeZonePlan PreviewTaipei()
    {
        EnsureCompletionKnown();
        var before = Read();
        return Plan("apply", before, state.Resolve(ClaudeTimeZoneGuidance.TaipeiId, before.DaylightSavingDisabled));
    }
    public ClaudeTimeZoneResult Apply(ClaudeTimeZonePlan plan)
    {
        if (plan.Preview.Action != "apply") throw new InvalidDataException("这不是时区应用方案。");
        return Execute(plan);
    }
    public ClaudeTimeZonePlan PreviewRestore(string backupId)
    {
        EnsureCompletionKnown();
        var saved = LoadSafe(backupId);
        if (!CanRestore(saved.State)) throw new InvalidOperationException("这份时区记录当前不需要恢复。");
        var current = Read();
        if (!Same(current, saved.After) && !Same(current, saved.Before)) throw Conflict();
        return Plan("restore", current, state.Resolve(saved.Before.Id, saved.Before.DaylightSavingDisabled), backupId);
    }
    public ClaudeTimeZoneResult Restore(ClaudeTimeZonePlan plan)
    {
        if (plan.Preview.Action != "restore") throw new InvalidDataException("这不是时区恢复方案。");
        return Execute(plan);
    }
    public IReadOnlyList<ClaudeTimeZoneBackup> ListBackups()
    {
        lock (gate)
        {
            _ = LocalDirectory(backupDirectory);
            if (!Directory.Exists(backupDirectory)) return [];
            var result = new List<ClaudeTimeZoneBackup>();
            foreach (string path in Directory.GetFiles(backupDirectory, "*.dat"))
            {
                string id = Path.GetFileNameWithoutExtension(path);
                if (!Guid.TryParseExact(id, "N", out _)) continue;
                try
                {
                    var saved = Load(id);
                    result.Add(new(id, saved.CreatedAt, saved.Before.Id, saved.Before.Label, saved.After.Id, saved.After.Label, CanRestore(saved.State), saved.State));
                }
                catch (Exception error) when (Expected(error)) { result.Add(new(id, null, "", "无法读取", "", "无法读取", false, "unreadable")); }
            }
            return result.OrderByDescending(item => item.CreatedAt).ToArray();
        }
    }

    private ClaudeTimeZonePlan Plan(string action, ClaudeTimeZoneValue before, ClaudeTimeZoneValue after, string? restoreId = null) =>
        new(new(action, before.Id, before.Label, after.Id, after.Label, !Same(before, after), Fingerprint(action, before, after, restoreId),
            ClaudeTimeZoneGuidance.Warnings()), before, after, binding, restoreId);

    private ClaudeTimeZoneResult Execute(ClaudeTimeZonePlan plan)
    {
        lock (gate)
        {
            EnsureCompletionKnown();
            if (plan.Binding != binding || plan.Expires < DateTimeOffset.UtcNow
                || plan.Preview.Fingerprint != Fingerprint(plan.Preview.Action, plan.Before, plan.After, plan.RestoreId))
                throw new InvalidOperationException("时区方案已失效，请重新预览。");
            _ = state.Resolve(plan.After.Id, plan.After.DaylightSavingDisabled);
            if (!Same(Read(), plan.Before)) throw Conflict();
            if (Same(plan.Before, plan.After) && plan.RestoreId is null) return new(true, "unchanged", "当前已是所选时区，无需修改或创建备份。");
            EnsureDirectory();
            using var lease = AcquireLock();
            if (!Same(Read(), plan.Before)) throw Conflict();
            var records = ListBackups();
            if (records.Any(item => item.State is "unreadable" or "applying" or "completion-unknown" || item.Id != plan.RestoreId && item.State is "prepared" or "rollback-failed"))
                throw new InvalidOperationException("发现未完成或无法读取的时区记录，请先处理恢复记录。");
            if (plan.RestoreId is not null)
            {
                var source = LoadSafe(plan.RestoreId);
                if (!CanRestore(source.State) || !Same(source.Before, plan.After)) throw new InvalidOperationException("时区恢复记录已变化，请重新预览。");
                if (Same(plan.Before, plan.After))
                {
                    Save(source with { State = "restored" });
                    return new(true, "restored", "当前时区已与原状态一致，已完成恢复记录。", source.Id);
                }
            }
            else if (records.Count >= 500) throw new InvalidOperationException("时区记录已达 500 份，请先整理记录；现有记录仍可恢复。");
            var backup = new Backup(1, Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow, "prepared", binding, plan.Before, plan.After);
            Save(backup);
            var verified = Load(backup.Id);
            if (verified != backup) throw new IOException("时区加密备份核验失败，未执行修改。");
            if (!Same(Read(), plan.Before)) throw Conflict();
            try
            {
                // Persist intent before starting an external setter. If its completion becomes
                // unknown, even a later backup-write failure leaves a non-restorable state.
                Save(backup with { State = "applying" });
                if (!Same(Read(), plan.Before)) throw Conflict();
                state.Write(plan.After);
                if (!Same(Read(), plan.After)) throw new IOException("时区修改后核验未通过。");
                Save(backup with { State = "applied" });
                if (plan.RestoreId is not null)
                {
                    try { Save(LoadSafe(plan.RestoreId) with { State = "restored" }); }
                    catch (Exception error) when (Expected(error))
                    { return new(true, "restored", "原时区已恢复；原记录标记未保存，本次恢复另有加密备份。", backup.Id); }
                }
                return new(true, plan.RestoreId is null ? "applied" : "restored",
                    plan.RestoreId is null ? "Windows 时区已修改并核对，UTC 系统时钟未作调整。这是可选偏好，没有防封保证。" : "Windows 原时区及原夏令时标记已恢复。", backup.Id);
            }
            catch (ClaudeTimeZoneCompletionUnknownException) { return UnknownCompletion(backup); }
            catch (Exception error) when (Expected(error))
            {
                bool recovered = false;
                try
                {
                    var current = Read();
                    if (Same(current, plan.Before)) recovered = true;
                    else if (Same(current, plan.After)) { state.Write(plan.Before); recovered = Same(Read(), plan.Before); }
                }
                catch (ClaudeTimeZoneCompletionUnknownException) { return UnknownCompletion(backup); }
                catch (Exception recoveryError) when (Expected(recoveryError)) { }
                try { Save(backup with { State = recovered ? "rolled-back" : "rollback-failed" }); }
                catch (Exception recordError) when (Expected(recordError)) { }
                return new(false, recovered ? "rolled-back" : "rollback-failed",
                    recovered ? "时区修改未完成，原时区已保留或恢复。" : "时区修改未完成，已保留加密备份；请先查看恢复记录。", backup.Id);
            }
        }
    }
    private ClaudeTimeZoneValue Read()
    {
        var value = state.Read(); return state.Resolve(value.Id, value.DaylightSavingDisabled);
    }
    private string Fingerprint(string action, ClaudeTimeZoneValue before, ClaudeTimeZoneValue after, string? restoreId) =>
        Fingerprints.Bytes(JsonSerializer.SerializeToUtf8Bytes(new { binding, action, before, after, restoreId }));
    private string BackupPath(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new InvalidDataException("时区备份编号无效。");
        return Path.Combine(backupDirectory, id + ".dat");
    }
    private void Save(Backup backup)
    {
        string path = BackupPath(backup.Id); _ = LocalFileExists(path);
        byte[] plaintext = JsonSerializer.SerializeToUtf8Bytes(backup);
        try { SafeFiles.AtomicWrite(path, protector.Protect(plaintext), BackupLimit); }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }
    private Backup Load(string id)
    {
        string path = BackupPath(id);
        if (!LocalFileExists(path)) throw new IOException("未找到时区记录。");
        byte[] plaintext = protector.Unprotect(SafeFiles.Read(path, BackupLimit));
        try
        {
            var backup = JsonSerializer.Deserialize<Backup>(plaintext, new JsonSerializerOptions { MaxDepth = 8 });
            if (backup is null || backup.Version != 1 || backup.Id != id || backup.Binding != binding || backup.Before is null || backup.After is null
                || backup.State is not ("prepared" or "applying" or "completion-unknown" or "applied" or "restored" or "rolled-back" or "rollback-failed"))
                throw new InvalidDataException("时区记录无效。");
            _ = state.Resolve(backup.Before.Id, backup.Before.DaylightSavingDisabled);
            _ = state.Resolve(backup.After.Id, backup.After.DaylightSavingDisabled);
            return backup;
        }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }
    private Backup LoadSafe(string id)
    {
        try { return Load(id); }
        catch (Exception error) when (Expected(error)) { throw new IOException("时区备份无法读取或其中的时区已不受支持。请保留记录，不能自动恢复。"); }
    }
    private void EnsureDirectory() { _ = LocalDirectory(backupDirectory); Directory.CreateDirectory(backupDirectory); _ = LocalDirectory(backupDirectory); }
    private static string LocalDirectory(string path)
    {
        string full = Path.GetFullPath(path);
        if (full.Length < 3 || full[1] != ':' || full[2] != Path.DirectorySeparatorChar || full[3..].Contains(':')) throw new InvalidDataException("时区备份仅支持本机目录。");
        string root = Path.GetPathRoot(full)!;
        if (new DriveInfo(root).DriveType is DriveType.Network or DriveType.Unknown or DriveType.NoRootDirectory) throw new InvalidDataException("时区备份不支持网络驱动器。");
        string current = root;
        foreach (string part in Path.GetRelativePath(root, full).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            if (part == ".") continue; current = Path.Combine(current, part);
            FileAttributes attributes;
            try { attributes = File.GetAttributes(current); }
            catch (FileNotFoundException) { break; }
            catch (DirectoryNotFoundException) { break; }
            if ((attributes & FileAttributes.ReparsePoint) != 0 || (attributes & FileAttributes.Directory) == 0) throw new IOException("时区备份不支持链接或重定向目录。");
        }
        return Path.TrimEndingDirectorySeparator(full);
    }
    private static bool LocalFileExists(string path)
    {
        _ = LocalDirectory(Path.GetDirectoryName(path)!);
        FileAttributes attributes;
        try { attributes = File.GetAttributes(path); }
        catch (FileNotFoundException) { return false; }
        catch (DirectoryNotFoundException) { return false; }
        if ((attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0) throw new IOException("时区备份不支持链接或重定向文件。");
        return true;
    }
    private static IDisposable AcquireLock()
    {
        // The Windows zone is machine-wide; serialize this feature across app sessions.
        var mutex = new Mutex(false, "Global\\BehindRose-Claude-Optional-TimeZone");
        bool acquired;
        try { acquired = mutex.WaitOne(0); }
        catch (AbandonedMutexException) { acquired = true; }
        if (!acquired) { mutex.Dispose(); throw new InvalidOperationException("另一个窗口正在修改时区，请稍后重试。"); }
        return new MutexLease(mutex);
    }
    private sealed class MutexLease(Mutex mutex) : IDisposable { public void Dispose() { mutex.ReleaseMutex(); mutex.Dispose(); } }
    private ClaudeTimeZoneResult UnknownCompletion(Backup backup)
    {
        completionUnknown = true;
        try { Save(backup with { State = "completion-unknown" }); }
        catch (Exception error) when (Expected(error)) { /* The durable applying record already blocks automatic recovery. */ }
        return new(false, "completion-unknown", "无法确认时区工具是否结束，已保留加密备份并停止自动回滚及后续修改。请先人工核对 Windows 时区和该工具进程；不会继续自动恢复。", backup.Id);
    }
    private void EnsureCompletionKnown()
    {
        if (completionUnknown || ListBackups().Any(item => item.State is "applying" or "completion-unknown"))
            throw new InvalidOperationException("之前的时区工具完成状态不明确，已暂停自动应用与恢复，请先人工核对。");
    }
    private static bool CanRestore(string state) => state is "prepared" or "applied" or "rollback-failed";
    private static bool Same(ClaudeTimeZoneValue a, ClaudeTimeZoneValue b) => a.Id == b.Id && a.DaylightSavingDisabled == b.DaylightSavingDisabled;
    private static InvalidOperationException Conflict() => new("Windows 时区在预览或备份后发生变化。为保留后续设置，本次操作已停止，请重新检查。");
    private static bool Expected(Exception error) => error is IOException or InvalidDataException or UnauthorizedAccessException or System.Security.SecurityException
        or InvalidOperationException or System.ComponentModel.Win32Exception or JsonException or CryptographicException or ArgumentException or TimeZoneNotFoundException or InvalidTimeZoneException;
}
