import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MYIP_MULTI_ROUNDS, MYIP_INTERVAL_MS, MYIP_STAGGER_MS } from '../src/vendor/myip-connectivity.mjs';
assert.deepEqual([MYIP_MULTI_ROUNDS, MYIP_INTERVAL_MS, MYIP_STAGGER_MS], [10, 500, 50]);
const pinned = await readFile('../vendor/MyIP/frontend/components/ConnectivityTest.vue', 'utf8');
assert.equal(createHash('sha256').update(pinned).digest('hex'), '3af0731d3e2a9eb276bb0c01054c7c7c005ef2a07035f5823daeba639608e115');
const handlerStart = pinned.indexOf('const checkConnectivityHandler = async ');
const handler = pinned.slice(handlerStart, pinned.indexOf('\n};', handlerStart) + 4);
assert.ok((await readFile('src/vendor/myip-connectivity.mjs', 'utf8')).includes(handler), 'Keep the complete pinned upstream request handler');
const built = await build({ entryPoints: ['src/connectivity.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { normalizeWebsite, importWebsites, probeWebsite, runWebsiteBatch, siteGroups, summarizeWebsiteResults } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const upstreamBuilt = await build({ entryPoints: ['../vendor/MyIP/frontend/data/connectivity-import-lists.js'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { IMPORT_LISTS, DEFAULT_LIST_MEMBERS } = await import('data:text/javascript;base64,' + Buffer.from(upstreamBuilt.outputFiles[0].text).toString('base64'));
const targetContract = targets => targets.map(({ id, name, url }) => ({ id, name, url }));
assert.deepEqual(targetContract(siteGroups.ai.sites), targetContract(IMPORT_LISTS.find(list => list.id === 'ai').members), 'AI probes must use upstream IDs, names and exact URLs');
assert.deepEqual(targetContract(siteGroups.reference.sites), targetContract(DEFAULT_LIST_MEMBERS), 'The default list must use the upstream probe endpoints');
assert.equal(siteGroups.ai.sites.find(target => target.id === 'claude').url, 'https://claude.com/favicon.ico');
assert.ok(siteGroups.ai.sites.every(target => new URL(target.url).pathname === '/favicon.ico'));
const site = normalizeWebsite({ name: ' Example ', url: 'https://EXAMPLE.com#top' });
assert.equal(site.url, 'https://example.com/'); assert.equal(site.name, 'Example');
assert.equal(normalizeWebsite({ name: 'Health', url: 'https://example.com/health?source=user' }).url, 'https://example.com/health?source=user', 'Custom endpoints must remain exact');
for (const url of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://example.com:8443', 'https://private.local']) {
  assert.throws(() => normalizeWebsite({ name: 'test', url }));
}
assert.throws(() => importWebsites('bad JSON', []));
assert.throws(() => importWebsites('[{"name":"valid","url":"https://example.com"},{"url":"bad"}]', []));
assert.throws(() => importWebsites('[]'.padEnd(65537), []));
assert.throws(() => importWebsites(JSON.stringify(Array.from({ length: 41 }, (_, i) => ({ name: 'site', url: `https://s${i}.example.com` }))), []));
assert.equal(importWebsites('[{"name":"New name","url":"https://example.com/"}]', [site]).length, 1);
assert.equal(importWebsites('[{"name":"New name","url":"https://example.com/"}]', [site])[0].name, 'New name');
const original = globalThis.fetch;
const summarySites = [{ id: 'retained' }, { id: 'retested' }];
const summaryResults = {
  retained: { finished: true, ms: 200, completedRounds: 3, totalRounds: 3 },
  retested: { finished: true, completedRounds: 1, totalRounds: 1 },
  hidden: { finished: true, ms: 1, completedRounds: 10, totalRounds: 10 },
};
assert.deepEqual(summarizeWebsiteResults(summarySites, summaryResults), { finished: 2, reached: 1, completed: 4, planned: 4 }, 'Visible totals must include retained rows after a single-row retest, excluding hidden groups');
assert.deepEqual(summarizeWebsiteResults([summarySites[1]], summaryResults), { finished: 1, reached: 0, completed: 1, planned: 1 }, 'An active single-row retest must show its own progress');
const parent = new AbortController();
let options;
try {
  globalThis.fetch = async (_, value) => { options = value; return { type: 'opaque', status: 0, ok: false }; };
  const opaque = await probeWebsite(site, parent.signal);
  assert.equal(opaque.state, 'reachable'); assert.match(opaque.note, /状态不可见/); assert.ok(opaque.ms >= 0);
  assert.equal(options.method, 'GET'); assert.equal(options.mode, 'no-cors'); assert.equal(options.credentials, 'omit'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'follow');
  let preAbortedRequests = 0;
  globalThis.fetch = async () => { preAbortedRequests++; return { type: 'opaque' }; };
  const alreadyStopped = new AbortController(); alreadyStopped.abort();
  assert.equal((await probeWebsite(site, alreadyStopped.signal)).state, 'cancelled');
  assert.equal(preAbortedRequests, 0, 'An already-aborted signal must not start a website request');
  globalThis.fetch = async () => { throw new TypeError('network blocked'); };
  assert.equal((await probeWebsite(site, parent.signal)).state, 'failed');
  globalThis.fetch = async () => { await new Promise(resolve => setTimeout(resolve, 220)); return { type: 'opaque' }; };
  assert.equal((await probeWebsite(site, parent.signal)).state, 'slow', 'Keep the upstream 200 ms HTTP-response classification');
  globalThis.fetch = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true }));
  assert.equal((await probeWebsite(site, parent.signal, 10)).state, 'timeout');
  const cancelled = new AbortController(); const pending = probeWebsite(site, cancelled.signal); cancelled.abort();
  assert.equal((await pending).state, 'cancelled');
  let requests = 0;
  const sites = Array.from({ length: 15 }, (_, i) => normalizeWebsite({ name: `Site ${i}`, url: `https://s${i}.example.com` }));
  const results = new Map();
  const perSiteRequests = new Map();
  globalThis.fetch = async url => { requests++; perSiteRequests.set(url, (perSiteRequests.get(url) || 0) + 1); return { type: 'opaque' }; };
  await runWebsiteBatch(sites, parent.signal, (entry, value) => results.set(entry.id, value), { rounds: 1, staggerMs: 0, intervalMs: 0 });
  assert.equal(requests, 15, 'Default quick mode must make exactly one request per site');
  assert.ok([...results.values()].every(result => result.finished && result.totalRounds === 1 && result.completedRounds === 1));
  requests = 0; perSiteRequests.clear();
  await runWebsiteBatch(sites, parent.signal, (entry, value) => results.set(entry.id, value), { staggerMs: 0, intervalMs: 0 });
  assert.equal(requests, 150, 'The original default is ten real requests per site');
  assert.ok([...results.values()].every(result => result.finished && result.totalRounds === 10 && result.completedRounds === 10));
  requests = 0; perSiteRequests.clear();
  await runWebsiteBatch(sites, parent.signal, (entry, value) => results.set(entry.id, value), { rounds: 10, staggerMs: 0, intervalMs: 0 });
  assert.equal(requests, 150, 'Explicit repeat mode must make exactly 10 probes per site');
  assert.ok(sites.every(entry => perSiteRequests.get(entry.url) === 10));
  assert.equal(results.size, 15);
  for (const result of results.values()) {
    assert.equal(result.totalRounds, 10); assert.equal(result.completedRounds, 10); assert.equal(result.successfulRounds, 10);
    assert.equal(result.rounds.length, 10); assert.ok(['reachable', 'slow'].includes(result.state));
    assert.equal(result.ms, Math.min(...result.rounds.map(round => round.ms)));
  }

  // Upstream does not arm the round interval until the first pass settles.
  requests = 0;
  let releaseFirst;
  globalThis.fetch = async () => { requests++; if (requests === 1) await new Promise(resolve => { releaseFirst = resolve; }); return { type: 'opaque' }; };
  const gated = runWebsiteBatch(sites.slice(0, 3), parent.signal, (entry, value) => results.set(entry.id, value), { rounds: 10, staggerMs: 0, intervalMs: 0 });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(requests, 3, 'Later rounds must wait for the complete initial pass');
  assert.equal(results.get(sites[0].id).finished, false);
  assert.ok(sites.slice(1, 3).every(entry => results.get(entry.id).completedRounds === 1 && !results.get(entry.id).finished));
  releaseFirst(); await gated; assert.equal(requests, 30);

  // Later passes start at fixed intervals rather than waiting for earlier
  // slow requests. Scheduling waits remain outside the measured request clock.
  let active = 0, maxActive = 0, overlap = false;
  const activeHosts = new Set(), startedRounds = new Map(), completedRounds = new Map();
  const scheduleStates = [];
  globalThis.fetch = (url, { signal }) => new Promise((resolve, reject) => {
    const round = (startedRounds.get(url) || 0) + 1;
    startedRounds.set(url, round);
    if (activeHosts.has(url)) overlap = true;
    activeHosts.add(url); active++; maxActive = Math.max(maxActive, active);
    const done = () => { active--; activeHosts.delete(url); signal.removeEventListener('abort', abort); };
    const abort = () => { clearTimeout(timer); done(); reject(new DOMException('abort', 'AbortError')); };
    const timer = setTimeout(() => { done(); completedRounds.set(url, round); resolve({ type: 'opaque' }); }, 20);
    signal.addEventListener('abort', abort, { once: true });
  });
  await runWebsiteBatch(sites, parent.signal, (entry, value) => { results.set(entry.id, value); scheduleStates.push(value); }, { rounds: 10, staggerMs: 0, intervalMs: 0, timeoutMs: 80 });
  assert.ok(maxActive > 15, 'The original scheduler permits multiple slow passes in flight');
  assert.equal(overlap, true, 'Do not replace the original fixed interval with per-host serialization');
  assert.ok(sites.every(entry => results.get(entry.id).successfulRounds === 10), 'Time in our queue must not consume the request timeout');
  assert.ok(scheduleStates.filter(value => value.completedRounds < 10).every(value => !value.finished), 'Visible successful samples must not count as a finished site');
  assert.ok(scheduleStates.some(value => value.ms !== undefined && value.state === 'reachable' && !value.finished), 'Show a successful sample immediately while repeat sampling continues');
  await assert.rejects(runWebsiteBatch(sites, parent.signal, () => {}, { rounds: 3 }));
  await assert.rejects(runWebsiteBatch(sites, parent.signal, () => {}, { intervalMs: -1 }));

  // Quick mode must start every AI target without waiting through multiple
  // timeout waves. Holding responses open proves all 15 requests are issued.
  const quickController = new AbortController();
  let quickStarted = 0;
  globalThis.fetch = (_, { signal }) => new Promise((_, reject) => {
    quickStarted++;
    signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true });
  });
  const quickPending = runWebsiteBatch(sites, quickController.signal, () => {}, { staggerMs: 0, timeoutMs: 1000 });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(quickStarted, 15, 'Quick mode must not queue the AI group behind a three-request batch limit');
  quickController.abort(); await quickPending;

  let firstFailureState;
  let roundCount = 0;
  globalThis.fetch = async () => { if (++roundCount === 1) throw new TypeError('initial connection failed'); return { type: 'opaque' }; };
  await runWebsiteBatch([site], parent.signal, (_, value) => { if (value.completedRounds === 1) firstFailureState = value.state; results.set(site.id, value); }, { rounds: 10, staggerMs: 0, intervalMs: 0 });
  assert.equal(firstFailureState, 'running', 'A failed first sample must not show a terminal failure while retrying');
  assert.equal(results.get(site.id).state, 'reachable');
  assert.equal(results.get(site.id).successfulRounds, 9);

  // Give every probe an independent measured clock, so concurrent rounds and
  // late timeouts cannot distort the fixture's observed response durations.
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const samples = [620, 75, 'failed', 235, 'timeout', 110, 410, 'failed', 200, 80];
  let clockSamples = samples, clockIndex = 0;
  Object.defineProperty(globalThis, 'performance', { configurable: true, get: () => {
    const duration = clockSamples[clockIndex++]; let began = false;
    return { now: () => { if (!began) { began = true; return 1000; } return 1000 + (typeof duration === 'number' ? duration : 0); } };
  } });
  try {
    let sample = 0;
    globalThis.fetch = (_, { signal }) => {
      const outcome = samples[sample++];
      if (outcome === 'timeout') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true }));
      if (outcome === 'failed') return Promise.reject(new TypeError('network blocked'));
      assert.equal(typeof outcome, 'number', 'No extra round may consume a sample');
      return Promise.resolve({ type: 'opaque', status: 0 });
    };
    await runWebsiteBatch([site], parent.signal, (entry, value) => results.set(entry.id, value), { rounds: 10, staggerMs: 0, intervalMs: 0, timeoutMs: 10 });
    const aggregate = results.get(site.id);
    assert.equal(sample, 10); assert.equal(aggregate.ms, 75); assert.equal(aggregate.state, 'reachable');
    assert.equal(aggregate.totalRounds, 10); assert.equal(aggregate.completedRounds, 10); assert.equal(aggregate.successfulRounds, 7);
    assert.match(aggregate.note, /首测 620 ms/, 'The first result must remain distinct from the lowest successful value');
    assert.ok(aggregate.rounds.every(round => !Number.isNaN(Date.parse(round.sampledAt))), 'Every attempt must retain a timestamp for comparison');
    assert.deepEqual(aggregate.rounds.map(round => round.round), Array.from({ length: 10 }, (_, index) => index + 1));
    assert.deepEqual(aggregate.rounds.map(({ state, ms }) => ({ state, ...(ms === undefined ? {} : { ms }) })), samples.map(value => typeof value === 'number' ? { state: value < 200 ? 'reachable' : 'slow', ms: value } : { state: value }));

    // A new single-pass retest must replace, not inherit, the previous minimum.
    clockSamples = [180]; clockIndex = 0;
    globalThis.fetch = async () => ({ type: 'opaque' });
    await runWebsiteBatch([site], parent.signal, (entry, value) => results.set(entry.id, value), { rounds: 1, staggerMs: 0 });
    const retested = results.get(site.id);
    assert.equal(retested.ms, 180); assert.equal(retested.totalRounds, 1); assert.equal(retested.completedRounds, 1); assert.equal(retested.successfulRounds, 1); assert.equal(retested.rounds.length, 1);

    clockSamples = [0]; clockIndex = 0;
    await runWebsiteBatch([site], parent.signal, (entry, value) => results.set(entry.id, value), { rounds: 1, staggerMs: 0 });
    assert.equal(results.get(site.id).ms, 0, 'Do not raise a measured zero to an invented one millisecond');

    globalThis.fetch = async () => { throw new TypeError('network blocked'); };
    await runWebsiteBatch([site], parent.signal, (entry, value) => results.set(entry.id, value), { rounds: 10, staggerMs: 0, intervalMs: 0 });
    const failed = results.get(site.id);
    assert.equal(failed.state, 'failed'); assert.equal(failed.ms, undefined); assert.equal(failed.successfulRounds, 0);
    assert.equal(failed.completedRounds, 10); assert.ok(failed.rounds.every(round => round.state === 'failed' && round.ms === undefined));
  } finally { Object.defineProperty(globalThis, 'performance', performanceDescriptor); }

  requests = 0;
  const stopped = new AbortController();
  globalThis.fetch = (_, { signal }) => {
    requests++;
    return new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), { once: true });
      queueMicrotask(() => stopped.abort());
    });
  };
  await runWebsiteBatch(sites, stopped.signal, (entry, value) => results.set(entry.id, value), { rounds: 1, staggerMs: 2, timeoutMs: 100 });
  assert.equal(requests, 1, 'Stop must abort the active request and prevent queued staggered sites from starting');
  assert.ok(sites.every(entry => results.get(entry.id).state === 'cancelled'));
  await new Promise(resolve => setTimeout(resolve, 35)); assert.equal(requests, 1, 'Stopped timers must not launch requests later');
  // A stalled target still receives every scheduled probe, including timeouts;
  // no host-level budget may truncate the original ten-round sample.
  const completeResults = new Map();
  let completeRequests = 0, completeActive = 0;
  globalThis.fetch = (_, { signal }) => {
    completeRequests++; completeActive++;
    return new Promise((_, reject) => signal.addEventListener('abort', () => { completeActive--; reject(new DOMException('abort', 'AbortError')); }, { once: true }));
  };
  await runWebsiteBatch(sites.slice(0, 3), parent.signal, (entry, value) => completeResults.set(entry.id, value), { timeoutMs: 30, staggerMs: 0, intervalMs: 1 });
  assert.equal(completeRequests, 30); assert.equal(completeActive, 0);
  assert.ok([...completeResults.values()].every(result => result.finished && result.completedRounds === 10 && result.rounds.every(round => round.state === 'timeout')));
  console.log('PASS: pinned original handler/targets/parameters, ten-round minimum, first-pass barrier, overlapping fixed-interval passes, complete timeout samples, exact measured values, 200 ms classification, GET options and cancellation.');
} finally { globalThis.fetch = original; }
