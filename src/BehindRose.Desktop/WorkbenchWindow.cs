using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace BehindRose.Desktop;

internal sealed partial class WorkbenchWindow : Window
{
    private readonly WebView2 browser = new();
    private readonly LocalApp local;
    private readonly WorkbenchServer server;
    private readonly WorkbenchUpdater updater;
    private readonly bool smoke;
    private readonly bool liveConnectivitySmoke;
    private bool allowLiveConnectivity;
    private readonly List<string> liveRequests = [];
    private readonly List<object> liveResponses = [];
    private int externalSmokeRequests;
    private bool disposed;
    public WorkbenchWindow(bool demo, bool smoke, bool updateTest)
    {
        this.smoke = smoke; liveConnectivitySmoke = smoke && Environment.GetCommandLineArgs().Contains("--connectivity-check");
        local = new LocalApp(demo); server = new WorkbenchServer(local);
        Title = "Rose in my wake · 网络助手 " + MainWindow.AppVersion + (updateTest ? " · 更新测试" : demo ? " · 演示模式" : "");
        Width = 1280; Height = 850; MinWidth = 760; MinHeight = 600;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = new SolidColorBrush(Color.FromRgb(10, 10, 10));
        Icon = BitmapFrame.Create(new Uri("pack://application:,,,/Assets/avatar.ico"));
        ConfigureChrome();
        updater = new(this, local, StopSamplingAsync, demo, updateTest); updater.Initialize();
        server.UpdateStatus = updater.Snapshot;
        server.CheckUpdates = () => Dispatcher.BeginInvoke(() => { _ = updater.CheckAsync(false); });
        Loaded += async (_, _) => await InitializeAsync();
        Closing += OnClosing;
        Closed += (_, _) => { disposed = true; browser.Dispose(); _ = server.DisposeAsync(); };
    }
    private async Task InitializeAsync()
    {
        try
        {
            await server.StartAsync();
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BehindRose", "NetworkAssistant-v2", smoke ? "WorkbenchWebView-Smoke" : "WorkbenchWebView");
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            if (disposed) return;
            await browser.EnsureCoreWebView2Async(environment);
            var core = browser.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false; core.Settings.IsWebMessageEnabled = false;
            core.Settings.AreDevToolsEnabled = DevelopmentMode.Enabled; core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = DevelopmentMode.Enabled;
            core.PermissionRequested += (_, e) => { e.State = CoreWebView2PermissionState.Deny; e.Handled = true; };
            core.DownloadStarting += (_, e) => e.Cancel = true;
            if (smoke)
            {
                core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
                core.WebResourceRequested += (_, e) =>
                {
                    if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" && !IsLocal(e.Request.Uri))
                    {
                        if (allowLiveConnectivity && uri.Scheme == "https" && e.Request.Method == "GET")
                        { liveRequests.Add(uri.GetLeftPart(UriPartial.Path)); return; }
                        externalSmokeRequests++;
                        e.Response = environment.CreateWebResourceResponse(null, 403, "Offline UI verification", "");
                    }
                };
                core.WebResourceResponseReceived += (_, e) =>
                {
                    if (allowLiveConnectivity && Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) && uri.Scheme == "https")
                        liveResponses.Add(new { url = uri.GetLeftPart(UriPartial.Path), status = e.Response.StatusCode });
                };
            }
            core.NavigationStarting += (_, e) =>
            {
                if (IsLocal(e.Uri) && new Uri(e.Uri).AbsolutePath is "/" or "/index.html") return;
                e.Cancel = true; if (e.IsUserInitiated) OpenLink(e.Uri);
            };
            core.FrameNavigationStarting += (_, e) => e.Cancel = !IsLocal(e.Uri) || new Uri(e.Uri).AbsolutePath != "/network";
            core.NewWindowRequested += (_, e) => { e.Handled = true; if (e.IsUserInitiated) OpenLink(e.Uri); };
            var loaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            core.NavigationCompleted += (_, e) => { if (e.IsSuccess) loaded.TrySetResult(); else loaded.TrySetException(new IOException("工作台页面未能加载。")); };
            core.Navigate(server.Url + "/");
            await loaded.Task.WaitAsync(TimeSpan.FromSeconds(20));
            if (smoke) await SmokeAsync(); else await updater.CheckAsync(true);
        }
        catch (Exception ex)
        {
            if (smoke)
            {
                Directory.CreateDirectory("ui-smoke");
                File.WriteAllText("ui-smoke/result.json", JsonSerializer.Serialize(new { Passed = false, Error = ex.ToString() }));
                Application.Current.Shutdown(1); return;
            }
            MessageBox.Show(this, "工作台未能启动：" + ex.Message + "\n请确认已安装 Microsoft Edge WebView2 Runtime。", "启动未完成");
        }
    }
    private bool IsLocal(string address) => Uri.TryCreate(address, UriKind.Absolute, out var uri)
        && uri.GetLeftPart(UriPartial.Authority) == server.Url && uri.UserInfo.Length == 0;
    private static void OpenLink(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo.Length != 0) return;
        try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch { }
    }
    private Task StopSamplingAsync() => browser.CoreWebView2 == null ? Task.CompletedTask : browser.CoreWebView2.ExecuteScriptAsync(
        "(() => { const frame = document.getElementById('network-frame'); frame?.contentWindow?.RoseConnectivity?.stop(); frame?.contentDocument?.getElementById('stop')?.click(); })()");
    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (!local.IsBusy) return;
        e.Cancel = true;
        MessageBox.Show(this, "正在处理配置或更新，请等待完成或取消更新后再关闭。", "操作进行中");
    }
}
