// mod-model.test.mjs - 허더 모드 "오케스트레이션 관리"의 순수 계산(herdr-mod/orch-manager/model.js) 시험.
// 실제 엔진(manage.mjs)이 돌려주는 JSON 을 그대로 넣어, 모드가 읽는 모양이 엔진과 어긋나지 않는지도 본다.
// 허더 앱이 없어도 돈다. 실행: node tests/mod-model.test.mjs
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as M from '../herdr-mod/orch-manager/model.js';
import { ID_PATTERN } from '../bin/orch-lib.mjs';
import { EDITABLE_FIELDS } from '../bin/manage-lib.mjs';
import { defaultConfig } from '../bin/sync-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}: 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); };
const BASE = join(tmpdir(), `orch-test-mod-${Math.random().toString(36).slice(2, 8)}`);
mkdirSync(BASE, { recursive: true });

const treeHash = (dir) => {
  if (!existsSync(dir)) return 'none';
  const h = createHash('sha256');
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); if (lstatSync(p).isDirectory()) walk(p); else h.update(p + ':' + createHash('sha256').update(readFileSync(p)).digest('hex')); } };
  walk(dir); return h.digest('hex');
};
const REAL = join(process.env.LOCALAPPDATA ?? tmpdir(), 'Herdr-Orchestration');
const realBefore = treeHash(REAL);

let hn = 0;
function mkHome() {
  const home = join(BASE, `h${++hn}`); mkdirSync(join(home, 'config'), { recursive: true });
  const c = defaultConfig({ orchHome: home, functionsDir: join(ROOT, 'functions') });
  c.scope_prefix = 'T /'; c.projects_root = join(BASE, 'projects') + '\\'; c.control_dir = join(BASE, 'control');
  writeFileSync(join(home, 'config', 'orchestration.json'), JSON.stringify(c, null, 2));
  return home;
}
// 모드가 하는 그대로: 요청을 파일에 쓰고 --request-file 로 엔진을 부른다(표준입력 없음)
function engine(home, cmd, req = {}) {
  const f = join(BASE, 'request.json');
  writeFileSync(f, M.requestText(req));
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'manage.mjs'), cmd, '--request-file', f], { encoding: 'utf8', env: { ...process.env, ORCH_HOME: home }, input: '' });
  return M.parseResult(r.stdout, r.stderr);
}

await check('(M-1) 엔진과 같은 규칙: id 형식·바꿀 수 있는 항목이 엔진과 어긋나지 않는다', () => {
  eq(M.ID_RE.source, ID_PATTERN.source, 'id 규칙');
  const home = mkHome();
  const rl = engine(home, 'role-list'); ok(rl.ok, JSON.stringify(rl).slice(0, 200));
  const role = rl.roles.find((r) => r.id === 'verifier');
  // 모드가 만들 수 있는 모든 필드가 엔진의 바꿀 수 있는 항목 안에 있어야 한다
  const r = M.buildRoleSetRequest(role, { name: 'a', summary: 'b', slot: '9', enabled: !(role.meta.enabled === true), mode: role.meta.mode === 'read-only' ? 'scoped-write' : 'read-only', cadence: role.meta.cadence === 'periodic' ? 'on-request' : 'periodic', reports_to: 'user', writes_to: 'x/y', body: '# 새 본문' });
  ok(r.ok && r.request, JSON.stringify(r));
  for (const k of Object.keys(r.request.fields)) ok(EDITABLE_FIELDS.includes(k), `엔진이 모르는 항목: ${k}`);
  eq(M.MODES, ['read-only', 'scoped-write'], '모드 목록'); eq(M.CADENCES, ['on-request', 'periodic'], '주기 목록');
});

await check('(M-2) 현황·역할 행: 엔진의 실제 status 를 읽어 빠짐없이 만든다(12개 역할, 총지휘가 맨 위)', () => {
  const home = mkHome();
  const st = engine(home, 'status'); ok(st.ok, JSON.stringify(st).slice(0, 200));
  const rows = M.roleRows(st); eq(rows.length, 12, '역할 수');
  eq(rows[0].kind, 'commander', '정렬'); ok(rows.every((r) => r.sourceWord === '번들' && r.enabledWord !== '-'), '출처/켜짐');
  const sr = M.statusRows(st); ok(sr.some((r) => r.key === 'roles' && /12개/.test(r.value)), '역할 줄');
  ok(sr.every((r) => typeof r.value === 'string' && typeof r.label === 'string'), '모든 줄이 글자');
  const bad = M.statusRows({ ok: false, errors: ['망가짐'] }); eq(bad[0].tone, 'bad', '오류 줄'); ok(/망가짐/.test(bad[0].value), '오류 내용');
  eq(M.statusRows(null)[0].tone, 'bad', 'null 도 죽지 않음'); eq(M.roleRows(null), [], '역할 없음');
});

