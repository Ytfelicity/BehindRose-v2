import { createMyIPProbe, MYIP_FAST_MS, MYIP_TIMEOUT_MS, MYIP_MULTI_ROUNDS, MYIP_INTERVAL_MS, MYIP_STAGGER_MS, probeMyIP } from './vendor/myip-connectivity.mjs';
import { MYIP_AI_TARGETS, MYIP_DEFAULT_TARGETS } from './vendor/myip-targets';
export { MYIP_FAST_MS, MYIP_TIMEOUT_MS };
export const WEBSITE_TIMEOUT_MS = MYIP_TIMEOUT_MS;
export const WEBSITE_ROUNDS = MYIP_MULTI_ROUNDS;

export type Website = { id: string; name: string; url: string; icon?: string };
export type ProbeRound = { round: number; state: 'reachable' | 'slow' | 'failed' | 'timeout' | 'cancelled'; ms?: number; sampledAt?: string };
export type ProbeResult = { state: 'idle' | 'running' | 'reachable' | 'slow' | 'failed' | 'timeout' | 'cancelled'; ms?: number; note: string; time?: string; rounds?: ProbeRound[]; totalRounds?: number; completedRounds?: number; successfulRounds?: number; finished?: boolean };
const icons: Record<string, string> = { claude: 'claude-color', chatgpt: 'openai', gemini: 'gemini-color', deepseek: 'deepseek-color', huggingface: 'huggingface-color', midjourney: 'midjourney', suno: 'suno', manus: 'manus', mistral: 'mistral-color', 'meta-ai': 'metaai-color', qwen: 'qwen-color', kimi: 'kimi', poe: 'poe-color', perplexity: 'perplexity-color', google: 'google-color', github: 'github', cloudflare: 'cloudflare-color', youtube: 'youtube', wechat: 'weixin' };
const adaptTargets = (targets: ReadonlyArray<{ id: string; name: string; url: string }>): Website[] => targets.map(({ id, name, url }) => ({ id, name, url, icon: icons[id] }));
export const siteGroups = {
  ai: { label: 'AI 服务', sites: adaptTargets(MYIP_AI_TARGETS) },
  common: { label: '常用网站', sites: adaptTargets(MYIP_DEFAULT_TARGETS.filter(site => ['google', 'github', 'cloudflare'].includes(site.id))) },
  reference: { label: 'IPCheck.ing 默认', sites: adaptTargets(MYIP_DEFAULT_TARGETS) },
};
export const idleResult = (): ProbeResult => ({ state: 'idle', note: '点击检测后发起 HTTPS 请求' });

export function summarizeWebsiteResults(sites: Website[], results: Record<string, ProbeResult>) {
  return sites.reduce((summary, site) => {
    const result = results[site.id];
    if (result?.finished) summary.finished++;
    if (result?.ms !== undefined) summary.reached++;
    summary.completed += result?.completedRounds ?? 0;
    summary.planned += result?.totalRounds ?? 0;
    return summary;
  }, { finished: 0, reached: 0, completed: 0, planned: 0 });
}

export function normalizeWebsite(value: unknown): Website {
  if (!value || typeof value !== 'object') throw Error('每个网站需要 name 和 url');
  const { name, url } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) throw Error('网站名称需为 1–60 个字符');
  if (typeof url !== 'string' || url.length > 2048) throw Error('请输入完整的 HTTPS 地址');
  let parsed: URL;
  try { parsed = new URL(url.trim()); } catch { throw Error('请输入完整的 HTTPS 地址'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port && parsed.port !== '443') throw Error('仅支持不含账号密码的 HTTPS 地址（443 端口）');
  const host = parsed.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) throw Error('请使用公开网站的域名');
  parsed.hash = '';
  return { id: 'custom:' + parsed.href, name: name.trim(), url: parsed.href };
}

export function importWebsites(text: string, current: Website[]): Website[] {
  if (text.length > 65536) throw Error('导入内容不能超过 64KB');
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw Error('JSON 格式有误，请参考示例'); }
  if (!Array.isArray(input) || input.length > 40) throw Error('需要 JSON 数组，最多 40 个网站');
  const merged = new Map(current.map(site => [site.url, site]));
  for (const value of input) { const site = normalizeWebsite(value); merged.set(site.url, site); }
  if (merged.size > 40) throw Error('自定义列表最多 40 个网站');
  return [...merged.values()];
}

