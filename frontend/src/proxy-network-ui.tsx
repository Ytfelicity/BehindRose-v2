import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, Copy, Globe2, Play, Route, Square } from 'lucide-react';
import { Button } from '@/components/motion/button';
import { proxyNetworkApi, proxyNetworkText, type ProxyLatency, type ProxyNetworkState } from './proxy-network-api';
import { DetectionGuide } from './detection-guide';

const idle: ProxyNetworkState = { state: 'idle', id: null, proxyPort: 7897, profile: 'quick', includeSpeed: false, stage: '尚未开始', current: 0, total: 0, startedAt: null, finishedAt: null, report: null, error: null };
const carriers = ['电信', '联通', '移动'];
const provinceOrder = ['北京','天津','河北','山西','内蒙古','辽宁','吉林','黑龙江','上海','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','广西','海南','重庆','四川','贵州','云南','西藏','陕西','甘肃','青海','宁夏','新疆'];
const labels: Record<string, string> = { idle: '未检测', running: '检测中', complete: '已完成', cancelled: '已停止', timeout: '已超时', failed: '未完成' };
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
function Latency({ row }: { row?: ProxyLatency }) {
  const tone = !row || row.averageMs == null ? 'unknown' : row.averageMs < 160 ? 'fast' : row.averageMs < 320 ? 'medium' : 'slow';
  return <div className={'proxy-latency ' + tone} title={row ? `${row.host}:${row.port}\n三次样本：${row.samples.map(value => value == null ? '失败' : value + ' ms').join(' / ')}\n最低 ${number(row.minimumMs)} ms；抖动 ${number(row.jitterMs)} ms` : '等待检测'}>
    <strong>{row?.averageMs != null ? number(row.averageMs) : row ? '未知' : '—'}{row?.averageMs != null && <small> ms</small>}</strong>
    <span>{row ? `失败 ${row.failurePercent}% · 抖动 ${number(row.jitterMs)} ms` : '等待采样'}</span>
  </div>;
}
export function ProxyNetwork() {
  const [snapshot, setSnapshot] = useState(idle), [port, setPort] = useState('7897'), [profile, setProfile] = useState('quick'), [speed, setSpeed] = useState(false);
  const [tab, setTab] = useState('china'), [pending, setPending] = useState(false), [message, setMessage] = useState(''), [connectionError, setConnectionError] = useState('');
  const version = useRef(0), actionPending = useRef(false), restored = useRef(false);
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const revision = version.current;
      if (!actionPending.current) try {
        const state = await proxyNetworkApi('proxy-network-status');
        if (!disposed && revision === version.current && !actionPending.current) {
          setSnapshot(state); setConnectionError('');
          if (!restored.current && state.id) { setPort(String(state.proxyPort)); setProfile(state.profile); setSpeed(state.includeSpeed); }
          restored.current = true;
        }
      } catch (error) { if (!disposed && revision === version.current) setConnectionError((error as Error).message); }
      if (!disposed) timer = setTimeout(poll, 1500);
    }
    void poll(); return () => { disposed = true; clearTimeout(timer); };
  }, []);
  const running = snapshot.state === 'running', locked = running || pending, report = snapshot.report;
  const run = async (stop = false) => {
    const proxyPort = Number(port);
    if (!stop && (!/^\d+$/.test(port) || !Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535)) { setMessage('请输入 1–65535 的本机 HTTP 代理端口'); return; }
    version.current++; actionPending.current = true; setPending(true); setMessage('');
    try { setSnapshot(await proxyNetworkApi(stop ? 'proxy-network-stop' : 'proxy-network-start', stop ? undefined : { proxyPort, profile, includeSpeed: speed })); setConnectionError(''); }
    catch (error) { setMessage((error as Error).message); }
    finally { actionPending.current = false; setPending(false); }
  };
  const copy = async (json: boolean) => {
    try { await navigator.clipboard.writeText(json ? JSON.stringify(snapshot, null, 2) : proxyNetworkText(snapshot)); setMessage(json ? '已复制网络 JSON' : '已复制网络报告'); }
    catch { setMessage('复制失败，请检查剪贴板权限'); }
  };
  const regions = [...new Set(report?.latencies.filter(row => row.region !== '国际服务').map(row => row.region) || [])].sort((left, right) => provinceOrder.indexOf(left) - provinceOrder.indexOf(right));
  const visibleRegions = regions.length ? regions : ['北京', '上海', '广东'];
  const latencies = report?.latencies || [], available = latencies.filter(row => row.averageMs != null);
  const identity = report?.identity;
  return <section className="proxy-network" id="proxy-network" aria-labelledby="proxy-network-title" data-state={snapshot.state}>
    <header className="proxy-heading"><div><div className="proxy-eyebrow"><Route size={14}/>PROXY NETWORK</div><h2 id="proxy-network-title">代理网络质量</h2><p>查看当前代理的出口归属、三网连接表现和端到端吞吐。</p></div><span className={'proxy-state ' + snapshot.state}>{labels[snapshot.state] || snapshot.state}</span></header>
    <DetectionGuide tool="proxy-network" target={`本机 HTTP 代理 · 127.0.0.1:${port}`}/>
    <h3 className="tool-step">1. 填写检测连接<small>使用已有代理，不会更改客户端配置</small></h3>
    <div className="proxy-controls">
      <label>HTTP 代理端口<input aria-label="网络检测代理端口" inputMode="numeric" value={port} disabled={locked} onChange={event => { setPort(event.target.value); setMessage(''); }}/></label>
      <label>检测范围<select aria-label="代理网络检测范围" value={profile} disabled={locked} onChange={event => { setProfile(event.target.value); setMessage(''); }}><option value="quick">快速 · 北京 / 上海 / 广东</option><option value="all">全国 · 31 省三网</option></select></label>
      <label className="proxy-speed-option"><input type="checkbox" checked={speed} disabled={locked} onChange={event => setSpeed(event.target.checked)}/><span>包含下载 / 上传<small>最多采样 28 MiB 载荷，另有协议开销</small></span></label>
      <Button data-beui disabled={locked} onClick={() => void run()}><Play size={14}/>开始网络检测</Button>
      {running && <Button data-beui variant="outline" disabled={pending} onClick={() => void run(true)}><Square size={14}/>停止网络检测</Button>}
    </div>
    <p className="proxy-path">127.0.0.1:{running || snapshot.id ? snapshot.proxyPort : port} → HTTP 代理 → 目标节点<span>IPv4 出口 / 国内节点 · 每节点 3 次 · 最长 5 分钟 · 请暂停其他测速</span></p>
    <p className="proxy-setup-note">沿用代理客户端当前的节点与分流规则；不同目标可能走不同出口。工具不会切换节点或修改代理设置。</p>
    <div className="proxy-progress" role="status" aria-live="polite"><span>{snapshot.stage}</span><span>{snapshot.total ? `${snapshot.current} / ${snapshot.total}` : '等待开始'}</span></div>
    <progress aria-label="代理网络检测进度" value={snapshot.current} max={snapshot.total || 1}/>
    {(snapshot.error || message || connectionError) && <p className="proxy-message" role="status">{snapshot.error || message || connectionError}</p>}
    {report?.exitChanged === true && <p className="proxy-warning">检测期间出口从 {identity?.ip} 变为 {report.finalIp}，本次结果可能来自多个出口。请固定节点后重新检测。</p>}
    {report || running ? <><h3 className="tool-step">2. 查看本次结果</h3><div className="proxy-metrics">
      <div><span><Globe2 size={14}/>检测出口</span><strong className="mono">{identity?.ip || '—'}</strong><small>{identity?.holder || '机构信息待查询'}</small></div>
      <div><span>BGP 前缀 / ASN</span><strong className="mono">{identity?.prefix || '—'}</strong><small>{identity?.asns.map(value => 'AS' + value).join(' · ') || '暂无 ASN 数据'}{identity?.error ? ` · ${identity.error}` : ''}</small></div>
      <div><span><Activity size={14}/>连接取得结果</span><strong>{available.length}<small> / {latencies.length || '—'} 个节点</small></strong><small>失败与未检测均保留未知</small></div>
      <div><span>出口复核</span><strong>{report?.exitChanged === true ? '出口变化' : report?.exitChanged === false ? '未观察到变化' : '等待复核'}</strong><small>{report?.finalIp || '开始与结束分别查询 ipify'}</small></div>
    </div>
    <div className="proxy-result-heading"><div className="proxy-tabs" role="tablist" aria-label="代理网络结果" onKeyDown={event => {
      const keys = ['china', 'global', 'speed', 'scope'];
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? keys.length-1 : (keys.indexOf(tab) + (event.key === 'ArrowLeft' ? -1 : 1) + keys.length) % keys.length;
      setTab(keys[index]); document.getElementById('proxy-tab-' + keys[index])?.focus();
    }}>{[['china','三网连接'],['global','国际服务'],['speed','下载 / 上传'],['scope','检测范围']].map(([key, label]) => <button key={key} type="button" role="tab" id={'proxy-tab-' + key} tabIndex={tab === key ? 0 : -1} aria-selected={tab === key} aria-controls={'proxy-panel-' + key} onClick={() => setTab(key)}>{label}</button>)}</div><div className="proxy-export"><button disabled={!report} onClick={() => void copy(false)}><Copy size={13}/>复制网络报告</button><button disabled={!report} onClick={() => void copy(true)}>JSON</button></div></div>
    <div role="tabpanel" id={'proxy-panel-' + tab} aria-labelledby={'proxy-tab-' + tab}>
      {tab === 'china' && <><p className="proxy-caption">计时到目标 HTTP 响应头返回，包含当前电脑、代理链路与目标处理时间；不是 VPS TCP 大包延迟。失败率是 3 次请求的失败比例。</p><div className="proxy-table-scroll"><table className="proxy-matrix"><thead><tr><th>地区</th>{carriers.map(carrier => <th key={carrier}>{carrier}<small>均值 / 请求失败 / 抖动</small></th>)}</tr></thead><tbody>{visibleRegions.map(region => <tr key={region}><th>{region}</th>{carriers.map(carrier => <td key={carrier}><Latency row={latencies.find(row => row.region === region && row.carrier === carrier)}/></td>)}</tr>)}</tbody></table></div></>}
      {tab === 'global' && <><p className="proxy-caption">等待目标的 TLS 握手完成并校验证书，计时包含本机与代理链路。目标可能使用 CDN，地区由当次解析决定。</p><div className="proxy-global">{['Cloudflare','Google','Apple','Microsoft','GitHub'].map(name => <div key={name}><strong>{name}</strong><Latency row={latencies.find(row => row.region === '国际服务' && row.carrier === name)}/></div>)}</div></>}
      {tab === 'speed' && <><p className="proxy-caption">国内节点为公开镜像下载，Cloudflare 为就近边缘的下载与上传。单连接、有限载荷并包含握手；这不是 VPS 带宽上限或三网 Speedtest。</p>{report?.transfers.length ? <div className="proxy-table-scroll"><table className="proxy-speed-table"><thead><tr><th>测速目标</th><th>方向</th><th>Mbps</th><th>有效载荷</th><th>状态</th></tr></thead><tbody>{report.transfers.map((row, index) => <tr key={index}><th>{row.name}</th><td>{row.direction === 'upload' ? <><ArrowUp size={13}/>上传</> : <><ArrowDown size={13}/>下载</>}</td><td className="mono">{number(row.mbps)}</td><td>{(row.bytes / 1048576).toFixed(2)} MiB</td><td>{row.error || '采样完成'}</td></tr>)}</tbody></table></div> : <div className="proxy-empty">{snapshot.includeSpeed && snapshot.id ? '等待测速结果' : '本次未启用测速。勾选“包含下载 / 上传”后开始新的检测。'}</div>}</>}
      {tab === 'scope' && <div className="proxy-scope"><p>{report?.scope || '所有探测仅通过填写的本机 HTTP 代理发送，连接失败不会回退直连。代理分流可能让不同目标走不同出口。'}</p><dl><div><dt>出口与 BGP</dt><dd>ipify 查询 IPv4，RIPEstat 查询宣告前缀与 ASN 机构。保留多 ASN；未取得的数据保持未知。</dd></div><div><dt>响应耗时与抖动</dt><dd>计时从连接本机代理开始，国内节点等待 HTTP 响应头，国际服务等待 TLS 握手与证书校验完成。每节点 3 次，抖动取相邻成功样本差的绝对值均值；不是 ICMP 丢包率。</dd></div><div><dt>需在 VPS 内检测</dt><dd>NAT 类型、BBR / 队列算法、TCP 缓冲区、真实回程逐跳路由、CN2 / 9929 / CMI 线路判断。HTTP 代理无法可靠提供这些信息。</dd></div><div><dt>保存与来源</dt><dd>结果保留在本机服务内存，刷新可恢复；关闭服务后清除。三网探测域名参考 xykt/NetQuality 使用的公开节点命名。测速不下载到磁盘，不生成在线报告。</dd></div></dl></div>}
    </div>
    <footer className="proxy-footer"><span>本机 HTTP 代理 · {snapshot.id ? `127.0.0.1:${snapshot.proxyPort}` : '等待连接'}</span><span>{snapshot.finishedAt ? new Date(snapshot.finishedAt).toLocaleString('zh-CN') : '手动启动 · 结果只保留在本机'}</span></footer></> : <div className="proxy-idle"><h3>检测后在这里查看结果</h3><p>先确认上方端口与代理客户端显示的 HTTP 或混合端口一致，再点击“开始网络检测”。默认检查北京、上海、广东和国际服务；下载 / 上传需要单独勾选。</p></div>}
  </section>;
}
