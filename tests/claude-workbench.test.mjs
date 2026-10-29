// Offline integration: only the demo host's stdin/stdout JSON bridge is used.
// Do not add HTTP servers, socket checks, browser calls, or network-start commands.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { testRuntime, projectRoot } from '../scripts/test-runtime.mjs';

const { dotnet, hostDll } = testRuntime();
const child = spawn(dotnet, [hostDll, '--demo'], {
  cwd: projectRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map();
const lines = createInterface({ input: child.stdout });
const allowedCommands = new Set([
  'health', 'backups', 'execute', 'claude-inspect', 'claude-plan',
  'claude-apply', 'claude-backups', 'claude-restore-plan', 'claude-restore',
  'claude-timezone-inspect', 'claude-timezone-plan', 'claude-timezone-apply',
  'claude-timezone-backups', 'claude-timezone-restore-plan', 'claude-timezone-restore',
]);
let stderr = '', transportError;
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
function failPending(error) {
  transportError = error;
  for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
  pending.clear();
}
child.once('error', failPending);
const exited = new Promise(resolve => child.once('close', (code, signal) => {
  if (pending.size) failPending(Error(`Demo host exited (${code ?? signal}): ${stderr}`));
  resolve({ code, signal });
}));
lines.on('line', line => {
  try {
    const reply = JSON.parse(line);
    const waiter = pending.get(reply.id);
    if (!waiter) return failPending(Error('Unexpected demo bridge response ID.'));
    pending.delete(reply.id);
    clearTimeout(waiter.timer);
    waiter.resolve(reply);
  } catch (error) { failPending(error); }
});
function call(command, fields = {}) {
  assert.ok(allowedCommands.has(command), `Offline command allowlist rejected ${command}`);
  if (transportError) return Promise.reject(transportError);
  const id = randomUUID().replaceAll('-', '');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Error(`Demo bridge timeout: ${command}`));
    }, 10000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, command, ...fields }) + '\n', error => {
      if (error) failPending(error);
    });
  });
}
async function data(command, fields) {
  const reply = await call(command, fields);
  assert.equal(reply.ok, true, `${command}: ${reply.error ?? JSON.stringify(reply)}`);
  assertRedacted(reply.data);
  return reply.data;
}
async function rejected(command, fields) {
  const reply = await call(command, fields);
  assert.equal(reply.ok, false, `${command} must reject ${JSON.stringify(fields)}`);
  assert.equal(typeof reply.error, 'string');
  assertRedacted(reply);
}
function assertKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), label);
}
function assertRedacted(value) {
  const serialized = JSON.stringify(value);
  for (const secret of ['demo-claude-token-never-export', 'https://gateway.example.invalid', 'demo-deepseek']) {
    assert.equal(serialized.includes(secret), false, `Fake secret/configuration value leaked: ${secret}`);
  }
  const forbiddenKeys = new Set(['snapshot', 'settings', 'credentials', 'raw', 'before', 'after', 'expected', 'fingerprint', 'apiKey', 'authToken']);
  function visit(item) {
    if (!item || typeof item !== 'object') return;
    for (const [key, nested] of Object.entries(item)) {
      assert.equal(forbiddenKeys.has(key), false, `Private field leaked: ${key}`);
      visit(nested);
    }
  }
  visit(value);
}
function assertPreview(preview, action, mode, proxyPort) {
  assertKeys(preview, ['id', 'expires', 'action', 'mode', 'proxyPort', 'hasChanges', 'changes', 'warnings'], 'Preview exposes display fields only');
  assert.match(preview.id, /^[0-9a-f]{32}$/);
  assert.ok(Number.isFinite(Date.parse(preview.expires)));
  assert.equal(preview.action, action);
  if (mode !== undefined) assert.equal(preview.mode, mode);
  if (proxyPort !== undefined) assert.equal(preview.proxyPort, proxyPort);
  assert.equal(preview.hasChanges, preview.changes.length > 0);
  assert.ok(Array.isArray(preview.warnings));
  for (const change of preview.changes) {
    assertKeys(change, ['title', 'beforeText', 'afterText'], 'Change exposes display text only');
    for (const text of Object.values(change)) assert.equal(typeof text, 'string');
  }
}
function stableHealth(health) {
  const { checkedAt, ...stable } = health;
  assert.ok(checkedAt);
  return stable;
}
function assertBackupList(backups) {
  assert.ok(Array.isArray(backups));
  for (const backup of backups) {
    assertKeys(backup, ['id', 'createdAt', 'mode', 'canRestore', 'state'], 'Backup bytes must stay in the host');
    assert.match(backup.id, /^[0-9a-f]{32}$/);
    assert.equal(typeof backup.canRestore, 'boolean');
  }
}
function assertTimeZonePreview(preview, action, currentId, targetId) {
  assertKeys(preview, ['id', 'expires', 'action', 'currentId', 'currentLabel', 'targetId', 'targetLabel', 'hasChanges', 'warnings'], 'Time-zone preview exposes display metadata only');
  assert.match(preview.id, /^[0-9a-f]{32}$/);
  assert.ok(Number.isFinite(Date.parse(preview.expires)));
  assert.equal(preview.action, action);
  assert.equal(preview.currentId, currentId);
  assert.equal(preview.targetId, targetId);
  assert.equal(typeof preview.currentLabel, 'string');
  assert.equal(typeof preview.targetLabel, 'string');
  assert.equal(typeof preview.hasChanges, 'boolean');
  assert.ok(Array.isArray(preview.warnings));
  assert.match(preview.warnings.join('\n'), /可选.*未.*证实|可选.*没有防封/);
}
function assertTimeZoneBackups(backups) {
  assert.ok(Array.isArray(backups));
  for (const backup of backups) {
    assertKeys(backup, ['id', 'createdAt', 'beforeId', 'beforeLabel', 'afterId', 'afterLabel', 'canRestore', 'state'], 'Time-zone backup exposes no encrypted payload or snapshot');
    assert.match(backup.id, /^[0-9a-f]{32}$/);
    assert.equal(typeof backup.canRestore, 'boolean');
  }
}

