/* DB-IP Lite country lookup. Address stays in this browser; no external query.
   Database and attribution: /country-db/manifest.json, https://db-ip.com/ */
'use strict';
(() => {
  const loaded=new Map();
  async function database(family){
    if(!loaded.has(family))loaded.set(family,(async()=>{
      const response=await fetch('/country-db/country'+family+'.bin',{credentials:'omit',cache:'force-cache',signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error('本地国家数据库未加载');const bytes=await response.arrayBuffer();const size=family===4?10:34;
      if(!bytes.byteLength||bytes.byteLength>16*1024*1024||bytes.byteLength%size)throw Error('本地国家数据库格式无效');return {view:new DataView(bytes),size,count:bytes.byteLength/size};
    })().catch(error=>{loaded.delete(family);throw error}));
    return loaded.get(family);
  }
  function number(parsed){
    if(parsed.family===4)return parsed.address.split('.').reduce((n,v)=>(n<<8n)+BigInt(v),0n);
    const parts=parsed.address.split('::'),left=parts[0]?parts[0].split(':'):[],right=parts[1]?parts[1].split(':'):[];
    const words=parts.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
    return words.reduce((n,v)=>(n<<16n)+BigInt('0x'+v),0n);
  }
  async function lookup(address){
    const parsed=window.RoseCheck.ip(address);if(!parsed)return null;const value=number(parsed),{view,size,count}=await database(parsed.family);
    const read=offset=>parsed.family===4?BigInt(view.getUint32(offset)):(view.getBigUint64(offset)<<64n)+view.getBigUint64(offset+8);
    let lo=0,hi=count-1;
    while(lo<=hi){const mid=(lo+hi)>>>1,offset=mid*size,start=read(offset),end=read(offset+(parsed.family===4?4:16));if(value<start)hi=mid-1;else if(value>end)lo=mid+1;else{const code=String.fromCharCode(view.getUint8(offset+size-2),view.getUint8(offset+size-1));const country=window.RoseCheck.country(code);return country.code?country:null}}
    return null;
  }
  window.RoseCountryLookup=Object.freeze({lookup});
})();
