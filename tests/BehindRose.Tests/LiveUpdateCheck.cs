using System.Diagnostics;
using System.Text.Json;
using BehindRose.Desktop;
using Velopack;
using Velopack.Locators;
using Velopack.Sources;

// Explicit opt-in network check. Never runs in the offline suite and never
// downloads or applies a package, or opens the user's installation directory.
static class LiveUpdateCheck
{
    public static async Task<int> RunAsync()
    {
        string root = Path.Combine(AppContext.BaseDirectory, "live-update-read-check");
        Directory.CreateDirectory(Path.Combine(root, "packages"));
        var locator = new TestVelopackLocator("BehindRose.NetworkAssistant", "2.0.0-preview.4",
            Path.Combine(root, "packages"), root, root, Path.Combine(root, "unused-updater.exe"), "win");
        var client = new GitHubUpdates(new UpdateManager(
            new GithubSource("https://github.com/Ytfelicity/BehindRose-v2", accessToken: null, prerelease: true),
            new UpdateOptions { AllowVersionDowngrade = false }, locator));
        var watch = Stopwatch.StartNew();
        try
        {
            using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(100));
            var update = await client.CheckAsync(cancellation.Token);
            Console.WriteLine(JsonSerializer.Serialize(new { Passed = true, ElapsedSeconds = watch.Elapsed.TotalSeconds,
                CurrentVersion = "2.0.0-preview.4", OfferedVersion = update?.Version, PackageDownloaded = false }));
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { Passed = false, ElapsedSeconds = watch.Elapsed.TotalSeconds,
                Error = ex.GetType().Name, PackageDownloaded = false }));
            return 1;
        }
    }
}
