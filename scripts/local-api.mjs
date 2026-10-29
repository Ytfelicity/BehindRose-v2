import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import path from 'node:path';

export class LocalBridge {
  constructor(project) {
    this.pending = new Map(); this.ready = false; this.error = ''; this.closed = false;
    this.initializing = this.initialize(project).catch(error => {
      this.ready = false;
      this.error = '本机服务启动失败，请查看开发控制台并重新启动。';
      console.error(error.message);
    });
  }
  async initialize(project) {
    const sdk = path.resolve(project, '../tools/dotnet10/dotnet.exe');
    const dotnet = existsSync(sdk) ? sdk : 'dotnet';
    const env = { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' };
    if (existsSync(sdk)) env.DOTNET_ROOT = path.dirname(sdk);
    const csproj = path.join(project, 'src/BehindRose.DevHost/BehindRose.DevHost.csproj');
    // A development server owns its host copy. Another live server or desktop
    // session must not prevent a new source build by locking a shared DLL.
    const hostOutput = path.join(project, 'artifacts', 'devhost', String(process.pid));
    const run = args => new Promise((resolve, reject) => {
      const child = spawn(dotnet, args, { cwd: project, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.build = child;
      child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => process.stderr.write(data));
      child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('Local host build failed: ' + code)));
    });
    await run(['restore', csproj, '--locked-mode', '--ignore-failed-sources']);
    if (this.closed) return;
    await run(['build', csproj, '-c', 'Debug', '--no-restore', '--output', hostOutput]);
    if (this.closed) return;
    const dll = path.join(hostOutput, 'BehindRose.DevHost.dll');
    this.child = spawn(dotnet, [dll, '--stdio'], { cwd: project, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stderr.on('data', data => process.stderr.write(data));
    this.child.stdin.on('error', () => {});
    createInterface({ input: this.child.stdout }).on('line', line => {
      try {
        const reply = JSON.parse(line); const request = this.pending.get(reply.id);
        if (!request) return;
        this.pending.delete(reply.id); clearTimeout(request.timer);
        reply.ok ? request.resolve(reply.data) : request.reject(Error(reply.error));
      } catch { console.error('Invalid local host response.'); }
    });
    const failed = () => {
      this.ready = false; this.error = '本机服务已断开，请重新启动开发服务。';
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error(this.error)); }
      this.pending.clear();
    };
    this.child.once('error', failed); this.child.once('exit', failed);
    this.ready = true;
    await this.call({ command: 'status' });
    console.log('Local health, repair preview and backup service ready.');
  }
  call(request) {
    if (!this.ready || this.closed) return Promise.reject(Error(this.error || '本机服务正在启动，请稍候。'));
    if (this.pending.size >= 16) return Promise.reject(Error('请求较多，请稍后重试。'));
    const id = randomUUID().replaceAll('-', '');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error('本机服务响应超时，请刷新状态后再操作。')); }, 20000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...request, id }) + '\n');
    });
  }
  close() {
    this.closed = true;
    if (this.child) this.child.stdin.end(); // The bridge waits for any worker to finish.
    else this.build?.kill();
  }
}

const commands = new Set(['health', 'status', 'plan', 'backups', 'restore-plan', 'execute', 'open-clash', 'quality-status', 'quality-proxies', 'quality-start', 'quality-stop', 'proxy-network-status', 'proxy-network-start', 'proxy-network-stop', 'clash-full-backups', 'clash-full-backup', 'clash-full-restore-plan', 'clash-full-restore']);
export function createLocalApi(bridge, port) {
  const token = randomBytes(32).toString('hex');
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map(value => 'http://' + value));
  return async function localApi(req, res, pathname) {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    if (!hosts.has(req.headers.host) || (req.headers.origin && !origins.has(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site')
      return send(403, { error: '只接受本机页面的请求。' });
    if (pathname === '/api/session' && req.method === 'GET') return send(200, { token, ready: bridge.ready, error: bridge.error });
    if (pathname !== '/api/local' || req.method !== 'POST') return send(405, { error: '不支持的请求。' });
    const supplied = req.headers['x-behindrose-token'];
    if (!origins.has(req.headers.origin) || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(token), Buffer.from(supplied)))
      return send(403, { error: '页面会话已失效，请刷新后重试。' });
    if (req.headers['content-type'] !== 'application/json') return send(415, { error: '请求格式不正确。' });
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) return send(413, { error: '请求过大。' }); }
      let request; try { request = JSON.parse(body); } catch { return send(400, { error: '请求格式不正确。' }); }
      if (!request || Array.isArray(request) || !commands.has(request.command))
        return send(400, { error: '不支持的操作。' });
      const network = request.command.startsWith('proxy-network-');
      const quality = request.command.startsWith('quality-');
      const fullBackupFields = { 'clash-full-backups': ['command'], 'clash-full-backup': ['command'], 'clash-full-restore-plan': ['command', 'backupId'], 'clash-full-restore': ['command', 'planId'] };
      const fields = fullBackupFields[request.command] || (network ? (request.command === 'proxy-network-start' ? ['command', 'proxyPort', 'profile', 'includeSpeed'] : ['command']) : quality ? (request.command === 'quality-start' ? ['command', 'proxyPort'] : ['command']) : ['command', 'options', 'planId', 'backupId']);
      if (Object.keys(request).some(key => !fields.includes(key))) return send(400, { error: '操作参数无效。' });
      if (request.command === 'clash-full-restore-plan' && !request.backupId || request.command === 'clash-full-restore' && !request.planId) return send(400, { error: '缺少完整备份或预览编号。' });
      if (request.command === 'quality-start' && (!Number.isInteger(request.proxyPort) || request.proxyPort < 0 || request.proxyPort > 65535)) return send(400, { error: '请选择有效的本机 HTTP / 混合端口。' });
      if (request.command === 'proxy-network-start' && (!Number.isInteger(request.proxyPort) || request.proxyPort < 1 || request.proxyPort > 65535 || !['quick', 'all'].includes(request.profile) || typeof request.includeSpeed !== 'boolean')) return send(400, { error: '代理网络检测参数无效。' });
      if (request.options !== undefined && (!Number.isInteger(request.options) || request.options < 1 || request.options > 127)) return send(400, { error: '修改选项无效。' });
      if (request.proxyPort !== undefined && (!Number.isInteger(request.proxyPort) || request.proxyPort < 0 || request.proxyPort > 65535)) return send(400, { error: '代理端口无效。' });
      if (!quality && !network && request.proxyPort !== undefined) return send(400, { error: '操作参数无效。' });
      for (const key of ['planId', 'backupId']) if (request[key] !== undefined && !/^[a-f0-9]{32}$/.test(request[key])) return send(400, { error: '操作编号无效。' });
      return send(200, { data: await bridge.call(request) });
    } catch (error) { return send(409, { error: error.message }); }
  };
}
