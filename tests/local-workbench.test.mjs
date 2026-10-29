import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createLocalApi } from '../scripts/local-api.mjs';
import { testRuntime } from '../scripts/test-runtime.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { dotnet, hostDll } = testRuntime();
const child = spawn(dotnet, [hostDll, '--demo'], { windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
const pending = new Map();
const lines = createInterface({ input: child.stdout });
lines.on('line', line => { const response = JSON.parse(line); pending.get(response.id)?.(response); pending.delete(response.id); });
child.once('error', error => { throw error; });
function call(command, fields = {}) {
  const id = randomUUID().replaceAll('-', '');
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Demo bridge timeout')), 8000);
    pending.set(id, reply => { clearTimeout(timeout); resolve(reply); });
    child.stdin.write(JSON.stringify({ id, command, ...fields }) + '\n');
  });
}
async function data(command, fields) { const reply = await call(command, fields); assert.equal(reply.ok, true, reply.error); return reply.data; }
async function complete() {
  for (let n = 0; n < 60; n++) {
    const status = await data('status'); if (status.operation?.done) return status.operation;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Demo operation did not finish');
}
try {
  const initial = await data('health'); assert.equal(initial.demo, true); assert.equal(initial.findings.length, 4);
  assert.deepEqual(await data('backups'), []);
  assert.equal((await call('plan', { options: 128 })).ok, false);
  const ipv6Plan = await data('plan', { options: 32 });
  assert.equal(ipv6Plan.options, 32); assert.equal(ipv6Plan.changes.length, 1);
  assert.equal(ipv6Plan.changes[0].title, '关闭 Clash IPv6');
  assert.equal(ipv6Plan.needsClashExit, true);
  assert.deepEqual(await data('backups'), [], 'IPv6 review must not create a backup or write');
  await data('execute', { planId: ipv6Plan.id });
  const ipv6Applied = await complete(); assert.equal(ipv6Applied.result.success, true);
  assert.equal((await data('health')).clashIpv6.state, '已关闭');
  assert.deepEqual((await data('health')).findings, initial.findings, 'IPv6-only action must preserve TUN and browser configuration');
  assert.equal((await data('plan', { options: 32 })).changes.length, 0);
  const ipv6Restore = await data('restore-plan', { backupId: ipv6Applied.result.backupId });
  await data('execute', { planId: ipv6Restore.id }); assert.equal((await complete()).result.success, true);
  assert.deepEqual((await data('health')).clashIpv6, initial.clashIpv6, 'Demo restore recovers a missing original flag');
  assert.equal((await call('execute', { planId: '0'.repeat(32) })).ok, false);
  const backupsBeforePlan = await data('backups');
  const oneClick = await data('plan', { options: 111 });
  assert.equal(oneClick.options, 111); assert.equal(oneClick.changes.length, 8);
  assert.equal(oneClick.tun.find(item => item.title === 'TUN 模式堆栈').detail, 'Mixed', 'The preview must show the actual selected stack');
  assert.ok(oneClick.tun.some(item => item.title === 'DNS 劫持' && item.detail.includes('tcp://any:53')), 'The virtual adapter panel settings must be covered in the one-click preview');
  assert.ok(oneClick.changes.some(change => change.afterText.includes('ipv6: false')), 'The single built-in plan must include IPv6 disable');
  assert.ok(oneClick.changes.some(change => change.title.includes('DNS 防护') && change.afterText.includes('6 个检测站点') && change.afterText.includes('网易／战网直连')), 'The default preview must describe the DNS protection and routing scope');
  assert.equal(initial.singMix.state, '待配置');
  const plan = oneClick; assert.equal(plan.changes.length, 8); assert.equal(plan.needsClashExit, true);
  assert.deepEqual(Object.keys(plan.changes[0]).sort(), ['afterText', 'beforeText', 'title']);
  assert.equal('plan' in plan || 'expected' in plan || 'fingerprint' in plan, false, 'Snapshots must stay in the local host');
  assert.deepEqual(await data('backups'), backupsBeforePlan, 'Preview cannot create backups');
  const oldPreview = await data('plan', { options: 2 });
  await data('execute', { planId: plan.id });
  const applied = await complete(); assert.equal(applied.result.success, true); assert.equal(applied.result.state, 'applied');
  assert.equal((await data('health')).findings.filter(item => item.state === '已配置').length, 4);
  assert.equal((await data('health')).singMix.state, '已配置');
  assert.equal((await call('execute', { planId: plan.id })).ok, false, 'Execution tokens are single use');
  assert.equal((await call('execute', { planId: oldPreview.id })).ok, false, 'Old previews are invalidated after execution');
  const noop = await data('plan', { options: 111 }); assert.equal(noop.changes.length, 0);
  await data('execute', { planId: noop.id }); assert.equal((await complete()).result.state, 'unchanged');
  const backups = (await data('backups')).filter(item => item.canRestore); assert.equal(backups.length, 1);
  assert.equal('changes' in backups[0], false, 'Backup bytes must not reach the UI');
  const restore = await data('restore-plan', { backupId: backups[0].id }); assert.equal(restore.changes.length, 8);
  await data('execute', { planId: restore.id }); assert.equal((await complete()).result.success, true);
  assert.deepEqual((await data('health')).findings, initial.findings, 'Restore must recover the original settings');
  assert.equal((await data('backups')).filter(item => item.canRestore).length, 0);
  assert.equal((await call('restore-plan', { backupId: backups[0].id })).ok, false);
  assert.deepEqual(await data('clash-full-backups'), [], 'Demo full backups are isolated from machine backups');
  await data('clash-full-backup');
  const fullSaved = await complete(); assert.equal(fullSaved.result.state, 'backed-up');
  const fullRecords = await data('clash-full-backups'); assert.equal(fullRecords.length, 1); assert.equal(fullRecords[0].complete, true);
  assert.equal('files' in fullRecords[0] || 'binding' in fullRecords[0], false, 'Full backup summaries cannot disclose raw snapshots');
  const fullPlan = await data('clash-full-restore-plan', { backupId: fullRecords[0].id });
  assert.equal(fullPlan.action, 'full-restore'); assert.equal(fullPlan.preview.fileCount, 4);
  assert.equal('expected' in fullPlan || 'backupHash' in fullPlan, false, 'Full restore details stay in the host');
  await data('clash-full-restore', { planId: fullPlan.id }); assert.equal((await complete()).result.state, 'unchanged');
  assert.equal((await call('clash-full-restore', { planId: fullPlan.id })).ok, false, 'Full restore previews are single use');
  for (const request of [
    { command: 'clash-full-backup', path: 'arbitrary-path' }, { command: 'clash-full-backups', options: 1 },
    { command: 'clash-full-restore-plan' }, { command: 'clash-full-restore' },
    { command: 'clash-full-restore-plan', backupId: '../../escape' },
    { command: 'clash-full-restore', planId: 'a'.repeat(32), path: 'arbitrary-path' },
  ]) { const { command, ...fields } = request; assert.equal((await call(command, fields)).ok, false, 'Full backup API accepts only opaque fixed-purpose identifiers'); }
  assert.equal((await call('run-script', { script: 'arbitrary command' })).ok, false);
  for (const command of ['website-timing-status', 'website-timing-start', 'website-timing-stop']) assert.equal((await call(command)).ok, false, 'Removed diagnostic commands must not be available');
  assert.equal((await call('auth-status')).ok, false, 'Activation commands are removed from the host');
  assert.equal((await call('activate', { inviteCode: 'removed' })).ok, false);
  assert.equal((await data('quality-status')).state, 'idle');
  assert.equal((await call('quality-start', { family: 4 })).ok, false, 'Demo must not start external probes');
  assert.equal((await data('quality-stop')).state, 'idle');
  assert.equal((await data('proxy-network-status')).state, 'idle');
  assert.equal((await call('proxy-network-start', { proxyPort: 7897, profile: 'quick', includeSpeed: false })).ok, false, 'Demo must not start proxy network probes');
  assert.equal((await data('proxy-network-stop')).state, 'idle');
  for (const command of ['netquality-status', 'netquality-stop', 'netquality-start']) assert.equal((await call(command)).ok, false, 'Removed VPS commands must be rejected');
  assert.equal((await call('netquality-status', { host: 'fixture-vps' })).ok, false);
  assert.equal((await call('health', { host: 'fixture-vps' })).ok, false);
  for (const fields of [{ proxyPort: 0, profile: 'quick', includeSpeed: false }, { proxyPort: 7897, profile: 'quick', includeSpeed: false, host: 'example.com' }, { proxyPort: 7897, profile: 'quick' }, { proxyPort: 7897, family: 6, profile: 'all', includeSpeed: false }]) assert.equal((await call('proxy-network-start', fields)).ok, false);
  const dnsId = '11111111-2222-4333-8444-555555555555';
  for (const action of ['register', 'round', 'result']) assert.equal((await call('dnsleaktest', { action, queries: [dnsId] })).ok, false, 'Demo must not contact DNSLeakTest control APIs');
  assert.equal((await call('dnsleaktest', { action: 'arbitrary-url', queries: [dnsId] })).ok, false);
  assert.equal((await call('dnsleaktest', { action: 'register', queries: [dnsId], options: 1 })).ok, false);
  assert.equal((await call('health', { action: 'register', queries: [dnsId] })).ok, false, 'DNS fields are exclusive to the DNS command');
  console.log('PASS: demo health → preview → apply → no-op → backup → restore; token reuse and snapshot disclosure checks.');
} finally { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); lines.close(); }

