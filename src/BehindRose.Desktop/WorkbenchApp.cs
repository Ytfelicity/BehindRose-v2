using System.ComponentModel;
using System.IO;
using System.Diagnostics;
using System.Reflection;
using System.Text;
using System.Text.Json;
using BehindRose.Core;
using BehindRose.Desktop;
using BehindRose.Windows;

namespace BehindRose.Desktop;

sealed record Request(string Id, string Command, int Options = 0, string? PlanId = null, string? BackupId = null, int ProxyPort = 0, string? Action = null, string[]? Queries = null, string Profile = "quick", bool IncludeSpeed = false, string? Mode = null);
sealed record Preview(string Id, string Action, RepairPlan Plan, string? BackupId, DateTimeOffset Expires);
sealed record ClaudePreview(string Id, ClaudeConfigurationPlan Plan, DateTimeOffset Expires);
sealed record ClaudeTimeZoneStoredPreview(string Id, ClaudeTimeZonePlan Plan, DateTimeOffset Expires);
sealed record ClashFullStoredPreview(string Id, ClashFullRestorePlan Plan, DateTimeOffset Expires);
sealed record Operation(string Id, string Action, bool Done, string Phase, string Message, OperationResult? Result = null);

sealed class LocalApp(bool demo)
{
    private bool updating;
    public bool IsBusy { get { lock (gate) return updating || operation is { Done: false }; } }
    public IDisposable? ReserveUpdate()
    {
        lock (gate)
        {
            if (updating || operation is { Done: false }) return null;
            updating = true; quality.Stop(); proxyNetwork.Stop();
            return new UpdateLease(() => { lock (gate) updating = false; });
        }
    }
    private sealed class UpdateLease(Action release) : IDisposable { public void Dispose() => release(); }
    private readonly IStateStore state = demo ? new DemoState() : new WindowsState();
    private readonly IJournalStore journals = demo ? new DemoJournals() : new ProtectedJournalStore();
    private readonly Dictionary<string, Preview> previews = [];
    private readonly Dictionary<string, ClaudePreview> claudePreviews = [];
    private readonly Lazy<ClaudeConfigurationService> claudeConfiguration = new(() => demo ? ClaudeConfigurationService.CreateDemo() : new ClaudeConfigurationService());
    private readonly Dictionary<string, ClaudeTimeZoneStoredPreview> claudeTimeZonePreviews = [];
    private readonly Lazy<ClaudeTimeZoneService> claudeTimeZone = new(() => demo ? ClaudeTimeZoneService.CreateDemo() : new ClaudeTimeZoneService());
    private readonly Lazy<ClashFullBackupService> clashFullBackup = new(() => demo ? ClashFullBackupService.CreateDemo() : new ClashFullBackupService());
    private readonly Dictionary<string, ClashFullStoredPreview> clashFullPreviews = [];
    private readonly object gate = new();
    private Operation? operation;
    private Task? pending;
    private readonly IpPureRunner quality = new(IpPureBrowserClient.QueryAsync);
    private readonly ProxyNetworkRunner proxyNetwork = new();

