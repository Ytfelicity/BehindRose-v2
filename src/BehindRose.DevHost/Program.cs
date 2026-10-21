using System.ComponentModel;
using System.IO;
using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using BehindRose.Core;
using BehindRose.Desktop;
using BehindRose.Windows;

if (args.FirstOrDefault() == "--worker") return Worker.Run(args);
if (args.Length != 1 || args[0] is not ("--stdio" or "--demo")) return 90;
// The local HTTP server must remain at the user's ordinary privilege level.
if (args[0] != "--demo" && WindowsState.IsAdministrator) { Console.Error.WriteLine("请以普通用户启动开发服务。"); return 90; }
Console.InputEncoding = Encoding.UTF8; Console.OutputEncoding = new UTF8Encoding(false);
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web) { MaxDepth = 16 };
var app = new LocalApp(args[0] == "--demo");
string? line;
while ((line = await Console.In.ReadLineAsync()) != null)
{
    string? id = null;
    try
    {
        if (line.Length > 8192) throw new InvalidDataException("请求过大。");
        using var envelope = JsonDocument.Parse(line);
        if (envelope.RootElement.ValueKind == JsonValueKind.Object && envelope.RootElement.TryGetProperty("id", out var requestId)
            && requestId.ValueKind == JsonValueKind.String && Guid.TryParseExact(requestId.GetString(), "N", out _)) id = requestId.GetString();
        var request = WorkbenchRequest.Parse(line);
        id = request.Id;
        Console.WriteLine(JsonSerializer.Serialize(new { id, ok = true, data = app.Handle(request) }, json));
    }
    catch (Exception ex)
    {
        Console.WriteLine(JsonSerializer.Serialize(new { id, ok = false, error = LocalApp.Message(ex) }, json));
    }
}
await app.FinishAsync(); // Closing the development server must not kill an in-flight configuration worker.
return 0;
