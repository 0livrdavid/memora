import compatibility from '../src/compatibility.cjs';
const {environmentValue}=compatibility;
import './build-native.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

if(!process.argv.includes('--smoke'))console.warn('Modo direto de desenvolvimento: o macOS pode atribuir AudioCapture ao terminal. Use npm start para abrir o pacote Memora com identidade e descrição de uso próprias. Nenhuma permissão é concedida automaticamente.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  environmentValue('MEMORA_ELECTRON'),
  join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
].filter(Boolean);
const binary = candidates.find(existsSync);
if (!binary) {
  console.error('Electron não encontrado. Defina MEMORA_ELECTRON com o caminho de um runtime existente. Nada foi instalado.');
  process.exit(1);
}
mkdirSync(join(root, '.local'), { recursive: true });
const env = { ...process.env, MEMORA_DATA: join(root, '.local'), MEMORA_SMOKE: process.argv.includes('--smoke') ? '1' : '' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(binary, [root], { env, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