await check('(M-3) 역할 저장 요청: 바뀐 것만, 안 바뀌면 empty, 잘못된 값은 엔진에 보내기 전에 거른다', () => {
  const home = mkHome();
  const role = engine(home, 'role-list').roles.find((r) => r.id === 'window-inspector');
  const m = role.meta;
  const base = { name: m.name, summary: m.summary, slot: String(m.slot), enabled: m.enabled === true, mode: m.mode, cadence: m.cadence, reports_to: m.reports_to, writes_to: (m.writes_to || []).join('\r\n'), body: String(role.body).replace(/\n/g, '\r\n') };
  eq(M.buildRoleSetRequest(role, base), { ok: true, empty: true }, '안 바뀜(CRLF·끝 공백 차이는 무시)');
  const one = M.buildRoleSetRequest(role, { ...base, name: m.name + '!' }); eq(one.request, { id: 'window-inspector', fields: { name: m.name + '!' } }, '이름만');
  const wr = M.buildRoleSetRequest(role, { ...base, writes_to: ' a/b \r\n\r\n c ' }); eq(wr.request.fields.writes_to, ['a/b', 'c'], '쓸 수 있는 곳 줄 정리');
  ok(!M.buildRoleSetRequest(role, { ...base, summary: '   ' }).ok, '하는 일 비움');
  ok(!M.buildRoleSetRequest(role, { ...base, slot: '-1' }).ok && !M.buildRoleSetRequest(role, { ...base, slot: '1.5' }).ok && !M.buildRoleSetRequest(role, { ...base, slot: '' }).ok, '자리 형식');
  ok(!M.buildRoleSetRequest(role, { ...base, mode: 'rm -rf' }).ok, '모드 값');
  ok(!M.buildRoleSetRequest(null, base).ok, '역할 없음');
  const body = M.buildRoleSetRequest(role, { ...base, body: base.body + '\r\n- 추가 줄' }); ok(body.request.body.endsWith('- 추가 줄') && !body.request.body.includes('\r'), '본문 LF');
});

await check('(M-4) 실제로 저장 → 엔진이 반영 → 다시 읽으면 같다 / 새 역할 / 되돌리기 / 삭제(파일 요청 경로 그대로)', () => {
  const home = mkHome();
  const role = engine(home, 'role-list').roles.find((r) => r.id === 'verifier');
  const draft = { name: '검증관 ✔ 모드', summary: role.meta.summary, slot: String(role.meta.slot), enabled: role.meta.enabled === true, mode: role.meta.mode, cadence: role.meta.cadence, reports_to: role.meta.reports_to, writes_to: (role.meta.writes_to || []).join('\n'), body: role.body };
  const req = M.buildRoleSetRequest(role, draft).request;
  const r1 = engine(home, 'role-set', req); ok(r1.ok && r1.backup, JSON.stringify(r1).slice(0, 300));
  const after = engine(home, 'role-list').roles.find((r) => r.id === 'verifier');
  eq(after.meta.name, '검증관 ✔ 모드', '반영'); eq(M.sourceWord(after), '내가 덮어씀', '출처');
  const nn = M.buildRoleNewRequest('qa-mod', '모드 시험', 'verifier'); ok(nn.ok, JSON.stringify(nn));
  const r2 = engine(home, 'role-new', nn.request); ok(r2.ok, JSON.stringify(r2).slice(0, 300));
  const r3 = engine(home, 'role-revert', { id: 'verifier' }); ok(r3.ok, JSON.stringify(r3).slice(0, 300));
  eq(M.sourceWord(engine(home, 'role-list').roles.find((r) => r.id === 'verifier')), '번들', '되돌린 뒤 출처');
  const r4 = engine(home, 'role-delete', { id: 'qa-mod' }); ok(r4.ok, JSON.stringify(r4).slice(0, 300));
  ok(!engine(home, 'role-list').roles.some((r) => r.id === 'qa-mod'), '삭제됨');
  const bad = M.buildRoleNewRequest('Bad ID', '', ''); ok(!bad.ok, 'id 형식');
  const refuse = engine(home, 'role-set', { id: 'verifier', fields: { mode: 'scoped-write' } }); ok(refuse.ok === false && /./.test(M.errorsText(refuse)), '엔진 거절을 글자로 읽음');
});

