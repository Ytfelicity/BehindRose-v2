using System.Text;
using System.Text.Json;
using BehindRose.Core;
using BehindRose.Windows;
using YamlDotNet.RepresentationModel;

internal static class TunLivePreviewCheck
{
    // Explicit opt-in: read real configuration into memory, vary only the TUN
    // stack in a clone, and never invoke a write, service, core or UAC worker.
    public static int Run()
    {
        try
        {
            var live = new WindowsState(); var snapshots = new Dictionary<string, StoredValue>();
            StoredValue Read(string key)
            {
                if (!snapshots.TryGetValue(key, out var value)) snapshots[key] = value = live.Read(key);
                return value;
            }
            var original = Read(Targets.Config); var variants = new List<object>();
            foreach (string stack in new[] { "system", "gvisor", "mixed", "mips" })
            {
                var config = RepairPlanner.Parse(original.Bytes(), "只读协议栈检查");
                var tun = RepairPlanner.Get(config, "tun") as YamlMappingNode ?? throw new InvalidDataException();
                tun.Children[new YamlScalarNode("stack")] = new YamlScalarNode(stack);
                using var writer = new StringWriter(); new YamlStream(new YamlDocument(config)).Save(writer, false);
                var variant = StoredValue.File(Encoding.UTF8.GetBytes(writer.ToString()));
                var state = new ReadOnlyVariant(key => key == Targets.Config ? variant : Read(key));
                var plan = RepairPlanner.Build(state, RepairPlanner.OneClickOptions);
                var generated = RepairPlanner.Parse((plan.Changes.SingleOrDefault(x => x.Key == Targets.Config)?.After ?? variant).Bytes(), "生成预览");
                var finalTun = (YamlMappingNode)RepairPlanner.Get(generated, "tun")!;
                bool preserved = ((YamlScalarNode)RepairPlanner.Get(finalTun, "stack")!).Value == stack;
                var details = RepairPlanner.DescribeTun(plan);
                bool displayed = details.Single(x => x.Title == "TUN 模式堆栈").Detail.Equals(stack, StringComparison.OrdinalIgnoreCase);
                if (!preserved || !displayed) throw new InvalidOperationException();
                variants.Add(new { Stack = stack, PreviewAccepted = true, StackPreserved = preserved, PreviewDisplaysStack = displayed });
            }
            bool unchanged = snapshots.All(x => live.Read(x.Key) == x.Value);
            Console.WriteLine(JsonSerializer.Serialize(new { ReadOnly = true, RealDependenciesUnchanged = unchanged, Variants = variants, WritesPerformed = 0 }));
            return unchanged ? 0 : 1;
        }
        catch (Exception error) { Console.Error.WriteLine("Read-only TUN preview check failed: " + error.GetType().Name); return 1; }
    }
    private sealed class ReadOnlyVariant(Func<string, StoredValue> read) : IStateStore
    {
        public StoredValue Read(string key) => read(key);
        public void Write(string key, StoredValue value) => throw new InvalidOperationException("Read-only check");
        public void EnsureReady(bool needsClashExit) => throw new InvalidOperationException("Read-only check");
    }
}
