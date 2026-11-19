#!/usr/bin/env node
// 실행: node tests/manage.test.mjs   (성공 시 종료코드 0, 외부 패키지 없음)
// bin/manage-lib.mjs · bin/manage.mjs (관리 도구 엔진: 현황·역할 편집·내보내기/불러오기·백업/복구)를 시험한다.
// 표시 (R#) 는 02_관리도구-설계서.md 6장 위험 표의 번호다. 모든 시험은 임시 폴더만 쓰고, 이 PC의 실제 설정은 전후 해시로 불변을 확인한다.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, symlinkSync, utimesSync, lstatSync, unlinkSync as require_unlink } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { makeCtx, status, roleList, roleSet, roleNew, roleRevert, roleDelete, exportPackage, readPackage, planImport, applyImport, planRestore, applyRestore, backupNow, listBackups, commitChanges, collectUserFiles, runSync, serializeRole, LIMITS, PATH_RE } from '../bin/manage-lib.mjs';
import { defaultConfig } from '../bin/sync-lib.mjs';
import { liveWindows } from '../bin/manage-live.mjs';
import { roleCheck, roleWindowSet, roleWindowClear, roleWindowSeed } from '../bin/manage-check.mjs';
import { makeWatcher } from '../bin/role-watch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0, skip = 0;
async function check(name, fn) {
  try { const r = await fn(); if (r && r.skip) { skip++; console.log(`SKIP  ${name} - ${r.skip}`); return; } pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}: 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const rnd = (n) => Array.from({ length: n }, () => ALNUM[Math.floor(Math.random() * ALNUM.length)]).join('');
const BASE = join(tmpdir(), `orch-test-${rnd(6)}`);
mkdirSync(BASE, { recursive: true });

function treeHash(dir) {
  if (!existsSync(dir)) return 'none';
  const h = createHash('sha256');
  const walk = (d) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); const s = lstatSync(p); if (s.isDirectory()) walk(p); else h.update(p + ':' + sha(readFileSync(p))); } };
  walk(dir); return h.digest('hex');
}
const REAL = join(process.env.LOCALAPPDATA ?? tmpdir(), 'Herdr-Orchestration');
const realBefore = treeHash(REAL);
const scratchCount = () => readdirSync(tmpdir()).filter((n) => n.startsWith('orch-manage-')).length;
const scratchBefore = scratchCount();
const bundleBefore = treeHash(join(ROOT, 'roles')) + treeHash(join(ROOT, 'templates')) + treeHash(join(ROOT, 'schema'));

let n = 0;
function mkHome({ seed = false } = {}) {
  const home = join(BASE, `h${++n}`); mkdirSync(join(home, 'config'), { recursive: true });
  const c = defaultConfig({ orchHome: home, functionsDir: join(ROOT, 'functions') });
  c.scope_prefix = 'T /'; c.projects_root = join(BASE, 'projects') + '\\'; c.control_dir = join(BASE, 'control');
  writeFileSync(join(home, 'config', 'orchestration.json'), JSON.stringify(c, null, 2));
  const ctx = makeCtx({ env: { ...process.env, ORCH_HOME: home } });
  if (seed) doSeed(ctx);
  return ctx;
}
const put = (ctx, rel, text) => { const f = join(ctx.paths.home, ...rel.split('/')); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
const read = (ctx, rel) => readFileSync(join(ctx.paths.home, ...rel.split('/')), 'utf8');
const has = (ctx, rel) => existsSync(join(ctx.paths.home, ...rel.split('/')));
const NEWROLE = (id, slot, extra = '') => `---\nid: ${id}\nname: "${id} 역할"\nsummary: "시험용 역할"\nslot: ${slot}\nkind: worker\nmode: read-only\nwrites_to: []\nreports_to: commander\ncadence: on-request\nenabled: true\nreplaces: []\nneeds: []\nversion: 1\n---\n${id} 본문입니다. {commander}에게 보고한다.${extra}\n`;
function doSeed(ctx) {
  put(ctx, 'config/roles/my-extra.md', NEWROLE('my-extra', 11));
  put(ctx, 'config/roles/approval-proxy.md', '---\nenabled: true\n---\n');
  put(ctx, 'config/env-rules.md', '# 이 PC 규칙\n공백 있는 경로에는 쓰지 않는다\n');
  put(ctx, 'config/ignore.txt', 't9\n');
  put(ctx, 'config/order.txt', 'a\nb\n');
}
const userSnapshot = (ctx) => Object.fromEntries([...collectUserFiles(ctx).files].map(([k, v]) => [k, sha(v)]));
// 직접 만든 묶음(변조 시험용)
function craft(name, files, over = {}) {
  const dir = join(BASE, `pkg-${name}-${++n}`); mkdirSync(dir, { recursive: true });
  const list = [];
  for (const f of files) {
    const buf = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
    if (!f.skipWrite) { const full = join(dir, ...f.path.split('/')); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, buf); }
    list.push({ path: f.path, sha256: f.sha ?? sha(buf), bytes: f.bytes ?? buf.length });
  }
  const manifest = { format: 1, kit: 'herdr-orchestration', version: '0.1.0', createdAt: new Date().toISOString(), kind: 'export', scope: 'portable', note: '', files: list, ...over };
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  return dir;
}
const errs = (r) => (r.errors ?? []).join(' | ');

// ======================= 현황 · 번들 불변 =======================
await check('(E-1) 현황: 역할 12개·설정 값·생성물 상태(없음 → 최신 → 역할을 고치면 낡음) · 백업 수', () => {
  const ctx = mkHome();
  let s = status(ctx);
  ok(s.ok && s.roles.length === 12, `역할 수 ${s.roles?.length}`);
  ok(s.config.valid && s.config.unset.length === 0, `설정 ${JSON.stringify(s.config)}`);
  eq(s.generated.state, 'none', '처음 생성물');
  eq(s.backups.count, 0, '처음 백업');
  const out = join(BASE, 'gen-e1');
  const r = runSync(ctx, { out }); ok(r.ok, `sync ${r.stderr}`);
  s = status(ctx, { generated: out }); eq(s.generated.state, 'fresh', 'sync 직후');
  ok(s.layout.length === 4 && s.layout.some((t) => t.name === 'CT-CC-Master'), `탭 배치 ${JSON.stringify(s.layout?.map((t) => t.name))}`);
  const e = roleSet(ctx, 'verifier', { name: '검증관 B' }); ok(e.ok, errs(e));
  s = status(ctx, { generated: out }); eq(s.generated.state, 'stale', '고친 뒤'); ok(s.generated.changed.includes('역할표.md'), '낡은 파일 목록');
  eq(s.backups.count, 1, '자동 백업 1개');
});
await check('(E-1b) 설정에 미설정 값이 있으면 현황이 알려 주고, 설정이 깨졌으면 생성물 상태는 계산하지 않는다', () => {
  const ctx = mkHome();
  const c = JSON.parse(read(ctx, 'config/orchestration.json')); c.scope_prefix = '(미설정)'; put(ctx, 'config/orchestration.json', JSON.stringify(c));
  eq(status(ctx).config.unset, ['scope_prefix'], '미설정 목록');
  put(ctx, 'config/orchestration.json', '{ 깨짐');
  const s = status(ctx); ok(!s.config.valid && s.generated.state === 'unknown', `깨진 설정: ${JSON.stringify(s.generated)}`);
});

// ======================= 역할 편집 (E) =======================
await check('(E-2) 번들 역할 끄기: 덮어쓰기 파일에 enabled 한 줄만, 같은 값이면 파일이 사라짐(번들 복귀) (R12)', () => {
  const ctx = mkHome();
  const r = roleSet(ctx, 'verifier', { enabled: false }); ok(r.ok, errs(r));
  eq(read(ctx, 'config/roles/verifier.md'), '---\nenabled: false\n---\n', '덮어쓰기 파일');
  const l = roleList(ctx).roles.find((x) => x.id === 'verifier'); ok(l.source === 'override' && l.meta.enabled === false && l.overridden.includes('enabled'), JSON.stringify(l.overridden));
  const r2 = roleSet(ctx, 'verifier', { enabled: true }); ok(r2.ok, errs(r2));
  ok(!has(ctx, 'config/roles/verifier.md'), '번들과 같아졌는데 덮어쓰기 파일이 남음');
});
await check('(E-3) 번들 역할의 이름·하는 일·본문 수정: 바꾼 것만 적고, 본문이 번들과 같으면 본문을 적지 않음', () => {
  const ctx = mkHome();
  const r = roleSet(ctx, 'verifier', { name: '검증관 B', summary: '새 설명' }); ok(r.ok, errs(r));
  const t = read(ctx, 'config/roles/verifier.md'); ok(t.includes('name: "검증관 B"') && t.includes('summary: "새 설명"') && !/slot:|kind:/.test(t), t);
  const body = loadBundleBody('verifier');
  const r2 = roleSet(ctx, 'verifier', {}, { body: '바꾼 본문입니다. {commander}에게 보고한다.' }); ok(r2.ok, errs(r2));
  ok(read(ctx, 'config/roles/verifier.md').includes('바꾼 본문입니다'), '본문 반영');
  const r3 = roleSet(ctx, 'verifier', {}, { body }); ok(r3.ok, errs(r3));
  ok(!read(ctx, 'config/roles/verifier.md').includes('바꾼 본문'), '번들 본문으로 되돌렸는데 남음');
});
function loadBundleBody(id) { const t = readFileSync(join(ROOT, 'roles', `${id}.md`), 'utf8').replace(/\r\n/g, '\n'); return t.split('\n---\n')[1].replace(/^\n+/, '').replace(/\s+$/, ''); }
await check('(E-4) 새 역할 만들기: 빈 자리 자동 배정·역할표 반영 / 복사해 만들기는 replaces 비움 / 중복 id·잘못된 id·바꿀 수 없는 항목 거절', () => {
  const ctx = mkHome();
  const a = roleNew(ctx, { id: 'qa-helper', fields: { name: '시험 도우미' } }); ok(a.ok, errs(a));
  const l = roleList(ctx).roles.find((x) => x.id === 'qa-helper'); ok(l && l.source === 'user' && l.meta.slot === 11 && l.meta.enabled === true, JSON.stringify(l?.meta));
  const b = roleNew(ctx, { id: 'verifier-2', from: 'verifier' }); ok(b.ok, errs(b));
  const m = roleList(ctx).roles.find((x) => x.id === 'verifier-2').meta; eq(m.replaces, [], '복사본 replaces'); eq(m.slot, 12, '복사본 자리');
  ok(!roleNew(ctx, { id: 'verifier' }).ok, '번들과 같은 id 허용됨');
  ok(!roleNew(ctx, { id: 'Bad_ID' }).ok, '잘못된 id 허용됨');
  ok(/바꿀 수 없는 항목/.test(errs(roleNew(ctx, { id: 'x-role', fields: { id: 'y' } }))), 'id 변경 허용됨');
  ok(/worker 역할만/.test(errs(roleNew(ctx, { id: 'cmd-2', from: 'commander' }))), '총지휘 복사 허용됨');
  const s = status(ctx); ok(s.roles.length === 14, `역할 수 ${s.roles.length}`);
});
await check('(E-5) 무효한 결과는 아무것도 쓰지 않고 백업도 만들지 않는다: 자리 충돌·모르는 변수·mode/writes_to 모순 (R7)', () => {
  const ctx = mkHome();
  const snap = userSnapshot(ctx);
  const a = roleNew(ctx, { id: 'collide', fields: { slot: 1 } }); ok(!a.ok && /slot/.test(errs(a)), errs(a));
  const b = roleNew(ctx, { id: 'badvar', body: '모르는 변수 {n:no-such-role} 입니다.' }); ok(!b.ok, '모르는 변수 허용됨');
  const c = roleSet(ctx, 'verifier', { mode: 'scoped-write' }); ok(!c.ok, 'scoped-write + 빈 writes_to 허용됨');
  const d = roleSet(ctx, 'no-such', { enabled: false }); ok(!d.ok, '없는 역할 수정 허용됨');
  eq(userSnapshot(ctx), snap, '내 설정이 바뀜');
  ok(!has(ctx, 'backups') || readdirSync(ctx.backups).length === 0, '실패한 요청이 백업을 만듦');
});
await check('(E-6) 덮어쓰기 되돌리기·새 역할 삭제: 대상이 맞을 때만, 지운 내용은 자동 백업에 남음', () => {
  const ctx = mkHome({ seed: true });
  ok(!roleRevert(ctx, 'my-extra').ok && !roleRevert(ctx, 'verifier').ok, '대상이 아닌 되돌리기 허용됨');
  ok(!roleDelete(ctx, 'verifier').ok && !roleDelete(ctx, 'approval-proxy').ok, '번들 역할 삭제 허용됨');
  const r = roleRevert(ctx, 'approval-proxy'); ok(r.ok, errs(r)); ok(!has(ctx, 'config/roles/approval-proxy.md'), '덮어쓰기 파일이 남음');
  const d = roleDelete(ctx, 'my-extra'); ok(d.ok, errs(d)); ok(!has(ctx, 'config/roles/my-extra.md'), '새 역할 파일이 남음');
  const pk = readPackage(d.backup); ok(pk.ok && pk.files.has('config/roles/my-extra.md'), '지운 역할이 자동 백업에 없음');
});
await check('(E-7) 편집이 번들(roles·templates·schema)을 건드리지 않았다 (R12)', () => {
  eq(treeHash(join(ROOT, 'roles')) + treeHash(join(ROOT, 'templates')) + treeHash(join(ROOT, 'schema')), bundleBefore, '번들 해시');
});
await check('(E-8) 편집 결과가 sync 로 이어진다: 새 역할 카드 생성, 끄면 카드가 사라진다', () => {
  const ctx = mkHome(); const out = join(BASE, 'gen-e8');
  roleNew(ctx, { id: 'qa-helper' }); ok(runSync(ctx, { out }).ok, 'sync');
  ok(existsSync(join(out, 'cards', 'qa-helper.md')), '새 카드 없음');
  roleSet(ctx, 'qa-helper', { enabled: false }); ok(runSync(ctx, { out }).ok, 'sync2');
  ok(!existsSync(join(out, 'cards', 'qa-helper.md')), '끈 역할의 카드가 남음');
});

