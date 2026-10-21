import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';
import { launchCaptureBrowser } from './browser-runtime.mjs';

// Capture the running app without replacing its API responses or starting sampling.
const output = path.resolve('../docs/ui-refero-2026-10-02/evidence');
mkdirSync(output, { recursive: true });
const browser = await launchCaptureBrowser();
const page = await browser.newPage({ viewport: { width: 1408, height: 821 } });
const errors = [], external = [], rows = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.url().startsWith('https://')) external.push(request.url()); });
async function hoverRow(menu, destination, state) {
  const item = menu.locator(`[data-slot="sidebar-menu-item"]:has(a[href="#${destination}"])`);
  const link = item.locator('a');
  await link.hover();
  const pill = item.locator(':scope > .pointer-events-none > .pointer-events-none');
  await expect(pill).toBeVisible();
  await expect.poll(async () => {
    const row = await link.boundingBox(), background = await pill.boundingBox();
    return row && background && ['x', 'y', 'width', 'height'].every(key => Math.abs(row[key] - background[key]) < 1);
  }).toBeTruthy();
  await expect(pill).toHaveCSS('border-radius', '12px');
  rows.push({ state, destination, row: await link.boundingBox(), hover: await pill.boundingBox() });
}
try {
  await page.goto('http://127.0.0.1:4317/#network');
  await page.evaluate(() => document.fonts.ready);
  const menu = page.locator('#sidebar-ui .console-sidebar-content [data-slot="sidebar-menu"]');
  for (const destination of ['overview', 'repair', 'backups', 'network', 'repair', 'overview']) {
    await hoverRow(menu, destination, 'expanded');
  }
  await page.waitForTimeout(400); // Finish the beUI spring before taking the screenshot.
  await page.screenshot({ path: path.join(output, 'sidebar-hover-fixed.png') });
  await page.locator('.console-sidebar-panel').screenshot({ path: path.join(output, 'sidebar-hover-fixed-detail.png') });
  await menu.screenshot({ path: path.join(output, 'sidebar-hover-fixed-menu.png') });
  await page.getByRole('button', { name: '切换明暗主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await hoverRow(menu, 'overview', 'dark');
  await page.waitForTimeout(400);
  await page.locator('.console-sidebar-panel').screenshot({ path: path.join(output, 'sidebar-hover-dark.png') });
  await page.getByRole('button', { name: '收起或展开功能侧栏' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-sidebar', 'collapsed');
  await hoverRow(menu, 'overview', 'collapsed');
  await page.waitForTimeout(400);
  await page.locator('.console-sidebar-panel').screenshot({ path: path.join(output, 'sidebar-hover-collapsed.png') });
  await menu.locator('a[href="#overview"]').click();
  await expect(page.locator('#page-overview')).toBeVisible();
  await expect(menu.locator('a[href="#overview"]')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '切换明暗主题' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开功能菜单' }).click();
  const mobile = page.getByRole('dialog', { name: '工作台导航' });
  await expect(mobile).toBeVisible();
  await hoverRow(mobile.locator('[data-slot="sidebar-menu"]'), 'network', 'mobile');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(output, 'sidebar-hover-mobile.png') });
  await mobile.locator('a[href="#network"] small').click();
  await expect(mobile).toBeHidden();
  await expect(page.locator('#page-network')).toBeVisible();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, [], 'Sidebar checks must not start network sampling');
  writeFileSync(path.join(output, 'sidebar-hover-checks.json'), JSON.stringify({ capturedAt: new Date().toISOString(), source: 'Actual localhost app; original API responses; normal motion; no sampling', rows }, null, 2));
  console.log('PASS: full-row hover with normal animation, light/dark themes, collapsed navigation and mobile selection. Actual app screenshots saved.');
} finally { await browser.close(); }
