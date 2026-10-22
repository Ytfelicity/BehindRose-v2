using System.Text;
using System.Text.Json;
using BehindRose.Core;
using BehindRose.Windows;
using YamlDotNet.RepresentationModel;

if (args.Contains("--github-update-check")) return LiveUpdateCheck.RunAsync().GetAwaiter().GetResult();

if (args.Contains("--local-read-check"))
{
    try
    {
        var live = new WindowsState();
        var before = Targets.All.ToDictionary(target => target, target => live.Read(target));
        foreach (var target in Targets.All) Targets.ValidateValue(target, before[target]);
        var host = HostDiscovery.Find();
        var options = args.Contains("--ipv6-preview") ? RepairOptions.DisableClashIpv6 : RepairPlanner.OneClickOptions;
        var plan = host.Compatible ? RepairPlanner.Build(live, options) : null;
        bool unchanged = Targets.All.All(target => live.Read(target) == before[target]);
        Console.WriteLine(JsonSerializer.Serialize(new { ReadOnlyCheck = unchanged ? "passed" : "changed externally", HostVersion = host.Version, host.Running, host.Compatible, host.Note, PreviewChanges = plan?.Changes.Count, PreviewTitles = plan?.Changes.Select(x => x.Title), ClashIpv6 = RepairPlanner.InspectClashIpv6(live).State, TargetsUnchanged = unchanged, Findings = RepairPlanner.Inspect(live).Select(x => new { x.Title, x.State }) }));
        return 0;
    }
    catch (Exception ex) { Console.WriteLine("Read-only check failed: " + ex.GetType().Name); return 1; }
}

var tests = new List<(string Name, Action Test)>();
void Test(string name, Action action) => tests.Add((name, action));
void Assert(bool condition, string reason = "Assertion failed") { if (!condition) throw new Exception(reason); }
void Throws(Action action) { try { action(); } catch { return; } throw new Exception("Expected operation to fail"); }
string Text(StoredValue value) => Encoding.UTF8.GetString(value.Bytes());
(MemoryState State, MemoryJournals Journals, RepairEngine Engine) Environment()
{
    var state = new MemoryState(); var journals = new MemoryJournals(); return (state, journals, new(state, journals));
}