await check('(M-5) 내보내기 → 불러오기 미리보기·적용 → 백업 → 복구 미리보기: 계획 화면용 행이 엔진 응답과 맞는다', () => {
  const a = mkHome(); const b = mkHome();
  engine(a, 'role-new', { id: 'my-extra', fields: { name: '내 역할' } });
  const ex = engine(a, 'export', { dest: join(BASE, 'pk1'), scope: 'portable', note: '모드 시험' }); ok(ex.ok && ex.dir, JSON.stringify(ex).slice(0, 200));
  const pl = engine(b, 'import-plan', { pkg: ex.dir, mode: 'merge' }); ok(pl.ok && pl.token, JSON.stringify(pl).slice(0, 300));
  ok(/추가 1/.test(M.planHead(pl)), '머리 글: ' + M.planHead(pl));
  const rows = M.planRows(pl); ok(rows.length >= 1 && rows.some((r) => r.actionWord === '추가' && /my-extra/.test(r.path)), JSON.stringify(rows).slice(0, 300));
  const addRow = rows.find((r) => r.actionWord === '추가'); ok(addRow.onText.includes('꺼짐'), '새로 들어오는 역할은 꺼진 채: ' + addRow.onText);
  ok(M.planNotes(pl).length >= 1, '알림');
  const ap = engine(b, 'import-apply', { pkg: ex.dir, mode: 'merge', token: pl.token }); ok(ap.ok, JSON.stringify(ap).slice(0, 300));
  const bk = engine(b, 'backup', { note: '모드' }); ok(bk.ok, JSON.stringify(bk).slice(0, 200));
  const list = engine(b, 'backup-list'); const br = M.backupRows(list); ok(br.length >= 2 && br.every((x) => x.dir && x.at), JSON.stringify(br).slice(0, 300));
  const rp = engine(b, 'restore-plan', { pkg: bk.dir }); ok(rp.ok, JSON.stringify(rp).slice(0, 200)); ok(M.planHead(rp).length > 0, '복구 머리 글');
  const bad = engine(b, 'import-plan', { pkg: join(BASE, '없는폴더'), mode: 'merge' }); ok(bad.ok === false && M.planHead(bad).length > 0, '없는 묶음은 글자로 거절');
});

await check('(M-6) 실제 창 탭: 허더가 없으면 "조회할 수 없음"으로 안내하고 죽지 않는다 / 있는 값은 줄여서 보인다', () => {
  const home = mkHome();
  const r = engine(home, 'live-windows', {}); const v = M.liveRows(r); ok(typeof v.available === 'boolean' && Array.isArray(v.rows), JSON.stringify(v).slice(0, 200));
  const gone = M.liveRows({ ok: true, available: false, note: 'hc 없음' }); eq(gone, { available: false, note: 'hc 없음', rows: [], counts: {} }, '조회 불가');
  const some = M.liveRows({ ok: true, available: true, windows: [{ address: 't9', agent: 'claude-code', status: 'blocked', where: 'WS / ' + 'x'.repeat(300), inScope: true }], counts: { blocked: 1 }, total: 1, shown: 1 });
  ok(some.rows[0].where.length <= 70, '긴 글자 줄임'); eq(M.liveRows(null).available, false, 'null');
});

await check('(M-7) 보조 계산: 글자 정리·요청 크기·시간·파싱 방어', () => {
  eq(M.clip('a\u0000b‮c\n d'), 'a bc d', '제어 글자·방향 바꾸는 글자');
  eq(M.clip('이​름⁦x⁩'), '이름x', '폭 없는 글자');
  eq(M.clip(null), '', 'null'); eq(M.clip(undefined), '', 'undefined');
  eq(M.clip('가'.repeat(300), 10).length, 10, '길이');
  eq(M.parseResult('', 'boom').ok, false, '빈 출력'); eq(M.parseResult('쓰레기').ok, false, '깨진 JSON');
  eq(M.parseResult('{"ok":true}\n').ok, true, '정상'); eq(M.parseResult('[1,2]').ok, false, '배열은 거절');
  eq(M.requestText({ a: 'x'.repeat(M.REQ_MAX_CHARS) }), null, '너무 큰 요청');
  eq(M.ago(Date.now() - 5000), '방금', '방금'); eq(M.ago(Date.now() - 7200_000), '2시간 전', '시간'); eq(M.ago('이상한 글자'), '', '파싱 실패');
  eq(M.enabledWord(true) + M.enabledWord(false) + M.enabledWord(null), '켜짐꺼짐-', '켜짐 글자');
});

