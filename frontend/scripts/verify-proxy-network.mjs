// Optional live verification. It only invokes the unprivileged proxy detector.
// --speed transfers at most 28 MiB of sampled payload, plus protocol overhead.
import { mkdir, writeFile } from 'node:fs/promises';
const origin = new URL(process.env.BEHINDROSE_TEST_URL || 'http://127.0.0.1:4317/').origin;
const proxyPort = Number(process.env.BEHINDROSE_PROXY_PORT || 7897);
const session = await fetch(origin + '/api/session').then(response => response.json());
if (!session.ready) throw Error('Local host is not ready');
async function call(command, fields = {}) {
  const response = await fetch(origin + '/api/local', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-BehindRose-Token': session.token }, body: JSON.stringify({ command, ...fields }), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok || result.error) throw Error(result.error || 'Local API failed');
  return result.data;
}
const active = await call('proxy-network-status');
if (active.state === 'running') throw Error('A user measurement is already running');
let state = await call('proxy-network-start', { proxyPort, profile: 'quick', includeSpeed: process.argv.includes('--speed') });
let progress = -1;
while (state.state === 'running') {
  if (state.current !== progress) { progress = state.current; console.log(`${state.current}/${state.total} ${state.stage}`); }
  await new Promise(resolve => setTimeout(resolve, 1500));
  state = await call('proxy-network-status');
}
const output = new URL('../../private/proxy-network-check/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('live-report.json', output), JSON.stringify(state, null, 2));
console.log(JSON.stringify({ state: state.state, current: state.current, total: state.total, identity: !!state.report?.identity, bgp: !!state.report?.identity?.prefix, responses: state.report?.latencies.filter(row => row.averageMs != null).length, totalTargets: state.report?.latencies.length, exitChanged: state.report?.exitChanged, transfers: state.report?.transfers.map(row => ({ name: row.name, direction: row.direction, mbps: row.mbps, error: row.error })), error: state.error }, null, 2));
if (state.state !== 'complete' || !state.report?.identity || !state.report?.latencies.some(row => row.averageMs != null)) process.exitCode = 1;
