// herdr-mod-install.test.mjs - bin/install-herdr-mod.ps1 (허더 모드 설치·점검·제거) 시험.
// 모든 시험은 임시 허더 설정 폴더(-HerdrHome)에서만 한다. 이 PC의 실제 허더 설정(~\.config\herdr-app)은 건드리지 않고, 끝에서 바이트 동일을 확인한다.
// herdr-app.exe 가 없는 PC 에서는 건너뛴다(공식 검사 없이는 설치하지 않는 것이 설계라서). 실행: node tests/herdr-mod-install.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.HERDR_APP_EXE || join(process.env.LOCALAPPDATA || '', 'Programs', 'herdr-app', 'herdr-app.exe');
if (!existsSync(APP)) { console.log('SKIP  herdr-app 을 찾지 못해 모드 설치 시험을 건너뜁니다: ' + APP); console.log('PASS 0 / FAIL 0 / SKIP 1'); process.exit(0); }

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}: 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); };
const BASE = join(tmpdir(), `orch-test-modinst-${Math.random().toString(36).slice(2, 8)}`);
mkdirSync(BASE, { recursive: true });
const treeHash = (dir) => {
  if (!existsSync(dir)) return 'none';
  const h = createHash('sha256');
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (lstatSync(p).isDirectory()) walk(p); else h.update(p + ':' + createHash('sha256').update(readFileSync(p)).digest('hex')); } };
  walk(dir); return h.digest('hex');
};
const REAL_HERDR = join(process.env.USERPROFILE || tmpdir(), '.config', 'herdr-app');
const realBefore = treeHash(join(REAL_HERDR, 'mods')) + (existsSync(join(REAL_HERDR, 'keys.json')) ? createHash('sha256').update(readFileSync(join(REAL_HERDR, 'keys.json'))).digest('hex') : 'nokeys');

