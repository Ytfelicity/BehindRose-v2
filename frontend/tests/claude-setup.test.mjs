import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// No browser, listener or HTTP client is started. Every fetch goes to this
// fixture; a non-local URL or unexpected command fails the test immediately.
const output = await build({
  entryPoints: [fileURLToPath(new URL('../src/claude-setup.tsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  jsx: 'automatic', logLevel: 'silent',
});
let state = 'success';
const requests = [];
const allowed = new Set(['claude-inspect', 'claude-plan', 'claude-apply', 'claude-backups', 'claude-restore-plan', 'claude-restore']);
const fetchFixture = async (url, options = {}) => {
  assert.ok(['/api/session', '/api/local'].includes(url), 'Only the local application bridge is allowed');
  requests.push({ url, options });
  if (url === '/api/session') return {
    ok: state !== 'session-http-error',
    json: async () => ({ ready: state !== 'not-ready', token: 'fixture-session', error: state === 'not-ready' ? '服务未就绪' : undefined }),
  };
  const body = JSON.parse(options.body);
  assert.ok(allowed.has(body.command), 'No diagnostic or network-test commands are allowed');
  assert.equal(options.headers['X-BehindRose-Token'], 'fixture-session');
  return {
    ok: state !== 'conflict',
    json: async () => state === 'conflict' ? { error: '配置已被其他程序修改，请重新预览' } : { data: { echoed: body } },
  };
};
const module = { exports: {} };
vm.runInNewContext(output.outputFiles[0].text, { module, exports: module.exports, require: createRequire(import.meta.url), fetch: fetchFixture, AbortSignal, console }, { filename: 'claude-setup-fixture.cjs' });
const { validateClaudePort, claudeSetupApi, ClaudeSetup, claudePlanCanExecute, claudeBackupModeLabel, claudeBackupStateLabel, claudeDateLabel } = module.exports;

for (const [text, expected] of [['1', 1], ['7897', 7897], ['65535', 65535], [' 7897 ', 7897], ['0', null], ['65536', null], ['-1', null], ['7.5', null], ['1e3', null], ['', null], ['http://127.0.0.1:7897', null], ['7897abc', null]]) {
  assert.equal(validateClaudePort(text), expected, `Port validation: ${text}`);
}
assert.equal(claudePlanCanExecute({ action: 'restore', hasChanges: false }), true, 'An already-reverted backup still needs its recovery record completed');
assert.equal(claudePlanCanExecute({ action: 'restore', hasChanges: true }), true);
assert.equal(claudePlanCanExecute({ action: 'apply', hasChanges: false }), false, 'A no-op configuration does not write a backup');
assert.equal(claudeBackupModeLabel('restore'), '恢复前备份');
assert.equal(claudeBackupModeLabel('unknown'), '无法识别');
assert.equal(claudeBackupStateLabel('rollback-failed'), '自动回退未完成，需恢复');
assert.equal(claudeBackupStateLabel('prepared'), '备份已创建，等待确认恢复');
assert.equal(claudeBackupStateLabel('unreadable'), '记录无法读取');
assert.equal(claudeBackupStateLabel('applying'), '执行状态待核对');
assert.equal(claudeBackupStateLabel('completion-unknown'), '完成状态不明确（需人工核对）');
assert.equal(claudeDateLabel(null), '时间无法读取');
assert.equal(claudeDateLabel('bad-date'), '时间无法读取');
assert.equal(renderToStaticMarkup(React.createElement(ClaudeSetup, { active: false })), '');
const markup = renderToStaticMarkup(React.createElement(ClaudeSetup, { active: true }));
assert.match(markup, /只处理本机配置，不做网络测试/);
assert.match(markup.match(/<input[^>]*value="preserve"[^>]*>/)?.[0] ?? '', /checked=""/);
assert.doesNotMatch(markup.match(/<input[^>]*value="official"[^>]*>/)?.[0] ?? '', /checked=""/);
assert.match(markup, /预览一键配置/);
assert.match(markup, /不执行登录/);
assert.equal(requests.length, 0, 'Rendering does not issue network requests or apply settings');
const recoveryMarkup = renderToStaticMarkup(React.createElement(ClaudeSetup, { active: true, recoveryOnly: true }));
assert.match(recoveryMarkup, /仅恢复此前由工具箱保存的 settings.json/);
assert.doesNotMatch(recoveryMarkup, /预览一键配置|value="preserve"|选择 HTTP \/ Mixed 端口|当前配置/);
assert.equal(requests.length, 0, 'Rendering recovery does not perform a mutation');

const plan = await claudeSetupApi('claude-plan', { mode: 'preserve', proxyPort: 7897 });
assert.deepEqual(plan.echoed, { command: 'claude-plan', mode: 'preserve', proxyPort: 7897 });
assert.equal(requests.length, 2, 'A preview uses the local session and local API once each');
assert.equal(requests[1].options.method, 'POST');
assert.ok(requests[1].options.signal instanceof AbortSignal);
await claudeSetupApi('claude-restore-plan', { backupId: 'fixture-backup' });
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { command: 'claude-restore-plan', backupId: 'fixture-backup' });
await claudeSetupApi('claude-apply', { planId: 'fixture-plan' });
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { command: 'claude-apply', planId: 'fixture-plan' });
assert.ok(!requests.some(request => request.url.includes('claude.ai')), 'No Claude service is contacted');

const beforeUnsupported = requests.length;
await assert.rejects(() => claudeSetupApi('quality-start'), /不支持此配置操作/);
assert.equal(requests.length, beforeUnsupported, 'Unsupported commands fail before making a request');
state = 'not-ready';
const beforeNotReady = requests.length;
await assert.rejects(() => claudeSetupApi('claude-inspect'), /服务未就绪/);
assert.equal(requests.length, beforeNotReady + 1, 'Not-ready sessions never submit a local command');
state = 'session-http-error';
await assert.rejects(() => claudeSetupApi('claude-inspect'), /无法读取本机服务状态/);
state = 'conflict';
const beforeConflict = requests.length;
await assert.rejects(() => claudeSetupApi('claude-restore', { planId: 'fixture-restore' }), /配置已被其他程序修改/);
assert.equal(requests.length, beforeConflict + 2, 'A failed mutation is not automatically retried');
console.log('PASS: Claude port boundaries, inactive/default UI, exact local bridge commands, session errors, conflict reporting and no mutation retries. All requests mocked; no network tests or real settings access.');
