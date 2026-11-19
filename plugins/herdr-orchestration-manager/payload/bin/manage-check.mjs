// manage-check: "역할 점검" — 기대하는 역할 N개와 지금 떠 있는 창을 세션 ID 로 맞춰 보고, "N개 중 몇 개가 정상인지"를 알려 준다.
// 왜 세션 ID 인가: 창 주소는 재부팅·복구 때마다 바뀌고, 탭 안의 순서로 역할 번호를 추측하면 틀린다(예: 6번 역할 창이 복구되어 맨 끝에 놓이면 8번으로 읽힘).
// 세션 ID(claude --resume 에 쓰는 값)만 창이 바뀌어도 변하지 않는다. 그래서 "역할 ↔ 세션 ID" 대응표(config\role-windows.json)를 정본으로 둔다.
// 읽기 전용 부분: role-check(= hc ls --json 한 번 + 세션키퍼의 session-map.json·keeper-health.json 읽기). 어느 창에도 아무것도 보내지 않고 키퍼 파일을 쓰지 않는다.
// 쓰는 것은 이 킷 자신의 config\role-windows.json 뿐이다(role-window-set / role-window-clear / role-window-seed). 임시 파일에 쓴 뒤 바꿔치기하고 직전 것을 .prev 로 남긴다.
import { readFileSync, existsSync, statSync, lstatSync, writeFileSync, renameSync, unlinkSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, sep, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readUtf8Strict, ID_PATTERN } from './orch-lib.mjs';
import { parseConfig, buildLayoutPlan } from './sync-lib.mjs';
import { liveWindows } from './manage-live.mjs';
import { loadEffectiveRoles } from './manage-lib.mjs';

const MAP_MAX = 2 * 1024 * 1024;
const RECOVERY_MAX_MS = 35 * 60 * 1000;           // 키퍼 복구 창은 최대 30분(재시도가 있을 때 WindowMin×3). 복구 시작 시각이 이보다 오래됐으면 복구 표시를 믿지 않는다
const FRESH_MS = 150 * 1000;                       // 기본값 = 세션키퍼 갱신 주기(60초) × 2 + 30초. keeper-health.json 이 있으면 그 intervalSec × 2 + 30초(계약-세션키퍼-상태.md §1). 이보다 오래된 기록은 "지금 상태"로 믿지 않는다
const freshMsFor = (kh) => ((kh && kh.intervalSec ? kh.intervalSec : 60) * 2 + 30) * 1000;
const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ADDR_RE = /^t[0-9a-z]{1,10}$/;
const OLD_MAP_RE = /^session-map\.json(\.[A-Za-z0-9._-]{1,80})?$/;
const clip = (v, n = 80) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);
const fail = (errors) => ({ ok: false, errors: Array.isArray(errors) ? errors : [String(errors)] });
const cmpAddr = (a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0);   // t3k < t14h < t19y (자릿수 먼저)
const sid8 = (s) => (s ? String(s).slice(0, 8) : null);
const splitWhere = (where) => { const p = String(where).split(' / '); return { space: p[0] ?? '', tab: p.slice(1).join(' / ') }; };

const assignPath = (ctx) => join(ctx.paths.config, 'role-windows.json');

function writeAtomic(full, text) {
  mkdirSync(dirname(full), { recursive: true });
  if (existsSync(full)) { try { copyFileSync(full, full + '.prev'); } catch { /* 직전 본이 없어도 계속 */ } }
  const tmp = `${full}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`;
  try { writeFileSync(tmp, text); renameSync(tmp, full); }
  catch (e) { try { unlinkSync(tmp); } catch { /* 없으면 그만 */ } throw e; }
}

