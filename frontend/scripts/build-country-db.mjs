import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const source=path.resolve('node_modules/@ip-location-db/dbip-country');
const target=path.resolve('../src/BehindRose.Desktop/Assets/diagnostics/country-db');mkdirSync(target,{recursive:true});
const manifest={provider:'DB-IP Lite',source:'https://db-ip.com/db/download/ip-to-country-lite',license:'CC BY 4.0',version:JSON.parse(readFileSync(path.join(source,'package.json'),'utf8')).version,generatedAt:new Date().toISOString(),files:[]};
for(const family of [4,6]){
 const size=family===4?10:34;
 const rows=readFileSync(path.join(source,`dbip-country-ipv${family}-num.csv`),'utf8').trim().split(/\r?\n/);
 const records=[];
 for(const row of rows){const [first,last,country]=row.split(',');if(!/^[A-Z]{2}$/.test(country)||!/^\d+$/.test(first)||!/^\d+$/.test(last))throw Error('Invalid database row');const start=BigInt(first),end=BigInt(last);if(start>end||(records.length&&start<=records.at(-1).end))throw Error('Invalid database order');const previous=records.at(-1);if(previous&&previous.country===country&&previous.end+1n===start)previous.end=end;else records.push({start,end,country})}
 const bytes=Buffer.alloc(records.length*size);
 records.forEach(({start,end,country},i)=>{const offset=i*size;if(family===4){bytes.writeUInt32BE(Number(start),offset);bytes.writeUInt32BE(Number(end),offset+4)}else{bytes.writeBigUInt64BE(start>>64n,offset);bytes.writeBigUInt64BE(start&((1n<<64n)-1n),offset+8);bytes.writeBigUInt64BE(end>>64n,offset+16);bytes.writeBigUInt64BE(end&((1n<<64n)-1n),offset+24)}bytes.write(country,offset+size-2,2,'ascii')});
 const name=`country${family}.bin`;writeFileSync(path.join(target,name),bytes);manifest.files.push({name,records:records.length,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
copyFileSync(path.join(source,'DBIP-LICENSE'),path.join(target,'DBIP-LICENSE.txt'));writeFileSync(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest.files));
