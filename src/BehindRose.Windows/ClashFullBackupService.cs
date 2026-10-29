using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BehindRose.Core;
using YamlDotNet.RepresentationModel;

namespace BehindRose.Windows;

public sealed record ClashFullBackupSummary(string Id, DateTimeOffset? CreatedAt, string Reason, int FileCount, long TotalBytes,
    bool Complete, bool CanRestore, string State, string? Error = null);
public sealed record ClashFullRestorePreview(string BackupId, DateTimeOffset? CreatedAt, int FileCount, long TotalBytes,
    int WriteCount, int RemoveCount, bool Complete, bool ClashRunning);
public sealed class ClashFullRestorePlan
{
    public ClashFullRestorePreview Preview { get; }
    internal string Expected { get; }
    internal string BackupHash { get; }
    internal string Binding { get; }
    internal DateTimeOffset Expires { get; } = DateTimeOffset.UtcNow.AddMinutes(10);
    internal ClashFullRestorePlan(ClashFullRestorePreview preview, string expected, string backupHash, string binding)
    { Preview = preview; Expected = expected; BackupHash = backupHash; Binding = binding; }
}

// Only fixed, local per-user directories are exposed by the application API.
// All backup metadata and file contents are authenticated and encrypted together.
public sealed class ClashFullBackupService
{
    public const int MaximumArchiveBytes = 128 * 1024 * 1024;
    public const int MaximumFileBytes = 128 * 1024 * 1024;
    public const long MaximumSnapshotBytes = 512L * 1024 * 1024;
    private const int MaximumFiles = 8192;
    private const string ManifestEntry = "behindrose-manifest.json";
    private readonly string configDirectory, backupDirectory, binding;
    private readonly IClashBackupProtector protector;
    private readonly Func<bool> running;
    private readonly Dictionary<string, (long Size, DateTime Time, ClashFullBackupSummary Summary)> cache = [];
    private sealed record Manifest(int Version, string Id, DateTimeOffset CreatedAt, string Reason, string Binding, bool Complete, FileEntry[] Files);
    private sealed record FileEntry(string Name, int Length, string Sha256);
    private sealed record Snapshot(SortedDictionary<string, byte[]> Files, string Fingerprint, long TotalBytes, bool Complete);
    private sealed record Pending(string RecoveryId);
    internal Action<int>? BeforeRestoreWrite { get; set; }