// ---------- 대응표 읽기 ----------
export function readAssignments(ctx) {
  const p = assignPath(ctx);
  if (!existsSync(p)) return { assignments: {}, exists: false, error: null };
  try {
    const st = lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile()) return { assignments: {}, exists: true, error: '대응표가 일반 파일이 아님' };
    if (st.size > 256 * 1024) return { assignments: {}, exists: true, error: '대응표가 너무 큼' };
    const j = JSON.parse(readUtf8Strict(p).replace(/^﻿/, ''));
    const src = j && typeof j === 'object' && j.assignments && typeof j.assignments === 'object' ? j.assignments : null;
    if (!src) return { assignments: {}, exists: true, error: '대응표 형식이 아님(assignments 객체 없음)' };
    const out = {};
    for (const [id, v] of Object.entries(src)) {
      if (!ID_PATTERN.test(id) || !v || typeof v !== 'object' || !SID_RE.test(String(v.sid))) continue;   // 이상한 항목은 건너뜀(점검 결과에 "배정 안 됨"으로 나옴)
      out[id] = { sid: String(v.sid), by: v.by === 'seed' ? 'seed' : 'user', at: clip(v.at, 40) };
    }
    return { assignments: out, exists: true, error: null };
  } catch (e) { return { assignments: {}, exists: true, error: `대응표를 읽을 수 없음: ${e.message}` }; }
}

// ---------- 세션키퍼 map 읽기(읽기만) ----------
function parseMapFile(file) {
  const st = statSync(file);
  if (!st.isFile()) throw new Error('일반 파일이 아님');
  if (st.size > MAP_MAX) throw new Error('너무 큼(2 MiB 초과)');
  const j = JSON.parse(readUtf8Strict(file).replace(/^﻿/, ''));
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('최상위가 객체가 아님');
  const entries = new Map();
  for (const [k, v] of Object.entries(j)) {
    if (!ADDR_RE.test(k) || !v || typeof v !== 'object' || !SID_RE.test(String(v.sid ?? ''))) continue;
    const seen = Date.parse(String(v.seen ?? ''));                // 시간대 없는 값은 이 PC 의 시각으로 읽는다(키퍼도 같은 PC 시각으로 적음)
    entries.set(k, { sid: String(v.sid), seen: Number.isFinite(seen) ? seen : null, where: clip(v.where, 200) });
  }
  return entries;
}
// 기록 파일 위치: ① 환경변수 ORCH_SESSION_MAP(명시 지정 — 후보 찾기 없음) ② control_dir ③ control_dir 에 파일이 없을 때만 키퍼 기본 설치 위치(%LOCALAPPDATA%\HerdrSessionKeeper\app, 세션키퍼 README 의 기본값).
// 어느 쪽이든 낡음·경고 판정은 그대로라서, 엉뚱한 옛 파일을 찾아도 "정상"이 되지 않고 "확인 불가"로 남는다. 키퍼를 -InstallDir 로 다른 곳에 깐 경우는 추측하지 않는다(ORCH_SESSION_MAP 으로 지정).
export function mapLocation(ctx, cfg) {
  if (ctx.env.ORCH_SESSION_MAP) return { path: ctx.env.ORCH_SESSION_MAP, source: 'env' };
  const primary = cfg && cfg.control_dir ? join(cfg.control_dir, 'session-map.json') : null;
  if (primary && existsSync(primary)) return { path: primary, source: 'control_dir' };
  const la = ctx.env.LOCALAPPDATA;
  const alt = la ? join(la, 'HerdrSessionKeeper', 'app', 'session-map.json') : null;
  if (alt && existsSync(alt)) return { path: alt, source: 'keeper-default' };
  return { path: primary, source: primary ? 'control_dir' : null };
}
export function mapPath(ctx, cfg) { return mapLocation(ctx, cfg).path; }
function readMap(ctx, cfg, nowMs, freshMs = FRESH_MS) {
  const p = mapPath(ctx, cfg);
  if (!p) return { available: false, note: 'session-map.json 위치를 알 수 없습니다(설정의 control_dir 또는 환경변수 ORCH_SESSION_MAP)', entries: new Map(), fresh: false };
  if (!existsSync(p)) return { available: false, note: '세션키퍼의 session-map.json 이 없습니다. 세션키퍼가 켜져 있는지 확인하세요', entries: new Map(), fresh: false };
  try {
    const entries = parseMapFile(p);
    let newest = 0; for (const e of entries.values()) if (e.seen && e.seen > newest) newest = e.seen;
    const ageSec = newest ? Math.max(0, Math.round((nowMs - newest) / 1000)) : null;
    const fresh = newest > 0 && Math.abs(nowMs - newest) <= freshMs;        // 미래 시각(시계 어긋남)도 믿지 않는다
    return { available: true, entries, fresh, freshMs, ageSec, note: fresh ? null : `세션키퍼 기록이 ${ageSec === null ? '시각을 알 수 없음' : ageSec + '초 전'}의 것이라 지금 상태로 믿지 않습니다(키퍼가 멈췄을 수 있음)` };
  } catch (e) { return { available: false, note: `session-map.json 을 읽을 수 없습니다: ${e.message}`, entries: new Map(), fresh: false }; }
}

