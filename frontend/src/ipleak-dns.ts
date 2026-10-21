import { ipFamily } from './ippure';

// Protocol verified against https://ipleak.net/static/js/index.js on 2026-10-18.
// Every lookup is made by the current browser, never by the local backend.
export const IPLEAK_DNS_PROVIDERS = [{ id: 'ipleak', name: 'IPLeak.net' }] as const;
export const IPLEAK_DNS_QUERY_COUNT = 300;
export const IPLEAK_DETAILS_TIMEOUT_MS = 10000;
const MAX_BYTES = 256 * 1024;
const MAX_RESOLVERS = 256;
type Timers = { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
export type IpLeakDnsRow = {
  address: string; ip_address: string; hits: number; hostname: string; isp: string;
  country: string; country_code: string; region: string; city: string;
  metadataStatus: 'loading' | 'ready' | 'unavailable'; details?: Record<string, unknown>;
};
export type SourceResult = {
  slot: number; sourceId: string; sourceName: string;
  status: 'running' | 'ready' | 'unavailable' | 'cancelled'; note: string;
  completedQueries: number; totalQueries: number; failedQueries: number;
  serverCount: number; rows: IpLeakDnsRow[];
};
type Dependencies = Partial<Timers> & { fetch?: typeof fetch; session?: () => string };
const stopped = () => new DOMException('DNS 检测已停止', 'AbortError');

function abortable<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(stopped());
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value as T);
    };
    const abort = () => finish(stopped());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { Promise.resolve(task()).then(value => finish(undefined, value), error => finish(error)); }
    catch (error) { finish(error); }
  });
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) throw Error('IPLeak 返回 HTTP ' + response.status);
  if (Number(response.headers.get('Content-Length')) > MAX_BYTES) throw Error('IPLeak 响应过大');
  const reader = response.body?.getReader();
  if (!reader) throw Error('IPLeak 响应为空');
  try {
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const part = await abortable(() => reader.read(), signal);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_BYTES) throw Error('IPLeak 响应过大');
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function newSession() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(40)), byte => alphabet[byte % alphabet.length]).join('');
}

