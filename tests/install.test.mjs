#!/usr/bin/env node
// 실행: node tests/install.test.mjs   (성공 시 종료코드 0, 외부 패키지 없음)
// 모든 시험은 %TEMP%\orch-e-<난수> 아래에서만 한다. 시험이 끝나도 그 폴더는 지우지 않는다(폴더 통째 삭제 금지).
// 가짜 LOCALAPPDATA 를 쓰므로 이 PC 의 실제 설정·설치 위치는 건드리지 않는다. hc 는 한 번도 실행하지 않는다.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, cpSync, unlinkSync, symlinkSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, loadRoles, readHeaderTemplate, renderBody } from '../bin/orch-lib.mjs';
import { defaultConfig, toVarsConfig } from '../bin/sync-lib.mjs';

// ---------- 작은 시험 틀 ----------
let pass = 0, fail = 0, skip = 0;
function check(name, fn) {
  try {
    const r = fn();
    if (r && r.skip) { skip++; console.log(`SKIP  ${name} — ${r.skip}`); return; }
    pass++; console.log(`PASS  ${name}${r && r.note ? ` (${r.note})` : ''}`);
  } catch (e) {
    fail++; console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, what) { if (a !== b) throw new Error(`${what}: 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); }

// ---------- 환경 ----------
const SYS = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
const PS = join(SYS, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const WHERE = join(SYS, 'System32', 'where.exe');
const NODE_DIR = dirname(process.execPath);
const BASE = join(tmpdir(), `orch-e-${randomBytes(4).toString('hex')}`);
mkdirSync(BASE, { recursive: true });
const dirOf = (name) => { const d = join(BASE, name); mkdirSync(d, { recursive: true }); return d; };
const read = (p) => readFileSync(p, 'utf8').replace(/^﻿/, '');
const readJson = (p) => JSON.parse(read(p));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// hc 가 없는 PATH: 시스템 폴더 + PowerShell + node 폴더만
const PATH_NO_HC = [join(SYS, 'System32'), SYS, join(SYS, 'System32', 'WindowsPowerShell', 'v1.0'), NODE_DIR].join(';');
function envFor({ path = PATH_NO_HC, localapp, orchHome } = {}) {
  const e = { ...process.env, PATH: path, Path: path };
  delete e.ORCH_HOME;
  delete e.ORCH_DOCS_DIR;
  e.LOCALAPPDATA = localapp ?? dirOf('localapp');
  if (orchHome) e.ORCH_HOME = orchHome;
  return e;
}
function runPs(script, args, env) {
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { env: env ?? envFor(), encoding: 'utf8', windowsHide: true });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\r\n/g, '\n') };
}
function runNode(args, env) {
  const r = spawnSync(process.execPath, args, { env: env ?? envFor(), encoding: 'utf8', windowsHide: true });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\r\n/g, '\n'), stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const parseChecks = (out) => Object.fromEntries([...out.matchAll(/^\[(OK|경고|중단)\] (\S+)\s+(.*)$/gm)].map((m) => [m[2], { status: m[1], msg: m[3] }]));

// 폴더 안 파일 전부: 상대경로(/) → 내용 해시. 폴더가 없으면 빈 Map
function tree(dir) {
  const m = new Map();
  if (!existsSync(dir)) return m;
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p); else m.set(relative(dir, p).split(sep).join('/'), sha(readFileSync(p)));
    }
  };
  walk(dir);
  return m;
}
const sameTree = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
const diffKeys = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort();

// 번들 복사본 (설치 도구의 원본 역할). install.ps1 은 자기 위치의 부모를 번들로 본다.
const BUNDLE_DIRS = ['roles', 'templates', 'schema', 'bin', 'lib', 'functions', 'herdr-mod'];
function makeBundle(name) {
  const b = dirOf(name);
  for (const d of BUNDLE_DIRS) cpSync(join(ROOT, d), join(b, d), { recursive: true });
  cpSync(join(ROOT, 'VERSION'), join(b, 'VERSION'));
  return b;
}
const bundleFiles = (b) => {
  const m = new Map();
  for (const d of BUNDLE_DIRS) for (const [k, v] of tree(join(b, d))) m.set(`${d}/${k}`, v);
  m.set('VERSION', sha(readFileSync(join(b, 'VERSION'))));
  return m;
};
const ps1 = (b, name) => join(b, 'bin', name);

// ================== 공통 준비 ==================
const B1 = makeBundle('bundle1');
const INST = join(BASE, 'inst');
const HOME = join(BASE, 'home');
const FAKE_LOCAL = dirOf('localapp');

// ① -Check 는 아무것도 바꾸지 않는다
check('(1) -Check 는 아무것도 바꾸지 않음 (전후 폴더 해시 동일, 설치 폴더 만들지 않음)', () => {
  const before = tree(BASE);
  const r = runPs(ps1(B1, 'install.ps1'), ['-Check', '-InstallDir', INST, '-OrchHome', HOME]);
  eq(r.status, 0, `종료코드\n${r.out}`);
  ok(sameTree(before, tree(BASE)), '-Check 전후로 폴더 내용이 달라짐');
  ok(!existsSync(INST) && !existsSync(HOME), '-Check 가 설치/설정 폴더를 만듦');
  const c = parseChecks(r.out);
  for (const id of ['bundle', 'powershell', 'node', 'hc', 'herdr-app', 'session-keeper', 'install-dir', 'config', 'allow-list', 'statusline']) ok(c[id], `점검 항목 '${id}' 가 출력에 없음\n${r.out}`);
  eq(c.statusline.status, '경고', '상태줄은 정적 점검 불가라 경고');
  eq(c['allow-list'].status, '경고', '허용 목록이 비어 있으면 경고');
  ok(/자동 압축|승인 대행/.test(c['allow-list'].msg), '허용 목록 경고가 자동 압축·승인 대행을 안 켠다고 안내해야 함');
  ok(/컨텍스트/.test(c.statusline.msg), '상태줄 안내에 컨텍스트 언급 필요');
  return { note: `점검 항목 ${Object.keys(c).length}개` };
});

// ② PATH 에 hc 가 없으면 hc 항목을 경고/중단으로 보고
check('(2) PATH 에 hc 가 없으면 hc 항목이 경고/중단, 있으면 OK', () => {
  const w = spawnSync(WHERE, ['hc'], { env: envFor(), encoding: 'utf8' });
  ok(w.status !== 0, '시험 환경 PATH 에 hc 가 있음(시험 전제 위반)');
  const r = runPs(ps1(B1, 'install.ps1'), ['-Check', '-InstallDir', INST, '-OrchHome', HOME]);
  const c = parseChecks(r.out);
  ok(c.hc && (c.hc.status === '경고' || c.hc.status === '중단'), `hc 항목이 경고/중단이어야 함: ${JSON.stringify(c.hc)}`);
  // 대조군: 가짜 hc.cmd 를 PATH 에 두면 OK (찾기만 하고 실행하지 않는다)
  const fb = dirOf('fakebin');
  writeFileSync(join(fb, 'hc.cmd'), '@echo off\r\n');
  const r2 = runPs(ps1(B1, 'install.ps1'), ['-Check', '-InstallDir', INST, '-OrchHome', HOME], envFor({ path: `${fb};${PATH_NO_HC}` }));
  eq(parseChecks(r2.out).hc?.status, 'OK', `hc 가 PATH 에 있을 때\n${r2.out}`);
  return { note: `없음 → ${c.hc.status}, 있음 → OK` };
});

// 중단 조건: 비어 있지 않은 설치 폴더(설치 기록 없음)
check('(2b) 설치 폴더가 비어 있지 않고 기록이 없으면 중단하고 아무것도 설치하지 않음', () => {
  const foreign = dirOf('foreign-inst');
  writeFileSync(join(foreign, 'user-file.txt'), 'mine');
  const homeX = join(BASE, 'home-foreign');
  const before = tree(BASE);
  const r = runPs(ps1(B1, 'install.ps1'), ['-InstallDir', foreign, '-OrchHome', homeX]);
  eq(r.status, 1, `종료코드\n${r.out}`);
  eq(parseChecks(r.out)['install-dir']?.status, '중단', '중단 표시');
  ok(sameTree(before, tree(BASE)), '중단했는데 파일이 바뀜');
  ok(!existsSync(homeX), '중단했는데 설정 폴더를 만듦');
});

// ③ 설치
let manifest;
check('(3) 설치: 기록된 파일이 모두 존재·해시 일치, 번들 전체 포함, 위험 기능은 전부 꺼짐', () => {
  const r = runPs(ps1(B1, 'install.ps1'), ['-InstallDir', INST, '-OrchHome', HOME]);
  eq(r.status, 0, `종료코드\n${r.out}`);
  manifest = readJson(join(HOME, 'install-manifest.json'));
  eq(manifest.version, read(join(B1, 'VERSION')).trim(), '기록의 버전');
  ok(manifest.installedAt, '설치 시각');
  const want = bundleFiles(B1);
  eq(manifest.files.length, want.size, '기록된 파일 수 = 번들 파일 수');
  for (const f of manifest.files) {
    const p = join(INST, ...f.path.split('/'));
    ok(existsSync(p), `기록에 있는데 파일이 없음: ${f.path}`);
    eq(sha(readFileSync(p)), f.sha256, `해시 ${f.path}`);
    eq(want.get(f.path), f.sha256, `번들 원본과 해시 ${f.path}`);
  }
  for (const rel of ['config/orchestration.json', 'config/ignore.txt']) ok(manifest.dataFiles.some((d) => d.path === rel), `데이터 파일 기록에 ${rel} 없음`);
  eq(statSync(join(HOME, 'config', 'ignore.txt')).size, 0, 'ignore.txt 는 빈 파일');
  for (const d of ['state', 'logs']) ok(statSync(join(HOME, d)).isDirectory(), `${d} 폴더`);
  const cfg = readJson(join(HOME, 'config', 'orchestration.json'));
  for (const k of ['scope_prefix', 'projects_root', 'control_dir', 'commander_name', 'layout', 'functions']) ok(k in cfg, `설정에 ${k} 없음`);
  eq(cfg.commander_name, 'orch-commander', 'commander_name');
  // 위험(high) 기능과 high 부분은 전부 false
  let highs = 0;
  for (const d of readdirSync(join(B1, 'functions'))) {
    const fn = readJson(join(B1, 'functions', d, 'function.json'));
    if (fn.risk === 'high') { highs++; eq(cfg.functions[fn.id], false, `functions.${fn.id}`); }
    for (const p of fn.parts ?? []) if (p.risk === 'high') { highs++; eq(cfg.functions[`${fn.id}.${p.id}`], false, `functions.${fn.id}.${p.id}`); }
  }
  ok(highs >= 3, `위험 기능을 ${highs}개만 확인함(approve, autopress, auto-compact 3개 이상이어야 함)`);
  ok(Object.values(cfg.functions).some((v) => v === true), '꺼지지 않는 읽기 전용 기능도 등록되어야 함');
  eq(readdirSync(FAKE_LOCAL).length, 0, '지정한 위치 밖(가짜 LOCALAPPDATA)에 무엇인가 만들어짐');
  return { note: `파일 ${manifest.files.length}개 일치, 위험 기능 ${highs}개 모두 false` };
});

// 기본 위치(인자 없이): <LOCALAPPDATA>\Herdr-Orchestration, ORCH_HOME 환경변수 존중
check('(3b) 인자 없이 설치하면 LOCALAPPDATA 아래 기본 위치, ORCH_HOME 이 있으면 그 위치', () => {
  const la = dirOf('localapp-default');
  const r = runPs(ps1(B1, 'install.ps1'), [], envFor({ localapp: la }));
  eq(r.status, 0, `종료코드\n${r.out}`);
  const homeD = join(la, 'Herdr-Orchestration');
  ok(existsSync(join(homeD, 'config', 'orchestration.json')) && existsSync(join(homeD, 'app', 'bin', 'sync.mjs')) && existsSync(join(homeD, 'install-manifest.json')), '기본 위치에 설치되지 않음');
  const eh = join(BASE, 'env-home');
  const r2 = runPs(ps1(B1, 'install.ps1'), [], envFor({ localapp: la, orchHome: eh }));
  eq(r2.status, 0, `종료코드\n${r2.out}`);
  ok(existsSync(join(eh, 'config', 'orchestration.json')) && existsSync(join(eh, 'app', 'bin', 'sync.mjs')), 'ORCH_HOME 위치에 설치되지 않음');
  const u = runPs(join(eh, 'app', 'bin', 'uninstall.ps1'), [], envFor({ localapp: la, orchHome: eh }));
  eq(u.status, 0, `제거 종료코드\n${u.out}`);
  ok(!existsSync(join(eh, 'app', 'bin', 'sync.mjs')), 'ORCH_HOME 제거 후에도 파일이 남음');
});

// ④ 재설치는 사용자 설정을 보존
check('(4) 재설치가 사용자 config·state 를 보존 (수정한 설정 그대로)', () => {
  const cfgPath = join(HOME, 'config', 'orchestration.json');
  const cfg = readJson(cfgPath);
  cfg.scope_prefix = 'Test-Scope /';
  cfg.projects_root = 'X-projects';
  cfg.my_custom_note = '지우면 안 됨';
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  writeFileSync(join(HOME, 'config', 'ignore.txt'), 'ignored-window\n');
  writeFileSync(join(HOME, 'state', 'round.txt'), '7');
  const before = tree(HOME);
  const r = runPs(ps1(B1, 'install.ps1'), ['-InstallDir', INST, '-OrchHome', HOME]);
  eq(r.status, 0, `종료코드\n${r.out}`);
  const after = tree(HOME);
  for (const k of ['config/orchestration.json', 'config/ignore.txt', 'state/round.txt']) eq(after.get(k), before.get(k), `${k} 가 바뀜`);
  const c2 = readJson(cfgPath);
  eq(c2.my_custom_note, '지우면 안 됨', '사용자가 넣은 항목');
  eq(c2.scope_prefix, 'Test-Scope /', 'scope_prefix');
  const m2 = readJson(join(HOME, 'install-manifest.json'));
  ok(m2.dataFiles.some((d) => d.path === 'config/orchestration.json'), '데이터 파일 기록이 사라짐');
  const rc = runPs(ps1(B1, 'install.ps1'), ['-Check', '-InstallDir', INST, '-OrchHome', HOME]);
  const c = parseChecks(rc.out);
  eq(c['allow-list'].status, 'OK', 'scope_prefix 가 설정되면 허용 목록 점검 OK');
  ok(/덮어쓰지 않/.test(c.config.msg), '기존 설정은 덮어쓰지 않는다고 안내');
});

// ⑤ 번들 업데이트
check('(5) 번들 업데이트: 번들은 교체·추가·제거, config·state·사용자 파일은 그대로', () => {
  const verifier = join(B1, 'roles', 'verifier.md');
  writeFileSync(verifier, read(verifier).replace(/\s+$/, '') + ' 업데이트 시험용 문장.\n');
  writeFileSync(join(B1, 'templates', 'added-in-update.txt'), 'new');
  const removedRel = 'lib/orch-paths.ps1';
  writeFileSync(join(B1, 'VERSION'), '0.1.1\n');
  // 번들에서 파일 하나 빼기(파일 하나만 지움)
  const rmFile = join(B1, ...removedRel.split('/'));
  ok(existsSync(rmFile), '시험 전제: 빼려는 번들 파일이 있어야 함');
  writeFileSync(join(INST, 'roles', 'my-own-role.md'), 'user file');       // 사용자가 넣은 파일(기록 밖)
  unlinkSync(rmFile);
  const dataBefore = tree(HOME); for (const k of [...dataBefore.keys()]) if (k === 'install-manifest.json') dataBefore.delete(k);
  const r = runPs(ps1(B1, 'install.ps1'), ['-InstallDir', INST, '-OrchHome', HOME]);
  eq(r.status, 0, `종료코드\n${r.out}`);
  eq(read(join(INST, 'roles', 'verifier.md')), read(verifier), '바뀐 번들 파일이 교체되지 않음');
  ok(existsSync(join(INST, 'templates', 'added-in-update.txt')), '새 번들 파일이 추가되지 않음');
  ok(!existsSync(join(INST, ...removedRel.split('/'))), '번들에서 빠진 옛 파일이 남음');
  ok(existsSync(join(INST, 'roles', 'my-own-role.md')), '사용자가 넣은 파일이 지워짐');
  const dataAfter = tree(HOME); dataAfter.delete('install-manifest.json');
  ok(sameTree(dataBefore, dataAfter), `config/state 가 바뀜: ${diffKeys(dataBefore, dataAfter).join(', ')}`);
  const m = readJson(join(HOME, 'install-manifest.json'));
  eq(m.version, '0.1.1', '기록의 버전');
  ok(!m.files.some((f) => f.path === removedRel) && m.files.some((f) => f.path === 'templates/added-in-update.txt'), '기록이 새 번들과 같아야 함');
  for (const f of m.files) eq(sha(readFileSync(join(INST, ...f.path.split('/')))), f.sha256, `해시 ${f.path}`);
});

// ⑥ 제거
check('(6) uninstall: 기록된 파일만 지움, 데이터 보존, -RemoveData 도 사용자가 만든 파일은 남김', () => {
  const unin = join(INST, 'bin', 'uninstall.ps1');
  const m = readJson(join(HOME, 'install-manifest.json'));
  // 6-1 점검 모드는 아무것도 지우지 않는다
  const before = tree(BASE);
  const rc = runPs(unin, ['-Check', '-OrchHome', HOME]);
  eq(rc.status, 0, `-Check 종료코드\n${rc.out}`);
  ok(sameTree(before, tree(BASE)), 'uninstall -Check 가 파일을 바꿈');
  // 6-2 기본 제거
  const r = runPs(unin, ['-OrchHome', HOME]);
  eq(r.status, 0, `종료코드\n${r.out}`);
  for (const f of m.files) ok(!existsSync(join(INST, ...f.path.split('/'))), `기록된 파일이 남음: ${f.path}`);
  ok(existsSync(join(INST, 'roles', 'my-own-role.md')), '사용자 파일이 지워짐');
  for (const rel of ['config/orchestration.json', 'config/ignore.txt', 'state/round.txt']) ok(existsSync(join(HOME, ...rel.split('/'))), `데이터가 지워짐: ${rel}`);
  ok(/my-own-role\.md/.test(r.out), '남은 사용자 파일 목록을 알려야 함');
  // 6-3 -RemoveData (설치 폴더는 이미 비었으므로 번들 쪽 사본으로 실행)
  writeFileSync(join(HOME, 'config', 'my-notes.txt'), 'user');
  writeFileSync(join(HOME, 'state', 'program-wrote.log'), 'log');
  const rd = runPs(ps1(B1, 'uninstall.ps1'), ['-RemoveData', '-OrchHome', HOME]);
  eq(rd.status, 0, `종료코드\n${rd.out}`);
  for (const rel of ['config/orchestration.json', 'config/ignore.txt', 'install-manifest.json']) ok(!existsSync(join(HOME, ...rel.split('/'))), `-RemoveData 후 남음: ${rel}`);
  for (const rel of ['config/my-notes.txt', 'state/program-wrote.log']) ok(existsSync(join(HOME, ...rel.split('/'))), `사용자가 만든 파일이 지워짐: ${rel}`);
  ok(/my-notes\.txt/.test(rd.out) && /program-wrote\.log/.test(rd.out), '남은 파일 목록을 알려야 함');
  // 6-4 손상된 기록의 상위 폴더 경로(..)는 무시
  const i4 = join(BASE, 'inst4'), h4 = join(BASE, 'home4');
  eq(runPs(ps1(B1, 'install.ps1'), ['-InstallDir', i4, '-OrchHome', h4]).status, 0, '시험용 설치');
  const victim = join(BASE, 'outside-victim.txt'); writeFileSync(victim, 'keep me');
  const mp = join(h4, 'install-manifest.json');
  const mm = readJson(mp); mm.files.push({ path: '../outside-victim.txt', sha256: 'x' }); writeFileSync(mp, JSON.stringify(mm));
  const ru = runPs(join(i4, 'bin', 'uninstall.ps1'), ['-OrchHome', h4]);
  eq(ru.status, 0, `종료코드\n${ru.out}`);
  ok(existsSync(victim), '기록에 적힌 ../ 경로의 바깥 파일이 지워짐');
  ok(/건너뜀/.test(ru.out), '기준 폴더 밖 경로를 건너뛴다고 알려야 함');
});

// ⑦ sync (설치된 사본으로, 설치 → sync 한 번)
const CARD_VAR_LEFT = /\{[A-Za-z_][A-Za-z0-9_]*\}/;
check('(7) sync: 12개 역할 → 역할표 + worker 카드 10장 + 탭 계획, 변수 모두 치환, 이름·라벨 형식 일치', () => {
  const i7 = join(BASE, 'inst7'), h7 = join(BASE, 'home7');
  eq(runPs(ps1(B1, 'install.ps1'), ['-InstallDir', i7, '-OrchHome', h7]).status, 0, '시험용 설치');
  const env7 = envFor({ orchHome: h7 });          // hc 없는 PATH: sync 가 hc 를 부르려 하면 실패한다
  const outDir = join(h7, 'state', 'generated');
  // 7-1 기본 설정 그대로: 성공하되 미설정 경고
  const s0 = runNode([join(i7, 'bin', 'sync.mjs')], env7);
  eq(s0.status, 0, `종료코드\n${s0.out}`);
  ok(/\(미설정\)/.test(s0.stderr) && /경고/.test(s0.stderr), `미설정 경고가 없음\n${s0.out}`);
  // 7-2 설정을 채우고 다시
  const cfgPath = join(h7, 'config', 'orchestration.json');
  const cfg = readJson(cfgPath); cfg.scope_prefix = 'Demo-Space /'; cfg.projects_root = 'D-projects-root'; cfg.control_dir = 'ctl-dir';
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const s1 = runNode([join(i7, 'bin', 'sync.mjs')], env7);
  eq(s1.status, 0, `종료코드\n${s1.out}`);
  ok(!/\(미설정\)/.test(s1.stderr), '설정을 채웠는데도 미설정 경고');
  // 역할표
  const table = read(join(outDir, '역할표.md'));
  ok(table.split('\n').find((l) => l.trim() !== '').includes('자동 생성 — 수정 금지'), '역할표 맨 위에 "자동 생성 — 수정 금지"');
  const rolesAll = loadRoles(join(i7, 'roles'));
  eq(rolesAll.length, 12, '역할 파일 수');
  const [onSec, afterOn] = table.split('## 꺼진 역할');
  for (const r of rolesAll.filter((x) => x.meta.enabled)) ok(onSec.includes(`| ${r.meta.id} |`), `켜진 역할표에 ${r.meta.id} 없음`);
  ok(afterOn.includes('approval-proxy') && !onSec.includes('approval-proxy'), '꺼진 역할(approval-proxy)이 "꺼진 역할"에만 있어야 함');
  const replaceRows = (table.split('## 옛 이름')[1].match(/^\| ct-cc-\d+ \|/gm) ?? []).length;
  eq(replaceRows, rolesAll.reduce((n, r) => n + r.meta.replaces.length, 0), 'replaces 대응표 줄 수');
  ok(/\| ct-cc-14 \| doc-consistency \|/.test(table), '대응표: ct-cc-14 → doc-consistency');
  // 카드
  const cards = readdirSync(join(outDir, 'cards')).sort();
  const workers = rolesAll.filter((r) => r.meta.kind === 'worker' && r.meta.enabled);
  eq(workers.length, 10, '켜진 worker 수');
  eq(cards.join(','), [...workers.map((r) => `${r.meta.id}.md`), 'commander.md'].sort().join(','), '카드 파일 목록(worker 10장 + commander, 꺼진 approval-proxy 는 없음)');
  for (const f of cards) {
    const t = read(join(outDir, 'cards', f));
    ok(!CARD_VAR_LEFT.test(t), `${f}: 치환되지 않은 {변수}가 남음: ${(t.match(CARD_VAR_LEFT) ?? [])[0]}`);
  }
  const vcard = read(join(outDir, 'cards', 'verifier.md'));
  ok(vcard.includes('Demo-Space /') && vcard.includes('D-projects-root') && vcard.includes('orch-commander'), '설정 값(scope_prefix, projects_root, 총지휘 이름)이 카드에 들어가야 함');
  ok(vcard.startsWith('[오케스트레이션 역할 부여'), 'worker 카드는 머리말 틀로 시작');
  ok(!read(join(outDir, 'cards', 'commander.md')).startsWith('[오케스트레이션 역할 부여'), 'commander 카드는 머리말 틀 없이 본문만');
  // render-card.mjs 와 같은 글자인가 (같은 함수를 쓴다는 증거)
  const rc = join(BASE, 'rc-config.json');
  writeFileSync(rc, JSON.stringify({ commander: 'orch-commander', control_dir: 'ctl-dir', projects_root: 'D-projects-root', scope_prefix: 'Demo-Space /' }));
  const rr = runNode([join(ROOT, 'bin', 'render-card.mjs'), 'verifier', '--config', rc, '--roles-dir', join(i7, 'roles'), '--templates-dir', join(i7, 'templates')]);
  eq(rr.status, 0, `render-card 종료코드\n${rr.out}`);
  eq(vcard, rr.stdout, 'sync 카드가 render-card 출력과 다름');
  // 탭 계획
  const plan = readJson(join(outDir, 'layout-plan.json'));
  eq(plan.tabs.map((t) => t.name).join(' | '), 'CT-CC-Master | CT-CC-1,2,3,4 | CT-CC-5,6,7,8 | CT-CC-9,10', '탭 이름(설계서 5-5)');
  const names = new Set();
  let n = 0;
  for (const t of plan.tabs) for (const e of t.roles) {
    n++;
    ok(/^[a-z0-9_-]{1,32}$/.test(e.hc_name), `창 이름 형식: ${e.hc_name}`);
    eq(e.hc_name, `orch-${e.id}`, '창 이름 = orch-<id>');
    ok(!names.has(e.hc_name), `창 이름 중복 ${e.hc_name}`); names.add(e.hc_name);
    eq(JSON.stringify(Object.keys(e.labels)), JSON.stringify(['orch.role', 'orch.slot', 'orch.v']), '라벨 키');
    eq(e.labels['orch.role'], e.id, 'orch.role'); eq(e.labels['orch.slot'], String(e.slot), 'orch.slot'); eq(e.labels['orch.v'], '1', 'orch.v');
  }
  eq(n, 11, '탭 계획에 놓인 역할 수(켜진 것만)');
  eq(plan.disabled.map((d) => d.id).join(','), 'approval-proxy', '꺼진 역할');
  eq(plan.tabs[0].roles.map((e) => e.id).join(','), 'commander', '총지휘 탭');
  // 두 번째 실행은 바뀐 것이 없어야 함
  const s2 = runNode([join(i7, 'bin', 'sync.mjs')], env7);
  ok(/바뀐 파일 0/.test(s2.stdout), `같은 입력인데 다시 씀\n${s2.stdout}`);
  // 잘못된 설정은 코드 2
  const bad = join(BASE, 'bad-config.json'); const bc = { ...cfg }; delete bc.scope_prefix; writeFileSync(bad, JSON.stringify(bc));
  eq(runNode([join(i7, 'bin', 'sync.mjs'), '--config', bad, '--out', join(BASE, 'out-bad')], env7).status, 2, '설정 오류 종료코드');
  // sync 는 hc 를 호출하지 않는다 (소스 점검)
  for (const f of ['sync.mjs', 'sync-lib.mjs', 'init-config.mjs']) ok(!/spawn\w*\(\s*['"`]hc|HC_BIN|hc\.exe/.test(read(join(ROOT, 'bin', f))), `${f} 가 hc 를 부르려 함`);
  return { note: `카드 ${cards.length}장, 탭 ${plan.tabs.length}개, 창 ${n}개` };
});

