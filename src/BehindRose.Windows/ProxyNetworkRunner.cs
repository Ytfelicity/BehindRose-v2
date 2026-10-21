using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Net.Security;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BehindRose.Windows;

public sealed record ProxyIdentity(string Ip, string? Prefix, string[] Asns, string? Holder, string? Error);
public sealed record ProxyLatency(string Region, string Carrier, string Host, int Port, double?[] Samples, double? AverageMs, double? MinimumMs, double? JitterMs, double FailurePercent, string? Error);
public sealed record ProxyTransfer(string Name, string Url, string Direction, long Bytes, double Seconds, double? Mbps, string? Error);
public sealed record ProxyNetworkReport(string Version, string Scope, ProxyIdentity? Identity, string? FinalIp, bool? ExitChanged, ProxyLatency[] Latencies, ProxyTransfer[] Transfers);
public sealed record ProxyNetworkState(string State, string? Id, int ProxyPort, string Profile, bool IncludeSpeed, string Stage, int Current, int Total, DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt, ProxyNetworkReport? Report, string? Error);

/// <summary>Every connection uses the selected loopback HTTP proxy. No direct fallback, Docker, shell, or system configuration changes.</summary>
public sealed class ProxyNetworkRunner : IDisposable
{
    private const string Scope = "当前电脑 → 本机 HTTP 代理 → 目标。国内节点等待 HTTP 响应头，国际服务等待证书校验通过的 TLS 握手；耗时包含本机、代理、目标响应，不是 ICMP、TCP 大包或 VPS 回程。分流规则可能让不同目标走不同出口；开始/结束 IP 仅代表 ipify 请求。";
    private static readonly (string Code, string Name)[] Provinces = [
        ("bj","北京"),("tj","天津"),("he","河北"),("sx","山西"),("nm","内蒙古"),("ln","辽宁"),("jl","吉林"),("hl","黑龙江"),
        ("sh","上海"),("js","江苏"),("zj","浙江"),("ah","安徽"),("fj","福建"),("jx","江西"),("sd","山东"),("ha","河南"),
        ("hb","湖北"),("hn","湖南"),("gd","广东"),("gx","广西"),("hi","海南"),("cq","重庆"),("sc","四川"),("gz","贵州"),
        ("yn","云南"),("xz","西藏"),("sn","陕西"),("gs","甘肃"),("qh","青海"),("nx","宁夏"),("xj","新疆")];
    private static readonly (string Code, string Name)[] Carriers = [("ct","电信"),("cu","联通"),("cm","移动")];
    private static readonly (string Name, string Host)[] Global = [("Cloudflare","speed.cloudflare.com"),("Google","www.google.com"),("Apple","www.apple.com"),("Microsoft","www.microsoft.com"),("GitHub","github.com")];
    private static readonly (string Name, string Url, string Direction)[] Transfers = [
        ("中国大陆 · 中科大镜像","https://mirrors.ustc.edu.cn/ubuntu/ls-lR.gz","download"),
        ("中国大陆 · 清华镜像","https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ls-lR.gz","download"),
        ("Cloudflare · 就近边缘","https://speed.cloudflare.com/__down?bytes=8388608","download"),
        ("Cloudflare · 就近边缘","https://speed.cloudflare.com/__up","upload")];
    private readonly object gate = new();
    private readonly Func<int, HttpClient> clientFactory;
    private readonly Func<int, string, int, CancellationToken, Task<double>> probe;
    private CancellationTokenSource? cancellation;
    private Task? execution;
    private bool userCancelled, disposed;
    private ProxyNetworkState state = new("idle", null, 7897, "quick", false, "尚未开始", 0, 0, null, null, null, null);

