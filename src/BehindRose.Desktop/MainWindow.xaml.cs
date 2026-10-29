using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using BehindRose.Core;
using BehindRose.Windows;
using Microsoft.Win32;

namespace BehindRose.Desktop;

public partial class MainWindow : Window
{
    private readonly bool demo, smoke, updateTest;
    private readonly IStateStore state;
    private readonly IJournalStore journals;
    private readonly ProtectedJournalStore protectedJournals = new();
    private HostInfo host = new(null, "未知", false, false, "");
    private RepairPlan? plan;
    private bool busy, initialized, autoProbe, pendingAutoProbe;
    private string networkSummary = "尚未采样", lastOperation = "尚未执行修改", lastOperationState = "none";
    private NetworkView? network;
    private int theme;
    private static string PreferencesPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BehindRose", "NetworkAssistant-v2", "preferences.json");
    private sealed record Preferences(int Theme, bool AutoProbe);
    public MainWindow(bool demoMode, bool smokeMode, bool updateTestMode = false)
    {
        demo = demoMode; smoke = smokeMode; updateTest = updateTestMode;
        state = demo ? new DemoState() : new WindowsState(); journals = demo ? new DemoJournals() : protectedJournals;
        InitializeComponent();
        VersionLabel.Text = AppVersion;
        AboutVersion.Text = "Rose in my wake · 网络助手 " + AppVersion;
        InitializeUpdates();
        if (demo) { Title += " · 演示模式"; VersionLabel.Text = "演示模式 · 不改系统"; }
        if (updateTest) { Title += " · 更新测试"; VersionLabel.Text = "更新测试 · " + AppVersion; }
        if (DevelopmentMode.Enabled)
        {
            Title += " · 开发模式";
            VersionLabel.Text = demo ? "开发模式 · 演示数据" : "开发模式 · 从源码加载";
        }
        if (!demo)
            try
            {
                if (File.Exists(PreferencesPath))
                { var p = JsonSerializer.Deserialize<Preferences>(SafeFiles.Read(PreferencesPath)); if (p != null) { theme = Math.Clamp(p.Theme, 0, 2); autoProbe = p.AutoProbe; } }
            }
            catch (Exception ex) { StatusText.Text = "偏好设置未载入，已使用默认值：" + ex.Message; }
        ThemePicker.SelectedIndex = theme; AutoProbeOption.IsChecked = autoProbe; initialized = true;
        SetTheme();
        Loaded += async (_, _) => { await RefreshLocal(); await Navigate("overview"); if (smoke) await SmokeTest(); else if ((!demo || updateTest) && !DevelopmentMode.Enabled) await CheckUpdatesAsync(true); };
        SystemEvents.UserPreferenceChanged += SystemPreferenceChanged;
        Closing += OnClosing;
        Closed += (_, _) => { SystemEvents.UserPreferenceChanged -= SystemPreferenceChanged; network?.Dispose(); };
    }