// ⑧ 설계서 8장 변경 시나리오 (임시 사본의 roles/ 에서)
const SCEN_CFG = (() => {
  const p = join(BASE, 'scenario-config.json');
  const c = defaultConfig({ orchHome: join(BASE, 'scen-home'), functionsDir: join(ROOT, 'functions') });
  c.scope_prefix = 'Scen-Space /'; c.projects_root = 'scen-projects'; c.control_dir = 'scen-control';
  writeFileSync(p, JSON.stringify(c, null, 2));
  return p;
})();
let scenN = 0;
function scenario() {
  scenN++;
  const roles = join(BASE, `scen${scenN}`, 'roles'); mkdirSync(dirname(roles), { recursive: true });
  cpSync(join(ROOT, 'roles'), roles, { recursive: true });
  const out = join(BASE, `scen${scenN}`, 'out');
  // 내 역할 폴더(--user-roles-dir): 처음 쓰는 순간 만들고, 그 뒤 sync 에 넘긴다
  const user = join(BASE, `scen${scenN}`, 'userroles');
  let useUser = false;
  const userDir = () => { mkdirSync(user, { recursive: true }); useUser = true; return user; };
  const userFile = (name, text) => writeFileSync(join(userDir(), name), text);
  const cfgFile = (c) => { const f = join(BASE, `scen${scenN}`, 'config.json'); writeFileSync(f, JSON.stringify(c, null, 2)); return f; };
  let cfgPath = SCEN_CFG;
  const useConfig = (c) => { cfgPath = cfgFile(c); };
  // 환경 규칙 파일(--env-rules): 처음 쓰는 순간부터 sync 에 넘긴다. path 를 직접 주면 그 경로(없는 파일 시험용)
  let envRulesPath = null;
  const useEnvRules = (text, path) => { envRulesPath = path ?? join(BASE, `scen${scenN}`, 'env-rules.md'); if (text !== undefined) writeFileSync(envRulesPath, text); return envRulesPath; };
  const sync = () => runNode([join(ROOT, 'bin', 'sync.mjs'), '--roles-dir', roles, ...(useUser ? ['--user-roles-dir', user] : []), '--config', cfgPath, '--out', out, ...(envRulesPath ? ['--env-rules', envRulesPath] : [])]);
  const snap = () => { const t = tree(out); t.delete('sync-manifest.json'); return t; };
  const text = (rel) => read(join(out, ...rel.split('/')));
  const edit = (id, fn) => { const p = join(roles, `${id}.md`); writeFileSync(p, fn(read(p))); };
  const roleFile = (id, fields) => {
    const base = { id, name: `"${id} 역할"`, slot: 11, kind: 'worker', mode: 'read-only', writes_to: '[]', reports_to: 'commander', cadence: 'on-request', enabled: 'true', replaces: '[]', needs: '[]', version: 1, ...fields.meta };
    writeFileSync(join(roles, `${id}.md`), `---\n${Object.entries(base).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${fields.body ?? `${id} 본문입니다. {commander}에게 보고한다.`}\n`);
  };
  const a = sync();
  if (a.status !== 0) throw new Error(`시나리오 기준 sync 실패\n${a.out}`);
  return { roles, out, sync, snap, text, edit, roleFile, user, userDir, userFile, useConfig, useEnvRules, base: snap() };
}

