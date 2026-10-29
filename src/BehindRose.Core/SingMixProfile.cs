using System.Text;
using YamlDotNet.RepresentationModel;

namespace BehindRose.Core;

public static class SingMixProfile
{
    private const string Header = "// BehindRose DNS protection v1";
    private const string BodyMarker = "// BehindRose DNS protection body\n";
    public static string Source { get; } = LoadSource();
    private static string LoadSource()
    {
        using var stream = typeof(SingMixProfile).Assembly.GetManifestResourceStream("BehindRose.Core.Profiles.dns-protection.js")
            ?? throw new InvalidOperationException("缺少内置 DNS 防护脚本。");
        using var reader = new StreamReader(stream, Encoding.UTF8); return reader.ReadToEnd();
    }

    internal static bool Configure(Func<string, StoredValue> read, YamlMappingNode verge, List<Change> changes)
    {
        var before = read(Targets.Profiles);
        if (!before.Exists) throw new InvalidDataException("缺少 profiles.yaml，请先在 Clash 中导入订阅；已有配置时无需启动客户端。");
        var profiles = RepairPlanner.Parse(before.Bytes(), "profiles.yaml");
        var uid = (RepairPlanner.Get(profiles, "current") as YamlScalarNode)?.Value;
        if (string.IsNullOrEmpty(uid)) throw new InvalidDataException("没有选中的订阅，请先在 Clash 中选择需要配置的订阅。");
        var runtimeValue = read(Targets.RuntimeSource);
        if (!runtimeValue.Exists) throw new InvalidDataException("缺少已生成的本机运行配置，请先在 Clash 加载自己的订阅，再退出客户端生成预览。");
        var runtime = RepairPlanner.Parse(runtimeValue.Bytes(), "本机运行配置");
        var route = (RepairPlanner.Get(runtime, "rules") as YamlSequenceNode)?.Children.OfType<YamlScalarNode>()
            .Select(x => x.Value ?? "").FirstOrDefault(x => x.StartsWith("MATCH,", StringComparison.OrdinalIgnoreCase))?.Split(',').ElementAtOrDefault(1);
        var names = new[] { "proxies", "proxy-groups" }.SelectMany(key =>
            (RepairPlanner.Get(runtime, key) as YamlSequenceNode)?.Children.OfType<YamlMappingNode>()
                .Select(x => (RepairPlanner.Get(x, "name") as YamlScalarNode)?.Value) ?? []);
        if (route is null || route is "DIRECT" or "REJECT" or "PASS" || !names.Contains(route))
            throw new InvalidDataException("无法从本机分流确定 DNS 的代理出口，请先在 Clash 设置默认代理分流。不会创建新的策略组。");
        var target = Targets.SingMixScript(uid);
        if (RepairPlanner.Get(profiles, "items") is not YamlSequenceNode items || items.Children.Any(x => x is not YamlMappingNode))
            throw new InvalidDataException("profiles.yaml 的 items 必须是订阅列表。");
        var matches = items.Children.OfType<YamlMappingNode>().Where(x => (RepairPlanner.Get(x, "uid") as YamlScalarNode)?.Value == uid).ToArray();
        if (matches.Length != 1 || (RepairPlanner.Get(matches[0], "type") as YamlScalarNode)?.Value is not ("local" or "remote"))
            throw new InvalidDataException("当前订阅记录无法识别，未生成 DNS 防护方案。");
        var current = matches[0];
        var scriptUid = "behindrose-singmix-" + uid;
        var registered = items.Children.OfType<YamlMappingNode>().Where(x => (RepairPlanner.Get(x, "uid") as YamlScalarNode)?.Value == scriptUid).ToArray();
        var filename = scriptUid + ".js";
        if (registered.Length > 1 || registered.Any(x => (RepairPlanner.Get(x, "type") as YamlScalarNode)?.Value != "script" || (RepairPlanner.Get(x, "file") as YamlScalarNode)?.Value != filename))
            throw new InvalidDataException("DNS 防护脚本登记冲突，请先检查当前订阅。");
        var option = RepairPlanner.Mapping(current, "option", true, out bool changedProfiles);
        if (RepairPlanner.Get(option, "script") is { } existing && existing is not YamlScalarNode)
            throw new InvalidDataException("当前订阅的 script 不是脚本编号。");
        var original = read(target);
        string prefix;
        if ((RepairPlanner.Get(option, "script") as YamlScalarNode)?.Value == scriptUid && original.Exists)
        {
            var text = Encoding.UTF8.GetString(original.Bytes());
            int marker = text.LastIndexOf(BodyMarker, StringComparison.Ordinal);
            if (!text.StartsWith(Header, StringComparison.Ordinal) || marker < 0)
                throw new InvalidDataException("当前订阅仍绑定旧版模板，请先在恢复记录还原该次配置，再使用沿用本机分流的 DNS 防护。");
            prefix = text[..(marker + BodyMarker.Length)];
        }
        else
        {
            if (original.Exists) throw new InvalidDataException("DNS 防护目标已有其他内容，未自动覆盖。");
            string previousScript = "";
            if ((RepairPlanner.Get(option, "script") as YamlScalarNode)?.Value is { Length: > 0 } oldUid)
            {
                var prior = items.Children.OfType<YamlMappingNode>().Where(x => (RepairPlanner.Get(x, "uid") as YamlScalarNode)?.Value == oldUid).ToArray();
                if (prior.Length != 1 || (RepairPlanner.Get(prior[0], "type") as YamlScalarNode)?.Value != "script"
                    || (RepairPlanner.Get(prior[0], "file") as YamlScalarNode)?.Value is not { Length: > 0 } filenameBefore)
                    throw new InvalidDataException("原订阅脚本登记不完整，未改写脚本绑定。");
                var previous = read(Targets.ScriptSource(filenameBefore));
                if (!previous.Exists) throw new InvalidDataException("原订阅脚本文件缺失，未改写脚本绑定。");
                previousScript = Encoding.UTF8.GetString(previous.Bytes());
            }
            if (previousScript.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(previousScript, @"(?:function\s+main\s*\(|(?:const|let|var)\s+main\s*=)"))
                throw new InvalidDataException("原订阅脚本缺少可识别的 main 入口，未覆盖原脚本。");
            prefix = Header + "\n" + (previousScript.Length == 0 ? "const behindRoseOriginalMain = null;\n"
                : "const behindRoseOriginalMain = (function () {\n" + previousScript
                    + "\nreturn typeof main === 'function' ? main : null;\n})();\n") + BodyMarker;
        }
        if (registered.Length == 0)
        {
            items.Add(new YamlMappingNode { { "uid", scriptUid }, { "type", "script" }, { "name", "DNS 防护（沿用本机分流）" }, { "file", filename } });
            changedProfiles = true;
        }
        // Identifiers are case-sensitive, unlike boolean settings.
        if ((RepairPlanner.Get(option, "script") as YamlScalarNode)?.Value != scriptUid)
        { option.Children[new YamlScalarNode("script")] = new YamlScalarNode(scriptUid); changedProfiles = true; }
        if (changedProfiles) changes.Add(RepairPlanner.FileChange(Targets.Profiles, "当前订阅的 DNS 防护", "当前脚本绑定（原脚本文件保留）",
            "先执行原脚本，再增量修复 DNS；保留节点、策略组和原有分流", before, profiles));

        var after = StoredValue.File(Encoding.UTF8.GetBytes(prefix + Source));
        if (original != after) changes.Add(new(target, "DNS 防护（沿用本机代理）", "当前订阅的原脚本和分流",
            $"DNS 沿用「{route}」组；6 个检测站点经代理；网易／战网直连；保留原有节点、策略组与规则", original, after));

        RepairPlanner.ValidateBoolean(verge, "enable_dns_settings", "verge.yaml", false);
        bool changedVerge = RepairPlanner.Set(verge, "enable_dns_settings", "false");
        var settings = RepairPlanner.Mapping(verge, "profile_dns_settings", true, out bool createdSettings);
        var entry = RepairPlanner.Mapping(settings, uid, true, out bool createdEntry);
        RepairPlanner.ValidateBoolean(entry, "enabled", "当前订阅 DNS 覆写", false);
        changedVerge |= createdSettings | createdEntry | RepairPlanner.Set(entry, "enabled", "false");
        changedVerge |= entry.Children.Remove(new YamlScalarNode("confirmation"));
        return changedVerge;
    }

    public static Finding Inspect(IStateStore state)
    {
        try
        {
            var plan = RepairPlanner.Build(state, RepairOptions.SingMix);
            return new("沿用本机代理的 DNS 防护", plan.Changes.Count == 0
                ? "增量脚本已保存，原分流保留；重新打开 Clash 后检测 DNS。此状态不代表实测无泄漏。"
                : "尚未安装增量 DNS 防护；将沿用本机代理组和分流，不生成新的全部／AI 策略组。", plan.Changes.Count == 0 ? "已配置" : "待配置");
        }
        catch (Exception ex) when (ex is InvalidDataException or IOException or UnauthorizedAccessException)
        { return new("沿用本机代理的 DNS 防护", ex.Message, "无法自动修改"); }
    }
}
