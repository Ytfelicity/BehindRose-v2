import assert from 'node:assert/strict';
import { expect as baseExpect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launchCaptureBrowser } from '../scripts/browser-runtime.mjs';
const expect = baseExpect.configure({ timeout: 20000 });
const testBaseURL = new URL(process.env.BEHINDROSE_TEST_URL || 'http://127.0.0.1:4317/');
const upstreamBuilt = await build({ entryPoints: ['../vendor/MyIP/frontend/data/connectivity-import-lists.js'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { IMPORT_LISTS } = await import('data:text/javascript;base64,' + Buffer.from(upstreamBuilt.outputFiles[0].text).toString('base64'));
const officialAIUrls = IMPORT_LISTS.find(list => list.id === 'ai').members.map(target => target.url);
const browser = await launchCaptureBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const requests = [], errors = []; let delayed = false, slowSamples = false;
await page.addInitScript(() => {
  window.__nativeMessages = []; window.chrome ||= {};
  window.chrome.webview = { postMessage: message => window.__nativeMessages.push(message), addEventListener: () => {} };
  window.__clipboard = '';
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.__clipboard = text; } } });
  window.__rtcAttempts = 0;
  window.RTCPeerConnection = class { constructor() { window.__rtcAttempts++; } };
});
page.on('pageerror', error => errors.push(error.message));
// Playwright treats every /favicon.ico URL as a browser favicon and silently
// aborts it when page.route is enabled. CDP intercepts the real Fetch requests
// before that filter, so the test keeps the exact upstream probe URLs.
const cdp = await page.context().newCDPSession(page);
cdp.on('Fetch.requestPaused', async ({ requestId, request }) => {
  const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]));
  requests.push({ url: request.url, method: request.method, headers });
  assert.equal(request.method, 'GET', 'Connectivity must use the IPCheck.ing / MyIP GET probe');
  if (delayed) await new Promise(resolve => setTimeout(resolve, 300));
  // One slow sample must not downgrade the best-of-ten result, but its bar
  // must still expose the real delay independently of the summary's color.
  if (slowSamples && requests.filter(entry => entry.url === request.url).length === 1) {
    if (request.url.includes('chatgpt')) await new Promise(resolve => setTimeout(resolve, 1100));
    if (request.url.includes('claude')) await new Promise(resolve => setTimeout(resolve, 260));
  }
  if (request.url.includes('midjourney')) return cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }).catch(() => {});
  // A 403 opaque response is still a response, never evidence of account access.
  await cdp.send('Fetch.fulfillRequest', {
    requestId, responseCode: request.url.includes('chatgpt') ? 403 : 200,
    responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
    body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=',
  }).catch(() => {});
});
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*', requestStage: 'Request' }] });
async function browserAction(id) {
  await page.goto(new URL('/network#browser-network', testBaseURL).href);
  await page.locator('#' + id).click();
  await page.goto(new URL('/network#connectivity', testBaseURL).href);
}
try {
  const response = await page.goto(new URL('/network#connectivity', testBaseURL).href);
  assert.match(response.headers()['content-security-policy'], /connect-src 'self' https:/);
  await expect(page.locator('body')).toHaveClass(/\bdashboard4\b/);
  await expect(page.locator('.dashboard-network-header h2')).toHaveText('浏览器网络');
  await expect(page.locator('.dashboard-metrics .dashboard-metric')).toHaveCount(4);
  await expect(page.locator('#ip4-address')).toHaveText('—');
  await expect(page.locator('#ip6-address')).toHaveText('—');
  await expect(page.locator('#dns-overview-count')).toContainText('—');
  await expect(page.locator('#rtc-overview-count')).toHaveText('—');
  const section = page.locator('#connectivity');
  await expect(section.locator('.connectivity-summary small')).toContainText('每站 10 次');
  await expect(section.getByRole('combobox', { name: '采样方式' })).toHaveValue('10');
  await expect(section.getByRole('combobox', { name: '采样方式' }).locator('option[value="3"]')).toHaveCount(0);
  await expect(section.getByText('指定代理分段诊断', { exact: true })).toHaveCount(0);
  await expect(section.locator('.connectivity-description').first()).toContainText('不等于代理节点延迟');
  await expect(section).toContainText('固定探测地址和浏览器 GET 请求');
  await expect(section.getByRole('combobox', { name: '网站分组' })).toHaveValue('reference');
  await expect(section.locator('.connectivity-row')).toHaveCount(7);
  await expect(section.locator('.connectivity-rounds')).toHaveCount(0);
  await section.getByRole('combobox', { name: '网站分组' }).selectOption('ai');
  await section.getByRole('combobox', { name: '采样方式' }).selectOption('1');
  await expect(section.locator('.connectivity-row')).toHaveCount(15);
  await expect(section.locator('table.connectivity-table')).toHaveCount(1);
  await expect(section.locator('table.connectivity-table thead th')).toHaveCount(4);
  await expect(section.locator('table.connectivity-table tbody tr.connectivity-row')).toHaveCount(15);
  assert.ok(await section.locator('table.connectivity-table tbody tr').evaluateAll(rows => rows.every(row => row.cells.length === 4)), 'Every service must use all four real table columns');
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.service-brand img')].map(img => img.decode())));
  assert.equal(requests.length, 0, 'No probe on page opening or icon loading');
  await expect(section.getByRole('combobox', { name: '采样方式' })).toHaveValue('1');
  await section.getByRole('button', { name: '检测本组', exact: true }).click();
  await expect(section).toHaveAttribute('data-running', 'false');
  assert.equal(requests.length, 15, 'Default quick mode must send only 15 requests');
  await expect(section.locator('tr[aria-label="ChatGPT"]')).toContainText('单次');
  await expect(section.locator('.connectivity-rounds')).toHaveCount(0);
  await browserAction('clear'); requests.length = 0;
  const browserProgress = async () => page.locator('#overall, #elapsed, #progress-text, #run-time, #start-label').allTextContents();
  const initialBrowserProgress = await browserProgress();
  await section.getByRole('combobox', { name: '采样方式' }).selectOption('10');
  slowSamples = true;
  // Dispatch competing starts in the same JavaScript turn. Even callbacks
  // delivered before React renders disabled controls must respect the shared
  // website/core guard; all HTTPS traffic below stays intercepted by CDP.
  await page.evaluate(() => {
    [...document.querySelectorAll('#connectivity button')].find(button => button.textContent.includes('检测本组')).click();
    for (const id of ['start', 'dns-run', 'rtc-run']) document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(section).toHaveAttribute('data-running', 'true');
  await expect(section.locator('.connectivity-rounds')).toHaveCount(15);
  await expect(section.locator('.connectivity-round-hit[data-tone="pending"]').first()).toBeVisible();
  for (const id of ['start', 'dns-run', 'rtc-run', 'clear', 'copy']) await expect(page.locator('#' + id)).toBeDisabled();
  await expect(page.locator('#stop')).toBeEnabled();
  assert.deepEqual(await browserProgress(), initialBrowserProgress, 'Website progress must stay in the website section');
  assert.equal(await page.evaluate(() => window.__rtcAttempts), 0, 'Rapid competing starts must not construct RTC connections');
  await expect(section).toHaveAttribute('data-running', 'false');
  slowSamples = false;
  for (const id of ['start', 'dns-run', 'rtc-run', 'clear']) await expect(page.locator('#' + id)).toBeEnabled();
  await expect(page.locator('#copy')).toBeDisabled();
  await expect(page.locator('#stop')).toBeDisabled();
  assert.deepEqual(await browserProgress(), initialBrowserProgress, 'Website completion must preserve the browser section and its report metadata');
  await expect(section.locator('.connectivity-summary')).toContainText('14 个已响应');
  await expect(section.locator('tr[aria-label="ChatGPT"]')).toHaveAttribute('data-state', 'reachable');
  await expect(section.locator('tr[aria-label="Midjourney"]')).toHaveAttribute('data-state', 'failed');
  await expect(section.locator('tr[aria-label="ChatGPT"]')).toContainText('最低');
  const chatgpt = section.locator('tr[aria-label="ChatGPT"]'), claude = section.locator('tr[aria-label="Claude"]');
  await expect(chatgpt.locator('.connectivity-round-hit')).toHaveCount(10);
  await expect(chatgpt.locator('.connectivity-round-hit[data-round="1"]')).toHaveAttribute('data-tone', 'long');
  await expect(claude.locator('.connectivity-round-hit[data-round="1"]')).toHaveAttribute('data-tone', 'slow');
  await expect(chatgpt.locator('.connectivity-round-hit[data-tone="fast"]')).toHaveCount(9);
  await expect(section.locator('tr[aria-label="Midjourney"] .connectivity-round-hit[data-tone="failed"]')).toHaveCount(10);
  const firstBar = chatgpt.locator('.connectivity-round-hit').first();
  await firstBar.focus();
  await expect(page.getByRole('tooltip')).toHaveText(await firstBar.getAttribute('aria-label'));
  await page.keyboard.press('Escape');
  const captureDir = process.env.BEHINDROSE_SAMPLE_CAPTURE_DIR;
  if (captureDir) {
    await mkdir(captureDir, { recursive: true });
    await section.screenshot({ path: path.join(captureDir, 'samples-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Sampling bars must not overflow mobile');
    await section.screenshot({ path: path.join(captureDir, 'samples-mobile.png') });
    const originalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await section.screenshot({ path: path.join(captureDir, 'samples-mobile-light.png') });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, originalTheme);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  assert.equal(requests.length, 150);
  assert.deepEqual([...new Set(requests.map(request => request.url))].sort(), [...officialAIUrls].sort(), 'The actual browser requests must target the exact upstream favicon URLs');
  assert.ok(officialAIUrls.every(url => requests.filter(request => request.url === url).length === 10), 'Each AI site must be tested exactly 10 times');
  assert.ok(requests.every(request => !request.headers.cookie && !request.headers.authorization && !request.headers.referer));
  const standaloneSummary = await page.evaluate(() => window.__nativeMessages.findLast(message => message.kind === 'completed'));
  assert.deepEqual(standaloneSummary.statuses.slice(0, 7), Array(7).fill('skipped'));
  assert.equal(standaloneSummary.statuses[7], 'unavailable', 'Independent website results must have their own eight-slot scope');
  assert.equal(await page.evaluate(() => window.__nativeMessages.filter(message => message.kind === 'started').length), 2, 'One quick run and one repeat run; competing starts must not create more runs');
  await section.getByRole('button', { name: '复制结果', exact: true }).click();
  assert.match(await page.evaluate(() => window.__clipboard), /网站连通性/);
  await section.getByRole('button', { name: '重测 Claude', exact: true }).click();
  await expect(section).toHaveAttribute('data-running', 'false'); assert.equal(requests.length, 151, 'A per-site retest must issue one request');
  await expect(section.locator('tr[aria-label="Claude"]')).toContainText('单次');
  await expect(claude.locator('.connectivity-rounds')).toHaveCount(0);
  await section.getByRole('combobox', { name: '网站分组' }).selectOption({ label: '默认网站' });
  await expect(section.locator('.connectivity-row')).toHaveCount(7); assert.equal(requests.length, 151);
  await section.getByRole('button', { name: '添加 / 管理网站' }).click();
  const dialog = page.getByRole('dialog', { name: '我的网站' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('网站名称', { exact: true }).fill('我的博客');
  await dialog.getByLabel('网站地址', { exact: true }).fill('https://example.com');
  await dialog.getByRole('button', { name: '添加网站', exact: true }).click();
  await expect(dialog.locator('.custom-sites')).toContainText('我的博客');
  await dialog.locator('summary').click();
  await dialog.getByLabel('网站列表 JSON').fill('[{"name":"重命名","url":"https://example.com/"},{"name":"第二站","url":"https://second.example.com"}]');
  await dialog.getByRole('button', { name: '导入列表', exact: true }).click();
  await expect(dialog.locator('.custom-sites>div')).toHaveCount(2);
  await dialog.getByRole('button', { name: '导出 JSON', exact: true }).click();
  await expect(dialog.locator('.connectivity-notice')).toContainText('已复制 JSON');
  assert.equal(JSON.parse(await page.evaluate(() => window.__clipboard)).length, 2);
  await dialog.getByLabel('网站列表 JSON').fill('[{"name":"bad","url":"javascript:alert(1)"}]');
  await dialog.getByRole('button', { name: '导入列表', exact: true }).click();
  await expect(dialog.locator('.connectivity-notice')).toContainText('HTTPS');
  await expect(dialog.locator('.custom-sites>div')).toHaveCount(2);
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden();
  await expect(section.getByRole('button', { name: '添加 / 管理网站' })).toBeFocused();
  await expect(section.locator('.connectivity-row')).toHaveCount(2); assert.equal(requests.length, 151, 'Saving and importing never starts probes');
  await page.reload(); await page.getByRole('combobox', { name: '网站分组' }).selectOption('custom');
  await page.getByRole('combobox', { name: '采样方式' }).selectOption('10');
  await expect(page.locator('.connectivity-row')).toHaveCount(2); assert.equal(requests.length, 151);
  await page.getByRole('button', { name: '添加 / 管理网站' }).click();
  await page.getByRole('button', { name: '删除 第二站' }).click();
  await expect(page.locator('.custom-sites>div')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.locator('#select-ip, #select-dns, #select-rtc').evaluateAll(inputs => inputs.forEach(input => input.checked = false));
  await page.locator('#select-connect').evaluate(input => { input.checked = true; });
  await browserAction('start');
  await expect(page.locator('#stop')).toBeDisabled();
  await expect(page.locator('.connectivity-summary')).toContainText('1 个已响应');
  await expect(page.locator('#progress-text')).toHaveText('1 / 1');
  assert.equal(requests.length, 161, 'Global detection must run all 10 rounds for the one custom site');
  assert.ok(requests.slice(151).every(request => request.url === 'https://example.com/'), 'Custom URLs must not be replaced with favicon endpoints');
  const summary = await page.evaluate(() => window.__nativeMessages.findLast(message => message.kind === 'completed'));
  assert.equal(summary.statuses.length, 8); assert.equal(summary.statuses[7], 'ready', 'Native summary includes website results');
  await browserAction('copy');
  assert.match(await page.evaluate(() => window.__clipboard), /网站连通性[\s\S]*重命名/);
  assert.match(await page.evaluate(() => window.__clipboard), /10\s*次/);
  assert.match(await page.evaluate(() => window.__clipboard), /最低/);
  await browserAction('clear'); await expect(page.locator('.connectivity-summary')).toContainText('等待检测');
  // Top Stop cancels an independent website batch. Clear is available only
  // after cancellation settles, and late replies cannot revive cleared rows.
  delayed = true; await page.getByRole('combobox', { name: '网站分组' }).selectOption('ai');
  await page.getByRole('button', { name: '检测本组' }).click();
  await expect(page.locator('#connectivity')).toHaveAttribute('data-running', 'true');
  await expect(page.locator('#clear')).toBeDisabled(); await expect(page.locator('#copy')).toBeDisabled();
  await expect(page.locator('#stop')).toBeEnabled(); await browserAction('stop');
  await expect(page.locator('#connectivity')).toHaveAttribute('data-running', 'false');
  const requestsAfterStop = requests.length; await page.waitForTimeout(800);
  assert.equal(requests.length, requestsAfterStop, 'Top Stop must cancel queued site and round timers');
  await expect(page.locator('.connectivity-row[data-state="cancelled"]')).toHaveCount(15);
  await expect(section.locator('.connectivity-round-hit[data-tone="pending"]')).toHaveCount(0);
  const stoppedWebsiteSummary = await page.evaluate(() => window.__nativeMessages.findLast(message => message.kind === 'completed'));
  assert.deepEqual(stoppedWebsiteSummary.statuses, [...Array(7).fill('skipped'), 'cancelled']);
  for (const id of ['start', 'dns-run', 'rtc-run', 'clear']) await expect(page.locator('#' + id)).toBeEnabled();
  await expect(page.locator('#copy')).toBeDisabled();
  await browserAction('clear'); const requestsAfterClear = requests.length; await page.waitForTimeout(400);
  assert.equal(requests.length, requestsAfterClear, 'Late cancelled replies must not start requests after clearing');
  await expect(page.locator('#connectivity')).toHaveAttribute('data-running', 'false');
  await expect(page.locator('.connectivity-row[data-state="reachable"], .connectivity-row[data-state="slow"]')).toHaveCount(0);
  await page.getByRole('button', { name: '检测本组' }).click();
  await page.getByRole('button', { name: '停止网站检测', exact: true }).click();
  await expect(page.locator('#connectivity')).toHaveAttribute('data-running', 'false');
  await expect(page.locator('.connectivity-row[data-state="cancelled"]')).toHaveCount(15);
  await browserAction('start');
  await expect(page.locator('#stop')).toBeEnabled();
  await browserAction('stop');
  await expect(page.locator('#stop')).toBeDisabled();
  await expect(page.locator('.connectivity-row[data-state="cancelled"]')).toHaveCount(15);
  assert.equal(await page.evaluate(() => window.__nativeMessages.findLast(message => message.kind === 'completed').statuses[7]), 'cancelled');
  // A long browser sampling run must not strand the website action disabled.
  // A manual website start cancels and joins it before the first HTTPS probe.
  delayed = false;
  await page.getByRole('combobox', { name: '网站分组' }).selectOption('reference');
  await page.getByRole('combobox', { name: '采样方式' }).selectOption('1');
  await page.evaluate(() => {
    window.__originalRtcProbe = window.RoseMyIP.probeRtc;
    window.__heldRtc = 0; window.__releasedRtc = 0;
    window.RoseMyIP.probeRtc = (_host, signal) => new Promise(resolve => {
      window.__heldRtc++;
      const stop = () => { window.__releasedRtc++; resolve({ addresses: [], status: 'cancelled', note: '已停止测试采样' }); };
      signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
    });
  });
  await browserAction('rtc-run');
  await expect.poll(() => page.evaluate(() => window.__heldRtc)).toBe(4);
  await expect(page.getByRole('button', { name: '检测本组', exact: true })).toBeEnabled();
  await expect(section).toContainText('保留已有结果');
  const beforeSwitch = requests.length;
  await page.getByRole('button', { name: '检测本组', exact: true }).click();
  await expect(section).toHaveAttribute('data-running', 'false');
  assert.equal(await page.evaluate(() => window.__releasedRtc), 4, 'All browser probes settle before website sampling');
  assert.equal(requests.length - beforeSwitch, 7, 'One website click runs the selected seven targets once');
  await expect(page.locator('#rtc-list .rtc-item[data-state="cancelled"]')).toHaveCount(4);
  await expect(section.locator('.connectivity-row[data-state="reachable"], .connectivity-row[data-state="slow"]')).toHaveCount(7);
  await expect(page.getByRole('button', { name: '检测本组', exact: true })).toBeEnabled();
  await page.evaluate(() => { window.RoseMyIP.probeRtc = window.__originalRtcProbe; });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole('button', { name: '添加 / 管理网站' }).click();
  assert.ok(await page.locator('dialog').evaluate(el => el.scrollWidth <= el.clientWidth));
  assert.deepEqual(errors, []);
  console.log('PASS: upstream favicon requests, 10-round minimum and single retest labels, opaque 403 responses, default/custom groups, persisted imports, global summaries/reports, cancelled timers, stale responses, focus and mobile.');
} finally { await browser.close(); }
