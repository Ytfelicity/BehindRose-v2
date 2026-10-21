import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { expect } from '@playwright/test';
import { launchCaptureBrowser } from './browser-runtime.mjs';
import { verifyReactBitsSources } from './verify-reactbits-source.mjs';

const output = path.resolve('../docs/ui-reactbits-2026-10-02');
const evidence = path.join(output, 'evidence'); mkdirSync(evidence, { recursive: true });
const previous = existsSync(path.join(output, 'capture-manifest.json')) ? JSON.parse(readFileSync(path.join(output, 'capture-manifest.json'), 'utf8')) : null;
const manifest = { capturedAt: new Date().toISOString(), viewport: { width: 1600, height: 1000 },
  screenshotMethod: 'Chromium native page/element screenshots. No pixel generation, compositing or retouching.',
  applicationData: 'Actual running local service at 127.0.0.1:4317. No API mocks in these application screenshots. No sampling, activation, execution or restore writes.',
  application: [], components: [], errors: [] };
const definitions = [
  ['DotGrid','backgrounds/dot-grid','工作区背景点阵，随指针产生响应','network','.hero'],
  ['BlurText','text-animations/blur-text','五个页面主标题的模糊入场','network','.hero-heading'],
  ['GradientText','text-animations/gradient-text','统一侧栏中的品牌渐变文字','shell','.sidebar-brand'],
  ['SpotlightCard','components/spotlight-card','出口卡、解析结果、概览、设置、备份和认证弹窗','network','.ip-card'],
  ['AnimatedContent','animations/animated-content','业务卡片与面板的滚动入场','repair','.option-card'],
  ['CountUp','text-animations/count-up','右侧实际所选检测项目，以及检测取得的 DNS 数量','shell','.rb-probe-total'],
  ['ClickSpark','animations/click-spark','开始、停止、复制、清空按钮的点击粒子','network','#network-actions'],
  ['ShinyText','text-animations/shiny-text','右侧采样状态，运行时扫光，等待时静态','shell','.sample-summary'],
  ['StarBorder','animations/star-border','右侧 DNS 防护入口的流动边框','shell','.rb-protection-link'],
];
const browser = await launchCaptureBrowser();
try {
  const page = await browser.newPage({ viewport: manifest.viewport, reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('behindrose-theme', 'dark'));
  page.on('pageerror', error => manifest.errors.push(error.message));
  const external = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4317/')) external.push(request.url()); });
  await page.goto('http://127.0.0.1:4317/#network');
  await page.locator('#support-author').waitFor();
  const frame = page.frameLocator('#network-frame');
  await frame.locator('[data-rb-component="BlurText"][data-text-ready="true"]').waitFor();
  await expect(page.locator('.rb-probe-total [data-rb-component="CountUp"]')).toHaveText('3');
  await frame.locator('.ip-card [data-enter-state="done"]').first().waitFor();
  await page.screenshot({ path: path.join(evidence, 'app-network.png') });
  manifest.application.push({ view: 'network', title: '网络检测', url: page.url(), image: 'app-network.png', data: '真实本机服务，未开始外网检测' });
  for (const [name, route, location, scope, selector] of definitions.filter(item => item[3] !== 'repair')) {
    const locator = scope === 'network' ? frame.locator(selector).first() : page.locator(selector).first();
    await locator.scrollIntoViewIfNeeded();
    if (name === 'SpotlightCard') {
      const box = await locator.boundingBox(); await page.mouse.move(box.x + box.width * .64, box.y + box.height * .42);
      await expect(locator.locator('.card-spotlight')).toHaveCSS('--spotlight-color', 'rgba(112, 229, 189, 0.16)');
    }
    if (name === 'ClickSpark') await frame.locator('#clear').click(); // Clears only page memory; does not probe or modify system configuration.
    await locator.screenshot({ path: path.join(evidence, 'location-' + name + '.png') });
    manifest.components.push({ name, url: 'https://reactbits.dev/' + route, location, image: 'location-' + name + '.png', officialImage: 'official-' + name + '.png' });
  }
  for (const [view, title] of [['overview','防护概览'], ['repair','防护设置'], ['backups','恢复记录'], ['settings','偏好设置']]) {
    await page.goto('http://127.0.0.1:4317/#' + view);
    await page.locator('#page-' + view + ' [data-rb-component="BlurText"][data-text-ready="true"]').waitFor();
    const surface = page.locator('#page-' + view + ' [data-enter-state="done"]').first();
    if (view !== 'backups') await surface.waitFor();
    if (view === 'backups') await expect(page.locator('#backup-count')).not.toContainText('正在读取');
    // The page-title reveal may have completed on an earlier visit; allow the
    // independently animated navigation pill to settle before the evidence shot.
    await page.waitForTimeout(650);
    await page.screenshot({ path: path.join(evidence, 'app-' + view + '.png') });
    manifest.application.push({ view, title, url: page.url(), image: 'app-' + view + '.png', data: '真实本机服务，只读截图' });
    if (view === 'repair') {
      await page.locator('.option-card').screenshot({ path: path.join(evidence, 'location-AnimatedContent.png') });
      manifest.components.push({ name: 'AnimatedContent', url: 'https://reactbits.dev/animations/animated-content', location: definitions[4][2], image: 'location-AnimatedContent.png', officialImage: 'official-AnimatedContent.png' });
    }
  }
  await page.locator('#support-author').click();
  await expect(page.locator('#support-dialog')).toBeVisible();
  await page.locator('#support-dialog [data-enter-state="done"]').waitFor();
  await page.locator('#support-dialog').screenshot({ path: path.join(evidence, 'app-support.png') });
  manifest.application.push({ view: 'support', title: '赞赏作者弹窗', url: page.url(), image: 'app-support.png', data: '真实赞赏弹窗，等待作者提供收款码' });
  await page.locator('#close-support').click();
  await page.goto('http://127.0.0.1:4317/#network');
  await page.setViewportSize({ width: 390, height: 844 });
  await frame.locator('[data-rb-component="BlurText"][data-text-ready="true"]').waitFor();
  await page.screenshot({ path: path.join(evidence, 'app-mobile.png') });
  manifest.application.push({ view: 'mobile', title: '移动端网络检测', url: page.url(), image: 'app-mobile.png', viewport: { width: 390, height: 844 }, data: '真实页面，无接口替换' });
  if (external.length) throw Error('Unexpected external application requests: ' + external.join(', '));
  console.log('Captured 7 actual application views and 9 specific component locations.');

  // These images are captured from the exact official component pages supplied
  // by the React Bits llms.txt catalogue, not recreated local examples.
  const official = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  for (const component of manifest.components) {
    if (process.argv.includes('--reuse-official') && existsSync(path.join(evidence, component.officialImage))) {
      const earlier = previous?.components.find(item => item.name === component.name);
      component.officialCapturedUrl = earlier?.officialCapturedUrl ?? component.url;
      component.officialCapturedAt = earlier?.officialCapturedAt;
      continue;
    }
    await official.goto(component.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const stage = official.locator('.preview-stage').first(); await stage.waitFor({ timeout: 25000 });
    await stage.scrollIntoViewIfNeeded();
    await official.screenshot({ path: path.join(evidence, 'official-page-' + component.name + '.jpg'), type: 'jpeg', quality: 78 });
    await stage.screenshot({ path: path.join(evidence, component.officialImage) });
    component.officialCapturedUrl = official.url();
    component.officialCapturedAt = new Date().toISOString();
    console.log('Captured official React Bits ' + component.name);
  }
  const sha = content => crypto.createHash('sha256').update(content).digest('hex');
  const provenance = verifyReactBitsSources();
  for (const component of manifest.components) {
    const entry = provenance.find(entry => entry.name === component.name);
    component.registryUrl = entry.registryUrl;
    component.files = entry.files;
    if (!component.files.every(file => file.unchanged)) throw Error('React Bits source unexpectedly modified: ' + component.name);
  }
  if (manifest.errors.length) throw Error(manifest.errors.join('\n'));
  writeFileSync(path.join(output, 'capture-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('PASS: official source hashes match; actual app uses no mocks, no external probes, no config writes.');
} finally { await browser.close(); }
