import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { launchCaptureBrowser } from '../scripts/browser-runtime.mjs';
const browser = await launchCaptureBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
const base = process.env.BEHINDROSE_TEST_URL || 'http://127.0.0.1:4317/';
const idle = { state: 'idle', id: null, proxyPort: 7897, profile: 'quick', includeSpeed: false, stage: '尚未开始', current: 0, total: 0, startedAt: null, finishedAt: null, report: null, error: null };
const fixture = { version: 'UI-test-fixture', scope: 'UI 自动化样本。当前电脑 → 本机 HTTP 代理 → 目标；不是 VPS 回程。', identity: { ip: '203.0.113.42', prefix: '203.0.113.0/24', asns: ['64500','64501'], holder: '<script>window.injected=true</script>', error: null }, finalIp: null, exitChanged: null, latencies: [
  { region: '北京', carrier: '电信', host: 'bj-ct-v4.ip.zstaticcdn.com', port: 80, samples: [0,null,0], averageMs: 0, minimumMs: 0, jitterMs: null, failurePercent: 33.3, error: null },
  { region: '北京', carrier: '联通', host: 'bj-cu-v4.ip.zstaticcdn.com', port: 80, samples: [null,null,null], averageMs: null, minimumMs: null, jitterMs: null, failurePercent: 100, error: '未取得连接确认' },
  { region: '上海', carrier: '移动', host: 'sh-cm-v4.ip.zstaticcdn.com', port: 80, samples: [90,100,110], averageMs: 100, minimumMs: 90, jitterMs: 10, failurePercent: 0, error: null },
  { region: '国际服务', carrier: 'Cloudflare', host: 'speed.cloudflare.com', port: 443, samples: [210,220,230], averageMs: 220, minimumMs: 210, jitterMs: 10, failurePercent: 0, error: null }
], transfers: [{ name: '中国大陆 · 中科大镜像', url: 'https://mirrors.ustc.edu.cn/ubuntu/ls-lR.gz', direction: 'download', bytes: 0, seconds: 2, mbps: null, error: '测速未完成' }, { name: 'Cloudflare · 就近边缘', url: 'https://speed.cloudflare.com/__up', direction: 'upload', bytes: 4194304, seconds: 1, mbps: 33.55, error: null }] };
let status = { ...idle };
const commands = [], errors = [], external = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { window.__clipboard = ''; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.__clipboard = value; } } }); });
await page.route('https://**/*', route => { external.push(route.request().url()); return route.abort(); });
await page.route('**/api/session', route => route.fulfill({ json: { ready: true, token: 'test' } }));
await page.route('**/api/local', async route => {
  const request = route.request().postDataJSON(); commands.push(request);
  if (request.command.startsWith('quality-')) return route.fulfill({ json: { data: { ...idle, family: 4, route: 'default' } } });
  if (request.command === 'proxy-network-start') status = { ...idle, ...request, state: 'running', id: 'fixture-job', stage: '检测节点连接', current: 5, total: 105, startedAt: '2026-10-16T02:00:00Z', report: fixture };
  if (request.command === 'proxy-network-stop') status = { ...status, state: 'cancelled', stage: '已停止，保留已取得的结果' };
  await route.fulfill({ json: { data: status } });
});
try {
  await page.goto(new URL('network#proxy-network', base).href);
  const section = page.locator('#proxy-network');
  await expect(section).toHaveAttribute('data-state', 'idle');
  assert.equal(commands.filter(item => item.command === 'proxy-network-start').length, 0);
  await page.getByRole('link', { name: '代理网络', exact: true }).click();
  await page.getByRole('textbox', { name: '网络检测代理端口' }).fill('0');
  await page.getByRole('button', { name: '开始网络检测', exact: true }).click();
  await expect(section.locator('.proxy-message')).toContainText('1–65535');
  assert.equal(commands.filter(item => item.command === 'proxy-network-start').length, 0);
  await page.getByRole('textbox', { name: '网络检测代理端口' }).fill('7897');
  await page.getByRole('combobox', { name: '代理网络检测范围' }).selectOption('all');
  await section.getByRole('checkbox').check();
  await page.getByRole('button', { name: '开始网络检测', exact: true }).click();
  await expect(section).toHaveAttribute('data-state', 'running');
  assert.deepEqual(commands.find(item => item.command === 'proxy-network-start'), { command: 'proxy-network-start', proxyPort: 7897, profile: 'all', includeSpeed: true });
  await expect(section.getByRole('textbox')).toBeDisabled();
  await expect(section.locator('.proxy-metrics')).toContainText('AS64500 · AS64501');
  await expect(section.locator('.proxy-metrics')).toContainText('<script>');
  assert.equal(await page.evaluate(() => window.injected), undefined);
  await expect(section.locator('.proxy-matrix tbody tr').first()).toContainText('0 ms');
  await expect(section.locator('.proxy-matrix tbody tr').first()).toContainText('失败 100%');
  await section.getByRole('tab', { name: '三网连接', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(section.getByRole('tab', { name: '国际服务', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(section.getByRole('tab', { name: '检测范围', exact: true })).toHaveAttribute('aria-selected', 'true');
  await section.getByRole('tab', { name: '国际服务', exact: true }).click();
  await expect(section.locator('.proxy-global')).toContainText('220');
  await section.getByRole('tab', { name: '下载 / 上传', exact: true }).click();
  await expect(section.locator('.proxy-speed-table')).toContainText('33.6');
  await expect(section.locator('.proxy-speed-table')).toContainText('测速未完成');
  await section.getByRole('button', { name: '复制网络报告', exact: true }).click();
  assert.match(await page.evaluate(() => window.__clipboard), /不是 ICMP\/TCP 大包/);
  await section.getByRole('button', { name: 'JSON', exact: true }).click();
  assert.equal(JSON.parse(await page.evaluate(() => window.__clipboard)).report.latencies[0].averageMs, 0);
  await section.getByRole('button', { name: '停止网络检测', exact: true }).click();
  await expect(section).toHaveAttribute('data-state', 'cancelled');
  await page.reload();
  await expect(section).toHaveAttribute('data-state', 'cancelled');
  await expect(section.getByRole('combobox')).toHaveValue('all');
  await expect(section.getByRole('checkbox')).toBeChecked();
  status = { ...status, state: 'complete', stage: '检测完成 · UI 自动化样本', finishedAt: '2026-10-16T02:01:00Z', report: { ...fixture, finalIp: '198.51.100.7', exitChanged: true } };
  await expect(section).toHaveAttribute('data-state', 'complete');
  await expect(section.locator('.proxy-warning')).toContainText('198.51.100.7');
  const evidence = new URL('../../docs/proxy-network-check/', import.meta.url);
  await mkdir(evidence, { recursive: true });
  await section.screenshot({ path: new URL('fixture-desktop.png', evidence).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflows on mobile');
  await section.screenshot({ path: new URL('fixture-mobile.png', evidence).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  await section.getByRole('tab', { name: '检测范围', exact: true }).click();
  await expect(section.locator('.proxy-scope')).toContainText('需在 VPS 内检测');
  assert.deepEqual(errors, []); assert.deepEqual(external, [], 'Viewing, restoring, and copying must not start external probes');
  console.log('PASS: proxy network start/stop/restore, port bounds, partial evidence, zero/nulls, escaping, scope, IP change, export and mobile. Screenshots are fixtures.');
  const nativePage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  nativePage.on('pageerror', error => errors.push(error.message));
  await nativePage.route('https://**/*', route => route.abort());
  await nativePage.addInitScript(({ idle, fixture }) => {
    const listeners = []; let nativeState = { ...idle };
    window.__nativeProxyCalls = [];
    window.chrome = { webview: {
      addEventListener(name, listener) { if (name === 'message') { listeners.push(listener); setTimeout(() => listener({ data: { kind: 'epoch', epoch: 'fixture-epoch' } }), 0); } },
      postMessage(message) {
        if (message.kind === 'quality') { listeners.forEach(listener => listener({ data: { kind: 'quality-response', requestId: message.requestId, data: { ...idle, family: 4, route: 'default' } } })); return; }
        if (message.kind !== 'proxy-network') return;
        window.__nativeProxyCalls.push(message);
        if (message.action === 'proxy-network-start') nativeState = { ...idle, ...message, state: 'running', id: 'native-fixture', report: fixture };
        if (message.action === 'proxy-network-stop') nativeState = { ...nativeState, state: 'cancelled' };
        listeners.forEach(listener => listener({ data: { kind: 'proxy-network-response', requestId: message.requestId, data: nativeState } }));
      }
    } };
  }, { idle, fixture });
  await nativePage.goto(new URL('network#proxy-network', base).href);
  const nativeSection = nativePage.locator('#proxy-network');
  await expect(nativeSection).toHaveAttribute('data-state', 'idle');
  await nativeSection.getByRole('button', { name: '开始网络检测', exact: true }).click();
  await expect(nativeSection).toHaveAttribute('data-state', 'running');
  await expect(nativeSection.locator('.proxy-metrics')).toContainText('203.0.113.42');
  const nativeStart = await nativePage.evaluate(() => window.__nativeProxyCalls.find(item => item.action === 'proxy-network-start'));
  assert.equal(nativeStart.epoch, 'fixture-epoch'); assert.equal(nativeStart.proxyPort, 7897);
  await nativeSection.getByRole('button', { name: '停止网络检测', exact: true }).click();
  await expect(nativeSection).toHaveAttribute('data-state', 'cancelled');
  assert.deepEqual(errors, []);
  await nativePage.close();
  console.log('PASS: desktop WebView epoch, bounded message fields and start/stop responses.');
} finally { await browser.close(); }
