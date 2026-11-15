// herdr-keys.test.mjs - bin/herdr-keys.mjs(허더 keys.json 에서 이 모드를 여는 줄만 바꾸는 CLI)를 "실제 디스크"에서 시험한다.
// 배경: 모드 안에서 허더의 writeTextFile 로 바꿨을 때 화면은 "바꿨습니다"인데 실제 keys.json 은 그대로였다. 그래서 디스크에 쓰는 일을 node 가 한다.
// 모든 시험은 임시 허더 설정 폴더(HERDR_APP_HOME)에서만 한다. 이 PC의 실제 keys.json 은 건드리지 않고, 끝에서 바이트 동일을 확인한다.
// 실행: node tests/herdr-keys.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'herdr-keys.mjs');
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}: 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const BASE = join(tmpdir(), `orch-test-keys-${Math.random().toString(36).slice(2, 8)}`);
mkdirSync(BASE, { recursive: true });
const REAL = join(process.env.USERPROFILE || tmpdir(), '.config', 'herdr-app', 'keys.json');
const realBefore = existsSync(REAL) ? sha(readFileSync(REAL)) : 'none';

const SAMPLE = (nl = '\n', own = '') => ['{', '  "global": {', own, '    "ctrl-shift-r": "mod.open:session-keeper",', '    "alt-1": "space.select:1",', '    "ctrl-shift-k": "mod.open:picker"', '  },', '  "terminal": {', '    "ctrl-shift-c": "terminal.copy",', '    "alt-j": "terminal"', '  },', '  "layout:terminals": {', '    "ctrl-shift-y": "space.next"', '  },', '  "mod:editor": {', '    "ctrl-s": "editor.save"', '  }', '}', ''].filter((l) => l !== '').join(nl) + nl;
let n = 0;
function mkHome(keys = SAMPLE()) {
  const home = join(BASE, `허더 홈 ${++n} (시험)`); mkdirSync(home, { recursive: true });
  if (keys !== null) writeFileSync(join(home, 'keys.json'), keys);
  return home;
}
function run(home, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, HERDR_APP_HOME: home }, input: '' });
  let json = null; try { json = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* 아래에서 */ }
  return { code: r.status, json, out: `${r.stdout}${r.stderr}` };
}
const keysOf = (home) => readFileSync(join(home, 'keys.json'), 'utf8');
const baks = (home) => readdirSync(home).filter((f) => f.startsWith('keys.json.bak-orch-key-'));
const ownOf = (home) => { const j = JSON.parse(keysOf(home)); return Object.keys(j.global).filter((k) => j.global[k] === 'mod.open:orch-manager'); };

await check('(K-1) status: 파일 상태와 이 모드를 여는 줄을 보여 준다(없으면 빈 목록, 파일이 없으면 거절)', () => {
  const h = mkHome(); const r = run(h, 'status'); ok(r.code === 0 && r.json.ok && r.json.valid, r.out);
  eq(r.json.own, [], '연결 없음'); ok(r.json.sections.includes('terminal') && r.json.sha256 === sha(readFileSync(join(h, 'keys.json'))), '해시·구역');
  const h2 = mkHome(SAMPLE('\n', '    "ctrl-shift-m": "mod.open:orch-manager",')); eq(run(h2, 'status').json.own, [{ section: 'global', keys: 'ctrl-shift-m' }], '연결 있음');
  const none = mkHome(null); const r3 = run(none, 'status'); ok(r3.code === 1 && r3.json.ok === false, r3.out);
  const bad = mkHome('{ 깨진'); const r4 = run(bad, 'status'); ok(r4.code === 0 && r4.json.valid === false, r4.out);
});

await check('(K-2) set: 실제 파일이 바뀌고(우리 줄만), 백업이 원래 내용으로 생기며, 응답의 해시가 실제 파일과 같다', () => {
  const src = SAMPLE(); const h = mkHome(src);
  const r = run(h, 'set', 'Alt+Shift+Y'); ok(r.code === 0 && r.json.ok && r.json.changed, r.out);
  eq(ownOf(h), ['alt-shift-y'], '실제 파일의 연결'); eq(Object.keys(JSON.parse(keysOf(h)).global)[0], 'alt-shift-y', '맨 앞');
  eq(keysOf(h).replace(/\n    "alt-shift-y": "mod\.open:orch-manager",/, ''), src, '우리 줄을 빼면 원래 파일과 바이트 동일');
  const b = baks(h); eq(b.length, 1, '백업 1개'); eq(readFileSync(join(h, b[0]), 'utf8'), src, '백업은 원래 내용'); eq(r.json.bak.split('/').pop(), b[0], '응답의 백업 이름');
  eq(r.json.sha256, sha(readFileSync(join(h, 'keys.json'))), '응답 해시 = 실제 파일 해시'); eq(r.json.own, [{ section: 'global', keys: 'alt-shift-y' }], '응답의 연결');
  ok(/Alt\+Shift\+Y/.test(r.json.msg), r.json.msg);
  ok(!readdirSync(h).some((f) => /\.tmp-orch/.test(f)), '임시 파일이 남음');
});

