using System.Globalization;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using BehindRose.Core;
using Microsoft.Win32;
using YamlDotNet.RepresentationModel;

namespace BehindRose.Windows;

public sealed record LocalProxyPort(int Port, string[] Sources, bool LoopbackOnly);
public sealed record LocalProxyPorts(LocalProxyPort[] Candidates, string[] Notes);

/// <summary>Reads existing settings and the OS listener table. Never connects,
/// scans ports, evaluates PAC scripts, or writes proxy/client settings.</summary>
public static class ProxyPortDiscovery
{
    public static LocalProxyPorts Read()
    {
        var notes = new HashSet<string>(StringComparer.Ordinal);
        IPEndPoint[] endpoints;
        try { endpoints = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners(); }
        catch (NetworkInformationException)
        { return new([], ["无法读取本机监听端口，请手动填写 HTTP 或混合端口。"]); }
        var listeners = endpoints.Where(endpoint => endpoint.AddressFamily == AddressFamily.InterNetwork || endpoint.Address.Equals(IPAddress.IPv6Any))
            .GroupBy(endpoint => endpoint.Port).ToDictionary(group => group.Key, group => group.ToArray());
        var candidates = new Dictionary<int, HashSet<string>>();
        void Add(int port, string source)
        {
            if (port is < 1 or > 65535 || !listeners.ContainsKey(port)) return;
            if (!candidates.TryGetValue(port, out var sources)) candidates[port] = sources = new(StringComparer.Ordinal);
            sources.Add(source);
        }
        void AddAddress(string? address, string source)
        {
            if (TryLocalHttpPort(address, out int port)) Add(port, source);
        }

        try
        {
            using var settings = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Internet Settings", false);
            if (settings?.GetValue("ProxyEnable") is int enabled && enabled != 0 && settings.GetValue("ProxyServer") is string server)
                foreach (var item in server.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    int equal = item.IndexOf('=');
                    if (equal < 0) AddAddress(item, "系统代理");
                    else if (item[..equal].Equals("http", StringComparison.OrdinalIgnoreCase) || item[..equal].Equals("https", StringComparison.OrdinalIgnoreCase))
                        AddAddress(item[(equal + 1)..], "系统代理 · " + item[..equal].ToUpperInvariant());
                }
            if (settings?.GetValue("AutoConfigURL") is string pac && !string.IsNullOrWhiteSpace(pac))
                notes.Add("自动配置脚本（PAC）的端口无法仅靠本机设置确定，可手动填写。");
        }
        catch (Exception error) when (error is UnauthorizedAccessException or System.Security.SecurityException or IOException)
        { notes.Add("系统代理设置未能读取，仍可使用其他来源或手动填写。"); }

        foreach (string name in new[] { "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY" })
            AddAddress(Environment.GetEnvironmentVariable(name), "环境变量 · " + name);

        foreach (string name in new[] { "config.yaml", "clash-verge.yaml", "clash.yaml" })
        {
            string path = Path.Combine(WindowsState.ConfigRoot, name);
            if (!File.Exists(path)) continue;
            try
            {
                var root = RepairPlanner.Parse(SafeFiles.Read(path), name);
                void ConfigPort(YamlMappingNode map, string key, string source)
                {
                    if (RepairPlanner.Get(map, key) is YamlScalarNode value && int.TryParse(value.Value, NumberStyles.None, CultureInfo.InvariantCulture, out int port)) Add(port, source);
                }
                ConfigPort(root, "mixed-port", "Clash · 混合端口");
                ConfigPort(root, "port", "Clash · HTTP 端口");
                if (RepairPlanner.Get(root, "listeners") is YamlSequenceNode inbound)
                    foreach (var item in inbound.Children.OfType<YamlMappingNode>())
                    {
                        string? type = (RepairPlanner.Get(item, "type") as YamlScalarNode)?.Value;
                        if (type is "http" or "mixed") ConfigPort(item, "port", type == "mixed" ? "Clash · 混合监听" : "Clash · HTTP 监听");
                    }
            }
            catch (Exception error) when (error is IOException or InvalidDataException or UnauthorizedAccessException or YamlDotNet.Core.YamlException or DecoderFallbackException)
            { notes.Add("部分 Clash 配置未能读取，仍可使用其他来源或手动填写。"); }
        }
        return new(candidates.OrderBy(item => item.Key).Select(item => new LocalProxyPort(item.Key, item.Value.Order(StringComparer.Ordinal).ToArray(), listeners[item.Key].All(endpoint => IPAddress.IsLoopback(endpoint.Address)))).ToArray(), notes.ToArray());
    }

    private static bool TryLocalHttpPort(string? value, out int port)
    {
        port = 0;
        if (string.IsNullOrWhiteSpace(value) || value.Length > 2048) return false;
        string address = value.Trim();
        if (!address.Contains("://", StringComparison.Ordinal)) address = "http://" + address;
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme != "http" || uri.UserInfo.Length != 0 || uri.Port is < 1 or > 65535) return false;
        bool local = uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
            || IPAddress.TryParse(uri.Host, out var ip) && ip.AddressFamily == AddressFamily.InterNetwork && IPAddress.IsLoopback(ip);
        if (!local) return false;
        port = uri.Port;
        return true;
    }
}
