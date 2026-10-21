import { useEffect, useRef, useState } from 'react';
import { Activity, CircleHelp, Copy, Globe2, Play, Square } from 'lucide-react';
import { Button } from '@/components/motion/button';
import { SparkActions } from './reactbits-integration';
import { qualityApi, idleQuality, type QualityReport } from './quality-api';
import { ipFamily, ipPureRisk, IPPURE_RISK_BANDS } from './ippure';
import { DetectionGuide } from './detection-guide';
import { ProxyPortPicker } from './proxy-port-picker';

const valueText = (value: unknown) => value === null || value === undefined || value === '' ? '未知' : String(value);
function comparableIp(address: string) { try { return address.includes(':') ? new URL('http://[' + address + ']/').hostname.toLowerCase() : address; } catch { return address.toLowerCase(); } }
function Region({ code, name }: { code?: string | null; name?: string | null }) {
  const known = typeof code === 'string' && /^[A-Za-z]{2}$/.test(code);
  return <span className="quality-region">{known ? <img src={'/flags/' + code.toLowerCase() + '.svg'} alt="" width="24" height="18" onError={event => { event.currentTarget.hidden = true; }}/> : <Globe2 size={15}/>}<span>{valueText(name || code)}</span></span>;
}
function Results({ report }: { report: QualityReport }) {
  const data = report.Data, risk = ipPureRisk(data), ipv6 = ipFamily(data.ip) === 6;
  const bandIndex = risk ? IPPURE_RISK_BANDS.indexOf(risk) : 0, start = IPPURE_RISK_BANDS[bandIndex - 1]?.end ?? 0;
  const position = risk ? (bandIndex + (data.fraudScore! - start) / (risk.end - start)) / 6 * 100 : 0;
  const kind = data.isResidential === true ? '住宅 IP' : data.isResidential === false ? '机房 IP' : '未知';
  const broadcast = data.isBroadcast === true ? '广播 IP' : data.isBroadcast === false ? '原生 IP' : '未知';
  return <>
    <div className="ippure-summary">
      <div className="ippure-risk" data-known={!!risk}>
        <span>IPPure 风险系数</span>
        <strong className="ippure-score">{risk ? data.fraudScore + '%' : '—'}</strong>
        <span className="ippure-risk-label">{risk?.label || (ipv6 ? 'IPv6 不计算风险系数' : '未取得风险系数')}</span>
        {risk && <div className="ippure-scale" aria-label="IPPure 官网风险分档">
          <div className="ippure-bands">{IPPURE_RISK_BANDS.map(band => <span key={band.end} style={{ backgroundColor: band.color }} title={band.label + ' · ≤ ' + band.end}/>)}</div>
          <span className="ippure-indicator" style={{ left: position + '%' }} aria-hidden="true"/>
          <div className="ippure-scale-labels"><span>0</span><span>15</span><span>25</span><span>40</span><span>50</span><span>70</span><span>100</span></div>
        </div>}
        <small>沿用 IPPure 原始分值与分档，数值越高表示风险越高。</small>
        <p className="quality-footnote">检测路径：{report.Head.Proxy ? '指定本机 HTTP 代理' : '本机默认网络'}。缺失字段显示未知。</p>
      </div>
      <div className="ippure-details">
        <dl className="ippure-classifications">
          <div><dt>IP 类型</dt><dd>{kind}</dd></div>
          <div><dt>地区属性</dt><dd>{broadcast}</dd></div>
          <div><dt>数据来源</dt><dd><a href="https://ippure.com/" target="_blank" rel="noopener noreferrer">IPPure</a></dd></div>
        </dl>
        <dl className="quality-facts">
          <div><dt>检测出口 · IPv{report.Head.Family}</dt><dd className="mono">{data.ip}</dd></div>
          <div><dt>网络 / ASN</dt><dd>{valueText(data.asOrganization)} · {data.asn == null ? 'ASN 未知' : 'AS' + data.asn}</dd></div>
          <div><dt>国家 / 地区</dt><dd><Region code={data.countryCode} name={data.country}/></dd></div>
          <div><dt>省州 / 城市</dt><dd>{[data.region, data.city].filter(Boolean).join(' · ') || '未知'}</dd></div>
          <div><dt>邮编</dt><dd>{valueText(data.postalCode)}</dd></div>
          <div><dt>时区</dt><dd>{valueText(data.timezone)}</dd></div>
          <div><dt>经度 / 纬度</dt><dd>{valueText(data.longitude)} / {valueText(data.latitude)}</dd></div>
          <div><dt>采样时间</dt><dd>{new Date(report.Head.Time).toLocaleString('zh-CN')}</dd></div>
        </dl>
      </div>
    </div>
  </>;
}

