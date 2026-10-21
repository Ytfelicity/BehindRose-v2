import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function verifyReactBitsSources() {
  const manifest = JSON.parse(readFileSync(path.join(root, 'frontend/reactbits-provenance.json'), 'utf8'));
  return manifest.components.map(component => ({ ...component, files: component.files.map(file => {
    const local = path.resolve(root, file.path);
    if (!local.startsWith(path.join(root, 'frontend/src/components/reactbits') + path.sep)) throw Error('Unexpected component path');
    const localSha256 = createHash('sha256').update(readFileSync(local)).digest('hex');
    if (localSha256 !== file.sha256) throw Error('React Bits source changed: ' + file.path);
    return { path: file.path, sourceSha256: file.sha256, localSha256, unchanged: true };
  }) }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const components = verifyReactBitsSources();
  console.log(`PASS: ${components.length} application components match recorded source hashes; no raw registry snapshot required.`);
}
