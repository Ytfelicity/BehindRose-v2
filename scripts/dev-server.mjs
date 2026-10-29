import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { LocalBridge, createLocalApi } from './local-api.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(project, 'src/BehindRose.Desktop/Assets');
const host = '127.0.0.1', port = Number(process.env.BEHINDROSE_DEV_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('BEHINDROSE_DEV_PORT must be an integer from 1 to 65535.');
const url = `http://${host}:${port}/`;
const clients = new Set();
let version = Date.now(), debounce;
let bridge, localApi;
let frontendWatcher;
const files = new Map([
  ['/', ['workbench/index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['workbench/index.html', 'text/html; charset=utf-8']],
  ['/workbench.css', ['workbench/workbench.css', 'text/css; charset=utf-8']],
  ['/workbench.js', ['workbench/workbench.js', 'text/javascript; charset=utf-8']],
  ['/beui.js', ['workbench/beui.js', 'text/javascript; charset=utf-8']],
  ['/beui.css', ['diagnostics/beui.css', 'text/css; charset=utf-8']],
  ['/console.css', ['workbench/console.css', 'text/css; charset=utf-8']],
  ['/claude-handbook.html', ['workbench/claude-handbook.html', 'text/html; charset=utf-8']],
  ['/claude-handbook.css', ['workbench/claude-handbook.css', 'text/css; charset=utf-8']],
  ['/claude-handbook-ui.js', ['workbench/claude-handbook-ui.js', 'text/javascript; charset=utf-8']],
  ['/claude-windows-handbook.zip', ['workbench/claude-windows-handbook.zip', 'application/zip']],
  ['/claude-guide.md', ['workbench/claude-guide.md', 'text/markdown; charset=utf-8']],
  ['/claude-handbook-scripts/Launch-Claude.ps1', ['workbench/claude-handbook-scripts/Launch-Claude.ps1', 'text/plain; charset=utf-8']],
  ['/claude-handbook-scripts/Backup-ClaudeLocal.ps1', ['workbench/claude-handbook-scripts/Backup-ClaudeLocal.ps1', 'text/plain; charset=utf-8']],
  ['/claude-handbook-scripts/Test-ClaudeNetwork.ps1', ['workbench/claude-handbook-scripts/Test-ClaudeNetwork.ps1', 'text/plain; charset=utf-8']],
  ['/network-ui.js', ['diagnostics/network-ui.js', 'text/javascript; charset=utf-8']],
  ['/support-qr.png', ['workbench/support-qr.png', 'image/png']],
  ['/brand-logo.png', ['workbench/brand-logo.png', 'image/png']],
  ['/network-console.css', ['diagnostics/network-console.css', 'text/css; charset=utf-8']],
  ['/network', ['diagnostics/index.html', 'text/html; charset=utf-8']],
  ['/diagnostics.css', ['diagnostics/diagnostics.css', 'text/css; charset=utf-8']],
  ['/diagnostics.js', ['diagnostics/diagnostics.js', 'text/javascript; charset=utf-8']],
  ['/diagnostics-core.js', ['diagnostics/diagnostics-core.js', 'text/javascript; charset=utf-8']],
  ['/flag-codes.js', ['diagnostics/flag-codes.js', 'text/javascript; charset=utf-8']],
  ['/country-lookup.js', ['diagnostics/country-lookup.js', 'text/javascript; charset=utf-8']],
  ['/country-db/country4.bin', ['diagnostics/country-db/country4.bin', 'application/octet-stream']],
  ['/country-db/country6.bin', ['diagnostics/country-db/country6.bin', 'application/octet-stream']],
  ['/icons.svg', ['diagnostics/icons.svg', 'image/svg+xml']],
  ['/avatar.png', ['avatar-source.png', 'image/png']]
]);
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self' https://api.ipify.org https://api6.ipify.org https://ipapi.co https://bash.ws https://*.bash.ws stun:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'self'; frame-ancestors 'none'";
// Only the unprivileged diagnostic document supports user-selected HTTPS sites.
const networkCsp = csp.replace(/connect-src [^;]+;/, "connect-src 'self' https: stun:;").replace("frame-ancestors 'none'", "frame-ancestors 'self'");
const client = `
let seenVersion;
const events = new EventSource('/__dev/events');
events.onmessage = event => {
  if (seenVersion && seenVersion !== event.data) location.reload();
  seenVersion = event.data;
  document.getElementById('dev-state').textContent = '保存后自动刷新';
};
events.onerror = () => { document.getElementById('dev-state').textContent = '开发服务未连接 · 正在重连'; };
document.getElementById('dev-reload').addEventListener('click', () => location.reload());
`;
const devCss = `.dev-bar{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:10px 20px;background:#252032;color:#f3e9f2;font:13px/1.5 'Segoe UI','Microsoft YaHei UI',sans-serif;border-bottom:1px solid #654b61}.dev-bar strong{font-weight:600}.dev-bar span{opacity:.85}.dev-bar button{margin-left:auto;font-size:12px;padding:4px 10px}.shell{max-width:1060px;padding:22px 28px}.dev-note{margin:0;padding:8px 20px;font:12px/1.6 'Segoe UI','Microsoft YaHei UI',sans-serif;color:var(--muted);background:var(--bg)}`;

const server = http.createServer(async (req, res) => {
  if (![`${host}:${port}`, `localhost:${port}`].includes(req.headers.host)) { res.writeHead(403); res.end('Local development only'); return; }
  const requestUrl = new URL(req.url, url);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', requestUrl.pathname === '/network' ? networkCsp : requestUrl.pathname === '/claude-handbook.html' ? csp.replace("img-src 'self';", "img-src 'self' data:;").replace(/connect-src [^;]+;/, "connect-src 'self';") : csp);
  if (requestUrl.pathname.startsWith('/api/')) {
    if (!localApi) { res.writeHead(503); res.end(); return; }
    await localApi(req, res, requestUrl.pathname); return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  if (requestUrl.pathname === '/__dev/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ application: 'BehindRose workbench development', version, port, mode: 'source-files' })); return;
  }
  if (requestUrl.pathname === '/__dev/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
    res.write(`data: ${version}\n\n`); clients.add(res);
    req.on('close', () => clients.delete(res)); return;
  }
  if (requestUrl.pathname === '/__dev/client.js' || requestUrl.pathname === '/__dev/style.css') {
    const js = requestUrl.pathname.endsWith('.js');
    res.setHeader('Content-Type', js ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
    res.end(js ? client : devCss); return;
  }
  const flagMatch = /^\/flags\/([a-z]{2})\.svg$/.exec(requestUrl.pathname);
  const serviceIconMatch = /^\/service-icons\/([a-z-]+)\.svg$/.exec(requestUrl.pathname);
  const fontMatch = /^\/fonts\/(figtree-latin-(400|500|600|700)-normal|eb-garamond-latin-400-normal)\.woff2$/.exec(requestUrl.pathname);
  const handbookImage = /^\/claude-handbook-images\/[0-9]{2}-[a-z0-9-]+\.(jpg|png)$/.exec(requestUrl.pathname);
  const file = (handbookImage ? ['workbench' + requestUrl.pathname, handbookImage[1] === 'jpg' ? 'image/jpeg' : 'image/png'] : null) || (fontMatch ? ['diagnostics' + requestUrl.pathname, 'font/woff2'] : null) || files.get(requestUrl.pathname) || (flagMatch ? ['diagnostics/flags/' + flagMatch[1] + '.svg', 'image/svg+xml'] : null) || (serviceIconMatch ? ['diagnostics/service-icons/' + serviceIconMatch[1] + '.svg', 'image/svg+xml'] : null);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const location = path.join(assets, file[0]);
    if ((await stat(location)).size > (file[0].startsWith('diagnostics/country-db/') ? 16 : 2) * 1024 * 1024) throw Error('Asset too large');
    let data = await readFile(location);
    if (['/claude-windows-handbook.zip', '/claude-guide.md', '/claude-handbook-scripts/Launch-Claude.ps1', '/claude-handbook-scripts/Backup-ClaudeLocal.ps1', '/claude-handbook-scripts/Test-ClaudeNetwork.ps1'].includes(requestUrl.pathname)) res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file[0])}"`);
    if (file[0] === 'workbench/index.html') {
      data = Buffer.from(data.toString('utf8')
        .replace('</head>', '<script defer src="/__dev/client.js"></script></head>'));
    }
    res.writeHead(200, { 'Content-Type': file[1], 'Content-Length': data.length }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(503); res.end('Source file temporarily unavailable. Save and refresh.'); }
});
const watcher = watch(assets, { recursive: true }, (_, filename) => {
  if (!filename || !/\.(html|css|js|svg)$/.test(filename)) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => { version = Math.max(version + 1, Date.now()); for (const response of clients) response.write(`data: ${version}\n\n`); }, 250);
});
const heartbeat = setInterval(() => { for (const response of clients) response.write(': keepalive\n\n'); }, 20000);
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? `Development server is already running or port ${port} is occupied. Open ${url}` : error.message);
  watcher.close(); clearInterval(heartbeat); process.exitCode = 1;
});
server.listen(port, host, () => {
  bridge = new LocalBridge(project); localApi = createLocalApi(bridge, port);
  console.log(`BehindRose development: ${url}\nReading source files; save to reload. Ctrl+C to stop. No packaging.`);
  const frontend = path.join(project, 'frontend');
  if (!process.argv.includes('--no-watch') && existsSync(path.join(frontend, 'node_modules/esbuild'))) {
    frontendWatcher = spawn(process.execPath, [path.join(frontend, 'build.mjs'), '--watch'], { cwd: frontend, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    frontendWatcher.on('error', error => console.error('Frontend watch: ' + error.message));
  }
  if (process.argv.includes('--open')) spawn('explorer.exe', [url], { windowsHide: true, stdio: 'ignore' }).unref();
});
function stop() { if (frontendWatcher?.connected) frontendWatcher.send('stop'); bridge?.close(); watcher.close(); clearInterval(heartbeat); clearTimeout(debounce); for (const response of clients) response.end(); server.close(); server.closeIdleConnections(); }
process.once('SIGINT', stop); process.once('SIGTERM', stop);