const KEYS = (extra = '') => `{\n  "global": {\n${extra}    "ctrl-shift-r": "mod.open:session-keeper",\n    "alt-1": "space.select:1",\n    "ctrl-shift-k": "mod.open:picker"\n  },\n  "other": {\n    "enter": "x"\n  }\n}\n`;
let n = 0;
function mkHerdr({ keys = KEYS(), tool = true } = {}) {
  const root = join(BASE, `시험 ${++n} (허더 홈)`); const hh = join(root, 'herdr-app');
  mkdirSync(join(hh, 'mods', 'other-mod'), { recursive: true });
  writeFileSync(join(hh, 'mods', 'other-mod', 'main.js'), '// 다른 모드\n'); writeFileSync(join(hh, 'keys.json'), keys);
  const toolDir = join(root, '내 도구 (엔진)'); mkdirSync(toolDir, { recursive: true });
  const toolPath = join(toolDir, 'manage.mjs'); if (tool) writeFileSync(toolPath, '// 가짜 엔진\n');
  return { hh, toolPath, root };
}
function run(h, args = [], { app = APP } = {}) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ROOT, 'bin', 'install-herdr-mod.ps1'), '-HerdrHome', h.hh, '-HerdrApp', app, '-ToolPath', h.toolPath, ...args], { encoding: 'utf8', timeout: 180000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const modDir = (h) => join(h.hh, 'mods', 'orch-manager');

await check('(I-1) 점검(-Check)은 아무것도 바꾸지 않는다 / 문제가 있으면 이유를 말하고 멈춘다', () => {
  const h = mkHerdr(); const before = treeHash(h.hh);
  const r = run(h, ['-Check']); ok(r.code === 0 && /점검 통과/.test(r.out) && /비어 있음/.test(r.out), r.out.slice(0, 500));
  eq(treeHash(h.hh), before, '점검이 허더 폴더를 바꿈');
  const noTool = mkHerdr({ tool: false }); const r2 = run(noTool, ['-Check']); ok(r2.code === 1 && /manage\.mjs 를 찾지 못함/.test(r2.out), r2.out.slice(0, 400));
  const r3 = run(h, ['-Check'], { app: join(BASE, '없는앱.exe') }); ok(r3.code === 1 && /herdr-app\.exe 를 찾지 못함/.test(r3.out), r3.out.slice(0, 400));
  const r4 = run(h, ['-Check', '-Key', 'ctrl shift m!']); ok(r4.code === 1 && /키 이름 형식/.test(r4.out), r4.out.slice(0, 400));
});

const stageNow = () => readdirSync(tmpdir()).filter((x) => x.startsWith('orch-mod-stage-')).sort();   // 설치가 만드는 임시 사본 폴더(끝나면 없어야 함)
const stageBefore = stageNow();                                                                      // 이전 실행이 남긴 것은 제외하고 "이번에 새로 남는 것"만 본다
await check('(I-2) 설치: 공백·한글·괄호 경로에서 모드 파일 전부(main·model·ui·tabs·mod.json)가 복사되고 TOOL 이 절대 경로로 채워지며, 다른 모드는 그대로다', () => {
  const h = mkHerdr(); const otherBefore = treeHash(join(h.hh, 'mods', 'other-mod'));
  const r = run(h); ok(r.code === 0 && /검사 통과\(임시 사본\)/.test(r.out) && /복사 완료/.test(r.out) && /설치본 검사: check passed/.test(r.out), r.out.slice(0, 800));
  const srcFiles = readdirSync(join(ROOT, 'herdr-mod', 'orch-manager')).filter((f) => f === 'mod.json' || f.endsWith('.js'));   // 원본 폴더의 모든 모드 파일(main·model·ui·tabs·mod.json)
  ok(srcFiles.length >= 5 && srcFiles.includes('ui.js') && srcFiles.includes('tabs.js'), `원본 파일 목록: ${srcFiles}`);
  for (const f of srcFiles) ok(existsSync(join(modDir(h), f)), `${f} 가 없음`);
  const main = readFileSync(join(modDir(h), 'main.js'), 'utf8');
  eq(/const TOOL = "([^"]*)";/.exec(main)[1], h.toolPath.replace(/\\/g, '/'), 'TOOL 경로');
  ok(!main.includes('const TOOL = "manage.mjs";'), '자리표시가 그대로 남음');
  eq(treeHash(join(h.hh, 'mods', 'other-mod')), otherBefore, '다른 모드가 바뀜');
  eq(stageNow(), stageBefore, '설치 뒤 임시 사본 폴더가 새로 남음');
});

await check('(I-3) 키 연결: global 맨 앞에 한 줄, JSON 유효, 백업 1개, 다시 설치해도 그대로(멱등)', () => {
  const h = mkHerdr(); const r = run(h); ok(r.code === 0, r.out.slice(0, 400));
  const k = readFileSync(join(h.hh, 'keys.json'), 'utf8'); const j = JSON.parse(k);
  eq(Object.keys(j.global)[0], 'ctrl-shift-m', '맨 앞'); eq(j.global['ctrl-shift-m'], 'mod.open:orch-manager', '동작'); eq(j.global['ctrl-shift-r'], 'mod.open:session-keeper', '기존 키 보존'); eq(j.other.enter, 'x', '다른 구역 보존');
  ok(existsSync(join(h.hh, 'keys.json.bak-before-orch-manager')) && readFileSync(join(h.hh, 'keys.json.bak-before-orch-manager'), 'utf8') === KEYS(), '백업이 원래 내용이 아님');
  const again = run(h); ok(again.code === 0 && /이미 되어 있습니다/.test(again.out), again.out.slice(0, 400));
  eq(readFileSync(join(h.hh, 'keys.json'), 'utf8'), k, '다시 설치했더니 keys.json 이 바뀜');
  eq(readFileSync(join(h.hh, 'keys.json.bak-before-orch-manager'), 'utf8'), KEYS(), '백업을 덮어씀');
});

