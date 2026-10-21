import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleHelp, Clock3, Copy, Download, Globe2, LoaderCircle, Plus, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { Button } from '@/components/motion/button';
import { Tooltip } from '@/components/motion/tooltip';
import { SparkActions } from './reactbits-integration';
import { idleResult, importWebsites, WEBSITE_TIMEOUT_MS, normalizeWebsite, runWebsiteBatch, siteGroups, summarizeWebsiteResults, type ProbeResult, type Website } from './connectivity';

type Group = 'ai' | 'common' | 'reference' | 'custom';
export interface ConnectivityBridge {
  run(signal: AbortSignal): Promise<number>;
  stop(): void;
  clear(): void;
  isRunning(): boolean;
  snapshot(): { running: boolean; total: number; completed: number; incomplete: number };
  report(): string;
}
declare global { interface Window { RoseConnectivity: ConnectivityBridge } }
const storageKey = 'behindrose-connectivity-v1';
const labels: Record<ProbeResult['state'], string> = { idle: '未检测', running: '检测中', reachable: '已响应', slow: '响应较慢', failed: '请求失败', timeout: '未获响应', cancelled: '已停止' };
function loadSites(): Website[] { try { return importWebsites(localStorage.getItem(storageKey) || '[]', []); } catch { return []; } }
function publishState(running: boolean, cancelled = false) { window.dispatchEvent(new CustomEvent('connectivity-state', { detail: { running, cancelled } })); }