Test("TUN preserves unrelated values and leaves DNS bytes untouched", () =>
{
    var (s, j, engine) = Environment(); var dns = s.Read(Targets.Dns); var plan = RepairPlanner.Build(s, RepairOptions.Tun);
    Assert(plan.Changes.Count == 2); Assert(engine.Apply(plan).Success); Assert(s.Read(Targets.Dns) == dns);
    var yaml = RepairPlanner.Parse(s.Read(Targets.Config).Bytes(), "test"); var tun = (YamlMappingNode)RepairPlanner.Get(yaml, "tun")!;
    Assert(((YamlScalarNode)RepairPlanner.Get(tun, "mtu")!).Value == "1400");
    Assert(((YamlScalarNode)RepairPlanner.Get(tun, "stack")!).Value == "gvisor");
    Assert(RepairPlanner.Get(tun, "route-exclude-address") != null && RepairPlanner.Get(yaml, "rules") != null && RepairPlanner.Get(yaml, "hosts") != null);
    Assert(j.List().Single().Changes.All(x => Targets.IsFile(x.Key)));
});
Test("Repeated apply is byte-identical and creates no backup or process dependency", () =>
{
    var (s,j,e) = Environment(); e.Apply(RepairPlanner.Build(s, RepairOptions.Tun)); var before=s.Read(Targets.Config); int calls=s.ReadyCalls;
    var plan=RepairPlanner.Build(s, RepairOptions.Tun); Assert(plan.Changes.Count == 0); Assert(e.Apply(plan).State == "unchanged");
    Assert(s.Read(Targets.Config)==before && j.List().Count==1 && s.ReadyCalls==calls);
});
Test("One browser selection never modifies other browsers or files", () =>
{
    var (s,j,e)=Environment(); var config=s.Read(Targets.Config); var plan=RepairPlanner.Build(s,RepairOptions.ChromeDns);
    Assert(plan.Changes.Count==1 && !plan.NeedsClashExit); e.Apply(plan);
    Assert(s.Read(Targets.ChromeDns)==StoredValue.Text("off") && s.Read(Targets.EdgeDns)==StoredValue.Missing && s.Read(Targets.Config)==config);
});
Test("Browser-only changes work without a Clash configuration",()=>
{
    var (s,j,e)=Environment(); s.Values.Clear(); var plan=RepairPlanner.Build(s,RepairOptions.EdgeDns); Assert(e.Apply(plan).Success);
});
Test("DNS replacement refuses disabled host overrides",()=>
{
    var (s,j,e)=Environment(); s.Values[Targets.Verge]=MemoryState.File("enable_dns_settings: false\n"); Throws(()=>RepairPlanner.Build(s,RepairOptions.ReplaceDns)); Assert(s.Writes==0);
});
Test("DNS replacement preserves hosts, fallback, split DNS, exclusions and node resolver",()=>
{
    var (s,j,e)=Environment(); e.Apply(RepairPlanner.Build(s,RepairOptions.ReplaceDns)); var yaml=RepairPlanner.Parse(s.Read(Targets.Dns).Bytes(),"dns");
    foreach(var key in new[]{"hosts","fallback","nameserver-policy","fake-ip-filter","proxy-server-nameserver"}) Assert(RepairPlanner.Get(yaml,key)!=null,key);
    var resolver=(YamlSequenceNode)RepairPlanner.Get(yaml,"proxy-server-nameserver")!; Assert(((YamlScalarNode)resolver.Children[0]).Value=="9.9.9.9");
    Assert(j.List().Single().Changes.Count==1);
});
Test("YAML references fail before any write",()=>
{
    var (s,j,e)=Environment(); s.Values[Targets.Config]=MemoryState.File("a: &x [one]\nb: *x\n"); Throws(()=>RepairPlanner.Build(s,RepairOptions.Tun)); Assert(s.Writes==0);
});
Test("YAML merge keys and complex keys are refused",()=>
{
    Throws(()=>RepairPlanner.Parse(Encoding.UTF8.GetBytes("a:\n  <<: {a: b}\n"),"test"));
    Throws(()=>RepairPlanner.Parse(Encoding.UTF8.GetBytes("? [a, b]\n: c\n"),"test"));
});
Test("Multiple documents and duplicate keys are refused",()=>
{
    Throws(()=>RepairPlanner.Parse(Encoding.UTF8.GetBytes("a: b\n---\na: c\n"),"test"));
    Throws(()=>RepairPlanner.Parse(Encoding.UTF8.GetBytes("a: b\na: c\n"),"test"));
});
Test("Invalid TUN structure and unknown flags fail closed",()=>
{
    var(s,j,e)=Environment(); s.Values[Targets.Config]=MemoryState.File("tun: invalid\n"); Throws(()=>RepairPlanner.Build(s,RepairOptions.Tun));
    Throws(()=>RepairPlanner.Build(s,(RepairOptions)512)); Throws(()=>RepairPlanner.Build(s,RepairOptions.None));
});
Test("Preview detects any dependency change before backup or write",()=>
{
    var(s,j,e)=Environment(); var plan=RepairPlanner.Build(s,RepairOptions.Tun); s.Values[Targets.Config]=MemoryState.File("mixed-port: 1234\n");
    Throws(()=>e.Apply(plan)); Assert(s.Writes==0 && j.List().Count==0);
});
Test("Fingerprint binds options, original state and desired state",()=>
{
    var(s,j,e)=Environment(); var a=RepairPlanner.Build(s,RepairOptions.Tun); Assert(a.Fingerprint==RepairPlanner.Build(s,RepairOptions.Tun).Fingerprint);
    Assert(a.Fingerprint!=RepairPlanner.Build(s,RepairOptions.Tun|RepairOptions.ChromeDns).Fingerprint);
    s.Values[Targets.Config]=MemoryState.File(Text(s.Read(Targets.Config)).Replace("mixed-port: 7897", "mixed-port: 1111")); Assert(a.Fingerprint!=RepairPlanner.Build(s,RepairOptions.Tun).Fingerprint);
});
Test("Unready host aborts before creating backup",()=>
{
    var(s,j,e)=Environment(); s.ReadyFailure=true; Throws(()=>e.Apply(RepairPlanner.Build(s,RepairOptions.Tun))); Assert(s.Writes==0 && j.List().Count==0);
});
Test("Backup persistence failure causes no live write",()=>
{
    var(s,j,e)=Environment(); j.FailSave=true; Throws(()=>e.Apply(RepairPlanner.Build(s,RepairOptions.Tun))); Assert(s.Writes==0);
});
Test("Corrupted persisted backup blocks live writes",()=>
{
    var(s,j,e)=Environment(); j.CorruptLoad=true; Throws(()=>e.Apply(RepairPlanner.Build(s,RepairOptions.Tun))); Assert(s.Writes==0);
});
Test("A partially successful write is included in automatic rollback",()=>
{
    var(s,j,e)=Environment(); var original=s.Read(Targets.Config); s.FailAfterWrite=2;
    var result=e.Apply(RepairPlanner.Build(s,RepairOptions.Tun|RepairOptions.ChromeDns));
    Assert(!result.Success && result.State=="rolled-back"); Assert(s.Read(Targets.Config)==original && s.Read(Targets.ChromeDns)==StoredValue.Missing);
    Assert(Text(s.Read(Targets.Verge)).Contains("enable_tun_mode: false"));
});
Test("Rollback failure is recorded and can subsequently be recovered",()=>
{
    var(s,j,e)=Environment(); s.FailAfterWrite=2; s.FailBeforeWrites.Add(3);
    var result=e.Apply(RepairPlanner.Build(s,RepairOptions.Tun)); Assert(result.State=="rollback-failed");
    s.FailAfterWrite=0; s.FailBeforeWrites.Clear(); var recovered=e.Restore(result.BackupId!); Assert(recovered.Success);
    Assert(RepairPlanner.Build(s,RepairOptions.Tun).Changes.Count==2);
});
Test("An unfinished operation blocks new applications",()=>
{
    var(s,j,e)=Environment(); var plan=RepairPlanner.Build(s,RepairOptions.Tun); var journal=new Journal{Owner=j.Owner,State="applying",Changes=plan.Changes.ToList()}; j.Save(journal);
    Throws(()=>e.Apply(RepairPlanner.Build(s,RepairOptions.ChromeDns))); Assert(s.Writes==0);
});
Test("Crash recovery handles a mixture of before and after states",()=>
{
    var(s,j,e)=Environment(); var plan=RepairPlanner.Build(s,RepairOptions.Tun); var journal=new Journal{Owner=j.Owner,State="applying",Changes=plan.Changes.ToList()}; j.Save(journal);
    s.Values[plan.Changes[0].Key]=plan.Changes[0].After; Assert(e.Restore(journal.Id).Success); Assert(RepairPlanner.Build(s,RepairOptions.Tun).Changes.Count==2);
});
Test("Restore preserves later changes to unrelated files",()=>
{
    var(s,j,e)=Environment(); var applied=e.Apply(RepairPlanner.Build(s,RepairOptions.Tun)); var later=MemoryState.File("nameserver: [9.9.9.9]\n"); s.Values[Targets.Dns]=later;
    Assert(e.Restore(applied.BackupId!).Success); Assert(s.Read(Targets.Dns)==later);
});
Test("Restore refuses a later edit to a touched file",()=>
{
    var(s,j,e)=Environment(); var applied=e.Apply(RepairPlanner.Build(s,RepairOptions.Tun)); var later=MemoryState.File("mixed-port: 2222\n"); s.Values[Targets.Config]=later;
    int writes=s.Writes; Throws(()=>e.Restore(applied.BackupId!)); Assert(s.Writes==writes && s.Read(Targets.Config)==later);
});
Test("Restore failure rolls back to the state before restoration",()=>
{
    var(s,j,e)=Environment(); var applied=e.Apply(RepairPlanner.Build(s,RepairOptions.Tun)); var config=s.Read(Targets.Config); var verge=s.Read(Targets.Verge);
    s.FailAfterWrite=s.Writes+2; var result=e.Restore(applied.BackupId!); Assert(!result.Success && result.State=="rolled-back");
    Assert(s.Read(Targets.Config)==config && s.Read(Targets.Verge)==verge);
});
Test("Restoring a completed backup twice does not write",()=>
{
    var(s,j,e)=Environment(); var applied=e.Apply(RepairPlanner.Build(s,RepairOptions.ChromeDns)); Assert(e.Restore(applied.BackupId!).Success); int writes=s.Writes;
    Throws(()=>e.Restore(applied.BackupId!)); Assert(s.Writes==writes);
});
Test("A failed progress reporter never interrupts apply or rollback",()=>
{
    var(s,j,e)=Environment(); var result=e.Apply(RepairPlanner.Build(s,RepairOptions.ChromeDns),_=>throw new IOException("UI disconnected")); Assert(result.Success);
});
Test("Original unusual registry types round-trip unchanged",()=>
{
    var(s,j,e)=Environment(); var original=new StoredValue(true,"MultiString",Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(new[]{"a","中文"}))); s.Values[Targets.ChromeDns]=original;
    var result=e.Apply(RepairPlanner.Build(s,RepairOptions.ChromeDns)); Assert(e.Restore(result.BackupId!).Success); Assert(s.Read(Targets.ChromeDns)==original);
});
Test("Journal validation rejects paths, duplicate targets, identity and malformed integers",()=>
{
    var(s,j,e)=Environment(); var changes=RepairPlanner.Build(s,RepairOptions.ChromeDns).Changes.ToList();
    Throws(()=>JournalValidation.Validate(new Journal{Owner="other",Changes=changes},j.Owner));
    Throws(()=>JournalValidation.Validate(new Journal{Owner=j.Owner,Changes=[changes[0],changes[0]]},j.Owner));
    Throws(()=>JournalValidation.Validate(new Journal{Owner=j.Owner,Changes=[changes[0] with {Key="file:../secret"}]},j.Owner));
    Throws(()=>Targets.ValidateValue(Targets.ChromeDns,new(true,"DWord","YQ==")));
});
Test("Real atomic file writes preserve exact bytes",()=>
{
    string root=Path.Combine(System.Environment.CurrentDirectory,"test-files",Guid.NewGuid().ToString("N")); Directory.CreateDirectory(root); var path=Path.Combine(root,"sample.yaml");
    byte[] first=Encoding.UTF8.GetBytes("# 原始注释\r\na: 'yes'\r\n"), second=Encoding.UTF8.GetBytes("a: false\n");
    SafeFiles.AtomicWrite(path,first); Assert(SafeFiles.Read(path).SequenceEqual(first)); SafeFiles.AtomicWrite(path,second); Assert(SafeFiles.Read(path).SequenceEqual(second));
    Assert(Directory.GetFiles(root).Length==1);
});
Test("Local diagnostics never classifies missing evidence as safe",()=>
{
    var(s,j,e)=Environment(); var result=RepairPlanner.Inspect(s); Assert(result.All(x=>x.State is not ("安全" or "无泄漏" or "检测通过")));
    Assert(result.Any(x=>x.State=="建议核对"));
});
Test("One-click readiness requires both Firefox DNS policy and its lock",()=>
{
    var(s,j,e)=Environment(); e.Apply(RepairPlanner.Build(s,RepairPlanner.OneClickOptions));
    foreach(var lockValue in new[]{StoredValue.Missing,StoredValue.DWord(0)})
    {
        s.Values[Targets.FirefoxLock]=lockValue;
        Assert(RepairPlanner.Inspect(s).Single(x=>x.Title=="Firefox DNS").State=="待核对");
        var plan=RepairPlanner.Build(s,RepairPlanner.OneClickOptions);
        Assert(plan.Changes.Count==1 && plan.Changes[0].Key==Targets.FirefoxLock);
    }
    s.Values[Targets.FirefoxLock]=StoredValue.DWord(1);
    Assert(RepairPlanner.Inspect(s).Single(x=>x.Title=="Firefox DNS").State=="已配置");
});

