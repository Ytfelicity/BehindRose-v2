using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using BehindRose.Windows;

internal static class ProxyNetworkTests
{
    private static void Assert(bool value, string reason) { if (!value) throw new Exception(reason); }
    private static ProxyNetworkState Finished(ProxyNetworkRunner runner)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        while (runner.Snapshot().State == "running") Task.Delay(10, timeout.Token).GetAwaiter().GetResult();
        return runner.Snapshot();
    }
    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => Task.FromResult(send(request));
    }
    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
    public static void Register(Action<string, Action> test)
    {
        test("Proxy network preserves failed samples, zero timings, multiple ASNs and actual transfer bytes", () =>
        {
            var requests = new ConcurrentBag<string>(); var counts = new ConcurrentDictionary<string, int>(); int exits = 0;
            using var runner = new ProxyNetworkRunner(port => {
                Assert(port == 7897, "Selected proxy port was lost");
                return new HttpClient(new Handler(request => {
                    string url = request.RequestUri!.AbsoluteUri; requests.Add(url);
                    if (request.RequestUri.Host == "api.ipify.org") return Json("{\"ip\":\"" + (Interlocked.Increment(ref exits) == 1 ? "203.0.113.42" : "198.51.100.7") + "\"}");
                    if (url.Contains("network-info")) return Json("{\"data\":{\"prefix\":\"203.0.113.0/24\",\"asns\":[64500,64501]}}");
                    if (url.Contains("as-overview")) return Json("{\"data\":{\"holder\":\"Test network\"}}");
                    if (request.Method == HttpMethod.Post) { Assert(request.Content!.Headers.ContentLength == 4194304, "Upload cap changed"); return Json("{}"); }
                    Assert(request.Headers.Range?.Ranges.Single().To == 8388607, "Download is not bounded by a range");
                    return new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[524288]) };
                }));
            }, (_, host, _, _) => {
                int round = counts.AddOrUpdate(host, 1, (_, count) => count+1);
                if (host.StartsWith("sh-cu", StringComparison.Ordinal) || (host.StartsWith("bj-ct", StringComparison.Ordinal) && round == 2)) throw new IOException("Fixture failure");
                return Task.FromResult(host.StartsWith("bj-ct", StringComparison.Ordinal) ? 0.0 : round*10.0);
            });
            runner.Start(7897, "quick", true); var state = Finished(runner); var report = state.Report!;
            Assert(state.State == "complete" && state.Current == state.Total && state.Total == 21, "Job did not finish all stages");
            Assert(report.Identity!.Asns.SequenceEqual(new[] { "64500", "64501" }) && report.Identity.Holder == "Test network", "BGP information lost");
            Assert(report.ExitChanged == true && report.FinalIp == "198.51.100.7", "Changing egress was not recorded");
            Assert(report.Latencies.Length == 14 && counts.All(pair => pair.Value == 3), "Quick mode must probe 9 domestic and 5 international targets exactly three times");
            var zero = report.Latencies.Single(row => row.Host.StartsWith("bj-ct", StringComparison.Ordinal));
            Assert(zero.AverageMs == 0 && zero.MinimumMs == 0 && zero.JitterMs == null && zero.FailurePercent == 33.3, "Zero/null/failure or adjacent jitter semantics changed");
            var failed = report.Latencies.Single(row => row.Host.StartsWith("sh-cu", StringComparison.Ordinal));
            Assert(failed.AverageMs == null && failed.FailurePercent == 100, "Failed samples became zero latency");
            Assert(report.Transfers.Length == 4 && report.Transfers.Take(3).All(row => row.Bytes == 524288 && row.Mbps > 0), "Transfer must use actual response bytes");
            Assert(report.Transfers.Last().Bytes == 4194304, "Upload byte count changed");
            int previous = requests.Count;
            runner.Start(7897, "all", false); state = Finished(runner);
            Assert(state.Report!.Latencies.Length == 98 && state.Report.Transfers.Length == 0, "All mode or low-data mode changed");
            Assert(requests.Count - previous == 4, "Low-data run made throughput requests");
        });
        test("Proxy network rejects invalid options, guards concurrent jobs and cancels with partial evidence", () =>
        {
            using var runner = new ProxyNetworkRunner(_ => new HttpClient(new Handler(request => request.RequestUri!.Host == "api.ipify.org" ? Json("{\"ip\":\"203.0.113.42\"}") : Json("{\"data\":{\"prefix\":null,\"asns\":[]}}"))), async (_, _, _, token) => { await Task.Delay(Timeout.Infinite, token); return 0; });
            foreach (var option in new[] { (0,"quick"),(65536,"quick"),(7897,"anything") }) { bool rejected = false; try { runner.Start(option.Item1, option.Item2); } catch (InvalidDataException) { rejected = true; } Assert(rejected, "Invalid options started a job"); }
            runner.Start(7897);
            bool concurrent = false; try { runner.Start(7897); } catch (InvalidOperationException) { concurrent = true; } Assert(concurrent, "Concurrent job was allowed");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            while (runner.Snapshot().Report?.Identity == null) Task.Delay(10, timeout.Token).GetAwaiter().GetResult();
            runner.Stop(); var result = Finished(runner);
            Assert(result.State == "cancelled" && result.Report?.Identity?.Ip == "203.0.113.42" && result.Report.ExitChanged == null, "Cancellation discarded evidence or invented a final check");
        });
        test("Proxy network rejects HTML speed responses and never records failed transfer as zero Mbps", () =>
        {
            using var runner = new ProxyNetworkRunner(_ => new HttpClient(new Handler(request => {
                if (request.RequestUri!.Host == "api.ipify.org") return Json("{\"ip\":\"203.0.113.42\"}");
                if (request.RequestUri.Host == "stat.ripe.net") return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>blocked</html>", Encoding.UTF8, "text/html") };
            })), (_, _, _, _) => Task.FromResult(1.0));
            runner.Start(7897, "quick", true); var result = Finished(runner);
            Assert(result.State == "complete" && result.Report!.Identity!.Error != null, "An unavailable BGP source should not abort measurement");
            Assert(result.Report!.Transfers.All(row => row.Mbps == null && row.Error != null), "HTML responses became successful speed results");
        });
        test("Real proxy transport waits for target HTTP response after bounded CONNECT acknowledgement", () =>
        {
            foreach (string reply in new[] { "HTTP/1.1 200 Connection established\r\n\r\n", "HTTP/1.1 407 Proxy Authentication Required\r\n\r\n", new string('x', 4096) })
            {
                using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
                int port = ((IPEndPoint)listener.LocalEndpoint).Port;
                var server = Task.Run(async () => {
                    using var client = await listener.AcceptTcpClientAsync(); using var stream = client.GetStream(); byte[] input = new byte[1024];
                    int count = await stream.ReadAsync(input); Assert(Encoding.ASCII.GetString(input, 0, count).StartsWith("CONNECT fixture.invalid:80 HTTP/1.1", StringComparison.Ordinal), "Target was resolved locally or changed");
                    await stream.WriteAsync(Encoding.ASCII.GetBytes(reply));
                    if (reply.Contains(" 200 ", StringComparison.Ordinal)) {
                        count = await stream.ReadAsync(input); Assert(Encoding.ASCII.GetString(input, 0, count).StartsWith("HEAD / HTTP/1.1", StringComparison.Ordinal), "Did not wait for target evidence");
                        await Task.Delay(40); await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n"));
                    }
                });
                bool passed = false;
                try { double elapsed = ProxyNetworkRunner.ProbeAsync(port, "fixture.invalid", 80, CancellationToken.None).GetAwaiter().GetResult(); passed = elapsed >= 35; } catch (IOException) { }
                server.GetAwaiter().GetResult();
                Assert(passed == reply.Contains(" 200 ", StringComparison.Ordinal), "Proxy rejection or oversized header was accepted");
            }
        });
        test("Default HTTP transport attempts ipify through selected proxy with no direct fallback", () =>
        {
            using var listener = new TcpListener(IPAddress.Loopback, 0); listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var server = Task.Run(async () => {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                using var client = await listener.AcceptTcpClientAsync(timeout.Token); using var stream = client.GetStream(); byte[] input = new byte[2048];
                int count = await stream.ReadAsync(input, timeout.Token);
                Assert(Encoding.ASCII.GetString(input, 0, count).StartsWith("CONNECT api.ipify.org:443 HTTP/1.1", StringComparison.Ordinal), "HTTPS request bypassed selected proxy");
                await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n"), timeout.Token);
            });
            using var runner = new ProxyNetworkRunner(); runner.Start(port); var result = Finished(runner); server.GetAwaiter().GetResult();
            Assert(result.State == "failed" && result.Report!.Identity == null, "Proxy failure caused a direct fallback or invented identity");
        });
    }
}
