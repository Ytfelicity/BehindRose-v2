using System.Reflection;
using System.Windows;
using System.Windows.Controls;
using BehindRose.Core;

namespace BehindRose.Desktop;

public partial class MainWindow
{
    private UpdateCoordinator? updates;
    private readonly CancellationTokenSource updateLifetime = new();
    private bool updating;
    internal static string AppVersion => typeof(App).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0] ?? "未知版本";

    private void InitializeUpdates()
    {
        Closed += (_, _) => updateLifetime.Cancel();
        if ((demo && !updateTest) || DevelopmentMode.Enabled)
        {
            UpdateStatus.Text = "演示与开发模式不检查更新。"; CheckUpdatesButton.IsEnabled = false; return;
        }
        try
        {
            var repository = typeof(App).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(x => x.Key == "UpdateRepository")?.Value;
            repository = UpdateCoordinator.GitHubRepository(repository);
            if (repository == null) { UpdateStatus.Text = "此版本尚未配置更新地址。"; return; }
            updates = new(new GitHubUpdates(repository, AppVersion.Contains('-'), updateTest ? ["--update-test"] : []));
            UpdateStatus.Text = "启动时后台检查，有新版时由你确认更新。";
        }
        catch { UpdateStatus.Text = "更新配置无效，请联系作者。"; }
    }

    private async void CheckUpdates_Click(object sender, RoutedEventArgs e) => await CheckUpdatesAsync(false);
    private async Task CheckUpdatesAsync(bool automatic)
    {
        if (updates == null)
        {
            if (!automatic) MessageBox.Show(this, UpdateStatus.Text, "检查更新");
            return;
        }
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(updateLifetime.Token);
        UpdateProgressWindow? progress = null;
        CheckUpdatesButton.IsEnabled = false; UpdateStatus.Text = "正在检查更新……";
        try
        {
            var outcome = await updates.RunAsync(package =>
            {
                string notes = package.Notes.Length > 1800 ? package.Notes[..1800] + "…" : package.Notes;
                return Task.FromResult(MessageBox.Show(this,
                    $"发现新版本 {package.Version}（当前 {AppVersion}）。\n\n{notes}\n\n立即下载并更新？下载并校验完成后，程序将关闭并重新打开。",
                    "发现新版本", MessageBoxButton.YesNo, MessageBoxImage.Information, MessageBoxResult.No) == MessageBoxResult.Yes);
            }, () => !busy && IsLoaded && !updateLifetime.IsCancellationRequested,
            () =>
            {
                if (busy || !IsLoaded || updateLifetime.IsCancellationRequested) return null;
                progress = new UpdateProgressWindow(cancellation) { Owner = this };
                network?.StopAndInvalidate(); busy = updating = true; IsEnabled = false;
                try { progress.Show(); }
                catch { busy = updating = false; IsEnabled = true; throw; }
                return new UpdateReservation(() => { progress.Complete(); busy = updating = false; IsEnabled = true; });
            }, value => Dispatcher.BeginInvoke(() => progress?.Report(value)), cancellation.Token);
            UpdateStatus.Text = outcome switch
            {
                UpdateOutcome.Unavailable => "当前运行方式不支持自动更新，请使用作者发布的新版安装包或便携包。",
                UpdateOutcome.Current => "当前已经是最新版本。",
                UpdateOutcome.Later => "已暂缓更新，下次启动时会再次检查。",
                UpdateOutcome.Deferred => "配置操作正在进行，完成后可手动检查更新。",
                UpdateOutcome.Busy => "更新检查正在进行。",
                _ => "正在重新启动……"
            };
            if (!automatic && outcome is UpdateOutcome.Current or UpdateOutcome.Unavailable or UpdateOutcome.Deferred)
                MessageBox.Show(this, UpdateStatus.Text, "检查更新");
        }
        catch (OperationCanceledException) { UpdateStatus.Text = "已取消更新，可稍后重试。"; }
        catch
        {
            UpdateStatus.Text = "更新未完成，当前版本仍可使用。请检查网络后重试。";
            if (IsLoaded && (!automatic || progress != null)) MessageBox.Show(this, UpdateStatus.Text, "更新未完成");
        }
        finally { CheckUpdatesButton.IsEnabled = true; }
    }

    private sealed class UpdateReservation(Action release) : IDisposable { public void Dispose() => release(); }
}

internal sealed class UpdateProgressWindow : Window
{
    private readonly TextBlock status = new() { Text = "正在下载更新……", Margin = new Thickness(0, 0, 0, 16) };
    private readonly ProgressBar progress = new() { Minimum = 0, Maximum = 100, Height = 8, IsIndeterminate = true };
    private bool completed;
    public UpdateProgressWindow(CancellationTokenSource cancellation)
    {
        Title = "更新 Rose in my wake"; Width = 440; Height = 210; ResizeMode = ResizeMode.NoResize;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        Background = (System.Windows.Media.Brush)Application.Current.Resources["BackgroundBrush"];
        Foreground = (System.Windows.Media.Brush)Application.Current.Resources["TextBrush"];
        var panel = new StackPanel { Margin = new Thickness(24) };
        panel.Children.Add(status); panel.Children.Add(progress);
        var cancel = new Button { Content = "取消更新", Margin = new Thickness(0, 20, 0, 0), HorizontalAlignment = HorizontalAlignment.Right };
        void Cancel() { cancellation.Cancel(); cancel.IsEnabled = false; status.Text = "正在取消，请稍候……"; }
        cancel.Click += (_, _) => Cancel(); panel.Children.Add(cancel); Content = panel;
        Closing += (_, args) => { if (!completed) { args.Cancel = true; Cancel(); } };
    }
    public void Report(int value) { progress.IsIndeterminate = false; progress.Value = Math.Clamp(value, 0, 100); status.Text = $"正在下载并校验更新……{value}%"; }
    public void Complete() { completed = true; Close(); }
}
