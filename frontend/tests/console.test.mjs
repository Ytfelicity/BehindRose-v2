import assert from 'node:assert/strict';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 20000 });

const testBaseURL = new URL(process.env.BEHINDROSE_TEST_URL || 'http://127.0.0.1:4317/');
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath && !existsSync(chromium.executablePath()) && process.env.LOCALAPPDATA) {
  const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  const installed = existsSync(cache) ? readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse() : [];
  executablePath = installed.map(name => path.join(cache, name, 'chrome-win64/chrome.exe')).find(existsSync);
}
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const errors = [], commands = [], external = [], dnsRequests = [], planRequests = [];
let configurationState = 'pending';
let clashIpv6State = '已开启';
const dnsResolvers = [
  { ip: '1.1.1.1', reverse: 'one.one.one.one', isp_name: 'Cloudflare, Inc.', country_name: 'United States', country_code: 'US', region_name: 'California', city_name: 'Los Angeles' },
  { ip: '1.0.0.2', reverse: 'one.one.one.one', isp_name: 'Cloudflare, Inc.', country_name: 'United States', country_code: 'US', region_name: 'California', city_name: 'Los Angeles' },
  { ip: '1.0.0.1', reverse: 'one.one.one.one', isp_name: 'Cloudflare, Inc.', country_name: 'United States', country_code: 'US', region_name: 'California', city_name: 'San Francisco' },
];
let mode = 'success';
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.on('pageerror', error => errors.push(error.message));
// Keep every scenario deterministic; no real STUN or HTTPS provider traffic.
await page.addInitScript(() => {
  window.__navigationPaintFailures = [];
  const inspectPaint = () => {
    if (document.body) {
      const visible = [...document.querySelectorAll('.page')].filter(section => section.getClientRects().length);
      const body = document.body;
      const fail = reason => { if (window.__navigationPaintFailures.length < 20) window.__navigationPaintFailures.push(reason); };
      if (visible.length > 1) fail('Multiple pages visible in one frame');
      if (visible.length === 1 && visible[0].id !== 'page-' + body.dataset.page) fail('Visible page and shell route disagree');
      if (visible.length && (!body.classList.contains('dashboard4') || !body.classList.contains('reactbits-ui'))) fail('Legacy style shown before dashboard initialization');
    }
    requestAnimationFrame(inspectPaint);
  };
  requestAnimationFrame(inspectPaint);
  // Accelerate only the official sampling pauses in this mocked environment.
  const setTimeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, delay, ...args) => setTimeout(callback, delay === 1 || delay === 1000 ? 0 : delay, ...args);
  localStorage.setItem('behindrose-connectivity-v1', JSON.stringify([{ name: '回归网站', url: 'https://example.com/' }]));
  window.RTCPeerConnection = undefined;
  window.__rtcConnections = [];
  window.__MockRTCPeerConnection = class {
    constructor(configuration) {
      this.configuration = configuration; this.closed = false; window.__rtcConnections.push(this);
    }
    createDataChannel(label) { this.channelLabel = label; }
    async createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
    candidate(type, address) {
      this.onicecandidate?.({ candidate: { candidate: `candidate:1234 1 udp 2122260223 ${address} 50000 typ ${type} raddr 0.0.0.0 rport 0` } });
    }
    async setLocalDescription() {
      if (window.__rtcMode === 'cancel' || window.__rtcMode === 'hold') return;
      this.candidate('host', '192.168.1.3'); this.candidate('host', 'hidden-address.local');
      this.candidate('srflx', '93.184.216.34'); this.candidate('srflx', '93.184.216.35');
    }
    close() { this.closed = true; }
  };
  window.__clipboard = '';
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.__clipboard = value; } } });
});
const mockSession = route => route.fulfill({ json: { ready: true, token: 'ui-test-session' } });
await page.route('**/api/session', mockSession);
const mockLocal = async route => {
  const request = route.request().postDataJSON(); commands.push(request.command);
  if (request.command === 'plan') planRequests.push(request);
  const data = {
    status: { operation: null },
    'quality-status': { state: 'idle', id: null, family: 4, route: 'proxy', stage: '尚未开始', current: 0, total: 1, report: null, error: null },
    'quality-proxies': { candidates: [], notes: [] },
    'proxy-network-status': { state: 'idle', id: null, proxyPort: 7897, profile: 'quick', includeSpeed: false, stage: '尚未开始', current: 0, total: 0, report: null, error: null },
    health: { demo: false, checkedAt: '2026-10-02T09:00:00+08:00',
      host: { found: true, running: false, compatible: configurationState !== 'unrecognized', version: '2.5.7', note: configurationState === 'unrecognized' ? 'config.yaml 的 tun 必须是已存在的配置映射。' : '当前配置目录与 TUN 字段结构可识别，可以生成配置预览。' },
      clashIpv6: { title: 'Clash IPv6', state: clashIpv6State, detail: clashIpv6State === '已关闭' ? '配置文件中 ipv6: false；重新打开 Clash 后核对运行效果。' : clashIpv6State === '无法自动修改' ? 'config.yaml 的 ipv6 必须是可识别的布尔值。' : '配置文件中 ipv6: true；关闭前可查看修改预览。' },
      singMix: { title: 'sing-mix DNS 与 AI 分流', state: configurationState === 'configured' ? '已配置' : '待配置', detail: '测试中的 sing-mix 状态' },
      findings: ['系统 DNS', 'Chrome DNS', 'Edge DNS', 'Firefox DNS'].map(title => ({ title, state: configurationState === 'configured' ? '已配置' : configurationState === 'managed' && title === 'Chrome DNS' ? '由管理员管理' : '待配置', detail: '浏览器回归中的模拟配置状态' })) },
    backups: [{ id: 'mock-backup', createdAt: '2026-10-02T09:00:00+08:00', canRestore: true, titles: ['系统 DNS'], state: 'applied', kind: 'repair' }],
    'clash-full-backups': [],
    plan: { id: 'mock-plan', action: 'repair', options: request.options, needsClashExit: true, clashRunning: false, changes: [{ title: '系统路由、DNS 接管与 Clash IPv6', beforeText: '现有配置', afterText: '开启 TUN 与 DNS 接管；关闭 Clash IPv6（ipv6: false）' }] },
    'restore-plan': { id: 'mock-restore', action: 'restore', changes: [{ title: '系统 DNS', beforeText: '防护配置', afterText: '原配置' }] },
  }[request.command];
  assert.ok(data, `Unexpected local command: ${request.command}`);
  await route.fulfill({ json: { data } });
};
await page.route('**/api/local', mockLocal);
const mockExternal = async route => {
  const url = new URL(route.request().url()); external.push(url.href);
  const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
  if (mode === 'cancel' && url.hostname.includes('ipify')) {
    await new Promise(resolve => setTimeout(resolve, 450));
    await route.fulfill({ headers, json: { ip: url.hostname === 'api.ipify.org' ? '93.184.216.34' : '2606:4700:4700::1111' } }).catch(() => {}); return;
  }
  if (url.hostname.endsWith('.ipleak.net') && url.pathname === '/dnsdetection/') {
    const match = /^([a-z0-9]{40})-(\d+)\.ipleak\.net$/.exec(url.hostname);
    assert.ok(match); const step = Number(match[2]);
    assert.equal(route.request().method(), 'GET'); assert.equal(route.request().resourceType(), 'fetch');
    dnsRequests.push({ url: url.href, session: match[1], step });
    if (step === 1 && (mode === 'cancel-dns' || mode === 'standalone-dns')) await new Promise(resolve => setTimeout(resolve, 450));
    if (mode === 'failure') await route.fulfill({ status: 503, headers, body: 'fixture unavailable' }).catch(() => {});
    else await route.fulfill({ headers, json: { session: match[1], ip: mode === 'empty' ? {} : Object.fromEntries(dnsResolvers.map((row, i) => [row.ip, step + i])) } }).catch(() => {});
    return;
  }
  if (url.hostname === 'ipleak.net' && url.pathname.startsWith('/json/')) {
    const row = dnsResolvers.find(row => row.ip === decodeURIComponent(url.pathname.slice(6)));
    assert.ok(row); await route.fulfill({ headers, json: row });
    return;
  }
  if (url.hostname === 'example.com') {
    if (mode === 'standalone-websites') await new Promise(resolve => setTimeout(resolve, 450));
    await route.fulfill({ headers, body: 'isolated website fixture' }); return;
  }
  if (mode === 'failure') { await route.fulfill({ status: 503, headers, body: 'test unavailable' }); return; }
  if (url.hostname === 'api.ipify.org') await route.fulfill({ headers, json: { ip: '93.184.216.34' } });
  else if (url.hostname === 'api6.ipify.org') await route.fulfill({ headers, json: { ip: '2606:4700:4700::1111' } });
  else throw Error('Unexpected external request: ' + url);
};
await page.route('https://**/*', mockExternal);
const frame = page.frameLocator('#network-frame');
const artifacts = path.resolve('artifacts'); mkdirSync(artifacts, { recursive: true });
async function expectFullNavigationRow(menu, destination) {
  const item = menu.locator(`[data-slot="sidebar-menu-item"]:has(a[href="#${destination}"])`);
  const link = item.locator('a');
  await link.hover();
  const row = await link.boundingBox();
  assert.ok(row && row.width >= 40 && row.height >= 32, 'Every navigation destination retains a complete pointer target');
  for (const part of await link.locator('strong, small').all()) {
    if (!(await part.isVisible())) continue;
    const bounds = await part.boundingBox();
    assert.ok(bounds && bounds.x >= row.x - 1 && bounds.y >= row.y - 1 && bounds.x + bounds.width <= row.x + row.width + 1 && bounds.y + bounds.height <= row.y + row.height + 1, 'Visible navigation text stays inside its clickable row');
  }
}
const contextTrigger = page.getByRole('button', { name: '显示或隐藏检测选项', exact: true });
async function openContext() {
  if (await contextTrigger.getAttribute('aria-expanded') !== 'true') await contextTrigger.click();
  await expect(contextTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#context-ui')).toBeVisible();
}
async function closeContext() {
  if (await contextTrigger.getAttribute('aria-expanded') === 'true') await page.getByRole('button', { name: '关闭连接面板', exact: true }).click();
  await expect(contextTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#context-ui')).toBeHidden();
}
async function toggleSampleOption(name) {
  // Retain the engine's legacy aggregate-path regression without exposing
  // website sampling in the browser-network options drawer.
  if (name === '网站连通性') {
    await frame.locator('#select-connect').evaluate(input => { input.checked = !input.checked; input.dispatchEvent(new Event('change', { bubbles: true })); });
    return;
  }
  await openContext();
  await page.getByRole('switch', { name, exact: true }).click();
  await closeContext();
}
try {
  // A slow deferred bundle must never reveal the old default overview or theme.
  let releaseShell;
  const shellGate = new Promise(resolve => { releaseShell = resolve; });
  const holdShell = async route => { await shellGate; await route.continue(); };
  await page.route('**/beui.js', holdShell);
  try {
    await page.goto(new URL('#network', testBaseURL).href, { waitUntil: 'commit' });
    await expect(page.locator('body')).toHaveClass(/\bdashboard4\b/);
    await expect(page.locator('body')).toHaveClass(/\breactbits-ui\b/);
    await expect(page.locator('.page:visible')).toHaveCount(0);
    await page.waitForFunction(() => [...document.querySelectorAll('link[rel="stylesheet"]')].every(link => link.sheet));
    assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(11, 11, 11)', 'The final neutral palette applies before the shell bundle executes');
  } finally { releaseShell(); }
  await page.waitForLoadState('load');
  await page.unroute('**/beui.js', holdShell);
  await expect(frame.locator('#start')).toBeEnabled();
  await expect(frame.locator('#dns-run')).toBeEnabled();
  await expect(frame.locator('#dns-run')).toContainText('检测 DNS');
  await expect(frame.locator('#rtc-run')).toBeEnabled();
  await expect(frame.locator('#rtc-run')).toContainText('检测 WebRTC');
  await expect(page.locator('body')).toHaveClass(/\bdashboard4\b/);
  await expect(contextTrigger).toBeVisible();
  await expect(contextTrigger).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#context-ui')).toBeHidden();
  await expect(frame.locator('#select-connect')).not.toBeChecked(); // Websites have a separate view and suite.
  await expect(page.locator('#support-author')).toBeEnabled();
  await expect(page.locator('#auth-dialog, #invite-code, #auth-open')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开功能菜单' })).toBeHidden();
  await expect(page.getByRole('button', { name: '关闭连接面板' })).toBeHidden();
  await openContext();
  const ipToggle = await page.getByRole('switch', { name: '公网 IP', exact: true }).boundingBox();
  assert.ok(ipToggle && ipToggle.width >= 40 && ipToggle.height >= 24, 'The sampling switch remains usable in the settings drawer');
  await closeContext();
  await openContext();
  await expect(page.locator('.dashboard4-context-backdrop')).toBeVisible();
  await closeContext();
  await page.locator('.network-jump-links a[href="#ip-quality"]').click();
  await expect(contextTrigger).toBeVisible();
  await expect(page.locator('#context-ui')).toBeHidden();
  await expect(page.locator('.dashboard4-context-backdrop')).toHaveCount(0);
  await expect(frame.locator('#quality-title')).toBeInViewport();
  await expect(frame.getByRole('button', { name: '开始质量体检', exact: true })).toBeDisabled();
  const qualityRoute = frame.getByRole('combobox', { name: '体检出口', exact: true });
  await qualityRoute.click(); await qualityRoute.selectOption('default');
  await expect(qualityRoute).toHaveValue('default');
  await expect(frame.getByRole('button', { name: '开始质量体检', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  assert.ok(!commands.includes('quality-start'), 'The quality shortcut must navigate without starting a quality scan');
  assert.equal(external.length, 0, 'Opening the quality card must not start external probes');
  await expect(page.locator('.network-jump-links a')).toHaveCount(3);
  await expect(page.locator('a[href="#proxy-network"], a[href="#vps-network"]')).toHaveCount(0);
  await expect(frame.locator('#proxy-network, #vps-network, #proxy-network-root, #vps-network-root')).toHaveCount(0);
  assert.ok(!commands.some(command => /^(proxy-network|netquality)-/.test(command)), 'Retired detectors must not poll or start');
  await page.locator('#sidebar-ui').getByRole('link', { name: '网络检测', exact: true }).click();
  await expect(page.locator('#rail-ui')).toHaveCount(0);
  assert.equal((await page.locator('#sidebar-ui').boundingBox()).x, 0, 'Unified sidebar starts at the left edge');
  assert.equal(external.length, 0, 'Opening the UI must not start sampling');
  const desktopMenu = page.locator('#sidebar-ui .console-sidebar-content');
  for (const destination of ['overview', 'backups', 'network']) await expectFullNavigationRow(desktopMenu, destination);
  await desktopMenu.locator('a[href="#overview"]').click();
  await expect(page.locator('#page-overview')).toBeVisible();
  await expect(desktopMenu.locator('a[href="#overview"]')).toHaveAttribute('aria-current', 'page');
  await desktopMenu.locator('a[href="#network"]').click();
  await expect(page.locator('#page-network')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(desktopMenu.locator('a[href="#overview"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#page-overview')).toBeVisible();
  await desktopMenu.locator('a[href="#network"]').click();
  assert.deepEqual(await page.evaluate(() => window.__navigationPaintFailures), [], 'No legacy theme, overlapping page or route/layout mismatch may be painted during navigation');
  await page.mouse.move(700, 120);
  await page.screenshot({ path: path.join(artifacts, 'console-desktop.png'), fullPage: true });
  await page.screenshot({ path: path.join(artifacts, 'console-desktop-viewport.png') });
  await expect(page.getByRole('button', { name: '切换明暗主题' })).toHaveCount(0);
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectFullNavigationRow(desktopMenu, 'overview');
  const activeColor = await desktopMenu.locator('a[href="#network"]').evaluate(link => getComputedStyle(link).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number));
  assert.ok(activeColor && Math.max(...activeColor) - Math.min(...activeColor) <= 15, 'The active dashboard navigation uses the neutral palette');
  await expect(frame.locator('body')).toHaveClass(/\bdashboard4\b/);
  await expect(frame.locator('.dashboard-network-header h2')).toHaveText('浏览器网络');
  await expect(frame.locator('.dashboard-metrics .dashboard-metric')).toHaveCount(4);
  await expect(frame.locator('#dns-overview-count')).toContainText('—');
  await expect(frame.locator('#rtc-overview-count')).toHaveText('—');
  const metrics = await frame.locator('.dashboard-metrics .dashboard-metric').evaluateAll(cards => cards.map(card => {
    const { x, y, width, height } = card.getBoundingClientRect(); return { x, y, width, height };
  }));
  assert.ok(metrics.every(card => Math.abs(card.y - metrics[0].y) < 2 && card.width > 100 && card.height > 50), 'Desktop metrics share one usable overview row');
  assert.ok(metrics.every((card, index) => !index || metrics[index - 1].x + metrics[index - 1].width <= card.x + 1), 'Metric cards do not overlap');
  await expect(frame.locator('#connectivity-root')).toBeVisible();
  await expect(frame.locator('#quality-root')).toBeVisible();
  await expect(frame.locator('.dashboard-network-details')).toBeVisible();
  await expect(frame.locator('#connectivity table.connectivity-table')).toHaveCount(1);
  await page.screenshot({ path: path.join(artifacts, 'console-dark-initial.png') });
  await toggleSampleOption('WebRTC');
  await expect(frame.locator('#select-rtc')).not.toBeChecked();
  await frame.locator('#start').click();
  await expect(frame.locator('#dns-status')).toContainText('已取得结果');
  await expect(frame.locator('#stop')).toBeDisabled();
  await expect(frame.locator('#dns-overview-count')).toContainText('3');
  await expect(frame.locator('#dns-source-list .dns-source')).toHaveCount(1);
  await expect(frame.locator('#dns-source-list .dns-source-label')).toHaveText('DNS 检测');
  await expect(frame.locator('#dns-source-list')).toContainText('连续采样');
  await expect(frame.locator('#dns-source-list')).toContainText(/300\s*\/\s*300/);
  const firstDnsProbes = dnsRequests.slice();
  assert.equal(firstDnsProbes.length, 300, 'IPLeak completes the official 300 sequential browser requests');
  assert.equal(new Set(firstDnsProbes.map(probe => probe.session)).size, 1);
  assert.deepEqual(firstDnsProbes.map(probe => probe.step), Array.from({ length: 300 }, (_, i) => i + 1));
  assert.ok(!commands.includes('dnsleaktest'), 'DNS never calls the former local control service');
  await expect(page.locator('#context-ui .sample-summary')).toContainText('检测结束');
  await expect(frame.getByRole('list', { name: 'DNS 解析器检测结果' })).toBeVisible();
  await expect(frame.locator('#dns-list .dns-resolver-card')).toHaveCount(3);
  await expect(frame.locator('#dns-list .dns-result-ip')).toHaveText(['1.1.1.1', '1.0.0.2', '1.0.0.1']);
  await expect(frame.locator('#dns-list .dns-result-region')).toHaveText(Array(3).fill('United States - California'));
  await expect(frame.locator('#dns-list')).toContainText('one.one.one.one');
  await expect(frame.locator('#dns-list')).toContainText('Cloudflare, Inc.');
  await expect(frame.locator('#dns-list')).toContainText('1.0.0.1');
  await expect(frame.locator('#ip4-address')).toContainText('93.184.216.34');
  await frame.locator('#copy').click();
  const networkFrame = page.frames().find(item => item.url().endsWith('/network'));
  const sourceReport = await networkFrame.evaluate(() => window.__clipboard);
  assert.match(sourceReport, /DNS：[\s\S]*IPLeak/);
  for (const value of ['Cloudflare, Inc.', 'one.one.one.one', 'Los Angeles', 'San Francisco', '1.1.1.1', '1.0.0.1']) assert.ok(sourceReport.includes(value), 'Report preserves resolver metadata: ' + value);
  assert.match(sourceReport, /300 次命中/); assert.match(sourceReport, /302 次命中/);
  assert.equal(sourceReport.split('\n').filter(line => line.startsWith('1.1.1.1 |')).length, 1, 'IPLeak returns one card per resolver with its cumulative hit count');
  assert.doesNotMatch(sourceReport, /ip-api\.com|surfsharkdns\.com|myipstack\.com|fastly\.com|bash\.ws/);
  await openContext();
  await expect(page.getByRole('switch', { name: 'DNS 解析器', exact: true })).toBeEnabled();
  await closeContext();
  await page.screenshot({ path: path.join(artifacts, 'console-results.png'), fullPage: true });

  await frame.locator('#clear').click();
  await expect(frame.locator('#dns-overview-count')).toContainText('—');
  await expect(frame.locator('#ip4-address')).toHaveText('—');
  mode = 'empty'; await frame.locator('#start').click();
  await expect(frame.locator('#dns-status')).toContainText('无法确认');
  await expect(frame.locator('#dns-overview-count')).toContainText('—');
  await expect(frame.locator('#dns-note')).toContainText(/不是“无泄漏”的证据|不能视为无泄漏/);
  await expect(frame.locator('#stop')).toBeDisabled();
  await frame.locator('#clear').click();
  mode = 'failure'; await frame.locator('#start').click();
  await expect(frame.locator('#ip4-status')).toContainText('检测失败');
  await expect(frame.locator('#dns-status')).toContainText('无法确认');
  await expect(frame.locator('#dns-note')).toContainText(/不是“无泄漏”的证据|不能视为无泄漏/);
  await expect(frame.locator('#stop')).toBeDisabled();

  await frame.locator('#clear').click();
  await toggleSampleOption('DNS 解析器');
  mode = 'cancel'; await frame.locator('#start').click();
  await openContext();
  await expect(page.getByRole('switch', { name: '公网 IP', exact: true })).toBeDisabled();
  await closeContext();
  await frame.locator('#stop').click();
  await expect(frame.locator('#ip4-status')).toContainText('已停止');
  await expect(frame.locator('#start')).toBeEnabled();

  // Stop DNS while its first browser request is pending: late responses
  // must not start another request or revive a cancelled run.
  await frame.locator('#clear').click();
  await toggleSampleOption('公网 IP');
  await toggleSampleOption('DNS 解析器');
  mode = 'cancel-dns'; const beforeDnsCancel = external.length;
  await frame.locator('#start').click();
  await expect.poll(() => external.length).toBeGreaterThan(beforeDnsCancel);
  await expect(frame.locator('#dns-source-list')).toContainText(/0\s*\/\s*300/);
  await frame.locator('#stop').click();
  await expect(frame.locator('#dns-status')).toContainText('已停止');
  await expect(frame.locator('#stop')).toBeDisabled();
  const afterDnsCancel = external.length, rpcAfterDnsCancel = dnsRequests.length; await page.waitForTimeout(700);
  assert.equal(external.length, afterDnsCancel, 'Stopping DNS prevents subsequent browser probes');
  assert.equal(dnsRequests.length, rpcAfterDnsCancel, 'Stopping DNS prevents subsequent DNS requests');
  await expect(frame.locator('#dns-overview-count')).toContainText('—');
  await expect(frame.locator('#dns-source-list [data-state="cancelled"]')).toHaveCount(1);

  // Exercise WebRTC with an in-browser fake, keeping all STUN traffic local.
  await frame.locator('#clear').click();
  await toggleSampleOption('DNS 解析器');
  await toggleSampleOption('WebRTC');
  mode = 'success';
  await networkFrame.evaluate(() => {
    window.__rtcMode = 'success'; window.RTCPeerConnection = window.__MockRTCPeerConnection;
    window.__nativeMessages = []; window.chrome ||= {};
    window.__nativeListeners = [];
    window.chrome.webview = {
      addEventListener: (name, callback) => {
        if (name !== 'message') return;
        window.__nativeListeners.push(callback);
        queueMicrotask(() => callback({ data: { kind: 'epoch', epoch: 'a'.repeat(32) } }));
      },
      removeEventListener: (name, callback) => { window.__nativeListeners = window.__nativeListeners.filter(listener => listener !== callback); },
      postMessage: message => {
        window.__nativeMessages.push(message);
      },
    };
  });
  await frame.locator('#start').click(); await expect(frame.locator('#stop')).toBeDisabled();
  await expect(frame.locator('#rtc-list .rtc-item[data-state="ready"]')).toHaveCount(4);
  const rtc = await networkFrame.evaluate(() => ({
    connections: window.__rtcConnections.map(pc => ({ configuration: pc.configuration, closed: pc.closed, label: pc.channelLabel })),
    summary: window.__nativeMessages.findLast(message => message.kind === 'completed'),
  }));
  assert.deepEqual(rtc.connections.map(pc => pc.configuration.iceServers[0].urls), [
    'stun:stun.l.google.com:19302', 'stun:stun.voip.blackberry.com:3478', 'stun:global.stun.twilio.com', 'stun:stun.cloudflare.com',
  ]);
  assert.ok(rtc.connections.every(pc => pc.closed && pc.label === ''));
  assert.equal(rtc.summary.statuses.length, 8); assert.deepEqual(rtc.summary.statuses.slice(3, 7), ['ready', 'ready', 'ready', 'ready']);
  await expect(frame.locator('#rtc-list')).toContainText('93.184.216.34');
  await expect(frame.locator('#rtc-list')).not.toContainText('93.184.216.35');
  await frame.locator('#copy').click();
  const rtcReport = await networkFrame.evaluate(() => window.__clipboard);
  assert.match(rtcReport, /WebRTC：IPCheck\.ing \/ MyIP/); assert.match(rtcReport, /候选类型 srflx/);
  assert.doesNotMatch(rtcReport, /192\.168\.1\.3|hidden-address\.local|93\.184\.216\.35|--- Offer SDP ---/);
  await frame.locator('#clear').click();
  await networkFrame.evaluate(() => { window.__rtcMode = 'cancel'; });
  await frame.locator('#start').click(); await expect(frame.locator('#stop')).toBeEnabled();
  await frame.locator('#stop').click(); await expect(frame.locator('#stop')).toBeDisabled();
  await expect(frame.locator('#rtc-list .rtc-item[data-state="cancelled"]')).toHaveCount(4);
  assert.ok(await networkFrame.evaluate(() => window.__rtcConnections.every(pc => pc.closed)), 'Stopping RTC must close every connection');
  const stoppedSummary = await networkFrame.evaluate(() => window.__nativeMessages.findLast(message => message.kind === 'completed'));
  assert.equal(stoppedSummary.statuses.length, 8); assert.ok(stoppedSummary.statuses.slice(3, 7).every(status => status === 'cancelled'));

  // Website requests begin after IP/DNS/STUN finish, so a ten-round batch
  // cannot compete for browser connections with the core network samples.
  await frame.locator('#clear').click();
  for (const name of ['公网 IP', 'DNS 解析器', '网站连通性']) await toggleSampleOption(name);
  await networkFrame.evaluate(() => {
    window.__rtcMode = 'success'; window.__websiteCalls = [];
    window.__realWebsiteRun = window.RoseConnectivity.run;
    window.RoseConnectivity.run = async signal => {
      window.__websiteCalls.push({
        aborted: signal.aborted,
        ip4: document.getElementById('ip4-status').dataset.state,
        ip6: document.getElementById('ip6-status').dataset.state,
        dns: document.getElementById('dns-status').dataset.state,
        rtc: [...document.querySelectorAll('#rtc-list .rtc-item')].map(row => row.dataset.state),
      });
      return 0;
    };
  });
  await frame.locator('#start').click(); await expect(frame.locator('#stop')).toBeDisabled();
  const staged = await networkFrame.evaluate(() => ({
    calls: window.__websiteCalls, summary: window.__nativeMessages.findLast(message => message.kind === 'completed'),
  }));
  assert.deepEqual(staged.calls, [{ aborted: false, ip4: 'ready', ip6: 'ready', dns: 'ready', rtc: ['ready', 'ready', 'ready', 'ready'] }], 'Website phase must wait for all core samples to finish');
  assert.equal(staged.summary.statuses.length, 8); assert.ok(staged.summary.statuses.every(status => status === 'ready'));
  await expect(frame.locator('#dns-overview-count')).toContainText('3');
  await expect(frame.locator('#rtc-overview-count')).toHaveText('4');
  await expect(frame.locator('#progress-text')).toHaveText('8 / 8');

  // Independent section runs keep displayed results from the previous full
  // run, but only the chosen section belongs to the new eight-slot summary.
  const preserved = await networkFrame.evaluate(() => ({
    ip4: document.getElementById('ip4-address').textContent,
    ip6: document.getElementById('ip6-address').textContent,
    dns: document.getElementById('dns-list').textContent,
    rtc: [...document.querySelectorAll('#rtc-list .rtc-address')].map(row => row.textContent),
    connections: window.__rtcConnections.length,
  }));
  await frame.locator('#copy').click();
  const previousCoreReport = await networkFrame.evaluate(() => window.__clipboard);
  const previousCoreProgress = await frame.locator('#overall, #elapsed, #progress-text, #run-time, #start-label').allTextContents();
  const coreLines = report => report.split('\n').filter(line => /^IPv[46]：|^采样时间：|^DNS：|^(Google|BlackBerry|Twilio|Cloudflare) \//.test(line));
  // Let the new standalone run receive a distinct timestamp, so this also
  // catches website starts accidentally restamping preserved core samples.
  await page.waitForTimeout(1100);
  await frame.locator('#connectivity').getByRole('combobox', { name: '网站分组', exact: true }).selectOption('custom');
  mode = 'standalone-websites'; const beforeStandaloneWebsite = external.length, beforeStandaloneWebsiteRpc = dnsRequests.length;
  await frame.locator('#connectivity').getByRole('button', { name: '重测 回归网站', exact: true }).click();
  await expect(frame.locator('#connectivity')).toHaveAttribute('data-running', 'true');
  for (const id of ['start', 'dns-run', 'rtc-run', 'clear', 'copy']) await expect(frame.locator('#' + id)).toBeDisabled();
  await expect(frame.locator('#stop')).toBeEnabled();
  await expect(frame.locator('#connectivity')).toHaveAttribute('data-running', 'false');
  for (const id of ['start', 'dns-run', 'rtc-run', 'clear', 'copy']) await expect(frame.locator('#' + id)).toBeEnabled();
  await expect(frame.locator('#stop')).toBeDisabled();
  assert.deepEqual(external.slice(beforeStandaloneWebsite), ['https://example.com/'], 'Independent website retest must only issue its one website request');
  assert.equal(dnsRequests.length, beforeStandaloneWebsiteRpc, 'Independent website detection must not sample DNS');
  const afterStandaloneWebsite = await networkFrame.evaluate(() => ({
    ip4: document.getElementById('ip4-address').textContent,
    ip6: document.getElementById('ip6-address').textContent,
    dns: document.getElementById('dns-list').textContent,
    rtc: [...document.querySelectorAll('#rtc-list .rtc-address')].map(row => row.textContent),
    connections: window.__rtcConnections.length,
    summary: window.__nativeMessages.findLast(message => message.kind === 'completed'),
  }));
  assert.equal(afterStandaloneWebsite.ip4, preserved.ip4); assert.equal(afterStandaloneWebsite.ip6, preserved.ip6);
  assert.equal(afterStandaloneWebsite.dns, preserved.dns); assert.deepEqual(afterStandaloneWebsite.rtc, preserved.rtc);
  assert.equal(afterStandaloneWebsite.connections, preserved.connections);
  assert.deepEqual(afterStandaloneWebsite.summary.statuses, [...Array(7).fill('skipped'), 'ready']);
  assert.deepEqual(await frame.locator('#overall, #elapsed, #progress-text, #run-time, #start-label').allTextContents(), previousCoreProgress, 'Independent website sampling must preserve browser progress and scope');
  await frame.locator('#copy').click(); const websiteScopeReport = await networkFrame.evaluate(() => window.__clipboard);
  assert.match(websiteScopeReport, /本次范围：所选检测项目/);
  assert.deepEqual(coreLines(websiteScopeReport), coreLines(previousCoreReport), 'Website-only reports must preserve the previous core data and sampling times');
  assert.match(websiteScopeReport, /回归网站[\s\S]*单次/);
  await frame.locator('#connectivity').getByRole('combobox', { name: '网站分组', exact: true }).selectOption('ai');
  mode = 'standalone-dns'; const beforeSingleDns = external.length, beforeSingleDnsRpc = dnsRequests.length;
  await frame.locator('#dns-run').click();
  await expect(frame.locator('#dns-run')).toContainText('停止检测');
  await expect(frame.locator('#dns-run')).toBeEnabled();
  await expect(frame.locator('#rtc-run')).toBeDisabled();
  await expect(frame.locator('#start')).toBeDisabled();
  await expect(frame.locator('#stop')).toBeEnabled();
  await expect(frame.locator('#connectivity').getByRole('button', { name: '检测本组', exact: true })).toBeEnabled();
  await expect(frame.locator('#connectivity')).toContainText('保留已有结果');
  await expect(frame.locator('#ip4-address')).toHaveText(preserved.ip4);
  await expect(frame.locator('#rtc-list .rtc-item[data-state="ready"]')).toHaveCount(4);
  await expect(frame.locator('#dns-run')).toContainText('检测 DNS');
  await expect(frame.locator('#stop')).toBeDisabled();
  assert.equal(dnsRequests.length - beforeSingleDnsRpc, 300, 'Independent DNS must issue 300 browser samples');
  assert.ok(external.slice(beforeSingleDns).every(address => new URL(address).hostname.endsWith('.ipleak.net') || new URL(address).hostname === 'ipleak.net'), 'Independent DNS only contacts IPLeak sampling and metadata endpoints');
  assert.deepEqual(dnsRequests.slice(beforeSingleDnsRpc).map(call => call.step), Array.from({ length: 300 }, (_, i) => i + 1));
  const afterSingleDns = await networkFrame.evaluate(() => ({
    ip4: document.getElementById('ip4-address').textContent,
    ip6: document.getElementById('ip6-address').textContent,
    rtc: [...document.querySelectorAll('#rtc-list .rtc-address')].map(row => row.textContent),
    connections: window.__rtcConnections.length,
    websites: window.__websiteCalls.length,
    summary: window.__nativeMessages.findLast(message => message.kind === 'completed'),
  }));
  assert.equal(afterSingleDns.ip4, preserved.ip4); assert.equal(afterSingleDns.ip6, preserved.ip6);
  assert.deepEqual(afterSingleDns.rtc, preserved.rtc); assert.equal(afterSingleDns.connections, preserved.connections);
  assert.equal(afterSingleDns.websites, 1);
  assert.deepEqual(afterSingleDns.summary.statuses, ['skipped', 'skipped', 'ready', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);
  await expect(frame.locator('#progress-text')).toHaveText('1 / 1');

  mode = 'success'; const beforeSingleRtc = external.length, beforeSingleRtcRpc = dnsRequests.length;
  await networkFrame.evaluate(() => { window.__rtcMode = 'hold'; });
  await frame.locator('#rtc-run').click();
  await expect(frame.locator('#rtc-run')).toContainText('停止检测');
  await expect(frame.locator('#rtc-run')).toBeEnabled();
  await expect(frame.locator('#dns-run')).toBeDisabled();
  await expect(frame.locator('#start')).toBeDisabled();
  await expect(frame.locator('#stop')).toBeEnabled();
  await expect(frame.locator('#ip4-address')).toHaveText(preserved.ip4);
  await expect(frame.locator('#dns-overview-count')).toContainText('3');
  await networkFrame.evaluate(() => {
    window.__rtcConnections.slice(-4).forEach(pc => {
      pc.candidate('host', '192.168.1.3'); pc.candidate('host', 'hidden-address.local');
      pc.candidate('srflx', '93.184.216.34'); pc.candidate('srflx', '93.184.216.35');
    });
  });
  await expect(frame.locator('#rtc-run')).toContainText('检测 WebRTC');
  await expect(frame.locator('#stop')).toBeDisabled();
  await expect(frame.locator('#rtc-list .rtc-item[data-state="ready"]')).toHaveCount(4);
  assert.equal(external.length, beforeSingleRtc, 'Independent RTC must not send IP, DNS or website HTTP requests');
  assert.equal(dnsRequests.length, beforeSingleRtcRpc, 'Independent RTC must not use the DNS RPC');
  const afterSingleRtc = await networkFrame.evaluate(() => ({
    ip4: document.getElementById('ip4-address').textContent,
    ip6: document.getElementById('ip6-address').textContent,
    dns: document.getElementById('dns-list').textContent,
    rtc: [...document.querySelectorAll('#rtc-list .rtc-address')].map(row => row.textContent),
    connections: window.__rtcConnections.length,
    closed: window.__rtcConnections.slice(-4).every(pc => pc.closed),
    websites: window.__websiteCalls.length,
    summary: window.__nativeMessages.findLast(message => message.kind === 'completed'),
  }));
  assert.equal(afterSingleRtc.ip4, preserved.ip4); assert.equal(afterSingleRtc.ip6, preserved.ip6); assert.equal(afterSingleRtc.dns, preserved.dns);
  assert.deepEqual(afterSingleRtc.rtc, preserved.rtc); assert.equal(afterSingleRtc.connections, preserved.connections + 4); assert.ok(afterSingleRtc.closed);
  assert.equal(afterSingleRtc.websites, 1);
  assert.deepEqual(afterSingleRtc.summary.statuses, ['skipped', 'skipped', 'skipped', 'ready', 'ready', 'ready', 'ready', 'skipped']);
  await expect(frame.locator('#progress-text')).toHaveText('4 / 4');

  mode = 'cancel-dns'; const beforeSingleStop = external.length;
  await frame.locator('#dns-run').click();
  await expect.poll(() => external.length).toBeGreaterThan(beforeSingleStop);
  await expect(frame.locator('#dns-run')).toContainText('停止检测');
  await frame.locator('#dns-run').click();
  await expect(frame.locator('#dns-run')).toContainText('检测 DNS');
  await expect(frame.locator('#dns-status')).toHaveAttribute('data-state', 'cancelled');
  await expect(frame.locator('#rtc-run')).toBeEnabled();
  await expect(frame.locator('#start')).toBeEnabled();
  await expect(frame.locator('#stop')).toBeDisabled();
  const afterSingleStop = external.length, rpcAfterSingleStop = dnsRequests.length; await page.waitForTimeout(700);
  assert.equal(external.length, afterSingleStop, 'The DNS section stop button must prevent further probes');
  assert.equal(dnsRequests.length, rpcAfterSingleStop, 'The DNS section stop button must prevent later polling and result requests');
  await expect(frame.locator('#ip4-address')).toHaveText(preserved.ip4);
  await expect(frame.locator('#rtc-list .rtc-item[data-state="ready"]')).toHaveCount(4);
  assert.deepEqual(await networkFrame.evaluate(() => window.__nativeMessages.findLast(message => message.kind === 'completed').statuses), ['skipped', 'skipped', 'cancelled', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped']);

  await frame.locator('#clear').click();
  for (const name of ['公网 IP', 'WebRTC']) await toggleSampleOption(name);
  mode = 'cancel-dns'; const beforeStagedCancel = external.length;
  await frame.locator('#start').click();
  await expect.poll(() => external.length).toBeGreaterThan(beforeStagedCancel);
  await frame.locator('#stop').click(); await expect(frame.locator('#stop')).toBeDisabled();
  await page.waitForTimeout(700);
  assert.equal(await networkFrame.evaluate(() => window.__websiteCalls.length), 1, 'Stopping during core sampling must never start the queued website batch');
  const stagedStop = await networkFrame.evaluate(() => window.__nativeMessages.findLast(message => message.kind === 'completed'));
  assert.equal(stagedStop.statuses.length, 8); assert.equal(stagedStop.statuses[2], 'cancelled'); assert.equal(stagedStop.statuses[7], 'cancelled');

  // DNS must not be truncated by the former local probe/core deadlines.
  await frame.locator('#clear').click();
  await networkFrame.evaluate(() => {
    window.__realSetTimeout = window.setTimeout;
    window.__dnsSkipDeadlines = [];
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 85000 || delay === 8000) window.__dnsSkipDeadlines.push(delay);
      return window.__realSetTimeout(callback, delay, ...args);
    };
  });
  try {
    const beforeWaiting = external.length;
    await frame.locator('#start').click();
    await expect.poll(() => external.length).toBeGreaterThan(beforeWaiting);
    assert.deepEqual(await networkFrame.evaluate(() => window.__dnsSkipDeadlines), []);
    await expect(frame.locator('#stop')).toBeEnabled();
    await frame.locator('#stop').click(); await expect(frame.locator('#stop')).toBeDisabled();
    assert.equal(await networkFrame.evaluate(() => window.__websiteCalls.length), 1, 'An interrupted DNS run must not start the queued website batch');
  } finally {
    await networkFrame.evaluate(() => { window.setTimeout = window.__realSetTimeout; window.RoseConnectivity.run = window.__realWebsiteRun; });
  }

  // A separate browser context initializes the native bridge before scripts
  // load, matching WebView2's epoch handshake instead of a late UI stub.
  const nativePage = await browser.newPage();
  nativePage.on('pageerror', error => errors.push(error.message));
  await nativePage.route('**/api/session', mockSession);
  await nativePage.route('**/api/local', mockLocal);
  await nativePage.route('https://**/*', mockExternal);
  await nativePage.addInitScript(() => {
    const setTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => setTimeout(callback, delay === 1 || delay === 1000 ? 0 : delay, ...args);
    window.RTCPeerConnection = undefined;
    window.__nativeMessages = []; window.__nativeListeners = []; window.chrome ||= {};
    window.chrome.webview = {
      addEventListener: (name, callback) => {
        if (name !== 'message') return;
        window.__nativeListeners.push(callback);
        queueMicrotask(() => callback({ data: { kind: 'epoch', epoch: 'b'.repeat(32) } }));
      },
      removeEventListener: (name, callback) => { window.__nativeListeners = window.__nativeListeners.filter(listener => listener !== callback); },
      postMessage: message => {
        window.__nativeMessages.push(message);
      },
    };
  });
  try {
    mode = 'success'; await nativePage.goto(new URL('/network', testBaseURL).href);
    await nativePage.locator('#select-ip, #select-rtc, #select-connect').evaluateAll(inputs => inputs.forEach(input => { input.checked = false; }));
    await nativePage.locator('#start').click(); await expect(nativePage.locator('#stop')).toBeDisabled();
    await expect(nativePage.locator('#dns-status')).toHaveAttribute('data-state', 'ready');
    await expect(nativePage.locator('#dns-overview-count')).toContainText('3');
    const messages = await nativePage.evaluate(() => window.__nativeMessages);
    const nativeCalls = messages.filter(message => message.kind === 'dnsleaktest');
    assert.deepEqual(nativeCalls, [], 'WebView2 also samples DNS directly through the browser, without native DNS RPC');
    const summary = messages.findLast(message => message.kind === 'completed');
    assert.equal(summary.statuses.length, 8); assert.equal(summary.statuses[2], 'ready'); assert.equal(summary.epoch, 'b'.repeat(32));
  } finally { await nativePage.close(); }

  await page.locator('#sidebar-ui').getByRole('link', { name: '一键配置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '一键配置', exact: true })).toBeVisible();
  await expect(page.locator('a[href="#repair"], #page-repair, #build-plan, [name="repair-option"]')).toHaveCount(0);
  await expect(page.locator('#sidebar-ui .console-sidebar-content a')).toHaveText(['网络检测', '一键配置', 'Claude Code', '恢复记录']);
  const beforePlan = planRequests.length;
  await page.locator('#protect-now').click();
  await expect(page.locator('#protection-dialog')).toBeVisible();
  assert.equal(planRequests.length, beforePlan + 1);
  assert.equal(planRequests.at(-1).options, 111, 'One built-in plan covers sing-mix DNS/AI, system/Chrome/Edge/Firefox and Clash IPv6');
  await expect(page.locator('#disable-clash-ipv6, .clash-ipv6-setting')).toHaveCount(0);
  await expect(page.locator('#quick-review')).toContainText('关闭 Clash IPv6');
  await expect(page.locator('#protection-dialog .execute-plan')).toBeDisabled();
  assert.ok(!commands.includes('execute'), 'Opening one-click configuration only prepares a review');
  await page.locator('#protection-dialog .review-confirm').check();
  await expect(page.locator('#protection-dialog .execute-plan')).toBeEnabled();
  await page.locator('#close-protection').click();
  await expect(page.locator('#tabs-ui [role="tablist"]')).toHaveCount(0);

  // Legacy DNS-configuration links resolve to the same single configuration page.
  await page.evaluate(() => { location.hash = 'repair'; });
  await expect(page).toHaveURL(/#overview$/);
  await expect(page.locator('#page-overview')).toBeVisible();
  await expect(page.locator('#sidebar-ui a[href="#overview"]')).toHaveAttribute('aria-current', 'page');
  for (const state of ['unrecognized', 'managed']) {
    configurationState = state;
    await page.locator('#health-refresh').click();
    await expect(page.locator('#protect-now')).toBeDisabled();
    await expect(page.locator('#protect-label')).toHaveText('暂不可自动配置');
    if (state === 'unrecognized') await expect(page.locator('#health-note')).toHaveText('config.yaml 的 tun 必须是已存在的配置映射。');
    assert.equal(planRequests.length, beforePlan + 1, 'An unrecognized or managed environment cannot silently apply a partial plan');
  }
  configurationState = 'configured'; clashIpv6State = '已开启';
  await page.locator('#health-refresh').click();
  await expect(page.locator('#protect-now')).toBeEnabled();
  await expect(page.locator('#protect-label')).toHaveText('一键配置');
  await page.locator('#protect-now').click();
  await expect(page.locator('#protection-dialog')).toBeVisible();
  assert.equal(planRequests.at(-1).options, 111, 'IPv6 still enabled requires the same complete one-click plan');
  await expect(page.locator('#quick-review')).toContainText('ipv6: false');
  await page.locator('#close-protection').click();
  clashIpv6State = '已关闭';
  await page.locator('#health-refresh').click();
  await expect(page.locator('#protect-label')).toHaveText('检测配置效果');
  await page.locator('#protect-now').click();
  await expect(page.locator('#page-network')).toBeVisible();
  assert.equal(planRequests.length, beforePlan + 2, 'A fully configured device navigates to detection without another plan');
  await page.locator('#sidebar-ui').getByRole('link', { name: '一键配置', exact: true }).click();
  clashIpv6State = '无法自动修改'; await page.locator('#health-refresh').click();
  await expect(page.locator('#protect-now')).toBeDisabled();
  await expect(page.locator('#health-note')).toContainText('ipv6 必须是可识别的布尔值');
  clashIpv6State = '未设置'; await page.locator('#health-refresh').click();
  await expect(page.locator('#protect-now')).toBeEnabled();
  await expect(page.locator('#protect-label')).toHaveText('一键配置');
  assert.equal(planRequests.length, beforePlan + 2, 'Refreshing stored states must not silently prepare or apply a plan');
  configurationState = 'pending'; clashIpv6State = '已开启';
  await page.locator('#sidebar-ui').getByRole('link', { name: '恢复记录', exact: true }).click();
  await page.locator('[data-restore]').click();
  await expect(page.locator('#restore-dialog')).toBeVisible();
  await expect(page.locator('#restore-dialog .execute-plan')).toBeDisabled();
  await page.locator('#close-restore').click();
  await expect(page.locator('#restore-dialog')).toBeHidden();
  await page.locator('#support-author').click();
  await expect(page.locator('#support-dialog')).toBeVisible();
  await page.locator('#close-support').click();
  await expect(page.locator('#support-dialog')).toBeHidden();
  await page.locator('#support-author').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#support-dialog')).toBeHidden();
  await expect(page.locator('#support-author')).toBeFocused();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#sidebar-ui').getByRole('link', { name: '网络检测', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'console-dark.png'), fullPage: true });
  await page.getByRole('button', { name: '收起或展开功能侧栏' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-sidebar', 'collapsed');
  await expect(page.locator('#sidebar-ui').getByRole('link', { name: '一键配置', exact: true })).toBeVisible();
  await expectFullNavigationRow(desktopMenu, 'overview');
  await expect(page.locator('#support-author')).toBeVisible();
  await expect(page.getByRole('button', { name: '切换明暗主题' })).toHaveCount(0);
  await page.locator('#sidebar-ui').getByRole('link', { name: '网络检测', exact: true }).click();
  await page.locator('.network-jump-links a[href="#browser-network"]').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.network-jump-links a[href="#connectivity"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(frame.locator('#connectivity')).toBeInViewport();
  await page.locator('.network-jump-links a[href="#browser-network"]').click();
  await expect(frame.locator('.dashboard-network-header')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开功能菜单' }).click();
  const mobileMenu = page.getByRole('dialog', { name: '工作台导航' });
  await expect(mobileMenu).toBeVisible();
  await expectFullNavigationRow(mobileMenu.locator('[data-slot="sidebar-menu"]'), 'overview');
  await mobileMenu.getByRole('link').filter({ hasText: '网络检测' }).click();
  await expect(mobileMenu).not.toBeVisible();
  await expect(page.locator('[data-mobile="true"]')).toBeHidden();
  // Check the compact dashboard with real-shaped results, including a long
  // IPv6 address; placeholder dashes alone cannot expose metric overflow.
  for (const [id, name] of [['ip', '公网 IP'], ['dns', 'DNS 解析器'], ['rtc', 'WebRTC']]) {
    if (!(await frame.locator('#select-' + id).isChecked())) await toggleSampleOption(name);
  }
  if (await frame.locator('#select-connect').isChecked()) await toggleSampleOption('网站连通性');
  mode = 'success'; await networkFrame.evaluate(() => { window.__rtcMode = 'success'; });
  await frame.locator('#start').click(); await expect(frame.locator('#stop')).toBeDisabled();
  await expect(frame.locator('#ip6-address')).toHaveText('2606:4700:4700::1111');
  await expect(frame.locator('#dns-overview-count')).toContainText('3');
  await expect(frame.locator('#rtc-overview-count')).toHaveText('4');
  await openContext();
  await expect(page.locator('#context-ui')).toBeVisible();
  await expect(page.getByRole('switch', { name: '公网 IP', exact: true })).toBeEnabled();
  await closeContext();
  await expect(page.locator('#context-ui')).not.toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile shell must not overflow');
  assert.ok(await networkFrame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile diagnostics must not overflow');
  await page.screenshot({ path: path.join(artifacts, 'console-mobile.png'), fullPage: true });
  await page.goto(new URL('/#overview', testBaseURL).href);
  await page.locator('#health-refresh').click();
  await expect(page.locator('#clash-ipv6-status')).toHaveText('Clash IPv6：已开启');
  await expect(page.locator('#disable-clash-ipv6')).toHaveCount(0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile IPv6 settings must not overflow');
  await page.screenshot({ path: path.join(artifacts, 'configuration-mobile.png'), fullPage: true });
  assert.deepEqual(errors, [], 'No browser script errors');
  assert.ok(!commands.includes('execute'), 'UI tests never write real configuration');
  assert.ok(!commands.includes('auth-status') && !commands.includes('activate'), 'No activation requests remain');
  console.log('PASS: cold-start palette and page isolation, consistent navigation frames, desktop/mobile layout, IPLeak browser probes and cumulative hits, official resolver metadata and first-seen order, empty/error/cancel states, independent DNS/RTC actions and preserved results, section stops and scoped 8-status summaries, core-before-website phases, timeouts, one-click configuration with a fixed plan and guarded review, integrated one-click Clash IPv6 and stored states, unsupported/managed/configured states, legacy-link forwarding, support and preview boundaries.');
} catch (error) {
  console.error(JSON.stringify({ errors, commandCounts: commands.reduce((counts, command) => { counts[command] = (counts[command] || 0) + 1; return counts; }, {}), recentCommands: commands.slice(-20), message: await page.locator('#message').textContent(), support: await page.locator('#support-dialog').getAttribute('open') }));
  throw error;
} finally { await browser.close(); }
