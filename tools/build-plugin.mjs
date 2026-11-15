#!/usr/bin/env node
// build-plugin: 저장소의 번들(roles, templates, schema, bin, lib, functions, herdr-mod, VERSION, LICENSE, NOTICE)을
//   plugins/herdr-orchestration-manager/payload/ 에 복사해 마켓플레이스 플러그인 꾸러미를 맞춘다.
//   (마켓플레이스는 저장소 안의 파일만 설치하므로 payload 는 원본의 복사본이다. 원본이 정본, payload 는 이 도구가 만든다.)
// 사용:  node tools/build-plugin.mjs            payload 를 원본에 맞춘다(바뀐 파일만 복사, 원본에서 빠진 payload 파일은 하나씩 지움 - 폴더째 지우지 않음)
//        node tools/build-plugin.mjs --check    아무것도 바꾸지 않고, 어긋남이 있으면 목록을 보이고 종료코드 1
// 또 하는 일: VERSION 을 plugin.json 과 marketplace.json 의 version 에 맞춘다.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, existsSync, copyFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugins', 'herdr-orchestration-manager');
const PAYLOAD = join(PLUGIN, 'payload');
const ITEMS = ['roles', 'templates', 'schema', 'bin', 'lib', 'functions', 'herdr-mod'];
const SKIP_NAMES = new Set(['node_modules', '.git', '.omc', 'gpui-kit.d.ts', 'jsconfig.json']);   // 개발 중 생기는 보조 파일은 꾸러미에 넣지 않는다
const check = process.argv.includes('--check');

const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
function walk(dir, base, out) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir).sort()) {
    if (SKIP_NAMES.has(n)) continue;
    const p = join(dir, n); const st = lstatSync(p);
    if (st.isSymbolicLink()) throw new Error(`심볼릭 링크는 꾸러미에 넣을 수 없음: ${p}`);
    if (st.isDirectory()) walk(p, base, out); else out.set(relative(base, p).split(sep).join('/'), p);
  }
  return out;
}

export function plan() {
  const want = new Map();
  for (const it of ITEMS) walk(join(ROOT, it), ROOT, want);
  want.set('VERSION', join(ROOT, 'VERSION'));
  want.set('LICENSE', join(ROOT, 'LICENSE'));   // Apache-2.0 은 재배포 때 라이선스 사본과 NOTICE 를 함께 주도록 요구한다
  want.set('NOTICE', join(ROOT, 'NOTICE'));
  const have = walk(PAYLOAD, PAYLOAD, new Map());
  const add = [], change = [], remove = [];
  for (const [rel, src] of want) { const dst = have.get(rel); if (!dst) add.push(rel); else if (sha(src) !== sha(dst)) change.push(rel); }
  for (const rel of have.keys()) if (!want.has(rel)) remove.push(rel);
  return { want, have, add, change, remove };
}

function versionDrift() {
  const v = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
  const drift = [];
  const pj = join(PLUGIN, '.claude-plugin', 'plugin.json'); const mj = join(ROOT, '.claude-plugin', 'marketplace.json');
  const p = JSON.parse(readFileSync(pj, 'utf8')); const m = JSON.parse(readFileSync(mj, 'utf8'));
  if (p.version !== v) drift.push({ file: pj, set: (o) => { o.version = v; return o; }, obj: p, what: `plugin.json version ${p.version} -> ${v}` });
  const mp = (m.plugins || []).find((x) => x.name === p.name);
  if (!mp) throw new Error('marketplace.json 에 플러그인 항목이 없음');
  if (mp.version !== v) drift.push({ file: mj, set: (o) => { o.plugins.find((x) => x.name === p.name).version = v; return o; }, obj: m, what: `marketplace.json version ${mp.version} -> ${v}` });
  return { v, drift };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {   // 시험에서 plan() 을 불러 쓸 때는 실행하지 않음
  const pl = plan(); const vd = versionDrift();
  const total = pl.add.length + pl.change.length + pl.remove.length + vd.drift.length;
  if (check) {
    if (total === 0) { console.log(`payload 가 원본과 같습니다 (${pl.want.size}개 파일, 버전 ${vd.v})`); process.exit(0); }
    for (const r of pl.add) console.log(`  빠짐   ${r}`);
    for (const r of pl.change) console.log(`  다름   ${r}`);
    for (const r of pl.remove) console.log(`  남음   ${r} (원본에 없음)`);
    for (const d of vd.drift) console.log(`  버전   ${d.what}`);
    console.log(`어긋남 ${total}건 - node tools/build-plugin.mjs 로 맞추세요`);
    process.exit(1);
  }
  for (const r of [...pl.add, ...pl.change]) { const dst = join(PAYLOAD, ...r.split('/')); mkdirSync(dirname(dst), { recursive: true }); copyFileSync(pl.want.get(r), dst); }
  for (const r of pl.remove) unlinkSync(join(PAYLOAD, ...r.split('/')));
  // 비어 버린 폴더만 치운다(내용이 있으면 rmdir 이 실패하므로 안전)
  const dirs = [...new Set(pl.remove.map((r) => dirname(r)).filter((d) => d !== '.'))].sort((a, b) => b.length - a.length);
  for (const d of dirs) { try { rmdirSync(join(PAYLOAD, ...d.split('/'))); } catch { /* 비어 있지 않음 */ } }
  for (const d of vd.drift) writeFileSync(d.file, JSON.stringify(d.set(d.obj), null, 2) + '\n');
  console.log(`payload 갱신: 추가 ${pl.add.length}, 바뀜 ${pl.change.length}, 지움 ${pl.remove.length}, 버전 맞춤 ${vd.drift.length} (전체 ${pl.want.size}개 파일, 버전 ${vd.v})`);
}
