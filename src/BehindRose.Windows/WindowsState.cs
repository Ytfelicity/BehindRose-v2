using System.Diagnostics;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using BehindRose.Core;
using Microsoft.Win32;
using YamlDotNet.Core;

namespace BehindRose.Windows;

public sealed record PolicyTarget(string Path, string Name);
public sealed class WindowsState : IStateStore
{
    public static string UserSid => WindowsIdentity.GetCurrent().User!.Value;
    public static bool IsAdministrator => new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator);
    public static string ConfigRoot => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "io.github.clash-verge-rev.clash-verge-rev");
    public static readonly Dictionary<string, PolicyTarget> PolicyTargets = new(StringComparer.Ordinal)
    {
        [Targets.ChromeDns] = new(@"SOFTWARE\Policies\Google\Chrome", "DnsOverHttpsMode"),
        [Targets.EdgeDns] = new(@"SOFTWARE\Policies\Microsoft\Edge", "DnsOverHttpsMode"),
        [Targets.FirefoxDns] = new(@"SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS", "Enabled"),
        [Targets.FirefoxLock] = new(@"SOFTWARE\Policies\Mozilla\Firefox\DNSOverHTTPS", "Locked")
    };

    public StoredValue Read(string key)
    {
        Targets.Validate(key);
        if (Targets.IsFile(key))
        {
            string path = Path.Combine(ConfigRoot, key[5..]); SafeFiles.CheckPath(path);
            return File.Exists(path) ? StoredValue.File(SafeFiles.Read(path)) : StoredValue.Missing;
        }
        var target = PolicyTargets[key];
        using var registry = Registry.CurrentUser.OpenSubKey(target.Path);
        if (registry is null || !registry.GetValueNames().Contains(target.Name, StringComparer.OrdinalIgnoreCase)) return StoredValue.Missing;
        var kind = registry.GetValueKind(target.Name);
        object value = registry.GetValue(target.Name, null, RegistryValueOptions.DoNotExpandEnvironmentNames)!;
        byte[] bytes = kind switch
        {
            RegistryValueKind.String or RegistryValueKind.ExpandString => Encoding.UTF8.GetBytes((string)value),
            RegistryValueKind.DWord => BitConverter.GetBytes((int)value),
            RegistryValueKind.QWord => BitConverter.GetBytes((long)value),
            RegistryValueKind.MultiString => JsonSerializer.SerializeToUtf8Bytes((string[])value),
            RegistryValueKind.Binary or RegistryValueKind.None => (byte[])value,
            _ => throw new InvalidDataException("暂不支持这个注册表值类型。")
        };
        return new(true, kind.ToString(), Convert.ToBase64String(bytes));
    }
    public void Write(string key, StoredValue value)
    {
        if (!IsAdministrator) throw new UnauthorizedAccessException("只允许独立配置进程执行修改。");
        Targets.ValidateValue(key, value);
        if (Targets.IsFile(key))
        {
            string path = Path.Combine(ConfigRoot, key[5..]); SafeFiles.CheckPath(path);
            if (value.Exists) SafeFiles.AtomicWrite(path, value.Bytes()); else if (File.Exists(path)) SafeFiles.Delete(path);
            return;
        }
        EnsurePolicyUnmanaged(key);
        var target = PolicyTargets[key];
        if (!value.Exists)
        {
            using var registry = Registry.CurrentUser.OpenSubKey(target.Path, true); registry?.DeleteValue(target.Name, false); return;
        }
        var kind = Enum.Parse<RegistryValueKind>(value.Kind);
        byte[] bytes = value.Bytes();
        object data = kind switch
        {
            RegistryValueKind.String or RegistryValueKind.ExpandString => Encoding.UTF8.GetString(bytes),
            RegistryValueKind.DWord => BitConverter.ToInt32(bytes),
            RegistryValueKind.QWord => BitConverter.ToInt64(bytes),
            RegistryValueKind.MultiString => JsonSerializer.Deserialize<string[]>(bytes)!,
            _ => bytes
        };
        using var writable = Registry.CurrentUser.CreateSubKey(target.Path, true);
        writable.SetValue(target.Name, data, kind);
    }
    public static void EnsurePolicyUnmanaged(string key)
    {
        if (!PolicyTargets.TryGetValue(key, out var target)) return;
        using var machine = Registry.LocalMachine.OpenSubKey(target.Path);
        if (machine?.GetValueNames().Contains(target.Name, StringComparer.OrdinalIgnoreCase) == true)
            throw new InvalidOperationException("发现计算机级浏览器策略，当前用户设置可能不生效。请联系设备管理员处理。");
    }
    public void EnsureReady(bool needsClashExit)
    {
        if (!IsAdministrator) throw new UnauthorizedAccessException("当前操作需要管理员授权。");
        if (!needsClashExit) return;
        EnsureStandardConfigDirectory();
        if (HostDiscovery.IsRunning()) throw new InvalidOperationException("请在系统托盘退出 Clash Verge，再重新应用。程序不会强制关闭应用。");
    }

    public static void EnsureStandardConfigDirectory()
    {
        SafeFiles.CheckPath(ConfigRoot);
        string profiles = Path.Combine(ConfigRoot, "profiles");
        SafeFiles.CheckPath(profiles);
        if (!Directory.Exists(profiles)) throw new InvalidDataException("缺少标准 Clash Verge Rev 配置目录，请先启动客户端并导入配置。");
    }
}

