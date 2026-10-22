import { mkdtemp, mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const pageSize = 100;
const usage = 'Usage: node scripts/update-download-stats.mjs --repository owner/repo --output directory';

function validateRepository(repository) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) || ['.', '..'].includes(repository.split('/')[1]))
    throw Error('Repository must be owner/repo.');
}

function addCount(total, value) {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value))
    throw Error('Invalid or overflowing download_count.');
  return total + value;
}

/** Count published releases, including prereleases, and only EXE/ZIP assets. */
export function aggregateDownloads(releases) {
  if (!Array.isArray(releases)) throw Error('GitHub releases response must be an array.');
  let installerDownloads = 0, portableDownloads = 0, releaseCount = 0;
  for (const release of releases) {
    if (!release || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean' || !Array.isArray(release.assets))
      throw Error('Invalid GitHub release record.');
    for (const asset of release.assets) {
      if (!asset || typeof asset.name !== 'string' || !asset.name) throw Error('Invalid GitHub release asset.');
      addCount(0, asset.download_count);
      if (release.draft) continue;
      if (/\.exe$/i.test(asset.name)) installerDownloads = addCount(installerDownloads, asset.download_count);
      else if (/\.zip$/i.test(asset.name)) portableDownloads = addCount(portableDownloads, asset.download_count);
    }
    if (!release.draft) releaseCount++;
  }
  return { installerDownloads, portableDownloads, totalDownloads: addCount(installerDownloads, portableDownloads), releaseCount };
}

/** Fetch every page; do not use /latest, which omits prereleases. */
export async function fetchReleases(repository, { fetchImpl = globalThis.fetch, token = process.env.GH_TOKEN } = {}) {
  validateRepository(repository);
  const releases = [];
  for (let page = 1; ; page++) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'BehindRose-download-stats' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=${pageSize}&page=${page}`, {
        method: 'GET', headers, signal: AbortSignal.timeout(30000),
      });
    } catch { throw Error(`GitHub releases request failed on page ${page}.`); }
    if (!response.ok) throw Error(`GitHub releases request failed on page ${page} (HTTP ${response.status}).`);
    let batch;
    try { batch = await response.json(); } catch { throw Error(`Invalid GitHub JSON on page ${page}.`); }
    aggregateDownloads(batch); // Validate even records and counts that are excluded from the total.
    if (batch.length > pageSize) throw Error(`Invalid GitHub page size on page ${page}.`);
    releases.push(...batch);
    if (batch.length < pageSize) return releases;
  }
}

export function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
}

export function renderDownloadsSvg(stats, repository) {
  const { installerDownloads, portableDownloads, totalDownloads, releaseCount } = stats;
  for (const value of [installerDownloads, portableDownloads, totalDownloads, releaseCount]) addCount(0, value);
  if (addCount(installerDownloads, portableDownloads) !== totalDownloads) throw Error('Download totals do not match.');
  const value = String(totalDownloads);
  const left = 84, right = Math.max(44, value.length * 8 + 24), width = left + right;
  const description = escapeXml(`${repository} 累计下载 ${value} 次；统计全部已发布版本（含预览版）的 EXE + ZIP 附件，不含更新包和元数据；不是独立用户数。`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="28" viewBox="0 0 ${width} 28" role="img" aria-label="${description}">
  <title>${description}</title>
  <rect width="${width}" height="28" rx="4" fill="#30363d"/>
  <path d="M${left} 0h${right - 4}a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H${left}z" fill="#238636"/>
  <g fill="#fff" text-anchor="middle" font-family="Arial,Microsoft YaHei,sans-serif" font-size="13">
    <text x="${left / 2}" y="19">累计下载</text><text x="${left + right / 2}" y="19">${value}</text>
  </g>
</svg>\n`;
}

// Prepare both files before replacing either. Roll back replacements if a write fails.
async function writeOutputs(output, contents) {
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(path.join(output, '.download-stats-'));
  const entries = [];
  try {
    for (const [name, content] of Object.entries(contents)) {
      const target = path.join(output, name), next = path.join(staging, name), previous = next + '.previous';
      let existing;
      try { existing = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const entry = { target, next, previous, existed: existing !== undefined, replaced: false };
      entries.push(entry);
      await writeFile(next, content, { flag: 'wx' });
      if (entry.existed) await writeFile(previous, existing, { flag: 'wx' });
    }
    try {
      for (const entry of entries) { await rename(entry.next, entry.target); entry.replaced = true; }
    } catch (error) {
      for (const entry of [...entries].reverse()) if (entry.replaced) {
        if (entry.existed) await rename(entry.previous, entry.target);
        else await rm(entry.target);
      }
      throw error;
    }
  } finally {
    for (const entry of entries) {
      await rm(entry.next, { force: true });
      await rm(entry.previous, { force: true });
    }
    await rmdir(staging);
  }
}

export async function updateDownloadStats({ repository, output, fetchImpl, token = process.env.GH_TOKEN, updatedAt = new Date().toISOString() }) {
  validateRepository(repository);
  if (typeof output !== 'string' || !output.trim()) throw Error('An output directory is required.');
  if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) throw Error('Invalid updatedAt.');
  const stats = aggregateDownloads(await fetchReleases(repository, { fetchImpl, token }));
  const document = { repository, ...stats, scope: 'All published releases, including prereleases; EXE + ZIP assets only; not unique users.', updatedAt };
  const svg = renderDownloadsSvg(stats, repository);
  await writeOutputs(path.resolve(output), { 'downloads.svg': svg, 'downloads.json': JSON.stringify(document, null, 2) + '\n' });
  return document;
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = { '--repository': 'repository', '--output': 'output' }[args[index]];
    if (!key || options[key] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw Error(usage);
    options[key] = args[index + 1];
  }
  if (!options.repository || !options.output) throw Error(usage);
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const stats = await updateDownloadStats(parseArguments(process.argv.slice(2)));
    console.log(`Downloads: ${stats.totalDownloads} (EXE ${stats.installerDownloads}, ZIP ${stats.portableDownloads}); ${stats.releaseCount} published releases.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