check('(8a) 시나리오 역할 추가: 파일 1개 → sync 에 나타남, slot 충돌은 sync 실패(출력 그대로)', () => {
  const s = scenario();
  s.roleFile('new-role', {});
  const r = s.sync();
  eq(r.status, 0, `종료코드\n${r.out}`);
  const now = s.snap();
  ok(now.has('cards/new-role.md'), '새 카드가 없음');
  ok(s.text('cards/new-role.md').includes('new-role 본문입니다. orch-commander에게 보고한다.'), '새 카드 본문 변수 치환');
  ok(s.text('역할표.md').includes('| new-role |'), '역할표에 새 역할');
  const plan = JSON.parse(s.text('layout-plan.json'));
  ok(plan.tabs.some((t) => t.name === 'CT-CC-11,12,13,14' && t.roles.some((e) => e.hc_name === 'orch-new-role')), '탭 계획에 새 역할(자리 11 → CT-CC-11,12,13,14 탭)');
  // slot 충돌
  const keep = s.snap();
  s.roleFile('collide', { meta: { slot: 11 } });
  const c = s.sync();
  eq(c.status, 1, `slot 충돌인데 종료코드\n${c.out}`);
  ok(/slot/.test(c.stderr) && /collide/.test(c.stderr), `slot 충돌 이유가 안 보임\n${c.stderr}`);
  ok(sameTree(keep, s.snap()), '실패한 sync 가 출력을 건드림');
});

check('(8b) 시나리오 역할 수정: 본문 한 줄 → 해당 카드만 바뀜(다른 카드·역할표·탭 계획은 바이트 동일)', () => {
  const s = scenario();
  s.edit('verifier', (t) => t.replace(/\s+$/, '') + ' 추가한 문장 하나.\n');
  const r = s.sync();
  eq(r.status, 0, `종료코드\n${r.out}`);
  eq(diffKeys(s.base, s.snap()).join(','), 'cards/verifier.md', '바뀐 생성물');
  ok(s.text('cards/verifier.md').endsWith('추가한 문장 하나.\n'), '바뀐 카드에 새 문장');
});

check('(8c) 시나리오 역할 제거: enabled:false → 카드·탭 계획에서 빠지고 "꺼진 역할"에 표시(파일은 남음)', () => {
  const s = scenario();
  s.edit('git-keeper', (t) => t.replace(/^enabled: true$/m, 'enabled: false'));
  const r = s.sync();
  eq(r.status, 0, `종료코드\n${r.out}`);
  ok(!existsSync(join(s.out, 'cards', 'git-keeper.md')), '꺼진 역할의 카드가 남음');
  const table = s.text('역할표.md');
  const [onSec, offSec] = table.split('## 꺼진 역할');
  ok(!onSec.includes('| git-keeper |') && offSec.includes('| git-keeper |'), '꺼진 역할 표시');
  const plan = JSON.parse(s.text('layout-plan.json'));
  ok(!plan.tabs.some((t) => t.roles.some((e) => e.id === 'git-keeper')), '탭 계획에 남음');
  ok(plan.disabled.some((d) => d.id === 'git-keeper'), '꺼진 목록에 없음');
  ok(existsSync(join(s.roles, 'git-keeper.md')), '역할 파일은 지우지 않음');
  ok(!s.text('cards/verifier.md').includes('8 깃'), '다른 카드의 역할 이름 목록에서도 빠짐');
});

check('(8d) 시나리오 역할 합침: 새 파일의 replaces → 대응표에 반영, 이미 주장된 옛 이름은 실패', () => {
  const s = scenario();
  s.roleFile('quality-gate', { meta: { replaces: '[old-x, old-y]' } });
  const r = s.sync();
  eq(r.status, 0, `종료코드\n${r.out}`);
  const t = s.text('역할표.md');
  ok(/\| old-x \| quality-gate \| 켜짐 \|/.test(t) && /\| old-y \| quality-gate \| 켜짐 \|/.test(t), '대응표에 old-x, old-y → quality-gate');
  ok(/\| ct-cc-14 \| doc-consistency \|/.test(t), '기존 대응은 그대로');
  const keep = s.snap();
  s.roleFile('greedy', { meta: { slot: 12, replaces: '[ct-cc-3]' } });
  const c = s.sync();
  eq(c.status, 1, `옛 이름 중복 주장인데 종료코드\n${c.out}`);
  ok(/ct-cc-3/.test(c.stderr), '이유에 ct-cc-3');
  ok(sameTree(keep, s.snap()), '실패한 sync 가 출력을 건드림');
});