    public object Handle(Request request)
    {
        if (request.Action is not null || request.Queries is not null) throw new InvalidDataException("操作参数无效。");
        lock (gate)
        {
            if (request.Command == "status") return new { operation, demo };
            if (request.Command == "quality-status") return quality.Snapshot();
            if (request.Command == "quality-proxies") return demo ? new LocalProxyPorts([], ["演示环境不读取本机代理端口，可手动填写。"]) : ProxyPortDiscovery.Read();
            if (request.Command == "quality-stop") return quality.Stop();
            if (request.Command == "proxy-network-status") return proxyNetwork.Snapshot();
            if (request.Command == "proxy-network-stop") return proxyNetwork.Stop();
            if (updating) throw new InvalidOperationException("正在更新程序，请等待更新完成或取消更新。");
            if (operation is { Done: false }) throw new InvalidOperationException("正在处理配置，请等待操作结束。");
            if (request.Command == "proxy-network-start" && quality.Snapshot().State == "running" || request.Command == "quality-start" && proxyNetwork.Snapshot().State == "running") throw new InvalidOperationException("请先停止另一项体检，以免检测流量影响结果。");
            return request.Command switch
            {
                "health" => Health(),
                "plan" => Plan((RepairOptions)request.Options),
                "backups" => Backups(),
                "restore-plan" => RestorePlan(request.BackupId),
                "execute" => Execute(request.PlanId),
                "open-clash" => OpenClash(),
                "clash-full-backups" => clashFullBackup.Value.List(),
                "clash-full-backup" => StartFullBackup(),
                "clash-full-restore-plan" => RememberFullRestore(request.BackupId!),
                "clash-full-restore" => StartFullBackup(request.PlanId!),
                "claude-inspect" => ClaudeLocal(() => claudeConfiguration.Value.Inspect()),
                "claude-plan" => ClaudeLocal(() => RememberClaude(claudeConfiguration.Value.Preview(request.Mode!, request.ProxyPort))),
                "claude-backups" => ClaudeLocal(() => claudeConfiguration.Value.ListBackups()),
                "claude-restore-plan" => ClaudeLocal(() => RememberClaude(claudeConfiguration.Value.PreviewRestore(request.BackupId!))),
                "claude-apply" => ClaudeLocal(() => ExecuteClaude(request.PlanId, "apply")),
                "claude-restore" => ClaudeLocal(() => ExecuteClaude(request.PlanId, "restore")),
                "claude-timezone-inspect" => ClaudeLocal(() => claudeTimeZone.Value.Inspect()),
                "claude-timezone-plan" => ClaudeLocal(() => RememberClaudeTimeZone(claudeTimeZone.Value.PreviewTaipei())),
                "claude-timezone-backups" => ClaudeLocal(() => claudeTimeZone.Value.ListBackups()),
                "claude-timezone-restore-plan" => ClaudeLocal(() => RememberClaudeTimeZone(claudeTimeZone.Value.PreviewRestore(request.BackupId!))),
                "claude-timezone-apply" => ClaudeLocal(() => ExecuteClaudeTimeZone(request.PlanId, "apply")),
                "claude-timezone-restore" => ClaudeLocal(() => ExecuteClaudeTimeZone(request.PlanId, "restore")),
                "quality-start" => demo ? throw new InvalidOperationException("演示环境不发起公网体检。") : quality.Start(request.ProxyPort),
                "proxy-network-start" => demo ? throw new InvalidOperationException("演示环境不发起代理网络检测。") : proxyNetwork.Start(request.ProxyPort, request.Profile, request.IncludeSpeed),
                _ => throw new InvalidDataException("不支持的操作。")
            };
        }
    }

    private object RememberFullRestore(string id)
    {
        foreach (var old in clashFullPreviews.Values.Where(x => x.Expires < DateTimeOffset.UtcNow).ToArray()) clashFullPreviews.Remove(old.Id);
        if (clashFullPreviews.Count >= 16) clashFullPreviews.Remove(clashFullPreviews.Keys.First());
        var saved = new ClashFullStoredPreview(Guid.NewGuid().ToString("N"), clashFullBackup.Value.PreviewRestore(id), DateTimeOffset.UtcNow.AddMinutes(10));
        clashFullPreviews.Add(saved.Id, saved);
        return new { saved.Id, saved.Expires, action = "full-restore", saved.Plan.Preview };
    }

    private object StartFullBackup(string? planId = null)
    {
        ClashFullRestorePlan? plan = null;
        if (planId is not null)
        {
            if (!clashFullPreviews.TryGetValue(planId, out var stored) || stored.Expires < DateTimeOffset.UtcNow)
                throw new InvalidOperationException("完整恢复预览已失效，请重新预览。");
            if (!demo && HostDiscovery.IsRunning()) throw new InvalidOperationException("请先在系统托盘退出 Clash，再执行完整恢复。");
            plan = stored.Plan;
        }
        clashFullPreviews.Clear(); previews.Clear(); claudePreviews.Clear(); claudeTimeZonePreviews.Clear();
        quality.Stop(); proxyNetwork.Stop();
        string id = Guid.NewGuid().ToString("N"), action = plan is null ? "full-backup" : "full-restore";
        operation = new(id, action, false, "running", plan is null ? "正在加密保存本机完整配置……" : "正在保存恢复前快照并还原配置……");
        pending = Task.Run(() =>
        {
            OperationResult result;
            try
            {
                if (plan is null)
                {
                    var backup = clashFullBackup.Value.Create();
                    result = new(true, "backed-up", $"已在本机加密保存 {backup.FileCount} 个配置文件，包含订阅、节点、脚本、分流及 TUN 设置。", backup.Id);
                }
                else result = clashFullBackup.Value.Restore(plan, message => { lock (gate) operation = new(id, action, false, "running", message); });
            }
            catch (Exception error)
            {
                string message = error is IOException ? "无法安全读取或写入配置。请退出 Clash 后重试，并保留现有本机备份。" : Message(error);
                result = new(false, "failed", message);
            }
            lock (gate) operation = new(id, action, true, result.Success ? "complete" : "failed", result.Message, result);
        });
        return new { operation };
    }

