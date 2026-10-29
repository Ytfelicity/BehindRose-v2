using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using BehindRose.Windows;

internal static class ClashFullBackupTests
{
    private static void Assert(bool condition, string message) { if (!condition) throw new Exception(message); }
    private static void Reject(Action action)
    {
        try { action(); } catch (Exception error) when (error is IOException or InvalidDataException or InvalidOperationException or CryptographicException or ArgumentException) { return; }
        throw new Exception("Expected full backup operation to be refused");
    }
    internal static void Register(Action<string, Action> test)
    {
        test("Full backup encrypts private fixture data and exposes counts only", () =>
        {
            using var f = new Fixture(); var original = f.Files(); var backup = f.Service.Create();
            Assert(backup.Complete && backup.FileCount == original.Count, "Full snapshot must include every configuration resource");
            byte[] encrypted = File.ReadAllBytes(f.BackupFile(backup.Id));
            Assert(!Encoding.UTF8.GetString(encrypted).Contains(f.PrivateValue), "Private fixture text must be encrypted");
            Assert(!JsonSerializer.Serialize(f.Service.List()).Contains(f.PrivateValue), "Backup summaries must not expose private text");
            Assert(Fixture.Equal(original, f.Files()), "Creating a backup must not write the live configuration");
            encrypted[^1] ^= 1;
            Reject(() => f.Protector.Unprotect(encrypted));
        });
        test("Full restore rebuilds an entirely missing configuration directory and preserves reusable backup", () =>
        {
            using var f = new Fixture(); var original = f.Files(); var backup = f.Service.Create();
            f.RemoveConfigDirectory();
            var plan = f.Service.PreviewRestore(backup.Id);
            Assert(plan.Preview.WriteCount == original.Count && plan.Preview.RemoveCount == 0, "Deleted directory must be restorable without discovery");
            var result = f.Service.Restore(plan);
            Assert(result.Success && Fixture.Equal(original, f.Files()), "All original bytes must be recreated");
            Assert(f.Service.List().Single(x => x.Id == result.BackupId).Reason == "before-restore", "Save the empty pre-restore state");
            int count = f.Service.List().Count;
            Assert(f.Service.Restore(f.Service.PreviewRestore(backup.Id)).State == "unchanged" && f.Service.List().Count == count, "No-op restore must not create repeated snapshots");
            f.Put("config.yaml", "tun: {stack: system}\n");
            Assert(f.Service.Restore(f.Service.PreviewRestore(backup.Id)).Success && Fixture.Equal(original, f.Files()), "A full backup remains reusable after restoration");
        });
        test("Full restoration mirrors the selected snapshot while preserving logs and historical archives", () =>
        {
            using var f = new Fixture(); var original = f.Files(); var backup = f.Service.Create();
            f.Put("profiles/added.yaml", "newer profile"); f.Put("profiles/example.yaml", "changed");
            f.Put("logs/runtime.log", "keep log"); f.Put("clash-verge-rev-backup/history.zip", "keep historical archive");
            var plan = f.Service.PreviewRestore(backup.Id);
            Assert(plan.Preview.RemoveCount == 1, "Preview must disclose removal of files introduced after the snapshot");
            Assert(f.Service.Restore(plan).Success && Fixture.Equal(original, f.Files()), "Restore all included bytes and remove later additions");
            Assert(File.ReadAllText(Path.Combine(f.Config, "logs/runtime.log")) == "keep log", "Excluded logs must be preserved");
            Assert(File.Exists(Path.Combine(f.Config, "clash-verge-rev-backup/history.zip")), "Historical archives must be preserved");
        });
        test("Full restore rejects stale previews, altered archives, running Clash and incomplete manual snapshots", () =>
        {
            using var f = new Fixture(); var backup = f.Service.Create(); var plan = f.Service.PreviewRestore(backup.Id);
            f.Put("config.yaml", "tun: {stack: gvisor}\n"); var changed = f.Files();
            Reject(() => f.Service.Restore(plan)); Assert(Fixture.Equal(changed, f.Files()), "Stale restore cannot write");
            plan = f.Service.PreviewRestore(backup.Id); f.Running = true;
            Reject(() => f.Service.Restore(plan)); Reject(() => f.Service.ProtectRepair()); f.Running = false;
            byte[] encrypted = File.ReadAllBytes(f.BackupFile(backup.Id)); encrypted[^1] ^= 1; File.WriteAllBytes(f.BackupFile(backup.Id), encrypted);
            Reject(() => f.Service.PreviewRestore(backup.Id)); Assert(!f.Service.List().Single().CanRestore, "Unreadable backup must not be offered for recovery");
            File.Delete(Path.Combine(f.Config, "profiles.yaml")); Reject(() => f.Service.Create());
        });
        test("Full restore rolls back failed writes and retains the encrypted safety snapshot", () =>
        {
            using var f = new Fixture(); var backup = f.Service.Create();
            f.Put("config.yaml", "tun: {stack: system}\n"); f.Put("profiles/example.yaml", "changed fixture\n"); var current = f.Files();
            f.Service.BeforeRestoreWrite = index => { if (index == 2) throw new IOException("injected write failure"); };
            var result = f.Service.Restore(f.Service.PreviewRestore(backup.Id));
            Assert(!result.Success && result.State == "rolled-back" && Fixture.Equal(current, f.Files()), "Failed multi-file restore must undo completed writes");
            Assert(f.Service.List().Any(x => x.Reason == "before-restore"), "Recovery point must survive a failed restoration");
            Assert(!File.Exists(Path.Combine(f.Backups, "pending-restore.json")), "Successful rollback clears the interrupted marker");
        });
        test("Interrupted full restore blocks other writes and recovers from its original safety snapshot", () =>
        {
            using var f = new Fixture(); var backup = f.Service.Create();
            f.Put("config.yaml", "tun: {stack: system}\n"); f.Put("profiles/example.yaml", "changed fixture\n"); var current = f.Files();
            f.Service.BeforeRestoreWrite = index => { if (index == 2) { f.Put("config.yaml", "concurrent edit\n"); throw new IOException("injected interruption"); } };
            var result = f.Service.Restore(f.Service.PreviewRestore(backup.Id));
            Assert(result.State == "rollback-failed", "Concurrent edit must never be overwritten during rollback");
            var recovery = f.Service.List().Single(x => x.State == "recovery-required");
            Reject(() => f.Service.Create()); Reject(() => f.Service.PreviewRestore(backup.Id));
            f.Service.BeforeRestoreWrite = null;
            Assert(f.Service.Restore(f.Service.PreviewRestore(recovery.Id)).Success && Fixture.Equal(current, f.Files()), "Interrupted restoration must recover from its saved safety snapshot");
            Assert(!File.Exists(Path.Combine(f.Backups, "pending-restore.json")), "Successful recovery clears the interruption");
        });
        test("Full backup rejects path traversal even in an authenticated local archive", () =>
        {
            using var f = new Fixture(); var backup = f.Service.Create();
            byte[] plaintext = f.Protector.Unprotect(File.ReadAllBytes(f.BackupFile(backup.Id)));
            using var input = new MemoryStream(plaintext); using var source = new ZipArchive(input, ZipArchiveMode.Read);
            using var output = new MemoryStream();
            using (var target = new ZipArchive(output, ZipArchiveMode.Create, true))
                foreach (var entry in source.Entries)
                {
                    using var read = entry.Open(); using var copy = new MemoryStream(); read.CopyTo(copy); byte[] bytes = copy.ToArray();
                    if (entry.FullName == "behindrose-manifest.json")
                    {
                        var metadata = JsonNode.Parse(bytes)!;
                        metadata["Files"]![0]!["Name"] = "../outside.txt";
                        bytes = Encoding.UTF8.GetBytes(metadata.ToJsonString());
                    }
                    using var write = target.CreateEntry(entry.FullName).Open(); write.Write(bytes);
                }
            File.WriteAllBytes(f.BackupFile(backup.Id), f.Protector.Protect(output.ToArray()));
            Reject(() => f.Service.PreviewRestore(backup.Id));
            Assert(!File.Exists(Path.Combine(f.Root, "outside.txt")), "Archive paths cannot escape the configuration directory");
            Reject(() => f.Service.PreviewRestore("../../outside"));
            Reject(() => new ClashFullBackupService(f.Config, Path.Combine(f.Config, "nested-backups")));
        });
        test("Repair guard creates a complete encrypted checkpoint and shares the restore lock", () =>
        {
            using var f = new Fixture();
            using (f.Service.ProtectRepair())
            {
                Assert(f.Service.List().Single().Reason == "before-repair", "Every repair checkpoint must include the entire current configuration");
                bool refused = Task.Run(() => { try { f.Service.Create(); return false; } catch (InvalidOperationException) { return true; } }).GetAwaiter().GetResult();
                Assert(refused, "Another thread cannot snapshot or restore through an active repair transaction");
            }
            Assert(f.Service.List().Single().Complete, "Automatic repair checkpoint must be complete");
        });
    }

