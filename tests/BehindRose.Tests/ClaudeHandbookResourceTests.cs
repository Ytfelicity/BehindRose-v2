using BehindRose.Desktop;

public static class ClaudeHandbookResourceTests
{
    public static void Run()
    {
        const string origin = "http://127.0.0.1:4317";
        foreach (string file in new[] { "Launch-Claude.ps1", "Backup-ClaudeLocal.ps1", "Test-ClaudeNetwork.ps1" })
        {
            string path = "/claude-handbook-scripts/" + file;
            Require(ClaudeHandbookResources.IsDownloadPath(path));
            Require(ClaudeHandbookResources.IsLocalResource(origin + path, origin, true));
            Require(!ClaudeHandbookResources.IsLocalResource(origin + path, origin, false));
        }
        foreach (string path in new[] { "/claude-windows-handbook.zip", "/claude-guide.md" })
            Require(ClaudeHandbookResources.IsLocalResource(origin + path, origin, true));
        foreach (string path in new[] { "/claude-handbook.html#step-04", "/claude-handbook-images/05-clash-proxy.png" })
        {
            Require(ClaudeHandbookResources.IsLocalResource(origin + path, origin, false));
            Require(!ClaudeHandbookResources.IsLocalResource(origin + path, origin, true));
        }
        foreach (string uri in new[] {
            "https://example.invalid/claude-handbook.html", "http://127.0.0.1:4318/claude-handbook.html",
            "http://localhost:4317/claude-handbook.html", "http://name@127.0.0.1:4317/claude-handbook.html",
            "file:///C:/claude-handbook.html", "blob:http://127.0.0.1:4317/fixture",
            origin + "/claude-handbook.html?redirect=https://example.invalid", origin + "/api/local",
            origin + "/claude-handbook-scripts/unknown.ps1", origin + "/claude-handbook-images/99-unknown.png",
            origin + "/claude-handbook-scripts/Launch-Claude.ps1.exe", origin + "/claude-handbook.html/../workbench.js"
        })
        {
            Require(!ClaudeHandbookResources.IsLocalResource(uri, origin, true));
            Require(!ClaudeHandbookResources.IsLocalResource(uri, origin, false));
        }
        Console.WriteLine("PASS handbook resources: only fixed local article/image links and five downloads allowed; no server, browser or network started.");
    }
    private static void Require(bool condition) { if (!condition) throw new Exception("Handbook local resource boundary failed."); }
}
