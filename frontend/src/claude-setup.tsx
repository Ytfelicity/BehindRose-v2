import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Clock3, FileCheck2, FolderClock, Info, LockKeyhole, RotateCcw, ShieldCheck, Terminal } from 'lucide-react';

export type ClaudeMode = 'preserve' | 'official';
export type ClaudeInspection = {
  settingsFound: boolean; canConfigure: boolean; route: string;
  configuredProxyPort: number | null; suggestedProxyPorts: number[];
  conflictingEnvironmentVariables: string[]; customModelVariables: string[]; warnings: string[];
};
export type ClaudePlan = {
  id: string; expires: string; action: 'apply' | 'restore'; mode: ClaudeBackup['mode']; proxyPort: number;
  hasChanges: boolean; changes: { title: string; beforeText: string; afterText: string }[]; warnings: string[];
};
export type ClaudeBackup = { id: string; createdAt: string | null; mode: ClaudeMode | 'restore' | 'unknown'; canRestore: boolean; state: string };
type ClaudeResult = { success: boolean; state: string; message: string; backupId: string | null };
type ClaudeCommand = 'claude-inspect' | 'claude-plan' | 'claude-apply' | 'claude-backups' | 'claude-restore-plan' | 'claude-restore';
type ClaudeFields = { mode?: ClaudeMode; proxyPort?: number; planId?: string; backupId?: string };
const commands = new Set<ClaudeCommand>(['claude-inspect', 'claude-plan', 'claude-apply', 'claude-backups', 'claude-restore-plan', 'claude-restore']);

