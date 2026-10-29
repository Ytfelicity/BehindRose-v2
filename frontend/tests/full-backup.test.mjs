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
const requests = [], errors = [];
let records = [], operation = null, restored = false, rejectRestore = false;
const backupId = 'a'.repeat(32), planId = 'b'.repeat(32);
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/session', route => route.fulfill({ json: { ready: true, token: 'full-backup-fixture' } }));
await page.route('**/api/local', async route => {
  const request = route.request().postDataJSON(); requests.push(request);
  let data;
  switch (request.command) {
    case 'status': data = { operation }; break;
    case 'health': data = { checkedAt: '2026-10-27T10:00:00+08:00', demo: false,
      host: { compatible: restored, running: false, found: true, version: 'fixture', note: '配置丢失，可从完整备份恢复。' },
      findings: [{ title: 'Clash 配置', state: restored ? '已配置' : '未找到', detail: '示例状态' }],
      clashIpv6: { title: 'Clash IPv6', state: '未找到', detail: '配置缺失' }, singMix: { title: 'DNS 防护', state: '未找到', detail: '配置缺失' } }; break;
    case 'backups': data = []; break;
    case 'clash-full-backups': data = records; break;
    case 'clash-full-backup':
      records = [{ id: backupId, createdAt: '2026-10-27T10:00:00+08:00', reason: 'manual', fileCount: 12, totalBytes: 4096, complete: true, canRestore: true, state: 'available' }];
      operation = { id: 'c'.repeat(32), action: 'full-backup', done: true, message: '已在本机加密保存完整配置。', result: { success: true, state: 'backed-up' } };
      data = { operation: { ...operation, done: false } }; break;
    case 'clash-full-restore-plan':
      data = { id: planId, action: 'full-restore', preview: { backupId, fileCount: 12, writeCount: 12, removeCount: 2, complete: true, clashRunning: false } }; break;
    case 'clash-full-restore':
      if (rejectRestore) { await route.fulfill({ status: 409, json: { error: '预览后本机配置发生变化，已停止恢复。' } }); return; }
      restored = true;
      operation = { id: 'd'.repeat(32), action: 'full-restore', done: true, message: '完整配置已恢复。', result: { success: true, state: 'restored' } };
      data = { operation: { ...operation, done: false } }; break;
    default: data = {};
  }
  await route.fulfill({ json: { data } });
});
try {
  await page.goto(new URL('/#backups', process.env.BEHINDROSE_TEST_URL || 'http://127.0.0.1:4317/').href);
  await expect(page.locator('#full-backup-create')).toBeEnabled();
  await expect(page.locator('#full-backup-list')).toContainText('尚无完整备份');
  await expect(page.locator('.full-backup-privacy')).toContainText('不进入源码和安装包');
  await page.locator('#full-backup-create').click();
  await expect(page.locator('#full-backup-create')).toBeDisabled();
  await expect(page.locator('#operation-title')).toHaveText('完整备份已保存在本机', { timeout: 6000 });
  await expect(page.locator('[data-full-restore]')).toBeEnabled();
  await page.locator('[data-full-restore]').click();
  await expect(page.locator('#restore-review')).toContainText('移除备份后新增的 2 个文件');
  await expect(page.locator('#restore-review .execute-plan')).toBeDisabled();
  assert.equal(requests.filter(item => item.command === 'clash-full-restore').length, 0, 'Review cannot restore automatically');
  await page.locator('#restore-review .review-confirm').check();
  await page.locator('#restore-review .execute-plan').click();
  await expect(page.locator('#operation-title')).toHaveText('完整配置已恢复', { timeout: 6000 });
  assert.equal(requests.filter(item => item.command === 'clash-full-restore').length, 1);
  assert.deepEqual(requests.find(item => item.command === 'clash-full-backup'), { command: 'clash-full-backup' });
  assert.deepEqual(requests.find(item => item.command === 'clash-full-restore'), { command: 'clash-full-restore', planId });
  rejectRestore = true;
  await page.locator('[data-full-restore]').click();
  await expect(page.locator('#restore-dialog')).toBeVisible();
  await expect(page.locator('#restore-review .review-confirm')).not.toBeChecked();
  await page.locator('#restore-review .review-confirm').check();
  await page.locator('#restore-review .execute-plan').click();
  await expect(page.locator('#restore-review [role="alert"]')).toContainText('已停止恢复');
  await page.locator('#close-restore').click();
  await page.setViewportSize({ width: 430, height: 932 });
  await expect(page.locator('#full-backup-create')).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Backup cards must fit mobile layout');
  assert.deepEqual(errors, []);
  console.log('PASS: local backup, recovery with missing Clash configuration, consent, stale-preview error, opaque API requests and mobile layout');
} finally { await browser.close(); }
