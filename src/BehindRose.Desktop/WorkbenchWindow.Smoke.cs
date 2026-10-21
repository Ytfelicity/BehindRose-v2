using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shell;
using Microsoft.Web.WebView2.Core;

namespace BehindRose.Desktop;

internal sealed partial class WorkbenchWindow
{
    private async Task SmokeAsync()
    {
        string root = Path.Combine(Environment.CurrentDirectory, "ui-smoke"); Directory.CreateDirectory(root);
        using var client = new HttpClient(new SocketsHttpHandler { UseProxy = false }) { BaseAddress = new Uri(server.Url), Timeout = TimeSpan.FromSeconds(10) };
        client.DefaultRequestHeaders.Add("Origin", server.Url);
        using var session = JsonDocument.Parse(await client.GetStringAsync("/api/session"));
        client.DefaultRequestHeaders.Add("X-BehindRose-Token", session.RootElement.GetProperty("token").GetString());
        async Task<JsonElement> Call(string command, object? fields = null)
        {
            var values = fields == null ? new Dictionary<string, object>() : JsonSerializer.Deserialize<Dictionary<string, object>>(JsonSerializer.Serialize(fields))!;
            values["command"] = command;
            using var content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(values)); content.Headers.ContentType = new("application/json");
            using var reply = await client.PostAsync("/api/local", content);
            using var data = JsonDocument.Parse(await reply.Content.ReadAsStringAsync());
            if (!reply.IsSuccessStatusCode) throw new IOException("Workbench smoke request failed: " + command);
            return data.RootElement.GetProperty("data").Clone();
        }
        async Task Completed()
        {
            for (int i = 0; i < 100; i++)
            {
                var status = await Call("status");
                if (status.GetProperty("operation").GetProperty("done").GetBoolean())
                {
                    if (!status.GetProperty("operation").GetProperty("result").GetProperty("success").GetBoolean()) throw new IOException("Demo operation failed");
                    return;
                }
                await Task.Delay(40);
            }
            throw new TimeoutException("Demo operation did not finish");
        }
        async Task WaitFor(string condition, int attempts = 120)
        {
            for (int i = 0; i < attempts; i++)
            { if (await browser.CoreWebView2.ExecuteScriptAsync("Boolean(" + condition + ")") == "true") return; await Task.Delay(50); }
            throw new IOException("Workbench UI did not become ready: " + condition);
        }
        async Task Capture(string name)
        {
            await Task.Delay(1300);
            using var image = File.Create(Path.Combine(root, name));
            await browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, image);
        }
        var health = await Call("health");
        if (!health.GetProperty("demo").GetBoolean()) throw new IOException("Smoke must use in-memory state");
        if (WindowStyle != WindowStyle.None || WindowChrome.GetWindowChrome(this)?.CaptionHeight != 36) throw new IOException("Native white window chrome is still enabled");
        maximizeButton.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
        await Task.Delay(120);
        if (WindowState != WindowState.Maximized || AutomationProperties.GetName(maximizeButton) != "还原") throw new IOException("Custom maximize action failed");
        maximizeButton.RaiseEvent(new RoutedEventArgs(System.Windows.Controls.Button.ClickEvent));
        await Task.Delay(120);
        if (WindowState != WindowState.Normal || AutomationProperties.GetName(maximizeButton) != "最大化") throw new IOException("Custom restore action failed");
        var dpi = VisualTreeHelper.GetDpi(captionBar);
        var caption = new RenderTargetBitmap((int)(captionBar.ActualWidth * dpi.DpiScaleX), (int)(captionBar.ActualHeight * dpi.DpiScaleY), dpi.PixelsPerInchX, dpi.PixelsPerInchY, PixelFormats.Pbgra32);
        caption.Render(captionBar);
        var png = new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(caption));
        using (var image = File.Create(Path.Combine(root, "window-caption.png"))) png.Save(image);
        using var iconManifest = JsonDocument.Parse(AppAssets.Read("diagnostics/service-icons/manifest.json"));
        int iconCount = 0;
        foreach (var icon in iconManifest.RootElement.GetProperty("files").EnumerateArray())
        {
            byte[] bytes = await client.GetByteArrayAsync("/service-icons/" + icon.GetProperty("name").GetString() + ".svg");
            if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(icon.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase)) throw new IOException("Packaged icon differs from its source manifest");
            iconCount++;
        }
        foreach (string font in new[] { "figtree-latin-400-normal", "figtree-latin-500-normal", "figtree-latin-600-normal", "figtree-latin-700-normal", "eb-garamond-latin-400-normal" })
        {
            byte[] bytes = await client.GetByteArrayAsync("/fonts/" + font + ".woff2");
            if (bytes.Length < 4 || System.Text.Encoding.ASCII.GetString(bytes, 0, 4) != "wOF2") throw new IOException("Packaged font is missing or invalid");
        }
        using var countries = JsonDocument.Parse(AppAssets.Read("diagnostics/country-db/manifest.json"));
        foreach (var file in countries.RootElement.GetProperty("files").EnumerateArray())
        {
            byte[] bytes = await client.GetByteArrayAsync("/country-db/" + file.GetProperty("name").GetString());
            if (!Convert.ToHexString(SHA256.HashData(bytes)).Equals(file.GetProperty("sha256").GetString(), StringComparison.OrdinalIgnoreCase)) throw new IOException("Packaged country data differs from its manifest");
        }
        await client.GetByteArrayAsync("/flags/cn.svg");
        await WaitFor("document.body.classList.contains('dashboard4') && document.getElementById('network-frame')?.contentWindow?.RoseCheck && document.getElementById('dev-state')?.textContent.includes('桌面')");
        foreach (var (group, expectedImages) in new[] { ("reference", 7), ("ai", 14), ("common", 3) })
        {
            await browser.CoreWebView2.ExecuteScriptAsync("(() => { const f=document.getElementById('network-frame'); const select=f.contentDocument.querySelector('select[aria-label=\"网站分组\"]'); select.value='" + group + "'; select.dispatchEvent(new f.contentWindow.Event('change',{bubbles:true})); })()");
            await WaitFor("(() => { const images=[...document.getElementById('network-frame').contentDocument.querySelectorAll('.service-brand img')]; return images.length === " + expectedImages + " && images.every(img => img.complete && img.naturalWidth > 0 && new URL(img.src).origin === location.origin); })()");
        }
        await browser.CoreWebView2.ExecuteScriptAsync("(() => { const f=document.getElementById('network-frame'); const select=f.contentDocument.querySelector('select[aria-label=\"网站分组\"]'); select.value='reference'; select.dispatchEvent(new f.contentWindow.Event('change',{bubbles:true})); })()");
        await WaitFor("document.getElementById('network-frame').contentDocument.querySelectorAll('.service-brand img').length === 7");
        await Capture("workbench-network.png");
        await browser.CoreWebView2.ExecuteScriptAsync("location.hash='#connectivity'");
        await Capture("workbench-icons.png");
        JsonElement? liveCheck = null;
        if (liveConnectivitySmoke)
        {
            // This explicit opt-in test makes one real GET per built-in target.
            // All configuration operations still use the in-memory demo state.
            allowLiveConnectivity = true;
            await browser.CoreWebView2.ExecuteScriptAsync("(() => { const f=document.getElementById('network-frame'); const select=f.contentDocument.querySelector('select[aria-label=\"采样方式\"]'); select.value='1'; select.dispatchEvent(new f.contentWindow.Event('change',{bubbles:true})); })()");
            await Task.Delay(100);
            await browser.CoreWebView2.ExecuteScriptAsync("document.getElementById('network-frame').contentDocument.querySelector('#connectivity .detection-primary-action').click()");
            await WaitFor("document.getElementById('network-frame').contentWindow.RoseConnectivity.snapshot().total === 7");
            await WaitFor("(() => { const s=document.getElementById('network-frame').contentWindow.RoseConnectivity.snapshot(); return !s.running && s.completed === 7; })()", 600);
            string result = await browser.CoreWebView2.ExecuteScriptAsync("(() => { const d=document.getElementById('network-frame').contentDocument; return {summary:d.querySelector('.connectivity-summary').textContent, rows:[...d.querySelectorAll('.connectivity-row')].map(row=>({name:row.getAttribute('aria-label'),state:row.dataset.state,latency:row.querySelector('.connectivity-latency').textContent}))}; })()");
            using var parsed = JsonDocument.Parse(result); liveCheck = parsed.RootElement.Clone();
            File.WriteAllText(Path.Combine(root, "live-connectivity.json"), JsonSerializer.Serialize(new { result = liveCheck, requests = liveRequests, responses = liveResponses }));
            await Capture("workbench-connectivity-live.png");
            allowLiveConnectivity = false;
            if (liveRequests.Count == 0 || !liveCheck.Value.GetProperty("rows").EnumerateArray().Any(row => row.GetProperty("state").GetString() is "reachable" or "slow")) throw new IOException("No live website responded; see live-connectivity.json");
        }
        await browser.CoreWebView2.ExecuteScriptAsync("location.hash='#overview'");
        await WaitFor("!document.getElementById('page-overview').hidden && !document.getElementById('protect-now').disabled");
        await Capture("workbench-configuration.png");
        var plan = await Call("plan", new { options = 47 });
        if (plan.GetProperty("changes").GetArrayLength() != 6) throw new IOException("Shared one-click plan is incomplete");
        await Call("execute", new { planId = plan.GetProperty("id").GetString() }); await Completed();
        var backups = await Call("backups");
        if (backups.GetArrayLength() != 1) throw new IOException("Demo backup missing");
        var restore = await Call("restore-plan", new { backupId = backups[0].GetProperty("id").GetString() });
        await Call("execute", new { planId = restore.GetProperty("id").GetString() }); await Completed();
        async Task Reject(string path, HttpStatusCode expected, Action<HttpRequestMessage> change, string body = "{\"command\":\"health\"}")
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new StringContent(body) };
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json"); change(request);
            using var response = await client.SendAsync(request);
            if (response.StatusCode != expected) throw new IOException("Workbench API boundary failed: " + expected + " / " + response.StatusCode);
        }
        await Reject("/api/local", HttpStatusCode.Forbidden, r => r.Headers.Add("X-BehindRose-Token", new string('0', 64)));
        await Reject("/api/local", HttpStatusCode.Forbidden, r => r.Headers.Add("Origin", "https://example.invalid"));
        await Reject("/api/local", HttpStatusCode.Forbidden, r => r.Headers.Host = "example.invalid");
        await Reject("/api/local", HttpStatusCode.UnsupportedMediaType, r => r.Content!.Headers.ContentType = new("text/plain"));
        await Reject("/api/local", HttpStatusCode.RequestEntityTooLarge, _ => {}, new string('x', 4097));
        await Reject("/api/local", HttpStatusCode.BadRequest, _ => {}, "{\"command\":\"health\",\"path\":\"invalid\"}");
        await Reject("/api/local", HttpStatusCode.BadRequest, _ => {}, "{\"command\":\"quality-start\",\"proxyPort\":\"7897\"}");
        await Reject("/api/local", HttpStatusCode.BadRequest, _ => {}, "{\"command\":\"health\",\"command\":\"execute\"}");
        using (local.ReserveUpdate() ?? throw new IOException("Update reservation failed"))
            await Reject("/api/local", HttpStatusCode.Conflict, _ => {}, "{\"command\":\"plan\",\"options\":47}");
        await browser.CoreWebView2.ExecuteScriptAsync("location.hash='#settings'");
        await WaitFor("!document.getElementById('desktop-updates').hidden && document.getElementById('app-version').textContent.includes('preview')");
        await browser.CoreWebView2.ExecuteScriptAsync("document.getElementById('desktop-updates').scrollIntoView({block:'center'})");
        await Capture("workbench-updates.png");
        if (externalSmokeRequests != 0) throw new IOException("UI attempted to load an external resource during offline verification");
        File.WriteAllText(Path.Combine(root, "result.json"), JsonSerializer.Serialize(new
        {
            Passed = true, Interface = "Current React workbench embedded in WebView2; same assets as development mode",
            WindowChrome = "Integrated dark caption; native white frame removed; maximize and restore passed",
            Configuration = "In-memory plan, apply, backup and restore passed through packaged loopback API",
            Boundaries = "Host, Origin, CSRF, content type, body size, command fields and update reservation passed",
            LocalAssets = new { serviceIcons = iconCount, fonts = 5, countryDatabases = 2, groupsDecoded = "reference, ai, common", externalRequests = externalSmokeRequests },
            LiveConnectivity = liveCheck,
            Scope = liveConnectivitySmoke ? "Explicit real website GET test; no real configuration writes or update installation" : "No real network probes, configuration writes or update installation"
        }));
        Close();
    }
}
