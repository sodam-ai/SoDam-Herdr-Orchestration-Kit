// manage-lib: 관리 도구 엔진 (02_관리도구-설계서.md). 현황 · 역할 편집 · 내보내기/불러오기 · 백업/복구.
// 모든 함수는 ctx(경로 묶음)를 받아서 시험할 수 있다. 어느 창에도 아무것도 보내지 않고 hc 를 부르지 않는다.
// 원칙: 번들은 읽기 전용 / 내 설정 층(config\)의 화이트리스트 파일만 다룬다 / 결과가 검증을 통과해야만 쓴다(실패 쪽으로 닫힘) /
//       바꾸기 전에 자동 백업 / 쓰기는 파일 단위 임시 파일 → 이름 바꾸기 / 사용자 폴더·백업 폴더는 지우지 않는다(파일 하나씩만).
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, lstatSync, renameSync, unlinkSync, openSync, closeSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve, sep, dirname, basename } from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { ROOT, ID_PATTERN, readUtf8Strict, parseRoleFile, loadRoles, loadRolesLayered, readHeaderTemplate, parseEnvRules } from './orch-lib.mjs';
import { sha256, parseConfig, defaultConfig, buildOutputs, buildLayoutPlan, unsetKeys, PLACEHOLDER } from './sync-lib.mjs';
import { resolvePaths } from '../lib/orch-paths.mjs';

export const PACKAGE_FORMAT = 1;
export const LIMITS = { maxFileBytes: 200 * 1024, maxFiles: 200, maxNote: 200, staleLockMs: 10 * 60 * 1000, backupWarnCount: 50 };
const KIT = 'herdr-orchestration';
const CONFIG_FILES = ['orchestration.json', 'env-rules.md', 'ignore.txt', 'order.txt'];
const PC_ONLY = new Set(['orchestration.json', 'order.txt']);        // 이 PC 고유 설정: 불러오기로는 바꾸지 않고 복구(내 백업)로만 바꾼다
const PORTABLE = new Set(['env-rules.md', 'ignore.txt']);            // portable 범위: roles + 이 둘
export const SCOPES = ['portable', 'full'];
export const PATH_RE = /^config\/(?:orchestration\.json|env-rules\.md|ignore\.txt|order\.txt|roles\/[a-z][a-z0-9-]{1,30}\.md)$/;
export const EDITABLE_FIELDS = ['name', 'summary', 'slot', 'kind', 'mode', 'writes_to', 'reports_to', 'cadence', 'enabled', 'replaces', 'needs', 'version'];
const FIELD_ORDER = ['id', 'name', 'summary', 'slot', 'kind', 'mode', 'writes_to', 'reports_to', 'cadence', 'enabled', 'replaces', 'needs', 'version'];

export function makeCtx({ env = process.env, root = ROOT } = {}) {
  const paths = resolvePaths(env);
  return { env, root, paths, backups: join(paths.home, 'backups'), lockFile: join(paths.state, 'manage.lock'), version: readVersion(root) };
}
function readVersion(root) { try { return readFileSync(join(root, 'VERSION'), 'utf8').trim(); } catch { return 'unknown'; } }