export function Connectivity() {
  const [custom, setCustom] = useState(loadSites);
  const [group, setGroup] = useState<Group>('reference');
  const [sampleRounds, setSampleRounds] = useState<1 | 10>(10);
  const sampleRoundsRef = useRef(sampleRounds); sampleRoundsRef.current = sampleRounds;
  const [results, setResults] = useState<Record<string, ProbeResult>>({});
  const [running, setRunning] = useState(false);
  const [coreRunning, setCoreRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [name, setName] = useState(''), [url, setUrl] = useState('');
  const [json, setJson] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLButtonElement>(null);
  const task = useRef<AbortController | null>(null);
  const batchSites = useRef<Website[]>([]);
  const resultsRef = useRef(results), sitesRef = useRef<Website[]>([]), groupRef = useRef(group), customRef = useRef(custom);
  const sites = group === 'custom' ? custom : siteGroups[group].sites;
  sitesRef.current = sites; groupRef.current = group; customRef.current = custom;
  const locked = running || coreRunning;
  const update = (site: Website, result: ProbeResult) => { resultsRef.current = { ...resultsRef.current, [site.id]: result }; setResults(resultsRef.current); };
  const run = async (selected: Website[], parent?: AbortSignal, rounds: 1 | 10 = sampleRoundsRef.current) => {
    if (!selected.length) { setNotice('本组没有网站，请先添加'); return 1; }
    task.current?.abort();
    batchSites.current = selected;
    const controller = new AbortController(); task.current = controller; setRunning(true); setNotice('');
    const abort = () => controller.abort(); parent?.addEventListener('abort', abort, { once: true });
    if (parent?.aborted) abort();
    // Clear the previous batch up front so queued sites never show stale successes.
    const updateCurrent = (site: Website, result: ProbeResult) => { if (task.current === controller) update(site, result); };
    selected.forEach(site => updateCurrent(site, idleResult()));
    // The diagnostics engine needs the lock before asynchronous probes or React
    // effects can run, including a second click in the same event turn.
    publishState(true);
    try { await runWebsiteBatch(selected, controller.signal, updateCurrent, { rounds }); }
    finally { parent?.removeEventListener('abort', abort); if (task.current === controller) { task.current = null; setRunning(false); publishState(false, controller.signal.aborted); } }
    return selected.filter(site => resultsRef.current[site.id]?.ms === undefined).length;
  };
  useEffect(() => {
    window.RoseConnectivity = {
      run: signal => run([...sitesRef.current], signal),
      stop: () => task.current?.abort(),
      clear: () => { task.current?.abort(); task.current = null; batchSites.current = []; setRunning(false); resultsRef.current = {}; setResults({}); setNotice(''); publishState(false); },
      isRunning: () => task.current !== null,
      snapshot: () => ({
        running: task.current !== null,
        total: batchSites.current.length,
        completed: batchSites.current.filter(site => resultsRef.current[site.id]?.finished).length,
        incomplete: batchSites.current.filter(site => resultsRef.current[site.id]?.ms === undefined).length,
      }),
      report: () => {
        const known = [...new Map([...siteGroups.ai.sites, ...siteGroups.reference.sites, ...customRef.current].map(site => [site.id, site])).values()];
        return [`网站连通性：IPCheck.ing / MyIP 固定版本的探测地址与浏览器 GET；默认每站 10 次取最低成功值，站点错峰 50 ms，首轮结束后每 500 ms 启动后续轮次；慢请求可重叠，等待全部计划请求结束，单次 ${WEBSITE_TIMEOUT_MS / 1000} 秒超时。可选单次，单站重测为单次。保留 200 ms 快慢分界；HTTPS 耗时包含 DNS、连接、TLS、跳转与网站处理，不等于节点 Ping。跨域 HTTP 状态不可见，不代表登录或服务权限`, ...known.filter(site => resultsRef.current[site.id]).flatMap(site => { const result = resultsRef.current[site.id]; return [`${site.name} | ${site.url} | ${labels[result.state]}${result.ms !== undefined ? ' | ' + result.ms + ' ms' : ''} | ${result.note}${result.time ? ' | ' + result.time : ''}`, ...(result.rounds ?? []).map(round => `  第 ${round.round} 次 | ${labels[round.state]}${round.ms !== undefined ? ' | ' + round.ms + ' ms' : ''}${round.sampledAt ? ' | ' + round.sampledAt : ''}`)]; })].join('\n');
      },
    };
    const start = document.getElementById('start') as HTMLButtonElement | null;
    const observer = new MutationObserver(() => { if (start?.isConnected) setCoreRunning(start.disabled); });
    if (start?.isConnected) {
      setCoreRunning(start.disabled);
      observer.observe(start, { attributes: true, attributeFilter: ['disabled'] });
    }
    const stop = () => task.current?.abort();
    window.addEventListener('pagehide', stop);
    return () => { observer.disconnect(); window.removeEventListener('pagehide', stop); stop(); };
  }, []);
  const save = (next: Website[]) => {
    let persisted = true;
    try { localStorage.setItem(storageKey, JSON.stringify(next.map(({ name, url }) => ({ name, url })))); }
    catch { persisted = false; }
    setCustom(next);
    return persisted;
  };
  const add = () => {
    try { const site = normalizeWebsite({ name, url }); const next = importWebsites(JSON.stringify([site]), customRef.current); const persisted = save(next); setGroup('custom'); setName(''); setUrl(''); setNotice(persisted ? '已添加，点击检测才会连接网站' : '本次已添加；浏览器未允许保存，刷新后需要重新添加'); }
    catch (error) { setNotice((error as Error).message); }
  };
  const importList = () => {
    try { const next = importWebsites(json, customRef.current); const persisted = save(next); setGroup('custom'); setJson(''); setNotice(`列表共 ${next.length} 个网站；已按地址去重${persisted ? '' : '。浏览器未允许保存，刷新后需要重新导入'}`); }
    catch (error) { setNotice((error as Error).message); }
  };
  const showManager = () => { setNotice(''); dialog.current?.showModal(); };
  const closeManager = () => { dialog.current?.close(); opener.current?.focus(); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(window.RoseConnectivity.report()); setNotice('已复制连通性报告'); } catch { setNotice('复制失败，请检查浏览器剪贴板权限'); }
  };
  const exportList = async () => {
    const text = JSON.stringify(customRef.current.map(({ name, url }) => ({ name, url })), null, 2);
    setJson(text);
    try { await navigator.clipboard.writeText(text); setNotice('已复制 JSON，可在其他设备导入'); } catch { setNotice('已生成 JSON，请从文本框复制'); }
  };
  const summary = summarizeWebsiteResults(running ? batchSites.current : sites, results);
  return <section id="connectivity" className="connectivity-section" aria-labelledby="connectivity-title" data-running={running}>
    <div className="connectivity-heading"><h2 id="connectivity-title"><Globe2 size={20}/>网络连通性</h2><div className="connectivity-tools">
      <label className="connectivity-group"><span className="sr-only">网站分组</span><select aria-label="网站分组" value={group} disabled={locked} onChange={event => { setGroup(event.target.value as Group); setNotice(''); }}><option value="ai">AI 服务</option><option value="reference">IPCheck.ing 默认</option><option value="common">常用网站</option><option value="custom">我的网站 ({custom.length})</option></select></label>
      <label className="connectivity-group"><span className="sr-only">采样方式</span><select aria-label="采样方式" value={sampleRounds} disabled={locked} onChange={event => setSampleRounds(Number(event.target.value) as 1 | 10)}><option value="10">原版多轮 · 10 次取最低</option><option value="1">原版单次 · 请求总耗时</option></select></label>
      <Button data-beui className="detection-primary-action" size="sm" disabled={locked || !sites.length} onClick={() => void run([...sites])}><RotateCcw size={17}/>检测本组</Button>
      {running && <Button data-beui className="detection-stop-action" variant="ghost" size="sm" aria-label="停止网站检测" onClick={() => task.current?.abort()}><Square size={14}/>停止</Button>}
    </div></div>
    <p className="connectivity-description">HTTPS 响应耗时，包含建连、TLS 和网站处理，不等于代理节点延迟。</p>
    <p className="connectivity-description">与 IPCheck.ing 对照时，请使用同一浏览器、相同网站分组和采样方式；首次建连与复用连接的耗时可能不同。</p>
    <div className="connectivity-summary" role="status" aria-live="polite">{running ? `正在检测 · 已结束 ${summary.completed} / ${summary.planned} 次请求` : summary.finished ? `${summary.reached} 个已响应 · ${summary.finished - summary.reached} 个未获响应或未完成 · ${summary.completed} / ${summary.planned} 次采样` : `本组 ${sites.length} 个网站 · 等待检测`}<small>本组设置：{sampleRounds === 1 ? '每站 1 次 · 错峰并行' : `每站 ${sampleRounds} 次 · 最低成功值`} · 单次 {WEBSITE_TIMEOUT_MS / 1000} 秒超时 · ≥ 200 ms 响应较慢</small></div>
    <div className="connectivity-list">
    <table className="connectivity-table" aria-label="网站连通性检测结果"><thead><tr><th scope="col">网站</th><th scope="col">HTTPS 耗时</th><th scope="col">状态</th><th scope="col"><span className="sr-only">操作</span></th></tr></thead><tbody>
      {sites.map(site => { const result = results[site.id] || idleResult(); const StateIcon = result.state === 'running' ? LoaderCircle : ['reachable', 'slow'].includes(result.state) ? CircleCheck : ['failed', 'timeout'].includes(result.state) ? CircleHelp : Clock3;
        return <tr key={site.id} className="connectivity-row" data-state={result.state} aria-label={site.name}>
          <td className="connectivity-service"><div className="service-title">
          <div className="service-brand" aria-hidden="true">{site.icon ? <img src={`/service-icons/${site.icon}.svg`} alt="" width="28" height="28"/> : site.id === 'characterai' ? <span>c.ai</span> : <Globe2 size={24}/>}</div>
          <div className="service-name"><strong>{site.name}</strong><small title={site.url}>{new URL(site.url).hostname}</small></div>
          </div></td>
          <td><span className="connectivity-latency">{result.ms !== undefined ? <>{result.ms}<small> ms · {result.totalRounds === 1 ? '单次' : '最低'}</small></> : '—'}</span></td>
          <td><Tooltip content={result.note + (result.time ? ' · ' + result.time : '')}><span className="connectivity-state"><StateIcon size={14}/>{labels[result.state]}</span></Tooltip>{result.completedRounds ? <small className="connectivity-sample-count">{result.successfulRounds}/{result.completedRounds} 成功</small> : null}</td>
          <td className="connectivity-row-action"><Button data-beui variant="ghost" size="icon" disabled={locked} aria-label={`重测 ${site.name}`} onClick={() => void run([site], undefined, 1)}><RotateCcw size={15}/></Button></td>
        </tr>;
      })}
    </tbody></table>
    </div>
    {!sites.length && <p className="connectivity-empty">添加常用网站，保存后即可在这里检测。</p>}
    <SparkActions><div className="connectivity-footer"><Button ref={opener} data-beui variant="outline" size="sm" disabled={locked} onClick={showManager}><Plus size={15}/>添加 / 管理网站</Button><Button data-beui variant="ghost" size="sm" disabled={locked || !Object.keys(results).length} onClick={copy}><Copy size={15}/>复制结果</Button><small>不会自动检测 · 自定义列表保存在本机</small></div></SparkActions>
    {sites.some(site => results[site.id]?.rounds?.length) && <details className="connectivity-method" data-sample-audit><summary>本次采样明细</summary>
      <p className="connectivity-scope">以下保留每次请求的实际结果。首测不一定是冷连接，浏览器是否复用连接不能仅凭数值判断；没有公开分段计时的目标，其 DNS / TLS 耗时保持未知。</p>
      <ul className="connectivity-samples">{sites.filter(site => results[site.id]?.rounds?.length).map(site => {
        const result = results[site.id], first = result.rounds![0];
        return <li key={site.id}><strong>{site.name}</strong><code>{site.url}</code>
          <p>首测 {first.ms !== undefined ? first.ms + ' ms' : labels[first.state]} · {result.totalRounds === 1 ? '单次结果' : '最低成功值 ' + (result.ms !== undefined ? result.ms + ' ms' : '未知')} · 已采样 {result.completedRounds} / {result.totalRounds}</p>
          <ol>{result.rounds!.map(round => <li key={round.round}><span>第 {round.round} 次</span><span>{round.ms !== undefined ? round.ms + ' ms' : '—'}</span><span>{labels[round.state]}</span>{round.sampledAt && <time dateTime={round.sampledAt}>{new Date(round.sampledAt).toLocaleTimeString('zh-CN', { hour12: false })}</time>}</li>)}</ol>
        </li>;
      })}</ul>
    </details>}
    <details className="connectivity-method"><summary>检测方式与范围</summary><p className="connectivity-scope">采用 <a href="https://github.com/jason5ng32/MyIP" target="_blank" rel="noopener noreferrer">IPCheck.ing / MyIP</a> 固定版本的探测地址、GET 和采样参数。默认每站 10 次，显示最低成功值；第一轮全部结束后，每 500 ms 启动下一轮，每轮各站错峰 50 ms，慢请求可能重叠。等待全部计划请求结束，不用本地整组时限截断；单次最多 {WEBSITE_TIMEOUT_MS / 1000} 秒。可选择单次，单站重测始终一次。保留原版 200 ms 快慢分界，原始耗时不加减或强制抬高。应用增加手动停止与结果明细，不自动启动检测。HTTPS 耗时包含 DNS、连接、TLS、代理、跳转与网站处理，不是节点 Ping；跨域状态码不可见，不能据此验证账号权限。</p></details>
    {!dialog.current?.open && notice && <p className="connectivity-notice" role="status">{notice}</p>}
    <dialog ref={dialog} className="connectivity-manager" aria-labelledby="connectivity-manager-title" onClose={() => opener.current?.focus()}>
      <div className="manager-heading"><h2 id="connectivity-manager-title">我的网站</h2><Button data-beui variant="ghost" size="icon" aria-label="关闭网站管理" onClick={closeManager}><X size={18}/></Button></div>
      <p>保存列表不会发起检测。支持公开网站的 HTTPS 地址。</p>
      <form onSubmit={event => { event.preventDefault(); add(); }}><label>网站名称<input autoFocus value={name} maxLength={60} placeholder="例如：我的博客" onChange={event => setName(event.target.value)}/></label><label>网站地址<input value={url} maxLength={2048} type="url" required placeholder="https://example.com/" onChange={event => setUrl(event.target.value)}/></label><Button data-beui type="submit" size="sm"><Plus size={15}/>添加网站</Button></form>
      <div className="custom-sites">{custom.map(site => <div key={site.id}><span><strong>{site.name}</strong><small>{site.url}</small></span><Button data-beui variant="ghost" size="icon" aria-label={`删除 ${site.name}`} onClick={() => { const persisted = save(custom.filter(item => item.id !== site.id)); setNotice(persisted ? '已从列表删除' : '本次已删除；浏览器未允许保存，刷新后可能恢复'); }}><Trash2 size={16}/></Button></div>)}</div>
      <details className="connectivity-import"><summary>导入 / 导出网站列表</summary><p>JSON 数组，最多 40 个网站；重复地址会更新名称。</p><label>网站列表 JSON<textarea value={json} rows={5} spellCheck={false} maxLength={65536} placeholder={'[{"name":"GitHub","url":"https://github.com/"}]'} onChange={event => setJson(event.target.value)}/></label><div><Button data-beui variant="outline" size="sm" onClick={importList}><Download size={15}/>导入列表</Button><Button data-beui variant="ghost" size="sm" onClick={exportList}><Copy size={15}/>导出 JSON</Button></div></details>
      <p className="connectivity-notice" role="status" aria-live="polite">{notice}</p>
    </dialog>
  </section>;
}
