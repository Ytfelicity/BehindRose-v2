using BehindRose.Core;
using Velopack;
using Velopack.Sources;

namespace BehindRose.Desktop;

internal sealed class GitHubUpdates : IUpdateClient
{
    private readonly UpdateManager manager;
    private readonly string[] restartArguments = [];
    internal GitHubUpdates(UpdateManager manager) { this.manager = manager; }
    public GitHubUpdates(string repository, bool prerelease, string[]? restartArguments = null)
    {
        this.restartArguments = restartArguments?.ToArray() ?? [];
        repository = UpdateCoordinator.GitHubRepository(repository) ?? throw new ArgumentException("缺少更新仓库。");
        manager = new UpdateManager(new GithubSource(repository, accessToken: null, prerelease: prerelease),
            new UpdateOptions { AllowVersionDowngrade = false });
    }
    public bool IsInstalled => manager.IsInstalled;
    public async Task<IUpdatePackage?> CheckAsync(CancellationToken cancellationToken)
    {
        // A feed check includes the GitHub release listing and its feed download.
        // Keep startup nonblocking while allowing slow, successful network paths.
        var update = await manager.CheckForUpdatesAsync().WaitAsync(TimeSpan.FromSeconds(90), cancellationToken);
        return update == null ? null : new Package(manager, update, restartArguments);
    }
    private sealed class Package(UpdateManager manager, UpdateInfo update, string[] restartArguments) : IUpdatePackage
    {
        public string Version => update.TargetFullRelease.Version.ToString();
        public string Notes => update.TargetFullRelease.NotesMarkdown ?? "";
        public Task DownloadAsync(Action<int> progress, CancellationToken cancellationToken) => manager.DownloadUpdatesAsync(update, progress, cancellationToken);
        public void ApplyAndRestart() => manager.ApplyUpdatesAndRestart(update.TargetFullRelease, restartArguments);
    }
}