// 세션키퍼의 자체 점검 기록(keeper-health.json, 같은 폴더) — 계약-세션키퍼-상태.md v1. 선택 입력, 읽기만. 없거나 깨져도(또는 v 가 1 이 아니면) 점검은 그대로 되고 설명만 줄어든다.
// 필드: v · at · intervalSec · windows · recognized · ghost · state(ok|warn) · since · reason · recovering · recoverySince. 모르는 필드는 무시한다.
// 쓰임: (1) distrust(경고이거나 기록이 intervalSec×5(최소 6분) 넘게 낡음)이면 "창이 없다(missing)"고 단정하지 않고 unknown 으로 둔다 (2) recovering 은 role-watch 가 알림을 묶는 데 쓴다 (3) 화면·알림 문구.
// 주의: recovering 만 바뀔 때는 at 이 그대로라서 "최근 것인가"를 at 으로 판단할 수 없다 → recovering 은 기록이 stale(낡음)이 아닐 때만 믿고, 묶는 시간 상한은 role-watch 가 둔다.
function readKeeperHealth(ctx, cfg, nowMs) {
  const none = { present: false, v: null, state: null, degraded: false, stale: false, distrust: false, fresh: false, recovering: false, recoverySince: '', intervalSec: null, windows: null, recognized: null, ghost: null, ageSec: null, reason: '', since: '', text: null, error: null };
  const mp = mapPath(ctx, cfg);
  const p = ctx.env.ORCH_KEEPER_HEALTH || (mp ? join(dirname(mp), 'keeper-health.json') : null);
  if (!p || !existsSync(p)) return none;                                    // 파일이 없으면 옛 키퍼이거나 막 시작한 직후 — 경고로 단정하지 않는다
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size > 64 * 1024) return { ...none, error: '키퍼 점검 기록이 일반 파일이 아니거나 너무 큼' };
    const j = JSON.parse(readUtf8Strict(p).replace(/^﻿/, ''));
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { ...none, error: '키퍼 점검 기록 형식이 아님' };
    if (j.v !== undefined && j.v !== 1) return { ...none, v: j.v, error: `키퍼 점검 기록 형식 v${clip(j.v, 10)} 는 아직 모릅니다(계약 v1 만 읽음)` };
    const num = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
    const intervalSec = num(j.intervalSec, 5, 3600) ?? 60;
    const at = Date.parse(String(j.at ?? ''));                                // 시간대 없는 값 = 이 PC 의 지역 시각(session-map.json 의 seen 과 같다)
    const ageSec = Number.isFinite(at) ? Math.max(0, Math.round((nowMs - at) / 1000)) : null;
    const fresh = Number.isFinite(at) && Math.abs(nowMs - at) <= freshMsFor({ intervalSec });
    const stale = !Number.isFinite(at) || Math.abs(nowMs - at) > Math.max(intervalSec * 5, 360) * 1000;
    const windows = num(j.windows, 0, 100000), recognized = num(j.recognized, 0, 100000), ghost = num(j.ghost, 0, 100000);
    const state = clip(j.state, 20), reason = clip(j.reason, 160), since = clip(j.since, 40);
    const degraded = state !== '' && state !== 'ok';                          // 계약상 ok|warn. 모르는 값도 "믿지 않는 쪽"으로 다룬다
    // 복구와 기록 갱신은 키퍼의 같은 루프에서 차례로 돈다 → 대량 복구(실측 329초, 재시도 시 최대 30분) 동안 at 이 갱신되지 않아 낡은 것으로 보인다.
    // 그래서 recovering 은 at 이 아니라 복구 시작 시각(recoverySince)으로 믿는다(35분 안). 시작 시각이 아예 없을 때만 예전처럼 기록이 낡지 않았을 때 믿는다.
    const rsMs = Date.parse(String(j.recoverySince ?? ''));
    const rsOk = Number.isFinite(rsMs) && nowMs - rsMs >= -60000 && nowMs - rsMs <= RECOVERY_MAX_MS;
    const recovering = j.recovering === true && (rsOk || (!Number.isFinite(rsMs) && !stale));
    const counts = windows !== null && recognized !== null ? ` ${recognized}/${windows}` : '';
    const text = recovering ? `키퍼 복구 중${rsOk ? ' (' + clip(j.recoverySince, 40) + '부터)' : ''}${stale ? ' · 점검 기록이 ' + (ageSec === null ? '시각을 알 수 없는' : ageSec + '초 전') + ' 것(복구 중에는 갱신이 늦어짐)' : counts}`
      : stale ? `키퍼 점검 기록이 ${ageSec === null ? '시각을 알 수 없는' : ageSec + '초 전'} 것(키퍼가 멈췄을 수 있음)`
      : degraded ? `키퍼 점검 경고${counts}${state !== 'warn' ? ' [' + state + ']' : ''}${since ? ' (' + since + '부터)' : ''}${reason ? ' — ' + reason : ''}`
      : `키퍼 ${state === 'ok' ? '정상' : '점검 기록 있음'}${counts}${recovering ? ' (복구 중)' : ''}`;
    return { present: true, v: 1, state, degraded, stale, distrust: degraded || stale, fresh, recovering, recoverySince: clip(j.recoverySince, 40), intervalSec, windows, recognized, ghost, ageSec, reason, since, text, error: null };
  } catch (e) { return { ...none, error: `키퍼 점검 기록을 읽을 수 없음: ${e.message}` }; }
}

