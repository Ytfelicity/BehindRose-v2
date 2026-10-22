import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { createLocalApi } from '../../scripts/local-api.mjs';
import { launchCaptureBrowser } from './browser-runtime.mjs';

// Run from any directory: node frontend/scripts/capture-readme.mjs
// Uses the real current UI and configuration core. The host is always --demo;
// there are no API fixtures, injected scripts or edits to the rendered DOM.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assets = path.join(root, 'src/BehindRose.Desktop/Assets');
const output = path.join(root, 'docs/images/screenshots');
const hostOutput = path.join(root, 'artifacts/readme-capture-host');
const hostDll = path.join(hostOutput, 'BehindRose.DevHost.dll');
const localSdk = path.resolve(root, '../tools/dotnet10/dotnet.exe');
const dotnet = process.env.BEHINDROSE_TEST_DOTNET || (existsSync(localSdk) ? localSdk : 'dotnet');
const env = { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' };
if (dotnet === localSdk) env.DOTNET_ROOT = path.dirname(localSdk);
for (const argument of process.argv.slice(2)) assert.equal(argument, '--no-build', 'Only --no-build is supported.');

async function run(args) {
  const child = spawn(dotnet, args, { cwd: root, env, windowsHide: true, stdio: 'inherit' });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error(`Capture host preparation failed (${code}).`)));
  });
}
if (!process.argv.includes('--no-build')) {
  const project = path.join(root, 'src/BehindRose.DevHost/BehindRose.DevHost.csproj');
  await run(['restore', project, '--locked-mode', '--ignore-failed-sources']);
  await run(['build', project, '-c', 'Release', '--no-restore', '--output', hostOutput]);
}
assert.ok(existsSync(hostDll), 'Build the isolated capture host before using --no-build.');

class DemoBridge {
  ready = false;
  error = '';
  pending = new Map();
  commands = [];
  constructor() {
    this.child = spawn(dotnet, [hostDll, '--demo'], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
    this.exited = new Promise(resolve => this.child.once('exit', resolve));
    this.child.once('error', error => this.fail(error));
    this.child.once('exit', () => this.fail(Error('The in-memory capture host stopped.')));
    this.child.stdin.on('error', error => this.fail(error));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let reply;
      try { reply = JSON.parse(line); } catch { this.fail(Error('Invalid capture host response.')); return; }
      const request = this.pending.get(reply.id);
      if (!request) return;
      this.pending.delete(reply.id); clearTimeout(request.timer);
      reply.ok ? request.resolve(reply.data) : request.reject(Error(reply.error));
    });
  }
  fail(error) {
    this.ready = false;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
  call(request) {
    this.commands.push(request.command);
    const id = randomUUID().replaceAll('-', '');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('Capture host response timed out.')); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
    });
  }
  async close() {
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 5000);
    await this.exited; clearTimeout(timer); this.lines.close();
  }
}

