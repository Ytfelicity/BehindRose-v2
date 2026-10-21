// Historical filename retained; validates the current IPPure host without public requests.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { testRuntime, projectRoot } from '../scripts/test-runtime.mjs';
const { dotnet, hostDll } = testRuntime();
const child = spawn(dotnet, [hostDll, '--stdio'], { cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
child.once('error', error => { throw error; });
const pending = new Map(), lines = createInterface({ input: child.stdout });
lines.on('line', line => { const result = JSON.parse(line); pending.get(result.id)?.(result); pending.delete(result.id); });
const exited = new Promise(resolve => child.once('exit', resolve));
function call(command, fields = {}) {
  assert.ok(['quality-status', 'quality-start', 'quality-stop'].includes(command));
  const id = randomUUID().replaceAll('-', '');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Host timeout')), 10000);
    pending.set(id, value => { clearTimeout(timer); resolve(value); });
    child.stdin.write(JSON.stringify({ id, command, ...fields }) + '\n');
  });
}
try {
  const before = (await call('quality-status')).data;
  assert.equal(before.state, 'idle'); assert.equal(before.total, 1);
  // All rejected before a browser/HTTP request can start.
  for (const fields of [{}, { family: 4, proxyPort: 7897 }, { proxyPort: -1 }, { proxyPort: 65536 }, { proxyPort: '7897' }, { proxyPort: 7897, url: 'https://attacker.invalid/' }]) assert.equal((await call('quality-start', fields)).ok, false, JSON.stringify(fields));
  assert.equal((await call('quality-stop')).data.state, 'idle');
  assert.equal((await call('quality-status')).data.id, null);
  console.log('PASS: IPPure ordinary-user host rejects invalid parameters and arbitrary destinations before any network query. No Docker or configuration commands.');
} finally { child.stdin.end(); await exited; lines.close(); }