export function createIpLeakDnsRunner(dependencies: Dependencies = {}) {
  const timers: Timers = {
    setTimeout: dependencies.setTimeout ?? globalThis.setTimeout.bind(globalThis),
    clearTimeout: dependencies.clearTimeout ?? globalThis.clearTimeout.bind(globalThis),
  };
  const pause = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(stopped()); return; }
    const abort = () => { timers.clearTimeout(timer); signal.removeEventListener('abort', abort); reject(stopped()); };
    const timer = timers.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
  return async (signal: AbortSignal, onSource?: (source: SourceResult) => void): Promise<SourceResult[]> => {
    const fetcher = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    const current: SourceResult = {
      slot: 0, sourceId: 'ipleak', sourceName: 'IPLeak.net', status: 'running',
      note: '正在开始 IPLeak 连续采样，可随时停止', completedQueries: 0,
      totalQueries: IPLEAK_DNS_QUERY_COUNT, failedQueries: 0, serverCount: 0, rows: [],
    };
    const snapshot = (): SourceResult => ({ ...current, rows: current.rows.map(row => ({ ...row, ...(row.details ? { details: { ...row.details } } : {}) })) });
    let ended = false;
    const publish = () => { if (!ended && !signal.aborted) onSource?.(snapshot()); };
    const metadata = new Map<string, IpLeakDnsRow>();
    const queue: IpLeakDnsRow[] = [], workers = new Set<Promise<void>>();
    const detailsStop = new AbortController();
    const abortDetails = () => detailsStop.abort();
    signal.addEventListener('abort', abortDetails, { once: true });
    const json = (url: string, activeSignal: AbortSignal) => abortable(async () => {
      const response = await fetcher(url, { method: 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: activeSignal });
      return readJson(response, activeSignal);
    }, activeSignal);
    const loadDetails = async (row: IpLeakDnsRow) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      detailsStop.signal.addEventListener('abort', abort, { once: true });
      const timer = timers.setTimeout(abort, IPLEAK_DETAILS_TIMEOUT_MS);
      if (detailsStop.signal.aborted) abort();
      try {
        const value = await json('https://ipleak.net/json/' + encodeURIComponent(row.address), controller.signal);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('IPLeak 归属格式无效');
        const data = value as Record<string, unknown>;
        if (data.ip !== row.address) throw Error('IPLeak 归属与解析器地址不匹配');
        for (const key of ['reverse', 'isp_name', 'country_name', 'country_code', 'region_name', 'city_name']) {
          if (data[key] != null && (typeof data[key] !== 'string' || (data[key] as string).length > 2048)) throw Error('IPLeak 归属格式无效');
        }
        if (ended || detailsStop.signal.aborted) return;
        Object.assign(row, { hostname: data.reverse ?? '', isp: data.isp_name ?? '', country: data.country_name ?? '', country_code: data.country_code ?? '', region: data.region_name ?? '', city: data.city_name ?? '', metadataStatus: 'ready', details: { ...data } });
      } catch {
        if (!ended && !detailsStop.signal.aborted) row.metadataStatus = 'unavailable';
      } finally {
        timers.clearTimeout(timer); detailsStop.signal.removeEventListener('abort', abort); publish();
      }
    };
    const pump = () => {
      while (!detailsStop.signal.aborted && workers.size < 4 && queue.length) {
        const row = queue.shift()!;
        const task = loadDetails(row).finally(() => { workers.delete(task); pump(); });
        workers.add(task);
      }
    };
    let lastFailure = '';
    try {
      if (signal.aborted) throw stopped();
      const session = (dependencies.session ?? newSession)();
      if (!/^[a-z0-9]{40}$/.test(session)) throw Error('无法生成 IPLeak 会话标识');
      publish();
      for (let step = 1; step <= IPLEAK_DNS_QUERY_COUNT; step++) {
        if (signal.aborted) throw stopped();
        try {
          const value = await json(`https://${session}-${step}.ipleak.net/dnsdetection/`, signal);
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('IPLeak 采样格式无效');
          const data = value as { session?: unknown; ip?: unknown };
          if (data.session !== session || !data.ip || typeof data.ip !== 'object' || Array.isArray(data.ip)) throw Error('IPLeak 采样会话或结果格式不匹配');
          const entries = Object.entries(data.ip);
          if (entries.length > MAX_RESOLVERS) throw Error('IPLeak 解析器记录过多');
          if (entries.some(([address, hits]) => !ipFamily(address) || !Number.isSafeInteger(hits) || (hits as number) < 0)) throw Error('IPLeak 解析器地址或命中次数无效');
          // Official results are a cumulative map, not per-request increments.
          // Preserve first-seen card order; update hits from the latest response.
          for (const [address, hits] of entries) {
            let row = metadata.get(address);
            if (!row) {
              if (metadata.size >= MAX_RESOLVERS) throw Error('IPLeak 解析器记录过多');
              row = { address, ip_address: address, hits: hits as number, hostname: '', isp: '', country: '', country_code: '', region: '', city: '', metadataStatus: 'loading' };
              metadata.set(address, row); current.rows.push(row); queue.push(row);
            }
            row.hits = hits as number;
          }
          current.serverCount = entries.length;
          pump();
        } catch (error) {
          if (signal.aborted) throw stopped();
          current.failedQueries++;
          lastFailure = error instanceof Error ? error.message : 'IPLeak 请求失败';
        }
        current.completedQueries = step;
        current.note = 'IPLeak 连续采样，可随时停止' + (current.failedQueries ? '；已有 ' + current.failedQueries + ' 次请求失败' : '');
        publish();
        // Match the site's serial schedule: 1 ms before step 100, then 1 s;
        // the final (300th) request never schedules a further lookup.
        if (step < IPLEAK_DNS_QUERY_COUNT) await pause(step >= 100 ? 1000 : 1, signal);
      }
      while (workers.size) await abortable(() => Promise.all([...workers]), signal);
      current.status = current.rows.length && !current.failedQueries ? 'ready' : 'unavailable';
      current.note = current.failedQueries ? `采样结束，${current.failedQueries} 次请求失败；${lastFailure}。已有记录仅代表成功的采样` : current.rows.length ? 'IPLeak 连续采样完成（300 次请求）' : 'IPLeak 未返回解析器记录，无法确认 DNS 解析来源';
    } catch (error) {
      current.status = signal.aborted ? 'cancelled' : 'unavailable';
      current.note = signal.aborted ? '已停止 IPLeak 采样，保留已取得的解析器和命中次数' : error instanceof Error ? error.message : 'IPLeak 检测失败';
    } finally {
      ended = true; detailsStop.abort(); signal.removeEventListener('abort', abortDetails);
      for (const row of current.rows) if (row.metadataStatus === 'loading') row.metadataStatus = 'unavailable';
    }
    return [snapshot()];
  };
}

export const runIpLeakDns = createIpLeakDnsRunner();
