import { spawnSync } from 'node:child_process';
import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw Error('Cannot configure this project Git repository. Run git init in the project root first.');
  return result.stdout.trim();
}
try {
  if (path.resolve(git(['rev-parse', '--show-toplevel'])) !== root) throw Error('The Git repository root must be this project directory.');
  const existing = spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (existing.error || ![0, 1].includes(existing.status)) throw Error('Cannot inspect the existing Git hooks configuration.');
  if (existing.status === 0 && existing.stdout.trim() !== '.githooks') throw Error('A different hooksPath is configured; integrate the public-source check there before changing it.');
  await chmod(path.join(root, '.githooks/pre-commit'), 0o755);
  git(['config', '--local', 'core.hooksPath', '.githooks']);
  process.stdout.write('Installed local pre-commit check: Git index contents, private paths and credential patterns.\n');
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