await check('(I-4) 키가 이미 다른 용도면 연결을 건너뛰고(keys.json 그대로) 모드만 설치한다 / -NoKey / -Key 로 다른 키', () => {
  const taken = mkHerdr({ keys: KEYS('    "ctrl-shift-m": "app.help",\n') }); const kb = readFileSync(join(taken.hh, 'keys.json'), 'utf8');
  const r = run(taken); ok(r.code === 0 && /이미 다른 용도로 쓰이고 있어 건너뜁니다/.test(r.out) && existsSync(join(modDir(taken), 'main.js')), r.out.slice(0, 500));
  eq(readFileSync(join(taken.hh, 'keys.json'), 'utf8'), kb, '쓰이는 키를 덮어씀'); ok(!existsSync(join(taken.hh, 'keys.json.bak-before-orch-manager')), '바꾸지 않았는데 백업을 만듦');
  const nk = mkHerdr(); const r2 = run(nk, ['-NoKey']); ok(r2.code === 0 && /건너뜀\(-NoKey\)/.test(r2.out), r2.out.slice(0, 400)); eq(readFileSync(join(nk.hh, 'keys.json'), 'utf8'), KEYS(), '-NoKey 인데 keys.json 이 바뀜');
  const ok2 = mkHerdr(); const r3 = run(ok2, ['-Key', 'ctrl-alt-m']); ok(r3.code === 0, r3.out.slice(0, 300)); eq(JSON.parse(readFileSync(join(ok2.hh, 'keys.json'), 'utf8')).global['ctrl-alt-m'], 'mod.open:orch-manager', '지정한 키');
});

await check('(I-5) 공식 검사를 통과하지 못하면 허더 설정에 아무것도 쓰지 않고 멈춘다(가짜 앱이 실패를 돌려줌)', () => {
  const h = mkHerdr(); const before = treeHash(h.hh);
  const fake = join(h.root, 'fake-herdr-app.cmd'); writeFileSync(fake, '@echo off\r\necho check failed: fake\r\nexit /b 1\r\n');
  const r = run(h, [], { app: fake }); ok(r.code === 1 && /검사를 통과하지 못해 설치하지 않았습니다/.test(r.out), r.out.slice(0, 500));
  eq(treeHash(h.hh), before, '실패했는데 허더 폴더가 바뀜');
  const fake2 = join(h.root, 'fake2.cmd'); writeFileSync(fake2, '@echo off\r\necho nothing\r\nexit /b 0\r\n');   // 종료 코드 0 이어도 "check passed" 가 없으면 설치하지 않는다
  const r2 = run(h, [], { app: fake2 }); ok(r2.code === 1, r2.out.slice(0, 300)); eq(treeHash(h.hh), before, '통과 글자가 없는데 설치함');
  eq(stageNow(), stageBefore, '검사 실패로 중단한 뒤 임시 사본 폴더가 남음');
});

await check('(I-6) 제거(-Uninstall): 우리 파일과 키 한 줄만 지우고(폴더째 아님), 다른 모드·다른 키는 그대로, 두 번 해도 안전', () => {
  const h = mkHerdr(); run(h); ok(existsSync(modDir(h)), '설치 실패');
  writeFileSync(join(modDir(h), 'gpui-kit.d.ts'), '// 허더가 만드는 보조 파일\n'); writeFileSync(join(modDir(h), 'jsconfig.json'), '{}');
  const otherBefore = treeHash(join(h.hh, 'mods', 'other-mod'));
  const r = run(h, ['-Uninstall']); ok(r.code === 0 && /제거했습니다/.test(r.out), r.out.slice(0, 400));
  ok(!existsSync(modDir(h)), '모드 폴더가 남음'); eq(treeHash(join(h.hh, 'mods', 'other-mod')), otherBefore, '다른 모드가 바뀜');
  const j = JSON.parse(readFileSync(join(h.hh, 'keys.json'), 'utf8')); ok(!('ctrl-shift-m' in j.global) && j.global['ctrl-shift-r'] === 'mod.open:session-keeper' && j.global['ctrl-shift-k'] === 'mod.open:picker', '키가 잘못 지워짐');
  const again = run(h, ['-Uninstall']); ok(again.code === 0 && /설치되어 있지 않습니다/.test(again.out), again.out.slice(0, 300));
  // 모르는 파일이 들어 있으면 폴더째 지우지 않는다
  const h2 = mkHerdr(); run(h2); writeFileSync(join(modDir(h2), '내 메모.txt'), '지우면 안 됨');
  const r2 = run(h2, ['-Uninstall']); ok(r2.code === 0 && /다른 파일이 남아 있어 폴더는 그대로/.test(r2.out) && readFileSync(join(modDir(h2), '내 메모.txt'), 'utf8') === '지우면 안 됨', r2.out.slice(0, 300));
});