public sealed record HostInfo(string? Executable, string Version, bool Running, bool Compatible, string Note);
public static class HostDiscovery
{
    public static bool IsRunning()
    {
        using var own = Process.GetCurrentProcess();
        foreach (var process in Process.GetProcessesByName("clash-verge"))
            using (process) if (process.SessionId == own.SessionId) return true;
        return false;
    }
    public static HostInfo Find()
    {
        string? exe = null; bool running = false;
        using var own = Process.GetCurrentProcess();
        foreach (var process in Process.GetProcessesByName("clash-verge"))
            using (process) if (process.SessionId == own.SessionId)
            { running = true; try { exe ??= process.MainModule?.FileName; } catch (System.ComponentModel.Win32Exception) { } }
        foreach (var root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs") })
            foreach (var folder in new[] { "Clash Verge", "Clash Verge Rev" })
            {
                var path = Path.Combine(root, folder, "clash-verge.exe");
                if (exe is null && File.Exists(path)) exe = path;
            }
        if (exe is null)
        {
            foreach (var hive in new[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
                foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
                    try
                    {
                        using var baseKey = RegistryKey.OpenBaseKey(hive, view);
                        using var uninstall = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall");
                        foreach (var name in uninstall?.GetSubKeyNames() ?? [])
                        {
                            using var entry = uninstall!.OpenSubKey(name);
                            if (entry?.GetValue("DisplayName") is not string display || !display.StartsWith("Clash Verge", StringComparison.OrdinalIgnoreCase)) continue;
                            if (entry.GetValue("InstallLocation") is string location)
                            {
                                var path = Path.Combine(location, "clash-verge.exe"); if (File.Exists(path)) exe ??= path;
                            }
                        }
                    }
                    catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException or IOException) { }
        }
        if (exe == null) return new(null, "未识别", running, false, "未找到客户端。便携版可先启动 Clash，再刷新本地体检。");
        SafeFiles.CheckPath(exe);
        var info = FileVersionInfo.GetVersionInfo(exe);
        var version = $"{info.FileMajorPart}.{info.FileMinorPart}.{info.FileBuildPart}";
        return AssessConfiguration(exe, version, running, new WindowsState(), WindowsState.EnsureStandardConfigDirectory);
    }

    internal static HostInfo AssessConfiguration(string executable, string version, bool running, IStateStore state, Action checkDirectory)
    {
        try
        {
            checkDirectory();
            RepairPlanner.ValidateClashConfiguration(state);
            return new(executable, version, running, true, "当前配置目录与 TUN 字段结构可识别，可以生成配置预览。");
        }
        catch (InvalidDataException ex) { return new(executable, version, running, false, ex.Message); }
        // Parser/decoder errors may contain source snippets. Never put raw
        // configuration values into the UI or diagnostic status messages.
        catch (YamlException) { return new(executable, version, running, false, "配置文件的 YAML 格式无法识别，未生成自动修改方案。"); }
        catch (DecoderFallbackException) { return new(executable, version, running, false, "配置文件编码无法读取，请检查 UTF-8 编码后刷新。"); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        { return new(executable, version, running, false, "无法读取标准配置目录或文件，请检查文件是否被占用、受限或重定向。"); }
    }
}