const files = new Map([
  ['/', ['workbench/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['workbench/index.html', 'text/html; charset=utf-8']],
  ['/workbench.css', ['workbench/workbench.css', 'text/css']],
  ['/workbench.js', ['workbench/workbench.js', 'text/javascript']],
  ['/beui.js', ['workbench/beui.js', 'text/javascript']],
  ['/beui.css', ['diagnostics/beui.css', 'text/css']],
  ['/console.css', ['workbench/console.css', 'text/css']],
  ['/brand-logo.png', ['workbench/brand-logo.png', 'image/png']],
  ['/support-qr.png', ['workbench/support-qr.png', 'image/png']],
  ['/network', ['diagnostics/index.html', 'text/html; charset=utf-8']],
  ['/network-ui.js', ['diagnostics/network-ui.js', 'text/javascript']],
  ['/network-console.css', ['diagnostics/network-console.css', 'text/css']],
  ['/diagnostics.css', ['diagnostics/diagnostics.css', 'text/css']],
  ['/diagnostics.js', ['diagnostics/diagnostics.js', 'text/javascript']],
  ['/diagnostics-core.js', ['diagnostics/diagnostics-core.js', 'text/javascript']],
  ['/flag-codes.js', ['diagnostics/flag-codes.js', 'text/javascript']],
  ['/country-lookup.js', ['diagnostics/country-lookup.js', 'text/javascript']],
  ['/country-db/country4.bin', ['diagnostics/country-db/country4.bin', 'application/octet-stream']],
  ['/country-db/country6.bin', ['diagnostics/country-db/country6.bin', 'application/octet-stream']],
  ['/icons.svg', ['diagnostics/icons.svg', 'image/svg+xml']],
  ['/avatar.png', ['avatar-source.png', 'image/png']],
]);
const bridge = new DemoBridge();
let browser, server;
try {
  const initialHealth = await bridge.call({ command: 'health' });
  assert.equal(initialHealth.demo, true, 'Capture must use the real in-memory demo core.');
  assert.deepEqual(await bridge.call({ command: 'backups' }), []);
  bridge.ready = true;
  let api;
  server = http.createServer(async (req, res) => {
    try {
      const origin = `http://${req.headers.host}`;
      const url = new URL(req.url, origin);
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost) { res.writeHead(403); res.end(); return; }
      if (url.pathname.startsWith('/api/')) { await api(req, res, url.pathname); return; }
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      let asset = files.get(url.pathname);
      if (/^\/(flags\/[a-z]{2}\.svg|service-icons\/[a-z-]+\.svg)$/.test(url.pathname))
        asset = ['diagnostics' + url.pathname, 'image/svg+xml'];
      if (/^\/fonts\/(figtree-latin-(400|500|600|700)-normal|eb-garamond-latin-400-normal)\.woff2$/.test(url.pathname))
        asset = ['diagnostics' + url.pathname, 'font/woff2'];
      if (!asset) { res.writeHead(404); res.end(); return; }
      const bytes = await readFile(path.join(assets, asset[0]));
      res.writeHead(200, {
        'Content-Type': asset[1], 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
      });
      res.end(bytes);
    } catch { res.writeHead(500); res.end('Capture asset could not be read.'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  api = createLocalApi(bridge, server.address().port);
  browser = await launchCaptureBrowser();
  const viewport = { width: 1440, height: 1280 };
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const errors = [], externalRequests = [], failedLocalResponses = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    externalRequests.push(route.request().resourceType());
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === origin) failedLocalResponses.push(new URL(response.url()).pathname); });
  const frame = page.frameLocator('#network-frame');
  await mkdir(output, { recursive: true });
  const captures = [];
  async function capture(name) {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700); // Let the real sidebar spring and iframe resize finish.
    await page.mouse.move(viewport.width - 2, viewport.height - 2);
    await page.screenshot({ path: path.join(output, name), animations: 'disabled' });
    captures.push(name);
  }
  await page.goto(origin + '/#browser-network');
  await expect(frame.locator('#start')).toBeEnabled();
  await expect(frame.locator('#ip4-address')).toHaveText('—');
  await expect(frame.locator('#stop')).toBeDisabled();
  await capture('network.png');

  await page.locator('#sidebar-ui a[href="#overview"]').click();
  await expect(page.locator('#protect-now')).toBeEnabled();
  await expect(page.locator('#health-kicker')).toHaveText('演示状态');
  await capture('configuration.png');

  await page.locator('#protect-now').click();
  await expect(page.locator('#protection-dialog')).toBeVisible();
  await expect(page.locator('#quick-review .change')).toHaveCount(6);
  await expect(page.locator('#protection-dialog .execute-plan')).toBeDisabled();
  await capture('configuration-preview.png');

  await page.locator('#protection-dialog .review-confirm').check();
  await page.locator('#protection-dialog .execute-plan').click();
  await expect(page.locator('#protection-dialog')).not.toBeVisible();
  await expect(page.locator('#operation-title')).toHaveText('防护配置已就绪');
  await page.locator('#sidebar-ui a[href="#backups"]').click();
  await expect(page.locator('#backup-list [data-restore]')).toHaveCount(1);
  await capture('restore.png');

  const finalHealth = await bridge.call({ command: 'health' });
  const backups = await bridge.call({ command: 'backups' });
  assert.equal(finalHealth.demo, true);
  assert.equal(backups.length, 1);
  assert.equal(backups[0].canRestore, true);
  assert.ok(finalHealth.findings.every(finding => finding.state === '已配置'));
  assert.equal(finalHealth.clashIpv6.state, '已关闭');
  assert.equal(bridge.commands.filter(command => command === 'execute').length, 1);
  assert.ok(!bridge.commands.some(command => /^(quality-start|proxy-network-start|open-clash)$/.test(command)));
  assert.deepEqual(errors, [], 'The current UI must render without page errors.');
  assert.deepEqual(externalRequests, [], 'Capture must not attempt any non-local HTTP request.');
  assert.deepEqual(failedLocalResponses, [], 'Every requested current UI asset must load.');
  const sources = {};
  for (const name of ['workbench/index.html', 'workbench/beui.js', 'workbench/workbench.js', 'diagnostics/index.html', 'diagnostics/network-ui.js', 'diagnostics/diagnostics.js'])
    sources[name] = createHash('sha256').update((await readFile(path.join(assets, name), 'utf8')).replaceAll('\r\n', '\n')).digest('hex');
  const props = await readFile(path.join(root, 'Directory.Build.props'), 'utf8');
  const provenance = {
    capturedAt: new Date().toISOString(), channel: 'checked-out application source',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
    version: /<ReleaseVersion\b[^>]*>([^<]+)<\/ReleaseVersion>/.exec(props)?.[1] ?? /<Version>([^<]+)<\/Version>/.exec(props)?.[1],
    interface: 'Unmodified current application assets rendered by Chromium',
    configuration: 'Real DevHost --demo; in-memory example configuration and backup',
    network: 'Not started; non-local HTTP requests blocked',
    viewport, screenshots: captures,
    checks: { pageErrors: 0, externalRequests: 0, failedLocalResponses: 0, inMemoryApplications: 1, restorableExampleBackups: 1 },
    sourceHashNormalization: 'UTF-8 text with LF line endings', sourceSha256: sources,
  };
  await writeFile(path.join(output, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
  console.log('README capture passed: four real UI screenshots, one in-memory application and backup, no external requests or page errors.');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await bridge.close();
}
