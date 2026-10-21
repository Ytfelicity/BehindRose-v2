import {launchCaptureBrowser} from './browser-runtime.mjs';
import assert from 'node:assert/strict';
const browser=await launchCaptureBrowser();
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
 for(const theme of ['light','dark'])for(const view of ['network','overview','repair','backups','settings']){
  await page.addInitScript(t=>localStorage.setItem('behindrose-theme',t),theme);
  await page.goto('http://127.0.0.1:4317/#'+view);await page.locator('#support-author').waitFor();
  const audit=()=>{
   const allowed=new Set(['rgb(255, 255, 235)','rgb(26, 26, 26)','rgb(34, 34, 34)','rgb(240, 215, 255)','rgb(3, 79, 70)','rgb(255, 169, 70)','rgb(138, 138, 128)','rgb(228, 228, 208)','rgb(255, 255, 255)','rgba(0, 0, 0, 0)']);
   const unexpected=[];
   for(const el of document.querySelectorAll('body *')){
    if(!el.getClientRects().length||el.closest('svg'))continue;
    const s=getComputedStyle(el);
    for(const key of ['color','backgroundColor','backgroundImage','boxShadow']){
     if(key==='color'&&!Array.from(el.childNodes).some(n=>n.nodeType===3&&n.textContent.trim()))continue;
     if(!allowed.has(s[key])&&s[key]!=='none')unexpected.push({element:el.id||el.className,value:s[key],property:key});
    }
   }return unexpected;
  };
  const unexpected=await page.evaluate(audit);assert.deepEqual(unexpected,[],theme+' '+view+' uses only Refero colors, without gradients or shadows');
  if(view==='network')assert.deepEqual(await page.frames().find(f=>f.url().endsWith('/network')).evaluate(audit),[],theme+' diagnostic styles');
  console.log('PASS: '+theme+' '+view+' palette, gradients and shadows');
 }
}finally{await browser.close()}