await check('(M-9) 단축키 키 검증: 허용한 형식만 받고, 터미널·운영체제와 겹치는 조합과 이상한 글자는 거절한다', () => {
  const good = { 'Ctrl+Shift+M': 'ctrl-shift-m', 'shift-ctrl-k': 'ctrl-shift-k', 'ALT-J': 'alt-j', 'ctrl-shift-f5': 'ctrl-shift-f5', 'ctrl-1': 'ctrl-1', 'alt-shift-left': 'alt-shift-left', 'ctrl-shift-pagedown': 'ctrl-shift-pagedown', '  ctrl-shift-m \n': 'ctrl-shift-m' };   // 입력 끝의 공백·줄바꿈은 제거되고 결과에는 남지 않는다
  for (const [k, want] of Object.entries(good)) { const r = M.normalizeKey(k); ok(r.ok && r.key === want, `${k} → ${JSON.stringify(r)}`); }
  const bad = ['', 'm', 'ctrl-m', 'shift-m', 'shift-space', 'ctrl-alt-m', 'alt-f4', 'alt-space', 'alt-tab', 'ctrl-shift-escape', 'ctrl-shift--', 'ctrl-shift-;', 'ctrl-shift-m"', 'ctrl-shift-m\nx', 'cmd-m', 'win-m', 'ctrl-ctrl-m', 'ctrl--m', 'ctrl-shift-mm', 'ctrl-shift-f13', 'ctrl-shift-m, "x": "y"'];
  for (const k of bad) ok(!M.normalizeKey(k).ok, `거절되어야 함: ${JSON.stringify(k)}`);
  for (const k of ['ctrl-shift-m', 'alt-1']) ok(M.normalizeKey(M.keyLabel(k)).key === k, `라벨 왕복: ${k}`);
  eq(M.keyLabel('ctrl-shift-m'), 'Ctrl+Shift+M', '라벨'); eq(M.keyLabel('alt-pagedown'), 'Alt+Pagedown', '라벨2');
  eq(M.composeKey({ ctrl: true, shift: true }, ' M ').key, 'ctrl-shift-m', '버튼+입력칸'); ok(!M.composeKey({}, 'm').ok, '조합 키 없음'); ok(!M.composeKey({ ctrl: true, alt: true }, 'm').ok, 'ctrl+alt');
});

const REAL_KEYS = join(process.env.USERPROFILE || tmpdir(), '.config', 'herdr-app', 'keys.json');
const SAMPLE = (indent = '    ', nl = '\n', extraGlobal = '') => ['{', `  "global": {`, extraGlobal, `${indent}"ctrl-shift-r": "mod.open:session-keeper",`, `${indent}"alt-1": "space.select:1",`, `${indent}"ctrl-shift-k": "mod.open:picker"`, '  },', '  "terminal": {', `${indent}"ctrl-shift-c": "terminal.copy"`, '  }', '}', ''].filter((l) => l !== '').join(nl) + nl;
const OWN = 'mod.open:orch-manager';
await check('(M-10) keys.json 수정 계산: 우리 줄만 넣고·바꾸고·지우며 나머지는 한 바이트도 안 바뀐다(들여쓰기·CRLF 유지, 반복해도 같음)', () => {
  const src = SAMPLE(); const j0 = JSON.parse(src);
  const a = M.planKeysText(src, 'ctrl-shift-m'); ok(a.ok && a.changed && a.added && a.removed === 0, JSON.stringify(a));
  const ja = JSON.parse(a.text); eq(Object.keys(ja.global)[0], 'ctrl-shift-m', '맨 앞'); eq(ja.global['ctrl-shift-m'], OWN, '동작');
  eq(a.text.replace(/\n    "ctrl-shift-m": "mod\.open:orch-manager",/, ''), src, '우리 줄을 빼면 원본과 바이트 동일');
  eq(M.planKeysText(a.text, 'ctrl-shift-m').changed, false, '같은 키로 다시 하면 변화 없음');
  const b = M.planKeysText(a.text, 'alt-j'); ok(b.ok && b.removed === 1, JSON.stringify(b)); const jb = JSON.parse(b.text);
  ok(!('ctrl-shift-m' in jb.global) && jb.global['alt-j'] === OWN, '키 교체'); eq(Object.keys(jb.global).filter((k) => jb.global[k] === OWN).length, 1, '우리 줄은 항상 1개');
  const c = M.planKeysText(b.text, null); ok(c.ok && c.changed && !c.added, JSON.stringify(c)); eq(JSON.stringify(JSON.parse(c.text)), JSON.stringify(j0), '해제하면 처음 내용과 의미가 같음'); eq(c.text, src, '해제하면 바이트까지 처음과 같음');
  eq(M.planKeysText(src, null).changed, false, '없는데 해제 = 변화 없음');
  // CRLF·다른 들여쓰기
  const crlf = SAMPLE('  ', '\r\n'); const d = M.planKeysText(crlf, 'ctrl-shift-m'); ok(d.ok && d.text.includes('\r\n  "ctrl-shift-m"') && !/[^\r]\n/.test(d.text), 'CRLF·들여쓰기 유지');
  eq(M.planKeysText(d.text, null).text, crlf, 'CRLF 해제하면 바이트 동일');
});

