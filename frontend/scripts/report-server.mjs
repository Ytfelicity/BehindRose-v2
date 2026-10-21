import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs');
const reports = new Map([
  ['/', path.join(docs,'ui-refero-2026-10-02/设计规范对照.html')],
  ['/refero.html', path.join(docs,'ui-refero-2026-10-02/设计规范对照.html')],
  ['/ui-upgrade.html', path.join(docs,'ui-reactbits-2026-10-02/UI升级对照.html')]
]);
http.createServer(async (req,res)=>{
  if (!['127.0.0.1:4318','localhost:4318'].includes(req.headers.host)) { res.writeHead(403);res.end();return; }
  const file = reports.get(req.url);
  if (!file) { res.writeHead(404);res.end();return; }
  try {const body=await readFile(file);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Length':body.length,'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});res.end(body);}catch{res.writeHead(503);res.end('Report is being generated.');}
}).listen(4318,'127.0.0.1',()=>console.log('UI report: http://127.0.0.1:4318/'));
