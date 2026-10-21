import { IPPURE_ENDPOINT, parseIpPureInfo, type IpPureInfo } from './ippure';
export type QualityReport = { Source: 'IPPure'; Endpoint: string; Head: { IP: string; Time: string; Family: number; Proxy: boolean }; Data: IpPureInfo };
export type QualityState = { state: string; id: string | null; family: number; route: string; proxyPort?: number; stage: string; current: number; total: number; startedAt: string | null; finishedAt: string | null; report: QualityReport | null; error: string | null };
export type LocalProxyPorts = { candidates: { port: number; sources: string[]; loopbackOnly: boolean }[]; notes: string[] };
export const idleQuality: QualityState = { state: 'idle', id: null, family: 4, route: 'proxy', stage: '尚未开始', current: 0, total: 1, startedAt: null, finishedAt: null, report: null, error: null };
type WebView = { postMessage(message: unknown): void; addEventListener(name: string, listener: (event: { data: Record<string, unknown> }) => void): void };
const native = location.hostname === 'diagnostics.behindrose.invalid' ? (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview : undefined;
let epoch = '';
const callbacks = new Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
native?.addEventListener('message', event => {
  if (event.data.kind === 'epoch' || event.data.kind === 'stop') epoch = String(event.data.epoch || '');
  if (event.data.kind !== 'quality-response') return;
  const request = callbacks.get(String(event.data.requestId)); if (!request) return;
  clearTimeout(request.timer); callbacks.delete(String(event.data.requestId));
  event.data.error ? request.reject(Error(String(event.data.error))) : request.resolve(event.data.data);
});
async function requestQuality<T>(command: 'quality-status' | 'quality-start' | 'quality-stop' | 'quality-proxies', fields: { proxyPort?: number } = {}): Promise<T> {
  if (native) {
    for (let n = 0; !epoch && n < 30; n++) await new Promise(resolve => setTimeout(resolve, 100));
    if (!epoch) throw Error('检测页面尚未与桌面程序连接，请刷新页面');
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { callbacks.delete(requestId); reject(Error('本机体检服务响应超时')); }, 15000);
      callbacks.set(requestId, { resolve: data => resolve(data as T), reject, timer });
      native.postMessage({ kind: 'quality', epoch, requestId, action: command, ...fields });
    });
  }
  const session = await fetch('/api/session', { cache: 'no-store', signal: AbortSignal.timeout(15000) }).then(response => response.json());
  if (!session.ready) throw Error(session.error || '本机服务正在启动，请稍后重试');
  const response = await fetch('/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BehindRose-Token': session.token }, body: JSON.stringify({ command, ...fields }), signal: AbortSignal.timeout(15000) });
  const result = await response.json(); if (!response.ok || result.error) throw Error(result.error || 'IP 质量体检请求失败');
  return result.data as T;
}
export async function qualityApi(command: 'quality-status' | 'quality-start' | 'quality-stop', fields: { proxyPort?: number } = {}): Promise<QualityState> {
  if (command === 'quality-start') {
    const current = await requestQuality<QualityState>('quality-status');
    if (current.total !== 1) throw Error('本机服务仍在运行旧版检测引擎，请重新启动开发服务');
  }
  const state = await requestQuality<QualityState>(command, fields);
  if (state.total !== 1) throw Error('本机服务仍在运行旧版检测引擎，请重新启动开发服务');
  if (state.report) {
    if (state.report.Source !== 'IPPure' || state.report.Endpoint !== IPPURE_ENDPOINT || state.report.Head.IP !== state.report.Data?.ip) throw Error('本机服务返回了无效的 IPPure 报告');
    parseIpPureInfo(state.report.Data);
  }
  return state;
}
export const discoverProxyPorts = () => requestQuality<LocalProxyPorts>('quality-proxies');
