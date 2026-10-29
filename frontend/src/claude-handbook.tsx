import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Check, Copy, Download, ExternalLink, LockKeyhole } from 'lucide-react';
import { ClaudeSetup, claudeBackupStateLabel, claudeDateLabel, useWorkbenchConfigurationBusy, workbenchConfigurationBusy, type ClaudeInspection } from './claude-setup';
import { claudeHandbookSections, claudeHandbookOpening, claudeHandbookOptionalItems, claudeHandbookFigures } from './claude-handbook-data';
import { claudeHandbookDownloads } from './claude-handbook-downloads';

type ZoneStatus = { currentId: string; currentLabel: string; currentDaylightSavingDisabled: boolean; targetId: string; targetLabel: string; isTaipei: boolean; canConfigure: boolean; warnings: string[] };
type ZonePlan = { id: string; expires: string; action: 'apply' | 'restore'; currentId: string; currentLabel: string; targetId: string; targetLabel: string; hasChanges: boolean; warnings: string[] };
type ZoneBackup = { id: string; createdAt: string | null; beforeId: string; beforeLabel: string; afterId: string; afterLabel: string; canRestore: boolean; state: string };
type LocalResult = { success: boolean; state: string; message: string; backupId: string | null };
type HandbookCommand = 'claude-inspect' | 'claude-timezone-inspect' | 'claude-timezone-plan' | 'claude-timezone-apply' | 'claude-timezone-backups' | 'claude-timezone-restore-plan' | 'claude-timezone-restore';
const allowedCommands = new Set<HandbookCommand>(['claude-inspect', 'claude-timezone-inspect', 'claude-timezone-plan', 'claude-timezone-apply', 'claude-timezone-backups', 'claude-timezone-restore-plan', 'claude-timezone-restore']);
export async function claudeHandbookApi<T>(command: HandbookCommand, fields: { planId?: string; backupId?: string } = {}): Promise<T> {
  if (!allowedCommands.has(command)) throw Error('手册不支持执行此操作。');
  const sessionResponse = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!sessionResponse.ok) throw Error('本机服务暂不可用。');
  const session = await sessionResponse.json();
  if (!session.ready || !session.token) throw Error(session.error || '本机服务尚未就绪。');
  const response = await fetch('/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BehindRose-Token': session.token }, body: JSON.stringify({ command, ...fields }), signal: AbortSignal.timeout(45000) });
  const result = await response.json();
  if (!response.ok || result.error) throw Error(result.error || '本机操作未完成。');
  return result.data as T;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请稍后重新读取本机状态。';
const safeHref = (url: string) => /^(https?:\/\/|\/(?!\/))/.test(url) ? url : undefined;
const articleSectionLabel = (id: string) => ({ opening: '开头注意事项', intro: '使用背景', official: '使用条件', network: '网络与出口', account: '账号管理', device: '本地清理与备份', privacy: '隐私开关', payment: '付款与订阅', checklist: '使用清单' } as Record<string, string>)[id] ?? id;

