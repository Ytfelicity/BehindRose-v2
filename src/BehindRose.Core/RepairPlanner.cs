using System.Globalization;
using System.Text;
using YamlDotNet.Core;
using YamlDotNet.Core.Events;
using YamlDotNet.RepresentationModel;

namespace BehindRose.Core;

public static class RepairPlanner
{
    public const RepairOptions OneClickOptions = RepairOptions.Tun | RepairOptions.ChromeDns | RepairOptions.EdgeDns | RepairOptions.FirefoxDns | RepairOptions.DisableClashIpv6;
    public const RepairOptions AllowedOptions = RepairOptions.Tun | RepairOptions.ChromeDns | RepairOptions.EdgeDns | RepairOptions.FirefoxDns | RepairOptions.ReplaceDns | RepairOptions.DisableClashIpv6;

    public static RepairPlan Build(IStateStore store, RepairOptions options)
    {
        if ((options & ~AllowedOptions) != 0 || options == RepairOptions.None) throw new InvalidDataException("请至少选择一项修改。");
        var expected = new Dictionary<string, StoredValue>(StringComparer.Ordinal);
        var changes = new List<Change>();
        StoredValue Read(string key)
        {
            var value = store.Read(key); Targets.ValidateValue(key, value); expected[key] = value; return value;
        }
        if ((options & (RepairOptions.Tun | RepairOptions.ReplaceDns | RepairOptions.DisableClashIpv6)) != 0)
        {
            var vergeValue = Read(Targets.Verge);
            var configValue = Read(Targets.Config);
            if (!vergeValue.Exists || !configValue.Exists) throw new InvalidDataException("没有找到完整的 Clash Verge Rev 配置。请先启动客户端并导入自己的订阅。");
            var verge = Parse(vergeValue.Bytes(), "verge.yaml");
            var config = Parse(configValue.Bytes(), "config.yaml");
            ValidateClashShape(verge, config);
            if (options.HasFlag(RepairOptions.Tun))
            {
                var changedVerge = Set(verge, "enable_tun_mode", "true");
                var tun = Mapping(config, "tun", true, out bool changedConfig);
                foreach (var key in new[] { "enable", "auto-route", "strict-route", "auto-detect-interface" }) changedConfig |= Set(tun, key, "true");
                if (Get(tun, "stack") is null) changedConfig |= Set(tun, "stack", "mixed");
                var existing = Get(tun, "dns-hijack");
                if (existing is not null and not YamlSequenceNode) throw new InvalidDataException("DNS 接管配置不是列表，暂不自动修改。");
                var hijacks = existing as YamlSequenceNode ?? new YamlSequenceNode();
                if (hijacks.Children.Any(x => x is not YamlScalarNode)) throw new InvalidDataException("DNS 接管配置含复杂项，暂不自动修改。");
                foreach (var value in new[] { "any:53", "tcp://any:53" })
                    if (!hijacks.Children.OfType<YamlScalarNode>().Any(x => x.Value == value)) { hijacks.Add(value); changedConfig = true; }
                tun.Children[new YamlScalarNode("dns-hijack")] = hijacks;
                if (changedVerge) changes.Add(FileChange(Targets.Verge, "Clash 的 TUN 开关", "当前配置", "开启 TUN", vergeValue, verge));
                if (changedConfig) changes.Add(FileChange(Targets.Config, "系统路由与 DNS 接管", "当前配置", "自动路由、严格路由与 DNS 接管", configValue, config));
            }
            if (options.HasFlag(RepairOptions.DisableClashIpv6))
            {
                ValidateBoolean(config, "ipv6", "config.yaml", false);
                string before = Get(config, "ipv6") is null ? "未设置（沿用客户端默认值）" : IsTrue(config, "ipv6") ? "已开启（ipv6: true）" : "已关闭（ipv6: false）";
                if (Set(config, "ipv6", "false"))
                {
                    int index = changes.FindIndex(x => x.Key == Targets.Config);
                    var change = FileChange(Targets.Config, index < 0 ? "关闭 Clash IPv6" : "系统路由、DNS 接管与 Clash IPv6",
                        index < 0 ? before : "当前配置", index < 0 ? "关闭（ipv6: false）；重新打开 Clash 后生效" : "自动路由、严格路由、DNS 接管；关闭 Clash IPv6", configValue, config);
                    if (index < 0) changes.Add(change); else changes[index] = change;
                }
            }
            if (options.HasFlag(RepairOptions.ReplaceDns))
            {
                var dnsValue = Read(Targets.Dns);
                if (!IsTrue(verge, "enable_dns_settings") || !dnsValue.Exists) throw new InvalidDataException("宿主 DNS 设置尚未启用，不能替换默认 DNS。请取消此选项，或先在 Clash 中确认 DNS 设置。");
                var dnsRoot = Parse(dnsValue.Bytes(), "dns_config.yaml");
                var dns = Get(dnsRoot, "dns") == null ? dnsRoot : Mapping(dnsRoot, "dns", false, out _);
                ValidateBoolean(dns, "enable", "dns_config.yaml / dns", false);
                ValidateStringList(dns, "nameserver", "dns_config.yaml / dns");
                var changed = Set(dns, "enable", "true");
                var names = new[] { "https://1.1.1.1/dns-query#RULES", "https://8.8.8.8/dns-query#RULES" };
                if (Get(dns, "nameserver") is not YamlSequenceNode current || !current.Children.OfType<YamlScalarNode>().Select(x => x.Value).SequenceEqual(names) || current.Children.Count != names.Length)
                { dns.Children[new YamlScalarNode("nameserver")] = new YamlSequenceNode(names.Select(x => new YamlScalarNode(x))); changed = true; }
                if (Get(dns, "proxy-server-nameserver") is null)
                { dns.Children[new YamlScalarNode("proxy-server-nameserver")] = new YamlSequenceNode(new YamlScalarNode("119.29.29.29"), new YamlScalarNode("223.5.5.5")); changed = true; }
                if (changed) changes.Add(FileChange(Targets.Dns, "默认 DNS 服务器", "当前服务器", "Cloudflare / Google DoH（遵循原分流）", dnsValue, dnsRoot));
            }
        }
        void Policy(string key, string title, StoredValue after)
        {
            var before = Read(key);
            if (before != after) changes.Add(new Change(key, title, before.Exists ? "已有策略" : "未设置策略", "跟随系统 DNS（重启浏览器后复检）", before, after));
        }
        if (options.HasFlag(RepairOptions.ChromeDns)) Policy(Targets.ChromeDns, "Chrome DNS", StoredValue.Text("off"));
        if (options.HasFlag(RepairOptions.EdgeDns)) Policy(Targets.EdgeDns, "Edge DNS", StoredValue.Text("off"));
        if (options.HasFlag(RepairOptions.FirefoxDns))
        {
            Policy(Targets.FirefoxDns, "Firefox DNS", StoredValue.DWord(0));
            Policy(Targets.FirefoxLock, "Firefox DNS 设置锁定", StoredValue.DWord(1));
        }
        return new RepairPlan(options, expected, changes);
    }