export function validateClaudePort(value: string): number | null {
  if (!/^\d{1,5}$/.test(value.trim())) return null;
  const port = Number(value.trim());
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

// This bridge only addresses the local workbench. It has no probe, login,
// installer, proxy-controller or model-request commands.
export async function claudeSetupApi<T>(command: ClaudeCommand, fields: ClaudeFields = {}): Promise<T> {
  if (!commands.has(command)) throw Error('不支持此配置操作。');
  const sessionResponse = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!sessionResponse.ok) throw Error('无法读取本机服务状态，请稍后重试。');
  const session = await sessionResponse.json();
  if (!session.ready || !session.token) throw Error(session.error || '本机服务尚未就绪，请稍后重试。');
  const response = await fetch('/api/local', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BehindRose-Token': session.token },
    body: JSON.stringify({ command, ...fields }), signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw Error(result.error || '本机配置操作未完成。');
  return result.data as T;
}

export const claudeBackupModeLabel = (mode: ClaudeBackup['mode']) => ({ preserve: '保留当前路线', official: '官方订阅', restore: '恢复前备份', unknown: '无法识别' })[mode] ?? '无法识别';
export const claudeBackupStateLabel = (state: string) => ({
  prepared: '备份已创建，等待确认恢复', applied: '配置已应用', restored: '恢复已完成',
  'rolled-back': '已回退到操作前', 'rollback-failed': '自动回退未完成，需恢复', applying: '执行状态待核对', 'completion-unknown': '完成状态不明确（需人工核对）', unreadable: '记录无法读取',
} as Record<string, string>)[state] ?? '记录状态无法识别';
export const claudePlanCanExecute = (plan: ClaudePlan) => plan.action === 'restore' || plan.hasChanges;
export const claudeDateLabel = (value: string | null) => {
  if (!value) return '时间无法读取';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间无法读取' : date.toLocaleString('zh-CN', { hour12: false });
};
const errorLabel = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请刷新本机配置后重试。';
export const workbenchConfigurationBusy = () => typeof document !== 'undefined' && document.body?.dataset.configBusy === 'true';
export function useWorkbenchConfigurationBusy() {
  const [busy, setBusy] = useState(workbenchConfigurationBusy);
  useEffect(() => {
    setBusy(workbenchConfigurationBusy());
    const changed = (event: Event) => setBusy(!!(event as CustomEvent<boolean>).detail);
    addEventListener('workbench-config-busy', changed);
    return () => removeEventListener('workbench-config-busy', changed);
  }, []);
  return busy;
}

function PlanChanges({ changes }: { changes: ClaudePlan['changes'] }) {
  return <div className="claude-changes">{changes.map((change, index) => <article className="claude-change" key={index}>
    <h4>{change.title}</h4>
    <div className="claude-diff"><div><span>当前</span><pre>{change.beforeText || '未设置'}</pre></div><ArrowRight size={15} aria-hidden="true"/><div><span>调整后</span><pre>{change.afterText || '移除该设置'}</pre></div></div>
  </article>)}</div>;
}

export function ClaudeSetup({ active, recoveryOnly = false }: { active: boolean; recoveryOnly?: boolean }) {
  const [inspection, setInspection] = useState<ClaudeInspection | null>(null);
  const [backups, setBackups] = useState<ClaudeBackup[]>([]);
  const [mode, setMode] = useState<ClaudeMode>('preserve');
  const [port, setPort] = useState('');
  const [manual, setManual] = useState(false);
  const [plan, setPlan] = useState<ClaudePlan | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState('');
  const externalBusy = useWorkbenchConfigurationBusy();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [officialReady, setOfficialReady] = useState(false);
  const revision = useRef(0), portChosen = useRef(false), inFlight = useRef(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const disabled = !!busy || externalBusy;
  const knownPorts = [...new Set(inspection?.suggestedProxyPorts ?? [])].filter(value => validateClaudePort(String(value)) !== null);
  if (inspection?.configuredProxyPort && !knownPorts.includes(inspection.configuredProxyPort)) knownPorts.unshift(inspection.configuredProxyPort);

  function discardPlan() { setPlan(null); setConfirmed(false); }
  async function refresh() {
    if (inFlight.current || workbenchConfigurationBusy()) return;
    inFlight.current = true;
    const request = ++revision.current;
    setBusy('read'); setError(''); discardPlan();
    try {
      const results = await Promise.all([
        recoveryOnly ? Promise.resolve(null) : claudeSetupApi<ClaudeInspection>('claude-inspect'),
        claudeSetupApi<ClaudeBackup[]>('claude-backups'),
      ]);
      if (request !== revision.current) return;
      setInspection(results[0]); setBackups(results[1]);
      if (results[0] && !portChosen.current) {
        const found = results[0].configuredProxyPort ?? (results[0].suggestedProxyPorts.length === 1 ? results[0].suggestedProxyPorts[0] : null);
        setPort(found ? String(found) : '');
        setManual(!results[0].suggestedProxyPorts.length && !found);
      }
    } catch (cause) { if (request === revision.current) setError(errorLabel(cause)); }
    finally { if (request === revision.current) setBusy(''); inFlight.current = false; }
  }
  useEffect(() => { if (active) void refresh(); }, [active, recoveryOnly]);
  useEffect(() => { if (plan && active) reviewHeading.current?.focus(); }, [plan, active]);

  async function preview(backupId?: string) {
    if (inFlight.current || externalBusy || workbenchConfigurationBusy() || recoveryOnly && !backupId) return;
    const proxyPort = validateClaudePort(port);
    if (!backupId && proxyPort === null) { setError('请填写 1–65535 之间的 HTTP / Mixed 代理端口。'); return; }
    inFlight.current = true; setBusy(backupId ? 'restore-plan' : 'plan'); setError(''); setMessage(''); discardPlan();
    try {
      const next = backupId
        ? await claudeSetupApi<ClaudePlan>('claude-restore-plan', { backupId })
        : await claudeSetupApi<ClaudePlan>('claude-plan', { mode, proxyPort: proxyPort! });
      setPlan(next);
    } catch (cause) { setError(errorLabel(cause)); }
    finally { setBusy(''); inFlight.current = false; }
  }
  async function apply() {
    if (!plan || !confirmed || !claudePlanCanExecute(plan) || inFlight.current || externalBusy || workbenchConfigurationBusy() || recoveryOnly && plan.action !== 'restore') return;
    if (Date.parse(plan.expires) <= Date.now()) { discardPlan(); setError('预览已过期，请重新生成方案后确认。'); return; }
    const current = plan;
    inFlight.current = true; setBusy(current.action); setError(''); setMessage(''); discardPlan();
    dispatchEvent(new CustomEvent('claude-config-busy', { detail: true }));
    try {
      const result = await claudeSetupApi<ClaudeResult>(current.action === 'restore' ? 'claude-restore' : 'claude-apply', { planId: current.id });
      if (!result.success) {
        const failureMessage = result.message || '配置存在冲突，请刷新本机配置后重新预览。';
        setError(failureMessage);
        // A failed write may still have produced a recovery backup. Expose it
        // without retrying the mutation or losing the original failure reason.
        try { setBackups(await claudeSetupApi<ClaudeBackup[]>('claude-backups')); }
        catch { setError(`${failureMessage} 恢复记录暂未刷新，请点击“刷新本机配置”读取。`); }
        return;
      }
      setMessage(result.message || (current.action === 'restore' ? '已恢复配置。请在下次启动 Claude Code 时使用。' : '本机配置已保存。重新启动 Claude Code 后生效。'));
      setOfficialReady(current.action === 'apply' && current.mode === 'official');
      // Reads after a confirmed write do not execute Claude or contact its service.
      try {
        const [nextInspection, nextBackups] = await Promise.all([
          recoveryOnly ? Promise.resolve(null) : claudeSetupApi<ClaudeInspection>('claude-inspect'), claudeSetupApi<ClaudeBackup[]>('claude-backups'),
        ]);
        setInspection(nextInspection); setBackups(nextBackups);
      } catch { setError('配置操作已完成，但列表刷新失败。请点击“刷新本机配置”读取最新记录。'); }
    } catch (cause) {
      setError(`${errorLabel(cause)} 如请求中断，先刷新本机配置与恢复记录，确认结果后再生成方案。`);
    } finally { setBusy(''); inFlight.current = false; dispatchEvent(new CustomEvent('claude-config-busy', { detail: false })); }
  }
  if (!active) return null;
  return <div className="claude-setup">
    <div className="page-heading"><div>{recoveryOnly ? <h3>工具箱已有设置备份</h3> : <h1>Claude Code</h1>}<p className="intro">{recoveryOnly ? '仅恢复此前由工具箱保存的 settings.json，不等同于手册要求的整个 .claude 目录备份。' : '把终端代理与使用路线一起配好，确认后保存。'}</p></div><button type="button" className="text-button" disabled={disabled} onClick={() => void refresh()}><RotateCcw size={14}/>{busy === 'read' ? '正在读取…' : recoveryOnly ? '刷新恢复记录' : '刷新本机配置'}</button></div>
    {!recoveryOnly && <div className="claude-scope"><LockKeyhole size={16}/><p><strong>只处理本机配置，不做网络测试。</strong><span>不切换 Clash 节点、TUN 或系统代理，不执行登录。配置生效后，由你决定何时启动 Claude Code。</span></p></div>}
    {error && <div className="claude-feedback claude-error" role="alert"><Info size={17}/><p>{error}</p></div>}
    {message && <div className="claude-feedback claude-success" role="status"><Check size={17}/><p>{message}</p></div>}
    {(busy === 'apply' || busy === 'restore') && <div className="claude-feedback" role="status"><Clock3 size={17}/><p>{busy === 'restore' ? '正在核对并恢复本机配置…' : '正在加密备份并保存本机配置…'}</p></div>}
    {externalBusy && <div className="claude-feedback" role="status"><Clock3 size={17}/><p>工具箱正在执行其他配置操作，完成后即可继续。</p></div>}
    {!recoveryOnly && <><section className="claude-status" aria-labelledby="claude-status-title" aria-busy={busy === 'read'}>
      <div className="claude-section-title"><h2 id="claude-status-title">当前配置</h2><span className="claude-local-label">本机读取 · 凭据不展示</span></div>
      {!inspection ? <p className="claude-empty">{busy === 'read' ? '正在读取 Claude 设置与已有代理端口…' : '暂未取得配置。请刷新后继续。'}</p> : <>
        <dl className="claude-facts"><div><dt>使用路线</dt><dd>{inspection.route || '尚未设置'}</dd></div><div><dt>终端代理端口</dt><dd>{inspection.configuredProxyPort ?? '尚未设置'}</dd></div><div><dt>用户配置文件</dt><dd>{inspection.settingsFound ? '已找到' : '尚未创建'}</dd></div></dl>
        {!!inspection.customModelVariables.length && <details className="claude-detail"><summary>已配置 {inspection.customModelVariables.length} 项模型覆盖<ChevronDown size={14}/></summary><p>模型名称由当前路线决定；选择“保留当前路线”会保留这些设置。</p><ul>{inspection.customModelVariables.map(name => <li key={name}><code>{name}</code></li>)}</ul></details>}
        {!!inspection.conflictingEnvironmentVariables.length && <div className="claude-warning"><Info size={16}/><div><strong>发现可能影响路线的环境变量</strong><p>{inspection.conflictingEnvironmentVariables.join('、')}</p><p>这里只显示变量名称。请在预览中核对处理范围；其他终端或项目设置也可能覆盖用户配置。</p></div></div>}
        {inspection.warnings.map((warning, index) => <p className="claude-inline-note" key={index}>{warning}</p>)}
      </>}
    </section>
    <section className="claude-configure" aria-labelledby="claude-configure-title">
      <div className="claude-section-title"><h2 id="claude-configure-title"><span className="claude-step">01</span>选择使用路线</h2><span>先预览，再保存</span></div>
      <fieldset className="claude-mode-grid" disabled={disabled || !inspection?.canConfigure}><legend className="claude-sr-only">Claude Code 使用路线</legend>
        <label className={'claude-mode-card' + (mode === 'preserve' ? ' is-selected' : '')}><input type="radio" name="claude-mode" value="preserve" checked={mode === 'preserve'} onChange={() => { setMode('preserve'); discardPlan(); }}/><span><strong>保留当前路线 <em>默认</em></strong><small>保留已有网关、凭据和模型映射，只配置 Claude Code 使用的本机代理。</small></span></label>
        <label className={'claude-mode-card' + (mode === 'official' ? ' is-selected' : '')}><input type="radio" name="claude-mode" value="official" checked={mode === 'official'} onChange={() => { setMode('official'); discardPlan(); }}/><span><strong>使用 Claude 官方订阅</strong><small>清除预览中列出的第三方网关、凭据与模型覆盖，再由你登录自己的 Claude 订阅。</small></span></label>
      </fieldset>
      {mode === 'official' && <div className="claude-warning"><Info size={16}/><div><strong>此选项会改变 Claude Code 的使用路线</strong><p>保存后不再沿用被移除的网关和模型映射。需要你已有可用于 Claude Code 的官方账号；工具箱不会购买订阅或自动登录。</p></div></div>}
      <div className="claude-port-section"><div><h3><span className="claude-step">02</span>选择 HTTP / Mixed 端口</h3><p>从已有本机设置读取候选端口，也可以按 Clash 显示的端口填写。这里不会尝试连接端口。</p></div>
        <div className="claude-port-controls">
          {knownPorts.length > 0 && <label><span>本机代理端口</span><select aria-label="Claude 本机代理端口" disabled={disabled || !inspection?.canConfigure} value={manual || port && !knownPorts.includes(Number(port)) ? 'manual' : port} onChange={event => {
            portChosen.current = true; setManual(event.target.value === 'manual'); if (event.target.value !== 'manual') setPort(event.target.value); discardPlan();
          }}><option value="" disabled>请选择端口</option>{knownPorts.map(candidate => <option value={candidate} key={candidate}>{candidate} · 本机配置</option>)}<option value="manual">手动填写</option></select></label>}
          {(manual || !knownPorts.length || !!port && !knownPorts.includes(Number(port))) && <label><span>HTTP / Mixed 端口</span><input aria-label="Claude 手动代理端口" inputMode="numeric" autoComplete="off" placeholder="1–65535" value={port} disabled={disabled || !inspection?.canConfigure} onChange={event => { portChosen.current = true; setPort(event.target.value); discardPlan(); }}/></label>}
        </div>
      </div>
      <div className="claude-configure-footer"><p><ShieldCheck size={15}/>保存前自动加密备份，支持预览恢复。</p><button type="button" className="primary" disabled={disabled || !inspection?.canConfigure} onClick={() => void preview()}><FileCheck2 size={16}/>{busy === 'plan' ? '正在生成预览…' : '预览一键配置'}</button></div>
      {inspection && !inspection.canConfigure && <p className="claude-inline-note">当前配置需要先处理上方提示，暂不能自动修改。</p>}
    </section>
    </>}
    {plan && <section className="claude-review" aria-labelledby="claude-review-title">
      <div className="claude-section-title"><h2 id="claude-review-title" ref={reviewHeading} tabIndex={-1}>{plan.action === 'restore' ? '确认恢复方案' : '确认配置方案'}</h2><span>{plan.action === 'restore' ? '恢复预览' : claudeBackupModeLabel(plan.mode)}</span></div>
      <p className="claude-review-meta">方案有效至 {claudeDateLabel(plan.expires)}。保存时会再次核对配置，发现后续改动就停止。</p>
      <PlanChanges changes={plan.changes}/>
      {plan.warnings.map((warning, index) => <p className="claude-inline-note" key={index}>{warning}</p>)}
      {!plan.hasChanges && <div className="claude-feedback claude-success" role="status"><Check size={17}/><p>{plan.action === 'restore' ? '配置已与备份原状态一致。确认后只更新恢复记录，标记此记录已处理，不写入配置文件。' : '当前配置已符合方案，无需写入。'}</p></div>}
      {claudePlanCanExecute(plan) && <>
        <label className="claude-confirm"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={event => setConfirmed(event.target.checked)}/><span>我已核对上面的{plan.hasChanges ? '改动' : '说明'}，确认{plan.action === 'restore' ? plan.hasChanges ? '恢复这些设置' : '完成这条恢复记录' : '备份并保存'}。</span></label>
        <div className="claude-review-actions"><button type="button" className="secondary" disabled={disabled} onClick={discardPlan}>取消</button><button type="button" className="primary" disabled={disabled || !confirmed} onClick={() => void apply()}>{plan.action === 'restore' ? plan.hasChanges ? '确认恢复' : '确认完成恢复记录' : '备份并应用配置'}</button></div>
      </>}
    </section>}
    {officialReady && <section className="claude-next-step" aria-labelledby="claude-next-title"><Terminal size={20}/><div><h2 id="claude-next-title">准备好以后，再手动登录</h2><p>关闭旧的 Claude Code 会话，在新开的终端里执行下面的命令，并选择自己的官方订阅账号。工具箱没有执行这一步。</p><code>claude auth login</code><p>保存本机设置不代表网络连通或账号验证成功。</p></div></section>}
    <section className="claude-backups" aria-labelledby="claude-backups-title"><div className="claude-section-title"><h2 id="claude-backups-title"><FolderClock size={18}/>Claude 配置恢复记录</h2><span>{backups.length} 条 · 此设备 / 当前用户</span></div><p className="claude-backup-note">备份在本机加密保存。恢复前先展示差异；有后续修改时会报告冲突。</p>
      {!backups.length ? <p className="claude-empty">尚无 Claude 配置备份。第一次保存前会自动创建。</p> : <div className="claude-backup-list">{backups.map(backup => <article className="claude-backup-row" key={backup.id}><span className="claude-backup-icon"><FolderClock size={17}/></span><div><h3>{claudeDateLabel(backup.createdAt)}</h3><p>{claudeBackupModeLabel(backup.mode)} · {claudeBackupStateLabel(backup.state)}</p><details><summary>查看记录编号</summary><code>{backup.id}</code></details></div><button type="button" className="secondary" disabled={disabled || !backup.canRestore} onClick={() => void preview(backup.id)}>{backup.canRestore ? '预览恢复' : '暂不可恢复'}</button></article>)}</div>}
    </section>
  </div>;
}
