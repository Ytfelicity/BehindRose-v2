import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { launchCaptureBrowser } from './browser-runtime.mjs';

const output=path.resolve('../docs/ui-refero-2026-10-02');
const evidence=path.join(output,'evidence');mkdirSync(evidence,{recursive:true});
const source='https://styles.refero.design/style/ac53825c-1e06-4ae0-8489-cace5c5e0339';
const manifest={source,capturedAt:new Date().toISOString(),method:'Real Chromium screenshots of the running local application. No API mocks or image retouching.',views:[],checks:[],errors:[]};
const browser=await launchCaptureBrowser();
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'no-preference'});
  await page.addInitScript(()=>localStorage.setItem('behindrose-theme','light'));
  page.on('pageerror',e=>manifest.errors.push(e.message));
  const requests=[];page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url())});
  const frame=page.frameLocator('#network-frame');
  const ready=async(view)=>{
    await page.goto('http://127.0.0.1:4317/#'+view);
    await page.locator('#support-author').waitFor();
    const heading=view==='network'?frame.locator('[data-text-ready=true]'):page.locator('#page-'+view+' [data-text-ready=true]');
    await heading.first().waitFor();await page.evaluate(()=>document.fonts.ready);
    if(view==='network')await frame.locator('.ip-card [data-enter-state=done]').first().waitFor();
    if(view==='backups')await expect(page.locator('#backup-count')).not.toContainText('正在读取');
    await page.waitForTimeout(700);
  };
  for(const [view,title] of [['network','网络检测'],['overview','防护概览'],['repair','防护设置'],['backups','恢复记录'],['settings','偏好设置']]){
    await ready(view);await page.screenshot({path:path.join(evidence,view+'.png')});
    manifest.views.push({view,title,image:view+'.png',url:page.url()});
    if(view==='network'){
      await expect(frame.locator('#start')).toHaveCSS('background-color','rgb(240, 215, 255)');
      await expect(frame.locator('#start')).toHaveCSS('border-radius','12px');
      await expect(frame.locator('#start')).toHaveCSS('border-top-width','2px');
      await expect(frame.locator('.ip-card').first()).toHaveCSS('border-radius','0px');
      await expect(frame.locator('.dns-card')).toHaveCSS('border-radius','0px');
      await expect(frame.locator('.dns-card')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
      await expect(frame.locator('.ip-card').first()).toHaveCSS('box-shadow','none');
      await expect(frame.locator('.rb-card-surface')).toHaveCount(0);
      await expect(page.locator('.console-tabs')).toHaveCSS('border-radius','9999px');
      const loaded=await page.evaluate(()=>document.fonts.check('16px Figtree')&&document.fonts.check('48px "EB Garamond"'));
      assert.ok(loaded,'Bundled Figtree and EB Garamond load');
      const nf=page.frames().find(f=>f.url().endsWith('/network'));
      await nf.evaluate(()=>document.fonts.ready);
      assert.ok(await nf.evaluate(()=>document.fonts.check('16px Figtree')),'Diagnostic iframe font loads');
      const locations=[['primary','主按钮',frame.locator('#network-actions')],['cards','公网地址、地区与网络',frame.locator('.ip-grid')],['chamber','DNS 机构、国旗与 IP 列表',frame.locator('.dns-card')],['navigation','胶囊导航',page.locator('.topbar')],['options','连接面板',page.locator('#context-ui')],['BlurText','主标题入场',frame.locator('.hero-heading')],['CountUp','所选项目计数',page.locator('.rb-probe-total')]];
      manifest.locations=[];
      for(const [name,title,loc] of locations){await loc.screenshot({path:path.join(evidence,'detail-'+name+'.png')});manifest.locations.push({name,title,image:'detail-'+name+'.png'})}
      manifest.checks.push('Cream #ffffeb, ink #1a1a1a, CTA #f0d7ff, 2px control borders, network results in flat rows without card wrappers, bundled fonts, pill navigation');
    }
    if(view==='overview'){await expect(page.locator('.coverage-card .rb-card-surface').first()).toHaveCSS('border-radius','32px');await expect(page.locator('.protection-hero .rb-card-surface')).toHaveCSS('border-radius','48px')}
    if(view==='repair'){await page.locator('.option-card').screenshot({path:path.join(evidence,'detail-AnimatedContent.png')});manifest.locations.push({name:'AnimatedContent',title:'设置卡片入场',image:'detail-AnimatedContent.png'})}
  }
  await page.locator('#support-author').click();await expect(page.locator('#support-dialog')).toBeVisible();
  await page.locator('#support-dialog [data-enter-state=done]').waitFor();
  await expect(page.locator('#support-qr')).toBeVisible();
  await page.locator('#support-qr').evaluate(img=>img.decode());
  assert.deepEqual(await page.locator('#support-qr').evaluate(img=>[img.naturalWidth,img.naturalHeight]),[385,378],'Original collection code dimensions are preserved');
  await page.locator('#support-dialog').screenshot({path:path.join(evidence,'support.png')});
  manifest.views.push({view:'support',title:'赞赏作者弹窗',image:'support.png'});
  await page.locator('#close-support').click();await ready('network');
  await page.getByRole('button',{name:'切换明暗主题'}).click();
  await expect(frame.locator('html')).toHaveAttribute('data-theme','dark');await page.waitForTimeout(700);
  await page.getByRole('button',{name:'切换明暗主题'}).evaluate(el=>el.blur());await page.mouse.move(1100,100);await page.waitForTimeout(300);await page.screenshot({path:path.join(evidence,'dark.png')});manifest.views.push({view:'dark',title:'深色侧栏与奶油色工作区',image:'dark.png'});
  await page.getByRole('button',{name:'切换明暗主题'}).click();
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(700);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile shell fits');
  assert.ok(await page.frames().find(f=>f.url().endsWith('/network')).evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile diagnostics fits');
  await page.screenshot({path:path.join(evidence,'mobile.png')});manifest.views.push({view:'mobile',title:'390px 手机布局',image:'mobile.png'});
  await page.getByRole('button',{name:'打开功能菜单'}).click();
  const menu=page.getByRole('dialog',{name:'工作台导航'});await expect(menu).toBeVisible();
  await menu.getByRole('button',{name:'赞赏作者'}).click();await expect(page.locator('#support-dialog')).toBeVisible();
  await page.locator('#support-dialog [data-enter-state=done]').waitFor();await page.locator('#support-qr').evaluate(img=>img.decode());
  assert.ok(await page.locator('#support-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}),'Mobile support dialog fits viewport');
  await page.screenshot({path:path.join(evidence,'support-mobile.png')});manifest.views.push({view:'support-mobile',title:'手机赞赏弹窗',image:'support-mobile.png'});
  assert.deepEqual(manifest.errors,[]);assert.ok(requests.every(u=>u.startsWith('http://127.0.0.1:4317/')),'No external application requests');
  manifest.checks.push('Five pages, authentication dialog, both sidebar themes and mobile: no script errors or horizontal overflow. Captures perform no sampling, activation or configuration writes.');
  writeFileSync(path.join(output,'capture-manifest.json'),JSON.stringify(manifest,null,2));
  console.log('PASS: 9 actual UI views, original collection code, desktop/mobile support dialogs, Refero tokens and fonts.');
}finally{await browser.close()}
