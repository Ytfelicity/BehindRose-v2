export type ProxyLatency = { region: string; carrier: string; host: string; port: number; samples: (number | null)[]; averageMs: number | null; minimumMs: number | null; jitterMs: number | null; failurePercent: number; error: string | null };
export type ProxyTransfer = { name: string; url: string; direction: string; bytes: number; seconds: number; mbps: number | null; error: string | null };
export type ProxyNetworkReport = { version: string; scope: string; identity: { ip: string; prefix: string | null; asns: string[]; holder: string | null; error: string | null } | null; finalIp: string | null; exitChanged: boolean | null; latencies: ProxyLatency[]; transfers: ProxyTransfer[] };
export type ProxyNetworkState = { state: string; id: string | null; proxyPort: number; profile: string; includeSpeed: boolean; stage: string; current: number; total: number; startedAt: string | null; finishedAt: string | null; report: ProxyNetworkReport | null; error: string | null };
type Fields = { proxyPort: number; profile: string; includeSpeed: boolean };
type WebView = { postMessage(value: unknown): void; addEventListener(name: string, listener: (event: { data: Record<string, unknown> }) => void): void };
const native = location.hostname === 'diagnostics.behindrose.invalid' ? (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview : undefined;
let epoch = '';
const callbacks = new Map<string, { resolve: (data: ProxyNetworkState) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
native?.addEventListener('message', event => {
  if (event.data.kind === 'epoch' || event.data.kind === 'stop') epoch = String(event.data.epoch || '');
  if (event.data.kind !== 'proxy-network-response') return;
  const requestId = String(event.data.requestId), callback = callbacks.get(requestId);
  if (!callback) return;
  callbacks.delete(requestId); clearTimeout(callback.timer);
  event.data.error ? callback.reject(Error(String(event.data.error))) : callback.resolve(event.data.data as ProxyNetworkState);
});
export async function proxyNetworkApi(command: 'proxy-network-status' | 'proxy-network-start' | 'proxy-network-stop', fields?: Fields): Promise<ProxyNetworkState> {
  if (native) {
    for (let n = 0; !epoch && n < 30; n++) await new Promise(resolve => setTimeout(resolve, 100));
    if (!epoch) throw Error('检测页面尚未与桌面程序连接，请刷新页面');
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { callbacks.delete(requestId); reject(Error('代理网络检测服务响应超时')); }, 15000);
      callbacks.set(requestId, { resolve, reject, timer });
      native.postMessage({ kind: 'proxy-network', epoch, requestId, action: command, ...fields });
    });
  }
  const session = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(15000) }).then(response => response.json());
  if (!session.ready) throw Error(session.error || '本机服务正在启动，请稍后重试');
  const response = await fetch('/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BehindRose-Token': session.token }, body: JSON.stringify({ command, ...fields }), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok || result.error) throw Error(result.error || '代理网络检测请求失败');
  return result.data;
}

export function proxyNetworkText(state: ProxyNetworkState): string {
  const report = state.report;
  return ['Rose in my wake · 代理网络质量', `状态：${state.state} · ${state.stage}`, `代理：http://127.0.0.1:${state.proxyPort}`, `开始：${state.startedAt || '未知'} · 结束：${state.finishedAt || '尚未结束'}`,
    `范围：${report?.scope || '尚未采样'}`, `出口：${report?.identity?.ip || '未知'} · 前缀：${report?.identity?.prefix || '未知'}`,
    `ASN：${report?.identity?.asns.map(value => 'AS' + value).join(', ') || '未知'} · ${report?.identity?.holder || '机构未知'}`,
    `结束出口：${report?.finalIp || '未知'} · 出口变化：${report?.exitChanged === true ? '是' : report?.exitChanged === false ? '未观察到' : '未知'}`, '',
    '节点响应（国内 HTTP 响应头 / 国际 TLS 握手；含本机与代理链路；不是 ICMP/TCP 大包延迟）',
    ...(report?.latencies || []).map(row => `${row.region} ${row.carrier} ${row.host}:${row.port} · ${row.port === 443 ? 'TLS 握手' : 'HTTP 响应'} · 均值 ${row.averageMs ?? '未知'} ms · 最低 ${row.minimumMs ?? '未知'} ms · 抖动 ${row.jitterMs ?? '未知'} ms · 请求失败 ${row.failurePercent}% · 样本 ${row.samples.map(value => value ?? '失败').join('/')}`), '',
    '吞吐采样（端到端单连接，含握手；失败不计为 0 Mbps）',
    ...(report?.transfers || []).map(row => `${row.name} ${row.direction === 'upload' ? '上传' : '下载'} · ${row.mbps ?? '未知'} Mbps · ${row.bytes} bytes · ${row.seconds}s · ${row.error || row.url}`),
    '', 'NAT / BBR / TCP 缓冲区 / VPS 回程线路：需在 VPS 内检测。国内镜像下载不代表三网 Speedtest；Cloudflare 为就近边缘，不代表固定国家。', state.error || ''].join('\n');
}