await check('(M-11) keys.json 수정 계산의 안전장치: 이상한 파일·구역 없음·마지막 줄이 우리 줄·여러 줄 항목·한 줄짜리 구역도 JSON 을 깨지 않거나 거절한다', () => {
  ok(!M.planKeysText('{ 깨진', 'alt-j').ok, '깨진 JSON'); ok(!M.planKeysText('{"terminal": {}}', 'alt-j').ok, 'global 없음'); ok(!M.planKeysText('[]', 'alt-j').ok, '배열');
  ok(!M.planKeysText(SAMPLE(), 'ctrl-m').ok, '잘못된 키는 계산 전에 거절'); ok(!M.planKeysText(SAMPLE(), 'alt-j", "x": "y').ok, '따옴표 주입 거절');
  // 우리 줄이 마지막 항목일 때(해제하면 앞 줄의 쉼표를 정리해야 함)
  const last = '{\n  "global": {\n    "alt-1": "space.select:1",\n    "alt-j": "mod.open:orch-manager"\n  }\n}\n';
  const r1 = M.planKeysText(last, null); ok(r1.ok && JSON.parse(r1.text).global['alt-1'] === 'space.select:1' && !('alt-j' in JSON.parse(r1.text).global), r1.error || r1.text);
  // 우리 줄만 있는 구역을 해제 → 빈 구역, 다시 넣기
  const only = '{\n  "global": {\n    "alt-j": "mod.open:orch-manager"\n  }\n}\n'; const r2 = M.planKeysText(only, null); ok(r2.ok && Object.keys(JSON.parse(r2.text).global).length === 0, r2.error); const r3 = M.planKeysText(r2.text, 'alt-k'); ok(r3.ok && JSON.parse(r3.text).global['alt-k'] === OWN, r3.error || r3.text);
  // 빈 구역 / 한 줄짜리 구역은 줄 단위로 안전하게 처리하지 못하면 거절(조용히 깨지지 않음)
  const empty = M.planKeysText('{"global": {}}', 'alt-j'); ok(!empty.ok || JSON.parse(empty.text).global['alt-j'] === OWN, '빈 구역');
  const oneLine = M.planKeysText('{"global": {"alt-1": "x"}, "terminal": {}}', 'alt-j'); ok(!oneLine.ok || (JSON.parse(oneLine.text).global['alt-j'] === OWN && JSON.parse(oneLine.text).global['alt-1'] === 'x'), '한 줄 구역');
  // 여러 줄로 쓴 항목(객체 값)이 있어도 그대로
  const multi = '{\n  "global": {\n    "ctrl-shift-r": {\n      "command": "layout.resize",\n      "args": { "id": "sidebar", "px": 240 }\n    },\n    "alt-1": "space.select:1"\n  }\n}\n';
  const m1 = M.planKeysText(multi, 'alt-j'); ok(m1.ok, m1.error); const jm = JSON.parse(m1.text); eq(jm.global['ctrl-shift-r'].args.px, 240, '여러 줄 항목 보존'); eq(M.planKeysText(m1.text, null).text, multi, '여러 줄 항목 파일도 해제하면 바이트 동일');
  // 여러 줄 항목 "안쪽"에 우리 동작 문자열과 똑같은 줄이 있어도(최상위 항목이 아님) 그 줄을 지워 버리면 안 된다 → 최종 검사가 거절해야 한다
  const nested = '{\n  "global": {\n    "ctrl-shift-r": {\n      "command": "x",\n      "args": {\n        "note": "mod.open:orch-manager"\n      }\n    },\n    "alt-1": "space.select:1"\n  }\n}\n';
  const n1 = M.planKeysText(nested, 'alt-j'); ok(!n1.ok, '안쪽 줄을 지우는 수정은 거절되어야 함: ' + (n1.text || ''));
  ok(!M.planKeysText(nested, null).ok || JSON.parse(M.planKeysText(nested, null).text).global['ctrl-shift-r'].args.note === 'mod.open:orch-manager', '해제도 안쪽 줄을 지우면 안 됨');
  // 이상한 글자는 "형식" 안내 문구로 거절(뒤쪽 검사가 어차피 거절하더라도 사용자에게 보이는 이유가 맞아야 함)
  ok(/영문·숫자·방향키·F키만/.test(M.normalizeKey('ctrl-shift-;').error) && /영문·숫자·방향키·F키만/.test(M.normalizeKey('ctrl-shift-m"').error), '형식 안내 문구');
  // 다른 구역에 같은 동작이 있어도 건드리지 않음
  const other = '{\n  "global": {\n    "alt-1": "space.select:1"\n  },\n  "terminal": {\n    "alt-9": "mod.open:orch-manager"\n  }\n}\n'; const o1 = M.planKeysText(other, 'alt-j'); ok(o1.ok && JSON.parse(o1.text).terminal['alt-9'] === OWN, '다른 구역 보존');
  // 문자열 안의 중괄호·"global" 글자
  const tricky = '{\n  "global": {\n    "alt-1": "send:}{\\"global\\": {"\n  }\n}\n'; const t1 = M.planKeysText(tricky, 'alt-j'); ok(t1.ok && JSON.parse(t1.text).global['alt-1'] === 'send:}{"global": {', t1.error || t1.text);
});

