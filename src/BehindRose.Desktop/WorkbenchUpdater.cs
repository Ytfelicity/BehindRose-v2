using System.Reflection;
using System.Windows;
using BehindRose.Core;

namespace BehindRose.Desktop;

internal sealed class WorkbenchUpdater(Window owner, LocalApp local, Func<Task> stopSampling, bool demo, bool updateTest)
{
    private readonly CancellationTokenSource lifetime = new();
    private UpdateCoordinator? coordinator;
    private bool checking;
    public string Status { get; private set; } = "启动时后台检查，有新版时由你确认更新。";
    public object Snapshot() => new { version = MainWindow.AppVersion, status = Status, checking, enabled = coordinator != null };
    public void Initialize()
    {
        owner.Closed += (_, _) => lifetime.Cancel();
        if ((demo && !updateTest) || DevelopmentMode.Enabled) { Status = "演示与开发模式不检查更新。"; return; }
        var repository = typeof(App).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(x => x.Key == "UpdateRepository")?.Value;
        try
        {
            repository = UpdateCoordinator.GitHubRepository(repository);
            if (repository == null) { Status = "此版本尚未配置更新地址。"; return; }
            coordinator = new(new GitHubUpdates(repository, MainWindow.AppVersion.Contains('-'), updateTest ? ["--update-test"] : []));
        }
        catch { Status = "更新配置无效，请联系作者。"; }
    }
    public async Task CheckAsync(bool automatic)
    {
        if (coordinator == null || checking) return;
        checking = true; Status = "正在检查更新……";
        using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        UpdateProgressWindow? progress = null;
        try
        {
            var outcome = await coordinator.RunAsync(async package =>
            {
                string notes = package.Notes.Length > 1500 ? package.Notes[..1500] + "…" : package.Notes;
                bool accepted = MessageBox.Show(owner, $"发现新版本 {package.Version}（当前 {MainWindow.AppVersion}）。\n\n{notes}\n\n立即下载并更新？下载并校验完成后，程序将关闭并重新打开。", "发现新版本", MessageBoxButton.YesNo, MessageBoxImage.Information, MessageBoxResult.No) == MessageBoxResult.Yes;
                if (accepted) await stopSampling();
                return accepted;
            }, () => owner.IsLoaded && !local.IsBusy && !lifetime.IsCancellationRequested,
            () =>
            {
                if (!owner.IsLoaded || lifetime.IsCancellationRequested) return null;
                var lease = local.ReserveUpdate(); if (lease == null) return null;
                try
                {
                    progress = new UpdateProgressWindow(cancellation) { Owner = owner };
                    owner.IsEnabled = false; progress.Show();
                    return new Reservation(() => { progress.Complete(); owner.IsEnabled = true; lease.Dispose(); });
                }
                catch { owner.IsEnabled = true; lease.Dispose(); throw; }
            }, value => owner.Dispatcher.BeginInvoke(() => progress?.Report(value)), cancellation.Token);
            Status = outcome switch
            {
                UpdateOutcome.Current => "当前已经是最新版本。",
                UpdateOutcome.Later => "已暂缓更新，下次启动时会再次检查。",
                UpdateOutcome.Deferred => "配置操作正在进行，完成后可手动检查更新。",
                UpdateOutcome.Unavailable => "当前运行方式不支持自动更新，请使用作者发布的安装包或完整便携包。",
                _ => "正在处理更新……"
            };
        }
        catch (OperationCanceledException) { Status = "已取消更新，可稍后重试。"; }
        catch
        {
            Status = "更新未完成，当前版本仍可使用。请检查网络后重试。";
            if (owner.IsLoaded && (!automatic || progress != null)) MessageBox.Show(owner, Status, "更新未完成");
        }
        finally { checking = false; }
    }
    private sealed class Reservation(Action release) : IDisposable { public void Dispose() => release(); }
}
