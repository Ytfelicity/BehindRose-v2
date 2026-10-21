using BehindRose.Core;

static class UpdateTests
{
    public static void Register(Action<string, Action> test)
    {
        test("Updates require consent and exclude configuration writes until verified download completes", () =>
        {
            var events = new List<string>(); var package = new Package(events); var client = new Client(package);
            var flow = new UpdateCoordinator(client);
            var result = flow.RunAsync(_ => { events.Add("confirm"); return Task.FromResult(true); }, () => true,
                () => { events.Add("reserve"); return new Lease(() => events.Add("release")); }, _ => {}).GetAwaiter().GetResult();
            Require(result == UpdateOutcome.Restarting);
            Require(events.SequenceEqual(new[] { "confirm", "reserve", "download", "apply", "release" }));
        });
        test("Declining or deferring an update never downloads or restarts", () =>
        {
            foreach (var scenario in new[] { "decline", "busy-before-prompt", "busy-after-prompt", "unpackaged", "current" })
            {
                var events = new List<string>(); var client = new Client(scenario == "current" ? null : new Package(events)) { IsInstalled = scenario != "unpackaged" };
                var flow = new UpdateCoordinator(client);
                var result = flow.RunAsync(_ => { events.Add("confirm"); return Task.FromResult(scenario != "decline"); },
                    () => scenario != "busy-before-prompt", () => scenario == "busy-after-prompt" ? null : new Lease(() => {}), _ => {}).GetAwaiter().GetResult();
                Require(result != UpdateOutcome.Restarting && !events.Contains("download") && !events.Contains("apply"));
                if (scenario is "busy-before-prompt" or "unpackaged" or "current") Require(!events.Contains("confirm"));
                if (scenario == "unpackaged") Require(client.Checks == 0);
            }
        });
        test("Failed or cancelled downloads release the application without applying and permit retry", () =>
        {
            foreach (bool cancel in new[] { false, true })
            {
                var events = new List<string>(); var package = new Package(events) { Failure = cancel ? new OperationCanceledException() : new IOException("checksum failure") };
                var flow = new UpdateCoordinator(new Client(package)); bool released = false, failed = false;
                try { flow.RunAsync(_ => Task.FromResult(true), () => true, () => new Lease(() => released = true), _ => {}).GetAwaiter().GetResult(); }
                catch (Exception ex) when (ex is IOException or OperationCanceledException) { failed = true; }
                Require(failed && released && !events.Contains("apply"));
                package.Failure = null;
                Require(flow.RunAsync(_ => Task.FromResult(false), () => true, () => null, _ => {}).GetAwaiter().GetResult() == UpdateOutcome.Later);
            }
        });
        test("Overlapping checks and cancellation cannot apply a stale update", () =>
        {
            var events = new List<string>(); var source = new TaskCompletionSource<IUpdatePackage?>();
            var client = new Client(new Package(events)) { Pending = source.Task }; var flow = new UpdateCoordinator(client);
            using var cancellation = new CancellationTokenSource();
            var first = flow.RunAsync(_ => Task.FromResult(true), () => true, () => new Lease(() => {}), _ => {}, cancellation.Token);
            Require(flow.RunAsync(_ => Task.FromResult(true), () => true, () => new Lease(() => {}), _ => {}).GetAwaiter().GetResult() == UpdateOutcome.Busy);
            cancellation.Cancel(); source.SetResult(new Package(events));
            bool cancelled = false; try { first.GetAwaiter().GetResult(); } catch (OperationCanceledException) { cancelled = true; }
            Require(cancelled && events.Count == 0 && client.Checks == 1);
        });
        test("Update repositories reject credentials, alternate origins and arbitrary feed paths", () =>
        {
            Require(UpdateCoordinator.GitHubRepository("") == null);
            Require(UpdateCoordinator.GitHubRepository("https://github.com/example/BehindRose.git/") == "https://github.com/example/BehindRose");
            foreach (var value in new[] { "http://github.com/a/b", "https://github.com.evil.test/a/b", "https://" + "user:pass@github.com/a/b", "https://github.com:444/a/b", "https://github.com/a/b/releases", "https://github.com/a/b?token=x", "https://github.com/a/b#fragment", "file:///C:/updates", "https://github.com/a/%2fb" })
            {
                bool refused = false; try { UpdateCoordinator.GitHubRepository(value); } catch (ArgumentException) { refused = true; } Require(refused);
            }
        });
    }
    private static void Require(bool condition) { if (!condition) throw new Exception("Update safety assertion failed"); }
    private sealed class Lease(Action release) : IDisposable { public void Dispose() => release(); }
    private sealed class Client(IUpdatePackage? package) : IUpdateClient
    {
        public bool IsInstalled { get; set; } = true;
        public int Checks { get; private set; }
        public Task<IUpdatePackage?>? Pending { get; set; }
        public Task<IUpdatePackage?> CheckAsync(CancellationToken _) { Checks++; return Pending ?? Task.FromResult(package); }
    }
    private sealed class Package(List<string> events) : IUpdatePackage
    {
        public string Version => "2.0.0-preview.2";
        public string Notes => "Offline test";
        public Exception? Failure { get; set; }
        public Task DownloadAsync(Action<int> progress, CancellationToken cancellationToken)
        { events.Add("download"); if (Failure != null) throw Failure; progress(100); return Task.CompletedTask; }
        public void ApplyAndRestart() => events.Add("apply");
    }
}