export function handbookInline(text: string): ReactNode[] {
  const tokens = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g;
  return text.split(tokens).filter(Boolean).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    if (link) return <a key={index} href={safeHref(link[2])} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function CopyCommand({ code, language, network = false, label = '命令片段' }: { code: string; language?: string; network?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState('');
  async function copy() { try { await navigator.clipboard.writeText(code); setCopied(true); setError(''); } catch { setError('自动复制不可用，请选中下面的完整命令复制。'); } }
  return <div className="handbook-code"><div><span>{label} · {language || '文本'}{network ? ' · 含连接操作，稍后手动执行' : ' · 仅展示'}</span><button type="button" onClick={() => void copy()}><Copy size={13}/>{copied ? '已复制' : '复制命令'}</button></div><pre><code>{code}</code></pre>{error && <p role="status">{error}</p>}</div>;
}

type HandbookSection = typeof claudeHandbookSections[number];
export function HandbookMarkdown({ text, section }: { text: string; section?: HandbookSection }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n'), blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = /^(~~~|```)(.*)$/.exec(line);
    if (fence) {
      const code: string[] = []; index++;
      while (index < lines.length && !lines[index].startsWith(fence[1])) code.push(lines[index++]);
      index++;
      const value = code.join('\n'), source = section?.commands?.find(command => command.code.trim() === value.trim());
      blocks.push(<CopyCommand key={blocks.length} code={value} language={fence[2].trim()} network={source?.network ?? /Test-NetConnection|curl|https?:\/\/|winget|claude\s+(auth|doctor)|^claude\s*$/m.test(value)} label={source?.label}/>);
      continue;
    }
    const figure = /^\[\[figure:([^\]]+)\]\]$/.exec(line.trim());
    if (figure) {
      const item = claudeHandbookFigures.find(value => value.id === figure[1]);
      if (item) blocks.push(<figure className="handbook-figure" key={blocks.length}><a href={'/claude-handbook-images/' + item.file} target="_blank" rel="noopener" aria-label={item.caption + '，查看原尺寸'}><img src={'/claude-handbook-images/' + item.file} loading="lazy" alt={item.caption}/></a><figcaption>{item.caption}{item.note && <span>{item.note}</span>}<span>点图可查看原尺寸。</span><a href={safeHref(item.source)} target="_blank" rel="noopener noreferrer">图片来源</a></figcaption></figure>);
      index++; continue;
    }
    if (/^# /.test(line)) { index++; continue; }
    const heading = /^(#{2,4})\s+(.+)$/.exec(line);
    if (heading) { blocks.push(<h3 key={blocks.length}>{handbookInline(heading[2])}</h3>); index++; continue; }
    if (/^>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={blocks.length}><HandbookMarkdown text={quote.join('\n')} section={section}/></blockquote>); continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]+\|\s*$/.test(lines[index + 1] ?? '')) {
      const cells = (value: string) => value.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
      const headings = cells(line), rows: string[][] = []; index += 2;
      while (index < lines.length && /^\s*\|/.test(lines[index])) rows.push(cells(lines[index++]));
      blocks.push(<div className="handbook-table" key={blocks.length}><table><thead><tr>{headings.map((value, n) => <th key={n}>{handbookInline(value)}</th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{row.map((value, c) => <td key={c}>{handbookInline(value)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    const list = /^\s*(\d+\.|[-*])\s+/.exec(line);
    if (list) {
      const ordered = /^\d/.test(list[1]), items: ReactNode[] = [];
      while (index < lines.length && (ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/).test(lines[index])) {
        items.push(<li key={items.length}>{handbookInline(lines[index++].replace(/^\s*(\d+\.|[-*])\s+/, ''))}</li>);
      }
      blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>); continue;
    }
    const paragraph = [line]; index++;
    while (index < lines.length && lines[index].trim() && !/^(#{1,4}\s|>|~~~|```|\[\[figure:|\s*\||\s*\d+\.\s|\s*[-*]\s)/.test(lines[index])) paragraph.push(lines[index++]);
    blocks.push(<p key={blocks.length}>{handbookInline(paragraph.join('\n'))}</p>);
  }
  return <>{blocks}</>;
}

function LocalInspection() {
  const [value, setValue] = useState<ClaudeInspection | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const externalBusy = useWorkbenchConfigurationBusy();
  async function read() { if (busy || externalBusy || workbenchConfigurationBusy()) return; setBusy(true); setError(''); try { setValue(await claudeHandbookApi<ClaudeInspection>('claude-inspect')); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } }
  return <aside className="handbook-local-panel"><h3>按需读取当前路线</h3><p>只读本机配置，帮助核对是否存在旧网关或模型覆盖；不登录、不清理、不修改代理设置。</p><button type="button" className="secondary" disabled={busy || externalBusy} onClick={() => void read()}>{busy ? '正在读取…' : '读取本机配置（不联网）'}</button>{error && <p role="alert" className="handbook-error">{error}</p>}{value && <><dl className="handbook-local-facts"><div><dt>使用路线</dt><dd>{value.route}</dd></div><div><dt>配置中的代理端口</dt><dd>{value.configuredProxyPort ?? '未设置'}</dd></div><div><dt>已有配置</dt><dd>{value.settingsFound ? '已找到' : '未创建'}</dd></div></dl>{!!value.customModelVariables.length && <p>模型覆盖变量：{value.customModelVariables.join('、')}</p>}{!!value.conflictingEnvironmentVariables.length && <p>需核对的环境变量：{value.conflictingEnvironmentVariables.join('、')}</p>}{value.warnings.map((warning, n) => <p key={n} className="handbook-warning">{warning}</p>)}<p>如需处理冲突，先按第 10 节备份，再根据第 07 节核对范围。不要直接清空整个配置。</p></>}</aside>;
}

function TimezoneOption() {
  const [opted, setOpted] = useState(false), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState('');
  const externalBusy = useWorkbenchConfigurationBusy();
  const [status, setStatus] = useState<ZoneStatus | null>(null), [backups, setBackups] = useState<ZoneBackup[] | null>(null), [plan, setPlan] = useState<ZonePlan | null>(null);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const pending = useRef(false);
  async function read() { if (pending.current || externalBusy || workbenchConfigurationBusy()) return; pending.current = true; setBusy('read'); setError(''); try { const [next, records] = await Promise.all([claudeHandbookApi<ZoneStatus>('claude-timezone-inspect'), claudeHandbookApi<ZoneBackup[]>('claude-timezone-backups')]); setStatus(next); setBackups(records); } catch (cause) { setError(errorText(cause)); } finally { pending.current = false; setBusy(''); } }
  async function preview(backupId?: string) {
    if (pending.current || externalBusy || workbenchConfigurationBusy() || !backupId && !opted) return;
    pending.current = true; setBusy('plan'); setError(''); setMessage(''); setPlan(null); setConfirmed(false);
    try { setPlan(await claudeHandbookApi<ZonePlan>(backupId ? 'claude-timezone-restore-plan' : 'claude-timezone-plan', backupId ? { backupId } : {})); }
    catch (cause) { setError(errorText(cause)); } finally { pending.current = false; setBusy(''); }
  }
  async function apply() {
    if (!plan || !confirmed || pending.current || externalBusy || workbenchConfigurationBusy() || plan.action === 'apply' && !opted) return;
    if (Date.parse(plan.expires) <= Date.now()) { setPlan(null); setError('预览已过期，请重新生成。'); return; }
    const current = plan; pending.current = true; setBusy('apply'); setPlan(null); setConfirmed(false); setError(''); setMessage('');
    dispatchEvent(new CustomEvent('claude-config-busy', { detail: true }));
    try {
      const result = await claudeHandbookApi<LocalResult>(current.action === 'restore' ? 'claude-timezone-restore' : 'claude-timezone-apply', { planId: current.id });
      if (result.success) setMessage(result.message); else setError(result.message || '本机时区操作未完成。');
      try { setBackups(await claudeHandbookApi<ZoneBackup[]>('claude-timezone-backups')); setStatus(await claudeHandbookApi<ZoneStatus>('claude-timezone-inspect')); } catch { if (result.success) setError('操作已完成，状态刷新失败。请手动读取最新状态。'); }
    } catch (cause) { setError(errorText(cause) + ' 请先读取状态与恢复记录确认结果，不要反复提交。'); }
    finally { pending.current = false; setBusy(''); dispatchEvent(new CustomEvent('claude-config-busy', { detail: false })); }
  }
  return <aside className="handbook-local-panel handbook-timezone"><h3>可选：台北时区</h3><p><strong>来源：原文第 03、11 节；防封效果未验证，不是必做项。</strong></p><p>这会修改整台电脑显示时间所使用的时区，影响其他应用的时间显示；不会修改 UTC 时钟。需要时再主动选择并预览。</p><label className="handbook-checkbox"><input type="checkbox" checked={opted} disabled={!!busy || externalBusy} onChange={event => { setOpted(event.target.checked); setPlan(null); setConfirmed(false); }}/><span>我自愿选择将 Windows 显示时区设为台北，理解这不是防封保证。</span></label><div className="handbook-actions"><button type="button" className="secondary" disabled={!!busy || externalBusy} onClick={() => void read()}>读取当前时区与恢复记录</button><button type="button" className="secondary" disabled={!opted || !!busy || externalBusy || status?.canConfigure === false} onClick={() => void preview()}>预览台北时区设置</button></div>{busy && <p role="status">{busy === 'read' ? '正在读取本机时区…' : busy === 'plan' ? '正在生成本机预览…' : '正在处理本机时区设置…'}</p>}{status && <><p>当前：{status.currentLabel}（{status.currentId}）</p>{status.warnings.map((warning, n) => <p key={n} className="handbook-warning">{warning}</p>)}</>}{error && <p role="alert" className="handbook-error">{error}</p>}{message && <p role="status" className="handbook-success">{message}</p>}
    {plan && <div className="handbook-timezone-plan"><h4>{plan.action === 'restore' ? '确认恢复原时区' : '确认时区变化'}</h4><dl><div><dt>当前</dt><dd>{plan.currentLabel}（{plan.currentId}）</dd></div><div><dt>调整后</dt><dd>{plan.targetLabel}（{plan.targetId}）</dd></div></dl>{plan.warnings.map((warning, n) => <p key={n}>{warning}</p>)}<p>预览有效至 {claudeDateLabel(plan.expires)}。</p>{!plan.hasChanges && <p>时区已符合目标。{plan.action === 'restore' ? '确认后完成恢复记录。' : '无需执行。'}</p>}{(plan.hasChanges || plan.action === 'restore') && <><label className="handbook-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>已核对这次整机时区变化，确认{plan.action === 'restore' ? '恢复' : '备份并应用'}。</span></label><button type="button" className="primary" disabled={!confirmed || !!busy || externalBusy} onClick={() => void apply()}>{plan.action === 'restore' ? '确认恢复时区' : '备份并应用时区'}</button></>}</div>}
    {backups && <div className="handbook-timezone-backups"><h4>时区恢复记录</h4>{!backups.length && <p>尚无记录。</p>}{backups.map(backup => <div key={backup.id}><span>{claudeDateLabel(backup.createdAt)} · {claudeBackupStateLabel(backup.state)}<small>{backup.beforeLabel} → {backup.afterLabel}</small></span><button type="button" className="secondary" disabled={!backup.canRestore || !!busy || externalBusy} onClick={() => void preview(backup.id)}>预览恢复时区</button></div>)}</div>}
  </aside>;
}

function ScriptDownloads() {
  const [message, setMessage] = useState('');
  function download(item: typeof claudeHandbookDownloads[number]) {
    const anchor = document.createElement('a');
    anchor.href = '/claude-handbook-scripts/' + item.name;
    anchor.download = item.name;
    anchor.click();
    setMessage(item.name + ' 已交给浏览器下载；工具箱没有执行脚本。');
  }
  return <div className="handbook-downloads"><h3>原文配套脚本</h3><p>下载只保存文件。稍后由你阅读并手动运行；工具箱不会调用 PowerShell。</p>{claudeHandbookDownloads.map(item => <article key={item.name}><div><h4>{item.label}</h4><code>{item.name}</code><p>{item.description}</p><span>{item.network ? '包含连接检查 · 仅下载，当前不执行' : '仅下载，当前不执行'}</span></div><button type="button" className="secondary" onClick={() => download(item)}><Download size={14}/>下载脚本</button><details><summary>查看脚本内容</summary><CopyCommand code={item.code} language="powershell" network={item.network} label={item.name}/></details></article>)}{message && <p role="status">{message}</p>}</div>;
}

export function ClaudeHandbook({ active }: { active: boolean }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({}), [recover, setRecover] = useState(false), [storageNote, setStorageNote] = useState('');
  const externalBusy = useWorkbenchConfigurationBusy();
  function jump(id: string) { document.getElementById('claude-handbook-step-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function mark(key: string, value: boolean) { const next = { ...checked, [key]: value }; setChecked(next); try { localStorage.setItem('claude-handbook-checkpoints-v1', JSON.stringify(next)); } catch { setStorageNote('浏览器未允许保存进度，本次勾选仍会保留到关闭页面。'); } }
  useEffect(() => { if (!active) { setRecover(false); return; } try { const saved = JSON.parse(localStorage.getItem('claude-handbook-checkpoints-v1') || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) setChecked(Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'boolean')) as Record<string, boolean>); } catch { /* A missing saved checklist does not block the guide. */ } }, [active]);
  if (!active) return null;
  const total = claudeHandbookSections.reduce((count, section) => count + section.checkpoints.length, 0), complete = claudeHandbookSections.reduce((count, section) => count + section.checkpoints.filter((_, n) => checked[section.id + '-' + n]).length, 0);
  return <div className="claude-handbook"><div className="page-heading"><div><p className="handbook-eyebrow">WINDOWS · CLASH VERGE · CLAUDE CODE</p><h1>照着手册，一步步配好</h1><p className="intro">官方 Claude 订阅主线 · 13 节完整流程 · 每步自行确认</p></div><a className="secondary" href="/claude-handbook.html" target="_blank" rel="noopener"><BookOpen size={15}/>打开完整图文原文</a></div>
    <div className="handbook-no-network"><LockKeyhole size={17}/><div><strong>当前只阅读和准备，不对你的网络做任何测试。</strong><p>命令仅展示、复制或下载；联网检查、安装与登录都由你稍后手动执行。本页不会切换节点、TUN、系统代理或执行脚本。</p></div></div>
    {externalBusy && <p className="handbook-operation-note" role="status">工具箱有配置操作正在进行。本页可以继续阅读，配置读取与修改入口将在操作结束后恢复。</p>}
    <section className="handbook-opening"><h2>开始前先看这 5 条</h2><ol>{claudeHandbookOpening.map((item, n) => <li key={n}>{handbookInline(item.replace(/^\s*\d+\.\s*/, ''))}</li>)}</ol></section>
    <nav className="handbook-entry" aria-label="按当前情况选择起点">{[['02', '新电脑 / 第一次配置', '从端口、账号到首次对话'], ['09', '已经能正常使用', '直接看每天怎么启动'], ['10', '准备清理或重装', '先备份，再处理'], ['12', '账号明确被封', '保存证据并申诉']].map(([id, title, detail]) => <button type="button" key={id} onClick={() => jump(id)}><span>从 {id} 开始</span><strong>{title}</strong><small>{detail}</small></button>)}</nav>
    <div className="handbook-layout"><aside className="handbook-nav"><p>操作目录</p><nav aria-label="手册目录">{claudeHandbookSections.map(section => <button type="button" key={section.id} onClick={() => jump(section.id)}><span>{section.id}</span>{section.title.replace(/^\d+\s*[·.、-]\s*/, '')}</button>)}</nav><div className="handbook-progress"><strong>{complete} / {total}</strong><span>你手动勾选的通过项</span><small>勾选不代表工具完成了检测。</small></div></aside><div className="handbook-body">
      {claudeHandbookSections.map(section => <section className="handbook-step-card" id={'claude-handbook-step-' + section.id} key={section.id}><header><span className="handbook-section-number">{section.id}</span><div><h2>{section.title.replace(/^\d+\s*[·.、-]\s*/, '')}</h2><p>{section.summary}</p></div><a href={'/claude-handbook.html#step-' + section.id} target="_blank" rel="noopener" aria-label={'查看原文第 ' + section.id + ' 节'}><ExternalLink size={15}/><span>原文</span></a></header><div className="handbook-prose"><HandbookMarkdown text={section.sourceMarkdown} section={section}/></div>
        {section.id === '07' && <LocalInspection/>}
        {section.id === '09' && <ScriptDownloads/>}
        {section.id === '10' && <aside className="handbook-local-panel"><h3>已有工具箱配置的恢复入口</h3><p>这里仅处理此前工具箱保存的 settings.json 备份。原文的完整本地备份仍应使用上面的第 10 节步骤和 Backup-ClaudeLocal.ps1。</p><button type="button" className="secondary" disabled={externalBusy} onClick={() => { if (!workbenchConfigurationBusy()) setRecover(!recover); }}>{recover ? '收起工具箱恢复记录' : '读取工具箱已有恢复记录'}</button><ClaudeSetup active={recover} recoveryOnly/></aside>}
        {section.id === '11' && <><div className="handbook-optional"><h3>个人经验与偏好：逐项选择</h3>{claudeHandbookOptionalItems.map(item => <article key={item.id}><h4>{item.title}<span>非必做</span></h4><p className="handbook-evidence">{item.evidenceNote}</p><ol>{item.steps.map((step, n) => <li key={n}>{handbookInline(step)}</li>)}</ol><p className="handbook-item-sources">手册第 {item.sourceSections.join('、')} 节；经验整理：{item.articleSections.map(articleSectionLabel).join('、')}</p>{item.links?.map(link => <a key={link.url} href={safeHref(link.url)} target="_blank" rel="noopener noreferrer">{link.label}</a>)}</article>)}</div><TimezoneOption/></>}
        <div className="handbook-checkpoints"><h3><Check size={16}/>通过标准 · 完成后由你勾选</h3>{section.checkpoints.map((checkpoint, n) => <label className="handbook-checkbox" key={n}><input type="checkbox" checked={!!checked[section.id + '-' + n]} onChange={event => mark(section.id + '-' + n, event.target.checked)}/><span>{handbookInline(checkpoint)}</span></label>)}</div>
      </section>)}
      {storageNote && <p role="status">{storageNote}</p>}
    </div></div>
  </div>;
}
