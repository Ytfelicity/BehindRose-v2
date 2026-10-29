using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using BehindRose.Core;
using YamlDotNet.RepresentationModel;

namespace BehindRose.Windows;

public interface IClaudeBackupProtector
{
    byte[] Protect(byte[] plaintext);
    byte[] Unprotect(byte[] ciphertext);
}

public sealed class ClaudeConfigurationPlan
{
    public ClaudeConfigurationPreview Preview { get; }
    [JsonIgnore] internal byte[]? Before { get; }
    [JsonIgnore] internal byte[]? After { get; }
    [JsonIgnore] internal string Binding { get; }
    [JsonIgnore] internal string? RestoreId { get; }
    [JsonIgnore] internal DateTimeOffset Expires { get; } = DateTimeOffset.UtcNow.AddMinutes(10);
    internal ClaudeConfigurationPlan(ClaudeConfigurationPreview preview, byte[]? before, byte[]? after, string binding, string? restoreId = null)
    { Preview = preview; Before = before?.ToArray(); After = after?.ToArray(); Binding = binding; RestoreId = restoreId; }
}

/// <summary>Offline, ordinary-user settings management. Never runs Claude, Clash, a shell, or a network request.</summary>
public sealed class ClaudeConfigurationService
{
    private readonly string settingsDirectory, settingsFile, backupDirectory, clashDirectory, binding;
    private readonly IClaudeBackupProtector protector;
    private readonly Func<string, string?> externalEnvironment;
    private readonly Func<IEnumerable<string>> externalEnvironmentNames;
    private readonly object gate = new();
    private const int MaximumBackupBytes = 4 * 1024 * 1024;
    private sealed record BackupRecord(int Version, string Id, DateTimeOffset CreatedAt, string Mode, string State,
        string Binding, byte[]? Before, byte[]? After);

