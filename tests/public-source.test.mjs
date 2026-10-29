import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';
import { publicHandbookArchive, handbookEntries, readPublicHandbookArchive } from '../scripts/public-handbook-archive.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await realpath(tmpdir());
const fixture = await mkdtemp(path.join(temporaryRoot, 'behindrose-public-source-'));
const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(fixture, 'unused-global-config'), GIT_TERMINAL_PROMPT: '0' };
// A caller may be verifying another index; never share its Git state with fixtures.
for (const key of Object.keys(environment)) {
  if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|PREFIX|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/.test(key)) delete environment[key];
}
const syntheticKey = 'ghp' + '_' + randomBytes(24).toString('hex');
const syntheticValue = randomBytes(24).toString('hex');
const syntheticInvite = 'RDNS' + '-' + 'A'.repeat(26);
const passwordField = ['pass', 'word'].join('');
const apiField = ['API', 'KEY'].join('_');
let checks = 0;
function run(command, args) {
  const result = spawnSync(command, args, { cwd: fixture, env: environment, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.ifError(result.error);
  return result;
}
function git(...args) {
  const result = run('git', args);
  assert.equal(result.status, 0, 'Fixture Git command failed: ' + args[0]);
  return result.stdout;
}
async function put(file, content) {
  await mkdir(path.dirname(path.join(fixture, file)), { recursive: true });
  await writeFile(path.join(fixture, file), content);
}
function scan(expected, ...args) {
  const result = run(process.execPath, ['scripts/check-public-source.mjs', ...args]);
  assert.equal(result.status, expected, 'Unexpected source-check exit status: ' + result.stdout + result.stderr);
  for (const value of [syntheticKey, syntheticValue, syntheticInvite]) assert.equal((result.stdout + result.stderr).includes(value), false, 'Sensitive fixture text must not be printed.');
  checks++;
  return JSON.parse(result.stdout);
}
function handbookZip(overrides = {}) {
  let offset = 0;
  const locals = [], directory = [];
  for (const entry of handbookEntries) {
    const name = Buffer.from(overrides.rename === entry ? '../snapshot.brclash' : entry);
    const data = Buffer.from(overrides[entry] ?? 'Public fixture.\n');
    const packed = deflateRawSync(data);
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50); central.writeUInt32LE(0x02014b50);
    local.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    local.writeUInt16LE(8, 8); central.writeUInt16LE(8, 10);
    for (const [buffer, at] of [[local, 14], [central, 16]]) {
      buffer.writeUInt32LE(crc32(data), at); buffer.writeUInt32LE(packed.length, at + 4); buffer.writeUInt32LE(data.length, at + 8);
    }
    local.writeUInt16LE(name.length, 26); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed); directory.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(handbookEntries.length, 8); end.writeUInt16LE(handbookEntries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
try {
  const scope = JSON.parse(await readFile(path.join(project, 'licenses/scope.json'), 'utf8'));
  const copies = new Set(['scripts/check-public-source.mjs', 'scripts/install-git-hooks.mjs', '.gitignore', '.gitattributes', '.githooks/pre-commit', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/许可证说明.md', 'licenses/scope.json', 'licenses/react-bits-LICENSE.md', ...scope.restrictedDependencies.map(entry => entry.notice)]);
  for (const file of copies) {
    await mkdir(path.dirname(path.join(fixture, file)), { recursive: true });
    await copyFile(path.join(project, file), path.join(fixture, file));
  }
  await copyFile(path.join(project, 'scripts/public-handbook-archive.mjs'), path.join(fixture, 'scripts/public-handbook-archive.mjs'));
  const privateFiles = ['private/invite.txt', '.env', '.env.local', '.ssh/id_ed25519', 'server/simple-auth/deployment.md', 'frontend/reactbits-registry/source.json', 'docs/ui-refero-2026-10-02/evidence/report.json', 'credentials.json', 'cookies.txt', 'test.key', 'export.zip', 'first-invite.txt', 'snapshot.brclash', 'ClashBackups/summary.json'];
  for (const file of privateFiles) await put(file, 'Private fixture material.\n');
  assert.equal(scan(0).gitRepository, false, 'Source export without Git still supports inspection.');

  git('init', '--quiet');
  // Exercise the same Windows line-ending conversion commonly used by this repo.
  git('config', 'core.autocrlf', 'true');
  git('add', '.');
  const indexed = git('ls-files', '-z').split('\0').filter(Boolean);
  for (const file of privateFiles) assert.equal(indexed.includes(file), false, 'git add must exclude private fixture paths.');
  scan(0, '--staged');

  for (const file of privateFiles) {
    git('add', '--force', '--', file);
    const result = scan(1, '--staged');
    assert.ok(result.findings.some(finding => finding.path === file && finding.kind === 'excluded-data-visible'), 'Forced private index entry must fail the gate.');
    git('rm', '--cached', '--force', '--quiet', '--', file);
  }

  await put('review-note.md', syntheticKey + '\n');
  git('add', 'review-note.md');
  await put('review-note.md', 'Clean worktree replacement.\n');
  for (const args of [[], ['--staged']]) assert.ok(scan(1, ...args).findings.some(finding => finding.kind === 'github-token' && finding.source === 'index'), 'A clean worktree must not hide an indexed credential.');
  git('rm', '--cached', '--force', '--quiet', 'review-note.md');
  await put('review-note.md', passwordField + '=' + JSON.stringify('removed') + '; ' + passwordField + '=' + JSON.stringify(syntheticValue) + '\n' + syntheticInvite + '\n' + syntheticInvite.toLowerCase() + '\n');
  git('add', 'review-note.md');
  const copied = scan(1, '--staged');
  assert.ok(copied.findings.some(finding => finding.kind === 'credential-assignment'), 'A placeholder earlier on a line must not hide a second credential.');
  assert.equal(copied.findings.filter(finding => finding.kind === 'behindrose-invite').length, 2, 'Uppercase and normalized lowercase invite copies must be detected.');
  await put('review-note.md', 'Public fixture note.\n');
  git('add', 'review-note.md');

  await put('.env.example', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(apiField + '=' + syntheticKey, 'utf16le')]));
  git('add', '.env.example');
  assert.ok(scan(1, '--staged').findings.some(finding => finding.kind === 'github-token'), 'UTF-16 text must not bypass credential matching.');
  await put('.env.example', apiField + '=' + syntheticValue + '\n');
  git('add', '.env.example');
  assert.ok(scan(1, '--staged').findings.some(finding => finding.kind === 'unquoted-credential-assignment'), 'Unquoted environment credentials must be detected.');
  await put('.env.example', 'API_KEY=<your-key>\n');
  git('add', '.env.example');

  const license = await readFile(path.join(fixture, 'LICENSE'));
  await put('LICENSE', 'Unstaged invalid license.\n');
  scan(0, '--staged');
  scan(2);
  await put('LICENSE', license);
  git('rm', '--cached', '--force', '--quiet', 'LICENSE');
  scan(2, '--staged');
  git('add', 'LICENSE');
  const scopeBytes = await readFile(path.join(fixture, 'licenses/scope.json'));
  await put('licenses/scope.json', syntheticKey);
  git('add', 'licenses/scope.json');
  scan(1, '--staged');
  await put('licenses/scope.json', scopeBytes);
  git('add', 'licenses/scope.json');

  const safeArchive = handbookZip();
  assert.equal(readPublicHandbookArchive(safeArchive).length, handbookEntries.length);
  assert.equal(readPublicHandbookArchive(await readFile(path.join(project, publicHandbookArchive))).length, handbookEntries.length, 'The shipped deflated archive must be fully readable.');
  await put(publicHandbookArchive, safeArchive);
  git('add', publicHandbookArchive);
  scan(0, '--staged');
  const secretArchive = handbookZip({ 'scripts/Launch-Claude.ps1': syntheticKey });
  await put(publicHandbookArchive, secretArchive);
  git('add', publicHandbookArchive);
  await put(publicHandbookArchive, safeArchive);
  assert.ok(scan(1, '--staged').findings.some(finding => finding.kind === 'github-token' && finding.path.endsWith('!/scripts/Launch-Claude.ps1')), 'Clean worktree ZIP must not hide an indexed compressed credential.');
  for (const invalid of [
    handbookZip({ rename: 'claude-guide.md' }),
    Buffer.concat([safeArchive, Buffer.from('hidden data')]),
    Buffer.from(safeArchive),
    Buffer.from(safeArchive),
  ].map((data, i) => {
    if (i === 2) data[30 + Buffer.byteLength(handbookEntries[0])] ^= 1; // CRC mismatch.
    if (i === 3) data.writeUInt32LE(5 * 1024 * 1024, data.readUInt32LE(data.length - 6) + 24); // Output bound.
    return data;
  })) {
    await put(publicHandbookArchive, invalid); git('add', publicHandbookArchive);
    assert.ok(scan(1, '--staged').findings.some(finding => finding.kind === 'invalid-public-archive'), 'Traversal, trailing data, corruption and oversized entries must be blocked.');
  }
  await put(publicHandbookArchive, safeArchive); git('add', publicHandbookArchive);

  assert.equal(run(process.execPath, ['scripts/install-git-hooks.mjs']).status, 0, 'Hook installation must succeed.');
  assert.equal(run('git', ['hook', 'run', 'pre-commit']).status, 0, 'Installed hook must accept the safe index.');
  git('add', '--force', '.env');
  const commit = run('git', ['-c', 'user.name=Source Safety Test', '-c', 'user.email=source-safety@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Must be rejected by the private-source guard']);
  assert.notEqual(commit.status, 0, 'Installed hook must block a commit containing private data.');
  assert.ok((commit.stdout + commit.stderr).includes('excluded-data-visible'), 'Rejection must come from the source guard.');
  assert.notEqual(run('git', ['rev-parse', '--verify', 'HEAD']).status, 0, 'The rejected fixture commit must not create history.');
  git('rm', '--cached', '--force', '--quiet', '.env');
  git('-c', 'user.name=Source Safety Test', '-c', 'user.email=source-safety@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Safe initial fixture');
  for (const file of ['rows.csv', 'settings.conf', 'Dockerfile']) {
    await put(file, syntheticKey + '\n');
    git('add', file);
    assert.ok(scan(1, '--staged').findings.some(finding => finding.kind === 'github-token' && finding.path === file), 'Unusual extensions must not bypass credential detection.');
    git('rm', '--cached', '--force', '--quiet', file);
    await put(file, 'Public fixture.\n');
  }
  await put('retired.csv', syntheticKey + '\n');
  git('add', 'retired.csv');
  await put(publicHandbookArchive, secretArchive); git('add', publicHandbookArchive);
  // Deliberately bypass the fixture hook to simulate an old accidental commit.
  git('-c', 'core.hooksPath=unused-hooks', '-c', 'user.name=Source Safety Test', '-c', 'user.email=source-safety@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Historical fixture');
  git('rm', '--quiet', 'retired.csv');
  await put(publicHandbookArchive, safeArchive); git('add', publicHandbookArchive);
  git('-c', 'user.name=Source Safety Test', '-c', 'user.email=source-safety@example.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Remove historical fixture');
  scan(0);
  const historical = scan(1, '--history');
  assert.equal(historical.historicalCommits, 3);
  assert.ok(historical.findings.some(finding => finding.kind === 'github-token' && finding.source === 'history' && finding.path.startsWith('retired.csv@')), 'Deleting a credential must not hide it from historical inspection.');
  assert.ok(historical.findings.some(finding => finding.kind === 'github-token' && finding.source === 'history' && finding.path.includes('!/scripts/Launch-Claude.ps1')), 'Replacing a ZIP must not hide historical archive credentials.');
  await put('nodes.conf', ['vless', '://', syntheticValue, '@example.invalid:443'].join(''));
  git('add', 'nodes.conf');
  assert.ok(scan(1, '--staged').findings.some(finding => finding.kind === 'proxy-subscription'));
  git('rm', '--cached', '--force', '--quiet', 'nodes.conf');
  await put('nodes.conf', 'Public fixture.\n');
  git('add', '--force', '.env');
  git('-c', 'core.hooksPath=unused-hooks', '-c', 'user.name=Source Safety Test', '-c', 'user.email=source-safety@fixture.invalid', '-c', 'commit.gpgSign=false', 'commit', '-m', 'Historical private path fixture');
  git('rm', '--cached', '--force', '--quiet', '.env');
  const forbiddenHistory = scan(1, '--history');
  assert.ok(forbiddenHistory.findings.some(finding => finding.kind === 'excluded-data-visible' && finding.source === 'history' && finding.path === '.env'));
  assert.ok(forbiddenHistory.findings.some(finding => finding.kind === 'personal-commit-email'));
  await put('.git/shallow', git('rev-parse', 'HEAD').trim() + '\n');
  const shallow = run(process.execPath, ['scripts/check-public-source.mjs', '--history']);
  assert.notEqual(shallow.status, 0);
  assert.ok(shallow.stderr.includes('History check requires a full clone'));
  console.log(`PASS: ${checks} source/index/history scans; forced staging, UTF-16, unknown extensions, deleted historical credentials, private paths/emails, shallow-clone rejection, license checks and commit hook.`);
} finally {
  const resolved = await realpath(fixture);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('behindrose-public-source-')) throw Error('Refusing to remove an unexpected fixture path.');
  await rm(resolved, { recursive: true, force: true });
}