    public static IReadOnlyList<Finding> Inspect(IStateStore store)
    {
        var findings = new List<Finding>();
        try
        {
            var verge = store.Read(Targets.Verge); var config = store.Read(Targets.Config);
            if (!verge.Exists || !config.Exists) findings.Add(new("Clash 配置", "请启动 Clash Verge Rev 并导入自己的订阅。", "未找到"));
            else
            {
                var v = Parse(verge.Bytes(), "verge.yaml"); var c = Parse(config.Bytes(), "config.yaml");
                ValidateClashShape(v, c);
                var tun = Get(c, "tun") as YamlMappingNode;
                bool ready = IsTrue(v, "enable_tun_mode") && tun != null && new[] { "enable", "auto-route", "strict-route", "auto-detect-interface" }.All(x => IsTrue(tun, x));
                var hijacks = tun is null ? null : Get(tun, "dns-hijack") as YamlSequenceNode;
                ready &= hijacks != null && new[] { "any:53", "tcp://any:53" }.All(x => hijacks.Children.OfType<YamlScalarNode>().Any(y => y.Value == x));
                findings.Add(new("系统流量接管", ready ? "配置已包含 TUN 与 DNS 接管；运行效果还需网络采样。" : "若希望系统请求由 Clash 接管，可查看建议。此状态本身不代表泄漏。", ready ? "已配置" : "建议核对"));
            }
        }
        catch (Exception ex) when (ex is InvalidDataException or YamlException or IOException)
        { findings.Add(new("Clash 配置", ex.Message, "无法自动修改")); }
        foreach (var (key, label, target) in new[] { (Targets.ChromeDns, "Chrome DNS", StoredValue.Text("off")), (Targets.EdgeDns, "Edge DNS", StoredValue.Text("off")), (Targets.FirefoxDns, "Firefox DNS", StoredValue.DWord(0)) })
        {
            var value = store.Read(key);
            bool configured = value == target && (key != Targets.FirefoxDns || store.Read(Targets.FirefoxLock) == StoredValue.DWord(1));
            findings.Add(new(label, configured ? "策略已配置；重启浏览器后核对实际生效情况。" : key == Targets.FirefoxDns ? "Firefox DNS 或锁定策略尚未完整配置。" : "未配置为跟随系统 DNS；需结合浏览器设置与实际采样判断。", configured ? "已配置" : "待核对"));
        }
        return findings;
    }

