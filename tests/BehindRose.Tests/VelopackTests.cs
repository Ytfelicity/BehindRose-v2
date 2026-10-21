using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BehindRose.Desktop;
using Velopack;
using Velopack.Exceptions;
using Velopack.Locators;
using Velopack.Sources;

static class VelopackTests
{
    public static void Register(Action<string, Action> test)
    {
        test("Real update adapter uses semantic prerelease ordering and refuses same or older versions", () =>
        {
            using var fixture = new Fixture();
            fixture.Feed("2.0.0-preview.2", "2.0.0-preview.10", "2.0.0");
            var update = fixture.Client("2.0.0-preview.1").CheckAsync(default).GetAwaiter().GetResult();
            if (update?.Version != "2.0.0") throw new Exception("Semantic release selection failed");
            if (fixture.Client("2.0.0").CheckAsync(default).GetAwaiter().GetResult() != null) throw new Exception("Same-version update offered");
            if (fixture.Client("2.0.1").CheckAsync(default).GetAwaiter().GetResult() != null) throw new Exception("Downgrade offered");
        });
        test("Real update download rejects a tampered package before it can be applied", () =>
        {
            using var fixture = new Fixture(); fixture.Feed("2.0.1");
            var client = fixture.Client("2.0.0");
            var update = client.CheckAsync(default).GetAwaiter().GetResult() ?? throw new Exception("Update missing");
            bool refused = false;
            try { update.DownloadAsync(_ => {}, default).GetAwaiter().GetResult(); }
            catch (ChecksumFailedException) { refused = true; }
            if (!refused) throw new Exception("Tampered package was accepted");
        });
    }
    private sealed class Fixture : IDisposable
    {
        private readonly string root = Path.Combine(Path.GetTempPath(), "behindrose-update-test-" + Guid.NewGuid().ToString("N"));
        private string FeedPath => Path.Combine(root, "feed");
        public Fixture() { Directory.CreateDirectory(FeedPath); Directory.CreateDirectory(Path.Combine(root, "packages")); }
        public void Feed(params string[] versions)
        {
            byte[] expected = Encoding.UTF8.GetBytes("good");
            var assets = versions.Select(version =>
            {
                string name = $"BehindRose.NetworkAssistant-{version}-full.nupkg";
                File.WriteAllText(Path.Combine(FeedPath, name), "evil");
                return new { PackageId = "BehindRose.NetworkAssistant", Version = version, Type = "Full", FileName = name,
                    SHA1 = Convert.ToHexString(SHA1.HashData(expected)), SHA256 = Convert.ToHexString(SHA256.HashData(expected)), Size = expected.Length };
            }).ToArray();
            File.WriteAllText(Path.Combine(FeedPath, "releases.win.json"), JsonSerializer.Serialize(new { Assets = assets }));
        }
        public GitHubUpdates Client(string version)
        {
            var locator = new TestVelopackLocator("BehindRose.NetworkAssistant", version, Path.Combine(root, "packages"), root, root, Path.Combine(root, "unused-updater.exe"), "win");
            return new GitHubUpdates(new UpdateManager(new SimpleFileSource(new DirectoryInfo(FeedPath)), new UpdateOptions { AllowVersionDowngrade = false }, locator));
        }
        public void Dispose()
        {
            string resolved = Path.GetFullPath(root);
            if (Path.GetDirectoryName(resolved) != Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar) || !Path.GetFileName(resolved).StartsWith("behindrose-update-test-", StringComparison.Ordinal)) throw new Exception("Unexpected update test path");
            Directory.Delete(resolved, true);
        }
    }
}