let calls = 0, handler;
const mockBridge = { ready: true, error: '', async call(request) { calls++; return { command: request.command }; } };
const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://localhost').pathname));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port; handler = createLocalApi(mockBridge, port);
const origin = `http://127.0.0.1:${port}`;
try {
  const session = await (await fetch(origin + '/api/session')).json(); assert.equal(session.ready, true);
  const headers = { 'Content-Type': 'application/json', Origin: origin, 'X-BehindRose-Token': session.token };
  async function send(body, extra = {}, method = 'POST') {
    return new Promise((resolve, reject) => {
      const request = http.request(origin + '/api/local', { method, headers: { ...headers, ...extra } }, response => { response.resume(); response.once('end', () => resolve({ status: response.statusCode })); });
      request.once('error', reject); request.end(method === 'POST' ? JSON.stringify(body) : undefined);
    });
  }
  assert.equal((await send({ command: 'health' })).status, 200);
  for (const options of [32, 47, 63, 111]) assert.equal((await send({ command: 'plan', options })).status, 200);
  for (const options of [0, 128, -1, 32.5, '32']) assert.equal((await send({ command: 'plan', options })).status, 400);
  for (const command of ['website-timing-status', 'website-timing-start', 'website-timing-stop']) assert.equal((await send({ command, proxyPort: 7897 })).status, 400);
  assert.equal((await send({ command: 'quality-start', proxyPort: 0 })).status, 200);
  assert.equal((await send({ command: 'quality-start', family: 4, proxyPort: 0 })).status, 400);
  assert.equal((await send({ command: 'proxy-network-status' })).status, 200);
  assert.equal((await send({ command: 'proxy-network-stop' })).status, 200);
  assert.equal((await send({ command: 'proxy-network-start', proxyPort: 7897, profile: 'all', includeSpeed: true })).status, 200);
  for (const command of ['netquality-status', 'netquality-stop', 'netquality-start']) assert.equal((await send({ command })).status, 400, 'Removed VPS commands must not reach the bridge');
  assert.equal((await send({ command: 'netquality-status', host: 'fixture-vps' })).status, 400);
  for (const fields of [{ proxyPort: 0, profile: 'quick', includeSpeed: false }, { proxyPort: 65536, profile: 'quick', includeSpeed: false }, { proxyPort: '7897', profile: 'quick', includeSpeed: false }, { proxyPort: 7897, profile: 'other', includeSpeed: false }, { proxyPort: 7897, profile: 'quick', includeSpeed: 'yes' }, { proxyPort: 7897, profile: 'quick' }, { proxyPort: 7897, profile: 'quick', includeSpeed: false, host: 'example.com' }, { proxyPort: 7897, profile: 'quick', includeSpeed: false, family: 6 }]) assert.equal((await send({ command: 'proxy-network-start', ...fields })).status, 400);
  assert.equal((await send({ command: 'proxy-network-status', proxyPort: 7897 })).status, 400);
  assert.equal((await send({ command: 'health', profile: 'quick' })).status, 400);
  for (const request of [
    { command: 'clash-full-backups' }, { command: 'clash-full-backup' },
    { command: 'clash-full-restore-plan', backupId: 'a'.repeat(32) },
    { command: 'clash-full-restore', planId: 'b'.repeat(32) },
  ]) assert.equal((await send(request)).status, 200, 'Bounded full-backup commands must reach the bridge');
  for (const request of [
    { command: 'clash-full-backup', path: 'arbitrary-path' }, { command: 'clash-full-backups', options: 1 },
    { command: 'clash-full-restore-plan' }, { command: 'clash-full-restore' },
    { command: 'clash-full-restore-plan', backupId: '../../escape' },
    { command: 'clash-full-restore', planId: 'b'.repeat(32), backupId: 'a'.repeat(32) },
  ]) assert.equal((await send(request)).status, 400, 'Full-backup transport cannot accept paths or unexpected fields');
  const dnsId = '11111111-2222-4333-8444-555555555555';
  for (const action of ['register', 'round', 'result']) assert.equal((await send({ command: 'dnsleaktest', action, queries: [dnsId] })).status, 400, 'Retired DNS control endpoint must be rejected');
  for (const request of [
    { command: 'dnsleaktest', action: 'fetch', queries: [dnsId] },
    { command: 'dnsleaktest', action: 'register', queries: [] },
    { command: 'dnsleaktest', action: 'register', queries: Array(7).fill(dnsId) },
    { command: 'dnsleaktest', action: 'register', queries: [dnsId, dnsId] },
    { command: 'dnsleaktest', action: 'register', queries: ['https://attacker.invalid/'] },
    { command: 'dnsleaktest', action: 'register', queries: ['11111111-2222-1333-8444-555555555555'] },
    { command: 'dnsleaktest', action: 'register', queries: ['11111111-2222-4333-7444-555555555555'] },
    { command: 'dnsleaktest', action: 'register', queries: ['AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'] },
    { command: 'dnsleaktest', action: 'register', queries: [dnsId + '\n'] },
    { command: 'dnsleaktest', action: 'register', queries: [dnsId], url: 'https://attacker.invalid/' },
    { command: 'dnsleaktest', action: 'register', queries: [dnsId], options: 1 },
    { command: 'dnsleaktest', action: 'register', queries: [dnsId], family: 4 },
    { command: 'health', action: 'register', queries: [dnsId] },
  ]) assert.equal((await send(request)).status, 400, JSON.stringify(request));
  assert.equal((await send({ command: 'dnsleaktest', action: 'result', queries: [dnsId] }, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await send({ command: 'dnsleaktest', action: 'result', queries: [dnsId] }, { 'X-BehindRose-Token': '' })).status, 403);
  assert.equal((await send({ command: 'quality-start', family: 5 })).status, 400);
  assert.equal((await send({ command: 'quality-start', family: '4' })).status, 400);
  assert.equal((await send({ command: 'quality-start', proxyPort: '7897; echo injected' })).status, 400);
  assert.equal((await send({ command: 'quality-start', proxyPort: 65536 })).status, 400);
  assert.equal((await send({ command: 'quality-start', script: 'anything' })).status, 400);
  assert.equal((await send({ command: 'quality-start', family: 4 }, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await send({ command: 'execute', planId: '1'.repeat(32) }, { Origin: 'https://attacker.invalid' })).status, 403);
  assert.equal((await send({ command: 'health' }, { Origin: `http://127.0.0.1:${port + 1}` })).status, 403);
  assert.equal((await send({ command: 'health' }, { 'X-BehindRose-Token': '' })).status, 403);
  assert.equal((await send({ command: 'health' }, { 'X-BehindRose-Token': 'é'.repeat(64) })).status, 403);
  assert.equal((await send({ command: 'health' }, { Host: 'attacker.invalid' })).status, 403);
  assert.equal((await send({ command: 'execute', planId: '../../anything' })).status, 400);
  assert.equal((await send({ command: 'health', executable: 'cmd.exe' })).status, 400);
  assert.equal((await send({ command: 'auth-status' })).status, 400);
  assert.equal((await send({ command: 'activate', inviteCode: 'removed' })).status, 400);
  assert.equal((await send({ command: 'health', inviteCode: 'removed' })).status, 400);
  assert.equal((await send({ command: 'plan', options: 128 })).status, 400);
  assert.equal((await send({ command: 'execute' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await send({}, {}, 'OPTIONS')).status, 405);
  assert.equal((await send({ command: 'health', extra: 'x'.repeat(5000) })).status, 413);
  assert.equal((await fetch(origin + '/api/session', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal(calls, 13, 'Only valid bounded commands reach the local host; retired VPS/DNS commands and unknown option bits are rejected');
  console.log('PASS: loopback Host/Origin, CSRF token, preflight, content type, body size and command allowlist boundaries.');
} finally { await new Promise(resolve => server.close(resolve)); }
