import './build-native.mjs';import {fileURLToPath} from 'node:url';import path from 'node:path';import fs from 'node:fs';import {buildApp} from './app-bundle.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const candidates=[process.env.SONORA_ELECTRON&&path.resolve(process.env.SONORA_ELECTRON,'../../..'),path.resolve(root,'node_modules/electron/dist/Electron.app')].filter(Boolean);
const runtime=candidates.find(p=>fs.existsSync(path.join(p,'Contents/MacOS/Electron')));if(!runtime)throw Error('Runtime Electron existente não encontrado; nada foi instalado.');
console.log(JSON.stringify(buildApp(root,runtime)));
