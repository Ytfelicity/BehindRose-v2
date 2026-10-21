import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {expect} from '@playwright/test';
import {launchCaptureBrowser} from './browser-runtime.mjs';
const root=path.resolve('../docs/ui-refero-2026-10-02');
const browser=await launchCaptureBrowser();
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[],external=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url())});
 await page.goto(pathToFileURL(path.join(root,'设计规范对照.html')).href);await page.evaluate(()=>document.fonts.ready);
 await expect(page.locator('[data-view]')).toHaveCount(9);await expect(page.locator('#reuse .pair')).toHaveCount(4);
 await expect(page.locator('#sidebar .pair')).toHaveCount(2);
 await page.evaluate(()=>Promise.all(Array.from(document.querySelectorAll('main img')).map(i=>i.decode())));
 assert.ok(await page.evaluate(()=>Array.from(document.querySelectorAll('main img')).every(i=>i.complete&&i.naturalWidth>0)),'Embedded screenshots load');
 await page.locator('[data-view="5"]').click();await expect(page.locator('[data-shot="5"]')).toBeVisible();
 await page.locator('[data-shot="5"] img').click();await expect(page.locator('#zoom')).toBeVisible();await page.locator('#close').click();
 await page.locator('[data-view="0"]').click();await page.screenshot({path:path.join(root,'evidence/report-desktop.png')});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Report fits mobile');
 await page.screenshot({path:path.join(root,'evidence/report-mobile.png')});assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 console.log('PASS: offline HTML, all embedded screenshots, 9 view selectors, 4 official pairs, zoom and mobile.');
}finally{await browser.close()}