await check('(K-3) 같은 키로 다시 set = 변화 없음(백업도 안 만듦) / 키 교체 / default / off(해제하면 처음과 바이트 동일)', () => {
  const src = SAMPLE(); const h = mkHome(src);
  run(h, 'set', 'alt-shift-y'); const after1 = keysOf(h); const nb = baks(h).length;
  const same = run(h, 'set', 'alt-shift-y'); ok(same.code === 0 && same.json.ok && !same.json.changed, same.out); eq(keysOf(h), after1, '바뀜'); eq(baks(h).length, nb, '불필요한 백업');
  const sw = run(h, 'set', 'alt-shift-u'); ok(sw.json.ok && sw.json.changed, sw.out); eq(ownOf(h), ['alt-shift-u'], '교체 뒤 연결은 1개');
  const df = run(h, 'default'); ok(df.json.ok, df.out); eq(ownOf(h), ['ctrl-shift-m'], '기본값');
  const off = run(h, 'off'); ok(off.json.ok && off.json.changed, off.out); eq(ownOf(h), [], '해제'); eq(keysOf(h), src, '해제하면 처음과 바이트 동일');
  const off2 = run(h, 'off'); ok(off2.json.ok && !off2.json.changed, '이미 해제 = 변화 없음');
});

await check('(K-4) 거절: 모든 구역의 충돌(terminal·layout·mod 구역)·위험한 키·잘못된 형식은 파일과 백업을 건드리지 않는다', () => {
  const src = SAMPLE(); const h = mkHome(src);
  const cases = [['alt-j', /terminal/], ['ctrl-shift-y', /layout:terminals/], ['ctrl-shift-r', /global/], ['ctrl-m', /Ctrl\+글자/], ['ctrl-alt-m', /AltGr/], ['alt-f4', /운영체제/], ['m', /하나 이상/], ['ctrl-shift-m"', /영문·숫자/], ['', /키를 입력/]];
  for (const [k, re] of cases) { const r = run(h, 'set', k); ok(r.code === 1 && r.json.ok === false && re.test(r.json.msg), `${JSON.stringify(k)} → ${r.out}`); }
  eq(keysOf(h), src, '거절했는데 파일이 바뀜'); eq(baks(h), [], '거절했는데 백업이 생김');
  const noarg = run(h, 'set'); ok(noarg.code === 1, noarg.out); const unk = run(h, '이상한명령'); ok(unk.code === 2 && /사용/.test(unk.json.msg), unk.out);
});

await check('(K-5) 이상한 keys.json: 없음·깨짐·global 없음은 거절하고 아무것도 쓰지 않는다 / CRLF 와 들여쓰기는 유지', () => {
  const none = mkHome(null); const r1 = run(none, 'set', 'alt-shift-y'); ok(r1.code === 1 && !existsSync(join(none, 'keys.json')) && baks(none).length === 0, r1.out);
  for (const [name, content] of [['깨짐', '{ 깨진'], ['global 없음', '{"terminal":{"alt-9":"x"}}']]) {
    const h = mkHome(content); const r = run(h, 'set', 'alt-shift-y'); ok(r.code === 1 && keysOf(h) === content && baks(h).length === 0, `${name}: ${r.out}`);
  }
  const crlf = SAMPLE('\r\n'); const h = mkHome(crlf); const r = run(h, 'set', 'alt-shift-y'); ok(r.json.ok, r.out);
  ok(keysOf(h).includes('\r\n    "alt-shift-y"') && !/[^\r]\n/.test(keysOf(h)), 'CRLF 유지'); eq(run(h, 'off').json.ok && keysOf(h) === crlf, true, 'CRLF 해제하면 바이트 동일');
  const bom = mkHome('﻿' + SAMPLE()); const rb = run(bom, 'set', 'alt-shift-y'); ok(rb.code === 1 || rb.json.ok, 'BOM 파일은 거절하거나 올바르게 처리(예외 없이)');
});