export async function probeWebsite(site: Website, signal: AbortSignal, timeout = WEBSITE_TIMEOUT_MS): Promise<ProbeResult> {
  const result = await probeMyIP(site.url, signal, timeout);
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  if (signal.aborted) return { state: 'cancelled', note: '已停止', time };
  if (result.reachable) return {
    state: result.ms! < MYIP_FAST_MS ? 'reachable' : 'slow', ms: result.ms,
    note: result.responseType === 'opaque' ? 'IPCheck.ing 检测：已收到响应；跨域 HTTP 状态不可见' : 'IPCheck.ing 检测：已收到响应 · HTTP ' + result.status,
    time,
  };
  return {
    state: result.timedOut ? 'timeout' : 'failed',
    note: result.timedOut ? `${timeout / 1000} 秒内未收到响应` : '探测请求失败，可能是网络、浏览器策略或服务限制',
    time,
  };
}

export type BatchOptions = { rounds?: 1 | 10; intervalMs?: number; staggerMs?: number; timeoutMs?: number };
function waitForProbe(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
}
export async function runWebsiteBatch(sites: Website[], signal: AbortSignal, update: (site: Website, result: ProbeResult) => void, options: BatchOptions = {}): Promise<void> {
  const total = options.rounds ?? WEBSITE_ROUNDS;
  if (![1, WEBSITE_ROUNDS].includes(total)) throw Error('网站采样次数无效');
  if (!sites.length) return;
  const interval = options.intervalMs ?? MYIP_INTERVAL_MS, stagger = options.staggerMs ?? MYIP_STAGGER_MS;
  if (![interval, stagger].every(value => Number.isFinite(value) && value >= 0)) throw Error('网站采样间隔无效');
  const probes = sites.map(site => createMyIPProbe(site.url, signal, options.timeoutMs ?? WEBSITE_TIMEOUT_MS, total > 1));
  const histories: ProbeRound[][] = sites.map(() => []);
  const publish = (index: number, finished = false) => {
    const rounds = [...histories[index]].sort((a, b) => a.round - b.round);
    const successes = rounds.filter(round => round.ms !== undefined && ['reachable', 'slow'].includes(round.state));
    const ms = successes.length ? Math.min(...successes.map(round => round.ms!)) : undefined;
    const done = finished || signal.aborted || rounds.length === total;
    const state = signal.aborted ? 'cancelled' : ms !== undefined ? ms < MYIP_FAST_MS ? 'reachable' : 'slow' : !done ? 'running' : !rounds.length ? 'idle' : rounds.some(round => round.state === 'failed') ? 'failed' : 'timeout';
    update(sites[index], {
      state, ms, rounds, totalRounds: total, completedRounds: rounds.length, successfulRounds: successes.length, finished: done,
      note: `HTTPS 响应耗时 · ${total > 1 ? '计划 ' + total + ' 次取最低成功值' : '单次'}；${successes.length}/${rounds.length} 次收到响应${rounds.length ? '；首测 ' + (rounds[0].ms !== undefined ? rounds[0].ms + ' ms' : '未取得响应') : '；尚未发起请求'}${signal.aborted ? '；已停止，采样可能不完整' : done ? '；跨域 HTTP 状态不可见' : '；正在继续采样'}`,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    });
  };
  sites.forEach((_, index) => publish(index));
  // Upstream waits for the first complete pass, then starts later passes every
  // 500 ms. Each pass staggers targets by 50 ms; slow requests may overlap.
  const pass = (round: number) => Promise.all(sites.map(async (_, index) => {
      await waitForProbe(stagger * index, signal);
      if (signal.aborted) return;
      const result = await probes[index]();
      histories[index].push({ round, state: signal.aborted ? 'cancelled' : result.roundReachable ? result.roundMs! < MYIP_FAST_MS ? 'reachable' : 'slow' : result.timedOut ? 'timeout' : 'failed', ms: result.roundReachable ? result.roundMs : undefined, sampledAt: new Date().toISOString() });
      publish(index);
  }));
  try {
    if (!signal.aborted) await pass(1);
    const pending = [];
    // Reserve a round before dispatch. Unlike the upstream async setInterval,
    // late completions cannot cause additional passes beyond the intended ten.
    for (let round = 2; round <= total && !signal.aborted; round++) {
      await waitForProbe(interval, signal);
      if (!signal.aborted) pending.push(pass(round));
    }
    await Promise.all(pending);
  } finally {
    sites.forEach((_, index) => publish(index, true));
  }
}
