namespace BehindRose.Core;

// The caller holds the interprocess lock. Every write is journaled before execution.
public sealed class RepairEngine(IStateStore state, IJournalStore journals)
{
    public OperationResult Apply(RepairPlan plan, Action<string>? report = null)
    {
        if (journals.List().Any(x => x.State is "applying" or "rollback-failed"))
            throw new InvalidOperationException("发现未完成的操作，请先在备份页恢复。");
        CheckExpected(plan.Expected);
        if (plan.Changes.Count == 0) return new(true, "unchanged", "设置已经符合所选目标，无需重复修改。");
        state.EnsureReady(plan.NeedsClashExit);
        var journal = new Journal { Owner = journals.Owner, Changes = plan.Changes.ToList() };
        return Execute(journal, plan.Expected, report);
    }

    public OperationResult Restore(string id, Action<string>? report = null)
    {
        var target = journals.Load(id); JournalValidation.Validate(target, journals.Owner);
        if (target.State is not ("applied" or "applying" or "rollback-failed")) throw new InvalidOperationException("这份备份当前不需要恢复。");
        if (journals.List().Any(x => x.Id != id && x.State is "applying" or "rollback-failed"))
            throw new InvalidOperationException("请先恢复上一次未完成的操作，再选择其他备份。");
        var changes = new List<Change>();
        var expected = new Dictionary<string, StoredValue>();
        foreach (var item in target.Changes)
        {
            var current = state.Read(item.Key);
            // Never overwrite edits made by the user or another application since this operation.
            if (current != item.After && current != item.Before)
                throw new InvalidOperationException(item.Title + " 在修复后又发生了变动。为保留后续修改，本次恢复已停止；请先查看备份与当前配置。");
            expected[item.Key] = current;
            if (current != item.Before) changes.Add(new(item.Key, item.Title, "恢复前状态", "原始状态", current, item.Before));
        }
        if (changes.Count == 0) { target.State = "restored"; journals.Save(target); return new(true, "restored", "当前状态已与备份一致。", id); }
        state.EnsureReady(changes.Any(x => Targets.IsFile(x.Key)));
        var restore = new Journal { Owner = journals.Owner, Kind = "restore", ParentId = id, Changes = changes };
        var result = Execute(restore, expected, report);
        if (result.Success)
        {
            target.State = "restored";
            try { journals.Save(target); }
            catch { return result with { Message = "恢复成功，但原备份状态标记未保存。请刷新列表核对。" }; }
        }
        return result;
    }

    private OperationResult Execute(Journal journal, IReadOnlyDictionary<string, StoredValue> expected, Action<string>? report)
    {
        JournalValidation.Validate(journal, journals.Owner);
        void Report(string message) { try { report?.Invoke(message); } catch { /* Progress must never interrupt a transaction. */ } }
        Report("正在保存并核验备份……");
        journals.Save(journal);
        var persisted = journals.Load(journal.Id); JournalValidation.Validate(persisted, journals.Owner);
        if (!persisted.Changes.SequenceEqual(journal.Changes)) throw new InvalidDataException("备份写入核对失败。");
        CheckExpected(expected);
        journal.State = "applying"; journals.Save(journal);
        var touched = new List<Change>();
        try
        {
            foreach (var change in journal.Changes)
            {
                if (state.Read(change.Key) != change.Before) throw new IOException(change.Title + " 在应用前发生变化。");
                Report("正在修改：" + change.Title);
                touched.Add(change); // Includes a target whose write partially succeeds before throwing.
                state.Write(change.Key, change.After);
                if (state.Read(change.Key) != change.After) throw new IOException(change.Title + " 写入核对失败。");
            }
            foreach (var change in journal.Changes)
                if (state.Read(change.Key) != change.After) throw new IOException(change.Title + " 完成核对失败。");
            journal.State = journal.Kind == "restore" ? "restored" : "applied"; journals.Save(journal);
            return new(true, journal.State, journal.Kind == "restore" ? "已恢复配置。重新打开相关程序后复检。" : "所选配置已写入并核对。请重新打开 Clash，浏览器策略在重启浏览器后复检。", journal.Id);
        }
        catch (Exception error)
        {
            Report("操作未完成，正在恢复本次已经修改的项目……");
            var failures = new List<string>();
            foreach (var change in touched.AsEnumerable().Reverse())
            {
                try
                {
                    var current = state.Read(change.Key);
                    if (current != change.Before && current != change.After) throw new IOException("发现并发修改，未覆盖");
                    if (current != change.Before) state.Write(change.Key, change.Before);
                    if (state.Read(change.Key) != change.Before) throw new IOException("恢复核对失败");
                }
                catch (Exception rollbackError) { failures.Add(change.Title + "：" + rollbackError.Message); }
            }
            journal.State = failures.Count == 0 ? "rolled-back" : "rollback-failed";
            try { journals.Save(journal); } catch { failures.Add("恢复状态未能写入备份记录"); }
            return new(false, failures.Count == 0 ? "rolled-back" : "rollback-failed",
                failures.Count == 0 ? "操作失败，已撤销本次修改。原因：" + error.Message : "操作失败，部分项目需要恢复。" + error.Message + "；" + string.Join("；", failures), journal.Id);
        }
    }

    private void CheckExpected(IReadOnlyDictionary<string, StoredValue> expected)
    {
        foreach (var item in expected)
            if (state.Read(item.Key) != item.Value) throw new IOException("预览后配置已经变化，请重新体检并生成建议。");
    }
}
