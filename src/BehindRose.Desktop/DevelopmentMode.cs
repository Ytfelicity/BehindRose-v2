using System.IO;

namespace BehindRose.Desktop;

public static class DevelopmentMode
{
    public static string? Assets { get; private set; }
    public static bool Enabled => Assets != null;
    public static void Configure(string[] args)
    {
#if DEBUG
        if (!args.Contains("--dev")) return;
        var root = Environment.GetEnvironmentVariable("BEHINDROSE_DEV_SOURCE");
        if (string.IsNullOrWhiteSpace(root))
        {
            for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory != null; directory = directory.Parent)
                if (File.Exists(Path.Combine(directory.FullName, "BehindRose.Desktop.csproj"))) { root = Path.Combine(directory.FullName, "Assets"); break; }
        }
        if (root == null || !File.Exists(Path.Combine(root, "diagnostics", "index.html")))
            throw new DirectoryNotFoundException("开发模式未找到检测页面源码，请使用项目中的启动入口。");
        Assets = Path.GetFullPath(root);
#endif
    }
}
