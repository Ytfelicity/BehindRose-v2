import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';

async function loadModule(entryPoint) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, platform: 'node', format: 'esm' });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const [{ MYIP_DNS_PROVIDERS, runMyIPDns }, { MYIP_STUN_PROVIDERS, MYIP_RTC_TIMEOUT_MS, probeMyIPRtc }] = await Promise.all([
  loadModule('src/vendor/myip-dns.mjs'), loadModule('src/vendor/myip-webrtc.mjs'),
]);

// Verify that reuse means the original provider and sampling functions, not
// another implementation that merely uses the same brand or service names.
const dnsSource = await readFile('src/vendor/myip-dns.mjs', 'utf8');
for (const file of ['ipapi', 'surfshark', 'myipstack', 'fastly', 'bashws', 'browserleaks', 'ipleak']) {
  const original = await readFile(`../vendor/MyIP/frontend/utils/dnsleaks/${file}.js`, 'utf8');
  const executable = original.replace(/^import[^\n]*\n/gm, '').replace(/\bexport\s+/g, '').trim();
  assert.ok(dnsSource.includes(executable), `${file}: preserve the complete upstream provider source`);
}
const rtcSource = await readFile('src/vendor/myip-webrtc.mjs', 'utf8');
const rtcOriginal = await readFile('../vendor/MyIP/frontend/components/WebRtcTest.vue', 'utf8');
for (const [start, end] of [
  ['const CANDIDATE_IP_RE = ', '\n\n// Track in-flight'],
  ['const checkSTUNServer = (stun) => {', '\n\n// Analyze ICE'],
  ['const determineNATType = (candidate) => {', '\n\n// Locale-free twin'],
  ['const natTypeCodeOf = (candidate) => {', '\n\n// Domain event:'],
]) {
  const begin = rtcOriginal.indexOf(start), finish = rtcOriginal.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, 'The pinned upstream sampling block must exist');
  assert.ok(rtcSource.includes(rtcOriginal.slice(begin, finish).trimEnd()), `Preserve upstream block: ${start}`);
}
assert.deepEqual(MYIP_DNS_PROVIDERS, [
  { id: 'ipapi', name: 'ip-api.com' }, { id: 'surfshark', name: 'surfsharkdns.com' },
  { id: 'myipstack', name: 'dns.myipstack.com' }, { id: 'fastly', name: 'fastly.com' },
]);
assert.deepEqual(MYIP_STUN_PROVIDERS, [
  { name: 'Google', host: 'stun.l.google.com:19302' }, { name: 'BlackBerry', host: 'stun.voip.blackberry.com:3478' },
  { name: 'Twilio', host: 'global.stun.twilio.com' }, { name: 'Cloudflare', host: 'stun.cloudflare.com' },
]);
assert.equal(MYIP_RTC_TIMEOUT_MS, 5000);

