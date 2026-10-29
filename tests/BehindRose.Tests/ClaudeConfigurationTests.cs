using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BehindRose.Core;
using BehindRose.Windows;

public static class ClaudeConfigurationTests
{
    private const string Secret = "fixture-claude-secret-never-export";
    private const string Original = """
        {"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:18317","ANTHROPIC_AUTH_TOKEN":"fixture-claude-secret-never-export","ANTHROPIC_DEFAULT_HAIKU_MODEL":"fixture-model","NO_PROXY":"internal.example.invalid","EXISTING":"keep"},"model":"fixture-custom","permissions":{"allow":["Read"]},"unknown":{"keep":true}}
        """;

    public static void Run()
    {
        var cases = new (string Name, Action Test)[]
        {
            ("preserve keeps gateway, model, credentials and unrelated settings", Preserve),
            ("official removes only configured provider/model overrides", Official),
            ("strict JSON and port validation reject unsafe input", StrictValidation),
            ("inspection and preview are local read-only and redact secrets", ReadOnly),
            ("production DPAPI round-trips fake bytes and rejects tampering", DpapiRoundTrip),
            ("apply is encrypted, idempotent and reversible", ApplyRestore),
            ("stale previews and later edits are preserved", Conflicts),
            ("external provider overrides block official mode", ExternalOverrides),
            ("backup encryption failures happen before settings writes", BackupFailure),
            ("missing original settings restore without touching credentials", MissingSettings),
            ("damaged backups block further configuration writes", DamagedBackup),
            ("plan is bound to its settings destination", DestinationBinding)
        };
        foreach (var item in cases) { item.Test(); Console.WriteLine("PASS Claude offline: " + item.Name); }
        Console.WriteLine($"Claude offline fixtures passed: {cases.Length}. No network calls or real profile writes.");
    }

