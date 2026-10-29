using System.Diagnostics;
using BehindRose.Core;
using Microsoft.Win32;

namespace BehindRose.Windows;

public interface IClaudeTimeZoneState
{
    ClaudeTimeZoneValue Read();
    ClaudeTimeZoneValue Resolve(string id, bool daylightSavingDisabled = false);
    void Write(ClaudeTimeZoneValue value);
}

public sealed class ClaudeTimeZoneCompletionUnknownException : IOException
{
    public ClaudeTimeZoneCompletionUnknownException() : base("无法确认时区工具已经结束；已停止后续自动修改，请先人工核对 Windows 时区和该工具进程。") { }
}

/// <summary>Reads only Windows time-zone data. The setter runs only after service confirmation.</summary>
public sealed class ClaudeTimeZoneWindowsState : IClaudeTimeZoneState
{
    public ClaudeTimeZoneValue Read()
    {
        using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\TimeZoneInformation", false);
        if (key?.GetValue("TimeZoneKeyName") is not string id || string.IsNullOrWhiteSpace(id))
            throw new InvalidDataException("无法识别当前 Windows 时区。");
        object? daylight = key.GetValue("DynamicDaylightTimeDisabled");
        if (daylight is not null and not int) throw new InvalidDataException("无法识别当前夏令时设置。");
        return Resolve(id.TrimEnd('\0'), daylight is int disabled && disabled != 0);
    }

    public ClaudeTimeZoneValue Resolve(string id, bool daylightSavingDisabled = false)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 128) throw new InvalidDataException("Windows 时区编号无效。");
        // Only IDs present in the local Windows catalog are accepted, including on restore.
        var zone = TimeZoneInfo.GetSystemTimeZones().FirstOrDefault(item => item.Id.Equals(id, StringComparison.Ordinal));
        if (zone is null) throw new InvalidDataException("这台电脑没有对应的 Windows 时区，不能自动应用或恢复。");
        return new(zone.Id, zone.DisplayName, daylightSavingDisabled);
    }

    public void Write(ClaudeTimeZoneValue value)
    {
        var known = Resolve(value.Id, value.DaylightSavingDisabled);
        string executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "tzutil.exe");
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true, RedirectStandardError = true
        };
        start.ArgumentList.Add("/s");
        start.ArgumentList.Add(known.Id + (known.DaylightSavingDisabled ? "_dstoff" : ""));
        using var process = Process.Start(start) ?? throw new IOException("无法启动 Windows 时区设置工具。");
        bool exitConfirmed = false;
        try
        {
        // Drain streams without exposing output, and bound both execution and drain waits.
        Task<string> output = process.StandardOutput.ReadToEndAsync(), error = process.StandardError.ReadToEndAsync();
        foreach (Task task in new Task[] { output, error })
            _ = task.ContinueWith(failed => { _ = failed.Exception; }, TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously);
        if (!process.WaitForExit(15_000))
        {
            exitConfirmed = StopOwnedChild(process);
            if (!exitConfirmed) throw new ClaudeTimeZoneCompletionUnknownException();
            throw new IOException("Windows 时区工具执行超时，已确认该工具结束；本次操作将核对并尝试恢复原时区。");
        }
        exitConfirmed = true;
        try { _ = Task.WaitAll([output, error], 2_000); }
        catch (AggregateException) { /* Stream cleanup must not obscure the known child exit result. */ }
        if (process.ExitCode != 0) throw new IOException("Windows 拒绝了时区修改，请检查账户的更改时区权限；未自动申请管理员权限。");
        TimeZoneInfo.ClearCachedData();
        }
        catch (ClaudeTimeZoneCompletionUnknownException) { throw; }
        catch (Exception failure) when (!exitConfirmed && failure is IOException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            // Stream/wait failures after Process.Start also leave a possibly live setter.
            if (!StopOwnedChild(process)) throw new ClaudeTimeZoneCompletionUnknownException();
            throw new IOException("Windows 时区工具未完成，但已确认该工具结束；本次操作将核对并尝试恢复原时区。");
        }
    }
    private static bool StopOwnedChild(Process process)
    {
        // Only terminate the child created by this call. Never touch other tzutil processes.
        try { if (process.HasExited) return true; process.Kill(); }
        catch (Exception failure) when (failure is InvalidOperationException or System.ComponentModel.Win32Exception) { }
        try { return process.WaitForExit(3_000); }
        catch (Exception failure) when (failure is InvalidOperationException or System.ComponentModel.Win32Exception) { return false; }
    }
}
