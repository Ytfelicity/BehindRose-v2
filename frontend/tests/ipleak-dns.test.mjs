import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundled = await build({ entryPoints: ['src/ipleak-dns.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { createIpLeakDnsRunner, IPLEAK_DNS_PROVIDERS, IPLEAK_DNS_QUERY_COUNT } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
assert.deepEqual(IPLEAK_DNS_PROVIDERS, [{ id: 'ipleak', name: 'IPLeak.net' }]);
assert.equal(IPLEAK_DNS_QUERY_COUNT, 300);
const session = 'a'.repeat(40), address = '1.1.1.1', ipv6 = '2606:4700:4700::1111';
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function clock() {
  let next = 0;
  const pending = new Map(), delays = [];
  return {
    pending, delays,
    setTimeout(callback, delay) {
      const id = ++next; pending.set(id, { callback, delay });
      if (delay === 1 || delay === 1000) {
        delays.push(delay);
        queueMicrotask(() => { if (pending.delete(id)) callback(); });
      }
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    fire(delay) { for (const [id, timer] of [...pending]) if (timer.delay === delay) { pending.delete(id); timer.callback(); } },
  };
}
function runtime({ probe, details, onRequest } = {}) {
  const timers = clock(), requests = [];
  const run = createIpLeakDnsRunner({
    ...timers, session: () => session,
    fetch: async (url, options) => {
      requests.push({ url, options }); onRequest?.(url);
      if (url.endsWith('/dnsdetection/')) {
        const step = Number(new URL(url).hostname.split('.')[0].slice(41));
        return probe ? probe(step, options) : json({ session, ip: { [address]: step, ...(step >= 2 ? { [ipv6]: 0 } : {}) } });
      }
      const ip = decodeURIComponent(new URL(url).pathname.slice('/json/'.length));
      return details ? details(ip, options) : json({ ip, isp_name: '<Provider & Co.>', country_name: 'Australia', country_code: 'AU', region_name: 'New South Wales', city_name: 'Sydney', reverse: '', extra: { upstream: true } });
    },
  });
  return { timers, requests, run };
}
{
  const rt = runtime(), updates = [];
  const [result] = await rt.run(new AbortController().signal, source => updates.push(source));
  const probes = rt.requests.filter(request => request.url.endsWith('/dnsdetection/'));
  assert.equal(probes.length, 300);
  assert.deepEqual(probes.map(request => request.url), Array.from({ length: 300 }, (_, i) => `https://${session}-${i + 1}.ipleak.net/dnsdetection/`));
  assert.deepEqual(rt.timers.delays, [...Array(99).fill(1), ...Array(200).fill(1000)]);
  assert.ok(rt.requests.every(({ options }) => options.method === 'GET' && options.credentials === 'omit' && options.mode === 'cors' && options.referrerPolicy === 'no-referrer'));
  assert.equal(rt.requests.filter(request => request.url.includes('/json/')).length, 2, 'Fetch each resolver metadata once per run');
  assert.equal(result.status, 'ready'); assert.equal(result.completedQueries, 300); assert.equal(result.failedQueries, 0);
  assert.deepEqual(result.rows.map(row => [row.address, row.hits]), [[address, 300], [ipv6, 0]], 'Cumulative hits must be replaced, never summed; zero is valid');
  assert.equal(result.rows[0].country, 'Australia'); assert.equal(result.rows[0].region, 'New South Wales');
  assert.equal(result.rows[0].isp, '<Provider & Co.>'); assert.equal(result.rows[0].hostname, '');
  assert.deepEqual(result.rows[0].details.extra, { upstream: true });
  assert.ok(updates.some(row => row.completedQueries === 1 && row.rows.length === 1), 'Publish real IPs before the full sample completes');
  updates.at(-1).rows[0].isp = 'mutated'; assert.equal(result.rows[0].isp, '<Provider & Co.>');
  assert.equal(rt.timers.pending.size, 0);
}
{
  let concurrent = 0, maxConcurrent = 0;
  const rt = runtime({ probe: async step => {
    concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    await Promise.resolve(); concurrent--;
    return step === 2 ? new Response('', { status: 503 }) : json({ session, ip: { [address]: step } });
  } });
  const [result] = await rt.run(new AbortController().signal);
  assert.equal(maxConcurrent, 1); assert.equal(result.completedQueries, 300);
  assert.equal(result.failedQueries, 1); assert.equal(result.status, 'unavailable');
  assert.equal(result.rows[0].hits, 300); assert.match(result.note, /503/);
}
for (const invalid of [{ session: 'b'.repeat(40), ip: {} }, { session, ip: { 'https://attacker.invalid/': 1 } }, { session, ip: { [address]: '1' } }, { session, ip: [] }]) {
  const rt = runtime({ probe: () => json(invalid) });
  const [result] = await rt.run(new AbortController().signal);
  assert.equal(result.status, 'unavailable'); assert.equal(result.rows.length, 0);
  assert.equal(result.failedQueries, 300);
  assert.ok(rt.requests.every(request => request.url.endsWith('/dnsdetection/')), 'Reject malformed records before metadata requests');
}
{
  const rt = runtime({ probe: () => json({ session, ip: {} }) });
  const [result] = await rt.run(new AbortController().signal);
  assert.equal(result.status, 'unavailable'); assert.equal(result.serverCount, 0); assert.deepEqual(result.rows, []);
}
{
  const gate = deferred(), rt = runtime({ probe: () => gate.promise }), controller = new AbortController();
  const pending = rt.run(controller.signal); await flush(); controller.abort();
  const [result] = await pending;
  assert.equal(result.status, 'cancelled'); assert.equal(result.completedQueries, 0);
  gate.resolve(json({ session, ip: { [address]: 1 } })); await flush();
  assert.equal(rt.requests.length, 1); assert.equal(result.rows.length, 0); assert.equal(rt.timers.pending.size, 0);
}
{
  const controller = new AbortController(), rt = runtime();
  const [result] = await rt.run(controller.signal, source => { if (source.completedQueries === 3) controller.abort(); });
  assert.equal(result.status, 'cancelled'); assert.equal(result.completedQueries, 3);
  assert.equal(result.rows[0].hits, 3); assert.equal(rt.requests.filter(request => request.url.endsWith('/dnsdetection/')).length, 3);
  assert.equal(rt.timers.pending.size, 0);
}
{
  const gate = deferred(), rt = runtime({ details: () => gate.promise });
  const pending = rt.run(new AbortController().signal);
  for (let i = 0; i < 1000 && rt.requests.filter(request => request.url.endsWith('/dnsdetection/')).length < 300; i++) await flush();
  rt.timers.fire(10000);
  const [result] = await pending;
  assert.equal(result.status, 'ready'); assert.equal(result.rows[0].hits, 300);
  assert.ok(result.rows.every(row => row.metadataStatus === 'unavailable' && row.country === '' && row.isp === ''));
  gate.resolve(json({ ip: address, country_name: 'Late response' })); await flush();
  assert.equal(result.rows[0].country, ''); assert.equal(rt.timers.pending.size, 0);
}
{
  const controller = new AbortController(), gate = deferred();
  const many = Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['1.0.0.' + (i + 1), 1]));
  const rt = runtime({ probe: () => json({ session, ip: many }), details: () => gate.promise });
  const [result] = await rt.run(controller.signal, source => { if (source.completedQueries === 2) controller.abort(); });
  assert.equal(rt.requests.filter(request => request.url.includes('/json/')).length, 4, 'Bound metadata fan-out and never drain the queue after cancellation');
  assert.equal(result.rows.length, 12); assert.equal(result.status, 'cancelled');
  gate.resolve(json({ ip: '1.0.0.1', country_name: 'Late metadata' })); await flush();
  assert.ok(result.rows.every(row => row.country === '' && row.metadataStatus === 'unavailable'));
  assert.equal(rt.timers.pending.size, 0);
}
{
  let requested = false;
  const [result] = await createIpLeakDnsRunner({ session: () => '../invalid', fetch: async () => { requested = true; return json({}); } })(new AbortController().signal);
  assert.equal(result.status, 'unavailable'); assert.equal(requested, false);
}
console.log('PASS: IPLeak browser-only sequential 300-query protocol, official session/label/timing, cumulative hits, progressive cards, metadata mapping, invalid/empty/failure states, cancellation and late-response isolation.');
