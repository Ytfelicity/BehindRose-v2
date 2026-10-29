namespace BehindRose.Core;

public sealed record ClaudeTimeZoneValue(string Id, string Label, bool DaylightSavingDisabled = false);
public sealed record ClaudeTimeZoneStatus(string CurrentId, string CurrentLabel, bool CurrentDaylightSavingDisabled,
    string TargetId, string TargetLabel, bool IsTaipei, bool CanConfigure, string[] Warnings);
public sealed record ClaudeTimeZonePreview(string Action, string CurrentId, string CurrentLabel,
    string TargetId, string TargetLabel, bool HasChanges, string Fingerprint, string[] Warnings);
public sealed record ClaudeTimeZoneResult(bool Success, string State, string Message, string? BackupId = null);
public sealed record ClaudeTimeZoneBackup(string Id, DateTimeOffset? CreatedAt, string BeforeId, string BeforeLabel,
    string AfterId, string AfterLabel, bool CanRestore, string State);

public static class ClaudeTimeZoneGuidance
{
    public const string TaipeiId = "Taipei Standard Time";
    public const string TaipeiLabel = "(UTC+08:00) 台北";
    public static string[] Warnings() => [
        "可选个人经验：手册第 03、11 节说明台北时区按实际需要设置，尚未证实防封效果，也没有防封保证。",
        "修改影响整台电脑显示的本地时间及使用本地时间的应用与计划任务，不修改 UTC 系统时钟。",
        "只修改 Windows 时区；不修改位置权限、自动设置时区、自动校时、DNS、Clash 或 Claude 账号。",
        "自动设置时区仍可能在以后改变时区；发现后续变化时，恢复会停止以保留该变化。"
    ];
}