    public ProxyNetworkRunner() : this(CreateClient, ProbeAsync) { }
    // Injection is for offline transport tests; the app bridge always uses the fixed default transports.
    public ProxyNetworkRunner(Func<int, HttpClient> clientFactory, Func<int, string, int, CancellationToken, Task<double>> probe)
    { this.clientFactory = clientFactory; this.probe = probe; }
    public ProxyNetworkState Snapshot() { lock (gate) return state; }
    public static void Validate(int port, string profile)
    {
        if (port is < 1 or > 65535 || profile is not ("quick" or "all")) throw new InvalidDataException("请输入 1–65535 的本机 HTTP 代理端口，并选择有效检测范围。");
    }
    public ProxyNetworkState Start(int port, string profile = "quick", bool includeSpeed = false)
    {
        Validate(port, profile);
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (state.State == "running") throw new InvalidOperationException("代理网络质量检测正在运行。");
            cancellation?.Dispose(); cancellation = new(TimeSpan.FromMinutes(5)); userCancelled = false;
            int total = 3 + (profile == "all" ? 93 : 9) + Global.Length + (includeSpeed ? Transfers.Length : 0);
            state = new("running", Guid.NewGuid().ToString("N"), port, profile, includeSpeed, "确认代理出口", 0, total, DateTimeOffset.UtcNow, null,
                new("1", Scope, null, null, null, [], []), null);
            var token = cancellation.Token;
            execution = Task.Run(() => RunAsync(port, profile, includeSpeed, token));
            return state;
        }
    }
    public ProxyNetworkState Stop()
    {
        lock (gate) { if (state.State == "running") { userCancelled = true; cancellation?.Cancel(); state = state with { Stage = "正在停止" }; } return state; }
    }
    private static HttpClient CreateClient(int port)
    {
        var client = new HttpClient(new SocketsHttpHandler {
            Proxy = new WebProxy(new Uri($"http://127.0.0.1:{port}"), false), UseProxy = true,
            AllowAutoRedirect = false, UseCookies = false, AutomaticDecompression = DecompressionMethods.None,
            ConnectTimeout = TimeSpan.FromSeconds(8), MaxConnectionsPerServer = 2
        }) { Timeout = Timeout.InfiniteTimeSpan, DefaultRequestVersion = HttpVersion.Version11, DefaultVersionPolicy = HttpVersionPolicy.RequestVersionExact };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("BehindRose-ProxyNetwork/1.0");
        client.DefaultRequestHeaders.CacheControl = new CacheControlHeaderValue { NoCache = true, NoStore = true };
        return client;
    }
    public static async Task<double> ProbeAsync(int proxyPort, string host, int targetPort, CancellationToken token)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(token); limit.CancelAfter(TimeSpan.FromSeconds(4));
        using var tcp = new TcpClient(); var watch = Stopwatch.StartNew();
        await tcp.ConnectAsync(IPAddress.Loopback, proxyPort, limit.Token);
        using var stream = tcp.GetStream();
        await stream.WriteAsync(Encoding.ASCII.GetBytes($"CONNECT {host}:{targetPort} HTTP/1.1\r\nHost: {host}:{targetPort}\r\n\r\n"), limit.Token);
        string line = await ReadHeaderAsync(stream, limit.Token);
        var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2 || parts[0] is not ("HTTP/1.0" or "HTTP/1.1") || parts[1] != "200") throw new IOException("代理未确认隧道连接");
        if (targetPort == 443)
        {
            using var tls = new SslStream(stream);
            await tls.AuthenticateAsClientAsync(new SslClientAuthenticationOptions { TargetHost = host }, limit.Token);
        }
        else
        {
            await stream.WriteAsync(Encoding.ASCII.GetBytes($"HEAD / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n"), limit.Token);
            string response = await ReadHeaderAsync(stream, limit.Token);
            var status = response.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (status.Length < 2 || status[0] is not ("HTTP/1.0" or "HTTP/1.1") || !int.TryParse(status[1], out int code) || code is < 100 or > 599) throw new IOException("目标未返回有效 HTTP 响应");
        }
        return Math.Round(watch.Elapsed.TotalMilliseconds, 1);
    }
    private static async Task<string> ReadHeaderAsync(Stream stream, CancellationToken token)
    {
        byte[] header = new byte[4096]; int count = 0;
        while (count < header.Length)
        {
            int received = await stream.ReadAsync(header.AsMemory(count, 1), token);
            if (received == 0) throw new IOException("代理提前关闭连接");
            count += received;
            if (count >= 4 && header[count-4] == 13 && header[count-3] == 10 && header[count-2] == 13 && header[count-1] == 10)
            {
                return Encoding.ASCII.GetString(header, 0, count).Split("\r\n", 2)[0];
            }
        }
        throw new IOException("响应头超出限制");
    }
    private async Task RunAsync(int port, string profile, bool speed, CancellationToken token)
    {
        try
        {
            using var http = clientFactory(port);
            string ip = await ExitIpAsync(http, token);
            Update(report => report with { Identity = new(ip, null, [], null, null) }); Advance("查询 BGP 归属");
            try { var identity = await IdentityAsync(http, ip, token); Update(report => report with { Identity = identity }); }
            catch (Exception ex) when (IsProbeFailure(ex, token)) { Update(report => report with { Identity = new(ip, null, [], null, "BGP 数据源未取得结果") }); }
            Advance("检测三网节点连接");
            var targets = (from province in Provinces where profile == "all" || province.Code is "bj" or "sh" or "gd"
                from carrier in Carriers select (Region: province.Name, Carrier: carrier.Name, Host: $"{province.Code}-{carrier.Code}-v4.ip.zstaticcdn.com", Port: 80))
                .Concat(Global.Select(node => (Region: "国际服务", Carrier: node.Name, node.Host, Port: 443))).ToArray();
            using var slots = new SemaphoreSlim(6);
            await Task.WhenAll(targets.Select(async target => {
                await slots.WaitAsync(token);
                try
                {
                    var result = await MeasureAsync(port, target.Region, target.Carrier, target.Host, target.Port, token);
                    Update(report => report with { Latencies = [..report.Latencies, result] }); Advance("检测节点连接");
                }
                finally { slots.Release(); }
            }));
            if (speed)
                foreach (var node in Transfers)
                {
                    token.ThrowIfCancellationRequested(); Stage($"测速：{node.Name} · {(node.Direction == "upload" ? "上传" : "下载")}");
                    var result = await TransferAsync(http, node.Name, node.Url, node.Direction, token);
                    Update(report => report with { Transfers = [..report.Transfers, result] }); Advance("测速");
                }
            Stage("复核代理出口");
            try { string finalIp = await ExitIpAsync(http, token); Update(report => report with { FinalIp = finalIp, ExitChanged = finalIp != ip }); }
            catch (Exception ex) when (IsProbeFailure(ex, token)) { /* A failed final check is unknown, never 'unchanged'. */ }
            token.ThrowIfCancellationRequested();
            lock (gate) state = state with { State = "complete", Current = state.Total, Stage = "检测完成，未取得结果的项目保留未知", FinishedAt = DateTimeOffset.UtcNow };
        }
        catch (OperationCanceledException)
        {
            lock (gate) state = state with { State = userCancelled ? "cancelled" : "timeout", Stage = userCancelled ? "已停止，保留已取得的结果" : "检测超时，保留已取得的结果", FinishedAt = DateTimeOffset.UtcNow };
        }
        catch (Exception)
        {
            lock (gate) state = state with { State = "failed", Stage = "检测未完成", FinishedAt = DateTimeOffset.UtcNow, Error = "未能通过指定 HTTP 代理取得有效公网出口。请检查代理是否运行、端口及认证要求。" };
        }
    }
    private static bool IsProbeFailure(Exception ex, CancellationToken token) => !token.IsCancellationRequested && ex is HttpRequestException or IOException or OperationCanceledException or JsonException or InvalidOperationException or KeyNotFoundException or FormatException;
    private async Task<ProxyLatency> MeasureAsync(int port, string region, string carrier, string host, int targetPort, CancellationToken token)
    {
        double?[] samples = new double?[3];
        for (int i = 0; i < samples.Length; i++)
        {
            token.ThrowIfCancellationRequested();
            try { double value = await probe(port, host, targetPort, token); if (double.IsFinite(value) && value >= 0) samples[i] = value; }
            catch (Exception ex) when (IsProbeFailure(ex, token) || (!token.IsCancellationRequested && ex is SocketException or System.Security.Authentication.AuthenticationException)) { }
        }
        var success = samples.Where(value => value.HasValue).Select(value => value!.Value).ToArray();
        var deltas = samples.Zip(samples.Skip(1)).Where(pair => pair.First.HasValue && pair.Second.HasValue).Select(pair => Math.Abs(pair.First!.Value - pair.Second!.Value)).ToArray();
        return new(region, carrier, host, targetPort, samples, success.Length > 0 ? Math.Round(success.Average(), 1) : null,
            success.Length > 0 ? success.Min() : null, deltas.Length > 0 ? Math.Round(deltas.Average(), 1) : null,
            Math.Round((3-success.Length) * 100.0 / 3, 1), success.Length == 0 ? "未取得目标响应" : null);
    }
    private static async Task<string> ExitIpAsync(HttpClient http, CancellationToken token)
    {
        var result = await JsonAsync(http, "https://api.ipify.org?format=json", token);
        string ip = result.GetProperty("ip").GetString() ?? "";
        if (!IPAddress.TryParse(ip, out var address) || IPAddress.IsLoopback(address) || address.AddressFamily != AddressFamily.InterNetwork) throw new IOException("无有效 IPv4");
        var bytes = address.GetAddressBytes();
        if (bytes[0] is 0 or 10 or 127 || bytes[0] >= 224 || (bytes[0] == 172 && bytes[1] is >=16 and <=31) || (bytes[0] == 192 && bytes[1] == 168) || (bytes[0] == 169 && bytes[1] == 254) || (bytes[0] == 198 && bytes[1] is 18 or 19) || (bytes[0] == 100 && bytes[1] is >=64 and <=127)) throw new IOException("非公网出口");
        return address.ToString();
    }
    private static async Task<ProxyIdentity> IdentityAsync(HttpClient http, string ip, CancellationToken token)
    {
        var network = (await JsonAsync(http, "https://stat.ripe.net/data/network-info/data.json?resource=" + Uri.EscapeDataString(ip), token)).GetProperty("data");
        string? prefix = network.GetProperty("prefix").GetString();
        string[] asns = network.GetProperty("asns").EnumerateArray().Select(value => value.ToString()).Where(value => uint.TryParse(value, out _)).Take(16).ToArray();
        string? holder = null, error = null;
        if (asns.Length > 0)
        {
            try { var overview = (await JsonAsync(http, "https://stat.ripe.net/data/as-overview/data.json?resource=AS" + asns[0], token)).GetProperty("data"); holder = overview.GetProperty("holder").GetString(); }
            catch (Exception ex) when (IsProbeFailure(ex, token)) { error = "ASN 机构名称未取得"; }
        }
        return new(ip, prefix, asns, holder, error);
    }
    private static async Task<JsonElement> JsonAsync(HttpClient http, string url, CancellationToken token)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(token); limit.CancelAfter(TimeSpan.FromSeconds(10));
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, limit.Token); response.EnsureSuccessStatusCode();
        using var stream = await response.Content.ReadAsStreamAsync(limit.Token); using var data = new MemoryStream();
        byte[] buffer = new byte[4096]; int read;
        while ((read = await stream.ReadAsync(buffer, limit.Token)) > 0) { if (data.Length + read > 131072) throw new IOException("JSON 超限"); data.Write(buffer, 0, read); }
        using var json = JsonDocument.Parse(data.ToArray(), new JsonDocumentOptions { MaxDepth = 16 }); return json.RootElement.Clone();
    }
    private static async Task<ProxyTransfer> TransferAsync(HttpClient http, string name, string url, string direction, CancellationToken token)
    {
        const int downloadBytes = 8*1024*1024, uploadBytes = 4*1024*1024;
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(token); limit.CancelAfter(TimeSpan.FromSeconds(20));
        using var request = new HttpRequestMessage(direction == "upload" ? HttpMethod.Post : HttpMethod.Get, url);
        if (direction == "upload") request.Content = new ByteArrayContent(RandomNumberGenerator.GetBytes(uploadBytes));
        else request.Headers.Range = new RangeHeaderValue(0, downloadBytes-1);
        if (request.Content != null) request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        long bytes = 0; var watch = Stopwatch.StartNew();
        try
        {
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, limit.Token);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentType?.MediaType?.Contains("html", StringComparison.OrdinalIgnoreCase) == true || response.Content.Headers.ContentEncoding.Count > 0) throw new IOException("节点返回网页或压缩响应");
            if (direction == "download")
            {
                using var stream = await response.Content.ReadAsStreamAsync(limit.Token); byte[] buffer = new byte[65536];
                while (bytes < downloadBytes) { int read = await stream.ReadAsync(buffer.AsMemory(0, (int)Math.Min(buffer.Length, downloadBytes-bytes)), limit.Token); if (read == 0) break; bytes += read; }
                if (bytes < 256*1024) throw new IOException("有效样本不足 256 KiB");
            }
            else bytes = uploadBytes;
            watch.Stop();
            return new(name, url, direction, bytes, Math.Round(watch.Elapsed.TotalSeconds, 3), Math.Round(bytes*8 / watch.Elapsed.TotalSeconds / 1_000_000, 2), null);
        }
        catch (Exception ex) when (IsProbeFailure(ex, token))
        { return new(name, url, direction, bytes, Math.Round(watch.Elapsed.TotalSeconds, 3), null, "测速未完成，可能超时、节点限制或响应无效"); }
    }
    private void Update(Func<ProxyNetworkReport, ProxyNetworkReport> update) { lock (gate) state = state with { Report = update(state.Report!) }; }
    private void Advance(string stage) { lock (gate) state = state with { Current = state.Current+1, Stage = stage }; }
    private void Stage(string stage) { lock (gate) state = state with { Stage = stage }; }
    public async Task FinishAsync() { Dispose(); if (execution != null) await execution; cancellation?.Dispose(); }
    public void Dispose() { lock (gate) { disposed = true; userCancelled = true; cancellation?.Cancel(); } }
}
