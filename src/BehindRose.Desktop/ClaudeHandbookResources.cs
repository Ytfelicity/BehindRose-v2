namespace BehindRose.Desktop;

// Only the fixed article assets may bypass the workbench's download/navigation block.
internal static class ClaudeHandbookResources
{
    private static readonly HashSet<string> Downloads = new(StringComparer.Ordinal)
    {
        "/claude-windows-handbook.zip", "/claude-guide.md",
        "/claude-handbook-scripts/Launch-Claude.ps1",
        "/claude-handbook-scripts/Backup-ClaudeLocal.ps1",
        "/claude-handbook-scripts/Test-ClaudeNetwork.ps1"
    };
    private static readonly HashSet<string> Views = new(StringComparer.Ordinal)
    {
        "/claude-handbook.html",
        "/claude-handbook-images/01-official-reasons.jpg",
        "/claude-handbook-images/02-x-six-days.jpg",
        "/claude-handbook-images/03-google-play-reply.jpg",
        "/claude-handbook-images/04-ccbaga-post.jpg",
        "/claude-handbook-images/05-clash-proxy.png",
        "/claude-handbook-images/06-clash-settings.png",
        "/claude-handbook-images/07-windows-proxy.png",
        "/claude-handbook-images/08-windows-proxy-off.png"
    };
    internal static bool IsDownloadPath(string path) => Downloads.Contains(path);
    internal static bool IsLocalResource(string address, string origin, bool download)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme != "http" || !uri.IsLoopback
            || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.GetLeftPart(UriPartial.Authority) != origin) return false;
        return download ? Downloads.Contains(uri.AbsolutePath) : Views.Contains(uri.AbsolutePath);
    }
}