const abs = (ctx, rel) => {
  const full = resolve(ctx.paths.home, ...rel.split('/'));
  if (!full.startsWith(resolve(ctx.paths.home) + sep)) throw new Error(`홈 밖 경로: ${rel}`);
  return full;
};
const stamp = (d = new Date()) => { const p = (n, w = 2) => String(n).padStart(w, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const cleanNote = (n) => String(n ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.maxNote);
const fail = (errors, extra = {}) => ({ ok: false, errors: Array.isArray(errors) ? errors : [String(errors)], ...extra });

function writeAtomic(full, buf) {
  mkdirSync(dirname(full), { recursive: true });
  const tmp = `${full}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`;
  try { writeFileSync(tmp, buf); renameSync(tmp, full); }
  catch (e) { try { unlinkSync(tmp); } catch { /* 없으면 그만 */ } throw e; }
}
const isText = (rel) => /\.(md|txt|json)$/.test(rel);
function decodeStrict(buf) { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }

// ---------- 내 설정 층 읽기 ----------
// 돌려주는 것: files(Map rel→Buffer), skipped([{path,reason}])
export function collectUserFiles(ctx) {
  const files = new Map(); const skipped = [];
  const take = (rel, full) => {
    let st; try { st = lstatSync(full); } catch { return; }
    if (st.isSymbolicLink()) { skipped.push({ path: rel, reason: '심볼릭 링크는 읽지 않음' }); return; }
    if (!st.isFile()) return;
    if (st.size > LIMITS.maxFileBytes) { skipped.push({ path: rel, reason: `파일이 너무 큼(${st.size}바이트, 상한 ${LIMITS.maxFileBytes})` }); return; }
    files.set(rel, readFileSync(full));
  };
  for (const n of CONFIG_FILES) take(`config/${n}`, join(ctx.paths.config, n));
  const rd = ctx.paths.roles;
  let rst = null; try { rst = lstatSync(rd); } catch { /* 폴더 없음 */ }
  if (rst) {
    if (rst.isSymbolicLink() || !rst.isDirectory()) skipped.push({ path: 'config/roles', reason: '내 역할 폴더가 폴더가 아니거나 링크임' });
    else for (const f of readdirSync(rd).sort()) {
      if (!f.endsWith('.md')) continue;
      if (!ID_PATTERN.test(f.slice(0, -3))) { skipped.push({ path: `config/roles/${f}`, reason: '파일 이름이 역할 id 형식이 아님' }); continue; }
      take(`config/roles/${f}`, join(rd, f));
    }
  }
  return { files, skipped };
}
const inScope = (rel, scope) => scope === 'full' || rel.startsWith('config/roles/') || PORTABLE.has(rel.slice('config/'.length));

// ---------- 후보 검증: 기존 sync 를 임시 폴더에서 그대로 돌린다(규칙을 다시 쓰지 않는다) ----------
// files: 내 설정 층 전체(Map rel→Buffer). 임시 폴더는 이 함수가 만든 것만 지운다.
export function checkCandidate(ctx, files) {
  const scratch = mkdtempSync(join(os.tmpdir(), 'orch-manage-'));
  try {
    const rolesDir = join(scratch, 'roles'); mkdirSync(rolesDir);
    for (const [rel, buf] of files) if (rel.startsWith('config/roles/')) writeFileSync(join(rolesDir, basename(rel)), buf);
    const warnings = [];
    let fellBack = false;
    const cfgPath = join(scratch, 'orchestration.json');
    let cfgText = null;
    const raw = files.get('config/orchestration.json');
    if (raw) { try { cfgText = decodeStrict(raw); } catch { cfgText = null; } }
    if (cfgText !== null && parseConfig(cfgText).config) writeFileSync(cfgPath, cfgText);
    else {
      fellBack = true;
      writeFileSync(cfgPath, JSON.stringify(defaultConfig({ orchHome: join(scratch, 'home'), functionsDir: join(ctx.root, 'functions') }), null, 2));
      warnings.push(raw ? '설정 파일에 문제가 있어 기본 설정으로 역할만 점검했습니다' : '설정 파일이 없어 기본 설정으로 역할만 점검했습니다');
    }
    const args = [join(ctx.root, 'bin', 'sync.mjs'), '--config', cfgPath, '--user-roles-dir', rolesDir, '--out', join(scratch, 'out')];
    const er = files.get('config/env-rules.md');
    if (er) { writeFileSync(join(scratch, 'env-rules.md'), er); args.push('--env-rules', join(scratch, 'env-rules.md')); }
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, ORCH_HOME: join(scratch, 'home') }, timeout: 120000 });
    const realCfg = join(ctx.paths.config, 'orchestration.json');
    const clean = (s) => s.split(cfgPath).join(realCfg).split(scratch).join('(임시 폴더)');
    const lines = `${r.stderr ?? ''}`.split('\n').map((s) => clean(s.trimEnd())).filter(Boolean).filter((s) => !(fellBack && s.startsWith('경고: 설정')));
    if (r.status === 0) return { ok: true, errors: [], warnings: [...warnings, ...lines] };
    return { ok: false, errors: lines.length ? lines : [`검증 실행 실패(종료코드 ${r.status})`], warnings };
  } finally {
    if (dirname(scratch) === resolve(os.tmpdir()) && basename(scratch).startsWith('orch-manage-')) rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------- 묶음(패키지): 내보내기·백업 ----------
export function writePackage(ctx, opts) {
  try { return writePackageUnsafe(ctx, opts); }
  catch (e) { return fail([`묶음을 만들 수 없습니다: ${e.code ?? ""} ${e.message}`]); }
}
function writePackageUnsafe(ctx, { dest, scope, kind, note, files, now = new Date() }) {
  mkdirSync(dest, { recursive: true });
  let dir, n = 0;
  for (;;) {
    dir = join(dest, `orch-${kind}-${stamp(now)}${n ? `-${n + 1}` : ''}`);
    try { mkdirSync(dir); break; } catch (e) { if (e.code !== 'EEXIST' || ++n > 99) throw e; }
  }
  const list = [];
  for (const [rel, buf] of [...files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    writeAtomic(join(dir, ...rel.split('/')), buf);
    list.push({ path: rel, sha256: sha256(buf), bytes: buf.length });
  }
  const manifest = { format: PACKAGE_FORMAT, kit: KIT, version: ctx.version, createdAt: now.toISOString(), kind, scope, note: cleanNote(note), files: list };
  writeAtomic(join(dir, 'package.json'), Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'));
  const back = readPackage(dir);                       // 쓴 것을 다시 읽어 확인
  if (!back.ok) return fail(['묶음을 만들었지만 다시 읽어 확인하지 못했습니다', ...back.errors], { dir });
  return { ok: true, dir, files: list.length, scope, kind };
}

export function exportPackage(ctx, { dest, scope = 'portable', note = '', now } = {}) {
  if (!SCOPES.includes(scope)) return fail(`알 수 없는 범위: ${scope}`);
  if (typeof dest !== 'string' || dest.trim() === '') return fail('내보낼 폴더를 지정하세요');
  const { files, skipped } = collectUserFiles(ctx);
  const pick = new Map([...files].filter(([rel]) => inScope(rel, scope)));
  if (pick.size === 0) return fail('내보낼 파일이 없습니다(내 역할·환경 규칙이 아직 없음)', { skipped });
  const r = writePackage(ctx, { dest: resolve(dest), scope, kind: 'export', note, files: pick, now });
  return { ...r, skipped };
}

export function backupNow(ctx, { note = '', now } = {}) {
  const { files, skipped } = collectUserFiles(ctx);
  if (files.size === 0) return { ok: true, empty: true, dir: null, files: 0, skipped };
  const r = writePackage(ctx, { dest: ctx.backups, scope: 'full', kind: 'backup', note, files, now });
  return { ...r, skipped };
}

// 묶음을 읽고 검증한다(R2~R6). 오류는 모아서 돌려주고 하나라도 있으면 ok:false.
export function readPackage(pkgDir) {
  const errors = [];
  const add = (m) => { if (errors.length < 30) errors.push(m); };
  if (typeof pkgDir !== 'string' || !existsSync(pkgDir) || !lstatSync(pkgDir).isDirectory()) return fail('묶음 폴더가 아님');
  const mf = join(pkgDir, 'package.json');
  if (!existsSync(mf)) return fail('package.json 이 없음(이 도구가 만든 묶음이 아님)');
  let manifest;
  try { manifest = JSON.parse(readUtf8Strict(mf).replace(/^﻿/, '')); } catch (e) { return fail(`package.json 을 읽을 수 없음: ${e.message}`); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return fail('package.json 형식이 맞지 않음');
  if (manifest.format !== PACKAGE_FORMAT) return fail(`모르는 묶음 형식 ${JSON.stringify(manifest.format)} (이 도구는 ${PACKAGE_FORMAT} 만 앎)`);
  if (manifest.kit !== KIT) return fail('다른 도구의 묶음임');
  if (!SCOPES.includes(manifest.scope)) return fail(`알 수 없는 범위: ${JSON.stringify(manifest.scope)}`);
  if (!Array.isArray(manifest.files)) return fail('files 목록이 없음');
  if (manifest.files.length > LIMITS.maxFiles) return fail(`파일이 너무 많음(${manifest.files.length}개, 상한 ${LIMITS.maxFiles})`);
  const seen = new Set(); const files = new Map();
  for (const e of manifest.files) {
    const p = e && e.path;
    if (typeof p !== 'string' || !PATH_RE.test(p)) { add(`허용되지 않는 경로: ${JSON.stringify(p)}`); continue; }
    if (seen.has(p)) { add(`같은 경로가 두 번 있음: ${p}`); continue; }
    seen.add(p);
    if (!inScope(p, manifest.scope)) { add(`범위(${manifest.scope})에 없는 파일: ${p}`); continue; }
    if (!/^[0-9a-f]{64}$/.test(e.sha256 ?? '') || !Number.isInteger(e.bytes) || e.bytes < 0) { add(`기록 형식 오류: ${p}`); continue; }
    if (e.bytes > LIMITS.maxFileBytes) { add(`파일이 너무 큼: ${p} (${e.bytes}바이트, 상한 ${LIMITS.maxFileBytes})`); continue; }
    const full = join(pkgDir, ...p.split('/'));
    let st; try { st = lstatSync(full); } catch { add(`기록에 있는데 파일이 없음: ${p}`); continue; }
    if (st.isSymbolicLink()) { add(`심볼릭 링크는 받지 않음: ${p}`); continue; }
    if (!st.isFile()) { add(`파일이 아님: ${p}`); continue; }
    const buf = readFileSync(full);
    if (buf.length !== e.bytes) { add(`크기가 기록과 다름(변조 또는 손상): ${p}`); continue; }
    if (sha256(buf) !== e.sha256) { add(`내용이 기록과 다름(변조 또는 손상): ${p}`); continue; }
    if (isText(p)) { try { decodeStrict(buf); } catch { add(`UTF-8 글자 형식이 아님: ${p}`); continue; } }
    files.set(p, buf);
  }
  // 기록에 없는 파일·링크·알 수 없는 항목
  const walk = (d, rel) => {
    for (const name of readdirSync(d)) {
      const r = rel ? `${rel}/${name}` : name; const full = join(d, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) { add(`심볼릭 링크는 받지 않음: ${r}`); continue; }
      if (st.isDirectory()) { walk(full, r); continue; }
      if (r === 'package.json') continue;
      if (!seen.has(r)) add(`기록에 없는 파일이 들어 있음: ${r}`);
    }
  };
  walk(pkgDir, '');
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], manifest, files };
}

// ---------- 불러오기/복구 계획 ----------
// trust=false: 남의 묶음일 수 있음 → PC 설정은 건드리지 않고, 환경 규칙은 includeEnvRules 일 때만, 달라지는 역할은 꺼 둔 채로 들인다.
// trust=true : 내 백업 복구 → 그대로.
// 남의 묶음의 역할을 "꺼진 채"로 만든다. 파서(parseRoleFile)와 읽는 방식이 어긋나면 꺼지지 않은 채 들어올 수 있으므로(앞에 BOM 이 둘 이상이거나
// `enabled : true` 처럼 쓴 경우 등), 다시 쓴 결과를 **실제 파서로 다시 읽어** enabled 가 false 인지 확인하고, 아니면 null 을 돌려줘 불러오기를 거절한다(안전 쪽으로 실패).
const stripBoms = (t) => t.replace(/^\uFEFF+/, '');
function forceDisabled(buf) {
  const text = stripBoms(decodeStrict(buf)).replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end < 0) return null;                     // 머리말을 못 읽으면 꺼진 상태를 보장할 수 없으니 거절
  let done = false;
  for (let i = 1; i < end; i++) if (/^enabled:/.test(lines[i])) { lines[i] = 'enabled: false'; done = true; }
  if (!done) lines.splice(1, 0, 'enabled: false');
  const out = Buffer.from(lines.join('\n'), 'utf8');
  let p; try { p = parseRoleFile(decodeStrict(out)); } catch { return null; }
  return p.meta && p.meta.enabled === false ? out : null;             // 실제 파서가 꺼진 것으로 읽을 때만 받는다
}
// 머리말의 한 줄만 바꾼다(없으면 첫 줄 뒤에 넣는다). 나머지 글자는 그대로.
function setHeaderLine(buf, key, valueText) {
  const lines = stripBoms(decodeStrict(buf)).replace(/\r\n?/g, '\n').split('\n');
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end < 0) return buf;
  let done = false;
  for (let i = 1; i < end; i++) if (lines[i].startsWith(key + ':')) { lines[i] = key + ': ' + valueText; done = true; }
  if (!done) lines.splice(1, 0, key + ': ' + valueText);
  return Buffer.from(lines.join('\n'), 'utf8');
}
// 가져오는 "새 역할"의 자리(slot)가 내 쪽 worker 와 겹치면 빈 자리로 옮긴다. 번들 역할을 덮어쓰는 파일은 건드리지 않는다.
function adjustSlots(ctx, cand, incoming) {
  const bundle = loadRoles(join(ctx.root, 'roles')).filter((r) => !r.errors.length);
  const bundleIds = new Set(bundle.map((r) => r.meta.id));
  const metaOf = (buf) => { try { return parseRoleFile(decodeStrict(buf)).meta; } catch { return {}; } };
  const workers = new Map();                                            // id → slot (효과 상태의 worker)
  for (const r of bundle) { const o = cand.get('config/roles/' + r.meta.id + '.md'); const m = o ? { ...r.meta, ...metaOf(o) } : r.meta; if (m.kind === 'worker') workers.set(r.meta.id, m.slot); }
  const mineNew = [...cand.keys()].filter((rel) => rel.startsWith('config/roles/') && !bundleIds.has(basename(rel, '.md'))).sort();
  for (const rel of mineNew) if (!incoming.has(rel)) { const m = metaOf(cand.get(rel)); if (m.kind === 'worker') workers.set(basename(rel, '.md'), m.slot); }
  const notes = [];
  for (const rel of mineNew.filter((r) => incoming.has(r))) {
    const id = basename(rel, '.md'); const m = metaOf(cand.get(rel));
    if (m.kind !== 'worker' || !Number.isInteger(m.slot) || m.slot < 1) continue;
    const taken = new Set(workers.values());
    if (taken.has(m.slot)) {
      let s = 1; while (taken.has(s)) s++;
      cand.set(rel, setHeaderLine(cand.get(rel), 'slot', String(s))); incoming.set(rel, cand.get(rel));
      workers.set(id, s); notes.push({ path: rel, from: m.slot, to: s, message: '역할 ' + id + ': 자리 ' + m.slot + '이(가) 이미 쓰이고 있어 ' + s + '번으로 옮겼습니다' });
    } else workers.set(id, m.slot);
  }
  return notes;
}
// pending 은 각 줄을 창 주소에 `-like "*줄*"` 로 맞춘다. 넓은 줄 하나가 모든 승인 대기 창을 숨길 수 있으므로 남의 묶음의 줄은 좁게만 허용한다.
// 검증하는 쪽(여기)과 읽는 쪽(PowerShell Get-Content + .NET Trim)이 줄을 다르게 나누거나 다르게 다듬으면 검사를 우회할 수 있다.
// 실제로 확인한 차이: 단독 CR 은 PowerShell 이 줄 끝으로 보고(ab CR cd = 2줄), U+0085 는 .NET Trim 이 공백으로 잘라 낸다. 그래서 두 해석이 갈릴 수 있는 글자는 아예 받지 않는다.
function badIgnoreLines(buf) {
  const text = decodeStrict(buf);
  const bad = [];
  if (/\r(?!\n)/.test(text)) bad.push('(단독 CR 줄바꿈 — 줄을 나누는 방식이 읽는 쪽과 달라짐)');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u180e\u200b-\u200f\u2028\u2029\u2060\ufeff]/.test(text)) bad.push('(제어 글자·특수 공백 — 다듬는 방식이 읽는 쪽과 달라짐)');
  for (const raw of text.split(/\r\n|\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith('#')) continue;
    // 백틱은 -like 의 이스케이프라 `a`b(4글자)가 ab(2글자)만 맞춘다(실측). 길이 규칙을 속일 수 있으므로 받지 않는다.
    if ([...s].length < 3 || /[*?[\]`]/.test(s)) bad.push(s);
  }
  return bad;
}
const roleLine = (buf, rel, bundleIds = new Set()) => {
  if (!rel.startsWith('config/roles/') || !buf) return null;
  try { const p = parseRoleFile(decodeStrict(buf)); const id = basename(rel, '.md'); return { id, name: p.meta.name ?? null, enabled: p.meta.enabled ?? null, bundle: bundleIds.has(id) }; } catch { return null; }
};
const clip = (buf) => { if (!buf) return null; const t = decodeStrict(buf); return t.length > 20000 ? `${t.slice(0, 20000)}\n…(잘림)` : t; };

export function planImport(ctx, pkgDir, { mode = 'merge', trust = false, includeEnvRules = false, includeIgnore = false, enableImported = false, autoSlot = true } = {}) {
  if (!['merge', 'replace'].includes(mode)) return fail(`알 수 없는 방식: ${mode}`);
  const pkg = readPackage(pkgDir);
  if (!pkg.ok) return fail(pkg.errors, { stage: 'package' });
  const { files: mine } = collectUserFiles(ctx);
  const cand = new Map(mine);
  const skipped = []; const incoming = new Map();
  for (const [rel, buf] of pkg.files) {
    const name = rel.slice('config/'.length);
    if (!trust && PC_ONLY.has(name)) { skipped.push({ path: rel, reason: '이 PC 고유 설정은 불러오기로 바꾸지 않습니다(내 백업 복구로만 바꿈)' }); continue; }
    if (!trust && name === 'env-rules.md' && !includeEnvRules) { skipped.push({ path: rel, reason: '환경 규칙은 모든 카드 끝에 붙는 지시문이라 "환경 규칙도 불러오기"를 선택했을 때만 받습니다' }); continue; }
    if (!trust && name === 'ignore.txt' && !includeIgnore) { skipped.push({ path: rel, reason: '무시 목록(ignore)은 승인 대기 창을 승인 요약에서 숨길 수 있어 "ignore 도 불러오기"를 선택했을 때만 받습니다' }); continue; }
    let out = buf;
    if (!trust && rel.startsWith('config/roles/') && !enableImported) {
      const cur = mine.get(rel);
      if (!cur || !cur.equals(buf)) {
        out = forceDisabled(buf);                                    // 새로 들어오거나 내용이 달라지는 역할은 꺼 둔다(R1)
        if (out === null) return fail([`역할 파일을 "꺼진 채"로 만들 수 없어 불러오지 않습니다(머리말 형식이 이상함): ${rel}`], { stage: 'validate', skipped });
      }
    }
    incoming.set(rel, out);
  }
  const removed = [];
  if (mode === 'replace') {
    const scope = pkg.manifest.scope;
    for (const rel of mine.keys()) {
      if (!inScope(rel, scope)) continue;
      if (!trust && PC_ONLY.has(rel.slice('config/'.length))) continue;
      if (!trust && rel === 'config/env-rules.md' && !includeEnvRules) continue;
      if (!trust && rel === 'config/ignore.txt' && !includeIgnore) continue;
      if (!pkg.files.has(rel)) { cand.delete(rel); removed.push(rel); }
    }
  }
  for (const [rel, buf] of incoming) cand.set(rel, buf);
  const notes = [];
  if (!trust && autoSlot) notes.push(...adjustSlots(ctx, cand, incoming));
  if (!trust && incoming.has('config/ignore.txt')) {
    const bad = badIgnoreLines(incoming.get('config/ignore.txt'));
    if (bad.length) return fail(['무시 목록(ignore)에 너무 넓거나 위험한 줄이 있어 받지 않습니다(3글자 이상, 와일드카드 * ? [ ] 금지):', ...bad.map((b) => `  - ${JSON.stringify(b)}`)], { stage: 'validate', skipped });
  }
  const bundleIds = new Set(loadRoles(join(ctx.root, 'roles')).filter((r) => !r.errors.length).map((r) => r.meta.id));
  const changes = [];
  const all = new Set([...mine.keys(), ...incoming.keys(), ...removed]);
  for (const rel of [...all].sort()) {
    const b = mine.get(rel) ?? null; const a = cand.get(rel) ?? null;
    let action;
    if (b && !a) action = 'remove'; else if (!b && a) action = 'add'; else if (b && a && !b.equals(a)) action = 'change'; else action = 'same';
    if (action === 'same' && !incoming.has(rel)) continue;           // 내 쪽에만 있고 그대로인 것은 목록에서 뺀다
    changes.push({
      path: rel, action,
      before: b ? { sha256: sha256(b), bytes: b.length } : null, after: a ? { sha256: sha256(a), bytes: a.length } : null,
      role: roleLine(a ?? b, rel, bundleIds), roleBefore: roleLine(b, rel, bundleIds),
      beforeText: action === 'same' ? null : clip(b), afterText: action === 'same' ? null : clip(a),
    });
  }
  const touched = changes.filter((c) => c.action !== 'same');
  const base = {}; for (const c of touched) base[c.path] = c.before ? c.before.sha256 : null;
  const res = {
    ok: true, mode, trust, includeEnvRules, includeIgnore, enableImported, scope: pkg.manifest.scope, note: pkg.manifest.note ?? '', createdAt: pkg.manifest.createdAt ?? null,
    changes, skipped, notes, noop: touched.length === 0, baseHashes: base, candidate: cand,
    counts: { add: changes.filter((c) => c.action === 'add').length, change: changes.filter((c) => c.action === 'change').length, remove: changes.filter((c) => c.action === 'remove').length, same: changes.filter((c) => c.action === 'same').length },
  };
  if (!res.noop) {
    const chk = checkCandidate(ctx, cand);
    if (!chk.ok) return fail(chk.errors, { stage: 'validate', warnings: chk.warnings, changes: res.changes, skipped });
    res.warnings = chk.warnings;
  } else res.warnings = [];
  res.token = sha256(JSON.stringify({ mode, trust, includeEnvRules, includeIgnore, enableImported, autoSlot, pkg: pkg.manifest.files.map((f) => f.sha256), changes: touched.map((c) => [c.path, c.action, c.after ? c.after.sha256 : null]), base }));
  return res;
}

// ---------- 잠금 · 변경 적용 (모든 쓰기의 단 하나의 길) ----------
function acquireLock(ctx) {
  mkdirSync(ctx.paths.state, { recursive: true });
  const me = randomBytes(6).toString('hex');
  for (let tries = 0; tries < 2; tries++) {
    try {
      const fd = openSync(ctx.lockFile, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, token: me, at: Date.now() })); closeSync(fd);
      return { token: me, release: () => { try { if (JSON.parse(readFileSync(ctx.lockFile, 'utf8')).token === me) unlinkSync(ctx.lockFile); } catch { /* 이미 없음 */ } } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let at = 0; try { at = JSON.parse(readFileSync(ctx.lockFile, 'utf8')).at ?? 0; } catch { at = 0; }
      if (Date.now() - at > LIMITS.staleLockMs) { try { unlinkSync(ctx.lockFile); } catch { /* 다른 쪽이 치움 */ } continue; }
      return null;
    }
  }
  return null;
}

// put: Map rel→Buffer, remove: rel[], baseHashes: {rel: sha|null} (미리보기 때의 상태, 다르면 중단)
export function commitChanges(ctx, { put = new Map(), remove = [], baseHashes = null, reason = '변경', note = '' }) {
  for (const rel of [...put.keys(), ...remove]) if (!PATH_RE.test(rel)) return fail(`허용되지 않는 경로: ${rel}`);
  const lock = acquireLock(ctx);
  if (!lock) return fail('다른 관리 작업이 진행 중입니다. 잠시 뒤 다시 시도하세요');
  try {
    const { files: pre } = collectUserFiles(ctx);
    const touched = [...new Set([...put.keys(), ...remove])];
    if (baseHashes) {
      const drift = touched.filter((rel) => (pre.has(rel) ? sha256(pre.get(rel)) : null) !== (baseHashes[rel] ?? null));
      if (drift.length) return fail(['미리보기 뒤에 파일이 바뀌었습니다. 다시 미리보기를 하세요', ...drift.map((d) => `  - ${d}`)]);
    }
    const after = new Map(pre); for (const [k, v] of put) after.set(k, v); for (const k of remove) after.delete(k);
    const chk = checkCandidate(ctx, after);
    if (!chk.ok) return fail(chk.errors, { stage: 'validate', warnings: chk.warnings });
    const bk = backupNow(ctx, { note: `자동 백업(${reason})${note ? ` ${note}` : ''}` });
    if (!bk.ok) return fail(['변경 전 자동 백업에 실패해 아무것도 바꾸지 않았습니다', ...bk.errors]);
    const wrote = []; let problem = null;
    try {
      for (const [rel, buf] of put) { writeAtomic(abs(ctx, rel), buf); wrote.push(rel); }
      for (const rel of remove) { const f = abs(ctx, rel); if (existsSync(f)) { unlinkSync(f); wrote.push(rel); } }
      const { files: now } = collectUserFiles(ctx);
      for (const rel of touched) {
        const want = after.get(rel) ?? null; const got = now.get(rel) ?? null;
        if ((want === null) !== (got === null) || (want && !want.equals(got))) throw new Error(`쓴 뒤 확인이 맞지 않음: ${rel}`);
      }
      const live = checkCandidate(ctx, now);
      if (!live.ok) throw new Error(`적용 뒤 점검 실패: ${live.errors.join(' / ')}`);
    } catch (e) { problem = e; }
    if (problem) {                                                      // 되돌리기: 만진 파일을 변경 전 내용으로
      const undone = [];
      for (const rel of wrote) {                                        // 실제로 쓰거나 지운 것만 되돌린다(막고 있던 남의 항목은 건드리지 않는다)
        try { const f = abs(ctx, rel); if (pre.has(rel)) writeAtomic(f, pre.get(rel)); else if (existsSync(f)) unlinkSync(f); undone.push(rel); } catch { /* 아래에서 보고 */ }
      }
      return fail([`적용 중 문제가 생겨 변경 전 상태로 되돌렸습니다: ${problem.message}`], { rolledBack: undone.length === wrote.length, backup: bk.dir });
    }
    return { ok: true, changed: touched.length, backup: bk.dir, warnings: chk.warnings };
  } finally { lock.release(); }
}

export function applyImport(ctx, pkgDir, opts = {}, { token, reason = '불러오기' } = {}) {
  const plan = planImport(ctx, pkgDir, opts);
  if (!plan.ok) return plan;
  if (!token || token !== plan.token) return fail('미리보기 이후 묶음이나 내 설정이 바뀌었거나 확인 값이 다릅니다. 다시 미리보기를 하세요');
  if (plan.noop) return { ok: true, changed: 0, noop: true, backup: null };
  const put = new Map(), remove = [];
  for (const c of plan.changes) { if (c.action === 'add' || c.action === 'change') put.set(c.path, plan.candidate.get(c.path)); else if (c.action === 'remove') remove.push(c.path); }
  return commitChanges(ctx, { put, remove, baseHashes: plan.baseHashes, reason, note: plan.note });
}

export const planRestore = (ctx, backupDir) => planImport(ctx, backupDir, { mode: 'replace', trust: true });
export const applyRestore = (ctx, backupDir, { token } = {}) => applyImport(ctx, backupDir, { mode: 'replace', trust: true }, { token, reason: '복구' });

export function listBackups(ctx) {
  const out = []; const bad = [];
  if (existsSync(ctx.backups)) for (const name of readdirSync(ctx.backups).sort().reverse()) {
    const dir = join(ctx.backups, name);
    try {
      if (!lstatSync(dir).isDirectory()) continue;
      const m = JSON.parse(readUtf8Strict(join(dir, 'package.json')).replace(/^﻿/, ''));
      out.push({ name, dir, createdAt: m.createdAt ?? null, kind: m.kind ?? null, scope: m.scope ?? null, note: m.note ?? '', files: Array.isArray(m.files) ? m.files.length : 0 });
    } catch { bad.push(name); }
  }
  return { ok: true, backups: out, unreadable: bad, count: out.length, tooMany: out.length > LIMITS.backupWarnCount, dir: ctx.backups };
}

// ---------- 역할 ----------
const q = (s) => JSON.stringify(s);
const val = (v) => (Array.isArray(v) ? `[${v.map(q).join(', ')}]` : typeof v === 'string' ? q(v) : String(v));
export function serializeRole(meta, body = '') {
  const keys = [...FIELD_ORDER.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !FIELD_ORDER.includes(k))];
  const head = keys.map((k) => `${k}: ${val(meta[k])}`).join('\n');
  return Buffer.from(`---\n${head}\n---\n${body ? `${body}\n` : ''}`, 'utf8');
}
const sameVal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function loadEffectiveRoles(ctx) { return loadRolesLayered(join(ctx.root, 'roles'), ctx.paths.roles); }

export function roleList(ctx) {
  const roles = loadEffectiveRoles(ctx);
  const { files } = collectUserFiles(ctx);
  const list = roles.map((r) => {
    const rel = `config/roles/${r.meta?.id ?? basename(r.file, '.md')}.md`;
    let overridden = [];
    if (r.source === 'override' && files.has(rel)) { try { overridden = Object.keys(parseRoleFile(decodeStrict(files.get(rel))).meta).filter((k) => k !== 'id'); if (parseRoleFile(decodeStrict(files.get(rel))).body) overridden.push('(본문)'); } catch { /* 위에서 오류로 잡힘 */ } }
    return { id: r.meta?.id ?? basename(r.file, '.md'), source: r.source, errors: r.errors, label: r.label, meta: r.meta, body: r.body, overridden };
  });
  return { ok: true, roles: list, problems: list.filter((r) => r.errors.length).map((r) => ({ id: r.id, label: r.label, errors: r.errors })) };
}

const nextSlot = (roles) => { const used = new Set(roles.filter((r) => !r.errors.length).map((r) => r.meta.slot)); let n = 1; while (used.has(n)) n++; return n; };

function checkFields(fields) {
  const errs = [];
  for (const k of Object.keys(fields)) if (!EDITABLE_FIELDS.includes(k)) errs.push(`바꿀 수 없는 항목: ${k}`);
  return errs;
}

export function roleSet(ctx, id, fields = {}, { body } = {}) {
  if (!ID_PATTERN.test(id ?? '')) return fail(`역할 id 형식이 아님: ${id}`);
  const bad = checkFields(fields); if (bad.length) return fail(bad);
  const roles = loadEffectiveRoles(ctx);
  const eff = roles.find((r) => r.meta?.id === id && !r.errors.length);
  if (!eff) return fail(`그런 역할이 없거나 오류가 있는 역할입니다: ${id}`);
  const rel = `config/roles/${id}.md`;
  const { files } = collectUserFiles(ctx);
  let cur = { meta: {}, body: '' };
  if (files.has(rel)) { try { const p = parseRoleFile(decodeStrict(files.get(rel))); cur = { meta: p.meta, body: p.body }; } catch { return fail(`내 역할 파일을 읽을 수 없습니다: ${rel}`); } }
  let meta, newBody;
  if (eff.source === 'user') {                                           // 새 역할: 전체 필드를 가진 파일
    meta = { ...eff.meta, ...fields, id }; newBody = body !== undefined ? body : eff.body;
  } else {                                                               // 번들 역할: 바꾼 필드만 적는 덮어쓰기 파일
    const bundle = roles.length && loadRolesLayered(join(ctx.root, 'roles'), null).find((r) => r.meta?.id === id);
    meta = { ...cur.meta }; delete meta.id;
    for (const [k, v] of Object.entries(fields)) { if (bundle && sameVal(bundle.meta[k], v)) delete meta[k]; else meta[k] = v; }
    newBody = body !== undefined ? (bundle && body === bundle.body ? '' : body) : cur.body;
    if (Object.keys(meta).length === 0 && newBody === '') return commitChanges(ctx, { remove: files.has(rel) ? [rel] : [], reason: `역할 ${id} 번들 값으로 복귀` });
  }
  return commitChanges(ctx, { put: new Map([[rel, serializeRole(meta, newBody)]]), reason: `역할 ${id} 수정` });
}

export function roleNew(ctx, { id, from, fields = {}, body } = {}) {
  if (!ID_PATTERN.test(id ?? '')) return fail(`역할 id 형식이 아님(소문자·숫자·하이픈, 2~31자, 소문자로 시작): ${id}`);
  const bad = checkFields(fields); if (bad.length) return fail(bad);
  const roles = loadEffectiveRoles(ctx);
  if (roles.some((r) => (r.meta?.id ?? basename(r.file, '.md')) === id)) return fail(`이미 있는 역할 id 입니다: ${id}`);
  let base = {}; let baseBody = '';
  if (from) {
    const src = roles.find((r) => r.meta?.id === from && !r.errors.length);
    if (!src) return fail(`본보기 역할을 찾을 수 없음: ${from}`);
    base = { ...src.meta }; baseBody = src.body; base.replaces = []; base.enabled = true;
    if (src.meta.kind !== 'worker') return fail('총지휘·승인 대행은 복사해서 만들 수 없습니다(worker 역할만)');
  }
  const meta = {
    id, name: id, slot: nextSlot(roles), kind: 'worker', mode: 'read-only', writes_to: [], reports_to: roles.find((r) => r.meta?.kind === 'commander' && !r.errors.length)?.meta.id ?? 'commander',
    cadence: 'on-request', enabled: true, replaces: [], needs: [], version: 1, ...base, ...fields,
  };
  meta.id = id; if (from && fields.slot === undefined) meta.slot = nextSlot(roles);
  const text = body !== undefined ? body : (baseBody || '이 역할의 지시문을 여기에 적습니다. {commander}에게 보고한다.');
  return commitChanges(ctx, { put: new Map([[`config/roles/${id}.md`, serializeRole(meta, text)]]), reason: `역할 ${id} 새로 만듦` });
}

export function roleRevert(ctx, id) {
  const r = loadEffectiveRoles(ctx).find((x) => x.meta?.id === id);
  if (!r || r.source !== 'override') return fail('번들 역할을 덮어쓴 역할만 되돌릴 수 있습니다');
  return commitChanges(ctx, { remove: [`config/roles/${id}.md`], reason: `역할 ${id} 번들 값으로 복귀` });
}
export function roleDelete(ctx, id) {
  const r = loadEffectiveRoles(ctx).find((x) => x.meta?.id === id);
  if (!r || r.source !== 'user') return fail('내가 만든 새 역할만 삭제할 수 있습니다(번들 역할은 끄거나 덮어쓰기 되돌리기를 쓰세요)');
  return commitChanges(ctx, { remove: [`config/roles/${id}.md`], reason: `역할 ${id} 삭제` });
}

// ---------- 현황 ----------
export function status(ctx, { generated } = {}) {
  const out = { ok: true, version: ctx.version, root: ctx.root, paths: { home: ctx.paths.home, config: ctx.paths.config, state: ctx.paths.state, roles: ctx.paths.roles, backups: ctx.backups } };
  const cfgPath = join(ctx.paths.config, 'orchestration.json');
  let cfg = null;
  if (!existsSync(cfgPath)) out.config = { exists: false, valid: false, errors: ['설정 파일이 없음(install 을 먼저 실행하세요)'], values: null, unset: [] };
  else {
    try { const r = parseConfig(readUtf8Strict(cfgPath)); cfg = r.config; out.config = { exists: true, valid: !!r.config, errors: r.errors ?? [], values: r.config ? { commander_name: r.config.commander_name, scope_prefix: r.config.scope_prefix, projects_root: r.config.projects_root, control_dir: r.config.control_dir } : null, unset: r.config ? unsetKeys(r.config) : [] }; }
    catch (e) { out.config = { exists: true, valid: false, errors: [e.message], values: null, unset: [] }; }
  }
  const rl = roleList(ctx);
  out.roles = rl.roles.map((r) => ({ id: r.id, name: r.meta.name ?? null, summary: r.meta.summary ?? null, slot: r.meta.slot ?? null, kind: r.meta.kind ?? null, mode: r.meta.mode ?? null, enabled: r.meta.enabled ?? null, reports_to: r.meta.reports_to ?? null, source: r.source, overridden: r.overridden, errors: r.errors }));
  const rank = (k) => (k === 'commander' ? 0 : k === 'proxy' ? 1 : 2);
  out.roles.sort((a, b) => rank(a.kind) - rank(b.kind) || (a.slot ?? 99) - (b.slot ?? 99) || String(a.id).localeCompare(String(b.id)));
  out.problems = rl.problems;
  let envRules = []; const erPath = join(ctx.paths.config, 'env-rules.md');
  if (existsSync(erPath)) { try { const p = parseEnvRules(readUtf8Strict(erPath)); out.envRules = { exists: true, count: p.rules.length, errors: p.errors }; if (!p.errors.length) envRules = p.rules; } catch (e) { out.envRules = { exists: true, count: 0, errors: [e.message] }; } }
  else out.envRules = { exists: false, count: 0, errors: [] };
  const ready = cfg && !rl.problems.length;
  if (ready) {
    try {
      const roles = loadEffectiveRoles(ctx);
      out.layout = buildLayoutPlan(roles, cfg).tabs.map((t) => ({ name: t.name, seats: t.seats, roles: t.roles.map((r) => r.id) }));
      const built = buildOutputs(roles, cfg, readHeaderTemplate(join(ctx.root, 'templates')), envRules);
      const dir = generated ? resolve(generated) : join(ctx.paths.state, 'generated');
      const changed = [];
      if (!existsSync(dir)) out.generated = { dir, state: 'none', changed: [], note: '아직 sync 를 실행하지 않음' };
      else {
        for (const [rel, text] of built.files) { const f = join(dir, ...rel.split('/')); if (!existsSync(f) || !readFileSync(f).equals(Buffer.from(text, 'utf8'))) changed.push(rel); }
        out.generated = { dir, state: changed.length ? 'stale' : 'fresh', changed, note: changed.length ? '현재 역할·설정으로 다시 만든 결과와 다름 — sync 를 실행하세요' : '현재 역할·설정과 일치' };
      }
    } catch (e) { out.generated = { dir: null, state: 'unknown', changed: [], note: `계산하지 못함: ${e.message}` }; }
  } else out.generated = { dir: null, state: 'unknown', changed: [], note: '설정 또는 역할 파일의 오류를 먼저 고치세요' };
  const bl = listBackups(ctx);
  out.backups = { count: bl.count, latest: bl.backups[0] ?? null, tooMany: bl.tooMany };
  return out;
}

export function runSync(ctx, { out } = {}) {
  const args = [join(ctx.root, 'bin', 'sync.mjs')]; if (out) args.push('--out', resolve(out));
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...ctx.env, ORCH_HOME: ctx.paths.home }, timeout: 120000 });
  return { ok: r.status === 0, code: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}
export { PLACEHOLDER };
