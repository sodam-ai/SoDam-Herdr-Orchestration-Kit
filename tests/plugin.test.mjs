// plugin.test.mjs - 마켓플레이스 플러그인 꾸러미(.claude-plugin/marketplace.json, plugins/herdr-orchestration-manager) 시험.
//  · payload 가 원본(번들)과 같은가 · 설정 파일·스킬 형식 · 스크립트 형식
//  · 설치→사용→제거 전체 흐름을 임시 폴더(공백·한글·괄호 경로)에서 실제로 돌린다 (허더 설정·오케스트레이션 설정도 임시 폴더)
// 이 PC의 실제 설정(%LOCALAPPDATA%\Herdr-Orchestration, ~\.config\herdr-app)은 건드리지 않고, 끝에서 바이트 동일을 확인한다.
// herdr-app.exe 가 없는 PC 에서는 설치 흐름 시험만 건너뛴다. 실행: node tests/plugin.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { plan } from '../tools/build-plugin.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugins', 'herdr-orchestration-manager');
const APP = process.env.HERDR_APP_EXE || join(process.env.LOCALAPPDATA || '', 'Programs', 'herdr-app', 'herdr-app.exe');
let pass = 0, fail = 0, skip = 0;
async function check(name, fn) {
  try { const r = await fn(); if (r && r.skip) { skip++; console.log(`SKIP  ${name} - ${r.skip}`); return; } pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}: 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); };
const BASE = join(tmpdir(), `orch-test-plugin-${Math.random().toString(36).slice(2, 8)}`);
mkdirSync(BASE, { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const treeHash = (dir) => {
  if (!existsSync(dir)) return 'none';
  const h = createHash('sha256');
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (lstatSync(p).isDirectory()) walk(p); else h.update(p + ':' + sha(readFileSync(p))); } };
  walk(dir); return h.digest('hex');
};
const REAL_ORCH = join(process.env.LOCALAPPDATA || tmpdir(), 'Herdr-Orchestration');
const REAL_HERDR = join(process.env.USERPROFILE || tmpdir(), '.config', 'herdr-app');
const realBefore = treeHash(REAL_ORCH) + treeHash(REAL_HERDR + '/mods') + (existsSync(join(REAL_HERDR, 'keys.json')) ? sha(readFileSync(join(REAL_HERDR, 'keys.json'))) : 'nokeys');
const PS = 'powershell.exe';
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

await check('(P-1) payload 가 원본(번들)과 같다 — 어긋나면 node tools/build-plugin.mjs 로 맞춰야 한다', () => {
  const p = plan();
  eq({ add: p.add, change: p.change, remove: p.remove }, { add: [], change: [], remove: [] }, 'payload 어긋남');
  ok(p.want.size >= 40, `파일 수가 너무 적음: ${p.want.size}`);
  for (const must of ['bin/manage.mjs', 'bin/install.ps1', 'bin/install-herdr-mod.ps1', 'herdr-mod/orch-manager/main.js', 'herdr-mod/orch-manager/model.js', 'herdr-mod/orch-manager/ui.js', 'herdr-mod/orch-manager/tabs.js', 'herdr-mod/orch-manager/mod.json', 'roles/commander.md', 'VERSION']) ok(p.want.has(must), `payload 에 ${must} 없음`);
});

await check('(P-2) payload 에는 개발 보조 파일·시험·문서·개인 설정이 들어가지 않는다', () => {
  const p = plan(); const bad = [];
  for (const rel of p.have.keys()) {
    if (/(^|\/)(tests|docs|tools|node_modules|\.git|\.omc|state|logs|config)(\/|$)/.test(rel)) bad.push(rel);
    if (/\.d\.ts$|jsconfig\.json$|\.bak|\.tmp|\.log$/.test(rel)) bad.push(rel);
    if (/\.(mjs|js|ps1|md|json|vbs)$/.test(rel)) { const t = readFileSync(join(PLUGIN, 'payload', ...rel.split('/')), 'utf8'); if (/[A-Za-z]:[\\/]+Users[\\/]/i.test(t) || /\b[D-Z]:[\\/]+AI[-_ ]/i.test(t)) bad.push(rel + ' (개인 경로)'); }
  }
  eq(bad, [], '들어가면 안 되는 파일');
});