    // Explicit local operations: Claude settings or the optional Windows time zone.
    // The latter invokes the fixed system setter only after a confirmed preview.
    // Neither path uses network runners, the Clash process or account login.
    private static object ClaudeLocal(Func<object> action)
    {
        try { return action(); }
        catch (InvalidDataException ex) { throw new InvalidOperationException(ex.Message, ex); }
    }

    private object RememberClaude(ClaudeConfigurationPlan plan)
    {
        foreach (var old in claudePreviews.Values.Where(item => item.Expires < DateTimeOffset.UtcNow).ToArray()) claudePreviews.Remove(old.Id);
        if (claudePreviews.Count >= 16) claudePreviews.Remove(claudePreviews.Keys.First());
        var saved = new ClaudePreview(Guid.NewGuid().ToString("N"), plan, DateTimeOffset.UtcNow.AddMinutes(10));
        claudePreviews.Add(saved.Id, saved);
        var view = plan.Preview;
        return new { saved.Id, saved.Expires, view.Action, view.Mode, view.ProxyPort, view.HasChanges, view.Changes, view.Warnings };
    }

    private object ExecuteClaude(string? id, string action)
    {
        if (id is null || !claudePreviews.TryGetValue(id, out var saved) || saved.Expires < DateTimeOffset.UtcNow)
            throw new InvalidOperationException("Claude 配置预览已失效，请重新生成。");
        if (saved.Plan.Preview.Action != action) throw new InvalidDataException("配置预览与执行操作不匹配。");
        // A preview cannot be replayed, including after a stale-file rejection.
        claudePreviews.Clear();
        return action == "apply" ? claudeConfiguration.Value.Apply(saved.Plan) : claudeConfiguration.Value.Restore(saved.Plan);
    }

    private object RememberClaudeTimeZone(ClaudeTimeZonePlan plan)
    {
        foreach (var old in claudeTimeZonePreviews.Values.Where(item => item.Expires < DateTimeOffset.UtcNow).ToArray()) claudeTimeZonePreviews.Remove(old.Id);
        if (claudeTimeZonePreviews.Count >= 16) claudeTimeZonePreviews.Remove(claudeTimeZonePreviews.Keys.First());
        var saved = new ClaudeTimeZoneStoredPreview(Guid.NewGuid().ToString("N"), plan, DateTimeOffset.UtcNow.AddMinutes(10));
        claudeTimeZonePreviews.Add(saved.Id, saved);
        var view = plan.Preview;
        return new { saved.Id, saved.Expires, view.Action, view.CurrentId, view.CurrentLabel, view.TargetId, view.TargetLabel, view.HasChanges, view.Warnings };
    }

    private object ExecuteClaudeTimeZone(string? id, string action)
    {
        if (id is null || !claudeTimeZonePreviews.TryGetValue(id, out var saved) || saved.Expires < DateTimeOffset.UtcNow)
            throw new InvalidOperationException("时区预览已失效，请重新生成。");
        if (saved.Plan.Preview.Action != action) throw new InvalidDataException("时区预览与执行操作不匹配。");
        claudeTimeZonePreviews.Clear();
        return action == "apply" ? claudeTimeZone.Value.Apply(saved.Plan) : claudeTimeZone.Value.Restore(saved.Plan);
    }