await check('(K-6) 연달아 여러 번 바꿔도 백업 이름이 겹치지 않고, 백업 이름이 이미 있으면 거절되며 keys.json 은 그대로 / 읽기 전용 파일도 파일을 깨지 않는다', () => {
  const src = SAMPLE(); const h = mkHome(src);
  for (const k of ['alt-shift-y', 'alt-shift-u', 'alt-shift-i', 'default', 'off']) { const r = run(h, k === 'default' || k === 'off' ? k : 'set', ...(k === 'default' || k === 'off' ? [] : [k])); ok(r.json.ok && r.json.changed, `${k}: ${r.out}`); }
  eq(baks(h).length, 5, '연달아 5번 바꾸면 백업 5개(이름이 겹치지 않음)'); eq(keysOf(h), src, '다 되돌리면 처음과 바이트 동일');
  // 백업 이름을 고정해 이미 있는 이름과 부딪히게 한다
  const h1 = mkHome(src); writeFileSync(join(h1, 'keys.json.bak-orch-key-FIXED'), '선점');
  const spawn = spawnSync(process.execPath, [CLI, 'set', 'alt-shift-y'], { encoding: 'utf8', env: { ...process.env, HERDR_APP_HOME: h1, ORCH_BACKUP_STAMP: 'FIXED' } });
  const r = JSON.parse(spawn.stdout.trim()); ok(spawn.status === 1 && !r.ok && /바꾸지 않았습니다/.test(r.msg), spawn.stdout); eq(keysOf(h1), src, '백업 이름이 겹쳤는데 파일이 바뀜'); eq(readFileSync(join(h1, 'keys.json.bak-orch-key-FIXED'), 'utf8'), '선점', '이미 있던 파일을 덮어씀');
  const h2 = mkHome(src); chmodSync(join(h2, 'keys.json'), 0o444);
  const r2 = run(h2, 'set', 'alt-shift-y'); ok(r2.json && typeof r2.json.ok === 'boolean', `예외 없이 응답: ${r2.out}`); ok(JSON.parse(keysOf(h2)).global['alt-1'] === 'space.select:1', '읽기 전용 파일 내용이 깨지지 않음');
  chmodSync(join(h2, 'keys.json'), 0o666);
});

await check('(K-7) 진단용 probe: 우리가 만든 orch-probe-*.tmp 만 읽고 지운다(다른 파일·경로 이탈은 거절)', () => {
  const h = mkHome(); const name = 'orch-probe-abc123.tmp';
  eq(run(h, 'probe-read', name).json.exists, false, '없음');
  writeFileSync(join(h, name), 'probe-ok'); const r = run(h, 'probe-read', name); ok(r.json.exists && r.json.text === 'probe-ok', r.out);
  for (const bad of ['keys.json', '../keys.json', '..\\keys.json', 'orch-probe-.tmp', 'orch-probe-ABC.tmp', 'orch-probe-abc123.tmp.bak']) { const b = run(h, 'probe-read', bad); ok(b.code === 1, `거절되어야 함: ${bad} → ${b.out}`); const c = run(h, 'probe-clean', bad); ok(!c.json.removed || c.json.removed.length === 0, `지우면 안 됨: ${bad}`); }
  const c = run(h, 'probe-clean', name); eq(c.json.removed.length, 1, '지움'); ok(!existsSync(join(h, name)), '파일이 남음'); ok(existsSync(join(h, 'keys.json')), 'keys.json 은 그대로');
});

await check('(K-9) 디스크 입출력 규칙(실제 파일): 읽은 뒤 바뀌었으면 쓰지 않고, 새 파일 쓰기는 이미 있으면 거절하며, 교체 뒤 임시 파일이 남지 않는다', async () => {
  const { diskIO } = await import('../bin/herdr-keys-io.mjs');
  const h = mkHome(null); const f = join(h, '대상.json').replace(/\\/g, '/');
  eq(await diskIO.read(f), null, '없는 파일은 null');
  await diskIO.write(f, '처음', null); eq(readFileSync(f, 'utf8'), '처음', '새 파일');
  let threw = false; try { await diskIO.write(f, '덮어쓰기', null); } catch { threw = true; } ok(threw && readFileSync(f, 'utf8') === '처음', '이미 있는 파일에 새 파일 쓰기는 거절');
  threw = false; try { await diskIO.write(f, '남이 바꾼 뒤에 씀', '읽었던 옛 내용'); } catch (e) { threw = /바뀌었/.test(e.message); } ok(threw && readFileSync(f, 'utf8') === '처음', '읽은 뒤 바뀌었으면 거절하고 파일은 그대로');
  threw = false; try { await diskIO.write(join(h, '없는파일.json'), 'x', '기대'); } catch { threw = true; } ok(threw, '없는 파일에 expected 로 쓰기는 거절');
  await diskIO.write(f, '교체됨', '처음'); eq(readFileSync(f, 'utf8'), '교체됨', '읽은 그대로면 교체'); ok(!readdirSync(h).some((x) => /\.tmp-orch/.test(x)), '임시 파일이 남음');
  writeFileSync(f, Buffer.from([0xff, 0xfe, 0xfd])); threw = false; try { await diskIO.read(f); } catch { threw = true; } ok(threw, 'UTF-8 이 아니면 읽기를 거절(깨진 글자로 덮어쓰지 않음)');
});

await check('(K-8) 끝난 뒤: 이 PC의 실제 keys.json 은 바이트 동일', () => {
  eq(existsSync(REAL) ? sha(readFileSync(REAL)) : 'none', realBefore, '실제 keys.json');
});

console.log(`\n시험 폴더(지우지 않음): ${BASE}`);
console.log(`PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