IpPureTests.Register(Test);
HostCompatibilityTests.Register(Test);
ClashIpv6Tests.Register(Test);
ProxyNetworkTests.Register(Test);
UpdateTests.Register(Test);
VelopackTests.Register(Test);
SafeFilesTests.Register(Test);
ReleaseMetadataTests.Register(Test);
int failures=0;
foreach(var test in tests)
{
    try{test.Test(); Console.WriteLine("PASS "+test.Name);}catch(Exception ex){failures++;Console.WriteLine("FAIL "+test.Name+"\n"+ex);}
}
Console.WriteLine($"{tests.Count-failures}/{tests.Count} passed");
return failures==0?0:1;

sealed class MemoryState : IStateStore
{
    public Dictionary<string,StoredValue> Values {get;}=new()
    {
        [Targets.Verge]=File("enable_tun_mode: false\nenable_dns_settings: true\ncustom: preserve\n"),
        [Targets.Config]=File("mixed-port: 7897\ntun:\n  enable: false\n  stack: gvisor\n  mtu: 1400\n  route-exclude-address: [192.168.0.0/16]\nhosts:\n  example.test: 192.0.2.1\nrules: [MATCH,DIRECT]\n"),
        [Targets.Dns]=File("# existing\nenable: true\nnameserver: [223.5.5.5]\nhosts: {example.test: 192.0.2.1}\nfallback: [1.0.0.1]\nnameserver-policy: {'+.test': 9.9.9.9}\nfake-ip-filter: [example.test]\nproxy-server-nameserver: [9.9.9.9]\n")
    };
    public int Writes,FailAfterWrite,ReadyCalls;
    public bool ReadyFailure;
    public HashSet<int> FailBeforeWrites {get;}=[];
    public static StoredValue File(string text)=>StoredValue.File(Encoding.UTF8.GetBytes(text));
    public StoredValue Read(string key)=>Values.GetValueOrDefault(key,StoredValue.Missing);
    public void Write(string key,StoredValue value){Writes++;if(FailBeforeWrites.Contains(Writes))throw new IOException("injected before write");Values[key]=value;if(Writes==FailAfterWrite)throw new IOException("injected after write");}
    public void EnsureReady(bool needsClashExit){ReadyCalls++;if(ReadyFailure)throw new IOException("host running");}
}
sealed class MemoryJournals : IJournalStore
{
    private readonly Dictionary<string,string> values=[];
    public bool FailSave,CorruptLoad;
    public string Owner=>"test-owner";
    public void Save(Journal journal){if(FailSave)throw new IOException("injected backup failure");JournalValidation.Validate(journal,Owner);values[journal.Id]=JsonSerializer.Serialize(journal);}
    public Journal Load(string id){var j=JsonSerializer.Deserialize<Journal>(values[id])!;if(CorruptLoad)j.Owner="wrong";return j;}
    public IReadOnlyList<Journal> List()=>values.Keys.Select(Load).ToList();
}