export function IpQuality() {
  const [snapshot, setSnapshot] = useState(idleQuality), [proxy, setProxy] = useState(true), [port, setPort] = useState(''), [message, setMessage] = useState(''), [pending, setPending] = useState(false), [connectionError, setConnectionError] = useState('');
  const version = useRef(0), actionPending = useRef(false), restored = useRef(false), selectionEdited = useRef(false);
  const publishedReport = useRef('');
  const running = snapshot.state === 'running', locked = running || pending;
  const [browserIp, setBrowserIp] = useState('');
  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = version.current;
      if (!actionPending.current) try {
        const state = await qualityApi('quality-status');
        if (!disposed && revision === version.current && !actionPending.current) {
          setSnapshot(state);
          if (state.state === 'running' || !restored.current && !selectionEdited.current && state.id) {
            setProxy(state.route === 'proxy');
            if (state.route === 'proxy') setPort(state.proxyPort ? String(state.proxyPort) : '');
          }
          restored.current = true;
          if (state.report) {
            const key = state.id + ':' + state.report.Head.Time;
            if (publishedReport.current !== key) { publishedReport.current = key; window.dispatchEvent(new CustomEvent('quality-report', { detail: state.report })); }
          }
          setConnectionError('');
        }
      } catch (error) { if (!disposed && revision === version.current && !actionPending.current) setConnectionError((error as Error).message); }
      if (!disposed) timer = setTimeout(poll, 1000);
    };
    void poll(); return () => { disposed = true; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    const source = document.getElementById(snapshot.family === 6 ? 'ip6-address' : 'ip4-address');
    if (!source) return;
    const read = () => setBrowserIp(source.textContent || ''); read();
    const observer = new MutationObserver(read); observer.observe(source, { childList: true, characterData: true, subtree: true }); return () => observer.disconnect();
  }, [snapshot.family]);
  const start = async () => {
    if (actionPending.current) return;
    const proxyPort = proxy ? Number(port) : 0;
    if (proxy && (!/^\d+$/.test(port) || !Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535)) { setMessage('请选择或填写 1–65535 的本机 HTTP / 混合端口'); return; }
    version.current++; actionPending.current = true; setPending(true); setMessage('');
    try { setSnapshot(await qualityApi('quality-start', { proxyPort })); setConnectionError(''); }
    catch (error) { setMessage((error as Error).message); } finally { actionPending.current = false; setPending(false); }
  };
  const stop = async () => {
    if (actionPending.current) return; version.current++; actionPending.current = true; setPending(true);
    try { setSnapshot(await qualityApi('quality-stop')); setConnectionError(''); } catch (error) { setMessage((error as Error).message); } finally { actionPending.current = false; setPending(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2)); setMessage('已复制 IPPure JSON 报告'); } catch { setMessage('复制失败，请检查剪贴板权限'); } };
  const mismatch = snapshot.report && ipFamily(browserIp) && comparableIp(snapshot.report.Head.IP) !== comparableIp(browserIp);
  return <section className="ip-quality" id="ip-quality" aria-labelledby="quality-title" data-state={snapshot.state}>
    <div className="quality-heading"><h2 id="quality-title"><Activity size={20}/>IP 质量体检</h2><span>IPPure</span></div>
    <p className="quality-intro">使用 <a href="https://ippure.com/" target="_blank" rel="noopener noreferrer">IPPure</a> 查询出口 IP 的归属、风险系数和类型。</p>
    <DetectionGuide tool="ip-quality" target={running ? snapshot.route === 'proxy' ? '本机 HTTP 代理 · 127.0.0.1:' + snapshot.proxyPort : '本机默认网络访问 IPPure 的出口' : proxy ? port ? '本机 HTTP 代理 · 127.0.0.1:' + port : '请选择本机 HTTP / 混合端口' : '本机默认网络访问 IPPure 的出口'}/>
    <SparkActions><div className="quality-controls">
      <label><span>检测出口</span><select aria-label="体检出口" disabled={locked} value={running ? snapshot.route : proxy ? 'proxy' : 'default'} onChange={event => { selectionEdited.current = true; setProxy(event.target.value === 'proxy'); setMessage(''); }}><option value="proxy">本机 HTTP 代理</option><option value="default">本机默认网络</option></select></label>
      {proxy && <ProxyPortPicker value={port} disabled={locked} onChange={value => { selectionEdited.current = true; setPort(value); setMessage(''); }}/>}
      <Button data-beui className="detection-primary-action" disabled={locked || proxy && !port} onClick={start}><Play size={17}/>{snapshot.report ? '重新质量体检' : '开始质量体检'}</Button>
      {running && <Button data-beui className="detection-stop-action" variant="ghost" disabled={pending} onClick={stop}><Square size={14}/>停止体检</Button>}
      {snapshot.report && <Button data-beui variant="outline" onClick={copy}><Copy size={14}/>复制 JSON</Button>}
    </div></SparkActions>
    <div className="quality-progress" role="status" aria-live="polite"><span>{snapshot.stage}</span></div>
    <p className="quality-message" role="status">{message || snapshot.error || connectionError}</p>
    {mismatch && <p className="quality-mismatch"><CircleHelp size={16}/>IPPure 看到的出口 {snapshot.report!.Head.IP} 与浏览器公网 IP {browserIp} 不同。下方报告只代表本次访问 IPPure 的出口，可能受到分流规则影响。</p>}
    {snapshot.report ? <Results report={snapshot.report}/> : <div className="quality-empty"><p>点击“开始质量体检”，查看 IPPure 本次查询结果。</p><span>IP / ASN / 国家与城市</span><span>IPPure 风险系数</span><span>住宅 / 机房</span><span>原生 / 广播</span></div>}
    <details className="quality-about"><summary>数据来源与检测范围</summary>
      <p>数据来自 IPPure 官方公开接口，点击后查询一次，最长等待 20 秒。原始分值和类型标记直接采用返回结果，不需要 Docker。</p>
      <p>由本机服务的独立浏览器正常访问官方接口，需要 WebView2 Runtime。默认选择已有本机 HTTP 代理，端口只用于本次请求，连接失败不回退直连；“本机默认网络”沿用系统现有网络行为，可能与浏览器分流不同。工具不会切换节点或修改代理配置。</p>
      <p>IPv4 / IPv6 由本次网络连接决定；IPPure 不计算 IPv6 风险系数。该接口不提供旧引擎的多库评分、流媒体解锁或邮件检测结果。</p>
      <p>接口受网络和网站验证影响。失败时显示未取得结果；请以同一出口、同一时间的查询作对照。</p>
      <p><a href="https://ippure.com/MyIP-Info-API" target="_blank" rel="noopener noreferrer">接口说明</a> · <a href="https://ippure.com/faq" target="_blank" rel="noopener noreferrer">IPPure 结果说明</a></p>
    </details>
  </section>;
}
