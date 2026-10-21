import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function testRuntime(env = process.env, root = projectRoot) {
  const localSdk = path.resolve(root, '../tools/dotnet10/dotnet.exe');
  const dotnet = env.BEHINDROSE_TEST_DOTNET || (existsSync(localSdk) ? localSdk : 'dotnet');
  const configuration = env.BEHINDROSE_TEST_CONFIGURATION || 'Release';
  if (!['Debug', 'Release'].includes(configuration)) throw Error('BEHINDROSE_TEST_CONFIGURATION must be Debug or Release.');
  const hostDll = env.BEHINDROSE_TEST_HOST || path.join(root, 'src/BehindRose.DevHost/bin', configuration, 'net10.0-windows/BehindRose.DevHost.dll');
  return { dotnet, hostDll };
}