check('(8e) 시나리오 번호 재매김: slot 만 변경(두 역할 맞바꿈) → 역할 본문 그대로, 탭 계획의 slot·라벨만 변경', () => {
  const s = scenario();
  const bodyOf = (id) => loadRoles(s.roles).find((r) => r.meta.id === id).body;
  const bodies = { verifier: bodyOf('verifier'), 'human-tasks': bodyOf('human-tasks') };
  s.edit('verifier', (t) => t.replace(/^slot: 3$/m, 'slot: 4'));
  s.edit('human-tasks', (t) => t.replace(/^slot: 4$/m, 'slot: 3'));
  const r = s.sync();
  eq(r.status, 0, `종료코드\n${r.out}`);
  eq(bodyOf('verifier'), bodies.verifier, 'verifier 본문'); eq(bodyOf('human-tasks'), bodies['human-tasks'], 'human-tasks 본문');
  const planA = JSON.parse(readFileSync(join(s.out, 'layout-plan.json'), 'utf8'));
  const flat = (p) => Object.fromEntries(p.tabs.flatMap((t) => t.roles.map((e) => [e.id, { tab: t.name, ...e }])));
  const pb = flat(planA);
  eq(pb.verifier.slot, 4, 'verifier slot'); eq(pb['human-tasks'].slot, 3, 'human-tasks slot');
  eq(pb.verifier.labels['orch.slot'], '4', 'verifier 라벨 orch.slot'); eq(pb['human-tasks'].labels['orch.slot'], '3', 'human-tasks 라벨 orch.slot');
  eq(pb.verifier.tab, 'CT-CC-1,2,3,4', '탭 이름은 그대로');
  eq(pb.verifier.hc_name, 'orch-verifier', '창 이름(id 기준)은 그대로');
  // 카드 본문(머리말 뒤)은 그대로, 머리말의 역할 번호만 달라짐
  const roles = loadRoles(s.roles); const vcfg = toVarsConfig(JSON.parse(read(SCEN_CFG)));
  const vb = renderBody(roles.find((x) => x.meta.id === 'verifier'), roles, vcfg);
  ok(s.text('cards/verifier.md').endsWith(`${vb}\n`), '카드 본문 부분이 달라짐');
  ok(s.text('cards/verifier.md').includes('역할 4번 "검증관"'), '카드 머리말의 역할 번호가 새 slot 이어야 함');
});

check('(8f) 시나리오 잘못된 입력: id 중복·모르는 변수는 sync 실패(출력 그대로), 설정 오류는 종료코드 2', () => {
  const s = scenario();
  const keep = s.snap();
  s.roleFile('dup', { meta: { id: 'verifier', slot: 12 } });
  let r = s.sync();
  eq(r.status, 1, `id 중복인데 종료코드\n${r.out}`);
  ok(/verifier/.test(r.stderr) && /id/.test(r.stderr), `이유가 안 보임\n${r.stderr}`);
  ok(sameTree(keep, s.snap()), 'id 중복 실패가 출력을 건드림');
  s.roleFile('dup', { body: '모르는 변수 {nonexistent} 사용' });
  r = s.sync();
  eq(r.status, 1, `모르는 변수인데 종료코드\n${r.out}`);
  ok(/nonexistent/.test(r.stderr), '이유에 변수 이름');
  ok(sameTree(keep, s.snap()), '모르는 변수 실패가 출력을 건드림');
});

// ⑪ 정리 2 (I6): 자리(seat) 고정 — 탭 이름은 자리 번호 범위로만 정해진다
const BASE_TABS = 'CT-CC-Master | CT-CC-1,2,3,4 | CT-CC-5,6,7,8 | CT-CC-9,10';
const planOf = (s) => JSON.parse(s.text('layout-plan.json'));
const tabNames = (p) => p.tabs.map((t) => t.name).join(' | ');
const setEnabled = (s, id, v) => s.edit(id, (t) => t.replace(/^enabled: (true|false)$/m, `enabled: ${v}`));

check('(11a) 자리 고정: 역할을 꺼도 다른 탭 이름·자리가 바뀌지 않음 (빈 자리로 남음)', () => {
  const s = scenario();
  const base = planOf(s);
  eq(tabNames(base), BASE_TABS, '기본 탭 이름·순서(설계서 5-6)');
  eq(base.tabs.map((t) => t.seats.join(',')).join(' | '), '0 | 1,2,3,4 | 5,6,7,8 | 9,10', '탭마다 자리 범위가 계획에 들어 있어야 함');
  const idsOf = (p, name) => p.tabs.find((t) => t.name === name).roles.map((e) => e.id).join(',');
  // 한 역할(자리 3)을 끈다
  setEnabled(s, 'verifier', false);
  let r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  let p = planOf(s);
  eq(tabNames(p), BASE_TABS, '자리 3 을 꺼도 탭 이름은 그대로');
  ok(!idsOf(p, 'CT-CC-1,2,3,4').includes('verifier') && idsOf(p, 'CT-CC-1,2,3,4').split(',').length === 3, '꺼진 역할은 그 탭에서 빠짐(자리는 빈 채로)');
  eq(idsOf(p, 'CT-CC-5,6,7,8'), idsOf(base, 'CT-CC-5,6,7,8'), '다른 탭의 역할은 그대로');
  // 자리 9 도 끈다: 탭 CT-CC-9,10 은 이름이 CT-CC-10 으로 바뀌면 안 됨
  setEnabled(s, 'security-guard', false);
  r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  p = planOf(s);
  eq(tabNames(p), BASE_TABS, '자리 9 만 꺼도 CT-CC-9,10 이 CT-CC-10 으로 바뀌지 않음');
  eq(p.tabs.find((t) => t.name === 'CT-CC-9,10').seats.join(','), '9,10', '빈 자리 9 가 자리 목록에는 남음');
  // 자리 10 도 끄면 그 탭에 켜진 역할이 없으므로 탭만 빠지고 다른 탭 이름은 그대로
  setEnabled(s, 'role-auditor', false);
  r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  eq(tabNames(planOf(s)), 'CT-CC-Master | CT-CC-1,2,3,4 | CT-CC-5,6,7,8', '9·10 모두 꺼지면 그 탭만 계획에서 빠짐');
  // 다시 켜면 원래대로
  setEnabled(s, 'role-auditor', true); setEnabled(s, 'security-guard', true); setEnabled(s, 'verifier', true);
  r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  ok(sameTree(s.base, s.snap()), '모두 다시 켜면 생성물이 처음과 바이트까지 같음');
});

check('(11b) 새 자리 11 이상은 4개씩 묶음(11-14, 15-18 …), 다른 탭 이름은 그대로', () => {
  const s = scenario();
  s.roleFile('extra-a', { meta: { slot: 11 } });
  s.roleFile('extra-b', { meta: { slot: 14 } });
  s.roleFile('extra-c', { meta: { slot: 15 } });
  s.roleFile('extra-d', { meta: { slot: 18 } });
  s.roleFile('extra-e', { meta: { slot: 19 } });
  const r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  const p = planOf(s);
  eq(tabNames(p), `${BASE_TABS} | CT-CC-11,12,13,14 | CT-CC-15,16,17,18 | CT-CC-19,20,21,22`, '탭 이름·순서');
  const at = (n) => p.tabs.find((t) => t.name === n).roles.map((e) => e.id).join(',');
  eq(at('CT-CC-11,12,13,14'), 'extra-a,extra-b', '자리 11·14');
  eq(at('CT-CC-15,16,17,18'), 'extra-c,extra-d', '자리 15·18');
  eq(at('CT-CC-19,20,21,22'), 'extra-e', '자리 19');
  for (const n of ['CT-CC-Master', 'CT-CC-1,2,3,4', 'CT-CC-5,6,7,8', 'CT-CC-9,10']) eq(p.tabs.find((t) => t.name === n).roles.map((e) => e.id).join(','), JSON.parse(readFileSync(join(s.out, 'layout-plan.json'), 'utf8')).tabs.find((t) => t.name === n).roles.map((e) => e.id).join(','), n);
  // 새 역할 하나만 꺼도 11 묶음 이름은 그대로 (자리 11 이 비어도 CT-CC-11,12,13,14)
  setEnabled(s, 'extra-a', false);
  const r2 = s.sync(); eq(r2.status, 0, `종료코드\n${r2.out}`);
  ok(tabNames(planOf(s)).includes('CT-CC-11,12,13,14'), '자리 11 을 꺼도 묶음 이름은 그대로');
});

check('(11c) slot 변경: 역할이 다른 자리로 옮겨 가도 두 탭의 이름은 자리 범위 그대로', () => {
  const s = scenario();
  s.edit('git-keeper', (t) => t.replace(/^slot: 8$/m, 'slot: 12'));
  const r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  const p = planOf(s);
  eq(tabNames(p), `${BASE_TABS} | CT-CC-11,12,13,14`, '탭 이름');
  const e = p.tabs.find((t) => t.name === 'CT-CC-11,12,13,14').roles[0];
  eq(e.id, 'git-keeper', '옮겨 간 역할'); eq(e.labels['orch.slot'], '12', '라벨 orch.slot');
  ok(!p.tabs.find((t) => t.name === 'CT-CC-5,6,7,8').roles.some((x) => x.id === 'git-keeper'), '옛 탭에서 빠짐');
});

check('(11d) 같은 자리를 두 역할이 쓰면 실패 (꺼진 역할의 자리도 점유), commander·proxy 는 slot 0 그대로 Master 탭', () => {
  const s = scenario();
  const keep = s.snap();
  s.roleFile('thief', { meta: { slot: 3 } });
  let r = s.sync(); eq(r.status, 1, `자리 겹침인데 종료코드\n${r.out}`);
  ok(/slot/.test(r.stderr) && /thief/.test(r.stderr), `이유가 안 보임\n${r.stderr}`);
  ok(sameTree(keep, s.snap()), '실패한 sync 가 출력을 건드림');
  setEnabled(s, 'verifier', false);          // 꺼도 자리는 그 역할 것
  r = s.sync(); eq(r.status, 1, `꺼진 역할의 자리를 새 역할이 쓰려 하면 실패해야 함\n${r.out}`);
  unlinkSync(join(s.roles, 'thief.md'));
  setEnabled(s, 'approval-proxy', true);
  r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  const p = planOf(s);
  eq(p.tabs[0].name, 'CT-CC-Master', 'Master 탭'); eq(p.tabs[0].roles.map((e) => e.id).join(','), 'commander,approval-proxy', 'Master 탭의 역할(총지휘, 승인 대행)');
  eq(p.tabs[0].seats.join(','), '0', 'Master 탭 자리');
});

check('(11e) 설정 layout.tab_groups 로 자리 범위를 바꿀 수 있고, 잘못된 범위는 설정 오류(종료코드 2)', () => {
  const s = scenario();
  const c = JSON.parse(read(SCEN_CFG));
  c.layout.tab_groups = [[1, 5], [6, 10]];
  s.useConfig(c);
  let r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  eq(tabNames(planOf(s)), 'CT-CC-Master | CT-CC-1,2,3,4,5 | CT-CC-6,7,8,9,10', '설정한 자리 범위');
  for (const bad of [[[1, 4], [6, 10]], [[2, 4]], [[1, 4], [4, 8]], [[1, 0]], 'x']) {
    c.layout.tab_groups = bad; s.useConfig(c);
    r = s.sync(); eq(r.status, 2, `잘못된 tab_groups ${JSON.stringify(bad)} 인데 종료코드\n${r.out}`);
  }
});

