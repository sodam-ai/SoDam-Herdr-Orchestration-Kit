#!/usr/bin/env node
// install 이 부르는 작은 도구: 기본 설정(orchestration.json)을 처음 한 번만 만든다.
// 이미 있으면 아무것도 쓰지 않고 종료코드 3 (덮어쓰지 않는다 — 사용자 설정 보호).
// 사용: node bin/init-config.mjs --orch-home <폴더> --functions-dir <폴더>
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfig } from './sync-lib.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const orchHome = opt('--orch-home');
const functionsDir = opt('--functions-dir');
if (!orchHome || !functionsDir) { console.error('사용: node bin/init-config.mjs --orch-home <폴더> --functions-dir <폴더>'); process.exit(2); }

const file = join(orchHome, 'config', 'orchestration.json');
if (existsSync(file)) { console.error(`이미 있음(덮어쓰지 않음): ${file}`); process.exit(3); }
mkdirSync(join(orchHome, 'config'), { recursive: true });
writeFileSync(file, JSON.stringify(defaultConfig({ orchHome, functionsDir }), null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
console.log(`만듦: ${file}`);
