using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BehindRose.Desktop;

public sealed class NetworkView : IDisposable
{
    private const string Origin = "https://diagnostics.behindrose.invalid/";
    // Custom website probes run in this unprivileged browser, never through the native bridge.
    private const string Csp = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self' https: stun:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
    private static readonly HashSet<string> ServiceIcons = ["claude-color", "openai", "gemini-color", "deepseek-color", "huggingface-color", "midjourney", "suno", "manus", "mistral-color", "metaai-color", "qwen-color", "kimi", "poe-color", "perplexity-color", "google-color", "github", "cloudflare-color"];
    private static readonly Dictionary<string, string> Assets = new() { ["/"] = "index.html", ["/index.html"] = "index.html", ["/diagnostics.css"] = "diagnostics.css", ["/diagnostics.js"] = "diagnostics.js", ["/diagnostics-core.js"] = "diagnostics-core.js", ["/network-console.css"] = "network-console.css", ["/network-ui.js"] = "network-ui.js", ["/beui.css"] = "beui.css", ["/avatar.png"] = "avatar-source.png" };
    private static readonly HashSet<string> Links = ["https://db-ip.com/", "https://www.ipify.org/", "https://ipapi.co/api/", "https://bash.ws/dnsleak", "https://ipleak.net/", "https://ippure.com/", "https://ippure.com/MyIP-Info-API", "https://ippure.com/faq", "https://github.com/macvk/dnsleaktest", "https://github.com/jason5ng32/MyIP", "https://developers.cloudflare.com/realtime/turn/"];
    private readonly List<Stream> responseStreams = [];
    private readonly BehindRose.Windows.IpPureRunner quality = new(IpPureBrowserClient.QueryAsync);
    private readonly BehindRose.Windows.ProxyNetworkRunner proxyNetwork = new();
    private readonly TaskCompletionSource loaded = new();
    private string epoch = Guid.NewGuid().ToString("N");
    private bool disposed;
    private bool lightTheme;
    private FileSystemWatcher? assetWatcher;
    private DispatcherTimer? reloadTimer;
    public WebView2 Browser { get; } = new();
    public event Action<string>? SummaryChanged;
    public async Task Initialize(bool light)
    {
        lightTheme = light;
        var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BehindRose", "NetworkAssistant-v2", DevelopmentMode.Enabled ? "WebView2-Development" : "WebView2");
        var environment = await CoreWebView2Environment.CreateAsync(null, data);
        if (disposed) return;
        await Browser.EnsureCoreWebView2Async(environment);
        var core = Browser.CoreWebView2;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsWebMessageEnabled = true; // Fixed, schema-checked diagnostic status and ordinary-user control replies; no privileged commands.
        core.Settings.AreDevToolsEnabled = DevelopmentMode.Enabled;
        core.Settings.IsStatusBarEnabled = false;
        core.PermissionRequested += (_, args) => { args.State = CoreWebView2PermissionState.Deny; args.Handled = true; };
        core.DownloadStarting += (_, args) => args.Cancel = true;
        core.AddWebResourceRequestedFilter(Origin + "*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
        core.WebResourceRequested += (_, args) =>
        {
            var uri = new Uri(args.Request.Uri);
            if (!IsLocal(uri)) return;
            Assets.TryGetValue(uri.AbsolutePath, out string? asset);
            if (uri.AbsolutePath is "/country-lookup.js" or "/country-db/country4.bin" or "/country-db/country6.bin" or "/icons.svg" or "/flag-codes.js") asset = uri.AbsolutePath[1..];
            if (System.Text.RegularExpressions.Regex.IsMatch(uri.AbsolutePath, @"^/flags/[a-z]{2}\.svg$")) asset = uri.AbsolutePath[1..];
            var serviceIcon = System.Text.RegularExpressions.Regex.Match(uri.AbsolutePath, @"^/service-icons/([a-z-]+)\.svg$");
            if (serviceIcon.Success && ServiceIcons.Contains(serviceIcon.Groups[1].Value)) asset = uri.AbsolutePath[1..];
            if (System.Text.RegularExpressions.Regex.IsMatch(uri.AbsolutePath, @"^/fonts/(figtree-latin-(400|500|600|700)-normal|eb-garamond-latin-400-normal)\.woff2$")) asset = uri.AbsolutePath[1..];
            if (asset == null || args.Request.Method != "GET") { args.Response = environment.CreateWebResourceResponse(null, 404, "Not Found", ""); return; }
            MemoryStream output;
            try { output = new MemoryStream(ReadAsset(asset)); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            { args.Response = environment.CreateWebResourceResponse(null, 503, "Source file unavailable", "Cache-Control: no-store\r\n"); SummaryChanged?.Invoke("源码文件正在保存或暂不可读，请保存后刷新检测页。"); return; }
            responseStreams.Add(output);
            var type = asset.EndsWith(".bin") ? "application/octet-stream" : asset.EndsWith(".woff2") ? "font/woff2" : asset.EndsWith(".html") ? "text/html; charset=utf-8" : asset.EndsWith(".css") ? "text/css; charset=utf-8" : asset.EndsWith(".js") ? "text/javascript; charset=utf-8" : asset.EndsWith(".svg") ? "image/svg+xml" : "image/png";
            args.Response = environment.CreateWebResourceResponse(output, 200, "OK", "Content-Type: " + type + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: " + Csp + "\r\n");
        };
        core.NavigationStarting += (_, args) =>
        {
            if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) && IsLocal(uri) && uri.AbsolutePath is "/" or "/index.html") return;
            args.Cancel = true; if (args.IsUserInitiated) OpenSource(args.Uri);
        };
        core.FrameNavigationStarting += (_, args) => args.Cancel = true;
        core.NewWindowRequested += (_, args) => { args.Handled = true; if (args.IsUserInitiated) OpenSource(args.Uri); };
        core.NavigationCompleted += (_, args) =>
        {
            if (args.IsSuccess) { SetTheme(lightTheme); Send(new { kind = "epoch", epoch }); loaded.TrySetResult(); }
            else loaded.TrySetException(new IOException("本地检测页面加载失败：" + args.WebErrorStatus));
        };
        core.ProcessFailed += (_, _) => SummaryChanged?.Invoke("检测组件已中断，当前结果无法确认；请重新打开程序。");
        core.WebMessageReceived += (_, args) =>
        {
            try
            {
                if (!Uri.TryCreate(args.Source, UriKind.Absolute, out var source) || !IsLocal(source) || source.AbsolutePath is not ("/" or "/index.html")) return;
                string json = args.WebMessageAsJson;
                if (json.Length > 4096) return;
                using var doc = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 5 });
                var root = doc.RootElement;
                if (root.GetProperty("epoch").GetString() != epoch) return;
                var kind = root.GetProperty("kind").GetString();
                if (kind == "proxy-network")
                {
                    string? requestId = root.GetProperty("requestId").GetString();
                    if (!Guid.TryParse(requestId, out Guid parsedProxyRequestId)) return;
                    try
                    {
                        string? action = root.GetProperty("action").GetString();
                        bool start = action == "proxy-network-start";
                        if (root.EnumerateObject().Any(property => property.Name is not ("kind" or "epoch" or "requestId" or "action") && (!start || property.Name is not ("proxyPort" or "profile" or "includeSpeed")))) throw new InvalidDataException("代理网络检测参数无效。");
                        if (start && quality.Snapshot().State == "running") throw new InvalidOperationException("请先停止 IP 质量体检，以免检测流量影响结果。");
                        object data = action switch {
                            "proxy-network-status" => proxyNetwork.Snapshot(),
                            "proxy-network-stop" => proxyNetwork.Stop(),
                            "proxy-network-start" => proxyNetwork.Start(root.GetProperty("proxyPort").GetInt32(), root.GetProperty("profile").GetString() ?? "", root.GetProperty("includeSpeed").GetBoolean()),
                            _ => throw new InvalidDataException("不支持的检测操作。")
                        };
                        Send(new { kind = "proxy-network-response", requestId, data });
                    }
                    catch (Exception ex) when (ex is InvalidDataException or InvalidOperationException or KeyNotFoundException or FormatException) { Send(new { kind = "proxy-network-response", requestId, error = "代理网络检测参数无效，或另一项体检正在运行。" }); }
                    return;
                }
                if (kind == "quality")
                {
                    string? requestId = root.GetProperty("requestId").GetString();
                    if (!Guid.TryParse(requestId, out Guid parsedRequestId)) return;
                    try
                    {
                        var action = root.GetProperty("action").GetString();
                        bool start = action == "quality-start";
                        if (root.EnumerateObject().Any(property => property.Name is not ("kind" or "epoch" or "requestId" or "action") && (!start || property.Name != "proxyPort"))) throw new InvalidDataException("IPPure 检测参数无效。");
                        if (action == "quality-proxies") { _ = ReplyProxyPortsAsync(requestId!, epoch); return; }
                        if (action == "quality-start" && proxyNetwork.Snapshot().State == "running") throw new InvalidOperationException("请先停止代理网络检测，以免检测流量影响结果。");
                        object data = action switch
                        {
                            "quality-status" => quality.Snapshot(),
                            "quality-stop" => quality.Stop(),
                            "quality-start" => quality.Start(root.GetProperty("proxyPort").GetInt32()),
                            _ => throw new InvalidDataException("不支持的检测操作。")
                        };
                        Send(new { kind = "quality-response", requestId, data });
                    }
                    catch (Exception ex) when (ex is InvalidDataException or InvalidOperationException) { Send(new { kind = "quality-response", requestId, error = ex.Message }); }
                    return;
                }
                if (kind == "started") { SummaryChanged?.Invoke("正在采样，尚未形成结论"); return; }
                if (kind != "completed") return;
                var statuses = root.GetProperty("statuses").EnumerateArray().Select(x => x.GetString()).ToArray();
                if (statuses.Length != 8 || statuses.Any(x => x is not ("idle" or "running" or "ready" or "failed" or "cancelled" or "unavailable" or "skipped"))) return;
                int ready = statuses.Count(x => x == "ready"), unknown = statuses.Count(x => x is "failed" or "cancelled" or "unavailable" or "idle" or "running");
                SummaryChanged?.Invoke($"{ready} 项取得结果，{unknown} 项无法确认；请核对网络检测详情");
            }
            catch (Exception ex) when (ex is JsonException or InvalidOperationException or KeyNotFoundException) { /* Untrusted page data cannot trigger native actions. */ }
        };
        core.Navigate(Origin);
        await loaded.Task.WaitAsync(TimeSpan.FromSeconds(20));
        if (DevelopmentMode.Enabled)
        {
            reloadTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
            reloadTimer.Tick += (_, _) => { reloadTimer.Stop(); Reload(); };
            assetWatcher = new FileSystemWatcher(Path.Combine(DevelopmentMode.Assets!, "diagnostics")) { IncludeSubdirectories = true, NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size };
            FileSystemEventHandler changed = (_, args) => QueueReload(args.FullPath);
            assetWatcher.Changed += changed; assetWatcher.Created += changed; assetWatcher.Deleted += changed;
            assetWatcher.Renamed += (_, args) => QueueReload(args.FullPath);
            assetWatcher.EnableRaisingEvents = true;
        }
    }
    private static byte[] ReadAsset(string asset)
    {
        if (DevelopmentMode.Assets is string source)
            return File.ReadAllBytes(asset == "avatar-source.png" ? Path.Combine(source, asset) : Path.Combine(source, "diagnostics", asset));
        var assembly = Assembly.GetExecutingAssembly();
        string suffix = asset == "avatar-source.png" ? ".Assets." + asset : ".Assets.diagnostics." + asset.Replace('/', '.');
        var resource = assembly.GetManifestResourceNames().SingleOrDefault(x => x.EndsWith(suffix, StringComparison.Ordinal)) ?? throw new FileNotFoundException("找不到本地图标或页面资源。");
        using var input = assembly.GetManifestResourceStream(resource)!;
        using var bytes = new MemoryStream(); input.CopyTo(bytes); return bytes.ToArray();
    }
    private void QueueReload(string path)
    {
        if (disposed || !new[] { ".html", ".css", ".js", ".svg" }.Contains(Path.GetExtension(path), StringComparer.OrdinalIgnoreCase)) return;
        Browser.Dispatcher.BeginInvoke(() => { if (disposed) return; reloadTimer!.Stop(); reloadTimer.Start(); });
    }
    public void Reload()
    {
        if (disposed || Browser.CoreWebView2 == null) return;
        StopAndInvalidate(); SummaryChanged?.Invoke("检测页面已刷新，请重新开始采样"); Browser.Reload();
    }
    private static bool IsLocal(Uri uri) => uri.Scheme == "https" && uri.Host == "diagnostics.behindrose.invalid" && uri.IsDefaultPort && string.IsNullOrEmpty(uri.UserInfo);
    private static void OpenSource(string url) { if (!Links.Contains(url) && !System.Text.RegularExpressions.Regex.IsMatch(url, @"^https://check\.place/-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,\d+,(?:en|cn)$")) return; try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { } }
    private void Send(object message) { if (!disposed && Browser.CoreWebView2 != null) Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message, new JsonSerializerOptions(JsonSerializerDefaults.Web))); }
    private async Task ReplyProxyPortsAsync(string requestId, string requestEpoch)
    {
        try
        {
            var data = await Task.Run(BehindRose.Windows.ProxyPortDiscovery.Read);
            if (!disposed && epoch == requestEpoch) Send(new { kind = "quality-response", requestId, data });
        }
        catch
        {
            if (!disposed && epoch == requestEpoch) Send(new { kind = "quality-response", requestId, error = "未能读取本机代理端口，请手动填写。" });
        }
    }
    public void Start() => Send(new { kind = "start", epoch });
    public void SetTheme(bool light) { lightTheme = light; Send(new { kind = "theme", light }); }
    public void StopAndInvalidate() { quality.Stop(); proxyNetwork.Stop(); epoch = Guid.NewGuid().ToString("N"); Send(new { kind = "stop", epoch }); }
    public void Dispose() { if (disposed) return; disposed = true; quality.Dispose(); proxyNetwork.Dispose(); assetWatcher?.Dispose(); reloadTimer?.Stop(); Browser.Dispose(); foreach (var stream in responseStreams) stream.Dispose(); responseStreams.Clear(); }
}
