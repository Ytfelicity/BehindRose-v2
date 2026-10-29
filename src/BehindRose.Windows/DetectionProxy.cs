namespace BehindRose.Windows;

public static class DetectionProxy
{
    public static int? Select(LocalProxyPorts ports)
    {
        foreach (var source in new[] { "Clash · 混合端口", "Clash · HTTP 端口" })
        {
            var matches = ports.Candidates.Where(candidate => candidate.Sources.Contains(source)).Select(candidate => candidate.Port).Distinct().ToArray();
            if (matches.Length == 1) return matches[0];
            if (matches.Length > 1) return null;
        }
        return null;
    }
    public static int? ReadPort() => Select(ProxyPortDiscovery.Read());
    public static string Arguments(int port)
    {
        if (port is < 1 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));
        return $"--proxy-server=http://127.0.0.1:{port} --proxy-bypass-list=localhost;127.0.0.1;[::1]";
    }
}