// ⑫ 정리 2 (I8): 내 역할 폴더 <ORCH_HOME>\config\roles\
const VERIFIER_NEW_BODY = '내가 바꾼 검증관 본문입니다. {commander}에게 보고한다.';
const tmplRc = (() => { const f = join(BASE, 'rc12.json'); writeFileSync(f, JSON.stringify({ commander: 'orch-commander', control_dir: 'ctl', projects_root: 'pr', scope_prefix: 'S /' })); return f; })();

check('(12a) 내 역할: 같은 id 파일은 번들을 덮어쓰고(본문 대체), 새 id 는 추가되며, 번들 파일은 그대로', () => {
  const s = scenario();
  const bundleBefore = tree(s.roles);
  s.userFile('verifier.md', `---\n---\n${VERIFIER_NEW_BODY}\n`);                   // 본문만 덮어쓰기(머리말 필드는 번들 값 유지)
  s.userFile('my-extra.md', `---\nname: "내 보조 역할"\nslot: 11\nkind: worker\nmode: read-only\nwrites_to: []\nreports_to: commander\ncadence: on-request\nenabled: true\nreplaces: []\nneeds: []\nversion: 1\n---\n보조 역할 본문. {name:verifier}(역할 {n:verifier})와 협력한다.\n`);
  const r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  ok(/내 역할/.test(r.stdout), `sync 출력에 내 역할 폴더 사용이 안 보임\n${r.stdout}`);
  ok(s.text('cards/verifier.md').endsWith(`${VERIFIER_NEW_BODY.replace('{commander}', 'orch-commander')}\n`), '덮어쓴 본문이 카드에 들어가야 함');
  ok(s.text('cards/verifier.md').includes('역할 3번 "검증관"'), '머리말(이름·자리)은 번들 값 그대로(필드 단위 병합)');
  ok(s.text('cards/my-extra.md').includes('보조 역할 본문. 검증관(역할 3)와 협력한다.'), '새 역할 카드, 참조 변수도 풀림');
  ok(sameTree(bundleBefore, tree(s.roles)), '번들 roles 폴더가 바뀜');
  const plan = planOf(s);
  ok(plan.tabs.some((t) => t.name === 'CT-CC-11,12,13,14' && t.roles.some((e) => e.id === 'my-extra' && e.hc_name === 'orch-my-extra')), '새 역할이 자리 11 탭에 놓임');
  ok(s.text('역할표.md').includes('| my-extra |'), '역할표에 새 역할');
});

check('(12b) 내 역할: enabled: false 만 담은 덮어쓰기로 번들 역할을 끈다(파일은 안 지움), 필드 단위 병합(name 만 바꾸기)', () => {
  const s = scenario();
  s.userFile('git-keeper.md', '---\nenabled: false\n---\n');
  s.userFile('verifier.md', '---\nname: "검증관(내 이름)"\n---\n');
  const r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  ok(!existsSync(join(s.out, 'cards', 'git-keeper.md')), '꺼진 역할의 카드가 남음');
  const [onSec, offSec] = s.text('역할표.md').split('## 꺼진 역할');
  ok(!onSec.includes('| git-keeper |') && offSec.includes('| git-keeper |'), '꺼진 역할 표시');
  ok(!planOf(s).tabs.some((t) => t.roles.some((e) => e.id === 'git-keeper')), '탭 계획에서 빠짐');
  eq(tabNames(planOf(s)), BASE_TABS, '끄기로 탭 이름이 바뀌지 않음');
  ok(existsSync(join(s.roles, 'git-keeper.md')), '번들 역할 파일은 그대로');
  ok(s.text('역할표.md').includes('| verifier | 검증관(내 이름) |'), 'name 만 덮어쓰기');
  const bundleRoles = loadRoles(s.roles);
  bundleRoles.find((x) => x.meta.id === 'verifier').meta.name = '검증관(내 이름)';     // 이름만 바뀐 것으로 렌더한 본문과 같아야 함
  ok(s.text('cards/verifier.md').endsWith(`${renderBody(bundleRoles.find((x) => x.meta.id === 'verifier'), bundleRoles, toVarsConfig(JSON.parse(read(SCEN_CFG))))}\n`), '본문은 번들 것 그대로(덮어쓰기 파일의 본문이 비어 있으면 유지)');
  // 켜기도 같은 방식: 번들에서 꺼져 있던 approval-proxy 를 내 역할 폴더에서 켠다 (역할만 켜짐, 기능 승인 대행은 설정이 따로)
  s.userFile('approval-proxy.md', '---\nenabled: true\n---\n');
  const r2 = s.sync(); eq(r2.status, 0, `종료코드\n${r2.out}`);
  ok(planOf(s).tabs[0].roles.some((e) => e.id === 'approval-proxy'), '역할이 켜져 Master 탭에 놓임');
  eq(JSON.parse(read(SCEN_CFG)).functions.autopress, false, '역할(approval-proxy)을 켜도 기능 autopress 설정은 그대로 꺼짐(역할과 기능은 별개)');
});

check('(12c) 내 역할: 잘못된 파일은 하나라도 있으면 sync 실패(출력 그대로, fail-closed), 이유에 파일 이름', () => {
  const s = scenario();
  const keep = s.snap();
  const bad = [
    ['머리말 없음', 'broken.md', '머리말 없는 파일\n', /broken\.md/],
    ['id 와 파일 이름이 다름', 'verifier.md', '---\nid: someone-else\n---\n본문\n', /someone-else|id/],
    ['정의에 없는 항목(위험 필드 시도: risk)', 'verifier.md', '---\nrisk: low\n---\n', /risk/],
    ['정의에 없는 항목(기능 켜기 시도: functions)', 'verifier.md', '---\nfunctions: autopress\n---\n', /functions/],
    ['값 형식 오류(enabled)', 'verifier.md', '---\nenabled: maybe\n---\n', /enabled/],
    ['번들에 없는 id 에 enabled 만 적음', 'ghost-role.md', '---\nenabled: false\n---\n', /ghost-role/],
    ['id 형식에 안 맞는 파일 이름(대문자)', 'README.md', '---\nenabled: false\n---\n', /README\.md/],
    ['id 형식에 안 맞는 파일 이름(공백)', 'my role.md', '---\nenabled: false\n---\n', /my role\.md/],
    ['새 역할이 번들 역할과 같은 자리', 'greedy.md', '---\nname: "욕심"\nslot: 5\nkind: worker\nmode: read-only\nwrites_to: []\nreports_to: commander\ncadence: on-request\nenabled: true\nreplaces: []\nneeds: []\nversion: 1\n---\n본문\n', /slot/],
    ['모르는 변수', 'verifier.md', '---\n---\n모르는 변수 {nonexistent}\n', /nonexistent/],
    ['없는 역할 참조', 'verifier.md', '---\n---\n{name:no-such-role} 참조\n', /no-such-role/],
    ['두 번째 총지휘', 'second-boss.md', '---\nname: "둘째 총지휘"\nslot: 0\nkind: commander\nmode: read-only\nwrites_to: []\nreports_to: user\ncadence: on-request\nenabled: true\nreplaces: []\nneeds: []\nversion: 1\n---\n- 규칙 <!-- 출처: 총지휘-인수인계.md 3 -->\n', /slot|총지휘/],
  ];
  for (const [what, file, text, why] of bad) {
    s.userFile(file, text);
    const r = s.sync();
    eq(r.status, 1, `${what}: 종료코드\n${r.out}`);
    ok(why.test(r.stderr), `${what}: 이유가 안 보임\n${r.stderr}`);
    ok(sameTree(keep, s.snap()), `${what}: 실패한 sync 가 출력을 건드림`);
    unlinkSync(join(s.user, file));
  }
  const ok2 = s.sync(); eq(ok2.status, 0, `문제 파일을 치우면 다시 성공해야 함\n${ok2.out}`);
  // 심볼릭 링크 .md 는 읽지 않고 실패(링크가 가리키는 파일을 모르고 따라가지 않음). 링크를 만들 수 없는 환경이면 건너뜀
  const target = join(BASE, 'link-target.md'); writeFileSync(target, '---\nenabled: false\n---\n');
  let linked = true;
  try { symlinkSync(target, join(s.user, 'git-keeper.md')); } catch { linked = false; }
  if (linked) { const r = s.sync(); eq(r.status, 1, `심볼릭 링크인데 종료코드\n${r.out}`); ok(/링크/.test(r.stderr), `이유(링크)\n${r.stderr}`); unlinkSync(join(s.user, 'git-keeper.md')); }
  // .md 가 아닌 파일, 하위 폴더는 무시
  writeFileSync(join(s.user, 'README.txt'), '설명'); writeFileSync(join(s.user, 'notes.bak'), 'x'); mkdirSync(join(s.user, 'old'), { recursive: true }); writeFileSync(join(s.user, 'old', 'verifier.md'), '---\nrisk: x\n---\n');
  const r3 = s.sync(); eq(r3.status, 0, `README.txt·하위 폴더는 무시해야 함\n${r3.out}`);
  ok(sameTree(s.base, s.snap()), '무시되는 파일만 있을 때 생성물은 처음과 같음');
  return { note: `잘못된 파일 ${bad.length}종 모두 실패${linked ? ' + 심볼릭 링크' : ''}` };
});

check('(12d) validate-roles / render-card 도 같은 로더(내 역할 폴더 포함)를 쓰고, 기본 12개 렌더는 내 역할이 비어 있으면 변함없음', () => {
  const s = scenario();
  const ud = s.userDir();
  const V = (extra = []) => runNode([join(ROOT, 'bin', 'validate-roles.mjs'), '--roles-dir', s.roles, ...extra]);
  const RC = (extra = []) => runNode([join(ROOT, 'bin', 'render-card.mjs'), 'verifier', '--config', tmplRc, '--roles-dir', s.roles, ...extra]);
  // 내 역할 폴더를 안 알려 주면(= --roles-dir 만 줌) 번들만 본다
  writeFileSync(join(ud, 'verifier.md'), `---\n---\n${VERIFIER_NEW_BODY}\n`);
  ok(!RC().stdout.includes('내가 바꾼 검증관'), '--user-roles-dir 없이 --roles-dir 만 주면 번들만 읽어야 함');
  const withUser = RC(['--user-roles-dir', ud]); eq(withUser.status, 0, `render-card 종료코드\n${withUser.out}`);
  ok(withUser.stdout.includes('내가 바꾼 검증관 본문입니다. orch-commander에게 보고한다.'), 'render-card 가 내 역할 덮어쓰기를 반영해야 함');
  const v = V(['--user-roles-dir', ud]); eq(v.status, 0, `validate 종료코드\n${v.out}`); ok(/내 역할/.test(v.stdout), `validate 출력에 내 역할 폴더 사용\n${v.stdout}`);
  writeFileSync(join(ud, 'verifier.md'), '---\nrisk: low\n---\n');
  const v2 = V(['--user-roles-dir', ud]); eq(v2.status, 1, `잘못된 내 역할인데 validate 종료코드\n${v2.out}`); ok(/verifier\.md/.test(v2.stderr) && /risk/.test(v2.stderr), `이유\n${v2.stderr}`);
  const rc2 = RC(['--user-roles-dir', ud]); eq(rc2.status, 2, `잘못된 내 역할인데 render-card 종료코드\n${rc2.out}`);
  // 빈 내 역할 폴더 / 없는 폴더: 기본 렌더와 완전히 같음
  unlinkSync(join(ud, 'verifier.md'));
  eq(RC(['--user-roles-dir', ud]).stdout, RC().stdout, '빈 내 역할 폴더면 번들만 렌더한 것과 같아야 함');
  eq(RC(['--user-roles-dir', join(BASE, 'no-such-folder')]).stdout, RC().stdout, '없는 폴더도 같아야 함');
  // 기본값: ORCH_HOME 의 config\roles 를 자동으로 본다 (--roles-dir 없이 번들 roles 사용)
  const h = join(BASE, 'home12d'); mkdirSync(join(h, 'config', 'roles'), { recursive: true });
  writeFileSync(join(h, 'config', 'roles', 'verifier.md'), `---\n---\n${VERIFIER_NEW_BODY}\n`);
  const env = envFor({ orchHome: h });
  const d1 = runNode([join(ROOT, 'bin', 'render-card.mjs'), 'verifier', '--config', tmplRc], env); eq(d1.status, 0, `종료코드\n${d1.out}`);
  ok(d1.stdout.includes('내가 바꾼 검증관 본문입니다.'), '기본 위치 <ORCH_HOME>\\config\\roles 를 읽어야 함');
  const d2 = runNode([join(ROOT, 'bin', 'validate-roles.mjs')], env); eq(d2.status, 0, `종료코드\n${d2.out}`);
  const d3 = runNode([join(ROOT, 'bin', 'render-card.mjs'), 'verifier', '--config', tmplRc], envFor({ orchHome: join(BASE, 'home12-empty') })); eq(d3.status, 0, '내 역할 폴더가 없어도 성공');
  ok(!d3.stdout.includes('내가 바꾼'), '다른 ORCH_HOME 에는 영향 없음');
});

