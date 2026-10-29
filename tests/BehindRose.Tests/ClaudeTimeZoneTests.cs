using System.Security.Cryptography;
using System.Text;
using BehindRose.Core;
using BehindRose.Windows;

public static class ClaudeTimeZoneTests
{
    public static void Run()
    {
        var cases = new (string Name, Action Test)[]
        {
            ("inspection and preview are read-only and explicitly optional", ReadOnly),
            ("confirmed apply encrypts a backup and restore recovers prior zone", ApplyRestore),
            ("already-Taipei apply is a no-op without a backup", Idempotent),
            ("stale preview stops before backup or setter", StalePreview),
            ("restore preserves subsequent external zone changes", RestoreConflict),
            ("backup encryption failure prevents the setter", BackupFailure),
            ("partial setter failure rolls back the prior zone", PartialFailure),
            ("unresolved rollback blocks apply and no-op restore resolves record", PendingRecovery),
            ("damaged backups block writes", DamagedBackup),
            ("prior daylight-saving flag is preserved and restored", DaylightFlag),
            ("plans are bound to their service destination", DestinationBinding),
            ("unrecognized backed-up zone is refused", UnknownRestoreZone),
            ("unknown setter completion skips rollback and blocks future writes", UnknownCompletion),
            ("unknown rollback completion blocks further automatic recovery", UnknownRollback),
            ("durable applying state blocks recovery when unknown status save fails", UnknownStatusSaveFailure)
        };
        foreach (var item in cases) { item.Test(); Console.WriteLine("PASS optional timezone offline: " + item.Name); }
        Console.WriteLine($"Optional timezone offline fixtures passed: {cases.Length}. Only injected state, temporary files and a fake protector were used.");
    }
    private static void ReadOnly()
    {
        using var f = new Fixture();
        var status = f.Service.Inspect(); var plan = f.Service.PreviewTaipei();
        Require(status.CurrentId == "UTC" && status.CanConfigure && !status.IsTaipei);
        Require(status.TargetId == ClaudeTimeZoneGuidance.TaipeiId);
        Require(plan.Preview.HasChanges && plan.Preview.Action == "apply");
        Require(status.Warnings.Any(text => text.Contains("可选个人经验", StringComparison.Ordinal)));
        Require(status.Warnings.Any(text => text.Contains("整台电脑", StringComparison.Ordinal) && text.Contains("UTC", StringComparison.Ordinal)));
        Require(!Directory.Exists(f.Backups) && f.State.Writes == 0);
        f.State.FailRead = true; Require(!f.Service.Inspect().CanConfigure);
    }
    private static void ApplyRestore()
    {
        using var f = new Fixture();
        var result = f.Service.Apply(f.Service.PreviewTaipei());
        Require(result.Success && result.State == "applied" && result.BackupId is not null && f.State.Writes == 1);
        Require(f.State.Value.Id == ClaudeTimeZoneGuidance.TaipeiId);
        byte[] encrypted = File.ReadAllBytes(Path.Combine(f.Backups, result.BackupId + ".dat"));
        Require(!Encoding.UTF8.GetString(encrypted).Contains(ClaudeTimeZoneGuidance.TaipeiId, StringComparison.Ordinal));
        byte[] plaintext = f.Protector.Unprotect(encrypted);
        try { Require(Encoding.UTF8.GetString(plaintext).Contains(ClaudeTimeZoneGuidance.TaipeiId, StringComparison.Ordinal)); }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
        var preview = f.Service.PreviewRestore(result.BackupId!);
        Require(preview.Preview.TargetId == "UTC" && preview.Preview.Action == "restore");
        Require(f.Service.Restore(preview).Success && f.State.Value.Id == "UTC" && f.State.Writes == 2);
        Require(!f.Service.ListBackups().Single(item => item.Id == result.BackupId).CanRestore);
    }
    private static void Idempotent()
    {
        using var f = new Fixture(); f.State.Value = f.State.Resolve(ClaudeTimeZoneGuidance.TaipeiId);
        Require(f.Service.Inspect().IsTaipei);
        var plan = f.Service.PreviewTaipei(); Require(!plan.Preview.HasChanges);
        Require(f.Service.Apply(plan).State == "unchanged" && f.State.Writes == 0 && !Directory.Exists(f.Backups));
    }
    private static void StalePreview()
    {
        using var f = new Fixture(); var plan = f.Service.PreviewTaipei();
        f.State.Value = f.State.Resolve("Pacific Standard Time");
        Refused(() => f.Service.Apply(plan));
        Require(f.State.Writes == 0 && !Directory.Exists(f.Backups) && f.State.Value.Id == "Pacific Standard Time");
    }
    private static void RestoreConflict()
    {
        using var f = new Fixture(); var result = f.Service.Apply(f.Service.PreviewTaipei());
        f.State.Value = f.State.Resolve("Pacific Standard Time");
        Refused(() => f.Service.PreviewRestore(result.BackupId!));
        Require(f.State.Value.Id == "Pacific Standard Time" && f.State.Writes == 1);
    }
    private static void BackupFailure()
    {
        using var f = new Fixture(); f.Protector.FailProtect = true;
        Refused(() => f.Service.Apply(f.Service.PreviewTaipei()));
        Require(f.State.Value.Id == "UTC" && f.State.Writes == 0);
    }
    private static void PartialFailure()
    {
        using var f = new Fixture(); f.State.FailAfterFirstWrite = true;
        var result = f.Service.Apply(f.Service.PreviewTaipei());
        Require(!result.Success && result.State == "rolled-back" && f.State.Value.Id == "UTC" && f.State.Writes == 2);
        Require(f.Service.ListBackups().Single().State == "rolled-back");
    }
    private static void PendingRecovery()
    {
        using var f = new Fixture(); f.State.FailAfterFirstWrite = true; f.State.FailRollback = true;
        var result = f.Service.Apply(f.Service.PreviewTaipei());
        Require(result.State == "rollback-failed");
        f.State.Value = f.State.Resolve("UTC");
        Refused(() => f.Service.Apply(f.Service.PreviewTaipei()));
        int writes = f.State.Writes;
        Require(f.Service.Restore(f.Service.PreviewRestore(result.BackupId!)).State == "restored");
        Require(f.State.Writes == writes && !f.Service.ListBackups().Single().CanRestore);
    }
    private static void DamagedBackup()
    {
        using var f = new Fixture(); Directory.CreateDirectory(f.Backups);
        File.WriteAllBytes(Path.Combine(f.Backups, Guid.NewGuid().ToString("N") + ".dat"), [1, 2, 3]);
        Require(f.Service.ListBackups().Single().State == "unreadable");
        Refused(() => f.Service.Apply(f.Service.PreviewTaipei())); Require(f.State.Writes == 0);
    }
    private static void DaylightFlag()
    {
        using var f = new Fixture(); f.State.Value = f.State.Resolve("UTC", true);
        var result = f.Service.Apply(f.Service.PreviewTaipei()); Require(f.State.Value.DaylightSavingDisabled);
        f.Service.Restore(f.Service.PreviewRestore(result.BackupId!));
        Require(f.State.Value.Id == "UTC" && f.State.Value.DaylightSavingDisabled);
    }
    private static void DestinationBinding()
    {
        using var first = new Fixture(); using var second = new Fixture();
        Refused(() => second.Service.Apply(first.Service.PreviewTaipei())); Require(second.State.Writes == 0);
    }
    private static void UnknownRestoreZone()
    {
        using var f = new Fixture(); var result = f.Service.Apply(f.Service.PreviewTaipei());
        f.State.RefuseUtc = true;
        Refused(() => f.Service.PreviewRestore(result.BackupId!)); Require(f.State.Value.Id == ClaudeTimeZoneGuidance.TaipeiId);
    }
    private static void UnknownCompletion()
    {
        using var f = new Fixture(); f.State.UnknownAfterFirstWrite = true;
        var result = f.Service.Apply(f.Service.PreviewTaipei());
        Require(result.State == "completion-unknown" && f.State.Writes == 1 && !result.Success);
        Require(!f.Service.Inspect().CanConfigure);
        var backup = f.Service.ListBackups().Single(); Require(backup.State == "completion-unknown" && !backup.CanRestore);
        Refused(() => f.Service.PreviewRestore(result.BackupId!)); Refused(() => f.Service.PreviewTaipei());
        var reopened = new ClaudeTimeZoneService(f.State, f.Backups, f.Protector);
        Refused(() => reopened.PreviewTaipei()); Require(f.State.Writes == 1);
    }
    private static void UnknownRollback()
    {
        using var f = new Fixture(); f.State.FailAfterFirstWrite = true; f.State.UnknownOnRollback = true;
        var result = f.Service.Apply(f.Service.PreviewTaipei());
        Require(result.State == "completion-unknown" && f.State.Writes == 2);
        Require(f.Service.ListBackups().Single().State == "completion-unknown");
        Refused(() => f.Service.PreviewRestore(result.BackupId!)); Require(f.State.Writes == 2);
    }
    private static void UnknownStatusSaveFailure()
    {
        using var f = new Fixture(); f.State.UnknownAfterFirstWrite = true; f.Protector.FailOnProtectNumber = 3;
        var result = f.Service.Apply(f.Service.PreviewTaipei());
        Require(result.State == "completion-unknown" && f.State.Writes == 1);
        var record = f.Service.ListBackups().Single(); Require(record.State == "applying" && !record.CanRestore);
        var reopened = new ClaudeTimeZoneService(f.State, f.Backups, f.Protector);
        Refused(() => reopened.PreviewRestore(record.Id)); Refused(() => reopened.PreviewTaipei());
        Require(f.State.Writes == 1);
    }

