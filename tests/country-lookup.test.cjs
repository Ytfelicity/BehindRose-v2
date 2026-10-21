const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const assets=path.resolve(__dirname,'../src/BehindRose.Desktop/Assets/diagnostics');
const requested=[];const window={};
const context=vm.createContext({window,URL,TypeError,DataView,AbortSignal,fetch:async url=>{requested.push(url);const bytes=fs.readFileSync(path.join(assets,url.slice(1)));return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}}});
for(const file of ['flag-codes.js','diagnostics-core.js','country-lookup.js'])vm.runInContext(fs.readFileSync(path.join(assets,file),'utf8'),context);
(async()=>{
 const lookup=window.RoseCountryLookup.lookup;
 // Public DNS service addresses only; never copy measured user exits here.
 // Country labels follow the pinned offline database, not live DNS responses.
 assert.equal((await lookup('8.8.8.8')).code,'US');
 assert.equal((await lookup('1.1.1.1')).code,'AU');
 assert.equal((await lookup('223.5.5.5')).code,'CN');
 assert.equal((await lookup('2606:4700:4700::1111')).code,'CA');
 assert.equal((await lookup('2606:4700:4700:0:0:0:0:1111')).code,'CA');
 assert.equal((await lookup('2001:4860:4860::8888')).code,'CA');
 assert.equal((await lookup('2001:4860:4860:0:0:0:0:8888')).code,'CA');
 assert.equal(await lookup('not-an-ip'),null);assert.equal(await lookup('192.0.2.1'),null);
 assert.equal(await lookup('2001:db8::1'),null);
 const manifest=JSON.parse(fs.readFileSync(path.join(assets,'country-db/manifest.json'),'utf8'));
 const provider=path.resolve(__dirname,'../frontend/node_modules/@ip-location-db/dbip-country');
 assert.equal(JSON.parse(fs.readFileSync(path.join(provider,'package.json'),'utf8')).version,manifest.version,'Use the recorded database version');
 let comparisons=0;
 for(const family of [4,6]){
  const file=manifest.files.find(file=>file.name===`country${family}.bin`);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(assets,'country-db',file.name))).digest('hex'),file.sha256);
  const records=fs.readFileSync(path.join(provider,`dbip-country-ipv${family}-num.csv`),'utf8').trim().split(/\r?\n/);
  for(let index=0;index<records.length;index+=Math.max(1,Math.floor(records.length/128))){
   const [first,last,code]=records[index].split(','),start=BigInt(first),end=BigInt(last);
   for(const value of [start,(start+end)/2n,end]){
    const address=family===4?[24n,16n,8n,0n].map(shift=>String((value>>shift)&255n)).join('.'):value.toString(16).padStart(32,'0').match(/.{4}/g).join(':');
    assert.equal((await lookup(address))?.code||null,window.RoseCheck.country(code).code||null,`Match original CSV: IPv${family} record ${index}, ${address}`);
    comparisons++;
   }
  }
 }
 assert.deepEqual(requested,['/country-db/country4.bin','/country-db/country6.bin'],'Only two local asset requests, with no queried IP transmitted');
 console.log(`PASS: ${comparisons} original CSV boundary/midpoint comparisons, pinned data hashes/version, IPv4/IPv6 lookup, invalid/unknown addresses, database reuse and no external transmission.`);
})().catch(error=>{console.error(error);process.exitCode=1});