check('(12e) 설치 도구: 빈 config\\roles\\ + README.txt 를 만들고, 재설치·업그레이드는 그 안을 건드리지 않음, 내 역할이 sync 에 반영됨', () => {
  const b = makeBundle('bundle12'); const inst = join(BASE, 'inst12'), home = join(BASE, 'home12');
  const rc = runPs(ps1(b, 'install.ps1'), ['-Check', '-InstallDir', inst, '-OrchHome', home]);
  eq(rc.status, 0, `종료코드\n${rc.out}`); ok(!existsSync(home), '-Check 가 폴더를 만듦');
  ok(parseChecks(rc.out)['my-roles'], `-Check 에 내 역할 폴더 항목이 없음\n${rc.out}`);
  let r = runPs(ps1(b, 'install.ps1'), ['-InstallDir', inst, '-OrchHome', home]); eq(r.status, 0, `종료코드\n${r.out}`);
  const rd = join(home, 'config', 'roles');
  ok(statSync(rd).isDirectory(), 'config\\roles 폴더가 없음');
  eq(readdirSync(rd).join(','), 'README.txt', '처음에는 README.txt 만 들어 있어야 함(.md 는 역할로 읽히므로 .txt)');
  ok(read(join(rd, 'README.txt')).includes('enabled: false'), 'README 에 끄는 방법 안내');
  const m1 = readJson(join(home, 'install-manifest.json'));
  ok(m1.dataFiles.some((d) => d.path === 'config/roles/README.txt'), '설치 기록의 데이터 파일에 README 가 있어야 함');
  // 사용자가 넣은 내 역할
  writeFileSync(join(rd, 'verifier.md'), `---\nname: "검증관(내 이름)"\n---\n${VERIFIER_NEW_BODY}\n`);
  writeFileSync(join(rd, 'my-extra.md'), `---\nname: "내 보조 역할"\nslot: 11\nkind: worker\nmode: read-only\nwrites_to: []\nreports_to: commander\ncadence: on-request\nenabled: true\nreplaces: []\nneeds: []\nversion: 1\n---\n보조 본문.\n`);
  writeFileSync(join(rd, 'git-keeper.md'), '---\nenabled: false\n---\n');
  writeFileSync(join(rd, 'README.txt'), '내가 고친 설명');
  const env = envFor({ orchHome: home });
  const s1 = runNode([join(inst, 'bin', 'sync.mjs')], env); eq(s1.status, 0, `sync 종료코드\n${s1.out}`);
  const gen = join(home, 'state', 'generated');
  ok(read(join(gen, 'cards', 'verifier.md')).endsWith('내가 바꾼 검증관 본문입니다. orch-commander에게 보고한다.\n'), '설치본 sync 가 기본 위치의 내 역할을 반영해야 함');
  ok(existsSync(join(gen, 'cards', 'my-extra.md')) && !existsSync(join(gen, 'cards', 'git-keeper.md')), '추가·끄기 반영');
  eq(JSON.parse(read(join(gen, 'layout-plan.json'))).tabs.map((t) => t.name).join(' | '), `${BASE_TABS} | CT-CC-11,12,13,14`, '탭 이름');
  // 번들 업그레이드(번들 verifier 본문이 바뀌고 버전이 오름) → 재설치
  const before = tree(rd);
  const vf = join(b, 'roles', 'verifier.md'); writeFileSync(vf, read(vf).replace(/\s+$/, '') + ' 번들 새 문장.\n'); writeFileSync(join(b, 'VERSION'), '0.1.2\n');
  r = runPs(ps1(b, 'install.ps1'), ['-InstallDir', inst, '-OrchHome', home]); eq(r.status, 0, `재설치 종료코드\n${r.out}`);
  ok(sameTree(before, tree(rd)), `재설치가 config\\roles 안을 바꿈: ${diffKeys(before, tree(rd)).join(', ')}`);
  eq(read(join(rd, 'README.txt')), '내가 고친 설명', 'README 도 건드리지 않음');
  ok(read(join(inst, 'roles', 'verifier.md')).includes('번들 새 문장.'), '번들 쪽은 교체됨');
  const s2 = runNode([join(inst, 'bin', 'sync.mjs')], env); eq(s2.status, 0, `sync 종료코드\n${s2.out}`);
  ok(read(join(gen, 'cards', 'verifier.md')).includes('내가 바꾼 검증관 본문입니다.') && !read(join(gen, 'cards', 'verifier.md')).includes('번들 새 문장'), '업그레이드 뒤에도 내 덮어쓰기가 이김');
  // 폴더가 이미 있으면 README 를 다시 만들지 않는다(지웠으면 지운 채로)
  unlinkSync(join(rd, 'README.txt'));
  r = runPs(ps1(b, 'install.ps1'), ['-InstallDir', inst, '-OrchHome', home]); eq(r.status, 0, `재설치 종료코드\n${r.out}`);
  ok(!existsSync(join(rd, 'README.txt')), '이미 있는 폴더에는 아무것도 만들지 않아야 함');
  // 제거: 기본은 데이터 보존, -RemoveData 는 설치가 만든 파일만 지우고 내 역할은 남기며 알림
  const un = runPs(join(inst, 'bin', 'uninstall.ps1'), ['-OrchHome', home]); eq(un.status, 0, `제거 종료코드\n${un.out}`);
  ok(existsSync(join(rd, 'verifier.md')) && existsSync(join(rd, 'my-extra.md')), '기본 제거가 내 역할을 지움');
  const un2 = runPs(ps1(b, 'uninstall.ps1'), ['-RemoveData', '-OrchHome', home]); eq(un2.status, 0, `제거 종료코드\n${un2.out}`);
  ok(existsSync(join(rd, 'verifier.md')) && existsSync(join(rd, 'my-extra.md')) && existsSync(join(rd, 'git-keeper.md')), '-RemoveData 도 내 역할 파일은 지우지 않음');
  ok(/my-extra\.md/.test(un2.out), '남은 내 역할 파일 목록을 알려야 함');
  return { note: '설치·재설치·업그레이드·제거 모두 내 역할 보존' };
});

// ⑬ 정리 2 (I2): 설치 도구가 문서 폴더(ORCH_DOCS_DIR 기본값)를 만든다
check('(13) 설치 도구가 문서 폴더를 만든다: 기본 <OrchHome>\\state\\docs, -DocsDir/ORCH_DOCS_DIR 이 있으면 그 경로, 겹치면 중단, 재설치·제거는 문서를 건드리지 않음', () => {
  const b = makeBundle('bundle13');
  // 13-1 기본
  const i1 = join(BASE, 'inst13a'), h1 = join(BASE, 'home13a');
  const c = runPs(ps1(b, 'install.ps1'), ['-Check', '-InstallDir', i1, '-OrchHome', h1]);
  eq(c.status, 0, `종료코드\n${c.out}`); ok(parseChecks(c.out)['docs-dir'], `-Check 에 문서 폴더 항목이 없음\n${c.out}`); ok(!existsSync(h1), '-Check 가 폴더를 만듦');
  ok(c.out.includes(join(h1, 'state', 'docs')), `-Check 가 만들 기본 문서 폴더 위치를 보여 줘야 함\n${c.out}`);
  let r = runPs(ps1(b, 'install.ps1'), ['-InstallDir', i1, '-OrchHome', h1]); eq(r.status, 0, `종료코드\n${r.out}`);
  ok(statSync(join(h1, 'state', 'docs')).isDirectory(), '기본 문서 폴더가 만들어지지 않음');
  // 2026-11-14: 폴더를 만들어 주는 것과 파일 수정 자동 승인을 켜는 것은 별개다. 기본 위치여도 "꺼짐"과 켜는 방법을 항상 안내한다.
  ok(r.out.includes('파일 수정 자동 승인: 꺼짐') && r.out.includes('ORCH_DOCS_DIR') && r.out.includes(join(h1, 'state', 'docs')), `기본 위치여도 "파일 수정 자동 승인: 꺼짐"과 켜는 방법(ORCH_DOCS_DIR=<문서 폴더>)을 안내해야 함\n${r.out}`);
  eq(readdirSync(join(h1, 'state', 'docs')).length, 0, '문서 폴더는 비어 있어야 함');
  writeFileSync(join(h1, 'state', 'docs', 'note.md'), '내 문서');
  r = runPs(ps1(b, 'install.ps1'), ['-InstallDir', i1, '-OrchHome', h1]); eq(r.status, 0, `재설치 종료코드\n${r.out}`);
  eq(read(join(h1, 'state', 'docs', 'note.md')), '내 문서', '재설치가 문서를 건드림');
  const m = readJson(join(h1, 'install-manifest.json')); eq(m.docsDir, join(h1, 'state', 'docs'), '설치 기록의 docsDir');
  const un = runPs(join(i1, 'bin', 'uninstall.ps1'), ['-RemoveData', '-OrchHome', h1]); eq(un.status, 0, `제거 종료코드\n${un.out}`);
  eq(read(join(h1, 'state', 'docs', 'note.md')), '내 문서', '제거(-RemoveData 포함)가 문서를 지움');
  // 13-2 인자
  const i2 = join(BASE, 'inst13b'), h2 = join(BASE, 'home13b'), d2 = join(BASE, 'my-docs13b');
  r = runPs(ps1(b, 'install.ps1'), ['-InstallDir', i2, '-OrchHome', h2, '-DocsDir', d2]); eq(r.status, 0, `종료코드\n${r.out}`);
  ok(statSync(d2).isDirectory() && !existsSync(join(h2, 'state', 'docs')), '지정한 문서 폴더만 만들어야 함(기본 위치는 만들지 않음)');
  ok(r.out.includes('ORCH_DOCS_DIR') && r.out.includes(d2), '기본과 다르면 사용할 때 ORCH_DOCS_DIR 을 지정하라고 안내');
  ok(r.out.includes('파일 수정 자동 승인: 꺼짐'), '지정한 문서 폴더여도 파일 수정 자동 승인은 꺼짐이라고 안내');
  // 13-3 환경변수
  const i3 = join(BASE, 'inst13c'), h3 = join(BASE, 'home13c'), d3 = join(BASE, 'env-docs13c');
  r = runPs(ps1(b, 'install.ps1'), ['-InstallDir', i3, '-OrchHome', h3], { ...envFor({ orchHome: h3 }), ORCH_DOCS_DIR: d3 }); eq(r.status, 0, `종료코드\n${r.out}`);
  ok(statSync(d3).isDirectory() && !existsSync(join(h3, 'state', 'docs')), 'ORCH_DOCS_DIR 환경변수의 경로를 써야 함');
  // 13-4 겹침: 문서 폴더가 설치 폴더 안 / 설정 폴더 안 / 같은 폴더 → 중단, 아무것도 안 만듦
  for (const [what, mk] of [['설치 폴더 안', (i, h) => join(i, 'docs')], ['설치 폴더 자체', (i) => i], ['설정 폴더 안', (i, h) => join(h, 'config', 'd')], ['설치 폴더를 포함', (i, h) => dirname(i)]]) {
    const ii = join(BASE, `inst13x-${what.length}`), hh = join(BASE, `home13x-${what.length}`);
    const before = tree(BASE);
    r = runPs(ps1(b, 'install.ps1'), ['-InstallDir', ii, '-OrchHome', hh, '-DocsDir', mk(ii, hh)]);
    eq(r.status, 1, `${what}: 종료코드\n${r.out}`); eq(parseChecks(r.out)['docs-dir']?.status, '중단', `${what}: 중단 표시`);
    ok(sameTree(before, tree(BASE)) && !existsSync(hh), `${what}: 중단했는데 무엇인가 만들어짐`);
  }
});