await check('(P-3) 마켓플레이스·플러그인 설정과 스킬: JSON 유효, 이름·경로·버전이 서로 맞고 VERSION 과 같다', () => {
  const m = readJson(join(ROOT, '.claude-plugin', 'marketplace.json')); const p = readJson(join(PLUGIN, '.claude-plugin', 'plugin.json'));
  const v = readFileSync(join(ROOT, 'VERSION'), 'utf8').trim();
  ok(m.name && m.owner && m.owner.name && Array.isArray(m.plugins) && m.plugins.length === 1, 'marketplace 형식');
  const e = m.plugins[0]; eq(e.name, p.name, '플러그인 이름'); eq(e.version, v, 'marketplace 버전'); eq(p.version, v, 'plugin 버전');
  ok(/^\.\/plugins\//.test(e.source) && existsSync(join(ROOT, e.source, '.claude-plugin', 'plugin.json')), 'source 경로');
  const skill = readFileSync(join(PLUGIN, 'skills', 'herdr-orchestration-manager', 'SKILL.md'), 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill); ok(fm, 'SKILL.md 머리말 없음');
  ok(/^name: herdr-orchestration-manager$/m.test(fm[1]) && /^description: .{20,}$/m.test(fm[1]), 'SKILL.md name/description');
  ok(skill.includes('install.ps1') && skill.includes('-Check'), '스킬이 점검 먼저 순서를 안내하지 않음');
});

await check('(P-4) 플러그인 설치·제거 스크립트: PowerShell 5.1 파싱 오류 0건, 한글이 있으면 UTF-8 BOM + CRLF', () => {
  const targets = [join(PLUGIN, 'install.ps1'), join(PLUGIN, 'uninstall.ps1'), join(PLUGIN, 'payload', 'bin', 'install-herdr-mod.ps1')];
  const expr = targets.map((t) => `$e=$null;$tk=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${t.replace(/'/g, "''")}',[ref]$tk,[ref]$e);'ERR=' + @($e).Count`).join(';');
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', expr], { encoding: 'utf8' });
  const lines = (r.stdout ?? '').split(/\r?\n/).filter((l) => l.startsWith('ERR='));
  eq(lines, ['ERR=0', 'ERR=0', 'ERR=0'], `파싱 결과\n${r.stdout}${r.stderr}`);
  for (const t of targets) {
    const b = readFileSync(t); ok(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf, `BOM 없음: ${t}`);
    const s = b.toString('utf8'); ok(!/[^\r]\n/.test(s), `LF 줄바꿈이 섞임: ${t}`);
  }
});

const INSTALL_FLOW = existsSync(APP) ? null : { skip: `herdr-app 을 찾지 못함: ${APP}` };
let flow = null;
function setup() {
  const root = join(BASE, '플러그인 시험 (새 PC)'); const hh = join(root, 'herdr-app'); const orch = join(root, '오케스트레이션 설정'); const app = join(root, '도구 폴더', 'app');
  mkdirSync(join(hh, 'mods', 'other-mod'), { recursive: true });
  writeFileSync(join(hh, 'mods', 'other-mod', 'main.js'), '// 다른 모드\n');
  writeFileSync(join(hh, 'keys.json'), '{\n  "global": {\n    "ctrl-shift-r": "mod.open:session-keeper"\n  }\n}\n');
  return { root, hh, orch, app };
}
const runPs = (script, args, env = {}) => { const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8', timeout: 300000, env: { ...process.env, ...env } }); return { code: r.status, out: `${r.stdout}${r.stderr}` }; };

await check('(P-5) 설치 전 점검(-Check): 아무것도 바꾸지 않고 통과한다', () => {
  if (INSTALL_FLOW) return INSTALL_FLOW;
  flow = setup(); const before = treeHash(flow.root);
  const r = runPs(join(PLUGIN, 'install.ps1'), ['-Check', '-InstallDir', flow.app, '-OrchHome', flow.orch, '-HerdrHome', flow.hh, '-HerdrApp', APP]);
  ok(r.code === 0 && /점검 통과/.test(r.out), r.out.slice(0, 800));
  eq(treeHash(flow.root), before, '점검이 폴더를 바꿈'); ok(!existsSync(flow.app) && !existsSync(flow.orch), '점검인데 설치 폴더가 생김');
});

await check('(P-6) 설치: 번들이 새 위치에 복사되고, 허더 모드가 설치된 엔진을 가리키며, 설치된 엔진이 실제로 동작한다', () => {
  if (INSTALL_FLOW) return INSTALL_FLOW;
  const f = flow; const otherBefore = treeHash(join(f.hh, 'mods', 'other-mod'));
  const r = runPs(join(PLUGIN, 'install.ps1'), ['-InstallDir', f.app, '-OrchHome', f.orch, '-HerdrHome', f.hh, '-HerdrApp', APP]);
  ok(r.code === 0 && /완료\. 내 설정 위치/.test(r.out), r.out.slice(-1200));
  for (const rel of ['bin/manage.mjs', 'bin/install-herdr-mod.ps1', 'herdr-mod/orch-manager/main.js', 'roles/commander.md', 'VERSION']) ok(existsSync(join(f.app, ...rel.split('/'))), `설치본에 ${rel} 없음`);
  const main = readFileSync(join(f.hh, 'mods', 'orch-manager', 'main.js'), 'utf8');
  eq(/const TOOL = "([^"]*)";/.exec(main)[1], join(f.app, 'bin', 'manage.mjs').replace(/\\/g, '/'), '모드가 가리키는 엔진');
  const keys = readJson(join(f.hh, 'keys.json')); eq(keys.global['ctrl-shift-m'], 'mod.open:orch-manager', '키 연결'); eq(keys.global['ctrl-shift-r'], 'mod.open:session-keeper', '기존 키 보존');
  eq(treeHash(join(f.hh, 'mods', 'other-mod')), otherBefore, '다른 모드가 바뀜');
  // 설치된 엔진이 설치된 위치에서 동작(모드가 부르는 방식 그대로: 입력 없이)
  const e = spawnSync(process.execPath, [join(f.app, 'bin', 'manage.mjs'), 'status', '--no-input'], { encoding: 'utf8', env: { ...process.env, ORCH_HOME: f.orch } });
  const s = JSON.parse(e.stdout); ok(s.ok && s.roles.length === 12 && s.root === f.app, `설치된 엔진 응답: ${e.stdout.slice(0, 200)}`);
  ok(existsSync(join(f.orch, 'config', 'orchestration.json')) && existsSync(join(f.orch, 'install-manifest.json')), '설정·설치 기록');
  // 설치된 단축키 도구(herdr-keys.mjs)도 설치된 위치에서 동작해야 한다(모드의 단축키 탭이 부름): 임시 허더 설정 폴더의 keys.json 으로 확인
  ok(existsSync(join(f.app, 'bin', 'herdr-keys.mjs')) && existsSync(join(f.app, 'herdr-mod', 'orch-manager', 'model.js')), '설치본에 단축키 도구가 없음');
  const kt = spawnSync(process.execPath, [join(f.app, 'bin', 'herdr-keys.mjs'), 'status'], { encoding: 'utf8', env: { ...process.env, HERDR_APP_HOME: f.hh } });
  const ks = JSON.parse(kt.stdout); ok(ks.ok && ks.valid && ks.own.length === 1 && ks.own[0].keys === 'ctrl-shift-m' && ks.path === join(f.hh, 'keys.json'), `설치된 단축키 도구 응답: ${kt.stdout.slice(0, 200)}`);
});

await check('(P-7) 다시 설치(업데이트): 오류 없이 끝나고, 내 설정과 내 역할은 그대로, 키 연결은 한 번만', () => {
  if (INSTALL_FLOW) return INSTALL_FLOW;
  const f = flow; mkdirSync(join(f.orch, 'config', 'roles'), { recursive: true });
  writeFileSync(join(f.orch, 'config', 'roles', 'my-role.md'), '---\nid: my-role\nname: "내 역할"\nsummary: "시험"\nslot: 11\nkind: worker\nmode: read-only\nwrites_to: []\nreports_to: commander\ncadence: on-request\nenabled: false\n---\n# 내 역할\n');
  const cfgBefore = sha(readFileSync(join(f.orch, 'config', 'orchestration.json'))); const roleBefore = sha(readFileSync(join(f.orch, 'config', 'roles', 'my-role.md')));
  const r = runPs(join(PLUGIN, 'install.ps1'), ['-InstallDir', f.app, '-OrchHome', f.orch, '-HerdrHome', f.hh, '-HerdrApp', APP]);
  ok(r.code === 0 && /이미 되어 있습니다/.test(r.out), r.out.slice(-1000));
  eq(sha(readFileSync(join(f.orch, 'config', 'orchestration.json'))), cfgBefore, '설정이 바뀜'); eq(sha(readFileSync(join(f.orch, 'config', 'roles', 'my-role.md'))), roleBefore, '내 역할이 바뀜');
  const keys = readFileSync(join(f.hh, 'keys.json'), 'utf8'); eq((keys.match(/orch-manager/g) || []).length, 1, '키 연결이 중복됨');
});

await check('(P-8) 제거: 모드 파일·키 한 줄·번들만 지우고 내 설정·내 역할·다른 모드는 남긴다', () => {
  if (INSTALL_FLOW) return INSTALL_FLOW;
  const f = flow; const otherBefore = treeHash(join(f.hh, 'mods', 'other-mod')); const roleBefore = sha(readFileSync(join(f.orch, 'config', 'roles', 'my-role.md')));
  const chk = runPs(join(PLUGIN, 'uninstall.ps1'), ['-Check', '-InstallDir', f.app, '-OrchHome', f.orch, '-HerdrHome', f.hh]); ok(chk.code === 0, chk.out.slice(0, 600));
  ok(existsSync(join(f.hh, 'mods', 'orch-manager', 'main.js')) && existsSync(join(f.app, 'bin', 'manage.mjs')), '-Check 인데 지워짐');
  const r = runPs(join(PLUGIN, 'uninstall.ps1'), ['-InstallDir', f.app, '-OrchHome', f.orch, '-HerdrHome', f.hh]); ok(r.code === 0, r.out.slice(-1200));
  ok(!existsSync(join(f.hh, 'mods', 'orch-manager')), '모드 폴더가 남음'); ok(!existsSync(join(f.app, 'bin', 'manage.mjs')), '번들이 남음');
  const keys = readJson(join(f.hh, 'keys.json')); ok(!('ctrl-shift-m' in keys.global) && keys.global['ctrl-shift-r'] === 'mod.open:session-keeper', '키 정리');
  eq(treeHash(join(f.hh, 'mods', 'other-mod')), otherBefore, '다른 모드가 바뀜');
  eq(sha(readFileSync(join(f.orch, 'config', 'roles', 'my-role.md'))), roleBefore, '내 역할이 지워짐'); ok(existsSync(join(f.orch, 'config', 'orchestration.json')), '내 설정이 지워짐');
});

await check('(P-9) 끝난 뒤: 이 PC의 실제 오케스트레이션 설정과 허더 설정(mods·keys.json)은 바이트 동일', () => {
  const now = treeHash(REAL_ORCH) + treeHash(REAL_HERDR + '/mods') + (existsSync(join(REAL_HERDR, 'keys.json')) ? sha(readFileSync(join(REAL_HERDR, 'keys.json'))) : 'nokeys');
  eq(now, realBefore, '실제 설정');
});

console.log(`\n시험 폴더(지우지 않음): ${BASE}`);
console.log(`PASS ${pass} / FAIL ${fail} / SKIP ${skip}`);
process.exit(fail ? 1 : 0);
