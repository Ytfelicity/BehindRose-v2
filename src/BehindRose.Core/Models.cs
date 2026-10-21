using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BehindRose.Core;

[Flags]
public enum RepairOptions { None = 0, Tun = 1, ChromeDns = 2, EdgeDns = 4, FirefoxDns = 8, ReplaceDns = 16, DisableClashIpv6 = 32 }

public sealed record StoredValue(bool Exists, string Kind, string Data)
{
    public static StoredValue Missing { get; } = new(false, "missing", "");
    public static StoredValue File(byte[] bytes) => new(true, "file", Convert.ToBase64String(bytes));
    public static StoredValue Text(string text) => new(true, "String", Convert.ToBase64String(Encoding.UTF8.GetBytes(text)));
    public static StoredValue DWord(int number) => new(true, "DWord", Convert.ToBase64String(BitConverter.GetBytes(number)));
    public byte[] Bytes() => Convert.FromBase64String(Data);
}

public sealed record Change(string Key, string Title, string BeforeText, string AfterText, StoredValue Before, StoredValue After);
public sealed record Finding(string Title, string Detail, string State);
public sealed record RepairPlan(RepairOptions Options, IReadOnlyDictionary<string, StoredValue> Expected, IReadOnlyList<Change> Changes)
{
    public string Fingerprint => Fingerprints.Plan(this);
    public bool NeedsClashExit => Changes.Any(x => Targets.IsFile(x.Key));
}

public static class Fingerprints
{
    public static string Bytes(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    public static string Plan(RepairPlan plan) => Bytes(JsonSerializer.SerializeToUtf8Bytes(new
    {
        Options = (int)plan.Options,
        Expected = plan.Expected.OrderBy(x => x.Key, StringComparer.Ordinal).ToArray(),
        Changes = plan.Changes.OrderBy(x => x.Key, StringComparer.Ordinal).ToArray()
    }));
}

public static class Targets
{
    public const string Verge = "file:verge.yaml", Config = "file:config.yaml", Dns = "file:dns_config.yaml";
    public const string ChromeDns = "policy:chrome-dns", EdgeDns = "policy:edge-dns", FirefoxDns = "policy:firefox-dns", FirefoxLock = "policy:firefox-lock";
    public static readonly string[] Files = [Verge, Config, Dns];
    public static readonly string[] Policies = [ChromeDns, EdgeDns, FirefoxDns, FirefoxLock];
    public static readonly string[] All = [.. Files, .. Policies];
    public static bool IsFile(string key) => Files.Contains(key, StringComparer.Ordinal);
    public static void Validate(string key) { if (!All.Contains(key, StringComparer.Ordinal)) throw new InvalidDataException("未知修改目标。"); }
    public static void ValidateValue(string key, StoredValue value)
    {
        Validate(key);
        if (value is null || value.Data is null || value.Data.Length > 12 * 1024 * 1024) throw new InvalidDataException("备份内容无效或过大。");
        if (!value.Exists) { if (value.Kind != "missing" || value.Data != "") throw new InvalidDataException("缺失记录无效。"); return; }
        var bytes = value.Bytes();
        if (IsFile(key)) { if (value.Kind != "file" || bytes.Length > 8 * 1024 * 1024) throw new InvalidDataException("文件快照无效。"); }
        else
        {
            if (!new[] { "String", "ExpandString", "MultiString", "DWord", "QWord", "Binary", "None" }.Contains(value.Kind)) throw new InvalidDataException("注册表快照类型无效。");
            if (value.Kind == "DWord" && bytes.Length != 4 || value.Kind == "QWord" && bytes.Length != 8) throw new InvalidDataException("注册表整数无效。");
            if (value.Kind == "MultiString") _ = JsonSerializer.Deserialize<string[]>(bytes) ?? throw new InvalidDataException("注册表数组无效。");
        }
    }
}

public interface IStateStore
{
    StoredValue Read(string key);
    void Write(string key, StoredValue value);
    void EnsureReady(bool needsClashExit);
}

public sealed class Journal
{
    public int Version { get; set; } = 2;
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Owner { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string Kind { get; set; } = "apply";
    public string? ParentId { get; set; }
    public string State { get; set; } = "prepared";
    public List<Change> Changes { get; set; } = [];
}

public interface IJournalStore
{
    void Save(Journal journal);
    Journal Load(string id);
    // Operations use the strict list; display summaries may include unreadable
    // records, but must never become the source of truth for configuration writes.
    IReadOnlyList<Journal> List();
    IReadOnlyList<BackupSummary> ListForDisplay() => List().Select(BackupSummary.FromJournal).ToArray();
    string Owner { get; }
}

public sealed record BackupSummary(string Id, DateTimeOffset? CreatedAt, string Kind, string State,
    string[] Titles, bool CanRestore, string? Error = null, string? RestoreBlockedReason = null)
{
    public static BackupSummary FromJournal(Journal journal) => new(journal.Id, journal.CreatedAt, journal.Kind, journal.State,
        journal.Changes.Select(change => change.Title).ToArray(), journal.State is "applied" or "applying" or "rollback-failed");
}

public sealed record OperationResult(bool Success, string State, string Message, string? BackupId = null);

public static class JournalValidation
{
    public static void Validate(Journal j, string owner)
    {
        if (j.Version != 2 || j.Owner != owner || !Guid.TryParseExact(j.Id, "N", out _)
            || j.Kind is not ("apply" or "restore") || j.State is not ("prepared" or "applying" or "applied" or "restored" or "rolled-back" or "rollback-failed")
            || j.Changes is null || j.Changes.Count is < 1 or > 7) throw new InvalidDataException("备份清单无效。");
        if (j.ParentId != null && !Guid.TryParseExact(j.ParentId, "N", out _)) throw new InvalidDataException("备份关联无效。");
        if (j.Changes.Any(change => change is null || string.IsNullOrWhiteSpace(change.Key) || string.IsNullOrWhiteSpace(change.Title)
            || change.BeforeText is null || change.AfterText is null)) throw new InvalidDataException("备份项目无效。");
        if (j.Changes.Select(x => x.Key).Distinct(StringComparer.Ordinal).Count() != j.Changes.Count) throw new InvalidDataException("备份目标重复。");
        foreach (var change in j.Changes) { Targets.ValidateValue(change.Key, change.Before); Targets.ValidateValue(change.Key, change.After); }
    }
}