    public ClashFullBackupService(string? configDirectory = null, string? backupDirectory = null,
        IClashBackupProtector? protector = null, Func<bool>? clashRunning = null)
    {
        this.configDirectory = LocalDirectory(configDirectory ?? WindowsState.ConfigRoot);
        this.backupDirectory = LocalDirectory(backupDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BehindRose", "ClashBackups"));
        if (Within(this.configDirectory, this.backupDirectory) || Within(this.backupDirectory, this.configDirectory)) throw new InvalidDataException("完整备份目录必须与 Clash 配置目录分开。");
        this.protector = protector ?? new ClashBackupDpapiProtector();
        running = clashRunning ?? HostDiscovery.IsRunning;
        binding = Fingerprints.Bytes(Encoding.UTF8.GetBytes(WindowsState.UserSid + "\n" + this.configDirectory.ToUpperInvariant()));
    }

    public static ClashFullBackupService CreateDemo()
    {
        string root = Path.Combine(Path.GetTempPath(), "BehindRose-ClashDemo-" + Guid.NewGuid().ToString("N"));
        string config = Path.Combine(root, "config"); Directory.CreateDirectory(Path.Combine(config, "profiles"));
        File.WriteAllText(Path.Combine(config, "config.yaml"), "tun: {enable: false, stack: mixed}\n");
        File.WriteAllText(Path.Combine(config, "verge.yaml"), "enable_tun_mode: false\n");
        File.WriteAllText(Path.Combine(config, "profiles.yaml"), "current: example\nitems: [{uid: example, type: local, file: example.yaml}]\n");
        File.WriteAllText(Path.Combine(config, "profiles", "example.yaml"), "proxies: []\nrules: [MATCH,DIRECT]\n");
        return new(config, Path.Combine(root, "backups"), new DemoProtector(), () => false);
    }
    private sealed class DemoProtector : IClashBackupProtector
    {
        private readonly byte[] key = RandomNumberGenerator.GetBytes(32);
        public byte[] Protect(byte[] plaintext)
        {
            byte[] data = new byte[28 + plaintext.Length]; RandomNumberGenerator.Fill(data.AsSpan(0, 12));
            using var aes = new AesGcm(key, 16); aes.Encrypt(data.AsSpan(0, 12), plaintext, data.AsSpan(28), data.AsSpan(12, 16)); return data;
        }
        public byte[] Unprotect(byte[] ciphertext)
        {
            if (ciphertext.Length < 28) throw new CryptographicException();
            byte[] data = new byte[ciphertext.Length - 28]; using var aes = new AesGcm(key, 16);
            aes.Decrypt(ciphertext.AsSpan(0, 12), ciphertext.AsSpan(28), ciphertext.AsSpan(12, 16), data); return data;
        }
    }

    public ClashFullBackupSummary Create()
    {
        using var lease = AcquireLock(); EnsureNoPending();
        var snapshot = CaptureStable();
        if (!snapshot.Complete) throw new InvalidOperationException("当前配置不完整，未将它保存为完整备份；已有备份仍可用于恢复。");
        return Save(snapshot, "manual");
    }

    // Hold this lock through the ordinary repair transaction, so full restore in
    // another window cannot interleave with a privileged configuration repair.
    public IDisposable ProtectRepair(bool requireComplete = true)
    {
        var lease = AcquireLock();
        try
        {
            EnsureNoPending(); EnsureStopped(); var snapshot = CaptureStable();
            if (requireComplete && !snapshot.Complete) throw new InvalidOperationException("请先导入完整订阅，或从完整备份恢复，再执行一键配置。");
            _ = Save(snapshot, "before-repair"); return lease;
        }
        catch { lease.Dispose(); throw; }
    }

    public IReadOnlyList<ClashFullBackupSummary> List()
    {
        LocalDirectory(backupDirectory);
        if (!Directory.Exists(backupDirectory)) return [];
        using var lease = SafeFiles.LockParents(Path.Combine(backupDirectory, "inventory"));
        string? recovery = ReadPending()?.RecoveryId;
        var result = new List<ClashFullBackupSummary>();
        foreach (string file in Directory.GetFiles(backupDirectory, "*.brclash").Order(StringComparer.Ordinal))
        {
            string id = Path.GetFileNameWithoutExtension(file);
            try
            {
                var info = new FileInfo(file); SafeFiles.CheckPath(file);
                ClashFullBackupSummary summary;
                if (cache.TryGetValue(id, out var saved) && saved.Size == info.Length && saved.Time == info.LastWriteTimeUtc) summary = saved.Summary;
                else
                {
                    var (manifest, _) = ReadBackup(id);
                    summary = Summary(manifest); cache[id] = (info.Length, info.LastWriteTimeUtc, summary);
                }
                result.Add(summary with { CanRestore = recovery is null || recovery == id, State = recovery == id ? "recovery-required" : "available" });
            }
            catch (Exception error) when (IsBackupError(error))
            { result.Add(new(id, null, "unknown", 0, 0, false, false, "unreadable", "无法解密或校验这份本机备份。请保留文件，并使用创建备份的 Windows 用户。")); }
        }
        return result.OrderByDescending(x => x.State == "recovery-required").ThenByDescending(x => x.CreatedAt).ToArray();
    }

    public ClashFullRestorePlan PreviewRestore(string id)
    {
        using var lease = AcquireLock(); EnsureNoPending(id);
        byte[] encrypted = SafeFiles.Read(BackupPath(id), MaximumArchiveBytes + 16384);
        var (manifest, target) = ReadBackup(id, encrypted);
        var current = CaptureStable();
        int writes = target.Files.Count(x => !current.Files.TryGetValue(x.Key, out var old) || !old.AsSpan().SequenceEqual(x.Value));
        int removes = current.Files.Keys.Count(x => !target.Files.ContainsKey(x));
        return new(new(id, manifest.CreatedAt, target.Files.Count, target.TotalBytes, writes, removes, manifest.Complete, running()), current.Fingerprint, Fingerprints.Bytes(encrypted), binding);
    }

    public OperationResult Restore(ClashFullRestorePlan plan, Action<string>? progress = null)
    {
        using var lease = AcquireLock(); EnsureStopped(); EnsureNoPending(plan.Preview.BackupId);
        if (plan.Binding != binding || plan.Expires < DateTimeOffset.UtcNow) throw new InvalidOperationException("完整恢复预览已失效，请重新预览。");
        byte[] encrypted = SafeFiles.Read(BackupPath(plan.Preview.BackupId), MaximumArchiveBytes + 16384);
        if (Fingerprints.Bytes(encrypted) != plan.BackupHash) throw new InvalidOperationException("预览后的备份文件发生变化，请重新检查。");
        var (_, target) = ReadBackup(plan.Preview.BackupId, encrypted); var current = CaptureStable();
        if (current.Fingerprint != plan.Expected) throw Conflict();
        if (current.Fingerprint == target.Fingerprint) return new(true, "unchanged", "本机配置已与完整备份一致。", plan.Preview.BackupId);
        void Report(string message) { try { progress?.Invoke(message); } catch { } }
        Report("正在加密保存恢复前的完整状态……");
        var safety = Save(current, "before-restore");
        if (CaptureStable().Fingerprint != current.Fingerprint) throw Conflict();
        var previous = ReadPending(); var transaction = previous ?? new Pending(safety.Id);
        SafeFiles.AtomicWrite(PendingPath, JsonSerializer.SerializeToUtf8Bytes(transaction));
        var touched = new List<string>(); int index = 0;
        try
        {
            EnsureDirectory(configDirectory);
            using var directoryLease = SafeFiles.LockParents(Path.Combine(configDirectory, "restore-anchor"));
            foreach (string name in target.Files.Keys.Concat(current.Files.Keys).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.Ordinal))
            {
                current.Files.TryGetValue(name, out var before); target.Files.TryGetValue(name, out var after);
                if (Equal(before, after)) continue;
                EnsureStopped(); BeforeRestoreWrite?.Invoke(++index);
                if (!Equal(ReadConfigFile(name), before)) throw Conflict();
                touched.Add(name); WriteConfigFile(name, after);
                if (!Equal(ReadConfigFile(name), after)) throw new IOException("配置写入核验失败。");
                Report($"正在恢复配置文件：{index} 项已处理……");
            }
            if (CaptureStable().Fingerprint != target.Fingerprint) throw new IOException("完整恢复后的文件清单未通过核验。");
            SafeFiles.Delete(PendingPath);
            return new(true, "restored", "完整配置已恢复，订阅、节点、脚本及分流均已从本机备份还原。请重新打开 Clash。", safety.Id);
        }
        catch (Exception error) when (IsBackupError(error) || error is InvalidOperationException)
        {
            bool rolledBack = true;
            foreach (string name in touched.AsEnumerable().Reverse())
            {
                try
                {
                    EnsureStopped(); current.Files.TryGetValue(name, out var before); target.Files.TryGetValue(name, out var after);
                    var live = ReadConfigFile(name);
                    if (!Equal(live, before) && !Equal(live, after)) throw Conflict();
                    if (!Equal(live, before)) WriteConfigFile(name, before);
                    if (!Equal(ReadConfigFile(name), before)) throw new IOException();
                }
                catch { rolledBack = false; }
            }
            if (rolledBack && previous is null) SafeFiles.Delete(PendingPath);
            return new(false, rolledBack ? "rolled-back" : "rollback-failed", rolledBack
                ? "恢复未完成，已撤销本次修改。请退出 Clash 并重新预览；恢复前快照已保留。"
                : "恢复中断，部分文件需要恢复。请保留本机备份，并在完整备份列表恢复标记为“需要恢复”的记录。", transaction.RecoveryId);
        }
    }

