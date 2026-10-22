import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { aggregateDownloads, fetchReleases, renderDownloadsSvg, updateDownloadStats } from '../scripts/update-download-stats.mjs';

const repository = 'example/project';
const updatedAt = '2026-10-22T00:00:00.000Z';
const release = (assets = [], extra = {}) => ({ draft: false, prerelease: false, assets, ...extra });
const asset = (name, download_count) => ({ name, download_count });
const reply = body => ({ ok: true, status: 200, json: async () => body });

async function temporaryOutput(t) {
  const output = await mkdtemp(path.join(os.tmpdir(), 'behindrose-download-stats-'));
  t.after(async () => {
    for (const name of await readdir(output)) await rm(path.join(output, name));
    await rmdir(output);
  });
  return output;
}

test('counts EXE and ZIP across stable and preview releases, excluding drafts and metadata', () => {
  assert.deepEqual(aggregateDownloads([
    release([asset('app-Setup.exe', 3), asset('app-Portable.zip', 1), asset('app-full.nupkg', 30), asset('releases.win.json', 20), asset('RELEASES', 10)], { prerelease: true }),
    release([asset('APP.EXE', 2), asset('APP.ZIP', 4)]),
    release([asset('app.exe', 999)], { draft: true, prerelease: true }),
    release([]),
  ]), { installerDownloads: 5, portableDownloads: 5, totalDownloads: 10, releaseCount: 3 });
});

test('rejects malformed records, invalid counts, and overflow rather than reporting zero', () => {
  for (const invalid of [null, {}, [null], [{ draft: false, prerelease: false, assets: null }], [{ draft: false, assets: [] }]])
    assert.throws(() => aggregateDownloads(invalid));
  for (const count of [-1, 1.5, Infinity, NaN, '2', undefined, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => aggregateDownloads([release([asset('app.exe', count)])]), /download_count/);
    assert.throws(() => aggregateDownloads([release([asset('metadata.json', count)], { draft: true })]), /download_count/);
  }
  assert.throws(() => aggregateDownloads([release([asset('app.exe', Number.MAX_SAFE_INTEGER), asset('app.zip', 1)])]), /download_count/);
  assert.throws(() => aggregateDownloads([release([asset('', 1)])]), /asset/);
});

test('fetches more than 100 releases using read-only paginated requests, including previews', async () => {
  const fixtures = Array.from({ length: 101 }, (_, index) => release([asset('app.exe', 1), asset('app.zip', 2)], { prerelease: index % 2 === 0, draft: index === 100 }));
  const requests = [];
  const releases = await fetchReleases(repository, { token: 'fixture', fetchImpl: async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://api.github.com');
    assert.equal(parsed.pathname, '/repos/example/project/releases');
    assert.equal(parsed.searchParams.get('per_page'), '100');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    const page = Number(parsed.searchParams.get('page'));
    requests.push(page);
    return reply(fixtures.slice((page - 1) * 100, page * 100));
  } });
  assert.deepEqual(requests, [1, 2]);
  assert.equal(releases.length, 101);
  assert.deepEqual(aggregateDownloads(releases), { installerDownloads: 100, portableDownloads: 200, totalDownloads: 300, releaseCount: 100 });
});

test('checks the next page when a page contains exactly 100 releases', async () => {
  let calls = 0;
  const releases = await fetchReleases(repository, { token: '', fetchImpl: async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    return reply(++calls === 1 ? Array.from({ length: 100 }, () => release()) : []);
  } });
  assert.equal(calls, 2);
  assert.equal(releases.length, 100);
});

test('API errors, malformed JSON and partial results preserve both existing outputs', async t => {
  const output = await temporaryOutput(t);
  await writeFile(path.join(output, 'downloads.svg'), 'previous svg');
  await writeFile(path.join(output, 'downloads.json'), 'previous json');
  const fullPage = Array.from({ length: 100 }, () => release([asset('app.exe', 1)]));
  for (const failure of [
    async () => ({ ok: false, status: 503 }),
    async () => { throw Error('offline fixture'); },
    async () => ({ ok: true, json: async () => { throw Error('invalid JSON fixture'); } }),
    async () => reply({ error: 'unexpected response' }),
    async () => reply([release([asset('app.zip', -1)])]),
  ]) {
    let calls = 0;
    await assert.rejects(updateDownloadStats({ repository, output, updatedAt, token: '', fetchImpl: (...args) => ++calls === 1 ? reply(fullPage) : failure(...args) }));
    assert.equal(await readFile(path.join(output, 'downloads.svg'), 'utf8'), 'previous svg');
    assert.equal(await readFile(path.join(output, 'downloads.json'), 'utf8'), 'previous json');
    assert.deepEqual((await readdir(output)).sort(), ['downloads.json', 'downloads.svg']);
  }
});

test('a successful empty response publishes a real zero and deterministic JSON', async t => {
  const output = await temporaryOutput(t);
  const document = await updateDownloadStats({ repository, output, updatedAt, token: '', fetchImpl: async () => reply([]) });
  assert.equal(document.totalDownloads, 0);
  assert.equal(document.releaseCount, 0);
  assert.equal(document.updatedAt, updatedAt);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, 'downloads.json'), 'utf8')), document);
  const svg = await readFile(path.join(output, 'downloads.svg'), 'utf8');
  assert.match(svg, /累计下载/);
  assert.match(svg, /全部已发布版本（含预览版）的 EXE \+ ZIP/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /<title>/);
});

test('SVG escapes text and attribute values and validates totals', () => {
  const stats = { installerDownloads: 3, portableDownloads: 1, totalDownloads: 4, releaseCount: 5 };
  const svg = renderDownloadsSvg(stats, `example/<script>&"'`);
  assert.ok(!svg.includes('<script>'));
  assert.match(svg, /&lt;script&gt;&amp;&quot;&apos;/);
  assert.match(svg, /累计下载 4 次/);
  assert.throws(() => renderDownloadsSvg({ ...stats, totalDownloads: 9 }, repository), /do not match/);
});

test('CLI rejects invalid arguments with a failure status before network or output writes', () => {
  const script = fileURLToPath(new URL('../scripts/update-download-stats.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--repository', 'invalid', '--output', os.tmpdir()], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Repository must be owner\/repo/);
});
