using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace BehindRose.Core;

public sealed record ClaudeConfigurationChange(string Title, string BeforeText, string AfterText);
public sealed record ClaudeConfigurationPreview(string Mode, int ProxyPort, string Action, string Fingerprint,
    bool HasChanges, ClaudeConfigurationChange[] Changes, string[] Warnings);
public sealed record ClaudeConfigurationStatus(bool SettingsFound, bool CanConfigure, string Route,
    int? ConfiguredProxyPort, int[] SuggestedProxyPorts, string[] ConflictingEnvironmentVariables,
    string[] CustomModelVariables, string[] Warnings);
public sealed record ClaudeConfigurationResult(bool Success, string State, string Message, string? BackupId = null);
public sealed record ClaudeConfigurationBackup(string Id, DateTimeOffset? CreatedAt, string Mode, bool CanRestore, string State);

public sealed record ClaudeConfigurationDraft(
    [property: JsonIgnore] byte[] After, ClaudeConfigurationChange[] Changes, string[] Warnings);

/// <summary>Pure JSON planning. It has no filesystem, environment, process or network access.</summary>
public static class ClaudeConfigurationPlanner
{
    public const int MaximumSettingsBytes = 1024 * 1024;
    public static readonly string[] ProviderVariables = [
        "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY",
        "ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_VERTEX_BASE_URL", "ANTHROPIC_FOUNDRY_BASE_URL",
        "ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_FOUNDRY_RESOURCE",
        "CLAUDE_CODE_SKIP_BEDROCK_AUTH", "CLAUDE_CODE_SKIP_VERTEX_AUTH", "CLAUDE_CODE_SKIP_FOUNDRY_AUTH"
    ];
    public static readonly string[] ModelVariables = [
        "ANTHROPIC_MODEL", "ANTHROPIC_REASONING_MODEL", "ANTHROPIC_SMALL_FAST_MODEL", "ANTHROPIC_DEFAULT_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "ANTHROPIC_DEFAULT_FABLE_MODEL", "ANTHROPIC_CUSTOM_MODEL_OPTION", "CLAUDE_CODE_SUBAGENT_MODEL"
    ];
    public static readonly string[] ProxyVariables = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];
    private static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true };

    public static JsonObject Parse(byte[]? bytes)
    {
        if (bytes is null) return new JsonObject();
        if (bytes.Length > MaximumSettingsBytes) throw Invalid();
        try
        {
            // Accept a UTF-8 BOM from Windows editors without allowing invalid UTF-8.
            string text = new UTF8Encoding(false, true).GetString(bytes);
            if (text.StartsWith('\uFEFF')) text = text[1..];
            using var document = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 32 });
            ValidateUnique(document.RootElement);
            if (document.RootElement.ValueKind != JsonValueKind.Object) throw Invalid();
            var root = JsonNode.Parse(text, documentOptions: new JsonDocumentOptions { MaxDepth = 32 })!.AsObject();
            if (root.TryGetPropertyValue("env", out var envNode))
            {
                if (envNode is not JsonObject env || env.Any(item => item.Value is not JsonValue value || !value.TryGetValue<string>(out _))) throw Invalid();
                if (env.Select(item => item.Key).Distinct(StringComparer.OrdinalIgnoreCase).Count() != env.Count) throw Invalid();
            }
            if (root.TryGetPropertyValue("model", out var model) && (model is not JsonValue mv || !mv.TryGetValue<string>(out _))) throw Invalid();
            return root;
        }
        catch (Exception error) when (error is JsonException or DecoderFallbackException or InvalidOperationException or FormatException)
        { throw Invalid(); }
    }

    private static void ValidateUnique(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in element.EnumerateObject())
            {
                if (!keys.Add(item.Name)) throw Invalid();
                ValidateUnique(item.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
            foreach (var item in element.EnumerateArray()) ValidateUnique(item);
    }

    public static ClaudeConfigurationDraft Build(byte[]? before, string mode, int proxyPort, string[]? externalConflicts = null)
    {
        if (mode is not ("preserve" or "official")) throw new InvalidDataException("请选择保留当前接入方式或官方订阅。");
        if (proxyPort is < 1 or > 65535) throw new InvalidDataException("HTTP / 混合代理端口必须在 1–65535 之间。");
        var root = Parse(before);
        var env = root["env"] as JsonObject ?? new JsonObject();
        if (root["env"] is null) root["env"] = env;
        var changes = new List<ClaudeConfigurationChange>();
        var warnings = new List<string>();
        if (mode == "official")
        {
            if (root.ContainsKey("forceLoginOrgUUID"))
                throw new InvalidOperationException("配置限定了登录组织。请先自行确认组织要求，再切换官方订阅模式；本工具不会移除组织限制。");
            var removed = env.Select(item => item.Key).Where(IsProviderOrModelVariable).ToArray();
            foreach (var key in removed) env.Remove(key);
            if (removed.Length != 0) changes.Add(new("接入方式与模型环境变量", $"存在 {removed.Length} 项自定义设置（值不展示）", "移除本文件内的接入覆盖，使用官方默认模型"));
            if (root.Remove("model")) changes.Add(new("默认模型", "已有自定义选择（值不展示）", "使用官方默认模型"));
            if (root.Remove("apiKeyHelper")) changes.Add(new("自定义密钥助手", "已配置（内容不展示）", "移除本文件内的密钥助手"));
            if (root.Remove("forceLoginMethod")) changes.Add(new("登录方式限制", "已有登录方式限制（值不展示）", "允许选择 Claude 官方订阅登录"));
            warnings.Add("官方模式需要你之后自行登录有效的 Claude 订阅。本操作不会登录、注销或删除会话。");
        }
        else warnings.Add("保留现有网关、模型和认证设置；仅调整 Claude 的代理变量。");
        string proxy = $"http://127.0.0.1:{proxyPort}";
        foreach (string name in new[] { "HTTP_PROXY", "HTTPS_PROXY" })
        {
            string? originalKey = FindKey(env, name);
            string? current = originalKey is null ? null : env[originalKey]!.GetValue<string>();
            if (current != proxy || originalKey != name)
            {
                if (originalKey is not null) env.Remove(originalKey);
                env[name] = proxy;
                changes.Add(new(name, current is null ? "未设置" : "已有配置（值不展示）", proxy));
            }
        }
        string? noProxyKey = FindKey(env, "NO_PROXY");
        string? originalNoProxy = noProxyKey is null ? null : env[noProxyKey]!.GetValue<string>();
        var exemptions = (originalNoProxy ?? "").Split([',', ' ', '\t', '\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
        foreach (string item in new[] { "localhost", "127.0.0.1", "::1" })
            if (!exemptions.Contains(item, StringComparer.OrdinalIgnoreCase)) exemptions.Add(item);
        string noProxy = string.Join(',', exemptions);
        if (originalNoProxy != noProxy || noProxyKey != "NO_PROXY")
        {
            if (noProxyKey is not null) env.Remove(noProxyKey);
            env["NO_PROXY"] = noProxy;
            changes.Add(new("本机网关直连例外", originalNoProxy is null ? "未设置" : "已有条目（保留）", "保留原条目，加入 localhost、127.0.0.1、::1"));
        }
        if (exemptions.Contains("*")) warnings.Add("NO_PROXY 已有 *，可能令所有请求绕过代理。本次保留该条目，请自行确认用途。");
        if (externalConflicts is { Length: > 0 }) warnings.Add("进程或系统环境中还存在相关变量；本次不修改它们，请查看本机检查结果。项目设置与命令行参数也可能覆盖用户设置。");
        warnings.Add("这里只核对配置结构，未测试网络、节点、账号、余额或模型可用性；配置成功不代表不会封禁。");
        byte[] after = changes.Count == 0 && before is not null ? before.ToArray() : Encoding.UTF8.GetBytes(root.ToJsonString(Pretty) + Environment.NewLine);
        if (after.Length > MaximumSettingsBytes) throw Invalid();
        return new(after, changes.ToArray(), warnings.ToArray());
    }

    public static bool IsProviderOrModelVariable(string key) => ProviderVariables.Contains(key, StringComparer.OrdinalIgnoreCase)
        || IsModelVariable(key);
    public static bool IsModelVariable(string key) => ModelVariables.Contains(key, StringComparer.OrdinalIgnoreCase)
        || key.StartsWith("ANTHROPIC_DEFAULT_", StringComparison.OrdinalIgnoreCase) && key.Contains("MODEL", StringComparison.OrdinalIgnoreCase)
        || key.StartsWith("ANTHROPIC_CUSTOM_MODEL", StringComparison.OrdinalIgnoreCase);
    public static string? FindKey(JsonObject obj, string key) => obj.Select(item => item.Key).FirstOrDefault(item => item.Equals(key, StringComparison.OrdinalIgnoreCase));
    public static string? ReadEnvironment(JsonObject root, string key)
    {
        if (root["env"] is not JsonObject env || FindKey(env, key) is not { } actual) return null;
        return env[actual]!.GetValue<string>();
    }
    public static int? LocalHttpPort(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "http" || uri.UserInfo.Length != 0
            || uri.Port is < 1 or > 65535 || uri.AbsolutePath != "/" || uri.Query.Length != 0 || uri.Fragment.Length != 0) return null;
        return uri.Host is "localhost" or "127.0.0.1" or "[::1]" ? uri.Port : null;
    }
    private static InvalidDataException Invalid() => new("Claude settings.json 不是受支持的 JSON 配置（可能存在重复键、无效字段类型或文件过大）。未生成修改方案。");
}