// ⑭ 정리 2 (I9): 경로 해석 규칙이 한 곳(lib/orch-paths)이고, 폴더는 명시적으로만 만든다
check('(14) 경로 규칙 통일: import·점 불러오기만으로 폴더가 생기지 않고, node 규칙과 PowerShell 규칙이 같은 값을 냄', () => {
  const libUrl = pathToFileURL(join(ROOT, 'lib', 'orch-paths.mjs')).href;
  const nodePaths = (env) => { const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(libUrl)}).then(m=>console.log(JSON.stringify(m.resolvePaths())))`], { env, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`node 실패\n${r.stderr}`); return JSON.parse(r.stdout); };
  const psPaths = (env) => {
    const f = join(ROOT, 'lib', 'orch-paths.ps1');
    const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', `. '${f.replace(/'/g, "''")}'; [pscustomobject]@{ home=$OrchHome; config=$OrchConfig; state=$OrchState; logs=$OrchLogs; roles=$OrchRoles; docs=$OrchDocs } | ConvertTo-Json -Compress`], { env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`ps 실패\n${r.stdout}${r.stderr}`); return JSON.parse(r.stdout);
  };
  const norm = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v).replace(/\//g, '\\')]));
  const cases = [
    ['ORCH_HOME 이 있으면 그것', (() => { const e = envFor({ orchHome: join(BASE, 'p14-home') }); return e; })(), join(BASE, 'p14-home')],
    ['없으면 %LOCALAPPDATA%\\Herdr-Orchestration', (() => { const la = join(BASE, 'p14-local'); return envFor({ localapp: la }); })(), join(BASE, 'p14-local', 'Herdr-Orchestration')],
  ];
  for (const [what, env, home] of cases) {
    const before = tree(BASE);
    const n = nodePaths(env), p = psPaths(env);
    eq(n.home, home, `${what}: node home`);
    eq(JSON.stringify(norm(p)), JSON.stringify(norm(n)), `${what}: node 와 PowerShell 의 경로 규칙이 같아야 함`);
    eq(n.config, join(home, 'config'), 'config'); eq(n.state, join(home, 'state'), 'state'); eq(n.logs, join(home, 'logs'), 'logs');
    eq(n.roles, join(home, 'config', 'roles'), 'roles(내 역할 폴더)'); eq(n.docs, join(home, 'state', 'docs'), 'docs(문서 폴더 기본값)');
    ok(!existsSync(home) && sameTree(before, tree(BASE)), `${what}: 불러오기만 했는데 폴더가 만들어짐`);
  }
  // LOCALAPPDATA 도 없을 때: USERPROFILE\AppData\Local (node·PowerShell 이 같은 값)
  const env3 = envFor({}); delete env3.LOCALAPPDATA; env3.USERPROFILE = join(BASE, 'p14-profile'); delete env3.HOME; env3.HOMEDRIVE = ''; env3.HOMEPATH = '';
  eq(JSON.stringify(norm(psPaths(env3))), JSON.stringify(norm(nodePaths(env3))), 'LOCALAPPDATA 없음: 같은 규칙');
  eq(nodePaths(env3).home, join(BASE, 'p14-profile', 'AppData', 'Local', 'Herdr-Orchestration'), 'LOCALAPPDATA 없음: USERPROFILE\\AppData\\Local');
  // 설치 도구(install.ps1 의 기본 위치)도 같은 규칙: 인자 없이 -Check 하면 같은 위치가 나옴
  const envI = envFor({ localapp: join(BASE, 'p14-local') });
  const ic = runPs(ps1(B1, 'install.ps1'), ['-Check'], envI);
  ok(ic.out.includes(join(BASE, 'p14-local', 'Herdr-Orchestration', 'app')), `install.ps1 의 기본 위치가 lib 규칙과 다름\n${ic.out}`);
  // 폴더 만들기는 명시적 호출
  const home = join(BASE, 'p14-explicit');
  const ens = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(libUrl)}).then(m=>{const p=m.resolvePaths();m.ensurePaths(p);console.log('ok')})`], { env: envFor({ orchHome: home }), encoding: 'utf8' });
  ok(ens.status === 0 && statSync(join(home, 'config')).isDirectory() && statSync(join(home, 'state')).isDirectory() && statSync(join(home, 'logs')).isDirectory(), `ensurePaths 가 config/state/logs 를 만들어야 함\n${ens.stderr}`);
  ok(!existsSync(join(home, 'config', 'roles')) && !existsSync(join(home, 'state', 'docs')), 'ensurePaths 는 내 역할 폴더·문서 폴더를 만들지 않음(그건 설치 도구 몫)');
  // sync 가 쓰는 위치 규칙도 lib 와 같은 함수(소스에 두 번째 규칙이 없음)
  ok(!/LOCALAPPDATA|AppData/.test(read(join(ROOT, 'bin', 'sync-lib.mjs')) + read(join(ROOT, 'bin', 'sync.mjs'))), 'sync·sync-lib 에 경로 규칙이 따로 있음');
});

// ⑮ F-0 결정 D1·D2: 환경 규칙 층(config\env-rules.md)과 역할 한 줄 요약(summary)
const ENV_TAG = ' [이 PC 전용 규칙] ';
const cardNames = () => readdirSync(join(ROOT, 'roles')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
check('(15a) summary: 역할표에 "하는 일" 열로 나오고, 없으면 -', () => {
  const s = scenario();
  ok(s.text('역할표.md').includes('| slot | id | 이름 | 하는 일 | kind |'), '역할표에 하는 일 열이 없음');
  s.edit('verifier', (t) => t.replace(/^summary: .*$/m, 'summary: "시험을 다시 돌려 통과·보류를 판정한다"'));   // 번들 요약을 시험용 문장으로 바꿈
  s.roleFile('no-sum', {});
  const r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  const rows = s.text('역할표.md').split('\n');
  const v = rows.find((l) => l.startsWith('| 3 | verifier |'));
  ok(v && v.includes('| 시험을 다시 돌려 통과·보류를 판정한다 |'), `verifier 행: ${v}`);
  const n = rows.find((l) => l.startsWith('| 11 | no-sum |'));
  ok(n && n.includes('| no-sum 역할 | - |'), `요약 없는 행은 -: ${n}`);
});
check('(15b) summary 가 빈 문자열·숫자·201자면 sync 가 멈춘다(출력은 그대로)', () => {
  for (const [label, line] of [['빈 문자열', 'summary: ""'], ['숫자', 'summary: 123'], ['201자', `summary: "${'가'.repeat(201)}"`]]) {
    const s = scenario();
    s.edit('verifier', (t) => t.replace(/^summary: .*$/m, line));   // 기존 줄을 바꾼다(줄을 더하면 '두 번 있음' 오류로 엉뚱하게 통과함)
    const r = s.sync();
    eq(r.status, 1, `${label}: 종료코드\n${r.out}`);
    ok(/summary/.test(r.out) && !/두 번 있음/.test(r.out), `${label}: summary 형식 오류여야 함(중복 키 오류가 아님)\n${r.out}`);
  }
  const s = scenario();
  s.edit('verifier', (t) => t.replace(/^summary: .*$/m, `summary: "${'가'.repeat(200)}"`));
  eq(s.sync().status, 0, '200자는 통과해야 함');
});
check('(15c) 번들 역할 12개 모두 summary 를 가진다(1~200자)', () => {
  const missing = [];
  for (const r of loadRoles(join(ROOT, 'roles'))) {
    const v = r.meta.summary;
    if (typeof v !== 'string' || v.length < 1 || v.length > 200) missing.push(r.meta.id);
  }
  eq(missing.join(','), '', 'summary 없음/범위 밖');
});
check('(15d) 환경 규칙: 모든 카드(총지휘 포함) 끝에 한 줄로 붙고 변수 치환·줄바꿈 없음', () => {
  const s = scenario();
  const names = cardNames().filter((n) => n !== 'approval-proxy');   // 꺼진 역할은 카드 없음
  const base = Object.fromEntries(names.map((n) => [n, s.text(`cards/${n}.md`)]));
  s.useEnvRules('# 주석 줄\n\n- 규칙 하나 {commander} 그대로\n규칙 둘\n   \n');
  const r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  for (const n of names) {
    const t = s.text(`cards/${n}.md`);
    eq(t, base[n].replace(/\n$/, '') + `${ENV_TAG}규칙 하나 {commander} 그대로 / 규칙 둘\n`, `${n} 카드`);
    ok(t.trimEnd().split('\n').length === base[n].trimEnd().split('\n').length, `${n}: 줄 수가 달라짐`);
  }
});
check('(15e) 환경 규칙이 없거나 주석뿐이면 카드가 바이트 그대로이고 역할표에 해당 절이 없다', () => {
  const s = scenario();
  const names = cardNames().filter((n) => n !== 'approval-proxy');
  const base = Object.fromEntries(names.map((n) => [n, s.text(`cards/${n}.md`)]));
  ok(!s.text('역할표.md').includes('이 PC 전용 규칙'), '규칙이 없는데 절이 있음');
  s.useEnvRules('# 주석만\n\n');
  eq(s.sync().status, 0, 'sync');
  for (const n of names) eq(s.text(`cards/${n}.md`), base[n], `${n} 카드`);
  ok(!s.text('역할표.md').includes('이 PC 전용 규칙'), '주석뿐인데 절이 있음');
});
check('(15f) 환경 규칙이 있으면 역할표에 "이 PC 전용 규칙 (N개)" 절로 나온다', () => {
  const s = scenario();
  s.useEnvRules('첫째 규칙\n둘째 규칙\n');
  eq(s.sync().status, 0, 'sync');
  const t = s.text('역할표.md');
  ok(t.includes('## 이 PC 전용 규칙 (2개)'), '절 제목 없음');
  ok(t.includes('1. 첫째 규칙') && t.includes('2. 둘째 규칙'), '규칙 목록 없음');
});
check('(15g) 환경 규칙 파일이 잘못되면 sync 는 종료코드 2로 멈추고 출력을 건드리지 않는다', () => {
  const cases = [
    ['명시한 파일이 없음', (s) => s.useEnvRules(undefined, join(BASE, 'no-such-env-rules.md'))],
    ['한 줄 301자', (s) => s.useEnvRules(`${'가'.repeat(301)}\n`)],
    ['규칙 21개', (s) => s.useEnvRules(Array.from({ length: 21 }, (_, i) => `규칙 ${i + 1}`).join('\n'))],
    ['제어 문자', (s) => s.useEnvRules('규칙\u0007입니다\n')],
  ];
  for (const [label, setup] of cases) {
    const s = scenario();
    const keep = s.snap();
    setup(s);
    const r = s.sync();
    eq(r.status, 2, `${label}: 종료코드\n${r.out}`);
    eq(JSON.stringify([...s.snap()]), JSON.stringify([...keep]), `${label}: 출력이 바뀜`);
  }
  const s = scenario();
  s.useEnvRules(`${'가'.repeat(300)}\n${Array.from({ length: 19 }, (_, i) => `규칙 ${i + 2}`).join('\n')}\n`);
  eq(s.sync().status, 0, '경계(300자, 20개)는 통과해야 함');
});
check('(15h) 기본 위치 <ORCH_HOME>\\config\\env-rules.md 를 --env-rules 없이도 읽는다', () => {
  const home = dirOf('env-default-home');
  mkdirSync(join(home, 'config'), { recursive: true });
  writeFileSync(join(home, 'config', 'env-rules.md'), '기본 위치 규칙\n');
  const out = join(BASE, 'env-default-out');
  const r = runNode([join(ROOT, 'bin', 'sync.mjs'), '--config', SCEN_CFG, '--out', out], envFor({ orchHome: home }));
  eq(r.status, 0, `종료코드\n${r.out}`);
  ok(read(join(out, 'cards', 'verifier.md')).trimEnd().endsWith(`${ENV_TAG}기본 위치 규칙`), '카드에 기본 위치 규칙이 없음');
  const r2 = runNode([join(ROOT, 'bin', 'sync.mjs'), '--config', SCEN_CFG, '--out', join(BASE, 'env-default-out2')], envFor({ orchHome: dirOf('env-empty-home') }));
  eq(r2.status, 0, `파일이 없을 때 종료코드\n${r2.out}`);
  ok(!read(join(BASE, 'env-default-out2', 'cards', 'verifier.md')).includes('이 PC 전용 규칙'), '파일이 없는데 규칙이 붙음');
});

// S2(부팅 읽기 시험): 번들은 승인 대행을 기본 꺼짐으로 두지만 이 PC 는 t2v 창이 떠 있다 → 이 PC 설정층에서 한 줄로 켠다
check('(15i) 내 역할 폴더에 enabled: true 한 줄만 둔 덮어쓰기로 번들에서 꺼진 승인 대행이 켜진다(번들은 그대로)', () => {
  const s = scenario();
  ok(!s.snap().has('cards/approval-proxy.md'), '번들 기본은 꺼짐이라 카드가 없어야 함');
  ok(s.text('역할표.md').split('## 꺼진 역할')[1].includes('| approval-proxy |'), '꺼진 역할 목록에 있어야 함');
  s.userFile('approval-proxy.md', '---\nenabled: true\n---\n');
  const r = s.sync(); eq(r.status, 0, `종료코드\n${r.out}`);
  const [onSec, offSec] = s.text('역할표.md').split('## 꺼진 역할');
  ok(onSec.includes('| approval-proxy |'), '켜진 역할 목록에 없음');
  ok(!offSec.includes('| approval-proxy |'), '꺼진 목록에 아직 있음');
  ok(s.snap().has('cards/approval-proxy.md'), '켜진 뒤 카드가 생겨야 함');
  ok(read(join(ROOT, 'roles', 'approval-proxy.md')).includes('enabled: false'), '번들 파일이 바뀜');
});

// 중간 점검(2026-11-14)이 찾은 결함 F1~F3: 잘못된 입력이 스택 트레이스로 새거나, UTF-8 이 아닌 파일이 깨진 글자로 카드에 들어감
const STACK_RE = /\n\s+at .+:\d+:\d+\)?|node:internal/;
check('(15j) 잘못된 --out(일반 파일)·--env-rules(폴더)는 스택 트레이스 없이 안내 문구와 종료코드 2로 끝난다', () => {
  const f = join(BASE, 'j-file.txt'); writeFileSync(f, 'x');
  const d = join(BASE, 'j-dir'); mkdirSync(d, { recursive: true });
  for (const [label, args, want] of [['--out 이 일반 파일', ['--config', SCEN_CFG, '--out', f], /폴더가 아님/], ['--env-rules 가 폴더', ['--config', SCEN_CFG, '--env-rules', d, '--out', join(BASE, 'j-out1')], /파일이 아님/]]) {
    const r = runNode([join(ROOT, 'bin', 'sync.mjs'), ...args]);
    eq(r.status, 2, `${label}: 종료코드\n${r.out}`);
    ok(!STACK_RE.test(r.out), `${label}: 스택 트레이스가 노출됨\n${r.out}`);
    ok(want.test(r.out), `${label}: 안내 문구가 없음\n${r.out}`);
  }
});
check('(15k) UTF-8 이 아닌 입력 파일(메모장 ANSI 저장 등)은 깨진 글자를 카드에 넣지 않고 멈춘다: 환경 규칙·설정·내 역할 파일', () => {
  const ansi = Buffer.from([0xB1, 0xD4, 0xC4, 0xA2]);   // CP949 "규칙"
  // 환경 규칙
  let s = scenario(); const keep = s.snap();
  const rf = join(BASE, `scen${scenN}`, 'ansi-rules.md'); writeFileSync(rf, Buffer.concat([ansi, Buffer.from('\n')])); s.useEnvRules(undefined, rf);
  let r = s.sync();
  eq(r.status, 2, `환경 규칙 종료코드\n${r.out}`); ok(/UTF-8/.test(r.out) && !STACK_RE.test(r.out), `환경 규칙 안내 문구\n${r.out}`);
  eq(JSON.stringify([...s.snap()]), JSON.stringify([...keep]), '환경 규칙 오류인데 출력이 바뀜');
  // 설정(orchestration.json)
  s = scenario();
  const cf = join(BASE, `scen${scenN}`, 'ansi-config.json');
  const parts = read(SCEN_CFG).split('Scen-Space /'); eq(String(parts.length), '2', '시험 설정에서 바꿀 글자가 정확히 1곳이어야 함');
  writeFileSync(cf, Buffer.concat([Buffer.from(parts[0]), ansi, Buffer.from(parts[1])]));
  r = runNode([join(ROOT, 'bin', 'sync.mjs'), '--roles-dir', s.roles, '--config', cf, '--out', join(BASE, `scen${scenN}`, 'out-cfg')]);
  eq(r.status, 2, `설정 종료코드\n${r.out}`); ok(/UTF-8/.test(r.out) && !STACK_RE.test(r.out), `설정 안내 문구\n${r.out}`);
  // 내 역할 폴더
  s = scenario(); s.userDir();
  writeFileSync(join(s.user, 'ansi-role.md'), Buffer.concat([Buffer.from('---\nname: "'), ansi, Buffer.from('"\nslot: 11\nkind: worker\nmode: read-only\nwrites_to: []\nreports_to: commander\ncadence: on-request\nenabled: true\nreplaces: []\nneeds: []\nversion: 1\n---\n본문입니다.\n')]));
  r = s.sync();
  eq(r.status, 1, `내 역할 종료코드\n${r.out}`); ok(/UTF-8/.test(r.out) && !STACK_RE.test(r.out), `내 역할 안내 문구\n${r.out}`);
  ok(!s.snap().has('cards/ansi-role.md'), '깨진 역할의 카드가 생김');
  // UTF-8(BOM 포함)은 그대로 통과해야 한다(회귀)
  s = scenario(); const okf = join(BASE, `scen${scenN}`, 'utf8-bom-rules.md'); writeFileSync(okf, '﻿정상 규칙\n'); s.useEnvRules(undefined, okf);
  eq(s.sync().status, 0, 'UTF-8 BOM 규칙은 통과해야 함');
});

// ⑨ 개인 정보
check('(9) 설치 산출물에 사용자 폴더 절대경로·이메일이 없음', () => {
  const files = ['install.ps1', 'uninstall.ps1', 'sync.mjs', 'sync-lib.mjs', 'init-config.mjs', 'manage.mjs', 'manage-lib.mjs', 'manage-live.mjs', 'orch-manager.ps1', 'Herdr-Orchestration-Manager.vbs', 'install-herdr-mod.ps1', 'herdr-keys.mjs', '../herdr-mod/orch-manager/main.js', '../herdr-mod/orch-manager/model.js', '../herdr-mod/orch-manager/ui.js', '../herdr-mod/orch-manager/tabs.js', '../herdr-mod/orch-manager/mod.json'];
  const bad = [];
  for (const f of files) {
    const t = read(join(ROOT, 'bin', f));
    if (/[A-Za-z]:[\\/]+Users[\\/]/i.test(t)) bad.push(`${f}: 사용자 폴더 경로`);
    if (/\b[D-Z]:[\\/]+AI[-_ ]/i.test(t)) bad.push(`${f}: 개인 작업 폴더 경로`);
    if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/.test(t)) bad.push(`${f}: 이메일 형태`);
  }
  eq(bad.join('; '), '', '발견');
  return { note: `${files.length}개 파일` };
});

// ⑩-b 더블클릭 실행기(.vbs)는 영문(ASCII)만: 한글이 들어가면 인코딩에 따라 깨질 수 있다
check('(10b) 관리 창 실행기(.vbs)는 ASCII 만이고 CRLF 이며 같은 폴더의 orch-manager.ps1 을 숨김 창으로 부른다', () => {
  const buf = readFileSync(join(ROOT, 'bin', 'Herdr-Orchestration-Manager.vbs'));
  ok(buf.every((b) => b < 128), '비 ASCII 글자가 있음');
  ok(!/(?<!\r)\n/.test(buf.toString('latin1')), 'CRLF 가 아닌 줄바꿈이 있음');
  const t = buf.toString('latin1');
  ok(/GetParentFolderName\(WScript\.ScriptFullName\)/.test(t) && /orch-manager\.ps1/.test(t) && /-WindowStyle Hidden/.test(t) && /-STA/.test(t), '자기 폴더 기준 실행/숨김/STA 가 아님');
  ok(!/[A-Za-z]:\\/.test(t), '고정 드라이브 경로가 있음');
});

// ⑩ .ps1 형식
check('(10) .ps1 은 PowerShell 5.1 파싱 오류 0건, 한글이 있으면 UTF-8 BOM + CRLF (ASCII 면 그대로)', () => {
  const targets = ['install.ps1', 'uninstall.ps1', 'orch-manager.ps1', 'install-herdr-mod.ps1'].map((f) => join(ROOT, 'bin', f));
  const expr = targets.map((t) => `$e=$null;$tk=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${t.replace(/'/g, "''")}',[ref]$tk,[ref]$e);'ERR=' + @($e).Count + ' ' + '${t.replace(/'/g, "''")}'`).join(';');
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', expr], { encoding: 'utf8', env: envFor() });
  const lines = (r.stdout ?? '').split(/\r?\n/).filter((l) => l.startsWith('ERR='));
  eq(lines.length, targets.length, `파싱 결과 줄 수\n${r.stdout}${r.stderr}`);
  for (const l of lines) ok(l.startsWith('ERR=0 '), `파싱 오류: ${l}`);
  for (const t of targets) {
    const buf = readFileSync(t);
    const s = buf.toString('utf8').replace(/^﻿/, '');
    const nonAscii = /[^\x00-\x7f]/.test(s);
    if (nonAscii) {
      ok(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, `${t}: 한글이 있는데 UTF-8 BOM 이 없음`);
      ok(!/(?<!\r)\n/.test(buf.toString('utf8')), `${t}: CRLF 가 아닌 줄바꿈이 있음`);
    } else ok(buf[0] !== 0xef, `${t}: 순수 ASCII 인데 BOM 이 있음`);
  }
  return { note: `${targets.length}개 파일 파싱 오류 0` };
});

console.log(`\n시험 폴더(지우지 않음): ${BASE}`);
console.log(`PASS ${pass} / FAIL ${fail} / SKIP ${skip}`);
process.exit(fail ? 1 : 0);
