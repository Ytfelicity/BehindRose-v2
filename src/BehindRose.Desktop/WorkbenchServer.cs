using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace BehindRose.Desktop;

// The packaged application serves the same workbench assets as dev-server.mjs.
// Kestrel binds an OS-selected IPv4 loopback port, without URL ACLs or Node.js.
internal sealed class WorkbenchServer(LocalApp local) : IAsyncDisposable
{
    private WebApplication? server;
    private readonly string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public string Url { get; private set; } = "";
    public Func<object> UpdateStatus { get; set; } = () => new { status = "尚未检查更新" };
    public Action? CheckUpdates { get; set; }
    private const string Csp = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'self'; frame-ancestors 'none'";
    private static readonly Dictionary<string, string> Assets = new()
    {
        ["/"] = "workbench/index.html", ["/index.html"] = "workbench/index.html",
        ["/workbench.js"] = "workbench/workbench.js", ["/workbench.css"] = "workbench/workbench.css",
        ["/beui.js"] = "workbench/beui.js", ["/console.css"] = "workbench/console.css",
        ["/claude-handbook.html"] = "workbench/claude-handbook.html",
        ["/claude-handbook.css"] = "workbench/claude-handbook.css",
        ["/claude-handbook-ui.js"] = "workbench/claude-handbook-ui.js",
        ["/claude-windows-handbook.zip"] = "workbench/claude-windows-handbook.zip",
        ["/claude-guide.md"] = "workbench/claude-guide.md",
        ["/claude-handbook-scripts/Launch-Claude.ps1"] = "workbench/claude-handbook-scripts/Launch-Claude.ps1",
        ["/claude-handbook-scripts/Backup-ClaudeLocal.ps1"] = "workbench/claude-handbook-scripts/Backup-ClaudeLocal.ps1",
        ["/claude-handbook-scripts/Test-ClaudeNetwork.ps1"] = "workbench/claude-handbook-scripts/Test-ClaudeNetwork.ps1",
        ["/support-qr.png"] = "workbench/support-qr.png", ["/brand-logo.png"] = "workbench/brand-logo.png",
        ["/network"] = "diagnostics/index.html", ["/network-ui.js"] = "diagnostics/network-ui.js",
        ["/beui.css"] = "diagnostics/beui.css", ["/diagnostics.css"] = "diagnostics/diagnostics.css",
        ["/network-console.css"] = "diagnostics/network-console.css", ["/diagnostics.js"] = "diagnostics/diagnostics.js",
        ["/diagnostics-core.js"] = "diagnostics/diagnostics-core.js", ["/flag-codes.js"] = "diagnostics/flag-codes.js",
        ["/country-lookup.js"] = "diagnostics/country-lookup.js", ["/icons.svg"] = "diagnostics/icons.svg",
        ["/country-db/country4.bin"] = "diagnostics/country-db/country4.bin",
        ["/country-db/country6.bin"] = "diagnostics/country-db/country6.bin", ["/avatar.png"] = "avatar-source.png"
    };

