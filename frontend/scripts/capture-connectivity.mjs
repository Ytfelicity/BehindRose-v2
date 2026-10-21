import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { launchCaptureBrowser } from './browser-runtime.mjs';
const output = path.resolve('../docs/ui-refero-2026-10-02/evidence');
const browser = await launchCaptureBrowser();
const page = await browser.newPage({ viewport: { width: 1408, height: 1000 }, reducedMotion: 'reduce' });
const errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.url().startsWith('https://')) requests.push({ url: request.url(), method: request.method() }); });
try {
  // Actual browser requests. No route interception, backend mocks or injected results.
  await page.goto('http://127.0.0.1:4317/#network');
  const frame = page.frameLocator('#network-frame');
  await expect(frame.locator('#connectivity')).toBeVisible();
  const network = page.frames().find(item => item.url().endsWith('/network'));
  await network.evaluate(() => Promise.all(Array.from(document.images).map(img => img.decode())));
  await frame.getByRole('button', { name: '检测本组' }).click();
  await expect(frame.locator('#connectivity')).toHaveAttribute('data-running', 'false', { timeout: 40000 });
  assert.equal(requests.length, 15); assert.ok(requests.every(request => request.method === 'HEAD'));
  await page.evaluate(() => {
    const frame = document.getElementById('network-frame');
    const top = frame.getBoundingClientRect().top + scrollY + frame.contentDocument.getElementById('connectivity').getBoundingClientRect().top;
    scrollTo(0, top - 128);
  });
  await page.screenshot({ path: path.join(output, 'connectivity-real-workbench.png') });
  await frame.locator('#connectivity').screenshot({ path: path.join(output, 'connectivity-real-section.png') });
  const results = await frame.locator('.connectivity-row').evaluateAll(rows => rows.map(row => ({ site: row.getAttribute('aria-label'), state: row.dataset.state, text: row.textContent })));
  // Capture the actual standalone module on mobile to avoid the parent window's
  // fixed header/status bar being painted over a long component screenshot.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  mobile.on('pageerror', error => errors.push(error.message));
  await mobile.goto('http://127.0.0.1:4317/network');
  await mobile.getByRole('button', { name: '检测本组' }).click();
  await expect(mobile.locator('#connectivity')).toHaveAttribute('data-running', 'false', { timeout: 40000 });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.locator('#connectivity').screenshot({ path: path.join(output, 'connectivity-real-mobile.png') });
  assert.deepEqual(errors, []);
  writeFileSync(path.join(output, 'connectivity-real.json'), JSON.stringify({ capturedAt: new Date().toISOString(), source: 'Actual Chrome requests from the running localhost app; no API interception or injected results', scope: 'HTTPS HEAD response time; opaque cross-origin responses do not verify login or AI service permissions', requests, results }, null, 2));
  console.log(JSON.stringify({ real: true, requests: requests.length, results }));
} finally { await browser.close(); }
