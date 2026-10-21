import { build, context } from 'esbuild';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { copyFile } from 'node:fs/promises';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, '../src/BehindRose.Desktop/Assets/workbench');
const watch = process.argv.includes('--watch');
const diagnostics = path.resolve(root, '../src/BehindRose.Desktop/Assets/diagnostics');
const mirror = async () => {
  await copyFile(path.join(output, 'network-ui.js'), path.join(diagnostics, 'network-ui.js'));
};
const options = {
  absWorkingDir: root, entryPoints: { beui: 'src/main.tsx', 'network-ui': 'src/network-ui.tsx' }, bundle: true,
  outdir: output, format: 'iife', target: 'es2022',
  minify: true, sourcemap: false,
  banner: { js: '/*! Includes beUI (MIT), React Bits (MIT + Commons Clause), and MyIP (MIT, Copyright (c) 2026 Jason Ng). See licenses/beui-LICENSE.txt, licenses/react-bits-LICENSE.md, and licenses/MyIP-LICENSE.txt. */' },
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
  plugins: [{ name: 'desktop-diagnostics-assets', setup(builder) { builder.onEnd(async result => { if (!result.errors.length) await mirror(); }); } }],
};
let ctx;
if (watch) { ctx = await context(options); await ctx.watch(); }
else await build(options);
const tailwind = spawn(process.execPath, [
  path.join(root, 'node_modules/@tailwindcss/cli/dist/index.mjs'),
  '-i', 'src/theme.css', '-o', path.join(diagnostics, 'beui.css'),
  ...(watch ? ['--watch=always'] : ['--minify']),
], { cwd: root, stdio: 'inherit', windowsHide: true });
tailwind.on('exit', async code => {
  if (code) process.exitCode = code;
  else await copyFile(path.join(diagnostics, 'beui.css'), path.join(output, 'beui.css'));
});
let closing = false;
async function stop() {
  if (closing) return; closing = true;
  tailwind.kill(); await ctx?.dispose(); process.exit(0);
}
if (watch) {
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  process.on('message', message => { if (message === 'stop') void stop(); });
  if (process.channel) process.once('disconnect', stop);
}