    public async Task StartAsync()
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions
        { Args = [], EnvironmentName = "Production", ContentRootPath = AppContext.BaseDirectory });
        builder.Configuration.Sources.Clear();
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options =>
        {
            // The API enforces 4 KiB below; allow a bounded drain so that a
            // just-oversized request receives a complete JSON 413 response.
            options.AddServerHeader = false; options.Limits.MaxRequestBodySize = 16 * 1024;
            options.Listen(IPAddress.Loopback, 0);
        });
        server = builder.Build(); server.Run(HandleAsync);
        await server.StartAsync();
        Url = server.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
        if (!Uri.TryCreate(Url, UriKind.Absolute, out var uri) || uri.Host != "127.0.0.1") throw new IOException("本机工作台绑定失败。");
    }

    private async Task HandleAsync(HttpContext context)
    {
        var request = context.Request; var response = context.Response;
        response.Headers.CacheControl = "no-store";
        response.Headers["X-Content-Type-Options"] = "nosniff";
        response.Headers["Referrer-Policy"] = "no-referrer";
        if (Url.Length == 0 || request.Host.Value != new Uri(Url).Authority)
        { await Send(context, 403, new { error = "只接受本机工作台请求。" }); return; }
        string path = request.Path.Value ?? "/";
        if (path.StartsWith("/api/", StringComparison.Ordinal)) { await ApiAsync(context, path); return; }
        if (!HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method)) { response.StatusCode = 405; return; }
        Assets.TryGetValue(path, out var asset);
        if (Regex.IsMatch(path, @"^/flags/[a-z]{2}\.svg$|^/service-icons/[a-z-]+\.svg$|^/fonts/(figtree-latin-(400|500|600|700)-normal|eb-garamond-latin-400-normal)\.woff2$")) asset = "diagnostics" + path;
        if (Regex.IsMatch(path, @"^/claude-handbook-images/[0-9]{2}-[a-z0-9-]+\.(jpg|png)$")) asset = "workbench" + path;
        if (asset == null) { response.StatusCode = 404; return; }
        byte[] bytes;
        try { bytes = AppAssets.Read(asset); }
        catch (IOException) { response.StatusCode = 404; return; }
        response.Headers.ContentSecurityPolicy = path == "/network"
            ? Csp.Replace("connect-src 'self';", "connect-src 'self' https: stun:;").Replace("frame-src 'self'", "frame-src 'none'").Replace("frame-ancestors 'none'", "frame-ancestors 'self'")
            : path == "/claude-handbook.html" ? Csp.Replace("img-src 'self';", "img-src 'self' data:;") : Csp;
        response.ContentType = Path.GetExtension(asset) switch
        {
            ".html" => "text/html; charset=utf-8", ".js" => "text/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8", ".svg" => "image/svg+xml", ".woff2" => "font/woff2",
            ".bin" => "application/octet-stream", ".zip" => "application/zip", ".md" => "text/markdown; charset=utf-8",
            ".ps1" => "text/plain; charset=utf-8",
            ".jpg" => "image/jpeg", _ => "image/png"
        };
        if (ClaudeHandbookResources.IsDownloadPath(path)) response.Headers.ContentDisposition = "attachment; filename=\"" + Path.GetFileName(path) + "\"";
        response.ContentLength = bytes.Length;
        if (!HttpMethods.IsHead(request.Method)) await response.Body.WriteAsync(bytes, context.RequestAborted);
    }

    private async Task ApiAsync(HttpContext context, string path)
    {
        var request = context.Request;
        string origin = request.Headers.Origin.ToString();
        if ((origin.Length != 0 && origin != Url) || request.Headers["Sec-Fetch-Site"] == "cross-site")
        { await Send(context, 403, new { error = "只接受本机页面的请求。" }); return; }
        if (path == "/api/session" && HttpMethods.IsGet(request.Method))
        { await Send(context, 200, new { token, ready = true, desktop = true, version = MainWindow.AppVersion }); return; }
        if (path == "/api/update-status" && HttpMethods.IsGet(request.Method))
        { await Send(context, 200, UpdateStatus()); return; }
        if (!HttpMethods.IsPost(request.Method) || path is not ("/api/local" or "/api/update-check"))
        { await Send(context, 405, new { error = "不支持的请求。" }); return; }
        string supplied = request.Headers["X-BehindRose-Token"].ToString();
        if (origin != Url || !Regex.IsMatch(supplied, "^[a-f0-9]{64}$")
            || !CryptographicOperations.FixedTimeEquals(System.Text.Encoding.ASCII.GetBytes(supplied), System.Text.Encoding.ASCII.GetBytes(token)))
        { await Send(context, 403, new { error = "页面会话已失效，请刷新后重试。" }); return; }
        if (request.ContentType != "application/json")
        { await Send(context, 415, new { error = "请求格式不正确。" }); return; }
        try
        {
            if (request.ContentLength > 4096) { await Send(context, 413, new { error = "请求过大。" }); return; }
            byte[] buffer = new byte[4097]; int count = 0, read;
            while ((read = await request.Body.ReadAsync(buffer.AsMemory(count), context.RequestAborted)) != 0)
            { count += read; if (count > 4096) { await Send(context, 413, new { error = "请求过大。" }); return; } }
            string body = System.Text.Encoding.UTF8.GetString(buffer, 0, count);
            if (path == "/api/update-check")
            {
                using var payload = JsonDocument.Parse(body);
                if (payload.RootElement.ValueKind != JsonValueKind.Object || payload.RootElement.EnumerateObject().Any()) throw new InvalidDataException("操作参数无效。");
                CheckUpdates?.Invoke(); await Send(context, 200, new { data = UpdateStatus() }); return;
            }
            var command = WorkbenchRequest.Parse(body, false);
            object data = await Task.Run(() => local.Handle(command), context.RequestAborted);
            await Send(context, 200, new { data });
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == 413) { await Send(context, 413, new { error = "请求过大。" }); }
        catch (Exception ex) when (ex is JsonException or InvalidDataException or ArgumentException)
        { await Send(context, 400, new { error = "操作参数无效或格式不正确。" }); }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested) { }
        catch (Exception ex) { await Send(context, 409, new { error = LocalApp.Message(ex) }); }
    }
    private static Task Send(HttpContext context, int status, object value)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(value, Json);
        context.Response.StatusCode = status; context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.ContentLength = bytes.Length;
        return context.Response.Body.WriteAsync(bytes, context.RequestAborted).AsTask();
    }
    public async ValueTask DisposeAsync()
    {
        if (server != null) { await server.StopAsync(); await server.DisposeAsync(); }
        await local.FinishAsync();
    }
}