// ======================= 내보내기 · 묶음 검증 (I) =======================
await check('(I-1) 내보내기 범위: portable 은 역할·환경 규칙·ignore 만(PC 설정 제외), full 은 전부 / 묶음이 다시 읽힘', () => {
  const ctx = mkHome({ seed: true }); const dest = join(BASE, 'exp-i1');
  const p = exportPackage(ctx, { dest, scope: 'portable', note: '시험 묶음' }); ok(p.ok, errs(p));
  const rp = readPackage(p.dir); ok(rp.ok, errs(rp));
  eq([...rp.files.keys()].sort(), ['config/env-rules.md', 'config/ignore.txt', 'config/roles/approval-proxy.md', 'config/roles/my-extra.md'], 'portable 파일');
  eq(rp.manifest.note, '시험 묶음', '메모');
  const f = exportPackage(ctx, { dest, scope: 'full' }); ok(f.ok, errs(f));
  ok(readPackage(f.dir).files.has('config/orchestration.json') && readPackage(f.dir).files.has('config/order.txt'), 'full 에 PC 설정이 없음');
  ok(!exportPackage(ctx, { dest, scope: 'nope' }).ok && !exportPackage(ctx, { dest: '' }).ok, '잘못된 범위·빈 폴더 허용됨');
  const empty = mkHome(); const er = exportPackage(empty, { dest, scope: 'portable' }); ok(!er.ok && /내보낼 파일이 없/.test(errs(er)), '빈 설정을 내보냄');
  ok(p.dir !== f.dir, '같은 초에 만든 두 묶음이 같은 폴더를 씀');
});
await check('(I-2) 변조·손상은 묶음 전체를 거부한다: 내용·크기·삭제·추가·형식·다른 도구 (R3)', () => {
  const ctx = mkHome({ seed: true });
  const mk = () => exportPackage(ctx, { dest: join(BASE, `exp-i2-${++n}`), scope: 'portable' }).dir;
  let d = mk(); writeFileSync(join(d, 'config', 'env-rules.md'), '바꾼 내용'); ok(/기록과 다름|크기가 기록과 다름/.test(errs(readPackage(d))), '내용 변조를 못 잡음');
  d = mk(); writeFileSync(join(d, 'config', 'env-rules.md'), readFileSync(join(d, 'config', 'env-rules.md'), 'utf8').replace('공백', '공뱃')); ok(/내용이 기록과 다름/.test(errs(readPackage(d))), '같은 크기의 변조를 못 잡음(해시)');
  d = mk(); writeFileSync(join(d, 'config', 'roles', 'evil.md'), 'x'); ok(/기록에 없는 파일/.test(errs(readPackage(d))), '끼워 넣은 파일을 못 잡음');
  d = mk(); const m = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')); m.format = 2; writeFileSync(join(d, 'package.json'), JSON.stringify(m)); ok(/모르는 묶음 형식/.test(errs(readPackage(d))), '모르는 형식 허용됨');
  m.format = 1; m.kit = 'other'; writeFileSync(join(d, 'package.json'), JSON.stringify(m)); ok(/다른 도구/.test(errs(readPackage(d))), '다른 도구 묶음 허용됨');
  writeFileSync(join(d, 'package.json'), '{ 깨짐'); ok(!readPackage(d).ok, '깨진 JSON 허용됨');
  d = mk(); writeFileSync(join(d, 'package.json'), '[]'); ok(!readPackage(d).ok, '배열 허용됨');
  ok(!readPackage(join(BASE, 'no-such-dir')).ok && !readPackage(join(BASE, 'h1', 'config', 'orchestration.json')).ok, '없는 폴더·파일 허용됨');
  d = craft('empty', [], {}); ok(readPackage(d).ok, '파일 0개인 묶음은 형식상 유효해야 함');
});
await check('(I-3) 경로 이탈·이상한 경로는 묶음 전체를 거부하고 밖에는 아무것도 만들지 않는다 (R2)', () => {
  const evilNames = ['config/../../outside.txt', '../outside.txt', 'config/roles/../../outside.md', 'C:/outside.md', '/etc/x.md', 'config\\roles\\a.md', 'config/roles/UPPER.md', 'config/roles/a.md/', 'config/roles/CON.md', 'config/roles/x.md\u0000', 'config/state.txt', 'state/generated/x.md', 'roles/verifier.md'];
  for (const p of evilNames) {
    const d = craft('evil', [{ path: p, content: 'x', skipWrite: true }]);
    const r = readPackage(d); ok(!r.ok && /허용되지 않는 경로/.test(errs(r)), `허용됨: ${JSON.stringify(p)} -> ${errs(r)}`);
  }
  ok(!existsSync(join(BASE, 'outside.txt')) && !existsSync(join(BASE, 'outside.md')), '밖에 파일이 생김');
  for (const p of ['config/orchestration.json', 'config/roles/a-b.md']) ok(PATH_RE.test(p), `정상 경로가 거부됨: ${p}`);
  const sc = craft('scope', [{ path: 'config/orchestration.json', content: '{}' }], { scope: 'portable' });
  ok(/범위\(portable\)에 없는 파일/.test(errs(readPackage(sc))), 'portable 묶음에 PC 설정이 숨어 들어옴');
});
await check('(I-4) 링크는 받지 않는다 (R4)', () => {
  const ctx = mkHome({ seed: true });
  const d = exportPackage(ctx, { dest: join(BASE, 'exp-i4'), scope: 'portable' }).dir;
  const target = join(BASE, 'link-target.md'); writeFileSync(target, NEWROLE('linked', 12));
  try { symlinkSync(target, join(d, 'config', 'roles', 'linked.md'), 'file'); } catch { return { skip: '이 PC 계정은 심볼릭 링크를 만들 수 없음(권한)' }; }
  ok(/심볼릭 링크/.test(errs(readPackage(d))), '링크를 받음');
  // 기록(package.json)에 올라 있는 파일이 링크인 경우: 내용 해시가 맞아도 받지 않는다
  const content = NEWROLE('linked-2', 13); const tgt2 = join(BASE, 'link-target-2.md'); writeFileSync(tgt2, content);
  const d2 = craft('linked', [{ path: 'config/roles/linked-2.md', content }]);
  const real = join(d2, 'config', 'roles', 'linked-2.md'); writeFileSync(real, 'tmp'); try { require_unlink(real); symlinkSync(tgt2, real, 'file'); } catch { return; }
  ok(/심볼릭 링크/.test(errs(readPackage(d2))), '기록에 올라 있는 링크 파일을 받음');
  // 내 설정 쪽 링크도 읽지 않는다
  try { symlinkSync(target, join(ctx.paths.roles, 'linked.md'), 'file'); } catch { return; }
  const c = collectUserFiles(ctx); ok(!c.files.has('config/roles/linked.md') && c.skipped.some((s) => /링크/.test(s.reason)), '내 설정의 링크를 읽음');
});
await check('(I-5) 크기·개수 상한 (R5)', () => {
  const big = craft('big', [{ path: 'config/env-rules.md', content: 'x', bytes: LIMITS.maxFileBytes + 1 }]);
  ok(/너무 큼/.test(errs(readPackage(big))), '큰 파일 허용됨');
  const many = []; for (let i = 0; i < LIMITS.maxFiles + 1; i++) many.push({ path: `config/roles/r${String(i).padStart(3, '0')}-x.md`, content: 'x', skipWrite: true });
  ok(/파일이 너무 많음/.test(errs(readPackage(craft('many', many)))), '파일 수 폭탄 허용됨');
});
await check('(I-6) UTF-8 이 아닌 파일이 든 묶음은 거부한다(해시가 맞아도) (R6)', () => {
  const d = craft('cp949', [{ path: 'config/env-rules.md', content: Buffer.from([0xB1, 0xD4, 0xC4, 0xA2, 0x0A]) }]);
  ok(/UTF-8/.test(errs(readPackage(d))), 'CP949 허용됨');
  const ok8 = craft('bom', [{ path: 'config/env-rules.md', content: Buffer.from('\uFEFF규칙\n', 'utf8') }]);
  ok(readPackage(ok8).ok, 'UTF-8 BOM 거부됨');
});

// ======================= 불러오기 (R1, R7, R8) =======================
await check('(I-7) 남의 묶음 불러오기 안전 기본값: 새 역할·달라지는 역할은 꺼진 채, PC 설정·환경 규칙은 받지 않음 (R1)', () => {
  const src = mkHome({ seed: true }); roleSet(src, 'verifier', { name: '검증관 B' });
  const pk = exportPackage(src, { dest: join(BASE, 'exp-i7'), scope: 'full', note: '남의 묶음' }); ok(pk.ok, errs(pk));
  const dst = mkHome();
  const plan = planImport(dst, pk.dir, { mode: 'merge' }); ok(plan.ok, errs(plan));
  const byPath = Object.fromEntries(plan.changes.map((c) => [c.path, c]));
  eq(byPath['config/roles/my-extra.md'].role.enabled, false, '새 역할은 꺼진 채');
  eq(byPath['config/roles/approval-proxy.md'].role.enabled, false, '승인 대행 켜기가 그대로 들어옴');
  ok(plan.skipped.some((s) => s.path === 'config/orchestration.json') && plan.skipped.some((s) => s.path === 'config/order.txt'), 'PC 설정이 건너뛰어지지 않음');
  ok(plan.skipped.some((s) => s.path === 'config/env-rules.md'), '환경 규칙이 건너뛰어지지 않음');
  ok(plan.skipped.some((s) => s.path === 'config/ignore.txt'), '무시 목록(ignore)이 건너뛰어지지 않음(승인 대기 창을 숨길 수 있음)');
  const ap = applyImport(dst, pk.dir, { mode: 'merge' }, { token: plan.token }); ok(ap.ok, errs(ap));
  ok(read(dst, 'config/roles/my-extra.md').includes('enabled: false'), '쓰인 파일이 꺼져 있지 않음');
  ok(!has(dst, 'config/env-rules.md') && !has(dst, 'config/ignore.txt') && JSON.parse(read(dst, 'config/orchestration.json')).scope_prefix === 'T /', '건너뛴 것이 쓰임');
  const st = status(dst); ok(st.roles.find((r) => r.id === 'my-extra').enabled === false && st.roles.find((r) => r.id === 'approval-proxy').enabled === false, '현황에서 켜져 있음');
  // 선택하면 받는다
  const dst2 = mkHome(); const p2 = planImport(dst2, pk.dir, { mode: 'merge', includeEnvRules: true, enableImported: true }); ok(p2.ok, errs(p2));
  ok(p2.changes.find((c) => c.path === 'config/env-rules.md') && p2.changes.find((c) => c.path === 'config/roles/my-extra.md').role.enabled === true, '선택해도 안 들어옴');
});
await check('(I-8) 내 백업 복구(trust)는 그대로 복원하고, 같은 내용은 꺼지지 않는다', () => {
  const ctx = mkHome({ seed: true });
  const b = backupNow(ctx, { note: '기준' }); ok(b.ok && b.files === 6, `백업 파일 수 ${b.files}`);
  const pl = planRestore(ctx, b.dir); ok(pl.ok && pl.noop, `같은 상태 복구가 변경으로 잡힘: ${JSON.stringify(pl.counts)}`);
  const own = exportPackage(ctx, { dest: join(BASE, 'exp-i8'), scope: 'portable' });
  const re = planImport(ctx, own.dir, { mode: 'merge' }); ok(re.ok && re.noop, '내 묶음을 다시 불러오면 변경 없음이어야 함(꺼지면 안 됨)');
});
await check('(I-9) 합친 결과가 무효면 아무것도 쓰지 않는다: 자리 충돌·모르는 변수 (R7)', () => {
  const dst = mkHome(); const snap = userSnapshot(dst);
  const a = craft('collide', [{ path: 'config/roles/collide-x.md', content: NEWROLE('collide-x', 1) }]);
  const pa = planImport(dst, a, { autoSlot: false }); ok(!pa.ok && pa.stage === 'validate' && /slot/.test(errs(pa)), errs(pa));
  const pa2 = planImport(dst, a, {}); ok(pa2.ok && pa2.notes.length === 1, '기본값(자동 배정)에서는 자리 충돌이 풀려야 함');
  const b = craft('badvar', [{ path: 'config/roles/bad-var.md', content: NEWROLE('bad-var', 20, ' {n:no-such-role}') }]);
  ok(!planImport(dst, b, {}).ok, '모르는 변수 허용됨');
  const c = craft('badhead', [{ path: 'config/roles/bad-head.md', content: '머리말 없음\n' }]);
  ok(!planImport(dst, c, {}).ok, '머리말 없는 역할 허용됨');
  eq(userSnapshot(dst), snap, '내 설정이 바뀜');
  ok(!applyImport(dst, a, {}, { token: 'x' }).ok, '무효 계획이 적용됨');
});
await check('(I-10) 미리보기 뒤 파일이 바뀌면 적용을 거부한다: 확인 값 불일치·직접 편집 (R8)', () => {
  const src = mkHome({ seed: true }); const pk = exportPackage(src, { dest: join(BASE, 'exp-i10'), scope: 'portable' });
  const dst = mkHome(); const plan = planImport(dst, pk.dir, {}); ok(plan.ok, errs(plan));
  ok(!applyImport(dst, pk.dir, {}, { token: 'wrong' }).ok && !applyImport(dst, pk.dir, {}, {}).ok, '틀린/없는 확인 값 허용됨');
  put(dst, 'config/roles/my-extra.md', NEWROLE('my-extra', 15));                                   // 미리보기 뒤에 사용자가 직접 편집
  const r = applyImport(dst, pk.dir, {}, { token: plan.token }); ok(!r.ok, '바뀐 뒤 적용됨');
  eq(read(dst, 'config/roles/my-extra.md'), NEWROLE('my-extra', 15), '사용자 편집이 덮임');
  const drift = commitChanges(dst, { put: new Map([['config/roles/my-extra.md', Buffer.from(NEWROLE('my-extra', 16))]]), baseHashes: { 'config/roles/my-extra.md': 'a'.repeat(64) } });
  ok(!drift.ok && /미리보기 뒤에 파일이 바뀌었습니다/.test(errs(drift)), '기준 해시 불일치 허용됨');
});
await check('(I-11) 합치기는 내 다른 역할을 남기고, 교체는 범위 안의 내 파일만 지운다(PC 설정은 지키고, 지운 것은 자동 백업에 남는다)', () => {
  const src = mkHome(); roleNew(src, { id: 'from-src' }); const pk = exportPackage(src, { dest: join(BASE, 'exp-i11'), scope: 'portable' });
  const dst = mkHome({ seed: true });
  const pm = planImport(dst, pk.dir, { mode: 'merge', enableImported: true }); ok(pm.ok, errs(pm));
  eq(pm.notes.map((x) => [x.path, x.from, x.to]), [['config/roles/from-src.md', 11, 12]], '자리 충돌 알림');
  ok(applyImport(dst, pk.dir, { mode: 'merge', enableImported: true }, { token: pm.token }).ok, '합치기 적용');
  ok(has(dst, 'config/roles/my-extra.md') && has(dst, 'config/roles/from-src.md'), '합치기가 내 역할을 지움');
  ok(read(dst, 'config/roles/from-src.md').includes('slot: 12') && read(dst, 'config/roles/my-extra.md').includes('slot: 11'), '자리가 옮겨지지 않았거나 내 역할의 자리가 바뀜');
  const pr = planImport(dst, pk.dir, { mode: 'replace', enableImported: true }); ok(pr.ok, errs(pr));
  const rm = pr.changes.filter((c) => c.action === 'remove').map((c) => c.path).sort();
  eq(rm, ['config/roles/approval-proxy.md', 'config/roles/my-extra.md'], '교체로 지워질 목록(환경 규칙·ignore 는 선택하지 않으면 지키므로 제외)');
  const ar = applyImport(dst, pk.dir, { mode: 'replace', enableImported: true }, { token: pr.token }); ok(ar.ok, errs(ar));
  ok(!has(dst, 'config/roles/my-extra.md') && has(dst, 'config/roles/from-src.md'), '교체 결과');
  ok(has(dst, 'config/orchestration.json') && has(dst, 'config/order.txt') && has(dst, 'config/env-rules.md') && has(dst, 'config/ignore.txt'), 'PC 설정·환경 규칙·ignore 가 지워짐');
  ok(readPackage(ar.backup).files.has('config/roles/my-extra.md'), '지운 역할이 자동 백업에 없음');
});