function dnsProvider(url) {
  const address = new URL(url);
  if (address.hostname.endsWith('.edns.ip-api.com')) {
    assert.equal(address.pathname, '/json'); return 'ipapi';
  }
  if (address.hostname.endsWith('.ipv4.surfsharkdns.com')) {
    assert.match(address.hostname, /^jn32[a-z0-9]+\.ipv4\.surfsharkdns\.com$/); return 'surfshark';
  }
  if (address.hostname.endsWith('.dns.myipstack.com')) {
    assert.equal(address.pathname, '/getRemoteAddress');
    assert.equal(address.searchParams.get('name'), address.hostname.split('.')[0]); return 'myipstack';
  }
  if (address.hostname.endsWith('.u.fastly-analytics.com')) {
    assert.equal(address.pathname, '/debug_resolver'); return 'fastly';
  }
  if (address.hostname === 'bash.ws' || address.hostname.endsWith('.bash.ws')) return 'bashws';
  if (address.hostname.endsWith('.dns4.browserleaks.net')) {
    assert.match(address.hostname, /^[a-z0-9]{12}\.dns4\.browserleaks\.net$/); return 'browserleaks';
  }
  if (address.hostname.endsWith('-1.ipleak.net')) {
    assert.match(address.hostname, /^[a-z0-9]{40}-1\.ipleak\.net$/);
    assert.equal(address.pathname, '/dnsdetection/'); return 'ipleak';
  }
  throw Error('Unexpected DNS endpoint: ' + url);
}
function responseFor(url, provider) {
  const address = new URL(url);
  const json = {
    ipapi: { dns: { ip: '1.1.1.1' } },
    surfshark: { 7: { IP: '1.0.0.1' }, 8: { IP: '8.8.8.8' } },
    fastly: { dns_resolver_info: { ip: '9.9.9.9' }, client_ip_info: { ip: '192.0.2.1' } },
    bashws: [{ type: 'ip', ip: '192.0.2.2' }, { type: 'dns', ip: '8.8.4.4' }],
    browserleaks: { '8.8.8.8': ['resolver'], '1.1.1.1': ['resolver'] },
    ipleak: { ip: { '8.8.8.8': 2, '1.0.0.1': 4 } },
  }[provider];
  const text = provider === 'myipstack' ? 'udp:2606:4700:4700::1111:41321' : address.pathname === '/id' ? 'unittestid' : '';
  return { ok: true, json: async () => json, text: async () => text };
}
const realFetch = globalThis.fetch;
let dnsRequests = [];
function mockDns(failed = [], invalid = []) {
  dnsRequests = [];
  globalThis.fetch = async (url, options) => {
    const provider = dnsProvider(url); dnsRequests.push({ url, options, provider });
    assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.cache, 'no-store'); assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.method || 'GET', 'GET');
    if (failed.includes(provider)) throw new TypeError('test provider blocked');
    if (invalid.includes(provider)) return { ok: true, json: async () => ({ dns: { ip: '999.1.1.1' } }), text: async () => 'garbage' };
    return responseFor(url, provider);
  };
}
try {
  mockDns(); const updates = [];
  const primary = await runMyIPDns(new AbortController().signal, row => updates.push(row));
  assert.deepEqual(primary.map(row => row.sourceId), MYIP_DNS_PROVIDERS.map(row => row.id));
  assert.deepEqual(primary.map(row => row.address), ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '9.9.9.9']);
  assert.ok(primary.every(row => row.status === 'ready'));
  assert.equal(dnsRequests.length, 4, 'A successful primary needs one original probe, not the previous eight bash.ws domains');
  assert.equal(updates.filter(row => row.status === 'running').length, 4);
  assert.equal(updates.filter(row => row.status === 'ready').length, 4);

  mockDns([], ['ipapi']);
  const bashFallback = await runMyIPDns(new AbortController().signal);
  assert.equal(bashFallback[0].sourceId, 'bashws'); assert.equal(bashFallback[0].address, '8.8.4.4');
  assert.deepEqual(bashFallback[0].attemptedSources, ['ipapi', 'bashws']);
  const invalidAttempts = dnsRequests.filter(row => row.provider === 'ipapi');
  assert.equal(invalidAttempts.length, 2); assert.notEqual(invalidAttempts[0].url, invalidAttempts[1].url, 'Retries must force a fresh DNS lookup');
  assert.deepEqual(dnsRequests.filter(row => row.provider === 'bashws').map(row => row.url), [
    'https://bash.ws/id', 'https://ex.1.unittestid.bash.ws/css/z.css', 'https://bash.ws/dnsleak/test/unittestid?json',
  ]);
  assert.equal(dnsRequests.find(row => row.url.includes('ex.1.')).options.mode, 'no-cors');

  const primaryIds = MYIP_DNS_PROVIDERS.map(row => row.id);
  mockDns([...primaryIds, 'bashws']);
  const browserFallback = await runMyIPDns(new AbortController().signal);
  assert.ok(browserFallback.every(row => row.sourceId === 'browserleaks' && row.address === '1.1.1.1'));
  assert.equal(dnsRequests.filter(row => row.provider === 'browserleaks').length, 1, 'Slots must share one successful standby probe');
  for (const id of [...primaryIds, 'bashws']) assert.equal(dnsRequests.filter(row => row.provider === id).length, 2, 'Each shared failed provider gets exactly two attempts');

  mockDns([...primaryIds, 'bashws', 'browserleaks']);
  const ipleakFallback = await runMyIPDns(new AbortController().signal);
  assert.ok(ipleakFallback.every(row => row.sourceId === 'ipleak' && row.address === '1.0.0.1'));
  assert.equal(dnsRequests.filter(row => row.provider === 'ipleak').length, 1);

  mockDns([...primaryIds, 'bashws', 'browserleaks', 'ipleak']);
  const exhausted = await runMyIPDns(new AbortController().signal);
  assert.ok(exhausted.every(row => row.status === 'unavailable' && !row.address));
  assert.equal(dnsRequests.length, 14, 'Complete fallback exhaustion must retain a single two-attempt budget per provider');

  // Advance the original five-second DNS timeouts without making real
  // requests or spending seventy seconds waiting through exhausted fallbacks.
  const realSetTimeout = globalThis.setTimeout, scheduledDelays = [];
  globalThis.setTimeout = (callback, delay, ...args) => {
    scheduledDelays.push(delay); return realSetTimeout(callback, delay === 5000 ? 1 : delay, ...args);
  };
  try {
    globalThis.fetch = (_, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true });
    });
    const timedOut = await runMyIPDns(new AbortController().signal);
    assert.ok(timedOut.every(row => row.status === 'unavailable' && /超时/.test(row.note) && !row.address));
    assert.equal(scheduledDelays.filter(delay => delay === 5000).length, 14, 'Each shared source must retain the original five-second timeout and two-attempt budget');
  } finally { globalThis.setTimeout = realSetTimeout; }

  const stoppedBeforeStart = new AbortController(); stoppedBeforeStart.abort(); mockDns();
  assert.ok((await runMyIPDns(stoppedBeforeStart.signal)).every(row => row.status === 'cancelled'));
  assert.equal(dnsRequests.length, 0, 'An already-stopped run must not start DNS probes');

  const stopped = new AbortController(); let liveRequests = 0;
  globalThis.fetch = (_, { signal }) => new Promise((resolve, reject) => {
    liveRequests++;
    signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true });
    queueMicrotask(() => stopped.abort());
  });
  const cancelled = await runMyIPDns(stopped.signal);
  assert.equal(liveRequests, 1, 'Stop must cancel active DNS fetches and queued slots before they start');
  assert.ok(cancelled.every(row => row.status === 'cancelled' && !row.address));
  await new Promise(resolve => setTimeout(resolve, 650)); assert.equal(liveRequests, 1, 'Cancelled stagger timers must not revive requests');
  mockDns(); assert.ok((await runMyIPDns(new AbortController().signal)).every(row => row.status === 'ready'), 'A fresh run must not reuse cancelled providers');
} finally { globalThis.fetch = realFetch; }