    private HostInfo Host() => demo ? new(null, "2.5.2", false, true, "内存演示环境") : HostDiscovery.Find();
    private object Health()
    {
        var host = Host();
        var findings = RepairPlanner.Inspect(state).ToList();
        if (!demo)
            foreach (var (key, title) in new[] { (Targets.ChromeDns, "Chrome DNS"), (Targets.EdgeDns, "Edge DNS"), (Targets.FirefoxDns, "Firefox DNS"), (Targets.FirefoxLock, "Firefox DNS") })
                try { WindowsState.EnsurePolicyUnmanaged(key); }
                catch (InvalidOperationException)
                {
                    var index = findings.FindIndex(x => x.Title == title);
                    if (index >= 0) findings[index] = new(title, "存在计算机级策略，需由设备管理员调整。", "由管理员管理");
                }
        return new { checkedAt = DateTimeOffset.Now, demo, host = new { host.Version, host.Running, host.Compatible, found = host.Executable != null || demo, host.Note }, findings, clashIpv6 = RepairPlanner.InspectClashIpv6(state), singMix = SingMixProfile.Inspect(state), detectionProxyPort = demo ? null : DetectionProxy.ReadPort(), tunRuntime = demo ? new Finding("虚拟网卡运行状态", "演示环境不检查或启用真实网卡。", "演示") : TunAdapterInspection.Read(state) };
    }

    private object Plan(RepairOptions options)
    {
        var plan = RepairPlanner.Build(state, options);
        ValidatePlan(plan);
        if (journals.List().Any(x => x.State is "applying" or "rollback-failed"))
            throw new InvalidOperationException("发现未完成的操作，请先到备份与恢复处理。");
        return Remember("apply", plan);
    }

    private void ValidatePlan(RepairPlan plan)
    {
        if (demo) return;
        // "Clash must be closed" is decided by the live process, which Execute
        // re-checks right before writing. Requiring the executable to be
        // discoverable here deadlocked every install the app could not locate
        // while the client was closed (for example a portable folder): the
        // preview demanded the client be exited, then the apply refused for
        // "未找到客户端". Configuration validity is already enforced by
        // RepairPlanner.Build when the plan is produced.
        foreach (var change in plan.Changes) WindowsState.EnsurePolicyUnmanaged(change.Key);
    }

    private object Remember(string action, RepairPlan plan, string? backupId = null)
    {
        foreach (var item in previews.Values.Where(x => x.Expires < DateTimeOffset.UtcNow).ToArray()) previews.Remove(item.Id);
        if (previews.Count >= 16) previews.Remove(previews.Keys.First());
        var preview = new Preview(Guid.NewGuid().ToString("N"), action, plan, backupId, DateTimeOffset.UtcNow.AddMinutes(10));
        previews.Add(preview.Id, preview);
        return new { preview.Id, preview.Action, preview.Expires, options = (int)plan.Options, plan.NeedsClashExit, clashRunning = Host().Running,
            changes = plan.Changes.Select(x => new { x.Title, x.BeforeText, x.AfterText }).ToArray(), tun = RepairPlanner.DescribeTun(plan) };
    }

    private object Backups() => journals.ListForDisplay();

    private RepairPlan BuildRestore(string id)
    {
        if (!Guid.TryParseExact(id, "N", out _)) throw new InvalidDataException("备份编号无效。");
        var backup = journals.Load(id); JournalValidation.Validate(backup, journals.Owner);
        if (backup.State is not ("applied" or "applying" or "rollback-failed")) throw new InvalidOperationException("这份备份当前不需要恢复。");
        if (journals.List().Any(x => x.Id != id && x.State is "applying" or "rollback-failed"))
            throw new InvalidOperationException("请先恢复上一次未完成的操作。");
        var expected = new Dictionary<string, StoredValue>(); var changes = new List<Change>();
        foreach (var item in backup.Changes)
        {
            var current = state.Read(item.Key);
            if (current != item.After && current != item.Before) throw new InvalidOperationException(item.Title + " 在修复后又发生了变动。为保留后续修改，本次恢复已停止。");
            expected[item.Key] = current;
            if (current != item.Before) changes.Add(new(item.Key, item.Title, "当前状态", "修复前的原始状态", current, item.Before));
        }
        return new(RepairOptions.None, expected, changes);
    }

    private object RestorePlan(string? id) => Remember("restore", BuildRestore(id ?? ""), id);

