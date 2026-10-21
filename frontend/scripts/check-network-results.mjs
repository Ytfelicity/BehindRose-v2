import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {expect} from '@playwright/test';
import {launchCaptureBrowser} from './browser-runtime.mjs';
const output=path.resolve('../docs/ui-refero-2026-10-02/evidence');mkdirSync(output,{recursive:true});
const browser=await launchCaptureBrowser();
try{
 const page=await browser.newPage({viewport:{width:1600,height:1050},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let geoFailure=false,localBaseline=false,geoRequests=0;
 await page.addInitScript(()=>{
  localStorage.setItem('behindrose-theme','light');
  window.RTCPeerConnection=class{
   constructor(config){this.host=config.iceServers[0].urls;this.iceGatheringState='new'}
   createDataChannel(){} createOffer(){return Promise.resolve({type:'offer',sdp:''})}
   setLocalDescription(){queueMicrotask(()=>{const address=this.host.includes('cloudflare')?'203.0.113.99':this.host.includes('twilio')?'2001:db8::18':this.host.includes('blackberry')?null:'203.0.113.18';if(address)this.onicecandidate?.({candidate:{type:'srflx',address,candidate:''}});this.onicecandidate?.({candidate:null})});return Promise.resolve()}
   close(){}
  };
 });
 // Only network sampling responses are fixtures. The page and local backend
 // are real, isolated browser rendering; no external probe or system write.
 await page.route('https://**/*',async route=>{
  const u=new URL(route.request().url()),headers={'Access-Control-Allow-Origin':'*'};
  if(u.hostname==='api.ipify.org')return route.fulfill({headers,json:{ip:localBaseline?'8.8.8.8':'203.0.113.18'}});
  if(u.hostname==='api6.ipify.org')return route.fulfill({headers,json:{ip:localBaseline?'2001:4860:4860::8888':'2001:db8::18'}});
  if(u.hostname==='ipapi.co'){geoRequests++;return geoFailure?route.fulfill({headers,status:503,body:'fixture unavailable'}):route.fulfill({headers,json:{ip:decodeURIComponent(u.pathname.split('/')[1]),country_code:'JP',country_name:'Japan',region:'Tokyo',city:'东京',org:'Amazon.com, Inc.',asn:'AS16509'}})};
  if(u.pathname==='/id')return route.fulfill({headers,body:'scanfixture'});
  if(u.pathname.startsWith('/dnsleak/test/'))return route.fulfill({headers,json:[
   {type:'dns',ip:'172.70.221.126',asn:'AS13335 Cloudflare, Inc.',country:'JP',country_name:'Japan'},
   {type:'dns',ip:'172.217.109.215',asn:'AS15169 Google LLC',country:'US',country_name:'United States'},
   {type:'dns',ip:'172.217.108.208',asn:'AS15169 Google LLC',country:'US',country_name:'United States'},
   {type:'dns',ip:'198.51.100.20',asn:'Example Network',country:'',country_name:''},
  ]});
  if(u.hostname.endsWith('.bash.ws'))return route.fulfill({headers,body:''});
  throw Error('Unexpected probe request '+u);
 });
 await page.goto('http://127.0.0.1:4317/#network');
 const frame=page.frameLocator('#network-frame');await expect(frame.locator('#start')).toBeEnabled();await page.getByRole('switch',{name:'网站连通性',exact:true}).click();
 await frame.locator('#start').click();
 await expect(frame.locator('#stop')).toBeDisabled();await expect(frame.locator('#dns-overview-count')).toContainText('4');
 await frame.locator('body').evaluate(()=>{for(const IP of ['203.0.113.18','2001:db8::18'])window.dispatchEvent(new CustomEvent('quality-report',{detail:{Head:{IP},Info:{CountryCode:'JP',Country:'Japan',City:'东京',Organization:'Example Network',ASN:'64500'}}}))});
 await expect(frame.locator('#dns-list .country-flag')).toHaveCount(2);
 await expect(frame.locator('#dns-list')).toContainText('地区未提供');
 await expect(frame.locator('.rtc-item').first()).toHaveClass(/different/);
 await expect(frame.locator('.rtc-item.different')).toContainText('203.0.113.99');
 await expect(frame.locator('.rtc-item.different')).toContainText('出口不同');
 await expect(frame.locator('.rtc-item.different .country-flag')).toHaveCount(0);
 await expect(frame.locator('#observation-title')).toContainText('1 个 WebRTC 来源的出口不同');
 await expect(frame.locator('.rtc-item .country-flag')).toHaveCount(2);
 await expect(frame.locator('.rtc-item').filter({hasText:'Google'})).toContainText('与公网 IP 一致');
 await expect(frame.locator('.rtc-item').filter({hasText:'BlackBerry'})).toContainText('无法确认');
 await expect(frame.locator('#dns-list .dns-group').first().locator('summary .group-preview')).toContainText('172.217.108.208');
 const nf=page.frames().find(f=>f.url().endsWith('/network'));
 await nf.evaluate(()=>Promise.all(Array.from(document.images).map(img=>img.decode())));
 await nf.evaluate(()=>{
  const note=document.createElement('p');note.textContent='示例结果 · 数据为测试样本，用于展示信息布局';note.style.cssText='font:14px/1.3 sans-serif;margin:0 0 16px;color:#1a1a1a;padding:8px 12px;border-left:4px solid #ffa946;background:#e4e4d0';document.querySelector('.hero').after(note);
 });
 await page.evaluate(()=>document.fonts.ready);await page.mouse.move(1200,20);
 await page.screenshot({path:path.join(output,'network-example.png')});
 await frame.locator('.dns-card').screenshot({path:path.join(output,'network-dns-example.png')});
 await frame.locator('.rtc-card').screenshot({path:path.join(output,'network-rtc-example.png')});
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile shell fits');
 assert.ok(await nf.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile results fit');
 // Capture the same diagnostic module standalone, so long screenshots are not
 // obscured by the parent workbench's fixed navigation and status bar.
 await page.goto('http://127.0.0.1:4317/network');await page.locator('#select-connect').uncheck();await page.locator('#start').click();await expect(page.locator('#stop')).toBeDisabled();await expect(page.locator('#dns-overview-count')).toContainText('4');
 await page.evaluate(()=>{const note=document.createElement('p');note.textContent='示例结果 · 数据为测试样本，用于展示信息布局';note.style.cssText='font:14px/1.3 sans-serif;margin:0 0 16px;color:#1a1a1a';document.querySelector('.hero').after(note)});
 await page.evaluate(()=>Promise.all(Array.from(document.images).map(img=>img.decode())));
 await page.screenshot({path:path.join(output,'network-example-mobile.png'),fullPage:true});
 await page.setViewportSize({width:1080,height:1000});await page.screenshot({path:path.join(output,'network-example-content.png'),fullPage:true});
 await page.locator('.dns-card').screenshot({path:path.join(output,'network-dns-example.png')});
 await page.locator('.rtc-card').screenshot({path:path.join(output,'network-rtc-example.png')});
 localBaseline=true;const beforeLocal=geoRequests;
 await page.locator('#clear').click();await page.locator('#start').click();await expect(page.locator('#stop')).toBeDisabled();
 await expect(page.locator('#ip4-place')).toContainText('美国');assert.equal(geoRequests,beforeLocal,'Retired ipapi.co endpoint is never called');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quality-report',{detail:{Head:{IP:'8.8.8.8'},Info:{CountryCode:'US',Country:'United States',City:'Test city',Organization:'Test network',ASN:'15169'}}})));
 await expect(page.locator('#ip4-network')).toContainText('Test network');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('quality-report',{detail:{Head:{IP:'1.1.1.1'},Info:{CountryCode:'JP',City:'Wrong exit',Organization:'Wrong network'}}})));
 await expect(page.locator('#ip4-network')).not.toContainText('Wrong');
 assert.deepEqual(errors,[]);
 writeFileSync(path.join(output,'network-example.json'),JSON.stringify({fixture:true,description:'Real local page rendered with explicit fixture sampling responses. Not the user’s measured network.',checks:'Flags for known regions only; all DNS addresses visible or expandable; WebRTC differences first; missing results remain uncertain; desktop/mobile overflow checks.'},null,2));
 console.log('PASS: DNS flags, visible IPs, unknown regions, RTC matches/differences/unavailable and mobile results. Screenshots explicitly labeled fixture data.');
}finally{await browser.close()}