    private async Task RefreshLocal()
    {
        try
        {
            host = demo ? new("demo", "2.5.2", false, true, "示例配置") : await Task.Run(HostDiscovery.Find);
            var findings = await Task.Run(() => RepairPlanner.Inspect(state));
            var all = new List<Finding> { new("Clash Verge Rev", host.Note, host.Version) };
            all.AddRange(findings.Where(x => !x.Title.EndsWith(" DNS", StringComparison.Ordinal)));
            var browserFindings = findings.Where(x => x.Title.EndsWith(" DNS", StringComparison.Ordinal)).ToArray();
            all.Add(new("浏览器 DNS", string.Join(" · ", browserFindings.Select(x => x.Title.Replace(" DNS", "") + "：" + x.State)) + "。将与系统接管统一生成预览。", browserFindings.All(x => x.State == "已配置") ? "已配置" : "按需检查"));
            all.Add(RepairPlanner.InspectClashIpv6(state));
            all.Add(SingMixProfile.Inspect(state));
            all.Add(new("实际网络出口", networkSummary, networkSummary == "尚未采样" ? "未检测" : "查看详情"));
            FindingsList.ItemsSource = all;
            OverviewTitle.Text = demo ? "演示环境 · 可体验完整流程" : findings.Any(x => x.State == "无法自动修改") ? "有配置需要先处理" : !host.Compatible ? "请检查 Clash 配置" : "本地体检已完成";
            HostSummary.Text = demo ? "下方是内存中的示例配置。应用和恢复不会改动你的电脑；演示模式不联网。" : (host.Running ? "Clash 正在运行。修改其配置前，请从托盘退出客户端。" : "可以查看建议。浏览器保持打开，相关策略稍后重启生效。");
            ReviewButton.IsEnabled = host.Compatible;
        }
        catch (Exception ex) { OverviewTitle.Text = "本地体检未完成"; HostSummary.Text = ex.Message; }
    }
    private async void Refresh_Click(object sender, RoutedEventArgs e) => await RefreshLocal();
    private async void Navigate_Click(object sender, RoutedEventArgs e)
    {
        if (busy) return;
        await Navigate((string)((Button)sender).Tag);
    }
    private async Task Navigate(string page)
    {
        OverviewPage.Visibility = page == "overview" ? Visibility.Visible : Visibility.Collapsed;
        PlanPage.Visibility = page == "plan" ? Visibility.Visible : Visibility.Collapsed;
        NetworkPage.Visibility = page == "network" ? Visibility.Visible : Visibility.Collapsed;
        BackupsPage.Visibility = page == "backups" ? Visibility.Visible : Visibility.Collapsed;
        SettingsPage.Visibility = page == "settings" ? Visibility.Visible : Visibility.Collapsed;
        foreach (Button button in Navigation.Children)
            button.SetResourceReference(BackgroundProperty, (string)button.Tag == (page == "plan" ? "overview" : page) ? "SurfaceBrush" : "SidebarBrush");
        if (page == "backups") RefreshBackups();
        if (page == "network") await EnsureNetwork();
    }
    private async void Review_Click(object sender, RoutedEventArgs e)
    {
        BuildPreview(); await Navigate("plan");
    }
    private void BuildPreview()
    {
        ConfirmOption.IsChecked = false; ApplyButton.IsEnabled = false; plan = null; ChangesList.ItemsSource = null;
        try
        {
            var candidate = RepairPlanner.Build(state, RepairPlanner.OneClickOptions);
            if (!demo) foreach (var change in candidate.Changes) WindowsState.EnsurePolicyUnmanaged(change.Key);
            plan = candidate; ChangesList.ItemsSource = candidate.Changes;
            PlanSummary.Text = candidate.Changes.Count == 0 ? "所选配置已符合目标，无需写入。可返回体检检查实际网络出口。" : $"将修改 {candidate.Changes.Count} 个配置或策略目标。" + (candidate.NeedsClashExit ? "请先从系统托盘退出 Clash，再确认应用。" : "仅修改所选浏览器策略，无需退出 Clash。");
        }
        catch (Exception ex) { PlanSummary.Text = "无法生成修改计划：" + ex.Message; }
    }
    private void Confirm_Click(object sender, RoutedEventArgs e) => ApplyButton.IsEnabled = ConfirmOption.IsChecked == true && plan?.Changes.Count > 0;
    private async void Apply_Click(object sender, RoutedEventArgs e)
    {
        if (busy || plan == null || ConfirmOption.IsChecked != true) return;
        await PerformOperation("apply");
    }
    private async Task PerformOperation(string action, string? backupId = null)
    {
        if (busy) return;
        if (!demo && action == "apply" && plan!.NeedsClashExit && HostDiscovery.IsRunning())
        { MessageBox.Show(this, "请先在系统托盘右键 Clash Verge，选择退出，然后再次应用。程序不会强制结束应用。", "请先退出 Clash"); return; }
        busy = true; Navigation.IsEnabled = false; BusyOverlay.Visibility = Visibility.Visible;
        ProgressText.Text = demo ? "正在处理演示数据……" : "正在申请管理员权限……";
        network?.StopAndInvalidate(); networkSummary = "配置操作后需要重新采样";
        OperationResult result;
        try
        {
            if (demo)
            {
                var engine = new RepairEngine(state, journals);
                result = await Task.Run(() => action == "apply" ? engine.Apply(plan!, text => Dispatcher.Invoke(() => ProgressText.Text = text)) : engine.Restore(backupId!, text => Dispatcher.Invoke(() => ProgressText.Text = text)));
            }
            else
            {
                string id = Guid.NewGuid().ToString("N");
                var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
                using var self = Process.GetCurrentProcess();
                var parts = new[] { "--worker", action, WindowsState.UserSid, id, self.SessionId.ToString(), action == "apply" ? ((int)plan!.Options).ToString() : backupId!, action == "apply" ? plan!.Fingerprint : "restore" };
                // Every token is an enum, SID, GUID, integer, or hash; never a path or shell fragment.
                start.Arguments = string.Join(" ", parts);
                using var process = Process.Start(start) ?? throw new IOException("未能启动配置进程。");
                var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
                timer.Tick += (_, _) => { try { var report = protectedJournals.ReadReport(id); if (report != null) ProgressText.Text = report.Message; } catch { } };
                timer.Start();
                try { await process.WaitForExitAsync(); } finally { timer.Stop(); }
                result = protectedJournals.ReadReport(id)?.Result ?? (process.ExitCode == 90
                    ? new(false, "not-started", "授权账户或会话不匹配，本次操作未开始。请使用当前用户的管理员授权。")
                    : new(false, "unknown", "配置进程已退出，但没有完整结果。请检查备份记录，不要将此次操作视为成功。"));
            }
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223) { result = new(false, "cancelled", "你取消了管理员授权，本次没有开始修改。"); }
        catch (Exception ex) { result = new(false, "failed", "操作未完成：" + ex.Message); }
        finally { busy = false; Navigation.IsEnabled = true; BusyOverlay.Visibility = Visibility.Collapsed; }
        lastOperation = result.Message; lastOperationState = result.State; ResultBanner.Visibility = Visibility.Visible;
        ResultTitle.Text = result.Success ? action == "restore" ? "恢复完成，等待生效与复检" : "所选配置已写入，等待生效与复检" : result.State == "rolled-back" ? "操作失败，本次修改已撤销" : "操作未完成";
        ResultDetails.Text = result.Message; StatusText.Text = (demo ? "演示模式 · " : "") + result.Message;
        pendingAutoProbe = result.Success && autoProbe && !demo;
        await RefreshLocal(); await Navigate("overview");
        if (pendingAutoProbe && !HostDiscovery.IsRunning() && host.Executable != null)
            ResultDetails.Text += " 已启用自动复检：重新打开 Clash 后将开始联网采样。";
        else if (pendingAutoProbe) { pendingAutoProbe = false; await StartNetwork(); }
        plan = null;
    }
    private async void ReopenClash_Click(object sender, RoutedEventArgs e)
    {
        if (demo) { StatusText.Text = "演示模式不会启动真实客户端。"; return; }
        try
        {
            host = await Task.Run(HostDiscovery.Find);
            if (host.Executable == null) { MessageBox.Show(this, "未识别到 Clash 安装路径，请手动打开客户端后刷新。", "打开 Clash"); return; }
            if (!host.Running) Process.Start(new ProcessStartInfo(host.Executable) { UseShellExecute = true });
            StatusText.Text = "已请求打开 Clash。请等待客户端启动并连接。";
            if (pendingAutoProbe)
            {
                pendingAutoProbe = false;
                // Allow the host to start, then explicitly label sampling as that time's observation.
                await Task.Delay(4000); await StartNetwork();
            }
            await RefreshLocal();
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "打开客户端失败"); }
    }
    private async Task EnsureNetwork()
    {
        if (demo) { NetworkLoading.Text = "演示模式不发起网络请求。请普通启动程序使用真实检测。"; return; }
        if (network != null) return;
        try
        {
            network = new NetworkView();
            network.SummaryChanged += summary => { networkSummary = summary; StatusText.Text = "网络采样：" + summary; };
            NetworkContainer.Children.Add(network.Browser);
            await network.Initialize(IsLight()); NetworkLoading.Visibility = Visibility.Collapsed;
        }
        catch (Exception ex)
        {
            network?.Dispose(); network = null; NetworkContainer.Children.Clear(); NetworkContainer.Children.Add(NetworkLoading);
            NetworkLoading.Visibility = Visibility.Visible; NetworkLoading.Text = "检测页面未能启动：" + ex.Message + "\n请安装 Microsoft Edge WebView2 Runtime 后重新进入此页。";
        }
    }
    private async Task StartNetwork()
    {
        await Navigate("network"); network?.Start();
    }
    private sealed record BackupRow(string Id, string TimeText, string StateText, string Scope, bool CanRestore);
    private void RefreshBackups()
    {
        try
        {
            var list = journals.ListForDisplay();
            BackupsList.ItemsSource = list.Select(j => new BackupRow(j.Id, j.CreatedAt?.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss") ?? "时间无法读取",
                j.RestoreBlockedReason != null ? "恢复已暂停" : StateText(j.State),
                j.Error ?? (j.Kind == "restore" ? "恢复前快照 · " : "修复前备份 · ") + string.Join("、", j.Titles) + (j.RestoreBlockedReason != null ? " · " + j.RestoreBlockedReason : ""), j.CanRestore)).ToArray();
            int unreadable = list.Count(j => j.State == "unreadable");
            BackupMessage.Text = unreadable != 0 ? $"共 {list.Count} 条记录，其中 {unreadable} 条无法读取；仍可查看其他记录，配置修改与恢复已暂停。"
                : list.Count == 0 ? "还没有 v2 备份。每次实际修改前都会自动创建。" : $"共 {list.Count} 条记录，按时间从新到旧排列。";
        }
        catch (Exception ex) { BackupsList.ItemsSource = null; BackupMessage.Text = "备份读取失败，请保留目录供排查：" + ex.Message; }
    }
    private static string StateText(string state) => state switch { "applied" => "可恢复", "restored" => "已恢复", "rolled-back" => "已回滚", "applying" => "操作中断", "rollback-failed" => "需要恢复", "unreadable" => "无法读取", _ => "仅备份，未修改" };
    private async void Restore_Click(object sender, RoutedEventArgs e)
    {
        if (busy) return;
        var id = (string)((Button)sender).Tag;
        try
        {
            var journal = journals.Load(id);
            var message = "将恢复以下项目：\n\n" + string.Join("\n", journal.Changes.Select(x => "• " + x.Title)) + "\n\n恢复前会保存当前状态。如发现后续修改，将停止恢复。涉及 Clash 配置时，请先从托盘退出客户端。";
            if (MessageBox.Show(this, message, "确认恢复范围", MessageBoxButton.OKCancel, MessageBoxImage.Information) != MessageBoxResult.OK) return;
            await PerformOperation("restore", id);
        }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "恢复未开始"); }
    }
    private void RefreshBackups_Click(object sender, RoutedEventArgs e) => RefreshBackups();
    private void OpenBackups_Click(object sender, RoutedEventArgs e)
    {
        if (demo) { MessageBox.Show(this, "演示备份只保存在内存中。", "演示模式"); return; }
        OpenDirectory(protectedJournals.BackupRoot);
    }
    private void OpenDirectory(string path)
    {
        if (!Directory.Exists(path)) { MessageBox.Show(this, "目录尚未创建。", "打开目录"); return; }
        try { Process.Start(new ProcessStartInfo("explorer.exe") { Arguments = "\"" + path + "\"", UseShellExecute = true }); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "无法打开目录"); }
    }
    private void OpenClashPage_Click(object sender, RoutedEventArgs e) => OpenUrl("https://github.com/clash-verge-rev/clash-verge-rev/releases");
    private void OpenUrl(string url) { try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch (Exception ex) { MessageBox.Show(this, ex.Message, "无法打开链接"); } }
    private void Licenses_Click(object sender, RoutedEventArgs e) => OpenDirectory(Path.Combine(AppContext.BaseDirectory, "licenses"));
    private void AutoProbe_Click(object sender, RoutedEventArgs e) { autoProbe = AutoProbeOption.IsChecked == true; if (!autoProbe) pendingAutoProbe = false; SavePreferences(); }
    private void SystemPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        if (!Dispatcher.HasShutdownStarted) Dispatcher.InvokeAsync(() => { if (theme == 0) SetTheme(); });
    }
    private void Theme_Changed(object sender, SelectionChangedEventArgs e) { if (!initialized) return; theme = ThemePicker.SelectedIndex; SetTheme(); SavePreferences(); }
    private bool IsLight()
    {
        if (theme != 0) return theme == 1;
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is not int mode || mode != 0;
    }
    private void SetTheme()
    {
        bool light = IsLight();
        var colors = new Dictionary<string, string>
        {
            ["BackgroundBrush"] = light ? "#F8F9FB" : "#151821", ["SurfaceBrush"] = light ? "#FFFFFF" : "#1D212C",
            ["SidebarBrush"] = light ? "#F0F2F5" : "#11151D", ["TextBrush"] = light ? "#202633" : "#EDF0F7",
            ["MutedBrush"] = light ? "#616A79" : "#A8B1C1", ["LineBrush"] = light ? "#E1E5EC" : "#323A49",
            ["AccentBrush"] = light ? "#B02C53" : "#F395AF", ["AccentTextBrush"] = light ? "#FFFFFF" : "#251119",
            ["TintBrush"] = light ? "#FAEAF0" : "#392531"
        };
        foreach (var (key, color) in colors) Application.Current.Resources[key] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
        network?.SetTheme(light);
    }
    private void SavePreferences()
    {
        if (demo) return;
        try { SafeFiles.CheckPath(PreferencesPath); Directory.CreateDirectory(Path.GetDirectoryName(PreferencesPath)!); SafeFiles.AtomicWrite(PreferencesPath, JsonSerializer.SerializeToUtf8Bytes(new Preferences(theme, autoProbe))); }
        catch (Exception ex) { StatusText.Text = "偏好设置未保存：" + ex.Message; }
    }
    private string DiagnosticReport() => "Rose in my wake · 本地诊断摘要\n时间：" + DateTimeOffset.Now.ToString("u") + "\n版本：2.0.0-preview.1\n环境：" + (demo ? "演示数据" : "真实本地检查") + "\nClash 版本：" + host.Version + "\nClash 运行：" + host.Running + "\n网络采样：" + networkSummary + "\n最近操作状态：" + lastOperationState + "\n\n不包含订阅、节点、密钥、配置内容、原始错误或网络 IP。网络详细结果请在检测页主动复制。";
    private void Report_Click(object sender, RoutedEventArgs e)
    {
        var text = DiagnosticReport();
        var dialog = new Window { Owner = this, Title = "诊断摘要 · 保存前预览", Width = 640, Height = 460, WindowStartupLocation = WindowStartupLocation.CenterOwner, Background = Background };
        var panel = new DockPanel { Margin = new Thickness(20) };
        var save = new Button { Content = "保存这份摘要", HorizontalAlignment = HorizontalAlignment.Left };
        DockPanel.SetDock(save, Dock.Bottom); panel.Children.Add(save);
        panel.Children.Add(new TextBox { Text = text, IsReadOnly = true, TextWrapping = TextWrapping.Wrap, VerticalScrollBarVisibility = ScrollBarVisibility.Auto, Margin = new Thickness(0,0,0,12), Background = (Brush)Application.Current.Resources["SurfaceBrush"], Foreground = Foreground });
        save.Click += (_, _) =>
        {
            var picker = new SaveFileDialog { Filter = "文本文件|*.txt", FileName = "Rose in my wake-诊断摘要.txt" };
            if (picker.ShowDialog(dialog) == true) { try { File.WriteAllText(picker.FileName, text, new UTF8Encoding(false)); dialog.Close(); } catch (Exception ex) { MessageBox.Show(dialog, ex.Message); } }
        };
        dialog.Content = panel; dialog.ShowDialog();
    }
    private void OnClosing(object? sender, CancelEventArgs e)
    {
        if (!busy) return; e.Cancel = true; StatusText.Text = updating ? "正在更新，请先取消更新或等待完成。" : "配置操作正在进行，请等待写入或回滚完成。";
    }
    private async Task SmokeTest()
    {
        // This entry point always uses the in-memory demo store. It cannot reach Worker or real network probes.
        var root = Path.Combine(Environment.CurrentDirectory, "ui-smoke"); Directory.CreateDirectory(root);
        try
        {
            await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle);
            Snapshot(Path.Combine(root, "01-overview.png"));
            BuildPreview(); await Navigate("plan");
            if (plan?.Changes.Count != 8 || plan.Options != RepairPlanner.OneClickOptions) throw new InvalidOperationException("一键配置未连接到 sing-mix、系统、浏览器与 IPv6 组合方案。");
            await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle); Snapshot(Path.Combine(root, "02-plan.png"));
            ConfirmOption.IsChecked = true; await PerformOperation("apply");
            if (!journals.List().Any(x => x.State == "applied")) throw new InvalidOperationException("修复未完成。");
            await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle); Snapshot(Path.Combine(root, "03-result.png"));
            await Navigate("backups"); await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle); Snapshot(Path.Combine(root, "04-backups.png"));
            await PerformOperation("restore", journals.List().First(x => x.State == "applied").Id);
            if (RepairPlanner.Build(state, RepairPlanner.OneClickOptions).Changes.Count != 8) throw new InvalidOperationException("恢复后状态不正确。");
            theme = 1; SetTheme(); await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle); Snapshot(Path.Combine(root, "05-light.png"));
            Width = 760; Height = 600; await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle);
            if (!ReviewButton.IsVisible || ReviewButton.TranslatePoint(new Point(0, ReviewButton.ActualHeight), this).Y > ActualHeight - 30) throw new InvalidOperationException("小窗口主按钮不可见。");
            Snapshot(Path.Combine(root, "06-compact.png"));
            Width = 1040; Height = 760; await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle);
            await Navigate("settings");
            await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle); Snapshot(Path.Combine(root, "08-update-settings.png"));
            using (var cancellation = new CancellationTokenSource())
            {
                var updateWindow = new UpdateProgressWindow(cancellation) { Owner = this };
                IsEnabled = false;
                try
                {
                    updateWindow.Show(); updateWindow.Report(42);
                    await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.ContextIdle);
                    Snapshot(Path.Combine(root, "09-update-progress.png"), updateWindow);
                    updateWindow.Close();
                    if (!cancellation.IsCancellationRequested || !updateWindow.IsVisible) throw new InvalidOperationException("更新窗口取消流程异常。");
                }
                finally { updateWindow.Complete(); IsEnabled = true; }
            }
            using var component = new NetworkView();
            component.Browser.IsEnabled = false;
            await Navigate("network"); NetworkLoading.Visibility = Visibility.Collapsed; NetworkContainer.Children.Add(component.Browser);
            await component.Initialize(true);
            var page = await component.Browser.CoreWebView2.ExecuteScriptAsync("JSON.stringify({ready:!!window.RoseCheck, start:!!document.getElementById('start'), source:location.origin})");
            using var pageState = JsonDocument.Parse(JsonSerializer.Deserialize<string>(page)!);
            if (!pageState.RootElement.GetProperty("ready").GetBoolean() || !pageState.RootElement.GetProperty("start").GetBoolean()) throw new InvalidOperationException("内置检测脚本未正确加载。");
            using (var preview = File.Create(Path.Combine(root, "07-diagnostics-light.png")))
                await component.Browser.CoreWebView2.CapturePreviewAsync(Microsoft.Web.WebView2.Core.CoreWebView2CapturePreviewImageFormat.Png, preview);
            File.WriteAllText(Path.Combine(root, "network-component.json"), page);
            File.WriteAllText(Path.Combine(root, "result.json"), JsonSerializer.Serialize(new { Passed = true, UpdateComponent = "Settings, progress dialog and cancellation verified without provider requests or installation", NetworkComponent = "WebView2 local page and scripts loaded; no probes started", Scope = "Native WPF; in-memory apply, restore, backup and updater UI; no real network or configuration writes" }));
            Close();
        }
        catch (Exception ex) { File.WriteAllText(Path.Combine(root, "result.json"), JsonSerializer.Serialize(new { Passed = false, Error = ex.ToString() })); Close(); Application.Current.Shutdown(1); }
    }
    private void Snapshot(string path, Window? window = null)
    {
        var target = window ?? this;
        target.UpdateLayout(); var bitmap = new RenderTargetBitmap((int)target.ActualWidth, (int)target.ActualHeight, 96, 96, PixelFormats.Pbgra32); bitmap.Render(target);
        var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(bitmap)); using var file = File.Create(path); encoder.Save(file);
    }
}
