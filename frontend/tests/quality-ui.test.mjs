import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { launchCaptureBrowser } from '../scripts/browser-runtime.mjs';
const browser = await launchCaptureBrowser();
const page = await browser.newPage({ viewport: { width: 1200, height: 950 }, reducedMotion: 'reduce' });
const errors = [], commands = [], external = [];
const endpoint = 'https://my.ippure.com/v1/info';
const sample = { ip: '203.0.113.42', asn: 64500, asOrganization: '<script>window.bad=true</script>', country: 'Japan', countryCode: 'JP', city: 'Tokyo', fraudScore: 0, isResidential: false, isBroadcast: false };
const report = (data, proxy = true) => ({ Source: 'IPPure', Endpoint: endpoint, Head: { IP: data.ip, Time: new Date().toISOString(), Family: data.ip.includes(':') ? 6 : 4, Proxy: proxy }, Data: data });
let mode = 'success';
let status = { state: 'idle', id: null, family: 4, route: 'proxy', stage: '尚未开始', current: 0, total: 1, startedAt: null, finishedAt: null, report: null, error: null };
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => { window.RTCPeerConnection = undefined; window.__clipboard = ''; Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => window.__clipboard = text } }); });
await page.route('https://**/*', route => { external.push(route.request().url()); return route.abort(); });
await page.route('**/api/session', route => route.fulfill({ json: { ready: true, token: 'test-session' } }));
await page.route('**/api/local', async route => {
  const request = route.request().postDataJSON(); commands.push(request);
  assert.ok(['quality-status', 'quality-start', 'quality-stop', 'quality-proxies'].includes(request.command), 'Only simulated quality commands are allowed');
  if (request.command === 'quality-proxies') return route.fulfill({ json: { data: { candidates: [{ port: 7897, sources: ['模拟 HTTP 配置'], loopbackOnly: true }, { port: 10809, sources: ['模拟混合配置'], loopbackOnly: true }], notes: [] } } });
  if (request.command === 'quality-start') {
    assert.deepEqual(Object.keys(request).sort(), ['command', 'proxyPort']);
    status = { ...status, state: mode === 'hold' ? 'running' : mode === 'error' ? 'failed' : 'complete', id: 'proxy-fixture', proxyPort: request.proxyPort, route: request.proxyPort ? 'proxy' : 'default', startedAt: new Date().toISOString(), stage: mode === 'error' ? '本次未取得 IPPure 结果' : 'IPPure 查询', report: mode === 'success' ? report(sample, !!request.proxyPort) : null, error: mode === 'error' ? 'IPPure 要求网站验证' : null };
  }
  if (request.command === 'quality-stop') status = { ...status, state: 'cancelled', stage: '已停止体检' };
  return route.fulfill({ json: { data: status } });
});
try {
  await page.goto('http://127.0.0.1:4317/network#ip-quality');
  const section = page.locator('#ip-quality');
  await expect(section).toHaveAttribute('data-state', 'idle');
  await expect(page.getByRole('combobox', { name: '体检出口' })).toHaveValue('proxy');
  await expect(page.getByRole('combobox', { name: '检测代理端口' })).toHaveValue('');
  await expect(page.getByRole('button', { name: '开始质量体检', exact: true })).toBeDisabled();
  await page.getByRole('combobox', { name: '检测代理端口' }).selectOption('10809');
  await page.getByRole('button', { name: '开始质量体检', exact: true }).click();
  await expect(section).toHaveAttribute('data-state', 'complete');
  assert.equal(commands.find(c => c.command === 'quality-start').proxyPort, 10809);
  await expect(page.locator('.ippure-score')).toHaveText('0%');
  await expect(page.locator('.ippure-risk-label')).toHaveText('极度纯净');
  await expect(page.locator('.ippure-classifications')).toContainText('机房 IP');
  await expect(page.locator('.ippure-classifications')).toContainText('原生 IP');
  await expect(page.locator('.quality-facts')).toContainText('<script>');
  assert.equal(await page.evaluate(() => window.bad), undefined);
  await page.getByRole('button', { name: '复制 JSON', exact: true }).click();
  const copied = JSON.parse(await page.evaluate(() => window.__clipboard));
  assert.equal(copied.report.Data.fraudScore, 0); assert.equal(copied.report.Data.isResidential, false);
  const starts = commands.filter(c => c.command === 'quality-start').length;
  await page.reload(); await expect(section).toHaveAttribute('data-state', 'complete');
  await expect(page.getByRole('combobox', { name: '检测代理端口' })).toHaveValue('10809');
  assert.equal(commands.filter(c => c.command === 'quality-start').length, starts, 'Refresh only restores');
  mode = 'error';
  await page.getByRole('button', { name: '重新质量体检', exact: true }).click();
  await expect(section).toHaveAttribute('data-state', 'failed');
  await expect(page.locator('.quality-message')).toContainText('网站验证');
  await expect(page.locator('.ippure-score')).toHaveCount(0);
  mode = 'hold';
  await page.getByRole('button', { name: '开始质量体检', exact: true }).click();
  await expect(section).toHaveAttribute('data-state', 'running');
  await page.getByRole('button', { name: '停止体检', exact: true }).click();
  await expect(section).toHaveAttribute('data-state', 'cancelled');
  await page.getByRole('combobox', { name: '检测代理端口' }).selectOption('manual');
  await page.getByRole('textbox', { name: '本机 HTTP 代理端口' }).fill('99999');
  const beforeInvalid = commands.filter(c => c.command === 'quality-start').length;
  await page.getByRole('button', { name: '开始质量体检', exact: true }).click();
  await expect(page.locator('.quality-message')).toContainText('1–65535');
  assert.equal(commands.filter(c => c.command === 'quality-start').length, beforeInvalid);
  mode = 'success';
  await page.getByRole('combobox', { name: '体检出口' }).selectOption('default');
  await page.getByRole('button', { name: '开始质量体检', exact: true }).click();
  await expect(section).toHaveAttribute('data-state', 'complete');
  assert.equal(commands.filter(c => c.command === 'quality-start').at(-1).proxyPort, 0);
  await page.locator('#ip4-address').evaluate(element => { element.textContent = '198.51.100.7'; });
  await expect(page.locator('.quality-mismatch')).toBeVisible();
  status = { ...status, family: 6, report: report({ ip: '2001:0db8:0:0:0:0:0:1', fraudScore: 88, isResidential: null }, false) };
  await expect(page.locator('.ippure-score')).toHaveText('—');
  await expect(page.locator('.ippure-risk-label')).toHaveText('IPv6 不计算风险系数');
  await expect(page.locator('.ippure-classifications')).toContainText('未知');
  await page.locator('#ip6-address').evaluate(element => { element.textContent = '2001:db8::1'; });
  await expect(page.locator('.quality-mismatch')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile report overflow');
  assert.deepEqual(external, [], 'Frontend never makes a cross-origin provider request');
  assert.deepEqual(errors, []);
  const nativePage = await browser.newPage();
  await nativePage.route('https://**/*', route => route.abort());
  await nativePage.addInitScript(({ fixture, url }) => {
    const listeners = []; window.__qualityMessages = [];
    let state = { state: 'idle', id: null, family: 4, route: 'proxy', stage: '尚未开始', total: 1, current: 0, report: null, error: null };
    window.chrome = { webview: {
      addEventListener(_, listener) { listeners.push(listener); queueMicrotask(() => listener({ data: { kind: 'epoch', epoch: 'a'.repeat(32) } })); },
      postMessage(message) {
        window.__qualityMessages.push(message);
        if (message.kind !== 'quality') return;
        if (message.action === 'quality-start') state = { ...state, state: 'complete', id: 'native-fixture', proxyPort: message.proxyPort, report: { Source: 'IPPure', Endpoint: url, Head: { IP: fixture.ip, Family: 4, Proxy: true, Time: new Date().toISOString() }, Data: fixture } };
        const data = message.action === 'quality-proxies' ? { candidates: [{ port: 10809, sources: ['模拟端口'], loopbackOnly: true }], notes: [] } : state;
        queueMicrotask(() => listeners.forEach(listener => listener({ data: { kind: 'quality-response', requestId: message.requestId, data } })));
      }
    } };
  }, { fixture: sample, url: endpoint });
  await nativePage.goto('http://127.0.0.1:4317/network#ip-quality');
  await expect(nativePage.getByRole('combobox', { name: '检测代理端口' })).toHaveValue('10809');
  await nativePage.getByRole('button', { name: '开始质量体检', exact: true }).click();
  await expect(nativePage.locator('.ippure-score')).toHaveText('0%');
  const sent = await nativePage.evaluate(() => window.__qualityMessages.find(message => message.action === 'quality-start'));
  assert.equal(sent.proxyPort, 10809); assert.equal(sent.epoch, 'a'.repeat(32)); assert.equal(sent.family, undefined);
  console.log('PASS: IPPure local/native bridges, exact proxy selection, default network, zero/false/null, verification, stop/restore, IPv6, escaped metadata and mobile. No real provider requests.');
} finally { await browser.close(); }