    public ClaudeConfigurationService(string? settingsDirectory = null, string? backupDirectory = null, string? clashDirectory = null,
        IClaudeBackupProtector? protector = null, Func<string, string?>? externalEnvironment = null, Func<IEnumerable<string>>? externalEnvironmentNames = null)
    {
        this.settingsDirectory = LocalDirectory(settingsDirectory ?? DefaultSettingsDirectory());
        settingsFile = Path.Combine(this.settingsDirectory, "settings.json");
        this.backupDirectory = LocalDirectory(backupDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BehindRose", "ClaudeConfiguration", "backups"));
        if (this.backupDirectory.Equals(this.settingsDirectory, StringComparison.OrdinalIgnoreCase)
            || this.backupDirectory.StartsWith(this.settingsDirectory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("加密备份目录必须位于 Claude 配置目录之外。");
        this.clashDirectory = LocalDirectory(clashDirectory ?? WindowsState.ConfigRoot);
        this.protector = protector ?? new ClaudeConfigurationDpapiProtector();
        this.externalEnvironment = externalEnvironment ?? ReadExternalEnvironment;
        this.externalEnvironmentNames = externalEnvironmentNames ?? (externalEnvironment is null ? ReadExternalNames : () => []);
        binding = Fingerprints.Bytes(Encoding.UTF8.GetBytes(settingsFile.ToUpperInvariant()));
    }

    public static ClaudeConfigurationService CreateDemo()
    {
        string root = LocalDirectory(Path.Combine(Path.GetTempPath(), "BehindRose-Claude-Demo-" + Guid.NewGuid().ToString("N")));
        string settings = Path.Combine(root, "settings"), clash = Path.Combine(root, "clash");
        Directory.CreateDirectory(settings); Directory.CreateDirectory(clash);
        File.WriteAllText(Path.Combine(settings, "settings.json"), """
            {"env":{"ANTHROPIC_BASE_URL":"https://gateway.example.invalid","ANTHROPIC_AUTH_TOKEN":"demo-claude-token-never-export","ANTHROPIC_DEFAULT_HAIKU_MODEL":"demo-deepseek"},"permissions":{"allow":[]}}
            """, new UTF8Encoding(false));
        File.WriteAllText(Path.Combine(clash, "config.yaml"), "mixed-port: 7897\n", new UTF8Encoding(false));
        return new(settings, Path.Combine(root, "backups"), clash, new DemoProtector(), _ => null);
    }

    // Demo backups use an ephemeral key, isolated from Windows credentials and the real profile.
    private sealed class DemoProtector : IClaudeBackupProtector
    {
        private readonly byte[] key = RandomNumberGenerator.GetBytes(32);
        public byte[] Protect(byte[] plaintext)
        {
            byte[] result = new byte[28 + plaintext.Length]; RandomNumberGenerator.Fill(result.AsSpan(0, 12));
            using var aes = new AesGcm(key, 16); aes.Encrypt(result.AsSpan(0, 12), plaintext, result.AsSpan(28), result.AsSpan(12, 16));
            return result;
        }
        public byte[] Unprotect(byte[] ciphertext)
        {
            if (ciphertext.Length < 28) throw new CryptographicException("演示备份无效。");
            byte[] plaintext = new byte[ciphertext.Length - 28];
            using var aes = new AesGcm(key, 16); aes.Decrypt(ciphertext.AsSpan(0, 12), ciphertext.AsSpan(28), ciphertext.AsSpan(12, 16), plaintext);
            return plaintext;
        }
    }

    public ClaudeConfigurationStatus Inspect()
    {
        var warnings = new List<string>();
        string[] external = ExternalConflicts();
        int[] ports = ReadClashPorts(warnings);
        bool settingsFound = false;
        try
        {
            byte[]? before = ReadSettings();
            settingsFound = before is not null;
            var root = ClaudeConfigurationPlanner.Parse(before);
            string? baseUrl = ClaudeConfigurationPlanner.ReadEnvironment(root, "ANTHROPIC_BASE_URL");
            string route = "默认接入（登录与账号状态未检查）";
            if (!string.IsNullOrWhiteSpace(baseUrl))
            {
                route = "自定义网关";
                if (Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
                    route = uri.IsLoopback ? "本机网关" : uri.Scheme == "https" && uri.Host == "api.anthropic.com" ? "官方 API 地址" : "自定义网关";
            }
            else if (ClaudeConfigurationPlanner.ProviderVariables.Where(key => key.StartsWith("CLAUDE_CODE_USE_", StringComparison.Ordinal)).Any(key => !string.IsNullOrWhiteSpace(ClaudeConfigurationPlanner.ReadEnvironment(root, key)))) route = "云服务接入";
            else if (new[] { "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN" }.Any(key => !string.IsNullOrWhiteSpace(ClaudeConfigurationPlanner.ReadEnvironment(root, key)))) route = "自定义认证（值不展示）";
            var env = root["env"] as System.Text.Json.Nodes.JsonObject;
            string[] models = (env?.Select(item => item.Key).Where(ClaudeConfigurationPlanner.IsModelVariable) ?? []).Concat(root.ContainsKey("model") ? ["model"] : []).Order(StringComparer.Ordinal).ToArray();
            int? http = ClaudeConfigurationPlanner.LocalHttpPort(ClaudeConfigurationPlanner.ReadEnvironment(root, "HTTP_PROXY"));
            int? https = ClaudeConfigurationPlanner.LocalHttpPort(ClaudeConfigurationPlanner.ReadEnvironment(root, "HTTPS_PROXY"));
            int? configured = http == https ? http : null;
            if (http != https) warnings.Add("HTTP_PROXY 与 HTTPS_PROXY 不一致，可在预览中统一。");
            if (external.Length != 0) warnings.Add("进程、用户或计算机环境中存在相关变量。本工具只显示变量名称，不修改系统环境。");
            warnings.Add("仅读取本机文件；端口未探测，网络、登录、订阅与模型可用性均未验证。");
            return new(before is not null, true, route, configured, ports, external, models, warnings.ToArray());
        }
        catch (Exception error) when (IsConfigurationError(error))
        {
            warnings.Add("Claude 配置无法安全读取或格式不受支持，请先自行检查 settings.json；本次不会覆盖它。");
            return new(settingsFound, false, "配置无法读取", null, ports, external, [], warnings.ToArray());
        }
    }

    public ClaudeConfigurationPlan Preview(string mode, int proxyPort)
    {
        byte[]? before = ReadSettingsSafe();
        string[] external = ExternalConflicts();
        EnsureOfficialEnvironment(mode, external);
        var draft = ClaudeConfigurationPlanner.Build(before, mode, proxyPort, external);
        return Plan(mode, proxyPort, "apply", before, draft.After, draft.Changes, draft.Warnings);
    }

    public ClaudeConfigurationResult Apply(ClaudeConfigurationPlan plan)
    {
        if (plan.Preview.Action != "apply") throw new InvalidDataException("这不是配置应用方案。");
        return Execute(plan);
    }

    public IReadOnlyList<ClaudeConfigurationBackup> ListBackups()
    {
        lock (gate)
        {
            _ = LocalDirectory(backupDirectory);
            if (!Directory.Exists(backupDirectory)) return [];
            var summaries = new List<ClaudeConfigurationBackup>();
            foreach (string path in Directory.GetFiles(backupDirectory, "*.dat").Take(501))
            {
                string id = Path.GetFileNameWithoutExtension(path);
                if (!Guid.TryParseExact(id, "N", out _)) continue;
                try
                {
                    var record = ReadBackup(id);
                    summaries.Add(new(id, record.CreatedAt, record.Mode, record.State is "applied" or "prepared" or "rollback-failed", record.State));
                }
                catch (Exception error) when (IsConfigurationError(error))
                { summaries.Add(new(id, null, "unknown", false, "unreadable")); }
            }
            return summaries.OrderByDescending(item => item.CreatedAt).ToArray();
        }
    }

    public ClaudeConfigurationPlan PreviewRestore(string backupId)
    {
        var backup = ReadBackupSafe(backupId);
        if (backup.State is not ("applied" or "prepared" or "rollback-failed")) throw new InvalidOperationException("这份配置备份当前不能恢复。");
        byte[]? before = ReadSettingsSafe();
        if (!Equal(before, backup.After) && !Equal(before, backup.Before)) throw Conflict();
        return Plan(backup.Mode, 0, "restore", before, backup.Before,
            Equal(before, backup.Before) ? [] : [new("Claude 用户配置", "当前配置（内容不展示）", backup.Before is null ? "恢复为配置文件尚不存在的状态" : "恢复本次备份中的配置")],
            ["仅恢复本工具修改的 settings.json；不操作会话凭据、Clash、系统环境或网络。"], backupId);
    }

    public ClaudeConfigurationResult Restore(ClaudeConfigurationPlan plan)
    {
        if (plan.Preview.Action != "restore") throw new InvalidDataException("这不是配置恢复方案。");
        return Execute(plan);
    }

    private ClaudeConfigurationPlan Plan(string mode, int proxyPort, string action, byte[]? before, byte[]? after,
        ClaudeConfigurationChange[] changes, string[] warnings, string? restoreId = null)
    {
        string fingerprint = Fingerprint(mode, proxyPort, action, before, after, restoreId);
        return new(new(mode, proxyPort, action, fingerprint, !Equal(before, after), changes, warnings), before, after, binding, restoreId);
    }

    private ClaudeConfigurationResult Execute(ClaudeConfigurationPlan plan)
    {
        lock (gate)
        {
            if (plan.Binding != binding || plan.Expires < DateTimeOffset.UtcNow || plan.Preview.Fingerprint != Fingerprint(plan.Preview.Mode, plan.Preview.ProxyPort, plan.Preview.Action, plan.Before, plan.After, plan.RestoreId))
                throw new InvalidOperationException("配置方案已失效，请重新预览。");
            if (plan.Preview.Action == "apply") EnsureOfficialEnvironment(plan.Preview.Mode, ExternalConflicts());
            if (plan.RestoreId is not null)
            {
                var source = ReadBackupSafe(plan.RestoreId);
                if (source.State is not ("applied" or "prepared" or "rollback-failed") || !Equal(source.Before, plan.After))
                    throw new InvalidOperationException("恢复记录已变化，请重新预览。");
            }
            if (!Equal(ReadSettingsSafe(), plan.Before)) throw Conflict();
            if (Equal(plan.Before, plan.After) && plan.RestoreId is null) return new(true, "unchanged", "配置已符合所选目标，无需写入或创建备份。");
            EnsureDirectory(backupDirectory);
            using var operationLock = AcquireOperationLock();
            if (!Equal(ReadSettingsSafe(), plan.Before)) throw Conflict();
            var prior = ListBackups();
            if (prior.Any(item => item.State == "unreadable" || item.Id != plan.RestoreId && item.State is "prepared" or "rollback-failed"))
                throw new InvalidOperationException("有未完成或无法读取的 Claude 配置备份，请先处理恢复记录再应用其他配置。");
            if (Equal(plan.Before, plan.After) && plan.RestoreId is not null)
            {
                var source = ReadBackupSafe(plan.RestoreId); SaveBackup(source with { State = "restored" });
                return new(true, "restored", "配置已与备份原状态一致；已完成该恢复记录，无需修改配置文件。", plan.RestoreId);
            }
            if (plan.Preview.Action == "apply" && Directory.GetFiles(backupDirectory, "*.dat").Length >= 500) throw new InvalidOperationException("配置备份已达 500 份，请先整理备份后再应用；现有记录仍可恢复。");
            var backup = new BackupRecord(1, Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow,
                plan.Preview.Action == "restore" ? "restore" : plan.Preview.Mode, "prepared", binding, plan.Before, plan.After);
            SaveBackup(backup);
            var verified = ReadBackup(backup.Id);
            if (!Equal(verified.Before, plan.Before) || !Equal(verified.After, plan.After)) throw new IOException("加密备份核验失败，未修改 Claude 配置。");
            if (!Equal(ReadSettingsSafe(), plan.Before)) throw Conflict();
            try
            {
                EnsureDirectory(settingsDirectory);
                if (!Equal(ReadSettingsSafe(), plan.Before)) throw Conflict();
                WriteSettings(plan.After);
                if (!Equal(ReadSettingsSafe(), plan.After)) throw new IOException("写入核验失败。");
                SaveBackup(backup with { State = "applied" });
                if (plan.RestoreId is not null)
                {
                    try { var restored = ReadBackup(plan.RestoreId); SaveBackup(restored with { State = "restored" }); }
                    catch (Exception error) when (IsConfigurationError(error))
                    { return new(true, "restored", "配置已恢复，但原记录的恢复标记未保存。当前恢复操作也有独立加密备份。", backup.Id); }
                }
                return new(true, plan.RestoreId is null ? "applied" : "restored",
                    plan.RestoreId is null ? "Claude 用户配置已保存并核对。新开的 Claude Code 会话使用这些设置；未执行网络测试。" : "Claude 用户配置已恢复；未操作运行中的程序或网络。", backup.Id);
            }
            catch (Exception error) when (IsConfigurationError(error))
            {
                bool rolledBack = false;
                try
                {
                    byte[]? current = ReadSettingsSafe();
                    if (Equal(current, plan.Before)) rolledBack = true;
                    else if (Equal(current, plan.After)) { WriteSettings(plan.Before); rolledBack = Equal(ReadSettingsSafe(), plan.Before); }
                    SaveBackup(backup with { State = rolledBack ? "rolled-back" : "rollback-failed" });
                }
                catch (Exception rollbackError) when (IsConfigurationError(rollbackError)) { }
                return new(false, rolledBack ? "rolled-back" : "rollback-failed",
                    rolledBack ? "配置保存未完成，已保留或恢复原配置；加密备份已保存。" : "配置保存未完成，发现无法自动恢复的状态。已保留加密备份，请先查看恢复记录。", backup.Id);
            }
        }
    }

    private byte[]? ReadSettings()
    {
        return LocalFileExists(settingsFile) ? SafeFiles.Read(settingsFile, ClaudeConfigurationPlanner.MaximumSettingsBytes) : null;
    }
    private byte[]? ReadSettingsSafe()
    {
        try { return ReadSettings(); }
        catch (Exception error) when (IsConfigurationError(error)) { throw new IOException("无法安全读取 Claude 配置，请检查文件访问权限或重定向目录。"); }
    }
    private void WriteSettings(byte[]? bytes)
    {
        bool exists = LocalFileExists(settingsFile);
        if (bytes is null) { if (exists) SafeFiles.Delete(settingsFile); }
        else SafeFiles.AtomicWrite(settingsFile, bytes, ClaudeConfigurationPlanner.MaximumSettingsBytes);
    }
    private void SaveBackup(BackupRecord record)
    {
        byte[] plaintext = JsonSerializer.SerializeToUtf8Bytes(record);
        try
        {
            string path = BackupPath(record.Id); _ = LocalFileExists(path);
            SafeFiles.AtomicWrite(path, protector.Protect(plaintext), MaximumBackupBytes);
        }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }
    private BackupRecord ReadBackup(string id)
    {
        string path = BackupPath(id);
        if (!LocalFileExists(path)) throw new IOException("未找到配置备份。");
        byte[] plaintext = protector.Unprotect(SafeFiles.Read(path, MaximumBackupBytes));
        try
        {
            var record = JsonSerializer.Deserialize<BackupRecord>(plaintext, new JsonSerializerOptions { MaxDepth = 16 });
            if (record is null || record.Version != 1 || record.Id != id || record.Binding != binding
                || record.Mode is not ("preserve" or "official" or "restore")
                || record.State is not ("prepared" or "applied" or "restored" or "rolled-back" or "rollback-failed")
                || record.Before?.Length > ClaudeConfigurationPlanner.MaximumSettingsBytes || record.After?.Length > ClaudeConfigurationPlanner.MaximumSettingsBytes)
                throw new InvalidDataException("配置备份无效。");
            if (record.Before is not null) _ = ClaudeConfigurationPlanner.Parse(record.Before);
            if (record.After is not null) _ = ClaudeConfigurationPlanner.Parse(record.After);
            return record;
        }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }
    private BackupRecord ReadBackupSafe(string id)
    {
        try { return ReadBackup(id); }
        catch (Exception error) when (IsConfigurationError(error)) { throw new IOException("无法读取这份加密配置备份。备份仅能由创建它的 Windows 用户在本机解密。"); }
    }
    private string BackupPath(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new InvalidDataException("配置备份编号无效。");
        return Path.Combine(backupDirectory, id + ".dat");
    }
    private string Fingerprint(string mode, int port, string action, byte[]? before, byte[]? after, string? restoreId) =>
        Fingerprints.Bytes(JsonSerializer.SerializeToUtf8Bytes(new { binding, mode, port, action, before, after, restoreId }));
    private string[] ExternalConflicts() => ClaudeConfigurationPlanner.ProviderVariables.Concat(ClaudeConfigurationPlanner.ModelVariables)
        .Concat(ClaudeConfigurationPlanner.ProxyVariables).Concat(externalEnvironmentNames().Where(ClaudeConfigurationPlanner.IsProviderOrModelVariable))
        .Where(name => !string.IsNullOrWhiteSpace(externalEnvironment(name))).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.Ordinal).ToArray();
    private static void EnsureOfficialEnvironment(string mode, string[] external)
    {
        if (mode == "official" && external.Any(ClaudeConfigurationPlanner.IsProviderOrModelVariable))
            throw new InvalidOperationException("进程、用户或计算机环境中仍有接入或模型覆盖变量。请先自行处理检查结果中的变量，再预览官方模式；本工具不会清除系统环境。");
    }
    private int[] ReadClashPorts(List<string> warnings)
    {
        var ports = new HashSet<int>();
        foreach (string name in new[] { "config.yaml", "clash-verge.yaml", "clash.yaml" })
        {
            string path = Path.Combine(clashDirectory, name);
            try
            {
                if (!LocalFileExists(path)) continue;
                var root = RepairPlanner.Parse(SafeFiles.Read(path), "Clash 本机端口配置");
                void Add(YamlMappingNode map, string key)
                {
                    if (RepairPlanner.Get(map, key) is YamlScalarNode scalar && int.TryParse(scalar.Value, out int port) && port is >= 1 and <= 65535) ports.Add(port);
                }
                Add(root, "mixed-port"); Add(root, "port");
                if (RepairPlanner.Get(root, "listeners") is YamlSequenceNode listeners)
                    foreach (var map in listeners.Children.OfType<YamlMappingNode>())
                        if ((RepairPlanner.Get(map, "type") as YamlScalarNode)?.Value is "http" or "mixed") Add(map, "port");
            }
            catch (Exception error) when (IsConfigurationError(error) || error is YamlDotNet.Core.YamlException)
            { warnings.Add("部分 Clash 文件无法读取，本机端口可手动填写。"); }
        }
        return ports.Order().ToArray();
    }
    private static string DefaultSettingsDirectory()
    {
        string? custom = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
        return string.IsNullOrWhiteSpace(custom) ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".claude") : custom;
    }
    private static string? ReadExternalEnvironment(string name)
    {
        foreach (var target in new[] { EnvironmentVariableTarget.Process, EnvironmentVariableTarget.User, EnvironmentVariableTarget.Machine })
        {
            try { if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(name, target))) return "present"; }
            catch (System.Security.SecurityException) { return "unreadable"; }
        }
        return null;
    }
    private static IEnumerable<string> ReadExternalNames()
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var target in new[] { EnvironmentVariableTarget.Process, EnvironmentVariableTarget.User, EnvironmentVariableTarget.Machine })
        {
            try
            {
                foreach (string name in Environment.GetEnvironmentVariables(target).Keys.OfType<string>())
                    if (ClaudeConfigurationPlanner.IsProviderOrModelVariable(name)) names.Add(name);
            }
            catch (System.Security.SecurityException) { throw new IOException("无法读取环境变量名称，暂不能确认接入覆盖情况。"); }
        }
        return names;
    }
    private static string LocalDirectory(string path)
    {
        string full = Path.GetFullPath(path);
        if (full.Length < 3 || full[1] != ':' || full[2] != Path.DirectorySeparatorChar || full[3..].Contains(':'))
            throw new InvalidDataException("配置与备份仅支持本机普通目录。");
        if (new DriveInfo(Path.GetPathRoot(full)!).DriveType is DriveType.Network or DriveType.Unknown or DriveType.NoRootDirectory)
            throw new InvalidDataException("配置与备份不能位于网络映射驱动器或无法确认的驱动器；请选择本机目录。");
        // Walk from the local root outward. Checking a leaf with File.Exists first
        // could traverse an ancestor junction into an SMB location before rejection.
        string current = Path.GetPathRoot(full)!;
        foreach (string part in Path.GetRelativePath(current, full).Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            if (part == ".") continue;
            current = Path.Combine(current, part);
            FileAttributes attributes;
            try { attributes = File.GetAttributes(current); }
            catch (FileNotFoundException) { break; }
            catch (DirectoryNotFoundException) { break; }
            if ((attributes & FileAttributes.ReparsePoint) != 0 || (attributes & FileAttributes.Directory) == 0)
                throw new IOException("配置与备份不支持链接、重定向或非普通目录。");
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
        if ((attributes & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0) throw new IOException("配置与备份不支持链接或重定向文件。");
        return true;
    }
    private static void EnsureDirectory(string path) { _ = LocalDirectory(path); Directory.CreateDirectory(path); _ = LocalDirectory(path); }
    private IDisposable AcquireOperationLock()
    {
        // A named mutex has no lock-file path that could be replaced by a hard link.
        var mutex = new Mutex(false, "Local\\BehindRose-Claude-" + Fingerprints.Bytes(Encoding.UTF8.GetBytes(backupDirectory.ToUpperInvariant())));
        bool acquired;
        try { acquired = mutex.WaitOne(0); }
        catch (AbandonedMutexException) { acquired = true; }
        if (!acquired) { mutex.Dispose(); throw new InvalidOperationException("另一个窗口正在保存 Claude 配置，请稍后重试。"); }
        return new MutexLease(mutex);
    }
    private sealed class MutexLease(Mutex mutex) : IDisposable
    {
        public void Dispose() { mutex.ReleaseMutex(); mutex.Dispose(); }
    }
    private static bool Equal(byte[]? left, byte[]? right) => left is null ? right is null : right is not null && left.AsSpan().SequenceEqual(right);
    private static InvalidOperationException Conflict() => new("预览后 Claude 配置发生变化，或备份后的配置已被其他程序修改。为保留这些改动，本次操作已停止，请重新检查。");
    private static bool IsConfigurationError(Exception error) => error is IOException or InvalidDataException or UnauthorizedAccessException
        or System.Security.SecurityException or JsonException or CryptographicException or FormatException or ArgumentException;
}
