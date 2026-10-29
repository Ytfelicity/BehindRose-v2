using System.Text;
using BehindRose.Core;
using YamlDotNet.RepresentationModel;

internal static class ClashIpv6Tests
{
    private static void Assert(bool value, string message) { if (!value) throw new Exception(message); }
    private static void Reject(Action action) { try { action(); } catch (InvalidDataException) { return; } throw new Exception("Expected refusal"); }
    private static MemoryState Enabled()
    {
        var state = new MemoryState();
        state.Values[Targets.Config] = MemoryState.File("ipv6: true\n" + Encoding.UTF8.GetString(state.Read(Targets.Config).Bytes()) + "dns: {ipv6: true, nameserver: [223.5.5.5]}\nproxies: [{name: fixture, type: direct}]\n");
        return state;
    }
    internal static void Register(Action<string, Action> test)
    {
        test("IPv6-only preview targets just the Clash global flag and performs no writes", () =>
        {
            var state = Enabled(); var original = state.Values.ToArray();
            var before = RepairPlanner.Parse(state.Read(Targets.Config).Bytes(), "before");
            var plan = RepairPlanner.Build(state, RepairOptions.DisableClashIpv6);
            Assert(plan.Changes.Count == 1 && plan.NeedsClashExit && plan.Changes[0].Key == Targets.Config, "Only config.yaml is modified, with restart required");
            var after = RepairPlanner.Parse(plan.Changes[0].After.Bytes(), "after");
            Assert(((YamlScalarNode)RepairPlanner.Get(after, "ipv6")!).Value == "false", "The global flag must become false");
            foreach (var entry in before.Children.Where(x => ((YamlScalarNode)x.Key).Value != "ipv6"))
                Assert(entry.Value.Equals(after.Children[entry.Key]), "Every other YAML value must remain equal: " + entry.Key);
            Assert(state.Writes == 0 && state.ReadyCalls == 0 && original.All(x => state.Read(x.Key) == x.Value), "Preview must not modify live or fixture state");
            Assert(!plan.Expected.ContainsKey(Targets.Dns) && !plan.Expected.Keys.Any(x => Targets.Policies.Contains(x)), "No DNS or browser policy dependency");
            Assert(plan.Changes[0].BeforeText.Contains("true") && plan.Changes[0].AfterText.Contains("false"), "Review must state the actual switch change");
        });
        test("Absent global IPv6 becomes explicit false while already false is a no-op", () =>
        {
            var state = new MemoryState();
            Assert(RepairPlanner.InspectClashIpv6(state).State == "未设置", "Do not infer runtime state from a missing flag");
            var plan = RepairPlanner.Build(state, RepairOptions.DisableClashIpv6);
            Assert(plan.Changes.Count == 1, "Absence requires an explicit setting");
            var journals = new MemoryJournals(); var engine = new RepairEngine(state, journals);
            Assert(engine.Apply(plan).Success && RepairPlanner.InspectClashIpv6(state).State == "已关闭", "In-memory apply should expose the stored state");
            int writes = state.Writes, ready = state.ReadyCalls;
            Assert(engine.Apply(RepairPlanner.Build(state, RepairOptions.DisableClashIpv6)).State == "unchanged", "Repeated apply must be a no-op");
            Assert(state.Writes == writes && state.ReadyCalls == ready && journals.List().Count == 1, "No repeated backup, write or exit requirement for a no-op");
        });
        test("IPv6 disable backup restores exact original bytes and unrelated targets", () =>
        {
            var state = Enabled(); var original = Targets.All.ToDictionary(x => x, state.Read);
            var journals = new MemoryJournals(); var engine = new RepairEngine(state, journals);
            var applied = engine.Apply(RepairPlanner.Build(state, RepairOptions.DisableClashIpv6));
            Assert(applied.Success && journals.List().Single().Changes.Count == 1, "Backup contains only the touched file");
            Assert(engine.Restore(applied.BackupId!).Success, "In-memory restore should succeed");
            Assert(Targets.All.All(x => state.Read(x) == original[x]), "Restore must recover the original bytes and leave all other targets untouched");
        });
        test("IPv6 rejects non-boolean values before a preview or write", () =>
        {
            foreach (var value in new[] { "'false'", "!!str false", "null", "0", "[]", "{}", "maybe" })
            {
                var state = new MemoryState(); state.Values[Targets.Config] = MemoryState.File("ipv6: " + value + "\n" + Encoding.UTF8.GetString(state.Read(Targets.Config).Bytes()));
                Assert(RepairPlanner.InspectClashIpv6(state).State == "无法自动修改", "Inspection must report an invalid flag");
                Reject(() => RepairPlanner.Build(state, RepairOptions.DisableClashIpv6));
                Assert(state.Writes == 0, "Do not overwrite an unrecognized value");
            }
            var unknown = Enabled(); Reject(() => RepairPlanner.Build(unknown, (RepairOptions)128));
        });
        test("IPv6 can combine with the built-in plan without duplicate file targets", () =>
        {
            var state = Enabled(); var originalDns = state.Read(Targets.Dns); var journals = new MemoryJournals(); var engine = new RepairEngine(state, journals);
            var basic = RepairPlanner.Build(state, (RepairOptions)15);
            Assert(RepairPlanner.IsTrue(RepairPlanner.Parse(basic.Changes.Single(x => x.Key == Targets.Config).After.Bytes(), "basic"), "ipv6"), "The legacy explicit mask preserves IPv6");
            var combined = RepairPlanner.Build(state, (RepairOptions)47);
            Assert(combined.Changes.Count(x => x.Key == Targets.Config) == 1 && combined.Fingerprint != basic.Fingerprint, "One file needs one combined snapshot, bound to the chosen flags");
            Assert(engine.Apply(combined).Success && RepairPlanner.InspectClashIpv6(state).State == "已关闭", "The combined in-memory plan should apply");
            Assert(state.Read(Targets.Dns) == originalDns && RepairPlanner.Build(state, (RepairOptions)47).Changes.Count == 0, "Do not replace upstream DNS; combined plan must be idempotent");
        });
        test("IPv6 preview refuses later config edits before backup and preserves them", () =>
        {
            var state = Enabled(); var plan = RepairPlanner.Build(state, RepairOptions.DisableClashIpv6); var journals = new MemoryJournals();
            state.Values[Targets.Config] = MemoryState.File(Encoding.UTF8.GetString(state.Read(Targets.Config).Bytes()).Replace("7897", "8888"));
            var edited = state.Read(Targets.Config);
            try { new RepairEngine(state, journals).Apply(plan); throw new Exception("Expected conflict"); }
            catch (IOException) { }
            Assert(state.Read(Targets.Config) == edited && state.Writes == 0 && journals.List().Count == 0, "A stale preview must not clobber concurrent edits");
        });
        test("IPv6 inspection handles missing or malformed files without exposing content", () =>
        {
            var state = new MemoryState(); state.Values.Remove(Targets.Config);
            Assert(RepairPlanner.InspectClashIpv6(state).State == "未找到", "Missing is not disabled");
            state.Values[Targets.Config] = MemoryState.File("ipv6: [private-token: {\n");
            var finding = RepairPlanner.InspectClashIpv6(state);
            Assert(finding.State == "无法自动修改" && !finding.Detail.Contains("private-token") && state.Writes == 0, "Parser messages must remain safe and read-only");
        });
    }
}