    private object Execute(string? id)
    {
        if (id == null || !previews.TryGetValue(id, out var preview) || preview.Expires < DateTimeOffset.UtcNow)
            throw new InvalidOperationException("预览已失效，请重新生成。");
        var fresh = preview.Action == "apply" ? RepairPlanner.Build(state, preview.Plan.Options) : BuildRestore(preview.BackupId!);
        if (fresh.Fingerprint != preview.Plan.Fingerprint) { previews.Remove(id); throw new InvalidOperationException("预览后配置已经变化，请重新生成预览。"); }
        if (preview.Action == "apply") ValidatePlan(fresh);
        if (fresh.NeedsClashExit && Host().Running) throw new InvalidOperationException("请先在系统托盘退出 Clash Verge，再点击执行。不会自动关闭你的应用。");
        quality.Stop();
        proxyNetwork.Stop();
        previews.Clear();
        operation = new(Guid.NewGuid().ToString("N"), preview.Action, false, "authorizing", demo ? "正在演示……" : "等待 Windows 管理员授权……");
        if (preview.Action == "apply" && fresh.Changes.Count == 0)
        {
            var result = new OperationResult(true, "unchanged", "设置已经符合所选目标，无需重复修改。");
            operation = operation with { Done = true, Phase = "complete", Message = result.Message, Result = result };
        }
        else pending = Task.Run(() => Run(preview, operation.Id));
        return new { operation };
    }

    private async Task Run(Preview preview, string id)
    {
        void Update(string phase, string message, OperationResult? result = null)
        { lock (gate) operation = new(id, preview.Action, result != null, phase, message, result); }
        try
        {
            if (demo)
            {
                lock (gate)
                {
                    var engine = new RepairEngine(state, journals);
                    var demoResult = preview.Action == "apply" ? engine.Apply(preview.Plan) : engine.Restore(preview.BackupId!);
                    Update("complete", demoResult.Message, demoResult);
                }
                return;
            }
            using var own = Process.GetCurrentProcess();
            var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = true, Verb = "runas", WindowStyle = ProcessWindowStyle.Hidden };
            if (string.Equals(Path.GetFileNameWithoutExtension(Environment.ProcessPath), "dotnet", StringComparison.OrdinalIgnoreCase))
                start.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, Assembly.GetExecutingAssembly().GetName().Name + ".dll"));
            foreach (var arg in new[] { "--worker", preview.Action, WindowsState.UserSid, id, own.SessionId.ToString(),
                preview.Action == "apply" ? ((int)preview.Plan.Options).ToString() : preview.BackupId!,
                preview.Action == "apply" ? preview.Plan.Fingerprint : "restore" }) start.ArgumentList.Add(arg);
            using var worker = Process.Start(start) ?? throw new InvalidOperationException("未能启动配置进程。");
            var store = (ProtectedJournalStore)journals;
            while (!worker.HasExited)
            {
                try { if (store.ReadReport(id) is { } progress) Update(progress.Phase, progress.Message); }
                catch (IOException) { /* Atomic status replacement can briefly race a read. */ }
                await Task.Delay(400);
            }
            var final = store.ReadReport(id);
            var result = final?.Result ?? new(false, worker.ExitCode == 90 ? "not-started" : "unknown", worker.ExitCode == 90 ? "配置进程拒绝了请求，未开始修改。" : "未收到完整结果，请到备份页核对操作状态。");
            Update(final?.Phase ?? "failed", result.Message, result);
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
        { Update("cancelled", "已取消管理员授权，未修改配置。", new(false, "cancelled", "已取消管理员授权，未修改配置。")); }
        catch (Exception ex) { Update("failed", Message(ex), new(false, "failed", Message(ex))); }
    }

    private object OpenClash()
    {
        if (demo) return new { message = "演示模式不会启动真实应用。" };
        var host = Host();
        if (host.Running) return new { message = "Clash 已在运行。" };
        if (host.Executable == null) throw new InvalidOperationException("未找到 Clash，请手动打开后重新体检。");
        Process.Start(new ProcessStartInfo(host.Executable) { UseShellExecute = true });
        return new { message = "已打开 Clash，等待连接就绪后可进行网络复检。" };
    }

    public async Task FinishAsync() { await Task.WhenAll(quality.FinishAsync(), proxyNetwork.FinishAsync()); if (pending is not null) await pending; }
    public static string Message(Exception ex) => ex switch
    {
        JsonException => "请求格式不正确。",
        YamlDotNet.Core.YamlException => "配置文件无法解析，请先检查 Clash 配置。",
        FileNotFoundException or DirectoryNotFoundException => "未找到所需文件，请刷新体检或备份列表。",
        _ => ex.Message
    };
}