function loadPlan(ctx) {
  const cp = join(ctx.paths.config, 'orchestration.json');
  if (!existsSync(cp)) return { err: '설정(orchestration.json)이 없어 점검할 수 없습니다. 먼저 설치·초기 설정을 하세요' };
  let parsed;
  try { parsed = parseConfig(readUtf8Strict(cp)); } catch (e) { return { err: `설정을 읽을 수 없습니다: ${e.message}` }; }
  if (!parsed.config) return { err: `설정에 문제가 있어 점검할 수 없습니다: ${parsed.errors[0]}` };
  const roles = loadEffectiveRoles(ctx).filter((r) => !r.errors.length && r.meta.enabled);
  return { cfg: parsed.config, roles, plan: buildLayoutPlan(roles, parsed.config) };
}

// ---------- 역할 점검(읽기 전용) ----------
// 상태: ok(세션 ID 로 확인됨) · moved(맞는 창이 있지만 역할 탭 밖) · missing(창이 없음) · unknown(키퍼 기록이 없거나 오래돼 확인 못 함)
//       guess(세션 ID 없이 "탭에 창이 딱 하나"라서 추정만 함) · unassigned(어느 창인지 아직 정하지 않음)
export function roleCheck(ctx, { now } = {}) {
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const lp = loadPlan(ctx); if (lp.err) return { ok: true, available: false, note: lp.err, roles: [], extras: [], summary: null };
  const live = liveWindows(ctx); if (!live.available) return { ok: true, available: false, note: live.note, roles: [], extras: [], summary: null };
  const kh = readKeeperHealth(ctx, lp.cfg, nowMs);
  const map = readMap(ctx, lp.cfg, nowMs, freshMsFor(kh));
  const khWhy = kh.present && kh.distrust ? ` · ${kh.text}` : '';      // 확인이 안 되는 이유를 키퍼 쪽 사실로 덧붙인다(판정은 바꾸지 않음)
  const asg = readAssignments(ctx);
  const prefix = `${lp.cfg.layout.tab_prefix}-`;

  const wins = live.windows.map((w) => {
    const { space, tab } = splitWhere(w.where);
    const m = map.entries.get(w.address);
    const fresh = !!(map.fresh && m && m.seen && Math.abs(nowMs - m.seen) <= map.freshMs);
    return { address: w.address, agent: w.agent, status: w.status, turn: w.turn, space, tab, sid: fresh ? m.sid : null, sidKnownStale: !!(m && !fresh), isClaude: w.agent === 'claude-code' };
  });
  const claude = wins.filter((w) => w.isClaude);
  const bySid = new Map(); for (const w of claude) if (w.sid) bySid.set(w.sid, w);

  const entries = [];                                                   // 기대하는 역할들(계획의 탭 순서·자리 순서)
  for (const t of lp.plan.tabs) for (const e of t.roles) entries.push({ id: e.id, name: e.display_name, slot: e.slot, kind: e.kind, tab: t.name });

  const claimed = new Set();                                            // 이미 어느 역할의 창으로 확인된 창 주소
  const result = new Map();
  for (const en of entries) {                                           // 1) 세션 ID 로 확인된 것
    const a = asg.assignments[en.id];
    if (!a) continue;
    const w = bySid.get(a.sid);
    if (w) { claimed.add(w.address); result.set(en.id, { status: w.tab === en.tab || (en.kind !== 'worker' && w.tab.startsWith(prefix)) ? 'ok' : 'moved', win: w, by: a.by, note: w.tab === en.tab || (en.kind !== 'worker' && w.tab.startsWith(prefix)) ? null : `역할 탭이 아닌 곳에 있음: ${w.space} / ${w.tab}` }); }
  }
  const lackingByTab = new Map();                                       // 1) 뒤에도 창이 정해지지 않은 역할 수(탭별)
  for (const e2 of entries) if (!result.has(e2.id)) lackingByTab.set(e2.tab, (lackingByTab.get(e2.tab) || 0) + 1);
  // 세션 ID 가 바뀐 경우(/clear, 복구 때 새 대화로 열림): 배정된 세션은 안 보이는데 같은 탭에 키퍼가 세션 ID 를 확인한 안 묶인 창이 딱 하나이고
  // 이 탭에서 창이 없는 역할도 이 역할 하나뿐이면 그 창일 가능성이 높다 → "없음"이라 하지 않고 추정으로 알린다(사용자가 중복 복구하지 않게). 확정은 사람이 role-window-set 으로.
  const missingOrGuess = (en, a) => {
    const c = claude.filter((w) => !claimed.has(w.address) && w.sid && w.tab === en.tab);
    if (c.length === 1 && lackingByTab.get(en.tab) === 1) {
      claimed.add(c[0].address);
      return { status: 'guess', win: c[0], by: a.by, note: `세션 ID 가 바뀐 것 같습니다(/clear 처럼 의도한 변경이거나 새 대화로 열린 것일 수 있어 오류가 아닐 수 있음): 배정된 세션 ${sid8(a.sid)} 는 보이지 않고 같은 탭에 다른 세션 ${sid8(c[0].sid)} 창이 하나뿐입니다. 맞으면 role-window-set 으로 고치세요` };
    }
    return { status: 'missing', note: '이 세션이 떠 있는 창이 없습니다', by: a.by };
  };
  for (const en of entries) {                                           // 2) 배정은 있는데 창이 안 보이는 것 / 배정이 없는 것
    if (result.has(en.id)) continue;
    const a = asg.assignments[en.id];
    if (a) {
      const cannotJudge = !map.available || !map.fresh;
      const keeperDistrust = kh.present && kh.distrust;                // 키퍼가 Claude 를 못 읽는 상태일 수 있으면 "없음"이라 단정하지 않는다(계약 §3-1)
      // 세션 ID 를 못 읽은 Claude 창이 역할 탭에 있으면 그 창이 이 역할일 수 있다 → "없음"이라 단정하지 않는다.
      // (닫힌 창의 옛 기록이 map 에 남아 있는 것만으로는 판단하지 않는다: hc ls 에 창이 없으면 없는 것이다)
      const unresolved = claude.some((w) => !w.sid && !claimed.has(w.address) && (w.tab === en.tab || w.tab.startsWith(prefix)));
      result.set(en.id, cannotJudge ? { status: 'unknown', note: (map.note ?? '세션키퍼 기록으로 확인할 수 없음') + khWhy, by: a.by } : keeperDistrust ? { status: 'unknown', note: '이 세션이 떠 있는 창이 보이지 않지만, 키퍼 점검이 믿을 수 없는 상태라 "없음"이라 단정하지 않습니다' + khWhy, by: a.by } : unresolved ? { status: 'unknown', note: '세션 ID 를 아직 확인하지 못한 창이 역할 탭에 있습니다(복구 직후이거나 세션키퍼가 못 보는 중일 수 있음)' + khWhy, by: a.by } : missingOrGuess(en, a));
    }
  }
  const unassigned = entries.filter((en) => !result.has(en.id));
  for (const en of unassigned) {
    const cands = claude.filter((w) => !claimed.has(w.address) && (w.tab === en.tab)).sort((x, y) => cmpAddr(x.address, y.address));
    const sameTabUnassigned = unassigned.filter((o) => o.tab === en.tab).length;
    // hc ls 의 agent=claude-code 만으로는 살아 있는 Claude 라고 단정할 수 없다(Herdr 재시작 뒤 화면 잔상이 남은 창이 그렇게 보임). 세션키퍼 기록에서 세션 ID 가 확인된 창만 추정 대상이다
    if (cands.length === 1 && sameTabUnassigned === 1 && cands[0].sid) { result.set(en.id, { status: 'guess', win: cands[0], note: '세션 ID 로 확인한 것이 아니라 "탭에 창이 하나뿐"이라 추정한 것입니다' }); claimed.add(cands[0].address); }
    else result.set(en.id, { status: 'unassigned', note: cands.length ? '어느 창이 이 역할인지 정해지지 않았습니다(후보를 보고 지정하세요)' : '이 탭에 후보 창이 없습니다', candidates: cands.map((w) => ({ address: w.address, sid8: sid8(w.sid), turn: w.turn, status: w.status })) });
  }
  const roles = entries.map((en) => {
    const r = result.get(en.id);
    return { id: en.id, name: en.name, slot: en.slot, tab: en.tab, status: r.status, address: r.win ? r.win.address : null, sid8: r.win ? sid8(r.win.sid) : sid8(asg.assignments[en.id]?.sid), windowStatus: r.win ? r.win.status : null, turn: r.win ? r.win.turn : null, by: r.by ?? null, note: r.note ?? null, candidates: r.candidates ?? [] };
  });
  const extras = claude.filter((w) => !claimed.has(w.address) && w.tab.startsWith(prefix)).sort((x, y) => cmpAddr(x.address, y.address)).map((w) => ({ address: w.address, where: `${w.space} / ${w.tab}`, sid8: sid8(w.sid), turn: w.turn, status: w.status }));
  const shells = wins.filter((w) => !w.isClaude && w.tab.startsWith(prefix)).map((w) => ({ address: w.address, agent: w.agent, where: `${w.space} / ${w.tab}` }));
  const count = (s) => roles.filter((r) => r.status === s).length;
  const summary = { expected: roles.length, ok: count('ok'), moved: count('moved'), missing: count('missing'), unknown: count('unknown'), guess: count('guess'), unassigned: count('unassigned'), extraWindows: extras.length, emptyShells: shells.length, seeded: roles.filter((r) => r.by === 'seed').length };
  const bad = [['없음', summary.missing], ['탭 밖', summary.moved], ['확인 불가', summary.unknown], ['추정만', summary.guess], ['배정 안 됨', summary.unassigned]].filter(([, n]) => n > 0).map(([l, n]) => `${l} ${n}`);
  const headline = `역할 ${summary.expected}개 중 ${summary.ok}개 정상` + (bad.length ? ` · ${bad.join(' · ')}` : ' — 전부 확인됨') + (summary.extraWindows ? ` · 역할 미배정 창 ${summary.extraWindows}` : '') + (summary.emptyShells ? ` · 빈 셸 ${summary.emptyShells}` : '');
  const ST = { ok: '정상', moved: '탭 밖', missing: '없음', unknown: '확인 불가', guess: '추정만', unassigned: '배정 안 됨' };
  const lines = roles.map((r) => `${String(r.slot).padStart(2)}번 ${r.name} [${ST[r.status]}]${r.address ? ' ' + r.address : ''}${r.sid8 ? ' (' + r.sid8 + ')' : ''}${r.note ? ' — ' + r.note : ''}`);
  return { ok: true, available: true, headline, summary, roles, extras, emptyShells: shells, lines, map: { available: map.available, fresh: map.fresh, ageSec: map.ageSec ?? null, note: map.note ?? null, source: mapLocation(ctx, lp.cfg).source }, keeper: kh, assignmentsFile: { exists: asg.exists, error: asg.error }, checkedAt: new Date(nowMs).toISOString() };
}