await check('(I-15) 가져온 새 역할의 자리가 겹치면 빈 자리로 옮긴다(둘이 서로 겹쳐도 각각), 끄면 거절, 번들 덮어쓰기·복구는 건드리지 않는다 (R14)', () => {
  const src = mkHome(); put(src, 'config/roles/zeta-one.md', NEWROLE('zeta-one', 11)); put(src, 'config/roles/zeta-two.md', NEWROLE('zeta-two', 11, ' '));
  put(src, 'config/roles/verifier.md', '---\nname: "검증관 B"\n---\n');
  const pk = exportPackage(src, { dest: join(BASE, 'exp-i15'), scope: 'portable' }); ok(pk.ok, errs(pk));
  const dst = mkHome(); put(dst, 'config/roles/my-extra.md', NEWROLE('my-extra', 11));
  const off = planImport(dst, pk.dir, { autoSlot: false }); ok(!off.ok && /slot/.test(errs(off)), '자동 배정을 껐는데 겹침을 못 잡음: ' + errs(off));
  const on = planImport(dst, pk.dir, {}); ok(on.ok, errs(on));
  eq(on.notes.map((x) => [x.path, x.from, x.to]), [['config/roles/zeta-one.md', 11, 12], ['config/roles/zeta-two.md', 11, 13]], '배정 결과(이름순, 서로 겹치지 않음)');
  ok(!on.notes.some((x) => x.path.includes('verifier')), '번들 덮어쓰기 파일의 자리를 건드림');
  // 번들 역할을 덮어쓰는 파일이 일부러 겹치는 자리를 고르면 몰래 옮기지 않고 검증이 거절한다
  const ov = craft('ovslot', [{ path: 'config/roles/verifier.md', content: '---\nkind: "worker"\nslot: 11\n---\n' }]);
  const po = planImport(dst, ov, {}); ok(!po.ok && /slot/.test(errs(po)) && !(po.notes ?? []).length, '덮어쓰기 파일의 자리가 몰래 옮겨짐: ' + errs(po));
  const ap = applyImport(dst, pk.dir, {}, { token: on.token }); ok(ap.ok, errs(ap));
  const slots = Object.fromEntries(roleList(dst).roles.filter((r) => ['my-extra', 'zeta-one', 'zeta-two'].includes(r.id)).map((r) => [r.id, r.meta.slot]));
  eq(slots, { 'my-extra': 11, 'zeta-one': 12, 'zeta-two': 13 }, '적용 뒤 자리');
  ok(status(dst).ok, '적용 뒤 현황');
  const bk = backupNow(dst, {}); put(dst, 'config/roles/zeta-one.md', NEWROLE('zeta-one', 30));
  const rp = planRestore(dst, bk.dir); ok(rp.ok && rp.notes.length === 0, '복구가 자리를 바꿈');
});

await check('(I-16) 남의 묶음의 무시 목록(ignore)은 기본 차단, 선택해도 넓은 줄(* ? [ ] · 3글자 미만)은 거절, 내 백업 복구는 그대로 (R15 승인 대기 창 숨김)', () => {
  const dst = mkHome(); const snap = userSnapshot(dst);
  const mkIgn = (lines) => craft('ign', [{ path: 'config/ignore.txt', content: lines }]);
  const good = mkIgn('# 주석\nmy-project\n\nother-window\n');
  const p0 = planImport(dst, good, {}); ok(p0.ok && p0.noop && p0.skipped.some((s) => s.path === 'config/ignore.txt'), '기본값에서 ignore 를 받으려 함');
  const p1 = planImport(dst, good, { includeIgnore: true }); ok(p1.ok && !p1.noop && p1.changes[0].action === 'add', errs(p1));
  // 아래 마지막 줄의 4개는 옛 검증기(\\r?\\n 로 나누고 JS trim)가 통과시키던 우회 입력이다: 읽는 쪽 PowerShell 은 단독 CR 을 줄 끝으로 보고 U+0085 를 공백으로 잘라 낸다.
  for (const bad of ['*\n', '?\n', 'a\n', 'ab\n', '[x]ab\n', 'good-one\n*\n', '  *  \n', '/\n', 'ab\rcd\n', 'ab\u0085\n', 'good-one\rxy\n', 'ab\u0000cd\n', 'ab\u200bcd\n', 'ab\u180e\n', '`a`b\n', 'good-one`x\n']) {
    const r = planImport(dst, mkIgn(bad), { includeIgnore: true });
    ok(!r.ok && r.stage === 'validate' && /너무 넓거나/.test(errs(r)), `넓은 줄이 받아짐: ${JSON.stringify(bad)} -> ${errs(r)}`);
  }
  eq(userSnapshot(dst), snap, '내 설정이 바뀜');
  const ap = applyImport(dst, good, { includeIgnore: true }, { token: p1.token }); ok(ap.ok, errs(ap)); eq(read(dst, 'config/ignore.txt'), '# 주석\nmy-project\n\nother-window\n', '받은 내용');
  ok(!applyImport(dst, good, {}, { token: p1.token }).ok, '선택 옵션이 다른데 확인 값이 통과함');
  const own = mkHome(); put(own, 'config/ignore.txt', 't9\n*\n'); const bk = backupNow(own, {});
  put(own, 'config/ignore.txt', 'x\n'); const rp = planRestore(own, bk.dir); ok(rp.ok && !rp.noop, '내 백업은 짧은/넓은 줄이어도 그대로 복구되어야 함(내 파일)');
});

await check('(I-17) 안내 문구에 내부 임시 폴더 경로가 새지 않고(실제 설정 경로로 바꿔 보여 줌), 기본 설정으로 대신 점검했을 때의 가짜 미설정 경고는 뺀다', () => {
  const ctx = mkHome();
  const c = JSON.parse(read(ctx, 'config/orchestration.json')); c.scope_prefix = '(미설정)'; put(ctx, 'config/orchestration.json', JSON.stringify(c));
  const a = roleNew(ctx, { id: 'warn-role' }); ok(a.ok, errs(a));
  const w = (a.warnings ?? []).join(' | '); ok(/미설정/.test(w), '진짜 미설정 경고가 없음: ' + w);
  ok(!/orch-manage-/.test(w) && w.includes(join(ctx.paths.config, 'orchestration.json')), '임시 경로가 새거나 실제 설정 경로가 아님: ' + w);
  const broken = mkHome(); put(broken, 'config/orchestration.json', '{ 깨짐');
  const b = roleNew(broken, { id: 'warn-role' }); ok(b.ok, errs(b));
  const wb = (b.warnings ?? []).join(' | '); ok(/기본 설정으로 역할만 점검/.test(wb) && !/경고: 설정/.test(wb) && !/orch-manage-/.test(wb), '대체 점검 경고가 어긋남: ' + wb);
  const bad = roleNew(broken, { id: 'x-role', fields: { slot: 1 } }); ok(!bad.ok && !/orch-manage-/.test(errs(bad)), '오류 문구에 임시 경로: ' + errs(bad));
});
await check('(I-18) 미리보기의 역할 줄: 켜짐 전/후와 "번들 덮어쓰기" 여부를 알려 준다(새 역할=없음, 덮어쓰기=번들 기본, 내가 가진 것=이전 값)', () => {
  const src = mkHome(); roleNew(src, { id: 'new-one' }); roleSet(src, 'verifier', { enabled: false });
  const pk = exportPackage(src, { dest: join(BASE, 'exp-i18'), scope: 'portable' }); ok(pk.ok, errs(pk));
  const dst = mkHome(); const plan = planImport(dst, pk.dir, { enableImported: true }); ok(plan.ok, errs(plan));
  const by = Object.fromEntries(plan.changes.map((c) => [c.path, c]));
  ok(by['config/roles/new-one.md'].roleBefore === null && by['config/roles/new-one.md'].role.bundle === false && by['config/roles/new-one.md'].role.enabled === true, JSON.stringify(by['config/roles/new-one.md'].role));
  ok(by['config/roles/verifier.md'].roleBefore === null && by['config/roles/verifier.md'].role.bundle === true && by['config/roles/verifier.md'].role.enabled === false, JSON.stringify(by['config/roles/verifier.md'].role));
  const ap = applyImport(dst, pk.dir, { enableImported: true }, { token: plan.token }); ok(ap.ok, errs(ap));
  const re = planImport(dst, pk.dir, { mode: 'merge' });
  ok(re.ok && re.noop, '같은 묶음을 다시 보면 변경 없음');
  roleSet(dst, 'verifier', { enabled: true });
  const p3 = planImport(dst, pk.dir, { enableImported: true }); ok(p3.ok && p3.changes.find((c) => c.path === 'config/roles/verifier.md').roleBefore === null, '덮어쓰기 파일이 지워진 상태의 이전 값');
});

