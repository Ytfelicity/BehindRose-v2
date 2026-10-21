using System.Text.RegularExpressions;

namespace BehindRose.Core;

public interface IUpdateClient
{
    bool IsInstalled { get; }
    Task<IUpdatePackage?> CheckAsync(CancellationToken cancellationToken);
}

public interface IUpdatePackage
{
    string Version { get; }
    string Notes { get; }
    Task DownloadAsync(Action<int> progress, CancellationToken cancellationToken);
    void ApplyAndRestart();
}

public enum UpdateOutcome { Unavailable, Current, Later, Deferred, Busy, Restarting }

// Downloads require explicit consent and an exclusive lease against configuration writes.
public sealed class UpdateCoordinator(IUpdateClient client)
{
    private int running;
    public async Task<UpdateOutcome> RunAsync(Func<IUpdatePackage, Task<bool>> confirm,
        Func<bool> canPrompt, Func<IDisposable?> reserveApplication, Action<int> progress,
        CancellationToken cancellationToken = default)
    {
        if (Interlocked.CompareExchange(ref running, 1, 0) != 0) return UpdateOutcome.Busy;
        try
        {
            if (!client.IsInstalled) return UpdateOutcome.Unavailable;
            var update = await client.CheckAsync(cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            if (update == null) return UpdateOutcome.Current;
            if (!canPrompt()) return UpdateOutcome.Deferred;
            if (!await confirm(update)) return UpdateOutcome.Later;
            cancellationToken.ThrowIfCancellationRequested();
            using var reservation = reserveApplication();
            if (reservation == null) return UpdateOutcome.Deferred;
            await update.DownloadAsync(progress, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            update.ApplyAndRestart();
            return UpdateOutcome.Restarting;
        }
        finally { Volatile.Write(ref running, 0); }
    }

    public static string? GitHubRepository(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) || uri.Scheme != "https"
            || uri.Host != "github.com" || !uri.IsDefaultPort || uri.UserInfo.Length != 0
            || uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new ArgumentException("更新仓库必须是公开的 https://github.com/作者/仓库 地址。");
        var path = uri.AbsolutePath.TrimEnd('/');
        if (path.EndsWith(".git", StringComparison.OrdinalIgnoreCase)) path = path[..^4];
        if (!Regex.IsMatch(path, @"^/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$"))
            throw new ArgumentException("更新仓库地址无效。");
        return "https://github.com" + path;
    }
}