    private sealed class Fixture : IDisposable
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "BehindRose-FullBackupTests-" + Guid.NewGuid().ToString("N"));
        public string Config => Path.Combine(Root, "config");
        public string Backups => Path.Combine(Root, "backups");
        public string PrivateValue { get; } = Guid.NewGuid().ToString();
        public bool Running { get; set; }
        public ClashBackupDpapiProtector Protector { get; } = new();
        public ClashFullBackupService Service { get; }
        public Fixture()
        {
            Put("config.yaml", "tun: {enable: true, stack: mixed, device: ExampleTun, mtu: 1500}\n");
            Put("verge.yaml", "enable_tun_mode: true\n");
            Put("profiles.yaml", "current: fixture\nitems:\n- {uid: fixture, type: remote, file: example.yaml, url: 'https://subscription.example.invalid/" + PrivateValue + "'}\n- {uid: script, type: script, file: original.js}\n");
            Put("profiles/example.yaml", "proxies: [{name: example, type: vless, server: node.example.invalid, uuid: '" + PrivateValue + "'}]\nrules: [MATCH,DIRECT]\n");
            Put("profiles/original.js", "function main(config) { return config; }\n");
            Put("ruleset/custom.yaml", "payload: [office.example.invalid]\n");
            Put("geo.dat", "fake resource\0bytes"); Put("cache.db", "fake selection state");
            Service = new(Config, Backups, Protector, () => Running);
        }
        public void Put(string name, string text) { string path = Path.Combine(Config, name); Directory.CreateDirectory(Path.GetDirectoryName(path)!); File.WriteAllText(path, text); }
        public string BackupFile(string id) => Path.Combine(Backups, id + ".brclash");
        public Dictionary<string, string> Files() => Directory.Exists(Config) ? Directory.GetFiles(Config, "*", SearchOption.AllDirectories)
            .Where(p => !Path.GetRelativePath(Config, p).StartsWith("logs") && !Path.GetRelativePath(Config, p).StartsWith("clash-verge-rev-backup"))
            .ToDictionary(p => Path.GetRelativePath(Config, p), p => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(p)))) : [];
        public static bool Equal(Dictionary<string, string> first, Dictionary<string, string> second) => first.Count == second.Count && first.All(x => second.GetValueOrDefault(x.Key) == x.Value);
        public void RemoveConfigDirectory() { VerifyRoot(); Directory.Delete(Config, true); }
        private void VerifyRoot()
        {
            string resolved = Path.GetFullPath(Root), temp = Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath()));
            if (Path.GetDirectoryName(resolved) != temp || !Path.GetFileName(resolved).StartsWith("BehindRose-FullBackupTests-", StringComparison.Ordinal)) throw new IOException("Unexpected fixture directory");
            SafeFiles.CheckPath(resolved);
        }
        public void Dispose() { VerifyRoot(); if (Directory.Exists(Root)) Directory.Delete(Root, true); }
    }
}