    public static Finding InspectClashIpv6(IStateStore store)
    {
        try
        {
            var value = store.Read(Targets.Config); Targets.ValidateValue(Targets.Config, value);
            if (!value.Exists) return new("Clash IPv6", "没有找到 config.yaml。", "未找到");
            var config = Parse(value.Bytes(), "config.yaml");
            ValidateBoolean(config, "ipv6", "config.yaml", false);
            if (Get(config, "ipv6") is null) return new("Clash IPv6", "未显式设置，沿用客户端默认值；可预览关闭。", "未设置");
            return IsTrue(config, "ipv6")
                ? new("Clash IPv6", "配置文件中 ipv6: true；关闭前可查看修改预览。", "已开启")
                : new("Clash IPv6", "配置文件中 ipv6: false；重新打开 Clash 后核对运行效果。", "已关闭");
        }
        catch (InvalidDataException ex) { return new("Clash IPv6", ex.Message, "无法自动修改"); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Security.SecurityException)
        { return new("Clash IPv6", "无法读取 Clash 配置，请检查访问权限后刷新。", "无法自动修改"); }
    }

    // Read-only capability check, shared by discovery, planning and inspection.
    // A version number is diagnostic metadata, not proof of the YAML schema.
    public static void ValidateClashConfiguration(IStateStore store)
    {
        var verge = store.Read(Targets.Verge); var config = store.Read(Targets.Config);
        Targets.ValidateValue(Targets.Verge, verge); Targets.ValidateValue(Targets.Config, config);
        if (!verge.Exists || !config.Exists) throw new InvalidDataException("缺少 verge.yaml 或 config.yaml，请先启动 Clash Verge Rev 并导入配置。");
        ValidateClashShape(Parse(verge.Bytes(), "verge.yaml"), Parse(config.Bytes(), "config.yaml"));
    }

    private static void ValidateClashShape(YamlMappingNode verge, YamlMappingNode config)
    {
        // These anchors distinguish the persisted Verge / core configurations
        // from arbitrary or renamed mappings. Do not silently create a new schema.
        ValidateBoolean(verge, "enable_tun_mode", "verge.yaml", true);
        if (Get(config, "tun") is not YamlMappingNode tun) throw new InvalidDataException("config.yaml 的 tun 必须是已存在的配置映射。");
        // Verge's use_tun supplies this optional core flag at runtime. An
        // absent flag is supported; an existing flag with the wrong type is not.
        ValidateBoolean(tun, "enable", "config.yaml / tun", false);
        foreach (var key in new[] { "auto-route", "strict-route", "auto-detect-interface" }) ValidateBoolean(tun, key, "config.yaml / tun", false);
        if (Get(tun, "stack") is { } stack && (stack is not YamlScalarNode scalar || scalar.Value is null || !new[] { "system", "gvisor", "mixed" }.Contains(scalar.Value, StringComparer.OrdinalIgnoreCase)))
            throw new InvalidDataException("config.yaml / tun 的 stack 无法识别，未生成自动修改方案。");
        ValidateStringList(tun, "dns-hijack", "config.yaml / tun");
    }

