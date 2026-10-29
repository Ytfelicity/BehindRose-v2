import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath && !existsSync(chromium.executablePath())) {
  const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  executablePath = readdirSync(cache).filter(name => /^chromium-\d+$/.test(name)).sort().reverse()
    .map(name => path.join(cache, name, 'chrome-win64/chrome.exe')).find(existsSync);
}
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
let installed = false, noChanges = false;
const requests = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/session', route => route.fulfill({ json: { ready: true, token: 'configuration-test' } }));
await page.route('**/api/local', async route => {
  const request = route.request().postDataJSON(); requests.push(request);
  const data = {
    status: { operation: null },
    'quality-proxies': { candidates: [], notes: [] },
    'quality-status': { state: 'idle', current: 0, total: 1, stage: '尚未开始' },
    'proxy-network-status': { state: 'idle', current: 0, total: 0, stage: '尚未开始' },
    health: { checkedAt: '2026-10-26T18:00:00+08:00', demo: false,
      host: { found: false, compatible: true, running: false, version: '未识别', note: '已识别保存的 Clash 配置，完成后请手动打开 Clash。' },
      findings: ['系统流量接管', 'Chrome DNS', 'Edge DNS', 'Firefox DNS'].map(title => ({ title, state: '已配置', detail: '保存的配置' })),
      clashIpv6: { title: 'Clash IPv6', state: '已关闭', detail: 'ipv6: false' },
      singMix: { title: 'sing-mix DNS 与 AI 分流', state: installed ? '已配置' : '待配置', detail: '本地覆写状态' } },
    plan: { id: 'a'.repeat(32), action: 'apply', needsClashExit: true, clashRunning: false, changes: noChanges ? [] : [
      { title: '当前订阅的 DNS 与 AI 覆写', beforeText: '当前脚本', afterText: '先执行原脚本，再增量修复 DNS；保留节点、策略组和原有分流' },
      { title: 'sing-mix：DNS、AI 分流和缓存', beforeText: '原 DNS', afterText: '默认 DoH 经全部组；AI 经独立组' } ], tun: [
      { title: 'TUN 模式堆栈', detail: 'Mips', state: '沿用当前' },
      { title: '虚拟网卡名称', detail: 'CustomTun', state: '保留' },
      { title: '最大传输单元（MTU）', detail: '1400', state: '保留' },
      { title: 'DNS 劫持', detail: 'any:53、tcp://any:53；保留已有条目', state: '自动配置' },
      { title: '流量出口接口', detail: '沿用手动指定的出口网卡', state: '保留手动设置' }
    ] },
  }[request.command];
  await route.fulfill({ json: { ok: true, data: data ?? {} } });
});
try {
  await page.goto(new URL('/#overview', process.env.BEHINDROSE_TEST_URL || 'http://127.0.0.1:4317/').href);
  await expect(page.locator('#host-status')).toHaveText('已退出 · 配置结构已识别');
  await expect(page.locator('#protect-now')).toBeEnabled();
  await expect(page.locator('#protect-label')).toHaveText('一键配置');
  await expect(page.locator('#reconfigure-now')).toBeHidden();
  await expect(page.locator('#health-note')).toContainText('6 个检测站点');
  await expect(page.locator('#health-note')).toContainText('网易／战网直连');
  await page.locator('#protect-now').click();
  assert.equal(requests.find(request => request.command === 'plan').options, 111);
  await expect(page.locator('#quick-review')).toContainText('保留节点、策略组和原有分流');
  await expect(page.locator('#quick-review')).toContainText('Clash 关闭');
  await expect(page.locator('#quick-review')).not.toContainText('先启动');
  await expect(page.locator('#quick-review .tun-preview dl>div').filter({ has: page.locator('dt', { hasText: 'TUN 模式堆栈' }) }).locator('dd>span')).toHaveText('Mips');
  await expect(page.locator('#quick-review .tun-preview')).toContainText('CustomTun');
  await expect(page.locator('#quick-review .tun-preview')).toContainText('1400');
  await expect(page.locator('#quick-review .tun-preview')).toContainText('保留手动设置');
  await expect(page.locator('#quick-review .tun-preview')).toContainText('tcp://any:53');
  await expect(page.locator('#protection-dialog .execute-plan')).toBeDisabled();
  await page.locator('#protection-dialog .review-confirm').check();
  await expect(page.locator('#protection-dialog .execute-plan')).toBeEnabled();
  assert.ok(!requests.some(request => request.command === 'execute'), 'Preview never applies real settings');
  await page.locator('#close-protection').click();
  installed = true;
  await page.locator('#health-refresh').click();
  await expect(page.locator('#protect-label')).toHaveText('检测配置效果');
  await expect(page.locator('#health-note')).toContainText('DNS 增量防护');
  await expect(page.locator('#health-note')).toContainText('请检测实际 DNS 出口');
  await expect(page.locator('#reconfigure-now')).toBeVisible();
  await expect(page.locator('#reconfigure-now')).toBeEnabled();
  const primaryBox = await page.locator('#protect-now').boundingBox();
  const retryBox = await page.locator('#reconfigure-now').boundingBox();
  assert.ok(retryBox.x >= primaryBox.x + primaryBox.width && Math.abs(retryBox.y - primaryBox.y) < 3, 'Retry sits beside the detection button on desktop');
  const plansBeforeRetry = requests.filter(request => request.command === 'plan').length;
  await page.locator('#reconfigure-now').click();
  await expect(page.locator('#protection-dialog')).toBeVisible();
  assert.equal(requests.filter(request => request.command === 'plan').length, plansBeforeRetry + 1, 'Retry creates a fresh preview even when saved configuration is ready');
  assert.equal(requests.filter(request => request.command === 'plan').at(-1).options, 111);
  await expect(page.locator('#protection-dialog .execute-plan')).toBeDisabled();
  assert.ok(!requests.some(request => request.command === 'execute'), 'Retry still requires confirmation before applying');
  await page.locator('#close-protection').click();
  noChanges = true;
  await page.locator('#reconfigure-now').click();
  await expect(page.locator('#quick-review')).toContainText('无需重复调整');
  await expect(page.locator('#protection-dialog .execute-plan')).toHaveCount(0);
  await page.locator('#close-protection').click();
  await page.setViewportSize({ width: 430, height: 900 });
  await expect(page.locator('#reconfigure-now')).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  noChanges = false;
  installed = false;
  await page.locator('#health-refresh').click();
  await expect(page.locator('#protect-label')).toHaveText('一键配置');
  await expect(page.locator('#reconfigure-now')).toBeHidden();
  await page.setViewportSize({ width: 430, height: 900 });
  await expect(page.locator('#protect-now')).toBeEnabled();
  await page.locator('#protect-now').click();
  await expect(page.locator('#quick-review .tun-preview')).toBeVisible();
  await page.locator('#protection-dialog .review-confirm').check();
  await expect(page.locator('#protection-dialog .execute-plan')).toBeEnabled();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#close-protection').click();
  assert.deepEqual(errors, []);
  console.log('PASS: configuration and retry entry, fresh options=111 previews, no-op handling, consent guard and mobile layout');
} finally { await browser.close(); }