// ---------- 대응표 쓰기 ----------
function saveAssignments(ctx, assignments) {
  writeAtomic(assignPath(ctx), JSON.stringify({ version: 1, assignments }, null, 2) + '\n');
}
function knownRole(ctx, id) {
  if (!ID_PATTERN.test(id ?? '')) return `역할 id 형식이 아님: ${clip(id, 40)}`;
  const r = loadEffectiveRoles(ctx).find((x) => x.meta?.id === id && !x.errors.length);
  return r ? null : `그런 역할이 없거나 오류가 있는 역할입니다: ${id}`;
}

// 역할 하나에 창을 정해 준다. 창은 세션 ID(sid) 로, 또는 주소(address)로 지정한다(주소는 세션키퍼 기록에서 세션 ID 를 찾아 쓴다).
export function roleWindowSet(ctx, { id, sid, address, by, now } = {}) {
  const bad = knownRole(ctx, id); if (bad) return fail(bad);
  const nowMs = Number.isFinite(now) ? now : Date.now();
  let s = sid;
  if (s === undefined && address !== undefined) {
    if (!ADDR_RE.test(String(address))) return fail(`창 주소 형식이 아님: ${clip(address, 20)}`);
    const lp = loadPlan(ctx); if (lp.err) return fail(lp.err);
    const map = readMap(ctx, lp.cfg, nowMs, freshMsFor(readKeeperHealth(ctx, lp.cfg, nowMs)));
    const e = map.available ? map.entries.get(String(address)) : null;
    if (!map.fresh || !e || !e.seen || Math.abs(nowMs - e.seen) > map.freshMs) return fail(`주소 ${address} 의 세션 ID 를 세션키퍼 기록에서 확인할 수 없습니다(기록이 없거나 오래됨). 세션 ID 를 직접 지정하거나 세션키퍼를 확인하세요`);
    s = e.sid;
  }
  if (!SID_RE.test(String(s ?? ''))) return fail('세션 ID 형식이 아님(예: 12345678-1234-4234-8234-123456789abc)');
  const cur = readAssignments(ctx); if (cur.error) return fail(`기존 대응표를 읽을 수 없어 쓰지 않습니다: ${cur.error}`);
  const next = { ...cur.assignments }; const movedFrom = [];
  for (const [rid, v] of Object.entries(next)) if (v.sid === s && rid !== id) { delete next[rid]; movedFrom.push(rid); }   // 한 세션은 한 역할에만
  next[id] = { sid: s, by: by === 'seed' ? 'seed' : 'user', at: new Date().toISOString() };
  saveAssignments(ctx, next);
  return { ok: true, id, sid8: sid8(s), movedFrom };
}
export function roleWindowClear(ctx, { id } = {}) {
  const bad = ID_PATTERN.test(id ?? '') ? null : `역할 id 형식이 아님: ${clip(id, 40)}`; if (bad) return fail(bad);
  const cur = readAssignments(ctx); if (cur.error) return fail(`기존 대응표를 읽을 수 없어 쓰지 않습니다: ${cur.error}`);
  if (!cur.assignments[id]) return { ok: true, id, removed: false };
  const next = { ...cur.assignments }; delete next[id]; saveAssignments(ctx, next);
  return { ok: true, id, removed: true };
}

