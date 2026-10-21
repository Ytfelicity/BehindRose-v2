using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
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
        async Task WaitFor(string condition)
        {
            for (int i = 0; i < 120; i++)
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
        await WaitFor("document.body.classList.contains('dashboard4') && document.getElementById('network-frame')?.contentWindow?.RoseCheck && document.getElementById('dev-state')?.textContent.includes('桌面')");
        await Capture("workbench-network.png");
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
        File.WriteAllText(Path.Combine(root, "result.json"), JsonSerializer.Serialize(new
        {
            Passed = true, Interface = "Current React workbench embedded in WebView2; same assets as development mode",
            Configuration = "In-memory plan, apply, backup and restore passed through packaged loopback API",
            Boundaries = "Host, Origin, CSRF, content type, body size, command fields and update reservation passed",
            Scope = "No real network probes, configuration writes or update installation"
        }));
        Close();
    }
}
