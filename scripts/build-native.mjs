import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, statSync } from 'node:fs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, 'native/Capture.swift'), plist = join(root, 'native/Info.plist'), output = join(root, '.local/memora-capture');
mkdirSync(join(root, '.local'), { recursive: true });
if (!existsSync(output) || Math.max(statSync(source).mtimeMs, statSync(plist).mtimeMs) > statSync(output).mtimeMs) {
  const result = spawnSync('xcrun', ['swiftc', source, '-o', output, '-framework', 'CoreAudio', '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', plist], { stdio: 'inherit', env: { ...process.env, CLANG_MODULE_CACHE_PATH: join(root, '.local/clang-cache') } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