// 옛 session-map(예: 재부팅 전 기록)에서 "그때의 탭 안 주소 순서 = 역할 번호"를 읽어 초기 대응표를 제안한다. apply 가 true 일 때만 쓴다.
// 읽는 파일은 control_dir 안의 session-map.json* 으로 제한한다. 이미 배정된 역할은 건드리지 않고, 짝이 애매하면(창 수≠역할 수) 건너뛴다.
export function roleWindowSeed(ctx, { file, apply } = {}) {
  const lp = loadPlan(ctx); if (lp.err) return fail(lp.err);
  const dir = resolve(lp.cfg.control_dir);
  const name = file ? basename(String(file)) : 'session-map.json';
  if (!OLD_MAP_RE.test(name)) return fail('읽을 수 있는 파일은 control_dir 안의 session-map.json 과 그 백업(session-map.json.*)뿐입니다');
  const full = resolve(dir, name);
  if (!full.startsWith(dir + sep) || !existsSync(full)) return fail(`파일이 없습니다: ${name}`);
  let entries; try { if (lstatSync(full).isSymbolicLink()) return fail('심볼릭 링크는 읽지 않습니다'); entries = parseMapFile(full); } catch (e) { return fail(`${name} 을 읽을 수 없습니다: ${e.message}`); }
  const cur = readAssignments(ctx); if (cur.error) return fail(`기존 대응표를 읽을 수 없어 쓰지 않습니다: ${cur.error}`);
  const pairs = []; const skipped = [];
  const taken = new Set(Object.values(cur.assignments).map((a) => a.sid));
  for (const t of lp.plan.tabs) {
    const want = t.roles.filter((e) => !cur.assignments[e.id]).sort((a, b) => a.slot - b.slot);
    if (!want.length) continue;
    const there = [...entries].filter(([, e]) => splitWhere(e.where).tab === t.name).sort((a, b) => cmpAddr(a[0], b[0]));
    if (t.roles.length !== there.length) { skipped.push({ tab: t.name, reason: `그 기록의 창 ${there.length}개와 역할 ${t.roles.length}개가 맞지 않아 짝을 짓지 않음` }); continue; }
    const all = [...t.roles].sort((a, b) => a.slot - b.slot);
    all.forEach((e, i) => { if (!cur.assignments[e.id] && !taken.has(there[i][1].sid)) pairs.push({ id: e.id, name: e.display_name, tab: t.name, address: there[i][0], sid8: sid8(there[i][1].sid), _sid: there[i][1].sid }); });
  }
  const view = pairs.map(({ _sid, ...p }) => p);
  if (!apply) return { ok: true, applied: false, source: name, pairs: view, skipped };
  const next = { ...cur.assignments };
  for (const p of pairs) next[p.id] = { sid: p._sid, by: 'seed', at: new Date().toISOString() };
  if (pairs.length) saveAssignments(ctx, next);
  return { ok: true, applied: true, source: name, pairs: view, skipped };
}
