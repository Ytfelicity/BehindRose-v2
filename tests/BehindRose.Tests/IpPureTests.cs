using System.Text;
using System.Text.Json;
using BehindRose.Windows;

internal static class IpPureTests
{
    private const string Info = "{\"ip\":\"203.0.113.42\",\"asn\":64500,\"asOrganization\":\"Example\",\"fraudScore\":0,\"isResidential\":false,\"isBroadcast\":false,\"futureField\":\"kept\"}";
    private static byte[] Bytes(string text) => Encoding.UTF8.GetBytes(text);
    private static void Assert(bool value, string reason) { if (!value) throw new Exception(reason); }
    private static void Reject(Action action) { try { action(); } catch (InvalidDataException) { return; } throw new Exception("Expected invalid IPPure data to be rejected."); }
    public static void Register(Action<string, Action> test)
    {
        test("IPPure uses one selected route and preserves zero, false and raw fields", () =>
        {
            int calls = 0, selected = -1;
            using var runner = new IpPureRunner((port, _) => { calls++; selected = port; return Task.FromResult(Bytes(Info)); });
            Reject(() => runner.Start(-1)); Reject(() => runner.Start(65536)); Assert(calls == 0, "Invalid port started a query.");
            runner.Start(10809); runner.WaitAsync().GetAwaiter().GetResult(); var state = runner.Snapshot();
            Assert(state.State == "complete" && state.ProxyPort == 10809 && state.Family == 4 && state.Route == "proxy" && calls == 1 && selected == 10809, "Expected one completed query on the exact port.");
            var report = state.Report!.Value; Assert(report.GetProperty("Source").GetString() == "IPPure" && report.GetProperty("Endpoint").GetString() == "https://my.ippure.com/v1/info", "Wrong provider.");
            var data = report.GetProperty("Data");
            Assert(data.GetProperty("fraudScore").GetInt32() == 0 && !data.GetProperty("isResidential").GetBoolean() && !data.GetProperty("isBroadcast").GetBoolean() && data.GetProperty("futureField").GetString() == "kept", "Raw zero, false and future fields must be preserved.");
            runner.Start(0); runner.WaitAsync().GetAwaiter().GetResult();
            Assert(selected == 0 && runner.Snapshot().Route == "default" && !runner.Snapshot().Report!.Value.GetProperty("Head").GetProperty("Proxy").GetBoolean(), "Default network is a separate explicit selection.");
        });
        test("IPPure validation and denied queries remain failures without fallback or fabricated results", () =>
        {
            foreach (string body in new[] { "not json", "<html>verification</html>", "{}", Info.Replace("\"fraudScore\":0", "\"fraudScore\":101"), Info.Replace("\"isResidential\":false", "\"isResidential\":\"false\""), new string('x', IpPureRunner.MaxResponseBytes + 1) })
            {
                int calls = 0;
                using var runner = new IpPureRunner((_, _) => { calls++; return Task.FromResult(Bytes(body)); }); runner.Start(7897); runner.WaitAsync().GetAwaiter().GetResult();
                Assert(runner.Snapshot().State == "failed" && runner.Snapshot().Report is null && calls == 1, "A failed query must not become a result or retry direct.");
            }
            int failedCalls = 0;
            using var rejected = new IpPureRunner((_, _) => { failedCalls++; throw new InvalidDataException("IPPure 要求网站验证"); }); rejected.Start(7897); rejected.WaitAsync().GetAwaiter().GetResult();
            Assert(rejected.Snapshot().Error!.Contains("网站验证") && failedCalls == 1 && rejected.Snapshot().Report is null, "Keep the original denial.");
        });
        test("IPPure retains missing fields and actual IPv6 family", () =>
        {
            using var runner = new IpPureRunner((_, _) => Task.FromResult(Bytes("{\"ip\":\"2001:db8::1\",\"fraudScore\":null}"))); runner.Start(7897); runner.WaitAsync().GetAwaiter().GetResult();
            var state = runner.Snapshot(); Assert(state.State == "complete" && state.Family == 6, "Family must come from actual evidence.");
            var data = state.Report!.Value.GetProperty("Data"); Assert(data.GetProperty("fraudScore").ValueKind == JsonValueKind.Null && !data.TryGetProperty("isResidential", out _), "Missing classifications must stay missing.");
        });
        test("IPPure cancellation, late results and deadlines never overwrite another run", () =>
        {
            var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var late = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously); int calls = 0;
            using var runner = new IpPureRunner((_, _) => { if (Interlocked.Increment(ref calls) == 1) { entered.SetResult(); return late.Task; } return Task.FromResult(Bytes(Info)); });
            runner.Start(7897); entered.Task.GetAwaiter().GetResult(); Task first = runner.WaitAsync(); runner.Stop();
            Assert(runner.Snapshot().State == "cancelled", "Stop must settle immediately.");
            runner.Start(10809); runner.WaitAsync().GetAwaiter().GetResult(); string? id = runner.Snapshot().Id;
            late.SetResult(Bytes(Info.Replace("203.0.113.42", "198.51.100.66"))); first.GetAwaiter().GetResult();
            Assert(runner.Snapshot().Id == id && runner.Snapshot().Report!.Value.GetProperty("Head").GetProperty("IP").GetString() == "203.0.113.42", "Late cancelled evidence overwrote a new job.");
            using var timed = new IpPureRunner(async (_, token) => { await Task.Delay(10000, token); return Bytes(Info); }, TimeSpan.FromMilliseconds(20));
            timed.Start(7897); timed.WaitAsync().GetAwaiter().GetResult();
            Assert(timed.Snapshot().State == "timeout" && timed.Snapshot().Report is null, "Timeout must not become a clean score.");
        });
    }
}