function rtcRuntime({ constructorError, stub = false, offerError = false, offerGate } = {}) {
  const connections = [], timers = new Map(); let nextTimer = 0;
  class MockPC {
    constructor(configuration) {
      if (constructorError) throw constructorError;
      this.configuration = configuration; this.closed = 0; this.localDescriptions = []; connections.push(this);
      if (stub) { this.createDataChannel = undefined; this.createOffer = undefined; }
    }
    createDataChannel(label) { this.channelLabel = label; }
    async createOffer() {
      if (offerGate) await offerGate;
      if (offerError) throw Error('test offer unavailable');
      return { type: 'offer', sdp: 'v=0\r\n' };
    }
    async setLocalDescription(offer) { this.localDescriptions.push(offer); }
    close() { this.closed++; }
    candidate(type, address) {
      this.onicecandidate?.({ candidate: { candidate: `candidate:1234 1 udp 2122260223 ${address} 50000 typ ${type} raddr 0.0.0.0 rport 0` } });
    }
  }
  const dependencies = {
    RTCPeerConnection: MockPC, performance: { now: () => 100 }, console: { error: () => {} },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return { connections, timers, dependencies, fireTimers() {
    for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); }
  } };
}
for (const provider of MYIP_STUN_PROVIDERS) {
  const runtime = rtcRuntime(), controller = new AbortController();
  const result = probeMyIPRtc(provider.host, controller.signal, runtime.dependencies);
  const pc = runtime.connections[0];
  assert.deepEqual(pc.configuration, { iceServers: [{ urls: 'stun:' + provider.host }] });
  assert.equal(pc.channelLabel, ''); assert.deepEqual([...runtime.timers.values()].map(row => row.delay), [5000]);
  pc.candidate('host', '192.168.1.5'); pc.candidate('host', 'hidden-address.local'); pc.candidate('relay', '192.0.2.10');
  pc.candidate('srflx', '93.184.216.34'); pc.candidate('srflx', '93.184.216.35');
  const mapped = await result;
  assert.equal(mapped.status, 'ready'); assert.deepEqual(mapped.addresses, ['93.184.216.34']);
  assert.equal(mapped.candidateType, 'srflx'); assert.equal(mapped.natTypeCode, 'srflx');
  assert.ok(mapped.sdpLogs.some(line => line.includes('resolved IP: 93.184.216.34')));
  assert.ok(pc.closed > 0); assert.equal(runtime.timers.size, 0);
}
{
  const runtime = rtcRuntime(), pending = probeMyIPRtc('example-stun.test', new AbortController().signal, runtime.dependencies);
  runtime.connections[0].candidate('prflx', '2606:4700:4700::1111');
  const mapped = await pending;
  assert.equal(mapped.status, 'ready'); assert.equal(mapped.address, '2606:4700:4700::1111'); assert.equal(mapped.candidateType, 'prflx');
}
for (const configuration of [
  {}, { stub: true }, { constructorError: new DOMException('Blocked', 'NotAllowedError') },
  { constructorError: new DOMException('Disabled', 'NotSupportedError') },
]) {
  const runtime = rtcRuntime(configuration);
  const dependencies = Object.keys(configuration).length ? runtime.dependencies : { ...runtime.dependencies, RTCPeerConnection: undefined };
  const unavailable = await probeMyIPRtc('example-stun.test', new AbortController().signal, dependencies);
  assert.equal(unavailable.status, 'unavailable'); assert.equal(unavailable.natTypeCode, 'unavailable');
  assert.deepEqual(unavailable.addresses, []); assert.equal(runtime.timers.size, 0);
}
for (const offerError of [false, true]) {
  const runtime = rtcRuntime({ offerError });
  const result = probeMyIPRtc('example-stun.test', new AbortController().signal, runtime.dependencies);
  await Promise.resolve(); runtime.connections[0].candidate('host', '192.168.1.5'); runtime.fireTimers();
  const timeout = await result;
  assert.equal(timeout.status, 'unavailable'); assert.equal(timeout.natTypeCode, 'error'); assert.deepEqual(timeout.addresses, []);
  assert.ok(runtime.connections[0].closed > 0); assert.equal(runtime.timers.size, 0);
}
{
  let resumeOffer; const offerGate = new Promise(resolve => { resumeOffer = resolve; });
  const runtime = rtcRuntime({ offerGate }), controller = new AbortController();
  const result = probeMyIPRtc('example-stun.test', controller.signal, runtime.dependencies);
  const pc = runtime.connections[0], lateCandidate = pc.onicecandidate;
  controller.abort(); const cancelled = await result;
  assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(cancelled.addresses, []);
  assert.ok(pc.closed > 0); assert.equal(runtime.timers.size, 0);
  assert.equal(pc.onicecandidate, null); assert.equal(pc.onicecandidateerror, null); assert.equal(pc.onicegatheringstatechange, null);
  resumeOffer(); lateCandidate({ candidate: { candidate: 'candidate:1234 1 udp 2122260223 93.184.216.34 50000 typ srflx' } });
  await Promise.resolve(); assert.equal(cancelled.status, 'cancelled'); assert.deepEqual(cancelled.addresses, [], 'A late candidate cannot change the settled cancelled snapshot');
  const alreadyStopped = new AbortController(); alreadyStopped.abort();
  const before = runtime.connections.length;
  assert.equal((await probeMyIPRtc('example-stun.test', alreadyStopped.signal, runtime.dependencies)).status, 'cancelled');
  assert.equal(runtime.connections.length, before, 'Pre-cancelled RTC must not construct a connection');
}
console.log('PASS: exact MyIP DNS/RTC source blocks, seven DNS endpoints and retry/fallback sharing, fresh tokens, stopped slots, official STUN order and first candidate, IPv6, disabled APIs, timeouts, closed connections and cancelled late candidates.');
