using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BehindRose.Desktop;

internal static class WorkbenchRequest
{
    public static Request Parse(string input, bool requireId = true)
    {
        if (input.Length > (requireId ? 8192 : 4096)) throw new InvalidDataException("请求过大。");
        using var doc = JsonDocument.Parse(input, new JsonDocumentOptions { MaxDepth = 16 });
        var root = doc.RootElement;
        var request = JsonSerializer.Deserialize<Request>(input, new JsonSerializerOptions(JsonSerializerDefaults.Web) { NumberHandling = JsonNumberHandling.Strict, MaxDepth = 16 }) ?? throw new InvalidDataException("请求为空。");
        if (root.ValueKind != JsonValueKind.Object || root.EnumerateObject().Select(p => p.Name).Distinct().Count() != root.EnumerateObject().Count()) throw new InvalidDataException("请求格式无效。");
        if (requireId && !Guid.TryParseExact(request.Id, "N", out _)) throw new InvalidDataException("请求编号无效。");
        string[] fields = request.Command switch
        {
            "quality-start" => ["proxyPort"], "quality-status" or "quality-stop" or "quality-proxies" => [],
            "proxy-network-start" => ["proxyPort", "profile", "includeSpeed"], "proxy-network-status" or "proxy-network-stop" => [],
            "health" or "status" or "plan" or "backups" or "restore-plan" or "execute" or "open-clash" => ["options", "planId", "backupId"],
            _ => throw new InvalidDataException("不支持的操作。")
        };
        if (root.EnumerateObject().Any(p => p.Name != "command" && !(requireId && p.Name == "id") && !fields.Contains(p.Name))) throw new InvalidDataException("操作参数无效。");
        if (request.Command == "quality-start" && (!root.TryGetProperty("proxyPort", out _) || request.ProxyPort is < 0 or > 65535)) throw new InvalidDataException("代理端口无效。");
        if (request.Command == "proxy-network-start" && (!root.TryGetProperty("proxyPort", out _) || !root.TryGetProperty("profile", out _) || !root.TryGetProperty("includeSpeed", out _) || request.ProxyPort is < 1 or > 65535 || request.Profile is not ("quick" or "all"))) throw new InvalidDataException("代理检测参数无效。");
        if (root.TryGetProperty("options", out _) && request.Options is < 1 or > 63) throw new InvalidDataException("修改选项无效。");
        if (root.TryGetProperty("planId", out _) && !Guid.TryParseExact(request.PlanId, "N", out _) || root.TryGetProperty("backupId", out _) && !Guid.TryParseExact(request.BackupId, "N", out _)) throw new InvalidDataException("操作编号无效。");
        return requireId ? request : request with { Id = Guid.NewGuid().ToString("N") };
    }
}
