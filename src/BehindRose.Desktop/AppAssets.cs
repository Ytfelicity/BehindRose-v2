using System.IO;
using System.Reflection;

namespace BehindRose.Desktop;

internal static class AppAssets
{
    private static readonly Assembly Assembly = typeof(AppAssets).Assembly;
    private static readonly Dictionary<string, string> Resources = Assembly.GetManifestResourceNames()
        .ToDictionary(name => name.Replace('\\', '/'), StringComparer.Ordinal);

    public static byte[] Read(string relativePath)
    {
        if (DevelopmentMode.Assets is string source) return File.ReadAllBytes(Path.Combine(source, relativePath));
        // Explicit logical names preserve directory hyphens. SDK-generated
        // namespace names would silently change service-icons to service_icons.
        if (!Resources.TryGetValue("Assets/" + relativePath, out string? resource)) throw new FileNotFoundException("找不到本地图标或页面资源。");
        using var input = Assembly.GetManifestResourceStream(resource)!;
        using var bytes = new MemoryStream(); input.CopyTo(bytes); return bytes.ToArray();
    }
}
