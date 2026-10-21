using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows.Interop;
using System.Windows.Threading;
using BehindRose.Windows;
using Microsoft.Web.WebView2.Core;

namespace BehindRose.Desktop;

/// <summary>
/// Read the documented public API as a top-level browser document. IPPure does
/// not grant CORS to local pages. This is an isolated, ordinary WebView2 with no
/// native message bridge or security overrides, never the user's browser profile.
/// </summary>
public static class IpPureBrowserClient
{
    public static Task<byte[]> QueryAsync(int proxyPort, CancellationToken token)
    {
        if (proxyPort is < 0 or > 65535) throw new InvalidDataException("检测代理端口无效。");
        token.ThrowIfCancellationRequested();
        var result = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            var dispatcher = Dispatcher.CurrentDispatcher;
            SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext(dispatcher));
            HwndSource? window = null; CoreWebView2Controller? controller = null;
            CoreWebView2Environment? environment = null;
            var profileRoot = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "BehindRose-IPPure"));
            var profile = Path.GetFullPath(Path.Combine(profileRoot, Guid.NewGuid().ToString("N")));
            bool finished = false, initializing = true; CancellationTokenRegistration cancellation = default;
            void Finish(byte[]? data, Exception? error)
            {
                if (finished) return; finished = true;
                cancellation.Dispose();
                try { controller?.CoreWebView2.Stop(); controller?.Close(); } catch { }
                try { window?.Dispose(); } catch { }
                // Cleanup only our randomly named profile, after WebView2 releases it.
                _ = Task.Run(async () =>
                {
                    if (!profile.StartsWith(profileRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return;
                    for (int attempt = 0; attempt < 5; attempt++)
                    {
                        try { if (Directory.Exists(profile)) Directory.Delete(profile, true); return; }
                        catch (IOException) { await Task.Delay(1000); }
                        catch (UnauthorizedAccessException) { await Task.Delay(1000); }
                    }
                });
                if (error is OperationCanceledException) result.TrySetCanceled(token);
                else if (error != null) result.TrySetException(error);
                else result.TrySetResult(data!);
                dispatcher.BeginInvokeShutdown(DispatcherPriority.Background);
            }
            cancellation = token.Register(() => dispatcher.BeginInvoke(() =>
            {
                // Settle the caller on time, but let an in-progress COM creation
                // return before closing its controller and profile on this STA.
                if (initializing) result.TrySetCanceled(token);
                else Finish(null, new OperationCanceledException(token));
            }));
            dispatcher.BeginInvoke(async () =>
            {
                try
                {
                    token.ThrowIfCancellationRequested();
                    // No WS_VISIBLE: this window never appears or takes focus.
                    window = new HwndSource(new HwndSourceParameters("BehindRose IPPure query") { Width = 1, Height = 1, WindowStyle = unchecked((int)0x80000000) });
                    var options = new CoreWebView2EnvironmentOptions();
                    if (proxyPort > 0) options.AdditionalBrowserArguments = $"--proxy-server=http://127.0.0.1:{proxyPort}";
                    environment = await CoreWebView2Environment.CreateAsync(null, profile, options);
                    token.ThrowIfCancellationRequested();
                    controller = await environment.CreateCoreWebView2ControllerAsync(window.Handle);
                    token.ThrowIfCancellationRequested();
                    initializing = false;
                    controller.IsVisible = false; controller.Bounds = new(0, 0, 1024, 768);
                    var core = controller.CoreWebView2;
                    core.Settings.IsWebMessageEnabled = false;
                    core.Settings.AreDevToolsEnabled = false;
                    core.Settings.AreDefaultContextMenusEnabled = false;
                    core.Settings.AreHostObjectsAllowed = false;
                    core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
                    core.NewWindowRequested += (_, args) => args.Handled = true;
                    core.DownloadStarting += (_, args) => args.Cancel = true;
                    core.BasicAuthenticationRequested += (_, args) => args.Cancel = true;
                    core.NavigationStarting += (_, args) =>
                    {
                        if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) && uri.Scheme == "https" && uri.Host == "my.ippure.com" && uri.IsDefaultPort && uri.AbsolutePath == "/v1/info" && string.IsNullOrEmpty(uri.UserInfo)) return;
                        args.Cancel = true; Finish(null, new InvalidDataException("IPPure 接口跳转到了非预期地址，本次未取得结果。"));
                    };
                    core.NavigationCompleted += async (_, args) =>
                    {
                        if (finished) return;
                        try
                        {
                            if (!args.IsSuccess) throw new InvalidDataException("无法通过所选网络打开 IPPure 接口，本次未取得结果。");
                            if (args.HttpStatusCode is < 200 or >= 300) throw new InvalidDataException(args.HttpStatusCode == 429 ? "IPPure 请求过于频繁，请稍后重试。" : args.HttpStatusCode == 403 ? "IPPure 要求网站验证，本次未取得结果。" : $"IPPure 服务返回 HTTP {args.HttpStatusCode}。");
                            string content = JsonSerializer.Deserialize<string>(await core.ExecuteScriptAsync("document.body ? document.body.innerText : ''")) ?? "";
                            token.ThrowIfCancellationRequested();
                            if (!content.TrimStart().StartsWith('{')) throw new InvalidDataException("IPPure 返回了验证页面或非 JSON 内容，本次未取得结果。");
                            byte[] bytes = Encoding.UTF8.GetBytes(content);
                            if (bytes.Length > IpPureRunner.MaxResponseBytes) throw new InvalidDataException("IPPure 响应超出大小限制。");
                            Finish(bytes, null);
                        }
                        catch (Exception error) { Finish(null, error); }
                    };
                    core.Navigate(IpPureRunner.Endpoint);
                }
                catch (Exception error) { initializing = false; Finish(null, error is OperationCanceledException or InvalidDataException ? error : new InvalidDataException("无法启动 IPPure 浏览器查询，请确认 WebView2 Runtime 已安装。", error)); }
            });
            Dispatcher.Run();
            GC.KeepAlive(environment);
        }) { IsBackground = true, Name = "IPPure public API browser" };
        thread.SetApartmentState(ApartmentState.STA); thread.Start(); return result.Task;
    }
}
