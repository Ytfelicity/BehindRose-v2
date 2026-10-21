using System.Text;
using BehindRose.Core;
using BehindRose.Windows;
using YamlDotNet.RepresentationModel;

internal static class HostCompatibilityTests
{
    private const RepairOptions OneClick = RepairPlanner.OneClickOptions;
    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Reject(Action action)
    {
        try { action(); } catch (InvalidDataException) { return; }
        throw new Exception("Expected an invalid configuration to be refused");
    }
    private static HostInfo Discover(MemoryState state, string version = "2.5.7", Action? directory = null)
        => HostDiscovery.AssessConfiguration("fixture/clash-verge.exe", version, true, state, directory ?? (() => { }));

    internal static void Register(Action<string, Action> test)
    {
        test("Clash compatibility follows configuration capability across versions without writes", () =>
        {
            foreach (var version in new[] { "2.5.2", "2.5.7", "2.6.0", "未识别" })
            {
                var state = new MemoryState(); var before = state.Values.ToArray(); int directoryChecks = 0;
                var host = Discover(state, version, () => directoryChecks++);
                Assert(host.Compatible && host.Version == version && host.Running, "Version is metadata; it must not gate a valid structure");
                var plan = RepairPlanner.Build(state, OneClick);
                Assert(directoryChecks == 1 && plan.Changes.Count > 0, "A recognized structure should produce a review");
                Assert(state.Writes == 0 && state.ReadyCalls == 0 && before.All(x => state.Read(x.Key) == x.Value), "Discovery/planning must never write or request elevation");
                Assert(!plan.Expected.ContainsKey(Targets.Dns), "One-click configuration must not target upstream DNS servers");
            }
        });
        test("Clash runtime-supplied tun.enable may be absent without rejecting saved settings", () =>
        {
            var state = new MemoryState();
            state.Values[Targets.Config] = MemoryState.File("mixed-port: 7897\ntun:\n  stack: mixed\n  auto-route: true\n  strict-route: true\n  auto-detect-interface: true\n  dns-hijack: [any:53, 'tcp://any:53']\n");
            Assert(Discover(state).Compatible, "Official use_tun supplies the optional enable flag at runtime");
            Assert(RepairPlanner.Inspect(state)[0].State == "建议核对", "Absence is not proof that the target settings are configured");
            var plan = RepairPlanner.Build(state, OneClick);
            var generated = plan.Changes.Single(x => x.Key == Targets.Config).After;
            var yaml = RepairPlanner.Parse(generated.Bytes(), "generated");
            Assert(RepairPlanner.IsTrue((YamlMappingNode)RepairPlanner.Get(yaml, "tun")!, "enable"), "The preview must include the missing desired flag");
            Assert(state.Writes == 0, "A preview is read-only");
        });
        test("Invalid target field types fail in discovery, inspection and planning for every version", () =>
        {
            var cases = new (string Key, string Yaml)[]
            {
                (Targets.Verge, "custom: keep\n"),
                (Targets.Verge, "enable_tun_mode: 'false'\n"),
                (Targets.Verge, "enable_tun_mode: !!str false\n"),
                (Targets.Verge, "enable_tun_mode: [false]\n"),
                (Targets.Config, "mixed-port: 7897\n"),
                (Targets.Config, "tun: []\n"),
                (Targets.Config, "tun: invalid\n"),
                (Targets.Config, "tun: {enable: 0}\n"),
                (Targets.Config, "tun: {enable: null}\n"),
                (Targets.Config, "tun: {enable: 'true'}\n"),
                (Targets.Config, "tun: {auto-route: maybe}\n"),
                (Targets.Config, "tun: {strict-route: []}\n"),
                (Targets.Config, "tun: {auto-detect-interface: {}}\n"),
                (Targets.Config, "tun: {stack: custom-stack}\n"),
                (Targets.Config, "tun: {stack: []}\n"),
                (Targets.Config, "tun: {dns-hijack: any:53}\n"),
                (Targets.Config, "tun: {dns-hijack: [{complex: item}]}\n"),
                (Targets.Config, "tun: {dns-hijack: ['']}\n")
            };
            foreach (var version in new[] { "2.5.2", "2.5.7" }) foreach (var item in cases)
            {
                var state = new MemoryState(); state.Values[item.Key] = MemoryState.File(item.Yaml);
                Assert(!Discover(state, version).Compatible, "An old approved version must not override an invalid structure");
                Reject(() => RepairPlanner.ValidateClashConfiguration(state));
                Reject(() => RepairPlanner.Build(state, OneClick));
                Assert(RepairPlanner.Inspect(state)[0].State == "无法自动修改" && state.Writes == 0, "Invalid values must not be silently replaced");
            }
        });
        test("Missing or inaccessible standard directories are refused without configuration writes", () =>
        {
            foreach (var failure in new Exception[] { new InvalidDataException("缺少标准目录"), new IOException("private path"), new UnauthorizedAccessException("private path"), new System.Security.SecurityException("private path") })
            {
                var state = new MemoryState(); var host = Discover(state, directory: () => throw failure);
                Assert(!host.Compatible && !host.Note.Contains("private path") && state.Writes == 0, "Path failures must block with a safe reason");
            }
            var missing = new MemoryState(); missing.Values.Remove(Targets.Config);
            Assert(!Discover(missing).Compatible && missing.Writes == 0, "Missing config files must block");
        });
        test("Malformed YAML and invalid encoding are refused without exposing configuration snippets", () =>
        {
            var invalid = new[]
            {
                Encoding.UTF8.GetBytes("tun: [private-token: {\n"),
                Encoding.UTF8.GetBytes("tun: {enable: false, enable: true}\n"),
                Encoding.UTF8.GetBytes("tun: {enable: false}\n---\ntun: {}\n"),
                Encoding.UTF8.GetBytes("base: &x {enable: false}\ntun: *x\n"),
                new byte[] { 0xff, 0x81, 0xff }
            };
            foreach (var bytes in invalid)
            {
                var state = new MemoryState(); state.Values[Targets.Config] = StoredValue.File(bytes);
                var host = Discover(state);
                Assert(!host.Compatible && !host.Note.Contains("private-token"), "Parser diagnostics must not reveal source content");
                Reject(() => RepairPlanner.Build(state, OneClick));
                Assert(RepairPlanner.Inspect(state)[0].State == "无法自动修改" && state.Writes == 0, "Invalid encoding must also be handled by inspection");
            }
        });
        test("Recognized optional fields and unrelated data survive the preview round trip", () =>
        {
            foreach (var stack in new[] { "system", "gvisor", "mixed" })
            {
                var state = new MemoryState(); var dns = state.Read(Targets.Dns);
                state.Values[Targets.Config] = MemoryState.File($"tun:\n  stack: {stack}\n  mtu: 1400\n  dns-hijack: ['custom:53']\nrules: [MATCH,DIRECT]\n");
                Assert(Discover(state).Compatible, "Known optional structures are supported");
                var plan = RepairPlanner.Build(state, OneClick);
                foreach (var change in plan.Changes) state.Values[change.Key] = change.After; // In-memory only; never WindowsState.Write.
                RepairPlanner.ValidateClashConfiguration(state);
                Assert(RepairPlanner.Build(state, OneClick).Changes.Count == 0, "A generated configuration must pass the same guard and be idempotent");
                var root = RepairPlanner.Parse(state.Read(Targets.Config).Bytes(), "roundtrip"); var tun = (YamlMappingNode)RepairPlanner.Get(root, "tun")!;
                Assert(((YamlScalarNode)RepairPlanner.Get(tun, "stack")!).Value == stack && RepairPlanner.Get(tun, "mtu") != null && RepairPlanner.Get(root, "rules") != null, "Preserve unrelated settings");
                Assert(((YamlSequenceNode)RepairPlanner.Get(tun, "dns-hijack")!).Children.OfType<YamlScalarNode>().Any(x => x.Value == "custom:53"), "Preserve existing DNS hijacks");
                Assert(state.Read(Targets.Dns) == dns && state.Writes == 0, "Preserve original DNS bytes and perform no writes");
            }
        });
        test("Optional DNS replacement refuses conflicting field types before a write", () =>
        {
            foreach (var yaml in new[] { "enable: 'true'\nnameserver: []\n", "enable: true\nnameserver: {bad: value}\n" })
            {
                var state = new MemoryState(); state.Values[Targets.Dns] = MemoryState.File(yaml);
                Reject(() => RepairPlanner.Build(state, RepairOptions.ReplaceDns));
                Assert(state.Writes == 0, "Unknown DNS structures must not be overwritten");
            }
        });
    }
}