    private static void ValidateBoolean(YamlMappingNode mapping, string key, string scope, bool required)
    {
        var value = Get(mapping, key);
        if (value is null && !required) return;
        if (value is not YamlScalarNode scalar || scalar.Style is not (ScalarStyle.Plain or ScalarStyle.Any)
            || !scalar.Tag.IsEmpty && scalar.Tag.Value != "tag:yaml.org,2002:bool"
            || !string.Equals(scalar.Value, "true", StringComparison.OrdinalIgnoreCase) && !string.Equals(scalar.Value, "false", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException(scope + " 的 " + key + " 必须是可识别的布尔值。");
    }

    private static void ValidateStringList(YamlMappingNode mapping, string key, string scope)
    {
        if (Get(mapping, key) is not { } value) return;
        if (value is not YamlSequenceNode list || list.Children.Any(item => item is not YamlScalarNode scalar || string.IsNullOrWhiteSpace(scalar.Value)))
            throw new InvalidDataException(scope + " 的 " + key + " 必须是字符串列表。");
    }

    private static Change FileChange(string key, string title, string beforeText, string afterText, StoredValue before, YamlMappingNode root)
        => new(key, title, beforeText, afterText, before, StoredValue.File(Serialize(root)));
    public static YamlMappingNode Parse(byte[] bytes, string name)
    {
        try { return ParseMapping(bytes, name); }
        catch (YamlException) { throw new InvalidDataException(name + " 的 YAML 格式无法识别，未生成自动修改方案。"); }
        catch (DecoderFallbackException) { throw new InvalidDataException(name + " 编码无法读取，请检查 UTF-8 编码后刷新。"); }
    }
    private static YamlMappingNode ParseMapping(byte[] bytes, string name)
    {
        if (bytes.Length > 8 * 1024 * 1024) throw new InvalidDataException(name + " 文件过大。");
        using var reader = new StreamReader(new MemoryStream(bytes), new UTF8Encoding(false, true), true);
        var text = reader.ReadToEnd();
        var parser = new Parser(new StringReader(text)); int depth = 0;
        while (parser.MoveNext())
        {
            if (parser.Current is AnchorAlias) throw new InvalidDataException(name + " 含 YAML 引用，暂不自动修改。");
            if (parser.Current is MappingStart or SequenceStart) depth++;
            if (parser.Current is MappingEnd or SequenceEnd) depth--;
            if (depth > 48) throw new InvalidDataException(name + " 嵌套层数过多。");
        }
        var yaml = new YamlStream(); yaml.Load(new StringReader(text));
        if (yaml.Documents.Count != 1 || yaml.Documents[0].RootNode is not YamlMappingNode root) throw new InvalidDataException(name + " 必须是单个 YAML 映射。");
        ValidateNodes(root); return root;
    }
    private static void ValidateNodes(YamlNode node)
    {
        if (node is YamlMappingNode map)
            foreach (var entry in map.Children)
            {
                if (entry.Key is not YamlScalarNode key || key.Value == "<<") throw new InvalidDataException("暂不自动修改复杂键或合并键。");
                ValidateNodes(entry.Value);
            }
        if (node is YamlSequenceNode sequence) foreach (var child in sequence.Children) ValidateNodes(child);
    }
    private static byte[] Serialize(YamlMappingNode root)
    {
        using var writer = new StringWriter(CultureInfo.InvariantCulture);
        new YamlStream(new YamlDocument(root)).Save(writer, false);
        var bytes = new UTF8Encoding(false).GetBytes(writer.ToString()); Parse(bytes, "生成的配置"); return bytes;
    }
    public static YamlNode? Get(YamlMappingNode node, string key) => node.Children.TryGetValue(new YamlScalarNode(key), out var value) ? value : null;
    public static bool IsTrue(YamlMappingNode node, string key) => Get(node, key) is YamlScalarNode s && string.Equals(s.Value, "true", StringComparison.OrdinalIgnoreCase);
    private static bool Set(YamlMappingNode node, string key, string value)
    {
        if (Get(node, key) is YamlScalarNode current && string.Equals(current.Value, value, StringComparison.OrdinalIgnoreCase)) return false;
        node.Children[new YamlScalarNode(key)] = new YamlScalarNode(value); return true;
    }
    private static YamlMappingNode Mapping(YamlMappingNode parent, string key, bool create, out bool created)
    {
        created = false; var value = Get(parent, key);
        if (value == null && create) { var map = new YamlMappingNode(); parent.Children[new YamlScalarNode(key)] = map; created = true; return map; }
        return value as YamlMappingNode ?? throw new InvalidDataException(key + " 必须是映射。");
    }
}