try {
  const initialHealth = stableHealth(await data('health'));
  assert.equal(initialHealth.demo, true);
  const initialClashBackups = await data('backups');
  const initial = await data('claude-inspect');
  assertKeys(initial, ['settingsFound', 'canConfigure', 'route', 'configuredProxyPort', 'suggestedProxyPorts', 'conflictingEnvironmentVariables', 'customModelVariables', 'warnings']);
  assert.equal(initial.settingsFound, true, 'Demo uses a fake preexisting configuration');
  assert.equal(initial.canConfigure, true);
  assert.equal(typeof initial.route, 'string');
  assert.ok(initial.customModelVariables.length > 0, 'Demo must exercise overridden model aliases');
  assert.deepEqual(initial.conflictingEnvironmentVariables, [], 'Demo must ignore the real machine environment');
  assert.deepEqual(await data('claude-backups'), []);

  const proxyPort = initial.configuredProxyPort === 7897 ? 7898 : 7897;
  const preview = await data('claude-plan', { mode: 'preserve', proxyPort });
  assertPreview(preview, 'apply', 'preserve', proxyPort);
  assert.equal(preview.hasChanges, true);
  assert.deepEqual(await data('claude-inspect'), initial, 'Preview must not modify configuration');
  assert.deepEqual(await data('claude-backups'), [], 'Preview must not create backups');
  for (const boundaryPort of [1, 65535]) {
    assertPreview(await data('claude-plan', { mode: 'preserve', proxyPort: boundaryPort }), 'apply', 'preserve', boundaryPort);
  }

  // All malformed inputs are rejected by the bounded bridge before execution.
  for (const fields of [
    {}, { mode: 'preserve' }, { proxyPort },
    { mode: 'other', proxyPort }, { mode: 'Preserve', proxyPort },
    { mode: null, proxyPort }, { mode: 'preserve', proxyPort: null },
    { mode: 'preserve', proxyPort: 0 }, { mode: 'preserve', proxyPort: 65536 },
    { mode: 'preserve', proxyPort: -1 }, { mode: 'preserve', proxyPort: 7897.5 },
    { mode: 'preserve', proxyPort: '7897' }, { mode: 'preserve', proxyPort: true },
    { mode: 'preserve', proxyPort, script: 'arbitrary command' },
    { mode: 'preserve', proxyPort, host: 'example.invalid' },
    { mode: 'preserve', proxyPort, options: 1 },
  ]) await rejected('claude-plan', fields);
  for (const command of ['claude-inspect', 'claude-backups']) {
    for (const fields of [{ proxyPort }, { mode: 'preserve' }, { extra: true }]) await rejected(command, fields);
  }
  for (const command of ['claude-apply', 'claude-restore']) {
    for (const fields of [{}, { planId: '' }, { planId: '../settings.json' }, { planId: 123 }, { planId: '0'.repeat(32) }, { planId: preview.id, extra: true }]) await rejected(command, fields);
  }
  for (const fields of [{}, { backupId: '' }, { backupId: '../settings.json' }, { backupId: 123 }, { backupId: '0'.repeat(32) }, { backupId: '0'.repeat(32), extra: true }]) await rejected('claude-restore-plan', fields);
  assert.deepEqual(await data('claude-inspect'), initial, 'Rejected input must leave settings untouched');

  const wrongAction = await data('claude-plan', { mode: 'preserve', proxyPort });
  await rejected('claude-restore', { planId: wrongAction.id });
  await rejected('execute', { planId: wrongAction.id });
  assert.deepEqual(await data('claude-inspect'), initial, 'Wrong execute command must not apply a Claude plan');
  const stale = await data('claude-plan', { mode: 'preserve', proxyPort: proxyPort + 1 });
  const applyPreview = await data('claude-plan', { mode: 'preserve', proxyPort });
  const applied = await data('claude-apply', { planId: applyPreview.id });
  assert.equal(applied.success, true);
  assert.equal(applied.state, 'applied');
  assert.match(applied.backupId, /^[0-9a-f]{32}$/);
  const configured = await data('claude-inspect');
  assert.equal(configured.configuredProxyPort, proxyPort);
  assert.equal(configured.route, initial.route, 'Preserve mode retains the current provider route');
  assert.deepEqual(configured.customModelVariables, initial.customModelVariables, 'Preserve mode retains model aliases');
  await rejected('claude-apply', { planId: applyPreview.id });
  await rejected('claude-apply', { planId: stale.id });

  const backupsAfterApply = await data('claude-backups');
  assertBackupList(backupsAfterApply);
  assert.equal(backupsAfterApply.filter(item => item.canRestore).length, 1);
  assert.equal(backupsAfterApply.find(item => item.id === applied.backupId)?.canRestore, true);
  const noop = await data('claude-plan', { mode: 'preserve', proxyPort });
  assertPreview(noop, 'apply', 'preserve', proxyPort);
  assert.equal(noop.hasChanges, false);
  const unchanged = await data('claude-apply', { planId: noop.id });
  assert.equal(unchanged.success, true);
  assert.equal(unchanged.state, 'unchanged');
  assert.deepEqual(await data('claude-backups'), backupsAfterApply, 'No-op apply must not create another backup');

  const restorePreview = await data('claude-restore-plan', { backupId: applied.backupId });
  assertPreview(restorePreview, 'restore');
  assert.equal(restorePreview.hasChanges, true);
  assert.deepEqual(await data('claude-inspect'), configured, 'Restore preview must not mutate settings');
  await rejected('claude-apply', { planId: restorePreview.id });
  const freshRestore = await data('claude-restore-plan', { backupId: applied.backupId });
  const restored = await data('claude-restore', { planId: freshRestore.id });
  assert.equal(restored.success, true);
  assert.equal(restored.state, 'restored');
  assert.deepEqual(await data('claude-inspect'), initial, 'Restore recovers the original complete public summary');
  await rejected('claude-restore', { planId: freshRestore.id });
  const backupsAfterRestore = await data('claude-backups');
  assertBackupList(backupsAfterRestore);
  assert.equal(backupsAfterRestore.find(item => item.id === applied.backupId)?.state, 'restored');
  assert.equal(backupsAfterRestore.find(item => item.id === applied.backupId)?.canRestore, false);
  assert.equal(backupsAfterRestore.find(item => item.id === restored.backupId)?.mode, 'restore', 'Restore keeps its own encrypted undo backup');
  assert.equal(backupsAfterRestore.find(item => item.id === restored.backupId)?.canRestore, true);
  await rejected('claude-restore-plan', { backupId: applied.backupId });

  const officialPreview = await data('claude-plan', { mode: 'official', proxyPort });
  assertPreview(officialPreview, 'apply', 'official', proxyPort);
  assert.equal(officialPreview.hasChanges, true);
  const officialApplied = await data('claude-apply', { planId: officialPreview.id });
  assert.equal(officialApplied.success, true);
  const official = await data('claude-inspect');
  assert.equal(official.configuredProxyPort, proxyPort);
  assert.deepEqual(official.customModelVariables, [], 'Official mode clears custom model aliases');
  assert.notEqual(official.route, initial.route, 'Official mode removes the gateway route');
  const officialNoop = await data('claude-plan', { mode: 'official', proxyPort });
  assert.equal(officialNoop.hasChanges, false);
  const officialRestore = await data('claude-restore-plan', { backupId: officialApplied.backupId });
  assert.equal((await data('claude-restore', { planId: officialRestore.id })).success, true);
  assert.deepEqual(await data('claude-inspect'), initial, 'Official-mode restore recovers custom provider/model metadata');
  await rejected('claude-apply', { planId: officialNoop.id });

  assert.deepEqual(stableHealth(await data('health')), initialHealth, 'Claude configuration must leave Clash and browser settings untouched');
  assert.deepEqual(await data('backups'), initialClashBackups, 'Claude backups must not enter the Clash repair history');

  // Time-zone feature uses the demo's in-memory UTC fixture, never Windows state.
  const claudeBeforeTimeZone = await data('claude-inspect');
  const claudeBackupsBeforeTimeZone = await data('claude-backups');
  const initialTimeZone = await data('claude-timezone-inspect');
  assertKeys(initialTimeZone, ['currentId', 'currentLabel', 'currentDaylightSavingDisabled', 'targetId', 'targetLabel', 'isTaipei', 'canConfigure', 'warnings']);
  assert.equal(initialTimeZone.currentId, 'UTC', 'Time-zone tests must start from the fake UTC fixture');
  assert.equal(initialTimeZone.targetId, 'Taipei Standard Time');
  assert.equal(initialTimeZone.currentDaylightSavingDisabled, false);
  assert.equal(initialTimeZone.isTaipei, false);
  assert.equal(initialTimeZone.canConfigure, true);
  assert.deepEqual(await data('claude-timezone-backups'), []);
  const zonePreview = await data('claude-timezone-plan');
  assertTimeZonePreview(zonePreview, 'apply', initialTimeZone.currentId, initialTimeZone.targetId);
  assert.equal(zonePreview.hasChanges, true);
  assert.deepEqual(await data('claude-timezone-inspect'), initialTimeZone, 'Time-zone preview must not write');
  assert.deepEqual(await data('claude-timezone-backups'), [], 'Time-zone preview must not create a backup');

  for (const command of ['claude-timezone-inspect', 'claude-timezone-plan', 'claude-timezone-backups']) {
    for (const fields of [{ mode: 'official' }, { proxyPort: 7897 }, { targetId: 'UTC' }, { options: 1 }, { extra: true }]) await rejected(command, fields);
  }
  for (const command of ['claude-timezone-apply', 'claude-timezone-restore']) {
    for (const fields of [{}, { planId: '' }, { planId: 123 }, { planId: '../zone' }, { planId: '0'.repeat(32) }, { planId: zonePreview.id, extra: true }, { planId: zonePreview.id, mode: 'official' }]) await rejected(command, fields);
  }
  for (const fields of [{}, { backupId: '' }, { backupId: 123 }, { backupId: '../zone' }, { backupId: '0'.repeat(32) }, { backupId: '0'.repeat(32), extra: true }]) await rejected('claude-timezone-restore-plan', fields);
  await rejected('claude-timezone-restore', { planId: zonePreview.id });
  await rejected('claude-apply', { planId: zonePreview.id });
  await rejected('execute', { planId: zonePreview.id });
  const settingsToken = await data('claude-plan', { mode: 'preserve', proxyPort });
  await rejected('claude-timezone-apply', { planId: settingsToken.id });
  await rejected('claude-timezone-restore-plan', { backupId: applied.backupId });
  assert.deepEqual(await data('claude-timezone-inspect'), initialTimeZone, 'Rejected fields and wrong-action tokens must not change the fake time zone');
  assert.deepEqual(await data('claude-timezone-backups'), []);

  const staleZonePreview = await data('claude-timezone-plan');
  const applyZonePreview = await data('claude-timezone-plan');
  const zoneApplied = await data('claude-timezone-apply', { planId: applyZonePreview.id });
  assert.equal(zoneApplied.success, true);
  assert.equal(zoneApplied.state, 'applied');
  assert.match(zoneApplied.backupId, /^[0-9a-f]{32}$/);
  const configuredTimeZone = await data('claude-timezone-inspect');
  assert.equal(configuredTimeZone.currentId, initialTimeZone.targetId);
  assert.equal(configuredTimeZone.isTaipei, true);
  assert.equal(configuredTimeZone.currentDaylightSavingDisabled, initialTimeZone.currentDaylightSavingDisabled, 'Time-zone apply preserves the daylight-saving flag');
  await rejected('claude-timezone-apply', { planId: applyZonePreview.id });
  await rejected('claude-timezone-apply', { planId: staleZonePreview.id });
  assert.deepEqual(await data('claude-inspect'), claudeBeforeTimeZone, 'Applied time-zone change must not edit fake Claude settings');
  assert.deepEqual(await data('claude-backups'), claudeBackupsBeforeTimeZone);
  assert.deepEqual(stableHealth(await data('health')), initialHealth, 'Applied time-zone change must not edit fake Clash or browser settings');
  assert.deepEqual(await data('backups'), initialClashBackups);

  const zoneBackups = await data('claude-timezone-backups');
  assertTimeZoneBackups(zoneBackups);
  assert.equal(zoneBackups.length, 1);
  assert.equal(zoneBackups[0].id, zoneApplied.backupId);
  assert.equal(zoneBackups[0].beforeId, initialTimeZone.currentId);
  assert.equal(zoneBackups[0].afterId, initialTimeZone.targetId);
  assert.equal(zoneBackups[0].canRestore, true);
  const zoneNoop = await data('claude-timezone-plan');
  assertTimeZonePreview(zoneNoop, 'apply', initialTimeZone.targetId, initialTimeZone.targetId);
  assert.equal(zoneNoop.hasChanges, false);
  const zoneUnchanged = await data('claude-timezone-apply', { planId: zoneNoop.id });
  assert.equal(zoneUnchanged.success, true);
  assert.equal(zoneUnchanged.state, 'unchanged');
  assert.deepEqual(await data('claude-timezone-backups'), zoneBackups, 'No-op time-zone apply must not add backups');
  await rejected('claude-timezone-apply', { planId: zoneNoop.id });

  const zoneRestorePreview = await data('claude-timezone-restore-plan', { backupId: zoneApplied.backupId });
  assertTimeZonePreview(zoneRestorePreview, 'restore', initialTimeZone.targetId, initialTimeZone.currentId);
  assert.equal(zoneRestorePreview.hasChanges, true);
  assert.deepEqual(await data('claude-timezone-inspect'), configuredTimeZone, 'Restore preview does not write fake time-zone state');
  await rejected('claude-timezone-apply', { planId: zoneRestorePreview.id });
  await rejected('claude-restore', { planId: zoneRestorePreview.id });
  await rejected('claude-timezone-restore', { planId: zoneRestorePreview.id, extra: true });
  assert.deepEqual(await data('claude-timezone-inspect'), configuredTimeZone, 'Wrong restore commands and extra fields must not write');
  const freshZoneRestore = await data('claude-timezone-restore-plan', { backupId: zoneApplied.backupId });
  const zoneRestored = await data('claude-timezone-restore', { planId: freshZoneRestore.id });
  assert.equal(zoneRestored.success, true);
  assert.equal(zoneRestored.state, 'restored');
  assert.deepEqual(await data('claude-timezone-inspect'), initialTimeZone, 'Restore exactly recovers the initial fake time-zone summary');
  await rejected('claude-timezone-restore', { planId: freshZoneRestore.id });
  await rejected('claude-timezone-restore', { planId: zoneRestorePreview.id });
  await rejected('claude-timezone-restore-plan', { backupId: zoneApplied.backupId });
  const zoneBackupsAfterRestore = await data('claude-timezone-backups');
  assertTimeZoneBackups(zoneBackupsAfterRestore);
  assert.equal(zoneBackupsAfterRestore.find(item => item.id === zoneApplied.backupId)?.state, 'restored');
  assert.equal(zoneBackupsAfterRestore.find(item => item.id === zoneApplied.backupId)?.canRestore, false);
  assert.equal(zoneBackupsAfterRestore.find(item => item.id === zoneRestored.backupId)?.canRestore, true, 'Time-zone restore retains its own encrypted undo backup');
  assert.deepEqual(await data('claude-inspect'), claudeBeforeTimeZone);
  assert.deepEqual(await data('claude-backups'), claudeBackupsBeforeTimeZone);
  assert.deepEqual(stableHealth(await data('health')), initialHealth);
  assert.deepEqual(await data('backups'), initialClashBackups);
  console.log('PASS: offline Claude and optional time-zone demo inspect → preview → apply → no-op → restore, official mode, redaction, input validation, token isolation and unchanged unrelated state. No network tests.');
} finally {
  child.stdin.end();
  const shutdownTimer = setTimeout(() => child.kill(), 10000);
  await exited;
  clearTimeout(shutdownTimer);
  lines.close();
}
