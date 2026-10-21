// Read-only source/index inspection. Never prints matched credential text.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const staged = process.argv.includes('--staged');
if (process.argv.slice(2).some(arg => arg !== '--staged')) throw Error('Usage: node scripts/check-public-source.mjs [--staged]');
const commandOptions = { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 };
const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], { ...commandOptions, encoding: 'utf8' });
const gitRepository = gitRoot.status === 0;
if (gitRepository && path.resolve(gitRoot.stdout.trim()) !== root) throw Error('The Git repository root must be this project directory.');
if (staged && !gitRepository) throw Error('--staged requires a Git repository initialized in this project root.');
function git(args, options = {}) {
  const result = spawnSync('git', args, { ...commandOptions, ...options });
  if (result.error || result.status !== 0) throw Error('Cannot inspect Git index; check aborted without printing file contents.');
  return result.stdout;
}
const index = new Map();
if (gitRepository) {
  for (const entry of git(['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)) {
    const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
    if (!match || match[3] !== '0') throw Error('Resolve unmerged Git entries before running the public-source check.');
    index.set(match[4], { mode: match[1], oid: match[2] });
  }
}
const worktreeFiles = staged ? [] : execFileSync('rg', ['--files', '--null', '--hidden', '--no-require-git', '-g', '!.git/**'], {
  ...commandOptions, encoding: 'utf8',
}).split('\0').filter(Boolean).map(file => file.replaceAll('\\', '/'));
const files = [...new Set([...worktreeFiles, ...index.keys()])].sort();
const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['openai-project-key', /\bsk-proj-[A-Za-z0-9_-]{40,}/],
  ['other-api-token', /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{32,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,})\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['telegram-token', /\b[0-9]{8,12}:[A-Za-z0-9_-]{30,}\b/],
  ['behindrose-invite', /\bRDNS-[A-Z2-7]{26}\b/i],
  ['bearer-literal', /\bBearer\s+[A-Za-z0-9_~+/=-]{16,}/i],
  ['sensitive-query', /[?&](?:token|api[-_]?key|access[-_]?token|secret|password|passwd|signature|key|auth|subscription)=[^\s&#<>"']{6,}/i],
  ['url-userinfo', /\b(?:https?|socks[45]?|postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/([^/\s<>"']+:[^/\s<>"']+)@([^/\s<>"']+)/i],
  ['credential-assignment', /["']?\b(?:[a-z0-9_]*(?:password|passwd|api_?key|access_?token|refresh_?token|admin_?key|admin_?token|client_?secret|private_?key|invite_?code))["']?\s*[:=]\s*["']([^"'\r\n]{6,})["']/i],
  ['unquoted-credential-assignment', /^\s*[a-z0-9_]*(?:password|passwd|api_?key|access_?token|refresh_?token|admin_?key|admin_?token|client_?secret|private_?key|invite_?code)\s*[:=]\s*([a-z0-9][a-z0-9_./+=@!:%-]{7,})\s*(?:#.*)?$/i],
].map(([kind, pattern]) => [kind, new RegExp(pattern.source, pattern.flags + 'g')]);
const placeholder = /^(?:removed|example|sample|dummy|fixture|test|placeholder|redacted|change[-_]?me|your[-_].*|<[^>]+>|\$\{[^}]+\})$/i;
const textExtensions = new Set(['.cs', '.csproj', '.props', '.targets', '.slnx', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.xml', '.config', '.md', '.txt', '.html', '.css', '.svg', '.ps1', '.cmd', '.py', '.sh', '.go', '.mod', '.sum', '.toml', '.ini', '.env', '.http', '.iss']);
const isText = file => textExtensions.has(path.extname(file).toLowerCase()) || /(?:^|\/)(?:LICENSE(?:\.md|\.txt)?|\.gitignore|\.gitattributes|\.env(?:\..*)?|pre-commit)$/i.test(file);
const privatePath = /(?:^|\/)(?:private|artifacts|test-files|ui-smoke|node_modules|bin|obj|\.packages|\.vs|test-results|playwright-report|secrets|local|\.ssh|\.aws|\.azure|\.kube)(?:\/|$)|^server\/simple-auth(?:\/|$)|^docs\/(?:ui-refero-2026-10-02|ui-reactbits-2026-10-02|connectivity-check|proxy-network-check|netquality-check)(?:\/|$)|^docs\/邀请码与设备绑定方案\.md$/i;
const privateFile = /(?:^|\/)(?:\.git-credentials|\.netrc|_netrc|\.npmrc|\.pypirc|id_(?:rsa|dsa|ecdsa|ed25519)|credentials\.json|service-account[^/]*\.json|cookies\.txt|auth-connection\.json|[^/]*-invite\.txt|[^/]*邀请码[^/]*\.txt)$|\.(?:pem|key|pfx|p12|ppk|p8|pkcs12|jks|keystore|sqlite3?|db(?:-shm|-wal)?|log|user|bak|backup|old|zip|7z|rar|tar|tgz|exe|dll|pdb)$|\.tar\.gz$|\.credentials\.json$|~$/i;
const privateEnv = file => /(?:^|\/)\.env(?:\..*)?$/i.test(file) && path.posix.basename(file) !== '.env.example';
const findings = []; let scannedTextFiles = 0, skippedFiles = 0;
const indexedIgnored = new Set();
if (gitRepository && index.size) {
  const ignored = spawnSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], { ...commandOptions, encoding: 'utf8', input: [...index.keys()].join('\0') + '\0' });
  if (ignored.error || ![0, 1].includes(ignored.status)) throw Error('Cannot check ignored Git index paths.');
  for (const file of ignored.stdout.split('\0').filter(Boolean)) indexedIgnored.add(file);
}
// Read all text blobs in one process. --staged never substitutes worktree data.
const indexedContents = new Map();
const blobs = [...index].filter(([file, entry]) => isText(file) && entry.mode !== '120000' && entry.mode !== '160000');
if (blobs.length) {
  const sizes = git(['cat-file', '--batch-check'], { input: blobs.map(([, entry]) => entry.oid).join('\n') + '\n', encoding: 'utf8' }).trim().split('\n');
  const readable = blobs.filter(([file], i) => {
    if (!/^[a-f0-9]+ blob \d+$/.test(sizes[i])) throw Error('Unexpected Git object; check aborted.');
    if (Number(sizes[i].split(' ')[2]) <= 4 * 1024 * 1024) return true;
    findings.push({ kind: 'oversized-text-file', path: file, source: 'index' });
    return false;
  });
  if (readable.length) {
    const output = git(['cat-file', '--batch'], { input: readable.map(([, entry]) => entry.oid).join('\n') + '\n' });
    let offset = 0;
    for (const [file, entry] of readable) {
      const end = output.indexOf(10, offset), header = output.subarray(offset, end).toString('utf8').split(' ');
      if (end < 0 || header[0] !== entry.oid || header[1] !== 'blob') throw Error('Unexpected Git batch response; check aborted.');
      const size = Number(header[2]);
      if (!Number.isSafeInteger(size) || size < 0 || end + 1 + size >= output.length || output[end + 1 + size] !== 10) throw Error('Incomplete Git blob; check aborted.');
      indexedContents.set(file, output.subarray(end + 1, end + 1 + size));
      offset = end + size + 2;
    }
  }
}
function decodeText(data) {
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data);
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data);
  return data.toString('utf8');
}
function scanText(file, data, source) {
  const text = decodeText(data); scannedTextFiles++;
  if (text.includes('\0')) findings.push({ kind: 'binary-content-in-text-file', path: file, source });
  if (/\.(?:cs|ts|tsx|js|mjs|cjs|sh|css|go|py|txt)$/.test(file) && /GNU\s+AFFERO\s+GENERAL\s+PUBLIC\s+LICENSE|SPDX-License-Identifier:\s*AGPL[-\w.]*/i.test(text))
    findings.push({ kind: 'agpl-license-in-public-source', path: file, source });
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [kind, pattern] of patterns) {
      for (const match of line.matchAll(pattern)) {
        if (kind.endsWith('credential-assignment') && placeholder.test(match[1])) continue;
        if (kind === 'url-userinfo' && match[1] === 'user:pass' && match[2] === 'example.com') continue;
        findings.push({ kind, path: file, line: index + 1, source });
      }
    }
  });
}
for (const file of files) {
  if (privatePath.test(file) || privateFile.test(file) || privateEnv(file) || indexedIgnored.has(file))
    findings.push({ kind: 'excluded-data-visible', path: file });
  if (/^(?:vendor\/(?:NetQuality|IPQuality)(?:\/|$)|licenses\/(?:NetQuality|IPQuality)-AGPL-|src\/BehindRose\.Windows\/NetQualityRunner\.cs$|frontend\/src\/netquality(?:-|\.)|frontend\/tests\/netquality-|tests\/BehindRose\.Tests\/NetQualityTests\.cs$)/i.test(file))
    findings.push({ kind: 'retired-agpl-module', path: file });
  const absolute = path.resolve(root, file);
  if (!absolute.startsWith(root + path.sep)) throw Error('Inventory path leaves the project.');
  const entry = index.get(file);
  if (entry && !['100644', '100755'].includes(entry.mode)) findings.push({ kind: 'unsupported-index-entry', path: file, source: 'index' });
  if (indexedContents.has(file)) scanText(file, indexedContents.get(file), 'index');
  if (!staged) {
    let info;
    try { info = await lstat(absolute); } catch (error) { if (error.code === 'ENOENT' && entry) continue; throw error; }
    if (info.isSymbolicLink()) { findings.push({ kind: 'symlink-in-public-source', path: file, source: 'worktree' }); continue; }
    if (!isText(file)) { skippedFiles++; continue; }
    if (info.size > 4 * 1024 * 1024) { findings.push({ kind: 'oversized-text-file', path: file, source: 'worktree' }); continue; }
    scanText(file, await readFile(absolute), 'worktree');
  } else if (!isText(file)) skippedFiles++;
}
async function sourceBytes(file) {
  if (staged) {
    if (!indexedContents.has(file)) throw Error('Required source file is missing from the Git index: ' + file);
    return indexedContents.get(file);
  }
  return readFile(path.join(root, file));
}
async function sourceText(file) { return decodeText(await sourceBytes(file)); }
let projectLicense = false, thirdPartyBoundaryDocumented = false;
const licenseIssues = [];
try {
  const license = await sourceText('LICENSE');
  projectLicense = license.includes('LicenseRef-BehindRose-Noncommercial-1.0') && license.includes('Commercial use is not licensed') && license.includes('Third-party material');
  if (!projectLicense) licenseIssues.push('Project license identity or scope is missing.');
} catch { licenseIssues.push('Root LICENSE is missing.'); }
let restrictedUiLicense = false;
try {
  restrictedUiLicense = (await sourceText('licenses/react-bits-LICENSE.md')).includes('Commons Clause');
  const scope = JSON.parse(await sourceText('licenses/scope.json'));
  if (scope.projectLicense !== 'LicenseRef-BehindRose-Noncommercial-1.0') throw Error('Scope does not identify the project license.');
  for (const name of ['React Bits', 'GSAP']) {
    const entry = scope.restrictedDependencies.find(item => item.name === name);
    if (!entry || !entry.applicationUse || !entry.boundary || !/^[a-f0-9]{64}$/.test(entry.noticeSha256)) throw Error('Incomplete third-party scope: ' + name);
    const notice = path.resolve(root, entry.notice);
    if (!notice.startsWith(path.join(root, 'licenses') + path.sep)) throw Error('Notice is outside licenses.');
    if (createHash('sha256').update(await sourceBytes(path.relative(root, notice).replaceAll('\\', '/'))).digest('hex') !== entry.noticeSha256) throw Error('Notice changed; recheck scope: ' + name);
  }
  await sourceBytes('THIRD_PARTY_NOTICES.md');
  await sourceBytes('docs/许可证说明.md');
  thirdPartyBoundaryDocumented = true;
} catch { licenseIssues.push('Third-party license records are missing, invalid or inconsistent with recorded hashes; source content withheld.'); }
const report = {
  scope: staged ? 'Entire Git index, including forced ignored files; reads indexed blobs, not worktree replacements.' : 'Current non-ignored source tree plus the entire Git index, including forced ignored files.',
  gitRepository, indexedFiles: index.size, staged,
  inventoryFiles: files.length, scannedTextFiles, skippedBinaryOrLargeFiles: skippedFiles,
  credentialPatterns: patterns.map(([name]) => name), findings,
  releaseReview: { projectLicense, restrictedUiLicense, thirdPartyBoundaryDocumented, licenseIssues, mainLicenseDecisionRequired: !projectLicense, thirdPartyLicenseBoundaryReviewRequired: !thirdPartyBoundaryDocumented },
  limitations: 'No Git history or remote scan. Patterns cannot prove every secret absent; binary/image metadata needs separate review. Hooks can be bypassed and must be installed per clone. Only project files and Git metadata are read; system configuration is not applied.',
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exitCode = findings.length ? 1 : projectLicense && thirdPartyBoundaryDocumented ? 0 : 2;