await check('(M-12) 충돌 검사: 모든 구역을 보고(global 만 보면 안 됨), 이 모드의 자기 줄은 충돌로 보지 않으며, 쓴 결과 확인(verify)은 정확히 1개일 때만 통과한다', () => {
  const b = [{ section: 'global', keys: 'ctrl-shift-r', action: 'mod.open:session-keeper' }, { section: 'terminal', keys: 'alt-j', action: 'terminal' }, { section: 'layout:terminals', keys: 'ctrl-shift-y', action: 'x' }, { section: 'mod:editor', keys: 'ctrl-s', action: 'editor.save' }, { section: 'global', keys: 'ctrl-shift-m', action: OWN }];
  eq(M.findKeyConflict(b, 'alt-j'), { section: 'terminal', action: 'terminal' }, 'terminal 구역 충돌');
  eq(M.findKeyConflict(b, 'ctrl-shift-y').section, 'layout:terminals', 'layout 구역 충돌'); eq(M.findKeyConflict(b, 'ctrl-shift-r').action, 'mod.open:session-keeper', 'global 충돌');
  eq(M.findKeyConflict(b, 'ctrl-shift-m'), null, '자기 줄은 충돌 아님'); eq(M.findKeyConflict(b, 'alt-k'), null, '빈 키'); eq(M.findKeyConflict(b, 'Shift-Ctrl-R').section, 'global', '다른 표기도 같은 키로 봄'); eq(M.findKeyConflict(null, 'alt-k'), null, 'null');
  eq(M.ownKeys(b), [{ section: 'global', keys: 'ctrl-shift-m' }], '내 줄 찾기');
  ok(M.verifyKeysText('{"global":{"alt-j":"mod.open:orch-manager"}}', 'alt-j'), '정확히 1개'); ok(!M.verifyKeysText('{"global":{"alt-j":"mod.open:orch-manager","alt-k":"mod.open:orch-manager"}}', 'alt-j'), '2개면 불통과');
  ok(!M.verifyKeysText('{"global":{}}', 'alt-j'), '없으면 불통과'); ok(M.verifyKeysText('{"global":{}}', null), '해제 확인'); ok(!M.verifyKeysText('깨짐', null), '깨진 글자');
});

await check('(M-13) 이 PC 의 실제 keys.json 내용으로 계산(메모리에서만, 파일은 쓰지 않음): 넣고 빼면 바이트 동일, 이미 쓰는 키는 충돌로 잡힌다', () => {
  if (!existsSync(REAL_KEYS)) return;
  const raw = readFileSync(REAL_KEYS, 'utf8'); const j = JSON.parse(raw);
  const taken = Object.keys(j.global).find((k) => M.normalizeKey(k).ok && !Object.keys(j.global).filter((x) => j.global[x] === OWN).includes(k));
  ok(!taken || M.findKeyConflict(Object.entries(j.global).map(([k, v]) => ({ section: 'global', keys: k, action: typeof v === 'string' ? v : 'obj' })), taken) !== null, '실제 파일의 키가 충돌로 잡히지 않음');
  const own = Object.keys(j.global).find((k) => j.global[k] === OWN);          // 이미 설치되어 있으면 그 키
  const free = ['alt-shift-y', 'ctrl-shift-y', 'alt-y', 'alt-shift-u'].find((k) => !(k in j.global) && !(k in (j.terminal || {})));
  const a = M.planKeysText(raw, free); ok(a.ok && a.changed, a.error || '변화 없음'); ok(M.verifyKeysText(a.text, free), '바뀐 결과 확인');
  const other = (o, p) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !p(k))));
  eq(other(JSON.parse(a.text).global, (k) => k === free), other(j.global, (k) => j.global[k] === OWN), '우리 줄 말고 global 의 나머지는 같음');
  eq(JSON.stringify(JSON.parse(a.text).terminal ?? null), JSON.stringify(j.terminal ?? null), 'terminal 구역은 그대로');
  if (own && Object.keys(j.global)[0] === own) {                                // 우리 줄이 맨 앞에 있는 파일이면: 바꿨다가 원래 키로 되돌리면 바이트 동일
    eq(M.planKeysText(raw, own).changed, false, '같은 키로 다시 해도 변화 없음'); eq(M.planKeysText(a.text, own).text, raw, '바꿨다 되돌리면 실제 파일과 바이트 동일');
  }
});