    private static void Preserve()
    {
        var draft = ClaudeConfigurationPlanner.Build(Bytes(Original), "preserve", 7897);
        var root = ClaudeConfigurationPlanner.Parse(draft.After);
        Require(ClaudeConfigurationPlanner.ReadEnvironment(root, "ANTHROPIC_AUTH_TOKEN") == Secret);
        Require(ClaudeConfigurationPlanner.ReadEnvironment(root, "ANTHROPIC_BASE_URL") == "http://127.0.0.1:18317");
        Require(root["model"]!.GetValue<string>() == "fixture-custom");
        Require(root["unknown"]!["keep"]!.GetValue<bool>() && root["permissions"]!["allow"]![0]!.GetValue<string>() == "Read");
        Require(ClaudeConfigurationPlanner.ReadEnvironment(root, "HTTP_PROXY") == "http://127.0.0.1:7897");
        Require(ClaudeConfigurationPlanner.ReadEnvironment(root, "HTTPS_PROXY") == "http://127.0.0.1:7897");
        Require(ClaudeConfigurationPlanner.ReadEnvironment(root, "NO_PROXY") == "internal.example.invalid,localhost,127.0.0.1,::1");
        var again = ClaudeConfigurationPlanner.Build(draft.After, "preserve", 7897);
        Require(again.Changes.Length == 0 && again.After.SequenceEqual(draft.After));
        Require(!JsonSerializer.Serialize(draft).Contains(Secret, StringComparison.Ordinal));
    }
    private static void Official()
    {
        var root = ClaudeConfigurationPlanner.Parse(Bytes(Original));
        root["apiKeyHelper"] = "echo fixture-key";
        root["forceLoginMethod"] = "console";
        root["env"]!["CLAUDE_CODE_USE_BEDROCK"] = "1";
        root["env"]!["ANTHROPIC_REASONING_MODEL"] = "glm-5.2";
        root["env"]!["ANTHROPIC_DEFAULT_MODEL"] = "glm-5.2";
        root["env"]!["ANTHROPIC_DEFAULT_OPUS_MODEL"] = "glm-5.2";
        root["env"]!["ANTHROPIC_DEFAULT_SONNET_MODEL"] = "deepseek-v4-pro";
        root["env"]!["ANTHROPIC_DEFAULT_HAIKU_MODEL"] = "deepseek-v4-flash-0731";
        root["env"]!["ANTHROPIC_DEFAULT_FABLE_MODEL"] = "fixture-fable";
        root["env"]!["ANTHROPIC_CUSTOM_MODEL_OPTION"] = "fixture-custom";
        root["env"]!["ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION"] = "fixture description";
        var draft = ClaudeConfigurationPlanner.Build(Bytes(root.ToJsonString()), "official", 7897);
        var result = ClaudeConfigurationPlanner.Parse(draft.After);
        Require(!result.ContainsKey("model") && !result.ContainsKey("apiKeyHelper") && !result.ContainsKey("forceLoginMethod"));
        Require(ClaudeConfigurationPlanner.ReadEnvironment(result, "ANTHROPIC_AUTH_TOKEN") is null);
        Require(ClaudeConfigurationPlanner.ReadEnvironment(result, "ANTHROPIC_BASE_URL") is null);
        Require(ClaudeConfigurationPlanner.ReadEnvironment(result, "CLAUDE_CODE_USE_BEDROCK") is null);
        Require(ClaudeConfigurationPlanner.ReadEnvironment(result, "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION") is null);
        Require(!result["env"]!.AsObject().Any(item => ClaudeConfigurationPlanner.IsProviderOrModelVariable(item.Key)));
        Require(ClaudeConfigurationPlanner.ReadEnvironment(result, "EXISTING") == "keep");
        Require(result["permissions"]!["allow"]![0]!.GetValue<string>() == "Read");
        root["forceLoginOrgUUID"] = "fixture-organization";
        Refused(() => ClaudeConfigurationPlanner.Build(Bytes(root.ToJsonString()), "official", 7897));
    }
    private static void StrictValidation()
    {
        foreach (string value in new[] { "[]", "{\"env\":null}", "{\"env\":{\"A\":1}}", "{\"model\":[]}", "{\"env\":{},\"env\":{}}", "{\"nested\":{\"x\":1,\"x\":2}}", "{\"env\":{\"http_proxy\":\"a\",\"HTTP_PROXY\":\"b\"}}" })
            Refused(() => ClaudeConfigurationPlanner.Build(Bytes(value), "preserve", 7897));
        Refused(() => ClaudeConfigurationPlanner.Build(Bytes(Original), "preserve", 0));
        Refused(() => ClaudeConfigurationPlanner.Build(Bytes(Original), "preserve", 65536));
        Refused(() => ClaudeConfigurationPlanner.Build(Bytes(Original), "unexpected", 7897));
        Refused(() => ClaudeConfigurationPlanner.Parse(new byte[ClaudeConfigurationPlanner.MaximumSettingsBytes + 1]));
    }
    private static void ReadOnly()
    {
        using var fixture = new Fixture();
        byte[] before = File.ReadAllBytes(fixture.SettingsFile);
        var status = fixture.Service.Inspect();
        Require(status.CanConfigure && status.SettingsFound && status.Route == "本机网关");
        Require(status.SuggestedProxyPorts.SequenceEqual(new[] { 7897, 7898, 7899 }));
        var plan = fixture.Service.Preview("preserve", 7897);
        Require(plan.Preview.HasChanges && !Directory.Exists(fixture.Backups));
        string rendered = JsonSerializer.Serialize(new { status, plan });
        Require(!rendered.Contains(Secret, StringComparison.Ordinal) && !rendered.Contains("18317", StringComparison.Ordinal));
        Require(File.ReadAllBytes(fixture.SettingsFile).SequenceEqual(before));
        Require(File.ReadAllText(fixture.CredentialsFile) == "fixture credentials untouched");
    }
    private static void ApplyRestore()
    {
        using var fixture = new Fixture();
        byte[] before = File.ReadAllBytes(fixture.SettingsFile);
        var result = fixture.Service.Apply(fixture.Service.Preview("preserve", 7897));
        Require(result.Success && result.BackupId is not null);
        byte[] encrypted = File.ReadAllBytes(Path.Combine(fixture.Backups, result.BackupId + ".dat"));
        Require(!Encoding.UTF8.GetString(encrypted).Contains(Secret, StringComparison.Ordinal));
        byte[] plaintext = new ClaudeConfigurationDpapiProtector().Unprotect(encrypted);
        Require(Encoding.UTF8.GetString(plaintext).Contains("Before", StringComparison.Ordinal));
        CryptographicOperations.ZeroMemory(plaintext);
        int count = fixture.Service.ListBackups().Count;
        var again = fixture.Service.Apply(fixture.Service.Preview("preserve", 7897));
        Require(again.State == "unchanged" && fixture.Service.ListBackups().Count == count);
        Require(fixture.Service.Restore(fixture.Service.PreviewRestore(result.BackupId!)).Success);
        Require(File.ReadAllBytes(fixture.SettingsFile).SequenceEqual(before));
        Require(!fixture.Service.ListBackups().Single(item => item.Id == result.BackupId).CanRestore);
        Require(File.ReadAllText(fixture.CredentialsFile) == "fixture credentials untouched");
    }
    private static void DpapiRoundTrip()
    {
        // Exercise the production native ABI using only synthetic bytes in memory.
        byte[] original = [0, 1, 2, 3, 127, 128, 254, 255];
        byte[] input = original.ToArray();
        var protector = new ClaudeConfigurationDpapiProtector();
        byte[] encrypted = protector.Protect(input);
        Require(input.SequenceEqual(original) && !encrypted.SequenceEqual(original));
        byte[] decrypted = protector.Unprotect(encrypted);
        try { Require(decrypted.SequenceEqual(original)); }
        finally { CryptographicOperations.ZeroMemory(decrypted); }
        byte[] tampered = encrypted.ToArray(); tampered[^1] ^= 0x80;
        bool rejected = false;
        try
        {
            byte[] unexpected = protector.Unprotect(tampered);
            CryptographicOperations.ZeroMemory(unexpected);
        }
        catch (CryptographicException) { rejected = true; }
        Require(rejected);
        CryptographicOperations.ZeroMemory(input);
    }
    private static void Conflicts()
    {
        using var fixture = new Fixture();
        var plan = fixture.Service.Preview("preserve", 7897);
        string changed = Original.Replace("\"keep\":true", "\"keep\":false", StringComparison.Ordinal);
        File.WriteAllText(fixture.SettingsFile, changed);
        Refused(() => fixture.Service.Apply(plan));
        Require(File.ReadAllText(fixture.SettingsFile) == changed && !Directory.Exists(fixture.Backups));
        var applied = fixture.Service.Apply(fixture.Service.Preview("preserve", 7897));
        File.WriteAllText(fixture.SettingsFile, "{\"later\":true}");
        Refused(() => fixture.Service.PreviewRestore(applied.BackupId!));
        Require(File.ReadAllText(fixture.SettingsFile) == "{\"later\":true}");
    }
    private static void ExternalOverrides()
    {
        using var fixture = new Fixture(environment: name => name == "ANTHROPIC_API_KEY" ? Secret : null);
        Require(fixture.Service.Inspect().ConflictingEnvironmentVariables.SequenceEqual(new[] { "ANTHROPIC_API_KEY" }));
        Require(!JsonSerializer.Serialize(fixture.Service.Inspect()).Contains(Secret, StringComparison.Ordinal));
        Refused(() => fixture.Service.Preview("official", 7897));
        Require(fixture.Service.Preview("preserve", 7897).Preview.HasChanges);
        var dynamic = new ClaudeConfigurationService(fixture.Settings, fixture.Backups, fixture.Clash,
            externalEnvironment: name => name == "ANTHROPIC_DEFAULT_FUTURE_MODEL" ? Secret : null,
            externalEnvironmentNames: () => ["ANTHROPIC_DEFAULT_FUTURE_MODEL"]);
        Require(dynamic.Inspect().ConflictingEnvironmentVariables.SequenceEqual(new[] { "ANTHROPIC_DEFAULT_FUTURE_MODEL" }));
        Refused(() => dynamic.Preview("official", 7897));
    }
    private static void BackupFailure()
    {
        using var fixture = new Fixture(protector: new FailingProtector());
        byte[] before = File.ReadAllBytes(fixture.SettingsFile);
        Refused(() => fixture.Service.Apply(fixture.Service.Preview("preserve", 7897)));
        Require(File.ReadAllBytes(fixture.SettingsFile).SequenceEqual(before));
        Require(Directory.GetFiles(fixture.Backups, "*.dat").Length == 0);
    }
    private static void MissingSettings()
    {
        using var fixture = new Fixture(); File.Delete(fixture.SettingsFile);
        var result = fixture.Service.Apply(fixture.Service.Preview("preserve", 7897));
        Require(File.Exists(fixture.SettingsFile));
        Require(fixture.Service.Restore(fixture.Service.PreviewRestore(result.BackupId!)).Success);
        Require(!File.Exists(fixture.SettingsFile) && File.Exists(fixture.CredentialsFile));
    }
    private static void DamagedBackup()
    {
        using var fixture = new Fixture(); Directory.CreateDirectory(fixture.Backups);
        File.WriteAllBytes(Path.Combine(fixture.Backups, Guid.NewGuid().ToString("N") + ".dat"), [1, 2, 3]);
        Require(fixture.Service.ListBackups().Single().State == "unreadable");
        byte[] before = File.ReadAllBytes(fixture.SettingsFile);
        Refused(() => fixture.Service.Apply(fixture.Service.Preview("preserve", 7897)));
        Require(File.ReadAllBytes(fixture.SettingsFile).SequenceEqual(before));
    }
    private static void DestinationBinding()
    {
        using var one = new Fixture(); using var two = new Fixture();
        Refused(() => two.Service.Apply(one.Service.Preview("preserve", 7897)));
        Refused(() => new ClaudeConfigurationService(one.Settings, Path.Combine(one.Settings, "backups"), one.Clash, externalEnvironment: _ => null));
    }
    private sealed class FailingProtector : IClaudeBackupProtector
    {
        public byte[] Protect(byte[] plaintext) => throw new CryptographicException("Fixture backup failure");
        public byte[] Unprotect(byte[] ciphertext) => throw new CryptographicException("Fixture backup failure");
    }
    private sealed class Fixture : IDisposable
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "BehindRose-Claude-Test-" + Guid.NewGuid().ToString("N"));
        public string Settings => Path.Combine(Root, "settings");
        public string SettingsFile => Path.Combine(Settings, "settings.json");
        public string CredentialsFile => Path.Combine(Settings, ".credentials.json");
        public string Backups => Path.Combine(Root, "backups");
        public string Clash => Path.Combine(Root, "clash");
        public ClaudeConfigurationService Service { get; }
        public Fixture(IClaudeBackupProtector? protector = null, Func<string, string?>? environment = null)
        {
            Directory.CreateDirectory(Settings); Directory.CreateDirectory(Clash);
            File.WriteAllText(SettingsFile, Original, new UTF8Encoding(false));
            File.WriteAllText(CredentialsFile, "fixture credentials untouched");
            File.WriteAllText(Path.Combine(Clash, "config.yaml"), "mixed-port: 7897\nport: 7898\nsocks-port: 19999\nlisteners:\n  - type: mixed\n    port: 7899\n  - type: socks\n    port: 19998\n");
            Service = new(Settings, Backups, Clash, protector, environment ?? (_ => null));
        }
        public void Dispose()
        {
            string expectedParent = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
            Require(Path.GetDirectoryName(Path.GetFullPath(Root))!.Equals(expectedParent, StringComparison.OrdinalIgnoreCase));
            Require(Path.GetFileName(Root).StartsWith("BehindRose-Claude-Test-", StringComparison.Ordinal));
            if (Directory.Exists(Root)) Directory.Delete(Root, true);
        }
    }
    private static byte[] Bytes(string text) => Encoding.UTF8.GetBytes(text);
    private static void Require(bool value) { if (!value) throw new Exception("Claude offline fixture assertion failed."); }
    private static void Refused(Action action)
    {
        try { action(); }
        catch (Exception error) when (error is IOException or InvalidDataException or InvalidOperationException or CryptographicException) { return; }
        throw new Exception("Claude offline fixture expected refusal.");
    }
}