await check('(I-9) 단축키를 바꾼 뒤(관리 창의 단축키 탭): 다시 설치해도 옛 키가 또 연결되지 않고, 제거하면 바꾼 키 줄이 지워진다(맨 끝 줄이어도 JSON 유지)', () => {
  const h = mkHerdr(); run(h);
  const kf = join(h.hh, 'keys.json');
  writeFileSync(kf, readFileSync(kf, 'utf8').replace('"ctrl-shift-m"', '"alt-j"'));                 // 관리 창이 하는 일: 우리 줄의 키만 바꿈
  const again = run(h); ok(again.code === 0 && /이미 되어 있습니다 \(alt-j\)/.test(again.out), again.out.slice(0, 500));
  const j = JSON.parse(readFileSync(kf, 'utf8')); eq(Object.keys(j.global).filter((k) => j.global[k] === 'mod.open:orch-manager'), ['alt-j'], '연결이 둘이 됨');
  const chk = run(h, ['-Check']); ok(chk.code === 0 && /이미 연결되어 있음/.test(chk.out), chk.out.slice(0, 400));
  const un = run(h, ['-Uninstall']); ok(un.code === 0, un.out.slice(0, 400));
  const j2 = JSON.parse(readFileSync(kf, 'utf8')); ok(!Object.values(j2.global).includes('mod.open:orch-manager') && j2.global['ctrl-shift-r'] === 'mod.open:session-keeper', '바꾼 키 줄이 남음');
  // 우리 줄이 구역의 맨 끝 줄일 때도 제거 결과가 올바른 JSON
  const last = mkHerdr({ keys: '{\n  "global": {\n    "ctrl-shift-r": "mod.open:session-keeper",\n    "alt-j": "mod.open:orch-manager"\n  }\n}\n' }); run(last);   // 설치(이미 연결된 것으로 보고 키는 건드리지 않음)
  const un2 = run(last, ['-Uninstall']); ok(un2.code === 0, un2.out.slice(0, 400));
  const j3 = JSON.parse(readFileSync(join(last.hh, 'keys.json'), 'utf8')); eq(j3, { global: { 'ctrl-shift-r': 'mod.open:session-keeper' } }, '맨 끝 줄 제거 결과');
});

await check('(I-7) 업데이트: 다시 설치하면 새 파일로 바뀌고 TOOL 경로가 새 위치로 갱신된다', () => {
  const h = mkHerdr(); run(h);
  const h2 = { ...h, toolPath: join(h.root, '옮긴 도구', 'manage.mjs') }; mkdirSync(dirname(h2.toolPath), { recursive: true }); writeFileSync(h2.toolPath, '// 가짜\n');
  const r = run(h2); ok(r.code === 0, r.out.slice(0, 300));
  eq(/const TOOL = "([^"]*)";/.exec(readFileSync(join(modDir(h), 'main.js'), 'utf8'))[1], h2.toolPath.replace(/\\/g, '/'), '갱신된 경로');
});

await check('(I-8) 끝난 뒤: 이 PC의 실제 허더 설정(mods·keys.json)은 바이트 동일', () => {
  const now = treeHash(join(REAL_HERDR, 'mods')) + (existsSync(join(REAL_HERDR, 'keys.json')) ? createHash('sha256').update(readFileSync(join(REAL_HERDR, 'keys.json'))).digest('hex') : 'nokeys');
  eq(now, realBefore, '실제 허더 설정');
});

console.log(`\n시험 폴더(지우지 않음): ${BASE}`);
console.log(`PASS ${pass} / FAIL ${fail} / SKIP 0`);
process.exit(fail ? 1 : 0);