// 허더의 readTextFile/writeTextFile 과 같은 규칙의 가짜 파일 시스템(expected 가 null 이면 새 파일만, 아니면 지금 내용이 같을 때만 쓴다)
function fakeFs(files, hooks = {}) {
  const fs = new Map(Object.entries(files)); const calls = [];
  return {
    fs, calls,
    read: async (p) => { calls.push(['read', p]); return hooks.read ? hooks.read(fs, p) : (fs.has(p) ? fs.get(p) : null); },
    write: async (p, text, expected) => {
      calls.push(['write', p]);
      if (hooks.write) { const r = hooks.write(fs, p, text, expected); if (r === 'skip') return null; }
      if (expected === null) { if (fs.has(p)) throw new Error('이미 있는 파일'); fs.set(p, text); return null; }
      if (!fs.has(p) || fs.get(p) !== expected) throw new Error('읽은 뒤에 파일이 바뀌었습니다(stale)');
      fs.set(p, text); return null;
    },
  };
}
const KP = 'C:/h/keys.json';
await check('(M-14) 단축키 변경 순서(가짜 입출력): 백업 → 쓰기 → 다시 읽어 확인, 바뀔 때만 쓰고, 어떤 실패에서도 keys.json 은 원래 내용이다', async () => {
  const src = SAMPLE(); const run = (f, newKey, stamp = '20261115100000') => M.applyKeysChange({ read: f.read, write: f.write, path: KP, newKey, stamp });
  // 성공
  let f = fakeFs({ [KP]: src }); let r = await run(f, 'alt-j'); ok(r.ok && r.changed && r.bak === `${KP}.bak-orch-key-20261115100000`, JSON.stringify(r));
  eq(f.fs.get(r.bak), src, '백업은 원래 내용'); ok(M.verifyKeysText(f.fs.get(KP), 'alt-j'), '반영됨'); ok(/Alt\+J/.test(r.msg) && /백업/.test(r.msg), r.msg);
  eq(f.calls.filter((c) => c[0] === 'write').map((c) => c[1]), [r.bak, KP], '쓰기 순서: 백업이 먼저');
  // 바뀔 것이 없으면 아무것도 쓰지 않음
  f = fakeFs({ [KP]: src }); r = await run(f, null); ok(r.ok && !r.changed && f.calls.every((c) => c[0] === 'read'), '변화 없음 = 쓰기 없음');
  // 해제
  f = fakeFs({ [KP]: M.planKeysText(src, 'alt-j').text }); r = await run(f, null); ok(r.ok && r.changed && M.verifyKeysText(f.fs.get(KP), null) && /해제/.test(r.msg), JSON.stringify(r)); eq(f.fs.get(KP), src, '해제하면 처음과 동일');
  // keys.json 없음 / 깨짐 / global 없음: 아무것도 쓰지 않음
  for (const [name, content] of [['없음', undefined], ['깨짐', '{ 깨진'], ['구역 없음', '{"terminal":{}}']]) {
    f = fakeFs(content === undefined ? {} : { [KP]: content }); r = await run(f, 'alt-j'); ok(!r.ok && !f.calls.some((c) => c[0] === 'write'), `${name}: ${JSON.stringify(r)}`);
  }
  // 잘못된 키: 읽기 전에 거절은 아니어도 쓰기는 없음
  f = fakeFs({ [KP]: src }); r = await run(f, 'ctrl-m'); ok(!r.ok && !f.calls.some((c) => c[0] === 'write') && f.fs.get(KP) === src, JSON.stringify(r));
  // 읽은 뒤 다른 곳에서 파일이 바뀜(stale): 쓰기가 거절되고 keys.json 은 그 다른 곳의 내용 그대로(우리가 덮어쓰지 않음)
  const other = src.replace('alt-1', 'alt-2');
  f = fakeFs({ [KP]: src }, { write: (fs, p, _t, expected) => { if (p === KP && expected !== null) fs.set(KP, other); } }); r = await run(f, 'alt-j');
  ok(!r.ok && f.fs.get(KP) === other && /stale|바뀌었/.test(r.msg + ''), `stale: ${JSON.stringify(r)} ${f.fs.get(KP) === other}`);
  // 백업 이름이 이미 있음: keys.json 은 건드리지 않음
  f = fakeFs({ [KP]: src, [`${KP}.bak-orch-key-20261115100000`]: '이미 있음' }); r = await run(f, 'alt-j'); ok(!r.ok && f.fs.get(KP) === src, JSON.stringify(r));
  // 쓴 결과가 다르게 저장됨(확인 실패) → 원래대로 되돌림
  f = fakeFs({ [KP]: src }, { write: (fs, p, t, expected) => { if (p === KP && expected !== null && t !== src) { fs.set(KP, t + ' '); return 'skip'; } } }); r = await run(f, 'alt-j');
  ok(!r.ok && /되돌렸/.test(r.msg) && f.fs.get(KP) === src, `확인 실패: ${JSON.stringify(r)} / ${f.fs.get(KP) === src}`);
  // 되돌리기마저 실패하면 백업 위치를 알려 준다
  let writes = 0; f = fakeFs({ [KP]: src }, { write: (fs, p, t, expected) => { if (p === KP && expected !== null) { writes++; if (writes === 1) { fs.set(KP, t + ' '); return 'skip'; } throw new Error('디스크 오류'); } } }); r = await run(f, 'alt-j');
  ok(!r.ok && /되돌리지 못했습니다/.test(r.msg) && r.msg.includes(`${KP}.bak-orch-key-`), JSON.stringify(r)); eq(f.fs.get(`${KP}.bak-orch-key-20261115100000`), src, '백업은 남아 있음');
  // 입출력 함수가 예외를 던져도 예외가 밖으로 나가지 않음
  r = await M.applyKeysChange({ read: async () => { throw new Error('읽기 오류'); }, write: async () => {}, path: KP, newKey: 'alt-j', stamp: 'x' }); ok(!r.ok && /읽기 오류/.test(r.msg), JSON.stringify(r));
});