await check('(I-19) 남의 묶음의 역할 파일이 BOM 여러 개·다른 표기로 파서와 읽는 방식을 어긋나게 해도 "꺼진 채" 규칙이 깨지지 않는다(거절되거나 꺼짐으로만 들어옴)', () => {
  const src = mkHome(); roleNew(src, { id: 'evil-one' });
  const pk = exportPackage(src, { dest: join(BASE, 'exp-i19'), scope: 'portable' }); ok(pk.ok, errs(pk));
  const file = join(pk.dir, 'config', 'roles', 'evil-one.md'); const mf = join(pk.dir, 'package.json');
  const orig = readFileSync(file); const text = orig.toString('utf8'); const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
  ok(/^enabled: true$/m.test(text), '시험 전제: 원본은 enabled: true');
  const retarget = (buf) => { writeFileSync(file, buf); const m = JSON.parse(readFileSync(mf, 'utf8')); const e = m.files.find((x) => x.path === 'config/roles/evil-one.md'); e.sha256 = sha(buf); e.bytes = buf.length; writeFileSync(mf, JSON.stringify(m, null, 2)); };
  const variants = {
    '정상': orig,
    'BOM 1개': Buffer.concat([BOM, orig]), 'BOM 2개': Buffer.concat([BOM, BOM, orig]), 'BOM 3개': Buffer.concat([BOM, BOM, BOM, orig]),
    '키 뒤 공백(enabled : true)': Buffer.from(text.replace(/^enabled:/m, 'enabled :')),
    '따옴표 키("enabled": true)': Buffer.from(text.replace(/^enabled:/m, '"enabled":')),
    '중복 키(뒤쪽에 true)': Buffer.from(text.replace(/\n---\n/, '\n---\n').replace(/^(---\n[\s\S]*?)\n---\n/, '$1\nenabled: true\n---\n')),
    'CR 단독 줄바꿈 + BOM 2개': Buffer.concat([BOM, BOM, Buffer.from(text.replace(/\r?\n/g, '\r'))]),
  };
  const seen = [];
  for (const [name, buf] of Object.entries(variants)) {
    retarget(buf);
    const dst = mkHome(); const plan = planImport(dst, pk.dir, { mode: 'merge' });
    if (!plan.ok) { seen.push(`${name}: 거절`); continue; }                                  // 거절은 안전한 결과
    const ch = plan.changes.find((c) => c.path === 'config/roles/evil-one.md');
    ok(ch && ch.role && ch.role.enabled === false, `${name}: 미리보기에서 꺼짐이 아님 → ${JSON.stringify(ch && ch.role)}`);
    const ap = applyImport(dst, pk.dir, { mode: 'merge' }, { token: plan.token }); ok(ap.ok, `${name}: ${errs(ap)}`);
    const r = roleList(dst).roles.find((x) => x.id === 'evil-one'); ok(r && r.meta.enabled === false, `${name}: 적용 뒤 실제 역할이 켜져 있음`);
    seen.push(`${name}: 꺼짐`);
  }
  ok(seen.length === Object.keys(variants).length, '모든 변형을 확인하지 못함');
});

// ======================= 백업 · 복구 (B) =======================
await check('(B-1) 백업: 전부 담기고 해시가 맞고 목록에 메모와 함께 보인다 / 설정이 비면 만들지 않는다', () => {
  const ctx = mkHome({ seed: true });
  const b = backupNow(ctx, { note: '  첫 백업\n줄바꿈 제거  ' }); ok(b.ok, errs(b));
  const rp = readPackage(b.dir); ok(rp.ok && rp.files.size === 6 && rp.manifest.kind === 'backup' && rp.manifest.scope === 'full', `백업 내용 ${rp.files?.size}`);
  const l = listBackups(ctx); eq(l.count, 1, '백업 수'); ok(l.backups[0].note === '첫 백업 줄바꿈 제거', `메모 ${JSON.stringify(l.backups[0].note)}`);
  const none = makeCtx({ env: { ...process.env, ORCH_HOME: join(BASE, 'nothing-here') } });
  const e = backupNow(none, {}); ok(e.ok && e.empty && e.dir === null && !existsSync(none.backups), '빈 설정 백업이 폴더를 만듦');
});
await check('(B-2) 복구 왕복: 바꾸고 · 새로 만들고 · 손으로 고친 뒤 복구하면 백업 시점과 바이트까지 같고, 복구 직전 상태도 자동 백업된다', () => {
  const ctx = mkHome({ seed: true });
  const b = backupNow(ctx, { note: '기준' }); const before = userSnapshot(ctx);
  roleSet(ctx, 'verifier', { name: '검증관 B' }); roleNew(ctx, { id: 'later-role' }); roleDelete(ctx, 'my-extra');
  put(ctx, 'config/env-rules.md', '손으로 고침\n'); put(ctx, 'config/ignore.txt', 'zzz\n');
  const mid = userSnapshot(ctx); ok(JSON.stringify(mid) !== JSON.stringify(before), '준비 실패');
  const plan = planRestore(ctx, b.dir); ok(plan.ok && !plan.noop, errs(plan));
  const r = applyRestore(ctx, b.dir, { token: plan.token }); ok(r.ok, errs(r));
  eq(userSnapshot(ctx), before, '복구 결과가 백업 시점과 다름');
  const pre = readPackage(r.backup); ok(pre.ok, '복구 직전 자동 백업'); const sorted = (o) => Object.fromEntries(Object.entries(o).sort());
  eq(sorted(Object.fromEntries([...pre.files].map(([k, v]) => [k, sha(v)]))), sorted(mid), '복구 직전 상태가 자동 백업에 없음');
  ok(!applyRestore(ctx, b.dir, { token: 'wrong' }).ok, '틀린 확인 값 허용됨');
});
await check('(B-3) 복구도 검증을 통과해야 한다: 깨진 백업은 거부하고 내 설정은 그대로 (R3·R7)', () => {
  const ctx = mkHome({ seed: true }); const b = backupNow(ctx, {}); const snap = userSnapshot(ctx);
  writeFileSync(join(b.dir, 'config', 'ignore.txt'), '변조');
  const p = planRestore(ctx, b.dir); ok(!p.ok, '변조된 백업을 복구 계획으로 받음'); eq(userSnapshot(ctx), snap, '내 설정이 바뀜');
});
await check('(B-4) 백업은 지우지 않고 쌓이며, 많아지면 알린다 (R11)', () => {
  const ctx = mkHome({ seed: true });
  for (let i = 0; i < 3; i++) ok(backupNow(ctx, { now: new Date(2026, 0, 1, 0, 0, i) }).ok, '백업');
  eq(listBackups(ctx).count, 3, '쌓인 백업');
  for (let i = 0; i < LIMITS.backupWarnCount; i++) { const d = join(ctx.backups, `orch-backup-2025${String(i).padStart(4, '0')}-000000`); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'package.json'), JSON.stringify({ format: 1, kit: 'herdr-orchestration', kind: 'backup', scope: 'full', createdAt: 'x', note: '', files: [] })); }
  const l = listBackups(ctx); ok(l.tooMany && l.count === 3 + LIMITS.backupWarnCount, `많음 표시 ${l.count}/${l.tooMany}`);
  mkdirSync(join(ctx.backups, 'zz-broken'), { recursive: true }); ok(listBackups(ctx).unreadable.includes('zz-broken'), '읽을 수 없는 항목 표시');
});

// ======================= 잠금 · 되돌리기 (R9, R10) =======================
await check('(I-12) 동시에 쓰지 못한다: 새 잠금이 있으면 거절, 오래된 잠금은 넘겨받고, 끝나면 잠금이 사라진다 (R9)', () => {
  const ctx = mkHome({ seed: true });
  mkdirSync(ctx.paths.state, { recursive: true });
  writeFileSync(ctx.lockFile, JSON.stringify({ pid: 1, token: 'other', at: Date.now() }));
  const snap = userSnapshot(ctx);
  const r = roleSet(ctx, 'verifier', { enabled: false }); ok(!r.ok && /진행 중/.test(errs(r)), errs(r)); eq(userSnapshot(ctx), snap, '잠금을 무시하고 씀');
  ok(existsSync(ctx.lockFile), '남의 잠금을 지움');
  writeFileSync(ctx.lockFile, JSON.stringify({ pid: 1, token: 'old', at: Date.now() - LIMITS.staleLockMs - 1000 }));
  const r2 = roleSet(ctx, 'verifier', { enabled: false }); ok(r2.ok, `오래된 잠금 인계 실패: ${errs(r2)}`);
  ok(!existsSync(ctx.lockFile), '끝났는데 잠금이 남음');
  writeFileSync(ctx.lockFile, '깨진 내용'); const r3 = roleSet(ctx, 'verifier', { enabled: true });
  ok(r3.ok || /진행 중/.test(errs(r3)), '깨진 잠금 파일에서 처리되지 않은 오류');
});
await check('(I-13) 적용 도중 쓰기가 실패하면 변경 전 상태로 되돌린다: 먼저 쓴 파일도 제거 (R10)', () => {
  const ctx = mkHome({ seed: true }); const snap = userSnapshot(ctx);
  mkdirSync(join(ctx.paths.roles, 'zz-block.md'), { recursive: true });               // 폴더가 같은 이름의 파일 자리를 막고 있음 → 이름 바꾸기 실패
  const put2 = new Map([['config/roles/a-first.md', Buffer.from(NEWROLE('a-first', 21))], ['config/roles/zz-block.md', Buffer.from(NEWROLE('zz-block', 22))]]);
  const r = commitChanges(ctx, { put: put2, reason: '실패 시험' });
  ok(!r.ok && /되돌렸습니다/.test(errs(r)) && r.rolledBack === true, errs(r));
  ok(!has(ctx, 'config/roles/a-first.md'), '먼저 쓴 파일이 남음'); eq(userSnapshot(ctx), snap, '내 설정이 달라짐');
  ok(r.backup && readPackage(r.backup).ok, '실패 전 자동 백업이 없음');
  ok(!existsSync(ctx.lockFile), '실패 뒤 잠금이 남음');
  ok(readdirSync(ctx.paths.roles).every((f) => !f.includes('.tmp-')), '임시 파일이 남음');
});
await check('(I-14) 쓰기 전에 자동 백업이 실패하면 아무것도 바꾸지 않는다', () => {
  const ctx = mkHome({ seed: true }); const snap = userSnapshot(ctx);
  writeFileSync(ctx.backups, '폴더가 아니라 파일');                                       // 백업 위치를 파일로 막음
  const r = roleSet(ctx, 'verifier', { enabled: false }); ok(!r.ok && /자동 백업에 실패/.test(errs(r)), `백업이 막혔는데: ${errs(r)}`); eq(userSnapshot(ctx), snap, '내 설정이 바뀜');
  const b = backupNow(ctx, {}); ok(!b.ok && /묶음을 만들 수 없습니다/.test(errs(b)), '백업 실패가 예외로 터짐');
  const e = exportPackage(ctx, { dest: ctx.backups, scope: 'portable' }); ok(!e.ok, '파일이 있는 자리에 내보냄');
});