    private ClashFullBackupSummary Save(Snapshot snapshot, string reason)
    {
        string id = Guid.NewGuid().ToString("N");
        var manifest = new Manifest(1, id, DateTimeOffset.UtcNow, reason, binding, snapshot.Complete,
            snapshot.Files.Select(x => new FileEntry(x.Key, x.Value.Length, Fingerprints.Bytes(x.Value))).ToArray());
        using var output = new MemoryStream();
        using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
        {
            using (var metadata = zip.CreateEntry(ManifestEntry).Open()) metadata.Write(JsonSerializer.SerializeToUtf8Bytes(manifest));
            foreach (var (name, bytes) in snapshot.Files)
            { using var entry = zip.CreateEntry("config/" + name, CompressionLevel.Fastest).Open(); entry.Write(bytes); }
        }
        if (output.Length > MaximumArchiveBytes) throw new InvalidDataException("完整备份压缩后超过 128 MiB，未保存备份或修改配置。");
        byte[] plaintext = output.ToArray();
        try
        {
            byte[] encrypted = protector.Protect(plaintext); EnsureDirectory(backupDirectory);
            string path = BackupPath(id); SafeFiles.AtomicWrite(path, encrypted, MaximumArchiveBytes + 16384);
            var (verified, _) = ReadBackup(id);
            return Summary(verified);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
            if (output.TryGetBuffer(out var buffer)) CryptographicOperations.ZeroMemory(buffer.AsSpan());
        }
    }

