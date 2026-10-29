using System.Text;
using BehindRose.Core;
using YamlDotNet.RepresentationModel;

internal static class SingMixTests
{
    private static void Assert(bool ok, string message) { if (!ok) throw new Exception(message); }
    private static void Reject(Action action) { try { action(); } catch (InvalidDataException) { return; } throw new Exception("Expected refusal"); }
    internal static void Register(Action<string, Action> test)
    {
        test("DNS protection refuses the old template and preserves original script dependencies", () =>
        {
            var state = new MemoryState(); var journals = new MemoryJournals(); var engine = new RepairEngine(state, journals);
            var plan = RepairPlanner.Build(state, RepairPlanner.OneClickOptions);
            Assert(plan.Expected.ContainsKey(Targets.RuntimeSource) && plan.Expected.ContainsKey(Targets.ScriptSource("old-script.js")), "Preview tracks runtime and original script changes");
            var applied = engine.Apply(plan); Assert(applied.Success, "Install succeeds");
            var installed = Encoding.UTF8.GetString(state.Read(Targets.SingMixScript("fixture")).Bytes());
            Assert(installed.Contains("config.originalScriptRan = true") && installed.Contains("behindRoseOriginalMain"), "The existing profile script is kept and called first");
            Assert(engine.Restore(applied.BackupId!).Success, "Original binding is restorable");
            var stale = RepairPlanner.Build(state, RepairPlanner.OneClickOptions);
            state.Values[Targets.ScriptSource("old-script.js")] = MemoryState.File("function main(c) { return c; }");
            try { engine.Apply(stale); throw new Exception("Expected stale source refusal"); } catch (IOException) { }
            Assert(!state.Read(Targets.SingMixScript("fixture")).Exists, "A source change cannot silently replace the user's script");
            state.Values[Targets.RuntimeSource] = MemoryState.File("rules: [\"MATCH,DIRECT\"]\n");
            Reject(() => RepairPlanner.Build(state, RepairPlanner.OneClickOptions));
        });
        test("sing-mix installs per-profile script, disables both DNS overrides and restores original bytes", () =>
        {
            var state = new MemoryState(); var originals = state.Values.ToArray(); var journals = new MemoryJournals();
            var plan = RepairPlanner.Build(state, RepairPlanner.OneClickOptions);
            Assert(plan.Changes.Count == 8 && plan.Changes.Select(x => x.Key).Distinct().Count() == 8, "Eight unique journal targets including the script binding");
            Assert(plan.Expected.ContainsKey(Targets.Profiles) && !plan.Expected.ContainsKey(Targets.Dns), "DNS is owned by the script, not dns_config.yaml");
            var engine = new RepairEngine(state, journals); var result = engine.Apply(plan);
            Assert(result.Success && SingMixProfile.Inspect(state).State == "已配置", "Saved script and switches must all be verified");
            var verge = RepairPlanner.Parse(state.Read(Targets.Verge).Bytes(), "verge");
            Assert(!RepairPlanner.IsTrue(verge, "enable_dns_settings"), "Legacy DNS override is off");
            var map = (YamlMappingNode)RepairPlanner.Get(verge, "profile_dns_settings")!;
            Assert(!RepairPlanner.IsTrue((YamlMappingNode)RepairPlanner.Get(map, "fixture")!, "enabled"), "Profile-specific DNS override is off");
            Assert(Encoding.UTF8.GetString(state.Read(Targets.SingMixScript("fixture")).Bytes()).EndsWith(SingMixProfile.Source, StringComparison.Ordinal), "The incremental body is installed after the original script");
            Assert(RepairPlanner.Build(state, RepairPlanner.OneClickOptions).Changes.Count == 0, "Applying twice is a no-op");
            Assert(engine.Restore(result.BackupId!).Success && originals.All(x => state.Read(x.Key) == x.Value), "Restore original bytes and binding");
            Assert(!state.Read(Targets.SingMixScript("fixture")).Exists, "Remove the newly created script on restore");
        });
        test("sing-mix detects stale profile selection, rollback failures and edited script conflicts", () =>
        {
            var state = new MemoryState(); var plan = RepairPlanner.Build(state, RepairPlanner.OneClickOptions); var journals = new MemoryJournals();
            state.Values[Targets.Profiles] = MemoryState.File("current: another\nitems: []\n");
            try { new RepairEngine(state, journals).Apply(plan); throw new Exception("Expected stale preview"); } catch (IOException) { }
            Assert(state.Writes == 0 && journals.List().Count == 0, "Subscription switch invalidates the preview before backup");
            state = new MemoryState(); var original = state.Values.ToArray(); state.FailAfterWrite = 4; journals = new MemoryJournals();
            var engine = new RepairEngine(state, journals);
            Assert(!engine.Apply(RepairPlanner.Build(state, RepairPlanner.OneClickOptions)).Success && original.All(x => state.Read(x.Key) == x.Value), "Failed install rolls all touched files back");
            Assert(!state.Read(Targets.SingMixScript("fixture")).Exists, "Rollback removes a new script");
            state = new MemoryState(); journals = new MemoryJournals(); engine = new RepairEngine(state, journals);
            var installed = engine.Apply(RepairPlanner.Build(state, RepairPlanner.OneClickOptions));
            state.Values[Targets.SingMixScript("fixture")] = MemoryState.File("// user edit\n");
            try { engine.Restore(installed.BackupId!); throw new Exception("Expected restore conflict"); } catch (InvalidOperationException) { }
            Assert(Encoding.UTF8.GetString(state.Read(Targets.SingMixScript("fixture")).Bytes()).Contains("user edit"), "Restore never overwrites later script edits");
        });
        test("sing-mix rejects unknown shapes, path traversal, unsafe filenames and option conflicts", () =>
        {
            foreach (var text in new[] { "current: '../escape'\nitems: []\n", "current: fixture\nitems: {}\n", "current: fixture\nitems: []\n", "current: fixture\nitems: [{uid: fixture, type: local, option: {script: []}}]\n" })
            {
                var state = new MemoryState(); state.Values[Targets.Profiles] = MemoryState.File(text);
                Reject(() => RepairPlanner.Build(state, RepairPlanner.OneClickOptions)); Assert(state.Writes == 0, "Read-only failure");
            }
            foreach (var key in new[] { "file:profiles/../../escape.js", "file:profiles/arbitrary.js", "file:profiles/behindrose-singmix-../escape.js", "file:profiles/behindrose-singmix-x.js\n" }) Reject(() => Targets.Validate(key));
            var fixture = new MemoryState(); fixture.Values[Targets.SingMixScript("fixture")] = MemoryState.File("existing private script");
            Reject(() => RepairPlanner.Build(fixture, RepairOptions.SingMix));
            Reject(() => RepairPlanner.Build(new MemoryState(), RepairOptions.SingMix | RepairOptions.ReplaceDns));
        });
        test("sing-mix leaves other subscriptions and their scripts untouched", () =>
        {
            var state = new MemoryState();
            state.Values[Targets.Verge] = MemoryState.File("enable_tun_mode: false\nenable_dns_settings: true\nprofile_dns_settings:\n  fixture: {enabled: true, confirmation: old}\n  other: {enabled: true, confirmation: keep}\n");
            var before = RepairPlanner.Parse(state.Read(Targets.Profiles).Bytes(), "profiles");
            var plan = RepairPlanner.Build(state, RepairOptions.SingMix);
            foreach (var change in plan.Changes) state.Values[change.Key] = change.After;
            var verge = RepairPlanner.Parse(state.Read(Targets.Verge).Bytes(), "verge"); var map = (YamlMappingNode)RepairPlanner.Get(verge, "profile_dns_settings")!;
            Assert(RepairPlanner.IsTrue((YamlMappingNode)RepairPlanner.Get(map, "other")!, "enabled"), "Other per-profile settings are preserved");
            var profiles = RepairPlanner.Parse(state.Read(Targets.Profiles).Bytes(), "profiles");
            var originalItem = ((YamlSequenceNode)RepairPlanner.Get(before, "items")!).Children[1];
            Assert(originalItem.Equals(((YamlSequenceNode)RepairPlanner.Get(profiles, "items")!).Children[1]), "Old script registration is retained");
        });
    }
}
