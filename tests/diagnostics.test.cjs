const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const window = {};
const context = vm.createContext({window, URL, TypeError});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/BehindRose.Desktop/Assets/diagnostics/flag-codes.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/BehindRose.Desktop/Assets/diagnostics/diagnostics-core.js'),'utf8'),context);
const r=window.RoseCheck;
assert.equal(r.ip('999.1.1.1'),null);
assert.equal(r.ip('example.test'),null);
assert.equal(r.ip('2001:db8::1').family,6);
assert.equal(r.ip('198.51.100.24').family,4);
assert.equal(r.ip('fe80::1%eth0'),null);
assert.equal(r.compare('198.51.100.24',['2001:db8::1']).tone,'neutral');
assert.equal(r.compare('198.51.100.24',['198.51.100.25']).tone,'warning');
assert.equal(r.compare('2001:db8::1',['2001:0db8:0:0:0:0:0:1']).tone,'ok');
assert.match(r.failure({name:'AbortError'},false),/超时/);
assert.match(r.failure({},true),/停止/);
assert.equal(r.text('a\u0000b'),'a b');
assert.equal(r.text(42),'');
assert.equal(r.text('x'.repeat(500)).length,180);
assert.equal(r.requestPolicy('no-cors').redirect,'follow');
assert.equal(r.requestPolicy('cors').redirect,'error');
assert.equal(r.requestPolicy('no-cors').credentials,'omit');
assert.throws(()=>r.requestPolicy('navigate'),/请求模式/);
const dnsRows=[{type:'dns',ip:'192.0.2.53'}];
assert.equal(r.dnsEntries(dnsRows),dnsRows);
assert.throws(()=>r.dnsEntries({error:'No DNS servers found. Try again...'}),/尚未记录/);
assert.throws(()=>r.dnsEntries({error:'Service unavailable'}),/DNS 服务返回/);
assert.throws(()=>r.dnsEntries({unexpected:[]}),/格式不匹配/);
assert.equal(r.country('jp','Japan').code,'JP');
assert.equal(r.country('','United States of America').name,'美国');
assert.equal(r.country('??','Unlisted region').code,'');
assert.equal(r.country(null,null).code,'');
assert.equal(r.network('AS13335 CloudFlare Inc').name,'Cloudflare');
assert.equal(r.network('AS15169 Google LLC').id,'AS15169');
const groups=r.groupDns([
  {address:'192.0.2.1',country:'United States of America',asn:'AS15169 Google LLC'},
  {address:'192.0.2.2',countryCode:'US',country:'United States',asn:'AS15169 Google LLC'},
  {address:'192.0.2.3',country:'Japan',asn:'AS16509 Amazon.com Inc.'}
]);
assert.equal(groups.length,2);
assert.equal(groups[0].rows.length,2);
assert.equal(groups[0].country.code,'US');
assert.equal(groups.reduce((count,g)=>count+g.rows.length,0),3);
console.log('PASS 31 diagnostic, country mapping and DNS grouping assertions');
