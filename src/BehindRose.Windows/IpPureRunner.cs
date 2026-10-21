using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BehindRose.Windows;

public sealed record IpPureState(string State, string? Id, int Family, string Route, string Stage, int Current, int Total, DateTimeOffset? StartedAt, DateTimeOffset? FinishedAt, JsonElement? Report, string? Error, int ProxyPort = 0);

/// <summary>One fixed IPPure request via the existing default network or a selected loopback proxy. No host settings are written.</summary>
public sealed class IpPureRunner : IDisposable
{
    public const string Endpoint = "https://my.ippure.com/v1/info";
    public const int MaxResponseBytes = 65536;
    private readonly object gate = new();
    private readonly Func<int, CancellationToken, Task<byte[]>> query;
    private readonly TimeSpan timeout;
    private CancellationTokenSource? cancellation;
    private Task? execution;
    private bool disposed;
    private IpPureState state = new("idle", null, 4, "proxy", "尚未开始", 0, 1, null, null, null, null);
    public IpPureRunner(Func<int, CancellationToken, Task<byte[]>> query, TimeSpan? timeout = null) { this.query = query; this.timeout = timeout ?? TimeSpan.FromSeconds(20); }
    public IpPureState Snapshot() { lock (gate) return state; }
    public IpPureState Start(int proxyPort)
    {
        if (proxyPort is < 0 or > 65535) throw new InvalidDataException("请选择有效的本机 HTTP / 混合端口。");
        lock (gate)
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            if (state.State == "running") throw new InvalidOperationException("IP 质量体检正在运行。");
            cancellation?.Dispose(); cancellation = new(timeout);
            state = new("running", Guid.NewGuid().ToString("N"), 4, proxyPort > 0 ? "proxy" : "default", proxyPort > 0 ? "正在通过所选代理查询 IPPure" : "正在通过本机默认网络查询 IPPure", 0, 1, DateTimeOffset.UtcNow, null, null, null, proxyPort);
            var id = state.Id!; var token = cancellation.Token;
            execution = Task.Run(() => RunAsync(id, proxyPort, token)); return state;
        }
    }
    public IpPureState Stop()
    {
        lock (gate)
        {
            if (state.State == "running") { state = state with { State = "cancelled", Stage = "已停止体检", FinishedAt = DateTimeOffset.UtcNow }; cancellation?.Cancel(); }
            return state;
        }
    }
    private async Task RunAsync(string id, int port, CancellationToken token)
    {
        try
        {
            byte[] bytes = await query(port, token);
            if (bytes.Length > MaxResponseBytes) throw new InvalidDataException("IPPure 响应超出大小限制。");
            using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 16 });
            var data = json.RootElement; var ip = Validate(data); int family = ip.AddressFamily == AddressFamily.InterNetwork ? 4 : 6;
            var time = DateTimeOffset.UtcNow;
            var report = JsonSerializer.SerializeToElement(new { Source = "IPPure", Endpoint, Head = new { IP = data.GetProperty("ip").GetString(), Time = time, Family = family, Proxy = port > 0 }, Data = data });
            token.ThrowIfCancellationRequested();
            lock (gate) if (state.Id == id && !token.IsCancellationRequested) state = state with { State = "complete", Stage = "IPPure 体检完成", Family = family, Current = 1, FinishedAt = time, Report = report };
        }
        catch (OperationCanceledException)
        {
            lock (gate) if (state.Id == id && state.State == "running") state = state with { State = "timeout", Stage = "本次未取得 IPPure 结果", FinishedAt = DateTimeOffset.UtcNow, Error = "IPPure 查询超过 20 秒，请稍后重试。" };
        }
        catch (Exception ex)
        {
            lock (gate) if (state.Id == id && state.State == "running") state = state with { State = "failed", Stage = "本次未取得 IPPure 结果", FinishedAt = DateTimeOffset.UtcNow, Error = ex is InvalidDataException ? ex.Message : ex is JsonException ? "IPPure 返回了无效 JSON。" : port > 0 ? "无法通过所选代理读取 IPPure，未回退直连。" : "无法通过本机默认网络读取 IPPure。" };
        }
    }
    internal static IPAddress Validate(JsonElement data)
    {
        if (data.ValueKind != JsonValueKind.Object || !data.TryGetProperty("ip", out var field) || field.ValueKind != JsonValueKind.String) throw new InvalidDataException("IPPure 未返回有效的出口 IP。");
        string address = field.GetString() ?? "";
        if (address.Length > 80 || address.Contains('%') || !IPAddress.TryParse(address, out var ip) || ip.AddressFamily is not (AddressFamily.InterNetwork or AddressFamily.InterNetworkV6) || ip.AddressFamily == AddressFamily.InterNetwork && !Regex.IsMatch(address, @"\A(?:[0-9]{1,3}\.){3}[0-9]{1,3}\z", RegexOptions.CultureInvariant)) throw new InvalidDataException("IPPure 未返回有效的出口 IP。");
        foreach (string key in new[] { "asOrganization", "country", "countryCode", "region", "regionCode", "city", "timezone", "postalCode", "userAgent" })
            if (data.TryGetProperty(key, out var value) && value.ValueKind != JsonValueKind.Null && (value.ValueKind != JsonValueKind.String || value.GetString()!.Length > 2048)) throw new InvalidDataException("IPPure 返回的数据格式不匹配。");
        if (data.TryGetProperty("asn", out var asn) && asn.ValueKind != JsonValueKind.Null && (asn.ValueKind != JsonValueKind.Number || !asn.TryGetInt64(out long asnNumber) || asnNumber < 0 || asnNumber > 9007199254740991)) throw new InvalidDataException("IPPure ASN 格式不匹配。");
        if (data.TryGetProperty("fraudScore", out var score) && score.ValueKind != JsonValueKind.Null && (score.ValueKind != JsonValueKind.Number || !score.TryGetDouble(out double scoreNumber) || !double.IsFinite(scoreNumber) || scoreNumber is < 0 or > 100)) throw new InvalidDataException("IPPure 风险系数格式不匹配。");
        foreach (string key in new[] { "isResidential", "isBroadcast" })
            if (data.TryGetProperty(key, out var value) && value.ValueKind is not (JsonValueKind.Null or JsonValueKind.True or JsonValueKind.False)) throw new InvalidDataException("IPPure IP 类型格式不匹配。");
        foreach (string key in new[] { "longitude", "latitude" })
            if (data.TryGetProperty(key, out var value) && value.ValueKind != JsonValueKind.Null && (value.ValueKind is not (JsonValueKind.String or JsonValueKind.Number) || value.ToString().Length > 80)) throw new InvalidDataException("IPPure 坐标格式不匹配。");
        return ip;
    }
    public async Task FinishAsync() { Dispose(); if (execution is not null) await execution; }
    internal Task WaitAsync() { lock (gate) return execution ?? Task.CompletedTask; }
    public void Dispose() { lock (gate) { if (disposed) return; disposed = true; Stop(); } }
}