// ======================= CLI (C) · 부작용 (N) =======================
function cli(cmd, req, home, extra = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'manage.mjs'), cmd], { input: typeof req === 'string' ? req : JSON.stringify(req ?? {}), encoding: 'utf8', env: { ...process.env, ORCH_HOME: home, ...extra } });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* 아래에서 */ }
  return { code: r.status, json, out: `${r.stdout}${r.stderr}` };
}
await check('(C-1) CLI: 한 줄 JSON·한글 그대로·종료코드(처리 0 / 거절 1 / 사용법 2)·스택 트레이스 없음', () => {
  const ctx = mkHome({ seed: true }); const h = ctx.paths.home;
  const s = cli('status', {}, h); ok(s.code === 0 && s.json.ok && s.json.roles.length === 13, s.out.slice(0, 200));
  ok(s.out.trim().split('\n').length === 1, '출력이 한 줄이 아님');
  const bad = cli('role-set', { id: 'verifier', fields: { mode: 'scoped-write' } }, h); ok(bad.code === 1 && bad.json.ok === false, bad.out.slice(0, 200));
  const unk = cli('no-such', {}, h); ok(unk.code === 2 && !/\n\s+at /.test(unk.out), unk.out);
  const nocmd = spawnSync(process.execPath, [join(ROOT, 'bin', 'manage.mjs')], { encoding: 'utf8' }); eq(nocmd.status, 2, '명령 없이 실행');
  const junk = cli('status', '{ 깨진 JSON', h); ok(junk.code === 1 && junk.json.ok === false, junk.out);
  const nul = cli('role-set', { id: null }, h); ok(nul.code === 1 && !/\n\s+at /.test(nul.out), nul.out);
  const ko = cli('role-set', { id: 'verifier', fields: { name: '한글 이름 ✔' } }, h); ok(ko.code === 0, ko.out);
  ok(read(ctx, 'config/roles/verifier.md').includes('한글 이름 ✔'), '한글이 깨짐');
});
await check('(C-2) CLI 전체 흐름: 내보내기 → 다른 홈에서 불러오기 미리보기 → 적용 → 백업 → 복구', () => {
  const a = mkHome({ seed: true }); const b = mkHome();
  const ex = cli('export', { dest: join(BASE, 'exp-c2'), scope: 'portable', note: 'cli' }, a.paths.home); ok(ex.code === 0, ex.out.slice(0, 200));
  const pl = cli('import-plan', { pkg: ex.json.dir, mode: 'merge' }, b.paths.home); ok(pl.code === 0 && pl.json.token && !('candidate' in pl.json), pl.out.slice(0, 200));
  const ap = cli('import-apply', { pkg: ex.json.dir, mode: 'merge', token: pl.json.token }, b.paths.home); ok(ap.code === 0 && ap.json.changed === 2, ap.out.slice(0, 300));
  const bk = cli('backup', { note: 'c2' }, b.paths.home); ok(bk.code === 0 && bk.json.dir, bk.out.slice(0, 200));
  const ls = cli('backup-list', {}, b.paths.home); ok(ls.json.count >= 2, ls.out.slice(0, 200));
  put(b, 'config/ignore.txt', '바뀜\n');
  const rp = cli('restore-plan', { pkg: bk.json.dir }, b.paths.home); ok(rp.code === 0 && !rp.json.noop, rp.out.slice(0, 200));
  const ra = cli('restore-apply', { pkg: bk.json.dir, token: rp.json.token }, b.paths.home); ok(ra.code === 0, ra.out.slice(0, 200));
});
// 허더 모드는 exec 에 표준입력을 줄 수 없어서 요청 값을 파일로 준다(--request-file). 같은 요청이면 표준입력과 결과가 같아야 한다.
function cliFile(cmd, reqText, home, { stdin = '' } = {}) {
  const f = join(BASE, `req-${Math.random().toString(36).slice(2)}.json`);
  if (reqText !== null) writeFileSync(f, reqText);
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'manage.mjs'), cmd, '--request-file', reqText === null ? join(BASE, 'req-없음.json') : f], { input: stdin, encoding: 'utf8', env: { ...process.env, ORCH_HOME: home } });
  let json = null; try { json = JSON.parse(r.stdout); } catch { /* 아래에서 */ }
  return { code: r.status, json, out: `${r.stdout}${r.stderr}`, file: f };
}
await check('(C-3) --request-file: 표준입력 없이 파일로 요청(한글·BOM·큰 본문), 요청 파일은 읽기만 한다', () => {
  const ctx = mkHome({ seed: true }); const h = ctx.paths.home;
  const body = '# 시험 역할\n' + '- 한글 줄 ✔\n'.repeat(3000);                       // 약 40 KB: 명령줄로는 못 보내는 크기
  const req = JSON.stringify({ id: 'verifier', fields: { name: '파일 요청 ✔' }, body });
  const r = cliFile('role-set', '﻿' + req, h);                                     // BOM 이 붙은 UTF-8
  ok(r.code === 0 && r.json.ok, r.out.slice(0, 300));
  ok(read(ctx, 'config/roles/verifier.md').includes('파일 요청 ✔'), '파일로 준 값이 반영되지 않음');
  eq(readFileSync(r.file, 'utf8'), '﻿' + req, '요청 파일이 바뀜(엔진은 읽기만 해야 함)');
  const s1 = cli('status', {}, h); const s2 = cliFile('status', '{}', h); eq(JSON.stringify(s2.json), JSON.stringify(s1.json), '표준입력과 파일의 결과가 다름');
  const ign = cliFile('status', '{}', h, { stdin: '{ 이 입력은 무시되어야 함' }); ok(ign.code === 0 && ign.json.ok, '--request-file 일 때 표준입력을 읽음');
});
await check('(C-4) --request-file 잘못된 사용: 파일 없음·폴더·깨진 JSON·너무 큰 파일·경로 누락은 깨끗이 거절(1), 스택 트레이스 없음', () => {
  const ctx = mkHome({ seed: true }); const h = ctx.paths.home;
  const miss = cliFile('status', null, h); ok(miss.code === 1 && miss.json.ok === false && !/\n\s+at /.test(miss.out), miss.out);
  const bad = cliFile('status', '{ 깨진', h); ok(bad.code === 1 && bad.json.ok === false, bad.out);
  const dir = spawnSync(process.execPath, [join(ROOT, 'bin', 'manage.mjs'), 'status', '--request-file', BASE], { encoding: 'utf8', env: { ...process.env, ORCH_HOME: h } });
  ok(dir.status === 1 && /일반 파일이 아님/.test(dir.stdout), dir.stdout);
  const big = cliFile('status', JSON.stringify({ x: 'a'.repeat(2 * 1024 * 1024 + 10) }), h); ok(big.code === 1 && /너무 큼/.test(big.out), big.out.slice(0, 200));
  const nop = spawnSync(process.execPath, [join(ROOT, 'bin', 'manage.mjs'), 'status', '--request-file'], { encoding: 'utf8', env: { ...process.env, ORCH_HOME: h } });
  ok(nop.status === 1 && /경로가 없음/.test(nop.stdout), nop.stdout);
});
await check('(C-5) --no-input: 표준입력이 열린 채 닫히지 않아도(허더 exec 가 그럴 수 있음) 멈추지 않고 조회가 끝난다', () => {
  const ctx = mkHome({ seed: true }); const h = ctx.paths.home;
  // 입력 파이프를 열어 둔 채(닫지 않음) 실행: --no-input 이 아니면 표준입력을 읽다가 멈춘다
  const r = spawnSync(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const c = spawn(process.execPath, [${JSON.stringify(join(ROOT, 'bin', 'manage.mjs'))}, 'status', '--no-input'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ORCH_HOME: ${JSON.stringify(h)} } });
    let out = ''; c.stdout.on('data', (d) => out += d);
    const t = setTimeout(() => { console.log('HUNG'); c.kill(); process.exit(0); }, 20000);
    c.on('close', (code) => { clearTimeout(t); console.log('CLOSED ' + code + ' ' + JSON.parse(out).ok); process.exit(0); });
  `], { encoding: 'utf8', timeout: 60000 });
  ok(/CLOSED 0 true/.test(r.stdout), `조회가 끝나지 않았거나 실패: ${r.stdout}${r.stderr}`.slice(0, 300));
});
await check('(U-1) 어디서나 실행: 공백·한글·괄호 경로에 실제 설치 → 설치된 사본의 엔진과 창이 저장소가 아니라 설치된 번들을 쓰고, 창이 열려 4개 탭을 그린다', () => {
  const PS = 'powershell.exe';
  const run = (args, env) => spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], { encoding: 'utf8', env, timeout: 180000 });
  const root = join(BASE, '새 PC (시험) 홍 길동'); const app = join(root, 'Herdr 도구', 'app'); const home = join(root, '설정 폴더'); const docs = join(root, '문서');
  const env = { ...process.env, ORCH_HOME: home }; delete env.ORCH_DOCS_DIR;
  const ins = run(['-File', join(ROOT, 'bin', 'install.ps1'), '-InstallDir', app, '-OrchHome', home, '-DocsDir', docs], env);
  ok(ins.status === 0 && /관리 창\(더블클릭\)/.test(ins.stdout), `설치 실패\n${ins.stdout}${ins.stderr}`.slice(0, 600));
  for (const f of ['manage.mjs', 'manage-lib.mjs', 'orch-manager.ps1', 'Herdr-Orchestration-Manager.vbs']) ok(existsSync(join(app, 'bin', f)), `설치본에 ${f} 가 없음`);
  const cl = (cmd, req) => { const r = spawnSync(process.execPath, [join(app, 'bin', 'manage.mjs'), cmd], { input: JSON.stringify(req ?? {}), encoding: 'utf8', env }); return JSON.parse(r.stdout); };
  const s = cl('status'); ok(s.ok && s.roles.length === 12, '설치본 현황');
  eq(s.root, app, '엔진이 설치된 번들을 가리키지 않음'); ok(!s.root.includes('Herdr-Orchestration\\bin') && s.paths.home === home, '경로가 저장소/기본 위치를 가리킴');
  const rn = cl('role-new', { id: 'qa-helper', fields: { name: '설치본 시험' } }); ok(rn.ok, errs(rn));
  ok(existsSync(join(home, 'config', 'roles', 'qa-helper.md')) && !existsSync(join(app, 'roles', 'qa-helper.md')) && !existsSync(join(ROOT, 'roles', 'qa-helper.md')), '새 역할이 내 설정 밖에 만들어짐');
  const ui = run(['-Command', '[Environment]::UserInteractive'], env);
  if (!/True/i.test(ui.stdout)) return { skip: '대화형 데스크톱이 없어 창 시험을 건너뜀' };
  const shots = join(root, '그림'); mkdirSync(shots, { recursive: true });
  const st = run(['-STA', '-File', join(app, 'bin', 'orch-manager.ps1'), '-SelfTest', '-ShotDir', shots], env);
  ok(/SELFTEST OK roles=13/.test(st.stdout), `창 점검 실패\n${st.stdout}${st.stderr}`.slice(0, 800));
  for (const f of ['1-status.png', '2-roles.png', '3-share.png', '4-backup.png', '5-live.png', '6-rolecheck.png']) ok(existsSync(join(shots, f)) && lstatSync(join(shots, f)).size > 5000, `그림 ${f} 가 없거나 비어 있음`);
});
// ======================= 실제 창 상태: 읽기 전용 (L) =======================
// 가짜 hc(tests/stub/hc-stub.cs)는 받은 명령을 모두 calls.log 에 적고, ls 만 답한다. 이것으로 "ls --json 외에는 아무것도 안 불렀다"를 증명한다.
const CSC = [join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find((p) => existsSync(p));
const STUB = join(BASE, 'stubbin', 'hc.exe');
if (CSC) { mkdirSync(join(BASE, 'stubbin'), { recursive: true }); execFileSync(CSC, ['/nologo', '/target:exe', '/out:' + STUB, join(ROOT, 'tests', 'stub', 'hc-stub.cs')], { stdio: 'pipe' }); }
let liveN = 0;
const liveScenario = (ls) => { const d = join(BASE, `live${++liveN}`); mkdirSync(d, { recursive: true }); if (ls !== undefined) writeFileSync(join(d, 'ls.json'), typeof ls === 'string' ? ls : JSON.stringify(ls)); return d; };
const liveCtx = (ctx, dir, extra = {}) => makeCtx({ env: { ...ctx.env, HC_BIN: STUB, FAKE_HC_DIR: dir, ...extra } });
const calls = (dir) => (existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8').split('\n').filter(Boolean) : []);
const T = (address, status, where, extra = {}) => ({ address, agent: 'claude-code', cwd: 'C:\\x', state: 'live', status, turn: 3, where, ...extra });

await check('(L-1) 실제 창 목록: 상태별 개수·범위(scope_prefix) 안/밖 표시·상태 없는 창은 "?"로 센다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const ctx = mkHome(); const d = liveScenario({ terminals: [T('t1', 'blocked', 'T / a'), T('t2', 'idle', 'T / b'), T('t3', 'done', 'Other / c'), T('t4', '', 'X')], hidden_finished: 7 });
  const r = liveWindows(liveCtx(ctx, d)); ok(r.ok && r.available, JSON.stringify(r).slice(0, 200));
  eq(r.counts, { blocked: 1, idle: 1, done: 1, '?': 1 }, '상태별 개수'); eq(r.windows.map((w) => w.inScope), [true, true, false, false], '범위 표시'); eq([r.total, r.shown, r.hiddenFinished, r.scope], [4, 4, 7, 'T /'], '합계·범위');
  const o = liveWindows(liveCtx(ctx, d), { scopePrefix: 'Other /' }); eq(o.windows.map((w) => w.inScope), [false, false, true, false], '범위를 직접 지정');
  const nos = liveWindows(liveCtx(mkHomeUnset(), d)); ok(nos.windows.every((w) => w.inScope === null), '범위가 미설정이면 안/밖을 표시하지 않음');
});
function mkHomeUnset() { const c = mkHome(); const j = JSON.parse(read(c, 'config/orchestration.json')); j.scope_prefix = '(미설정)'; put(c, 'config/orchestration.json', JSON.stringify(j)); return c; }
await check('(L-2) 읽기 전용 증명: 호출 기록에 "ls --json" 외의 명령이 하나도 없다(send·keys·read·get·label 없음)', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const ctx = mkHome(); const d = liveScenario({ terminals: [T('t1', 'blocked', 'T / a')] });
  for (let i = 0; i < 3; i++) liveWindows(liveCtx(ctx, d));
  const c = cli('live-windows', {}, ctx.paths.home, { HC_BIN: STUB, FAKE_HC_DIR: d }); ok(c.code === 0 && c.json.available, c.out.slice(0, 200));
  eq(calls(d), ['ls --json', 'ls --json', 'ls --json', 'ls --json'], '호출 기록'); ok(!calls(d).some((x) => /UNSUPPORTED|send|keys|read|get|label|run|kill/.test(x)), '다른 명령이 불림');
});
await check('(L-3) hc 가 없거나 실패하거나 이상한 답을 주면 오류가 아니라 "조회 불가"로 안내하고 죽지 않는다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const ctx = mkHome();
  const a = liveWindows(makeCtx({ env: { ...ctx.env, HC_BIN: join(BASE, 'no-such-hc.exe') } })); ok(a.ok && !a.available && /hc 를 실행할 수 없습니다/.test(a.note) && /PATH/.test(a.note) && a.windows.length === 0, JSON.stringify(a));
  const b = liveWindows(liveCtx(ctx, liveScenario())); ok(b.ok && !b.available && /실패/.test(b.note), b.note);                      // ls.json 이 없으면 가짜 hc 가 종료코드 1
  const c = liveWindows(liveCtx(ctx, liveScenario('이건 JSON 이 아님'))); ok(!c.available && /JSON/.test(c.note), c.note);
  const d = liveWindows(liveCtx(ctx, liveScenario({ terminals: '문자열' }))); ok(!d.available && /형식/.test(d.note), d.note);
  const e = liveWindows(liveCtx(ctx, liveScenario({ nothing: 1 }))); ok(!e.available, '형식 다른 응답');
  const f = liveWindows(liveCtx(ctx, liveScenario('\uFEFF{"terminals":[]}'))); ok(f.available && f.windows.length === 0, 'BOM 이 붙은 빈 목록');
});
await check('(L-4) 화면에 내보내는 값은 정리한다: 제어 글자 제거·길이 제한·목록에 섞인 이상한 항목 무시·500개 상한', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const ctx = mkHome();
  const big = []; for (let i = 0; i < 600; i++) big.push(T('t' + i, 'idle', 'T / ' + i));
  const r = liveWindows(liveCtx(ctx, liveScenario({ terminals: [T('t1', 'blocked', 'T / \u0007\u001b[31m' + 'x'.repeat(5000)), null, 'str', 7, T('t2', 'idle', 'T / ok', { turn: 'abc' })] })));
  ok(r.available && r.windows.length === 2, '이상한 항목이 섞임: ' + r.windows.length); ok(r.windows[0].where.length <= 200 && !/[\u0000-\u001f]/.test(r.windows[0].where), '길이·제어 글자'); eq(r.windows[1].turn, null, '숫자가 아닌 turn');
  const b = liveWindows(liveCtx(ctx, liveScenario({ terminals: big }))); ok(b.shown === 500 && b.total === 600 && b.truncated === true, `상한 ${b.shown}/${b.total}`);
});
await check('(L-5) 조회 결과를 파일에 남기지 않는다(내 설정·상태·로그 폴더 불변)', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const ctx = mkHome(); const before = treeHash(ctx.paths.home);
  liveWindows(liveCtx(ctx, liveScenario({ terminals: [T('t1', 'blocked', 'T / a')] })));
  eq(treeHash(ctx.paths.home), before, '조회가 홈 폴더를 바꿈');
});

await check('(N-1) 소스에 hc 호출·창 전송·네트워크가 없다 (읽기/쓰기는 내 설정 층과 임시 폴더뿐)', () => {
  const src = readFileSync(join(ROOT, 'bin', 'manage-lib.mjs'), 'utf8') + readFileSync(join(ROOT, 'bin', 'manage.mjs'), 'utf8');
  for (const bad of [/['"`]hc['"`]/, /hc\s+send/, /hc\.exe/, /node:https?/, /node:net/, /fetch\(/, /\bsend\b.*terminal/i]) ok(!bad.test(src), `금지 패턴: ${bad}`);
});
await check('(N-1b) manage-live.mjs: hc 호출은 정확히 한 곳이고 인자는 ls --json 뿐이며, 쓰기·전송 명령 이름이 없다', () => {
  const src = readFileSync(join(ROOT, 'bin', 'manage-live.mjs'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  eq((code.match(/spawnSync\(/g) || []).length, 1, 'spawnSync 호출 수'); ok(/spawnSync\(hc, \['ls', '--json'\]/.test(code), '인자가 ls --json 이 아님');
  for (const verb of ['send', 'keys', 'read', 'do', 'label', 'run', 'kill', 'server', 'events', 'get']) ok(!new RegExp(`['"\`]${verb}['"\`]`).test(code), `금지 명령 이름: ${verb}`);
  ok(!/writeFileSync|appendFileSync|mkdirSync|unlinkSync/.test(code), '조회 모듈이 파일을 씀');
});
// ======================= 역할 점검: 세션 ID 로 역할과 창을 맞춘다 (K) =======================
// 문제 상황: 창 주소·탭 안 순서는 복구 때마다 바뀐다(6번 역할 창이 복구되어 탭 맨 끝으로 가면 순서로는 8번이 됨). 세션 ID 만 안 바뀐다.
const SIDN = (i) => `${String(i).padStart(8, '0')}-1111-4111-8111-${String(i).padStart(12, '0')}`;
const K_NOW = Date.parse('2026-11-18T04:00:00Z');
const K_ROWS = [['commander', 'CT-CC-Master', 100], ['approval-proxy', 'CT-CC-Master', 101], ['approval-reviewer', 'CT-CC-1,2,3,4', 110], ['ledger-keeper', 'CT-CC-1,2,3,4', 111], ['verifier', 'CT-CC-1,2,3,4', 112], ['human-tasks', 'CT-CC-1,2,3,4', 113], ['window-inspector', 'CT-CC-5,6,7,8', 120], ['test-dispatcher', 'CT-CC-5,6,7,8', 121], ['doc-consistency', 'CT-CC-5,6,7,8', 122], ['git-keeper', 'CT-CC-5,6,7,8', 123], ['security-guard', 'CT-CC-9,10', 130], ['role-auditor', 'CT-CC-9,10', 131]];
// opts: drop(창이 없는 역할 id들) · move({역할id: 새 주소 번호}) · ageSec(키퍼 기록 나이) · extra(더 있는 창 [{n,tab,agent}]) · noMap(map 파일 없음)
function kEnv({ drop = [], move = {}, ageSec = 5, extra = [], noMap = false } = {}) {
  const ctx = mkHome(); put(ctx, 'config/roles/approval-proxy.md', '---\nenabled: true\n---\n');   // 승인 대행은 기본이 꺼져 있다. 실제 구성처럼 켠다
  const dir = liveScenario({ terminals: [] }); const mapDir = join(BASE, `kmap${++liveN}`); mkdirSync(mapDir, { recursive: true });
  const terms = []; const map = {}; const seen = new Date(K_NOW - ageSec * 1000).toISOString();
  for (const [id, tab, n] of K_ROWS) { if (drop.includes(id)) continue; const a = `t${move[id] ?? n}`; terms.push(T(a, 'idle', `Sp / ${tab}`)); map[a] = { addr: a, where: `Sp / ${tab}`, sid: SIDN(n), seen }; }
  for (const x of extra) { const a = `t${x.n}`; terms.push(T(a, 'idle', `Sp / ${x.tab}`, { agent: x.agent ?? 'claude-code' })); if (x.agent !== 'powershell.exe') map[a] = { addr: a, where: `Sp / ${x.tab}`, sid: SIDN(x.n), seen }; }
  writeFileSync(join(dir, 'ls.json'), JSON.stringify({ terminals: terms }));
  const mapFile = join(mapDir, 'session-map.json'); if (!noMap) writeFileSync(mapFile, JSON.stringify(map));
  const env = { ...ctx.env, HC_BIN: STUB, FAKE_HC_DIR: dir, ORCH_SESSION_MAP: mapFile };
  const c2 = makeCtx({ env });
  return { ctx: c2, dir, mapFile, rc: () => roleCheck(c2, { now: K_NOW }), assignAll: (skip = []) => { for (const [id, , n] of K_ROWS) if (!skip.includes(id)) { const r = roleWindowSet(c2, { id, sid: SIDN(n) }); if (!r.ok) throw new Error(JSON.stringify(r)); } } };
}
const stOf = (r, id) => r.roles.find((x) => x.id === id);
await check('(K-1) 6번 창이 복구되어 탭 맨 끝으로 가도(주소·순서가 달라져도) 세션 ID 로 6번 역할로 확인된다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv({ move: { 'test-dispatcher': 199 } }); k.assignAll();
  const r = k.rc(); ok(r.ok && r.available, JSON.stringify(r).slice(0, 300));
  eq([r.summary.expected, r.summary.ok], [12, 12], '12개 중 12개 정상'); ok(/12개 중 12개 정상/.test(r.headline), r.headline);
  eq([stOf(r, 'test-dispatcher').status, stOf(r, 'test-dispatcher').address], ['ok', 't199'], '순서가 아니라 세션 ID 로 찾음'); eq(stOf(r, 'git-keeper').address, 't123', '다른 역할은 그대로');
});
await check('(K-2) 창이 없는 역할은 "없음"으로, 나머지는 정상으로 센다(누락을 숨기지 않음)', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv({ drop: ['verifier'] }); k.assignAll();
  const r = k.rc(); eq([r.summary.ok, r.summary.missing], [11, 1], '개수'); eq(stOf(r, 'verifier').status, 'missing', '검증관'); ok(/없음 1/.test(r.headline), r.headline);
});
await check('(K-3) 세션키퍼 기록이 오래됐거나 없으면 "정상"이라 하지 않고 "확인 불가"로 말한다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const old = kEnv({ ageSec: 600 }); old.assignAll(); const a = old.rc();
  eq([a.summary.ok, a.summary.unknown], [0, 12], '오래된 기록'); ok(a.map.fresh === false && /믿지 않습니다/.test(a.map.note), JSON.stringify(a.map));
  const none = kEnv({ noMap: true }); none.assignAll(); const b = none.rc();
  eq([b.summary.ok, b.summary.unknown], [0, 12], '기록 파일 없음'); ok(b.map.available === false, JSON.stringify(b.map));
});
await check('(K-4) 아직 배정 안 한 역할: 후보를 보여 주고, "탭에 창 하나·역할 하나"일 때만 추정만(guess)으로 표시한다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv(); const r0 = k.rc();
  eq([r0.summary.ok, r0.summary.unassigned], [0, 12], '전부 미배정'); eq(stOf(r0, 'human-tasks').candidates.length, 4, '탭의 후보 창 수'); eq(r0.summary.extraWindows, 12, '미배정 창');
  k.assignAll(['human-tasks']); const r1 = k.rc();
  eq([stOf(r1, 'human-tasks').status, stOf(r1, 'human-tasks').address], ['guess', 't113'], '하나 남은 창은 추정'); ok(r1.summary.ok === 11 && /추정만 1/.test(r1.headline), r1.headline);
});
await check('(K-5) 역할 탭에 배정 안 된 창·빈 셸이 있으면 따로 알려 준다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv({ extra: [{ n: 140, tab: 'CT-CC-9,10' }, { n: 141, tab: 'CT-CC-9,10', agent: 'powershell.exe' }, { n: 150, tab: '다른탭' }] }); k.assignAll();
  const r = k.rc(); eq([r.summary.ok, r.summary.extraWindows, r.summary.emptyShells], [12, 1, 1], '개수'); eq(r.extras[0].address, 't140', '미배정 창'); eq(r.emptyShells[0].address, 't141', '빈 셸');
});
await check('(K-6) 읽기 전용 증명: hc 는 "ls --json" 만 불리고, 세션키퍼 map 과 대응표 파일은 바이트 동일·대응표는 만들어지지 않는다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv(); const before = sha(readFileSync(k.mapFile)); k.rc(); k.rc();
  eq(calls(k.dir), ['ls --json', 'ls --json'], '호출 기록'); eq(sha(readFileSync(k.mapFile)), before, 'session-map.json');
  ok(!existsSync(join(k.ctx.paths.config, 'role-windows.json')), '점검이 대응표를 만들었음');
  const cl = cli('role-check', {}, k.ctx.paths.home, { HC_BIN: STUB, FAKE_HC_DIR: k.dir, ORCH_SESSION_MAP: k.mapFile }); ok(cl.code === 0 && cl.json.ok && cl.json.available && cl.out.trim().split('\n').length === 1, cl.out.slice(0, 200));
});
await check('(K-7) 대응표 쓰기: 형식 검증·한 세션은 한 역할에만·직전 본(.prev) 보존·지우기', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv(); const c = k.ctx;
  ok(!roleWindowSet(c, { id: '../x', sid: SIDN(1) }).ok && !roleWindowSet(c, { id: 'no-such-role', sid: SIDN(1) }).ok, '이상한 역할 id');
  ok(!roleWindowSet(c, { id: 'verifier', sid: 'not-a-sid' }).ok && !roleWindowSet(c, { id: 'verifier', sid: SIDN(1) + 'x' }).ok, '이상한 세션 ID');
  ok(!roleWindowSet(c, { id: 'verifier', address: '../etc' }).ok, '이상한 주소');
  const a = roleWindowSet(c, { id: 'verifier', address: 't112', now: K_NOW }); ok(a.ok && a.sid8 === SIDN(112).slice(0, 8), JSON.stringify(a));   // 주소로 지정하면 키퍼 기록에서 세션 ID 를 찾는다
  const b = roleWindowSet(c, { id: 'git-keeper', sid: SIDN(112) }); ok(b.ok && b.movedFrom.includes('verifier'), JSON.stringify(b));                    // 같은 세션을 다른 역할에 주면 옮겨 감
  eq(Object.keys(JSON.parse(read(c, 'config/role-windows.json')).assignments), ['git-keeper'], '한 세션은 한 역할');
  ok(has(c, 'config/role-windows.json.prev'), '직전 본이 없음');
  eq([roleWindowClear(c, { id: 'git-keeper' }).removed, roleWindowClear(c, { id: 'git-keeper' }).removed], [true, false], '지우기');
  const stale = kEnv({ ageSec: 600 }); ok(!roleWindowSet(stale.ctx, { id: 'verifier', address: 't112', now: K_NOW }).ok, '오래된 키퍼 기록으로는 주소 지정 불가');
  ok(!readdirSync(c.paths.config).some((f) => /\.tmp-/.test(f)), '임시 파일이 남음');
});
await check('(K-8) 대응표 파일이 깨졌으면 점검은 그 사실을 알리고, 쓰기는 거절해 깨진 파일을 덮어쓰지 않는다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv(); put(k.ctx, 'config/role-windows.json', '{ 깨진');
  const r = k.rc(); ok(r.ok && r.available && r.assignmentsFile.error && r.summary.ok === 0, JSON.stringify(r.assignmentsFile));
  const w = roleWindowSet(k.ctx, { id: 'verifier', sid: SIDN(112) }); ok(!w.ok, '깨진 파일 위에 씀'); eq(read(k.ctx, 'config/role-windows.json'), '{ 깨진', '파일이 바뀜');
  put(k.ctx, 'config/role-windows.json', JSON.stringify({ version: 1, assignments: { verifier: { sid: '../../x' }, '../bad': { sid: SIDN(1) } } }));
  eq(k.rc().summary.ok, 0, '이상한 항목은 무시');
});
await check('(K-9) 초기 대응표 제안(seed): 제안만 하면 아무것도 안 쓰고, 읽는 파일은 control_dir 의 session-map.json* 으로 제한된다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv(); const cd = join(BASE, 'control'); mkdirSync(cd, { recursive: true });
  const old = {}; for (const [, tab, n] of K_ROWS) if (tab !== 'CT-CC-Master') old[`t${n - 50}`] = { addr: `t${n - 50}`, where: `Sp / ${tab}`, sid: SIDN(n), seen: '2026-11-13T23:44:32' };
  writeFileSync(join(cd, 'session-map.json.before-x'), JSON.stringify(old));
  const plan = roleWindowSeed(k.ctx, { file: 'session-map.json.before-x' }); ok(plan.ok && !plan.applied && plan.pairs.length === 10, JSON.stringify(plan).slice(0, 300));
  ok(plan.skipped.some((s) => s.tab === 'CT-CC-Master'), '총지휘 탭은 짝이 애매해 건너뜀'); ok(!has(k.ctx, 'config/role-windows.json'), '제안만 했는데 파일이 생김');
  for (const bad of ['..\\..\\evil.json', 'orchestration.json', 'session-map.json.', 'x/session-map.json.a b']) ok(!roleWindowSeed(k.ctx, { file: bad }).ok, `거절되어야 함: ${bad}`);
  const ap = roleWindowSeed(k.ctx, { file: 'session-map.json.before-x', apply: true }); ok(ap.ok && ap.applied, JSON.stringify(ap).slice(0, 200));
  const a = JSON.parse(read(k.ctx, 'config/role-windows.json')).assignments; eq([Object.keys(a).length, a['test-dispatcher'].by, a['test-dispatcher'].sid], [10, 'seed', SIDN(121)], '적용 결과');
  eq(roleWindowSeed(k.ctx, { file: 'session-map.json.before-x', apply: true }).pairs.length, 0, '이미 배정된 역할은 건드리지 않음');
});
// ======================= 역할 감시: 역할 단위로, 바뀔 때만 알린다 (W) =======================
const RES = (roles, extras = [], available = true) => (available ? { ok: true, available: true, headline: `역할 ${roles.length}개 중 ${roles.filter((r) => r[3] === 'ok').length}개 정상`, roles: roles.map(([id, name, slot, status, address]) => ({ id, name, slot, status, address })), extras: extras.map((a) => ({ address: a })) } : { ok: true, available: false, note: '시험: hc 없음' });
const W_OK = [['verifier', '검증관', 3, 'ok', 't112'], ['test-dispatcher', '시험 지시', 6, 'ok', 't121']];
const W_SCRIPT = (seq) => { let i = 0; return () => seq[Math.min(i++, seq.length - 1)]; };
await check('(W-1) 감시 로직: 처음엔 기준선, 변화는 연속 2번 확인된 뒤에만 알리고, 잠깐 깜빡임은 알리지 않는다', () => {
  const gone = [W_OK[0], ['test-dispatcher', '시험 지시', 6, 'missing', null]];
  const w = makeWatcher({ confirm: 2, check: W_SCRIPT([RES(W_OK), RES(W_OK), RES(gone), RES(W_OK), RES(gone), RES(gone), RES(gone)]) });
  const s1 = w.step(); ok(s1.baseline && /역할 감시 시작 — 역할 2개 중 2개 정상/.test(s1.lines[0]), s1.lines.join('|'));
  eq(w.step().lines, [], '변화 없음'); eq(w.step().lines, [], '없음 1번 본 것만으로는 알리지 않음'); eq(w.step().lines, [], '곧바로 돌아오면 알리지 않음(깜빡임)');
  eq(w.step().lines, [], '다시 없음 1번째'); eq(w.step().lines, ['6번 시험 지시: 정상 → 없음'], '없음 2번 연속이면 알림'); eq(w.step().lines, [], '같은 상태는 다시 알리지 않음');
});
await check('(W-2) 감시 로직: 복구(없음→정상 + 새 주소)·창 교체·배정 안 된 새 창·점검 불가/재개를 역할 이름으로 알린다', () => {
  const gone = [W_OK[0], ['test-dispatcher', '시험 지시', 6, 'missing', null]];
  const back = [W_OK[0], ['test-dispatcher', '시험 지시', 6, 'ok', 't5y']];
  const swap = [['verifier', '검증관', 3, 'ok', 't1zz'], back[1]];
  const run = (seq) => { const w = makeWatcher({ confirm: 1, check: W_SCRIPT(seq) }); return seq.map(() => w.step().lines); };
  const L = run([RES(gone), RES(back), RES(swap), RES(swap, ['t1new']), RES(swap, []), RES(null, [], false), RES(swap)]);
  eq(L[1], ['6번 시험 지시: 없음 → 정상 (t5y)'], '복구'); eq(L[2], ['3번 검증관: 창 교체 t112 → t1zz (정상)'], '창 교체');
  eq(L[3], ['역할 탭에 배정 안 된 새 창: t1new'], '새 창'); eq(L[4], ['배정 안 된 창 사라짐: t1new'], '사라짐');
  eq(L[5], ['점검 불가: 시험: hc 없음'], '점검 불가'); eq(L[6], ['점검 다시 가능 — 역할 2개 중 2개 정상'], '재개(역할별 알림이 쏟아지지 않음)');
  eq(makeWatcher({ confirm: 1, check: W_SCRIPT([RES(null, [], false)]) }).step().lines, ['역할 감시 시작 — 점검 불가: 시험: hc 없음'], '처음부터 점검 불가');
});
await check('(W-3) 실제 프로세스(가짜 hc): 역할 창이 사라지면 "정상 → 없음", 돌아오면 "없음 → 정상"을 알리고, hc 는 ls --json 만·파일은 안 쓴다', async () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv(); k.assignAll();
  const fresh = () => { const m = JSON.parse(readFileSync(k.mapFile, 'utf8')); const s = new Date().toISOString(); for (const v of Object.values(m)) v.seen = s; writeFileSync(k.mapFile, JSON.stringify(m)); };
  fresh();
  const full = readFileSync(join(k.dir, 'ls.json'), 'utf8'); const j = JSON.parse(full);
  const without = JSON.stringify({ terminals: j.terminals.filter((t) => t.address !== 't112') });
  const homeBefore = treeHash(k.ctx.paths.home);
  const child = spawn(process.execPath, [join(ROOT, 'bin', 'role-watch.mjs')], { env: { ...k.ctx.env, ROLE_WATCH_MS: '250', ROLE_WATCH_CONFIRM: '2', ROLE_WATCH_FLUSH_MS: '150' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await sleep(900); ok(/역할 감시 시작 — 역할 12개 중 12개 정상/.test(out), `기준선: ${out}`);
    writeFileSync(join(k.dir, 'ls.json'), without); await sleep(1800); ok(/3번 검증관: 정상 → 없음/.test(out), `사라짐: ${out}`);
    fresh(); writeFileSync(join(k.dir, 'ls.json'), full); await sleep(1800); ok(/3번 검증관: 없음 → 정상 \(t112\)/.test(out), `돌아옴: ${out}`);
  } finally { child.kill(); }
  await sleep(200);
  ok(calls(k.dir).length > 3 && calls(k.dir).every((x) => x === 'ls --json'), `hc 호출: ${[...new Set(calls(k.dir))].join(' / ')}`);
  eq(treeHash(k.ctx.paths.home), homeBefore, '감시가 파일을 씀');
  ok(!/Error|오류/.test(out.replace(/감시 오류/g, '')), out);
});
await check('(W-4) 고아 방지: 감시를 켠 부모가 끝나면 감시도 스스로 끝난다(Monitor 만료 뒤 감시가 쌓이지 않게)', async () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv(); k.assignAll();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  // 부모가 감시를 띄우고 0.8초 뒤 종료. detached 로 띄워야 "부모가 죽어도 자식이 남는" 고아 상황이 된다(분리하지 않으면 Windows 가 자식을 같이 끝내 버려 시험이 아무것도 증명하지 못함)
  const src = `const {spawn}=require('node:child_process');const c=spawn(process.execPath,[${JSON.stringify(join(ROOT, 'bin', 'role-watch.mjs'))}],{stdio:'ignore',env:process.env,detached:true});c.unref();console.log(c.pid);setTimeout(()=>process.exit(0),2500);`;
  const parent = spawn(process.execPath, ['-e', src], { env: { ...k.ctx.env, ROLE_WATCH_MS: '250', ROLE_WATCH_FLUSH_MS: '150' }, stdio: ['ignore', 'pipe', 'ignore'] });
  let pid = ''; parent.stdout.on('data', (d) => { pid += d; });
  // PC 가 바쁠 때 node 시작이 느려도 흔들리지 않게 고정 대기 대신 번호가 찍힐 때까지 기다리고(최대 5초), 부모는 번호가 찍힌 뒤에도 2.5초 더 산다
  for (let i = 0; i < 50 && !String(pid).trim(); i++) await sleep(100);
  const cpid = Number(String(pid).trim()); ok(cpid > 0 && alive(cpid), `감시가 떠 있어야 함: ${pid}`);
  let gone = false; for (let i = 0; i < 30 && !gone; i++) { await sleep(200); gone = !alive(cpid); }
  if (!gone) { try { process.kill(cpid); } catch {} }
  ok(gone, '부모가 끝났는데 감시가 6초 안에 끝나지 않음(고아)');
});
// ======================= 세션키퍼 계약 v1: keeper-health.json (K-10~K-14, W-5~W-6) =======================
// 계약-세션키퍼-상태.md: 갱신 주기 60초 → 낡음 기준 intervalSec×2+30초(A) · state=warn 이거나 기록이 intervalSec×5(최소 6분) 넘게 낡으면 "없음"으로 단정하지 않음(B) · recovering 동안 알림 묶기(C)
const LOCAL_ISO = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };   // 계약: 시간대 표시 없는 지역 시각
const HEALTH = (ageSec, o = {}) => ({ v: 1, at: LOCAL_ISO(K_NOW - ageSec * 1000), intervalSec: 60, windows: 23, recognized: 23, ghost: 0, state: 'ok', since: '', reason: '', recovering: false, recoverySince: '', ...o });
const healthFile = (k) => join(dirname(k.mapFile), 'keeper-health.json');
const putH = (k, obj) => writeFileSync(healthFile(k), typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj));
await check('(K-10) 키퍼 점검 기록이 정상이면 보여 주기만 한다: 판정은 그대로이고, 키퍼 파일은 읽기만 한다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const k = kEnv(); k.assignAll(); const before = k.rc();
  eq([before.keeper.present, before.keeper.text], [false, null], '기록 파일이 없으면 옛 키퍼로 보고 경고로 단정하지 않음');
  putH(k, HEALTH(10)); const hb = sha(readFileSync(healthFile(k))), mb = sha(readFileSync(k.mapFile));
  const r = k.rc();
  eq([r.keeper.present, r.keeper.text, r.keeper.distrust, r.keeper.recovering, r.keeper.intervalSec], [true, '키퍼 정상 23/23', false, false, 60], JSON.stringify(r.keeper));
  eq([r.headline, r.summary.ok], [before.headline, 12], '판정은 기록 유무로 달라지지 않음');
  eq([sha(readFileSync(healthFile(k))), sha(readFileSync(k.mapFile))], [hb, mb], '키퍼 파일을 건드림');
});
await check('(K-11) 낡음 기준(A): 기본 150초(= 갱신 주기 60초×2+30), 기록에 intervalSec 가 있으면 그 값×2+30초', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const t = (age, h) => { const k = kEnv({ ageSec: age }); k.assignAll(); if (h) putH(k, h); return k.rc().summary; };
  eq([t(140).ok, t(140).unknown], [12, 0], '140초 전 기록은 아직 믿음(옛 기준 120초였다면 확인 불가가 됐을 것)');
  eq([t(160).ok, t(160).unknown], [0, 12], '160초 전 기록은 믿지 않음');
  eq(t(200, HEALTH(10, { intervalSec: 120 })).ok, 12, '주기 120초면 270초까지 믿음');
  eq(t(200).ok, 0, '같은 200초라도 기록이 없으면 기본 150초 기준이라 믿지 않음');
  eq(t(160, HEALTH(10, { intervalSec: 1 })).ok, 0, '말이 안 되는 주기(1초)는 무시하고 60초로 봄');
});
await check('(K-12) 키퍼가 경고이거나 점검 기록이 낡았으면 창이 안 보여도 "없음"이라 단정하지 않는다(B)', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const st = (h) => { const k = kEnv({ drop: ['verifier'] }); k.assignAll(); if (h !== undefined) putH(k, h); const r = k.rc(); return [stOf(r, 'verifier'), r.summary]; };
  eq(st()[0].status, 'missing', '기록 없음 = 옛 키퍼: 지금까지처럼 "없음"');
  eq(st(HEALTH(10))[0].status, 'missing', '키퍼 정상이면 "없음"');
  const w = st(HEALTH(10, { state: 'warn', since: '2026-11-19T05:00:00', reason: '창 23개 중 0개만 인식', recognized: 0 }));
  eq(w[0].status, 'unknown', '키퍼 경고'); ok(/키퍼 점검 경고 0\/23/.test(w[0].note) && /창 23개 중 0개만 인식/.test(w[0].note), w[0].note); eq(w[1].ok, 11, '나머지 역할 판정은 그대로');
  eq(st(HEALTH(500))[0].status, 'unknown', '점검 기록이 500초(>360초) 낡음'); ok(/멈췄을 수 있음/.test(st(HEALTH(500))[0].note), st(HEALTH(500))[0].note);
  eq(st(HEALTH(200))[0].status, 'missing', '200초 낡음은 아직 경고 아님');
  eq(st(HEALTH(500, { intervalSec: 120 }))[0].status, 'missing', '주기 120초면 600초까지는 낡음이 아님');
  eq(st(HEALTH(700, { intervalSec: 120 }))[0].status, 'unknown', '주기 120초의 5배(600초) 넘게 낡음');
  eq(st(HEALTH(10, { state: 'mystery' }))[0].status, 'unknown', '모르는 state 값은 믿지 않는 쪽');
});
await check('(K-13) 깨지거나 모르는 형식의 점검 기록은 무시하고(점검은 그대로) 이유만 남긴다 — 점검이 죽지 않는다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const bad = ['{bad', '[]', '"x"', JSON.stringify(HEALTH(10, { v: 2 })), Buffer.from([0xff, 0xfe, 0x41]), 'x'.repeat(70 * 1024)];
  for (const h of bad) {
    const k = kEnv({ drop: ['verifier'] }); k.assignAll(); putH(k, h);
    let r; try { r = k.rc(); } catch (e) { ok(false, `예외: ${e.message}`); }
    ok(r.ok && r.available && r.keeper.present === false && r.keeper.error, `무시해야 함: ${String(h).slice(0, 20)} → ${JSON.stringify(r.keeper)}`);
    eq(stOf(r, 'verifier').status, 'missing', '기록이 쓸모없으면 옛 키퍼와 같은 판정');
  }
  const k = kEnv(); k.assignAll(); putH(k, '﻿' + JSON.stringify(HEALTH(10))); eq(k.rc().keeper.present, true, 'BOM 이 붙어 있어도 읽음');
  const k2 = kEnv(); k2.assignAll(); putH(k2, JSON.stringify({ ...HEALTH(10), 새필드: 1, windows: 'x' })); const r2 = k2.rc(); ok(r2.keeper.present && r2.keeper.windows === null && /키퍼 정상$/.test(r2.keeper.text), '모르는 필드는 무시, 이상한 값은 비움: ' + JSON.stringify(r2.keeper));
});
await check('(K-14) 복구 중 표시(recovering): 복구 시작 시각(35분 안)으로 믿는다 — 대량 복구 중에는 at 이 갱신되지 않아 낡아 보이기 때문', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const rec = (age, since) => { const k = kEnv(); k.assignAll(); putH(k, HEALTH(age, { recovering: true, recoverySince: since === undefined ? LOCAL_ISO(K_NOW - 120000) : since })); return k.rc().keeper; };
  const a = rec(100); eq([a.recovering, a.stale], [true, false], JSON.stringify(a)); ok(/키퍼 복구 중 \(/.test(a.text), a.text);
  const b = rec(500); eq([b.recovering, b.stale], [true, true], '점검 기록이 500초 낡아도(복구 중 갱신 멈춤) 복구 시작이 2분 전이면 복구 중으로 믿음: ' + JSON.stringify(b)); ok(/복구 중에는 갱신이 늦어짐/.test(b.text), b.text);
  eq(rec(2000, LOCAL_ISO(K_NOW - 20 * 60000)).recovering, true, '복구가 20분째여도(재시도로 길어진 경우) 믿음');
  eq(rec(100, LOCAL_ISO(K_NOW - 40 * 60000)).recovering, false, '35분을 넘긴 복구 표시는 키퍼가 비정상 종료해 true 로 남은 것으로 보고 믿지 않음');
  eq(rec(100, LOCAL_ISO(K_NOW + 3600000)).recovering, false, '미래 시각은 믿지 않음');
  eq([rec(100, '').recovering, rec(500, '').recovering], [true, false], '시작 시각이 없으면 예전처럼 기록이 낡지 않았을 때만 믿음');
});
await check('(K-15) 세션 ID 가 바뀐 경우(/clear·새 대화로 열림): "없음"+"새 창" 오보 대신 추정으로 알리고, 애매하거나 근거가 약하면 추정하지 않는다', () => {
  if (!CSC) return { skip: 'csc.exe 가 없어 가짜 hc 를 만들 수 없음' };
  const NEW1 = 'aaaaaaaa-1111-4111-8111-bbbbbbbbbbbb', NEW2 = 'bbbbbbbb-2222-4222-8222-cccccccccccc';
  const chg = (pairs, o = {}) => { const k = kEnv(o); k.assignAll(); const m = JSON.parse(readFileSync(k.mapFile, 'utf8')); for (const [addr, sid] of pairs) m[addr].sid = sid; writeFileSync(k.mapFile, JSON.stringify(m)); return k; };
  const k1 = chg([['t100', NEW1]]); const r1 = k1.rc(); const c = stOf(r1, 'commander');
  eq([c.status, c.address, r1.summary.guess, r1.summary.missing, r1.extras.length], ['guess', 't100', 1, 0, 0], '총지휘 /clear: ' + JSON.stringify(c)); ok(/세션 ID 가 바뀐 것 같습니다/.test(c.note) && c.note.includes('00000100') && c.note.includes('aaaaaaaa') && /role-window-set/.test(c.note), c.note);
  ok(/추정만 1/.test(r1.headline) && !/미배정 창/.test(r1.headline), r1.headline);
  const r2 = chg([['t110', NEW1]]).rc(); eq([stOf(r2, 'approval-reviewer').status, stOf(r2, 'approval-reviewer').address, stOf(r2, 'ledger-keeper').status], ['guess', 't110', 'ok'], '창이 4개인 탭에서 1개만 바뀜');
  const r3 = chg([['t110', NEW1], ['t111', NEW2]]).rc(); eq([r3.summary.guess, r3.summary.missing, r3.extras.length], [0, 2, 2], '같은 탭에서 둘이 바뀌면 어느 창이 누구인지 알 수 없어 추정하지 않음(기존 판정 유지)');
  const r4 = chg([['t100', NEW1]], { ageSec: 600 }).rc(); eq([r4.summary.guess, r4.summary.unknown], [0, 12], '키퍼 기록이 낡았으면 추정하지 않음(확인 불가)');
  const r5 = (() => { const k = kEnv({ drop: ['commander'] }); k.assignAll(); return k.rc(); })(); eq([stOf(r5, 'commander').status, r5.summary.guess], ['missing', 0], '창이 정말 없어진 경우는 그대로 없음');
  const r6 = (() => { const k = kEnv({ drop: ['commander'], extra: [{ n: 190, tab: 'CT-CC-5,6,7,8' }] }); k.assignAll(); return k.rc(); })(); eq([stOf(r6, 'commander').status, r6.summary.guess], ['missing', 0], '다른 탭의 새 창은 후보가 아님');
  const wl = roleWindowSet(k1.ctx, { id: 'commander', address: 't100', now: K_NOW }); ok(wl.ok, JSON.stringify(wl)); eq([k1.rc().summary.ok, k1.rc().summary.guess], [12, 0], '안내대로 role-window-set 으로 고치면 정상으로 돌아옴');
});
const KP = (o = {}) => ({ present: true, stale: false, degraded: false, recovering: false, text: '키퍼 정상 23/23', ...o });
const RK = (roles, extras, keeper) => ({ ...RES(roles, extras), keeper });
await check('(W-5) 복구 중에는 창 교체·새 창 알림을 묶고, 끝나고 결과가 안정되면 요약 한 줄만 낸다(C)', () => {
  const moved = [['verifier', '검증관', 3, 'ok', 't1zz'], ['test-dispatcher', '시험 지시', 6, 'ok', 't1yy']];
  const seq = [RK(W_OK, [], KP()),
    RK(moved, ['t1n1'], KP({ recovering: true })), RK(moved, ['t1n1', 't1n2'], KP({ recovering: true })), RES(null, [], false), RK(moved, ['t1n1', 't1n2'], KP({ recovering: true })),
    RK(moved, [], KP()), RK(moved, [], KP()), RK(moved, [], KP()), RK(moved, [], KP())];
  const w = makeWatcher({ confirm: 2, check: W_SCRIPT(seq), holdMaxMs: 60000 }); const out = seq.map(() => w.step().lines);
  eq(out[0].length, 1, '기준선'); eq(out.slice(1, 5), [[], [], [], []], '복구 중(점검 불가가 끼어도 묶음 유지)에는 아무것도 알리지 않음');
  eq(out[5], [], '복구가 끝난 첫 점검은 아직 알리지 않음(복구 직후 기록 지연을 거름)'); eq(out[6].length, 1, '안정되면 한 줄'); ok(/^세션키퍼 복구가 끝남 — 역할 2개 중 2개 정상$/.test(out[6][0]), out[6][0]);
  eq([out[7], out[8]], [[], []], '그 뒤로는 같은 상태를 다시 알리지 않음');
  ok(!out.flat().some((l) => /창 교체|새 창|점검 불가/.test(l)), '묶였어야 할 알림이 샜음: ' + out.flat().join(' | '));
  const f = makeWatcher({ confirm: 2, check: W_SCRIPT([RK(W_OK, [], KP()), RK(moved, [], KP({ recovering: true })), RK(moved, [], KP()), RK(moved, [], KP({ recovering: true })), RK(moved, [], KP()), RK(moved, [], KP())]), holdMaxMs: 60000 });
  eq([f.step().lines.length, f.step().lines, f.step().lines, f.step().lines, f.step().lines, f.step().lines.length], [1, [], [], [], [], 1], '복구가 끝났다가 다시 시작하면(깜빡임) 끝날 때까지 기다렸다가 한 번만 알림');
  const b = makeWatcher({ confirm: 2, check: W_SCRIPT([RK(W_OK, [], KP({ recovering: true }))]), holdMaxMs: 60000 }).step().lines; ok(b.length === 2 && /복구 중이라 .*묶어 두고/.test(b[1]), '처음부터 복구 중이면 기준선에 그 사실을 적음: ' + b.join('|'));
});
await check('(W-6) 복구 표시가 끝나지 않아도 상한(기본 15분)이 지나면 묶기를 풀어 알림이 영영 막히지 않게 하고, 키퍼 점검 경고는 한 줄로 알린다', () => {
  const moved = [['verifier', '검증관', 3, 'ok', 't1zz'], W_OK[1]];
  let t = 0; const seq = [RK(W_OK, [], KP()), ...Array(6).fill(RK(moved, [], KP({ recovering: true })))];
  const w = makeWatcher({ confirm: 2, check: W_SCRIPT(seq), holdMaxMs: 1000, now: () => t });
  w.step(); const out = []; for (const at of [300, 600, 900, 1500, 2100, 2700]) { t = at; out.push(w.step().lines); }   // 묶기는 첫 복구 표시(300)부터 시작
  eq([out[0], out[1], out[2]], [[], [], []], '상한 전에는 묶음'); ok(out[3].length === 1 && /복구 표시가 \d+분 넘게 계속되어 알림 묶기를 풀었습니다/.test(out[3][0]), '상한이 지나면 한 번 알림: ' + out[3].join('|'));
  ok(out.slice(4).flat().some((l) => /3번 검증관: 창 교체 t112 → t1zz/.test(l)), '묶기를 푼 뒤에는 변화를 알림: ' + out.flat().join(' | '));
  eq(out.flat().filter((l) => /묶기를 풀었습니다/.test(l)).length, 1, '풀었다는 알림은 한 번만');
  const wr = makeWatcher({ confirm: 1, check: W_SCRIPT([RK(W_OK, [], KP()), RK(W_OK, [], KP({ degraded: true, text: '키퍼 점검 경고 3/23 — 창 23개 중 3개만 인식' })), RK(W_OK, [], KP()), RK(W_OK, [], KP({ degraded: true, text: 'x' })), RK(W_OK, [], { present: true, stale: true, text: '낡음' })]) });
  wr.step(); eq(wr.step().lines, ['세션키퍼: 키퍼 점검 경고 3/23 — 창 23개 중 3개만 인식'], '경고 시작'); eq(wr.step().lines, ['세션키퍼: 점검 정상으로 돌아옴'], '경고 끝');
  wr.step(); eq(wr.step().lines, ['세션키퍼: 점검 경고 표시가 사라짐(점검 기록이 없거나 오래됨)'], '기록이 낡아 경고를 더는 모름');
});
await check('(W-7) 복구 중에는 키퍼 점검 기록이 낡아 보여도(대량 복구 중 갱신 멈춤) 알림을 계속 묶고, 낡았는데 복구 중이 아니면 키퍼 상태를 알림에 쓰지 않는다', () => {
  const moved = [['verifier', '검증관', 3, 'ok', 't1zz'], ['test-dispatcher', '시험 지시', 6, 'ok', 't1yy']];
  const w = makeWatcher({ confirm: 2, check: W_SCRIPT([RK(W_OK, [], KP()), RK(moved, ['t1n1'], KP({ stale: true, recovering: true })), RK(moved, ['t1n1'], KP({ stale: true, recovering: true })), RK(moved, [], KP()), RK(moved, [], KP())]), holdMaxMs: 60000 });
  const o = [1, 2, 3, 4, 5].map(() => w.step().lines);
  eq([o[0].length, o[1], o[2], o[3]], [1, [], [], []], '복구 중(기록 낡음)에도 묶음'); ok(o[4].length === 1 && /^세션키퍼 복구가 끝남/.test(o[4][0]), o[4].join('|'));
  const x = makeWatcher({ confirm: 1, check: W_SCRIPT([RK(W_OK, [], KP()), RK(W_OK, [], KP({ stale: true, degraded: true, text: '낡음' }))]) }); x.step(); eq(x.step().lines, [], '낡았고 복구 중도 아니면 경고로 알리지 않음(그건 map 쪽 점검 불가가 다룸)');
});
await check('(N-2) 끝난 뒤: 엔진이 만든 임시 폴더가 남지 않고, 이 PC의 실제 설정은 바이트 동일 (R11)', () => {
  eq(scratchCount(), scratchBefore, '남은 orch-manage-* 임시 폴더');
  eq(treeHash(REAL), realBefore, '실제 설정 폴더');
  eq(treeHash(join(ROOT, 'roles')) + treeHash(join(ROOT, 'templates')) + treeHash(join(ROOT, 'schema')), bundleBefore, '번들');
});

console.log(`\n시험 폴더(지우지 않음): ${BASE}`);
console.log(`PASS ${pass} / FAIL ${fail} / SKIP ${skip}`);
process.exit(fail ? 1 : 0);