await check('(M-15) 화면 라벨·상태: 영어 값은 한국어+괄호, 실제 창 상태 글자·색, 요약 칩 순서(승인 대기 먼저), 탭 주의 표시는 문제가 있을 때만', () => {
  eq(M.modeLabel('read-only'), '읽기 전용 (read-only)', '모드 라벨'); eq(M.cadenceLabel('periodic'), '주기적 (periodic)', '주기 라벨'); eq(M.modeLabel('이상한값'), '이상한값', '모르는 값은 그대로');
  for (const m of M.MODES) ok(M.MODE_LABEL[m] && M.MODE_HINT[m], `모드 ${m} 라벨/도움말 빠짐`); for (const c of M.CADENCES) ok(M.CADENCE_LABEL[c] && M.CADENCE_HINT[c], `주기 ${c} 라벨/도움말 빠짐`);
  for (const s of ['portable', 'full']) ok(M.SCOPE_LABEL[s] && M.SCOPE_HINT[s], `범위 ${s}`); for (const m of ['merge', 'replace']) ok(M.IMPORT_MODE_LABEL[m] && M.IMPORT_MODE_HINT[m], `방식 ${m}`);
  eq(M.toneWord('ok'), '정상', 'ok'); eq(M.toneWord('warn'), '확인 필요', 'warn'); eq(M.toneWord('bad'), '오류', 'bad'); eq(M.toneWord(''), '', '없음'); eq(M.toneWord(undefined), '', 'undefined');
  eq(M.liveStatus('working'), { word: '작업 중', tone: 'info' }, '작업 중'); eq(M.liveStatus('BLOCKED'), { word: '승인 대기', tone: 'warn' }, '대소문자 무시'); eq(M.liveStatus('?').word, '확인 불가', '?'); eq(M.liveStatus(null).word, '확인 불가', 'null'); eq(M.liveStatus('이상한상태').word, '이상한상태', '모르는 상태는 글자 그대로');
  const chips = M.summarizeLive({ idle: 17, working: 3, blocked: 2, '?': 4, done: 7 }); eq(chips.map((c) => c.key), ['blocked', 'working', 'idle', 'done', 'other'], '주의가 필요한 것 먼저'); eq(chips[4], { key: 'other', label: '확인 불가 4', tone: 'muted', count: 4 }, '기타 합산');
  eq(M.summarizeLive({ idle: 0 }), [], '0개는 칩이 없음'); eq(M.summarizeLive(null), [], 'null');
  eq(M.tabBadges({ ok: true, config: { valid: true, unset: [] }, generated: { state: 'fresh' }, roles: [] }, { available: true, counts: {} }), {}, '문제 없으면 표시 없음');
  eq(M.tabBadges({ ok: true, config: { valid: true }, generated: { state: 'stale' }, roles: [] }, null).status, { text: '●', tone: 'warn' }, '생성물이 낡음');
  eq(M.tabBadges({ ok: true, config: { valid: false }, roles: [] }, null).status.tone, 'bad', '설정 오류'); eq(M.tabBadges({ ok: true, config: { valid: true }, roles: [{ errors: ['x'] }] }, null).status.tone, 'bad', '역할 오류'); eq(M.tabBadges({ ok: false }, null).status.tone, 'bad', 'status 실패');
  eq(M.tabBadges(null, { available: true, counts: { blocked: 3 } }).live, { text: '3', tone: 'warn' }, '승인 대기 개수'); eq(M.tabBadges(null, { available: false }), {}, '조회 불가면 표시 없음');
  // 엔진의 실제 응답으로: 새 설정 폴더는 "아직 생성물 없음"
  const home = mkHome(); const st = engine(home, 'status'); const bd = M.tabBadges(st, null); ok(!bd.status || ['warn', 'bad'].includes(bd.status.tone), JSON.stringify(bd));
});

await check('(M-8) 끝난 뒤: 이 PC의 실제 설정은 바이트 동일', () => {
  eq(treeHash(REAL), realBefore, '실제 설정 폴더');
});

console.log(`\n시험 폴더(지우지 않음): ${BASE}`);
console.log(`PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