    private (Manifest, Snapshot) ReadBackup(string id, byte[]? encrypted = null)
    {
        byte[] plaintext = protector.Unprotect(encrypted ?? SafeFiles.Read(BackupPath(id), MaximumArchiveBytes + 16384));
        try
        {
            if (plaintext.Length > MaximumArchiveBytes) throw new InvalidDataException("完整备份过大。");
            using var input = new MemoryStream(plaintext); using var zip = new ZipArchive(input, ZipArchiveMode.Read);
            if (zip.Entries.Count > MaximumFiles + 1) throw new InvalidDataException("完整备份文件数超过上限。");
            var metadata = zip.GetEntry(ManifestEntry) ?? throw new InvalidDataException("缺少完整备份清单。");
            if (metadata.Length > 4 * 1024 * 1024) throw new InvalidDataException("完整备份清单过大。");
            using var stream = metadata.Open();
            var manifest = JsonSerializer.Deserialize<Manifest>(stream, new JsonSerializerOptions { MaxDepth = 16 }) ?? throw new InvalidDataException("完整备份清单无效。");
            if (manifest.Version != 1 || manifest.Id != id || manifest.Binding != binding || manifest.Files is null || manifest.Files.Length > MaximumFiles
                || manifest.Reason is not ("manual" or "before-repair" or "before-restore") || zip.Entries.Count != manifest.Files.Length + 1)
                throw new InvalidDataException("完整备份清单与本机用户不匹配。");
            var files = new SortedDictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase); long total = 0;
            foreach (var file in manifest.Files)
            {
                ValidateName(file.Name);
                if (file.Length is < 0 or > MaximumFileBytes || (total += file.Length) > MaximumSnapshotBytes || files.ContainsKey(file.Name)) throw new InvalidDataException("完整备份文件清单无效。");
                var entry = zip.GetEntry("config/" + file.Name);
                if (entry is null || entry.Length != file.Length || zip.Entries.Count(x => x.FullName == entry.FullName) != 1) throw new InvalidDataException("完整备份文件不匹配。");
                byte[] bytes = new byte[file.Length]; using var entryStream = entry.Open(); entryStream.ReadExactly(bytes);
                if (entryStream.ReadByte() != -1 || Fingerprints.Bytes(bytes) != file.Sha256) throw new InvalidDataException("完整备份内容校验失败。");
                files.Add(file.Name, bytes);
            }
            var snapshot = MakeSnapshot(files);
            if (snapshot.Complete != manifest.Complete) throw new InvalidDataException("完整备份范围标记无效。");
            return (manifest, snapshot);
        }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }

    private Snapshot CaptureStable()
    {
        var first = Capture(); var second = Capture();
        if (first.Fingerprint != second.Fingerprint) throw new InvalidOperationException("Clash 配置正在变化，请退出客户端后重新备份或预览。");
        return second;
    }
    private Snapshot Capture()
    {
        LocalDirectory(configDirectory); var files = new SortedDictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase); long total = 0;
        if (!Directory.Exists(configDirectory)) return MakeSnapshot(files);
        using var lease = SafeFiles.LockParents(Path.Combine(configDirectory, "snapshot-anchor"));
        void Walk(string directory)
        {
            foreach (string path in Directory.EnumerateFileSystemEntries(directory).Order(StringComparer.Ordinal))
            {
                string name = Path.GetRelativePath(configDirectory, path).Replace('\\', '/');
                if (Excluded(name)) continue;
                ValidateName(name); SafeFiles.CheckPath(path);
                if (Directory.Exists(path)) { Walk(path); continue; }
                var bytes = SafeFiles.Read(path, MaximumFileBytes); total += bytes.Length;
                if (files.Count >= MaximumFiles || total > MaximumSnapshotBytes) throw new InvalidDataException("完整配置超过 8192 个文件或 512 MiB，未保存或修改。");
                if (!files.TryAdd(name, bytes)) throw new InvalidDataException("存在重复的配置路径。");
            }
        }
        Walk(configDirectory); return MakeSnapshot(files);
    }
    private static Snapshot MakeSnapshot(SortedDictionary<string, byte[]> files)
    {
        bool complete = new[] { "config.yaml", "verge.yaml", "profiles.yaml" }.All(files.ContainsKey);
        if (complete)
        {
            try
            {
                foreach (string name in new[] { "config.yaml", "verge.yaml", "profiles.yaml" }) _ = RepairPlanner.Parse(files[name], "备份配置");
                var root = RepairPlanner.Parse(files["profiles.yaml"], "备份订阅登记");
                complete = RepairPlanner.Get(root, "items") is YamlSequenceNode items && items.Children.OfType<YamlMappingNode>()
                    .Where(x => (RepairPlanner.Get(x, "file") as YamlScalarNode)?.Value is { Length: > 0 })
                    .All(x => files.ContainsKey("profiles/" + ((YamlScalarNode)RepairPlanner.Get(x, "file")!).Value));
            }
            catch (InvalidDataException) { complete = false; }
        }
        string fingerprint = Fingerprints.Bytes(JsonSerializer.SerializeToUtf8Bytes(files.Select(x => new FileEntry(x.Key.ToUpperInvariant(), x.Value.Length, Fingerprints.Bytes(x.Value))).ToArray()));
        return new(files, fingerprint, files.Values.Sum(x => (long)x.Length), complete);
    }
    private static ClashFullBackupSummary Summary(Manifest manifest) => new(manifest.Id, manifest.CreatedAt, manifest.Reason, manifest.Files.Length, manifest.Files.Sum(x => (long)x.Length), manifest.Complete, true, "available");
    private static bool Equal(byte[]? a, byte[]? b) => a is null ? b is null : b is not null && a.AsSpan().SequenceEqual(b);
    private static bool Excluded(string name) => new[] { "logs", "clash-verge-rev-backup", "crashpad" }.Contains(name.Split('/')[0], StringComparer.OrdinalIgnoreCase)
        || name.EndsWith(".log", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase);
    private static void ValidateName(string name)
    {
        if (string.IsNullOrEmpty(name) || name.Length > 220 || name.Contains('\\') || name.Split('/').Length > 20 || Excluded(name)
            || name.Split('/').Any(segment => segment.Length == 0 || segment is "." or ".." || segment.EndsWith(' ') || segment.EndsWith('.')
                || segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || System.Text.RegularExpressions.Regex.IsMatch(segment, @"\A(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase)))
            throw new InvalidDataException("完整备份含不安全的文件路径。");
    }
    private byte[]? ReadConfigFile(string name)
    {
        ValidateName(name); string path = Path.Combine(configDirectory, name.Replace('/', Path.DirectorySeparatorChar)); SafeFiles.CheckPath(path);
        if (Directory.Exists(path)) throw new IOException("配置文件路径被目录占用。");
        return File.Exists(path) ? SafeFiles.Read(path, MaximumFileBytes) : null;
    }
    private void WriteConfigFile(string name, byte[]? bytes)
    {
        ValidateName(name); string path = Path.Combine(configDirectory, name.Replace('/', Path.DirectorySeparatorChar));
        if (bytes is null) { if (File.Exists(path)) SafeFiles.Delete(path); return; }
        EnsureDirectory(Path.GetDirectoryName(path)!); SafeFiles.AtomicWrite(path, bytes, MaximumFileBytes);
    }
    private string BackupPath(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new InvalidDataException("完整备份编号无效。");
        return Path.Combine(backupDirectory, id + ".brclash");
    }
    private string PendingPath => Path.Combine(backupDirectory, "pending-restore.json");
    private Pending? ReadPending()
    {
        SafeFiles.CheckPath(PendingPath); if (!File.Exists(PendingPath)) return null;
        var pending = JsonSerializer.Deserialize<Pending>(SafeFiles.Read(PendingPath, 4096));
        if (pending is null || !Guid.TryParseExact(pending.RecoveryId, "N", out _)) throw new InvalidDataException("完整恢复中断记录无效，请保留本机备份。");
        return pending;
    }
    private void EnsureNoPending(string? restoring = null)
    {
        if (ReadPending() is { } pending && pending.RecoveryId != restoring) throw new InvalidOperationException("上次完整恢复中断，请先恢复列表中标记为“需要恢复”的记录。");
    }
    private void EnsureStopped() { if (running()) throw new InvalidOperationException("请先在系统托盘退出 Clash，再恢复或应用配置。"); }
    private IDisposable AcquireLock()
    {
        var mutex = new Mutex(false, "Local\\BehindRose-ClashFull-" + binding);
        bool acquired; try { acquired = mutex.WaitOne(0); } catch (AbandonedMutexException) { acquired = true; }
        if (!acquired) { mutex.Dispose(); throw new InvalidOperationException("另一个窗口正在备份或恢复 Clash，请稍后重试。"); }
        return new MutexLease(mutex);
    }
    private sealed class MutexLease(Mutex mutex) : IDisposable { public void Dispose() { mutex.ReleaseMutex(); mutex.Dispose(); } }
    private static string LocalDirectory(string path)
    {
        string full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        if (full.Length < 3 || full[1] != ':' || full[2] != '\\' || full[3..].Contains(':') || new DriveInfo(Path.GetPathRoot(full)!).DriveType is DriveType.Network or DriveType.Unknown or DriveType.NoRootDirectory)
            throw new InvalidDataException("Clash 完整备份只支持本机普通目录。");
        SafeFiles.CheckPath(full); return full;
    }
    private static void EnsureDirectory(string path)
    {
        LocalDirectory(path); if (Directory.Exists(path)) return;
        string? parent = Path.GetDirectoryName(path); if (parent is null) throw new IOException("本机目录无效。");
        EnsureDirectory(parent); using var lease = SafeFiles.LockParents(path); Directory.CreateDirectory(path); SafeFiles.CheckPath(path);
    }
    private static bool Within(string parent, string child) => child.Equals(parent, StringComparison.OrdinalIgnoreCase) || child.StartsWith(parent + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    private static InvalidOperationException Conflict() => new("预览后本机配置发生变化，已停止恢复。请重新预览，确认要恢复的时间点。");
    private static bool IsBackupError(Exception error) => error is IOException or InvalidDataException or UnauthorizedAccessException or CryptographicException or JsonException or ArgumentException or System.Security.SecurityException;
}
