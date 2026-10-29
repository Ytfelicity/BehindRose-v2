using System.Text;
using System.Text.Json;
using BehindRose.Core;

namespace BehindRose.Desktop;

public sealed class DemoState : IStateStore
{
    private readonly Dictionary<string, StoredValue> values = new()
    {
        [Targets.Verge] = StoredValue.File(Encoding.UTF8.GetBytes("enable_tun_mode: false\nenable_dns_settings: true\n")),
        [Targets.Config] = StoredValue.File(Encoding.UTF8.GetBytes("mixed-port: 7897\ntun:\n  enable: false\n  stack: mixed\nrules:\n- MATCH,DIRECT\n")),
        [Targets.Dns] = StoredValue.File(Encoding.UTF8.GetBytes("enable: true\nnameserver:\n- 223.5.5.5\n")),
        [Targets.RuntimeSource] = StoredValue.File(Encoding.UTF8.GetBytes("proxies: [{name: demo-node, type: vless}]\nproxy-groups: [{name: Existing, type: select, proxies: [demo-node]}]\nrules: [\"MATCH,Existing\"]\n")),
        [Targets.Profiles] = StoredValue.File(Encoding.UTF8.GetBytes("current: demo\nitems:\n- uid: demo\n  type: local\n  file: demo.yaml\n"))
    };
    public StoredValue Read(string key) { Targets.Validate(key); return values.GetValueOrDefault(key, StoredValue.Missing); }
    public void Write(string key, StoredValue value) { Targets.ValidateValue(key, value); values[key] = value; }
    public void EnsureReady(bool needsClashExit) { }
}
public sealed class DemoJournals : IJournalStore
{
    private readonly Dictionary<string, string> journals = [];
    public string Owner => "demo-only";
    public void Save(Journal journal) { JournalValidation.Validate(journal, Owner); journals[journal.Id] = JsonSerializer.Serialize(journal); }
    public Journal Load(string id) => JsonSerializer.Deserialize<Journal>(journals[id])!;
    public IReadOnlyList<Journal> List() => journals.Keys.Select(Load).OrderByDescending(x => x.CreatedAt).ToList();
}