    private sealed class FakeState : IClaudeTimeZoneState
    {
        public ClaudeTimeZoneValue Value = new("UTC", "Fixture UTC");
        public int Writes;
        public bool FailRead, FailAfterFirstWrite, FailRollback, RefuseUtc, UnknownAfterFirstWrite, UnknownOnRollback;
        public ClaudeTimeZoneValue Read() => FailRead ? throw new IOException("Fixture read failure") : Value;
        public ClaudeTimeZoneValue Resolve(string id, bool daylightSavingDisabled = false)
        {
            if (RefuseUtc && id == "UTC") throw new InvalidDataException("Fixture zone removed");
            return id switch
            {
                "UTC" => new(id, "Fixture UTC", daylightSavingDisabled),
                ClaudeTimeZoneGuidance.TaipeiId => new(id, "Fixture Taipei", daylightSavingDisabled),
                "Pacific Standard Time" => new(id, "Fixture Pacific", daylightSavingDisabled),
                _ => throw new InvalidDataException("Fixture unknown zone")
            };
        }
        public void Write(ClaudeTimeZoneValue value)
        {
            Writes++;
            if (UnknownOnRollback && Writes > 1) throw new ClaudeTimeZoneCompletionUnknownException();
            if (FailRollback && Writes > 1) throw new IOException("Fixture rollback refused");
            Value = Resolve(value.Id, value.DaylightSavingDisabled);
            if (UnknownAfterFirstWrite && Writes == 1) throw new ClaudeTimeZoneCompletionUnknownException();
            if (FailAfterFirstWrite && Writes == 1) throw new IOException("Fixture post-write failure");
        }
    }
    private sealed class FakeProtector : IClaudeBackupProtector
    {
        private readonly byte[] key = RandomNumberGenerator.GetBytes(32);
        public bool FailProtect;
        public int FailOnProtectNumber, ProtectCalls;
        public byte[] Protect(byte[] plaintext)
        {
            ProtectCalls++;
            if (FailProtect || FailOnProtectNumber == ProtectCalls) throw new CryptographicException("Fixture encryption failure");
            byte[] result = new byte[28 + plaintext.Length]; RandomNumberGenerator.Fill(result.AsSpan(0, 12));
            using var aes = new AesGcm(key, 16); aes.Encrypt(result.AsSpan(0, 12), plaintext, result.AsSpan(28), result.AsSpan(12, 16)); return result;
        }
        public byte[] Unprotect(byte[] ciphertext)
        {
            if (ciphertext.Length < 28) throw new CryptographicException("Fixture invalid encrypted bytes");
            byte[] plaintext = new byte[ciphertext.Length - 28];
            using var aes = new AesGcm(key, 16); aes.Decrypt(ciphertext.AsSpan(0, 12), ciphertext.AsSpan(28), ciphertext.AsSpan(12, 16), plaintext); return plaintext;
        }
    }
    private sealed class Fixture : IDisposable
    {
        public string Root { get; } = Path.Combine(Path.GetTempPath(), "BehindRose-TimeZone-Test-" + Guid.NewGuid().ToString("N"));
        public string Backups => Path.Combine(Root, "backups");
        public FakeState State { get; } = new();
        public FakeProtector Protector { get; } = new();
        public ClaudeTimeZoneService Service { get; }
        public Fixture() => Service = new(State, Backups, Protector);
        public void Dispose()
        {
            string parent = Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar);
            Require(Path.GetDirectoryName(Path.GetFullPath(Root))!.Equals(parent, StringComparison.OrdinalIgnoreCase));
            Require(Path.GetFileName(Root).StartsWith("BehindRose-TimeZone-Test-", StringComparison.Ordinal));
            if (Directory.Exists(Root)) Directory.Delete(Root, true);
        }
    }
    private static void Require(bool value) { if (!value) throw new Exception("Optional timezone fixture assertion failed."); }
    private static void Refused(Action action)
    {
        try { action(); }
        catch (Exception error) when (error is IOException or InvalidDataException or InvalidOperationException or CryptographicException) { return; }
        throw new Exception("Optional timezone fixture expected refusal.");
    }
}
