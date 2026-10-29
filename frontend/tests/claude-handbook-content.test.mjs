// Pure content checks: read repository fixtures/data and inspect TypeScript AST.
// No browser, host, subprocess, HTTP server, sockets or real user configuration.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataPath = path.join(root, 'frontend/src/claude-handbook-data.ts');
const text = readFileSync(dataPath, 'utf8');
const ast = ts.createSourceFile(dataPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.equal(ast.parseDiagnostics.length, 0, 'Guide data must parse as TypeScript');
const values = new Map();
for (const statement of ast.statements) {
  assert.ok(ts.isInterfaceDeclaration(statement) || ts.isVariableStatement(statement), 'Guide module must contain types and static constants only');
  if (!ts.isVariableStatement(statement)) continue;
  assert.ok(statement.declarationList.flags & ts.NodeFlags.Const, 'Guide data is constant');
  for (const declaration of statement.declarationList.declarations) {
    assert.ok(ts.isIdentifier(declaration.name));
    assert.ok(declaration.initializer);
    values.set(declaration.name.text, JSON.parse(declaration.initializer.getText(ast)));
  }
}
function rejectRuntime(node) {
  assert.equal(ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node) || ts.isImportDeclaration(node), false,
    'Content module cannot fetch, start a process, dynamically import or execute commands');
  ts.forEachChild(node, rejectRuntime);
}
rejectRuntime(ast);
const source = values.get('claudeHandbookSource');
const opening = values.get('claudeHandbookOpening');
const sections = values.get('claudeHandbookSections');
const optional = values.get('claudeHandbookOptionalItems');
const figures = values.get('claudeHandbookFigures');
assert.equal(source.manualPath, 'docs/claude-handbook/handbook.md');
assert.equal(source.articlePath, 'docs/claude-handbook/experience-summary.json');
const manual = readFileSync(path.join(root, source.manualPath), 'utf8').replace(/\r\n/g, '\n').trim();
const article = JSON.parse(readFileSync(path.join(root, source.articlePath), 'utf8'));
const sourceHeadings = [...manual.matchAll(/^# (\d{2}) · (.+)$/gm)];
const articleKeys = new Set(article.sections.map(section => section.key));
assert.equal(source.sections, 13);
assert.equal(source.date, '2026-10-24');
assert.equal(sourceHeadings.length, 13);
assert.equal(sections.length, 13);
assert.deepEqual(sections.map(section => section.id), Array.from({ length: 13 }, (_, index) => String(index + 1).padStart(2, '0')));
assert.equal(source.sourceOpeningMarkdown, manual.slice(0, sourceHeadings[0].index).trim());
assert.equal(opening.length, 5);
assert.ok(opening.some(rule => rule.includes('没有“照做就绝不封号”的配置')));
assert.ok(opening.some(rule => rule.includes('支持地区') && rule.includes('使用资格')));
assert.ok(opening.some(rule => rule.includes('自己的 Claude 订阅') && rule.includes('API 中转')));
assert.ok(opening.some(rule => rule.includes('已经能正常使用') && rule.includes('第 9 节') && rule.includes('不要先删配置')));
assert.ok(opening.some(rule => rule.includes('任何清理之前先备份') && rule.includes('.credentials.json')));
assert.match(source.executionPolicy, /只显示或复制.*不会自动执行/);

let commandCount = 0;
const referencedFigures = [];
for (const [index, section] of sections.entries()) {
  const heading = sourceHeadings[index];
  const exactSource = manual.slice(heading.index, sourceHeadings[index + 1]?.index ?? manual.length).trim();
  assert.equal(section.title, heading[2]);
  assert.equal(section.sourceMarkdown, exactSource, `Section ${section.id} must preserve its full article including tables, warnings, links and commands`);
  assert.ok(section.summary.length > 10);
  assert.ok(section.steps.length >= 3);
  assert.ok(section.checkpoints.length >= 1);
  assert.ok(['manual', 'local', 'network', 'optional'].includes(section.kind));
  for (const key of section.sourceArticleSections) assert.ok(articleKeys.has(key), `Unknown original article section ${key}`);
  const exactCommands = [...exactSource.matchAll(/^~~~([a-z]+)\n([\s\S]*?)\n~~~$/gm)];
  assert.equal(section.commands.length, exactCommands.length);
  for (const [commandIndex, command] of section.commands.entries()) {
    assert.equal(command.language, exactCommands[commandIndex][1]);
    assert.equal(command.code, exactCommands[commandIndex][2], 'Never silently rewrite a source command');
    assert.equal(command.execution, 'display-only');
    assert.equal(typeof command.network, 'boolean');
    if (/Test-NetConnection|curl\.exe|winget (?:install|upgrade)|irm https:|claude auth login|\.\\Test-ClaudeNetwork\.ps1|\.\\Launch-Claude\.ps1/.test(command.code)) {
      assert.equal(command.network, true, 'Network-related source commands must be identified before copying');
    }
    commandCount++;
  }
  for (const link of section.links) {
    assert.match(link.url, /^https:\/\//);
    assert.equal(typeof link.label, 'string');
  }
  referencedFigures.push(...section.figures);
}
assert.equal(commandCount, 21);
assert.equal(figures.length, 8);
assert.deepEqual([...new Set(referencedFigures)].sort(), figures.map(figure => figure.id).sort());
for (const figure of figures) {
  assert.deepEqual(Object.keys(figure).sort(), ['id', 'file', 'caption', 'note', 'source'].sort());
  assert.match(figure.file, /^\d{2}-[a-z-]+\.(?:png|jpg)$/);
  assert.match(figure.source, /^https:\/\//);
  assert.ok(figure.note.length > 0, 'Real figures retain original provenance/caveats');
}
assert.equal(JSON.stringify(values.get('claudeHandbookFigures')).includes('library-file:'), false, 'Private Page asset metadata must not enter the portable guide');
assert.deepEqual(optional.map(item => item.id), ['timezone', 'location', 'model-improvement', 'memory', 'browser-profile', 'fingerprint-browser', 'fixed-device', 'fixed-exit', 'ccbaga']);
for (const item of optional) {
  assert.equal(item.required, false, `${item.id} must remain optional`);
  assert.ok(['unverified', 'preference', 'convenience'].includes(item.evidence));
  assert.ok(item.evidenceNote.length > 20);
  assert.ok(item.steps.length > 0);
  for (const id of item.sourceSections) assert.ok(sections.some(section => section.id === id));
  for (const key of item.articleSections) assert.ok(articleKeys.has(key));
  assert.match(item.evidenceNote, /未证实|不保证|不等于|仍未/);
}
const byId = Object.fromEntries(sections.map(section => [section.id, section]));
assert.match(byId['03'].sourceMarkdown, /Settings → Privacy → Help Improve our AI models/);
assert.match(optional.find(item => item.id === 'memory').steps.join('\n'), /没有核实.*固定菜单路径/);
assert.match(byId['05'].sourceMarkdown, /Billing/);
assert.match(byId['05'].sourceMarkdown, /不要.*重复/);
assert.match(byId['07'].sourceMarkdown, /claude auth login/);
assert.match(byId['07'].sourceMarkdown, /settings/);
assert.match(byId['09'].sourceMarkdown, /恢复先前的进程变量/);
assert.match(byId['10'].sourceMarkdown, /CLAUDE_CONFIG_DIR/);
assert.match(byId['10'].sourceMarkdown, /\.claude\.json/);
assert.match(byId['10'].sourceMarkdown, /不要把“剪切”当成备份/);
assert.match(byId['10'].steps.join('\n'), /不能替代文章完整备份/);
assert.match(byId['11'].sourceMarkdown, /观察了 6 天/);
assert.match(byId['12'].sourceMarkdown, /claude\.ai\/restricted/);
assert.match(byId['12'].sourceMarkdown, /Request review/);
assert.match(byId['12'].sourceMarkdown, /429/);
assert.match(byId['12'].sourceMarkdown, /不要用 -k 或关闭证书验证/);
assert.equal(byId['13'].checkpoints.length, 10);
console.log('PASS: article-faithful 13-section static handbook, 21 exact display-only commands, 8 real figure citations, 9 optional experience records; no network or user configuration accessed.');
