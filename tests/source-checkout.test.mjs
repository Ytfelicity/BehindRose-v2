import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testRuntime } from '../scripts/test-runtime.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await realpath(os.tmpdir());
const temporary = await mkdtemp(path.join(temporaryRoot, 'behindrose-checkout-'));
const repository = path.join(temporary, 'repository'), checkout = path.join(temporary, 'checkout');
const run = (command, args, cwd = repository) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `${command} failed: ${result.error?.message || result.stdout + result.stderr}`);
  return result.stdout;
};
try {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: project, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(!files.some(file => file.startsWith('frontend/reactbits-registry/')), 'Raw component registries must be excluded.');
  await mkdir(repository);
  for (const file of files) {
    const destination = path.resolve(repository, file);
    assert.ok(destination.startsWith(repository + path.sep));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(project, file), destination);
  }
  run('git', ['init', '--quiet']);
  run('git', ['config', 'core.autocrlf', 'true']);
  run('git', ['add', '--all']);
  run(process.execPath, ['scripts/check-public-source.mjs', '--staged']);
  run('git', ['checkout-index', '--all', '--prefix=' + checkout.replaceAll('\\', '/') + '/']);
  run(process.execPath, ['scripts/check-public-source.mjs'], checkout);
  for (const file of files.filter(file => /^(vendor\/MyIP\/|frontend\/src\/vendor\/|frontend\/src\/components\/reactbits\/)/.test(file) || ['licenses/react-bits-LICENSE.md', 'licenses/GSAP-NOTICE.txt'].includes(file)))
    assert.deepEqual(await readFile(path.join(checkout, file)), await readFile(path.join(project, file)), 'Pinned bytes changed during checkout: ' + file);
  for (const script of ['vendor-myip-connectivity.mjs', 'vendor-myip-dns.mjs', 'vendor-myip-webrtc.mjs', 'verify-reactbits-source.mjs'])
    run(process.execPath, ['frontend/scripts/' + script], checkout);
  assert.equal(testRuntime({}, checkout).dotnet, 'dotnet', 'A clean checkout must fall back to PATH.');
  assert.ok(testRuntime({}, checkout).hostDll.includes('Release'));
  assert.equal(testRuntime({ BEHINDROSE_TEST_DOTNET: 'custom-dotnet' }, checkout).dotnet, 'custom-dotnet');
  console.log('PASS: full source checkout with core.autocrlf=true; indexed/exported license checks, pinned upstream bytes, generators, component provenance and portable test SDK selection.');
} finally {
  const resolved = await realpath(temporary);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('behindrose-checkout-')) throw Error('Refusing unexpected test cleanup path');
  await rm(resolved, { recursive: true, force: true });
}
