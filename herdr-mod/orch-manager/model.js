// model.js - 오케스트레이션 관리 모드의 "순수 계산" 부분(화면 그리기와 분리). tests/mod-model.test.mjs 에서 시험한다.
// 이 파일은 허더 API 를 쓰지 않는다(그래서 node 에서 그대로 시험할 수 있다). 엔진(manage.mjs)이 돌려주는 JSON 을 화면용 글자·행으로 바꾼다.

export const KIND_WORD = { commander: "총지휘", proxy: "대행", worker: "역할" };
export const MODES = ["read-only", "scoped-write"];
export const CADENCES = ["on-request", "periodic"];
export const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;   // 엔진(ID_PATTERN)과 같아야 한다: 영문 소문자로 시작, 소문자·숫자·하이픈, 2~31자
export const MAX_LINE = 200;

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const str = (v) => (v === null || v === undefined ? "" : String(v));

// 화면에 길게 나올 수 있는 글자를 한 줄로 줄인다(제어 글자 제거 + 길이 제한).
// 불러온 묶음의 이름·경로가 화면에서 다르게 보이지 않도록, 글자 방향을 바꾸는 보이지 않는 문자와 폭 없는 문자도 뺀다.
export function clip(s, n = MAX_LINE) {
  const t = str(s)
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\u180e\ufeff]/g, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/ {2,}/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

export const enabledWord = (v) => (v === true ? "켜짐" : v === false ? "꺼짐" : "-");

// 역할의 출처: 번들(기본) / 내가 덮어씀(번들 역할을 내가 고침) / 내 역할(내가 새로 만듦)
export function sourceWord(role) {
  const s = role && role.source;
  if (s === "override") return "내가 덮어씀";
  if (s === "user") return "내 역할";
  return "번들";
}

// 엔진의 한 응답(JSON 글자)을 읽는다. 읽지 못하면 ok:false 와 이유를 돌려준다(예외를 던지지 않는다).
export function parseResult(stdout, stderr = "") {
  const t = str(stdout).trim();
  if (!t) return { ok: false, errors: [clip(stderr, 300) || "엔진이 아무 것도 돌려주지 않았습니다"] };
  try {
    const j = JSON.parse(t.split(/\r?\n/).filter(Boolean).pop());
    return isObj(j) ? j : { ok: false, errors: ["엔진 응답 형식이 올바르지 않습니다"] };
  } catch (e) {
    return { ok: false, errors: ["엔진 응답을 읽을 수 없습니다: " + clip(e.message, 100)] };
  }
}

export function errorsText(r, max = 600) {
  const e = isObj(r) && Array.isArray(r.errors) ? r.errors.filter(Boolean).map((x) => clip(x, 300)) : [];
  const t = e.length ? e.join(" / ") : "알 수 없는 오류";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// ---- 현황 탭
export function statusRows(status) {
  const rows = [];
  if (!isObj(status) || status.ok === false) return [{ key: "err", label: "상태", value: errorsText(status), tone: "bad" }];
  const c = isObj(status.config) ? status.config : {};
  rows.push({ key: "home", label: "내 설정 위치", value: clip(status.paths && status.paths.home, 120), tone: "" });
  rows.push({ key: "ver", label: "도구 버전", value: clip(status.version, 40) || "-", tone: "" });
  if (c.exists === false) rows.push({ key: "cfg", label: "설정 파일", value: "없음 (install 을 먼저 실행하세요)", tone: "bad" });
  else if (c.valid === false) rows.push({ key: "cfg", label: "설정 파일", value: "오류 — " + errorsText(c, 160), tone: "bad" });
  else {
    const unset = Array.isArray(c.unset) ? c.unset : [];
    rows.push({ key: "cfg", label: "설정 파일", value: unset.length ? `정상, 아직 안 채운 항목: ${unset.map((x) => clip(x, 30)).join(", ")}` : "정상", tone: unset.length ? "warn" : "ok" });
    const v = isObj(c.values) ? c.values : {};
    rows.push({ key: "cmd", label: "총지휘 창 이름", value: clip(v.commander_name, 60) || "-", tone: "" });
    rows.push({ key: "scope", label: "관리할 공간 이름", value: clip(v.scope_prefix, 60) || "-", tone: "" });
  }
  const roles = Array.isArray(status.roles) ? status.roles : [];
  const bad = roles.filter((r) => Array.isArray(r.errors) && r.errors.length).length;
  const on = roles.filter((r) => r.enabled === true).length;
  rows.push({ key: "roles", label: "역할", value: `${roles.length}개 (켜짐 ${on}, 꺼짐 ${roles.filter((r) => r.enabled === false).length})` + (bad ? ` · 오류 ${bad}개` : ""), tone: bad ? "bad" : "" });
  const g = isObj(status.generated) ? status.generated : {};
  const gTone = g.state === "fresh" ? "ok" : g.state === "stale" ? "warn" : "";
  rows.push({ key: "gen", label: "생성물(역할표·카드)", value: clip(g.note, 120) || "-", tone: gTone });
  const b = isObj(status.backups) ? status.backups : {};
  rows.push({ key: "bak", label: "백업", value: `${b.count ?? 0}개` + (b.latest && b.latest.createdAt ? ` (가장 최근 ${clip(b.latest.createdAt, 25)})` : ""), tone: b.tooMany ? "warn" : "" });
  const er = isObj(status.envRules) ? status.envRules : {};
  rows.push({ key: "env", label: "환경 규칙", value: er.exists ? `${er.count ?? 0}개` + (er.errors && er.errors.length ? " · 오류 있음" : "") : "없음", tone: er.errors && er.errors.length ? "bad" : "" });
  const probs = Array.isArray(status.problems) ? status.problems : [];
  for (const p of probs.slice(0, 5)) rows.push({ key: "prob-" + clip(p.id, 30), label: "문제", value: `${clip(p.id, 30)}: ${errorsText(p, 140)}`, tone: "bad" });
  return rows;
}

// ---- 역할 탭
const KIND_RANK = { commander: 0, proxy: 1, worker: 2 };
export function roleRows(status) {
  const roles = isObj(status) && Array.isArray(status.roles) ? status.roles : [];
  return roles.map((r) => ({
    id: str(r.id), name: clip(r.name || r.id, 40), slot: Number.isInteger(r.slot) ? r.slot : null, kind: str(r.kind),
    kindWord: KIND_WORD[r.kind] || "-", enabled: r.enabled, enabledWord: enabledWord(r.enabled), sourceWord: sourceWord(r),
    summary: clip(r.summary, 160), bad: Array.isArray(r.errors) && r.errors.length > 0, source: str(r.source), overridden: Array.isArray(r.overridden) ? r.overridden : [],
  })).sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) || (a.slot ?? 99) - (b.slot ?? 99) || a.id.localeCompare(b.id));
}

export const parseLines = (text) => str(text).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normBody = (s) => str(s).replace(/\r\n/g, "\n").replace(/\s+$/, "");

// 편집 초안(draft)과 원래 역할(role = role-list 의 한 항목)을 비교해, "바뀐 것만" 엔진 요청으로 만든다.
// 돌려주는 값: { ok:true, empty:true } 바뀐 것 없음 / { ok:true, request:{id,fields,body?} } / { ok:false, error }
export function buildRoleSetRequest(role, draft) {
  if (!isObj(role) || !isObj(role.meta)) return { ok: false, error: "역할 정보를 읽지 못했습니다" };
  const m = role.meta; const f = {};
  const name = str(draft.name);
  if (name !== str(m.name)) f.name = name;
  const summary = str(draft.summary);
  if (summary !== str(m.summary)) { if (!summary.trim()) return { ok: false, error: '"하는 일"은 비울 수 없습니다' }; f.summary = summary; }
  const slotText = str(draft.slot).trim();
  if (!/^\d{1,3}$/.test(slotText)) return { ok: false, error: "자리는 0 이상의 정수여야 합니다" };
  if (Number(slotText) !== m.slot) f.slot = Number(slotText);
  if (typeof draft.enabled === "boolean" && draft.enabled !== (m.enabled === true)) f.enabled = draft.enabled;
  if (draft.mode && draft.mode !== m.mode) { if (!MODES.includes(draft.mode)) return { ok: false, error: "모드 값이 올바르지 않습니다" }; f.mode = draft.mode; }
  if (draft.cadence && draft.cadence !== m.cadence) { if (!CADENCES.includes(draft.cadence)) return { ok: false, error: "주기 값이 올바르지 않습니다" }; f.cadence = draft.cadence; }
  if (draft.reports_to && draft.reports_to !== m.reports_to) f.reports_to = str(draft.reports_to);
  const wr = parseLines(draft.writes_to);
  if (!same(wr, Array.isArray(m.writes_to) ? m.writes_to : [])) f.writes_to = wr;
  const req = { id: str(role.id), fields: f };
  if (normBody(draft.body) !== normBody(role.body)) req.body = normBody(draft.body);
  if (Object.keys(f).length === 0 && !("body" in req)) return { ok: true, empty: true };
  return { ok: true, request: req };
}

// 새 역할 요청. id 형식은 엔진과 같은 규칙으로 먼저 거른다(엔진도 다시 검사한다).
export function buildRoleNewRequest(id, name, from) {
  const i = str(id).trim();
  if (!ID_RE.test(i)) return { ok: false, error: "id 는 영문 소문자로 시작하고 소문자·숫자·하이픈으로 2~31자여야 합니다" };
  const req = { id: i, fields: {} };
  if (str(name).trim()) req.fields.name = str(name).trim();
  if (from) req.from = str(from);
  return { ok: true, request: req };
}

// ---- 불러오기 / 복구 미리보기
export const ACTION_WORD = { add: "추가", change: "바뀜", remove: "지움", same: "같음" };
export function planHead(plan) {
  if (!isObj(plan) || plan.ok === false) return errorsText(plan);
  const c = isObj(plan.counts) ? plan.counts : {};
  let t = `추가 ${c.add ?? 0} / 바뀜 ${c.change ?? 0} / 지움 ${c.remove ?? 0} / 같음 ${c.same ?? 0}`;
  if (plan.mode) t += `  (방식: ${plan.mode === "replace" ? "교체" : "합치기"})`;
  if (plan.noop) t += "  — 바뀌는 것이 없습니다";
  return t;
}
export function planRows(plan) {
  const ch = isObj(plan) && Array.isArray(plan.changes) ? plan.changes : [];
  return ch.map((c, i) => ({
    key: "pl-" + i, action: str(c.action), actionWord: ACTION_WORD[c.action] || str(c.action), path: clip(c.path, 90),
    roleText: c.role ? clip(c.role.name || (c.role.id ? c.role.id + " (덮어쓰기)" : ""), 40) : "",
    onText: c.role ? `${c.roleBefore ? enabledWord(c.roleBefore.enabled) : c.role.bundle ? "번들 기본" : "없음"} → ${enabledWord(c.role.enabled)}` : "",
    before: str(c.beforeText), after: str(c.afterText),
  }));
}
export function planNotes(plan) {
  if (!isObj(plan)) return [];
  const out = [];
  for (const n of Array.isArray(plan.notes) ? plan.notes : []) if (n && n.message) out.push("· " + clip(n.message, 200));
  for (const s of Array.isArray(plan.skipped) ? plan.skipped : []) if (s) out.push(`- 받지 않음: ${clip(s.path, 80)} — ${clip(s.reason, 120)}`);
  for (const w of Array.isArray(plan.warnings) ? plan.warnings : []) if (w) out.push("! " + clip(w, 200));
  return out.length ? out : ["알림 없음"];
}

// ---- 백업 탭
export function backupRows(list) {
  const b = isObj(list) && Array.isArray(list.backups) ? list.backups : [];
  return b.map((x, i) => ({ key: "bk-" + i, dir: str(x.dir), at: clip(x.createdAt, 25), kind: clip(x.kind, 20), note: clip(x.note, 80), files: Number.isInteger(x.files) ? x.files : 0 }));
}

// ---- 실제 창 탭(읽기 전용)
export function liveRows(live) {
  if (!isObj(live)) return { available: false, note: "조회하지 못했습니다", rows: [], counts: {} };
  if (live.available === false) return { available: false, note: clip(live.note, 200) || "허더(hc)를 찾지 못해 조회할 수 없습니다", rows: [], counts: {} };
  const w = Array.isArray(live.windows) ? live.windows : [];
  return {
    available: true, note: live.truncated ? `앞의 ${live.shown}개만 보입니다(전체 ${live.total}개)` : "", counts: isObj(live.counts) ? live.counts : {},
    rows: w.map((x, i) => ({ key: "lv-" + i, address: clip(x.address, 20), agent: clip(x.agent, 24), status: clip(x.status, 16), where: clip(x.where, 70), inScope: x.inScope })),
  };
}

// 요청 파일 이름은 고정 하나만 쓰므로 길이만 점검한다(엔진도 2 MiB 를 넘으면 거절한다).
export const REQ_MAX_CHARS = 300_000;   // 한글은 글자당 3바이트라 최악 약 0.9 MB: 허더 readTextFile 한계(1 MiB) 안
export function requestText(req) {
  const t = JSON.stringify(req ?? {});
  return t.length > REQ_MAX_CHARS ? null : t;
}

// 지난 시간을 쉬운 말로(ISO 시각 글자 또는 밀리초)
export function ago(at, now = Date.now()) {
  const ms = typeof at === "number" ? at : Date.parse(str(at));
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "방금";
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

// ---------------------------------------------------------------- 단축키(keys.json) — 순수 계산
// 허더의 keys.json 에서 "이 모드를 여는 한 줄"만 안전하게 바꾸기 위한 계산이다. 파일을 읽고 쓰는 일은 main.js 가 한다.
export const OWN_ACTION = "mod.open:orch-manager";
export const DEFAULT_KEY = "ctrl-shift-m";
const KEY_NAMED = new Set(["left", "right", "up", "down", "home", "end", "pageup", "pagedown", "insert", "delete", "backspace", "enter", "tab", "space",
  "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12"]);
const MOD_ORDER = ["ctrl", "alt", "shift"];
const MOD_ALIAS = { ctrl: "ctrl", control: "ctrl", alt: "alt", option: "alt", shift: "shift" };
const RESERVED = new Set(["alt-f4", "alt-space", "alt-tab"]);   // 운영체제가 먼저 쓰는 키

// 키 글자(예: "Ctrl+Shift+M", "ctrl-shift-m")를 허더 형식(소문자, ctrl-alt-shift 순서, 하이픈)으로 바꾸고 선택해도 되는지 본다.
// 돌려주는 값: { ok:true, key } | { ok:false, error }
export function normalizeKey(text) {
  const t = str(text).trim().toLowerCase().replace(/\s+/g, "").replace(/\+/g, "-");
  if (!t) return { ok: false, error: "키를 입력하세요" };
  if (!/^[a-z0-9-]+$/.test(t)) return { ok: false, error: "영문·숫자·방향키·F키만 쓸 수 있습니다 (예: ctrl-shift-m)" };
  const parts = t.split("-");
  if (parts.some((p) => p === "")) return { ok: false, error: "키 형식이 올바르지 않습니다 (예: ctrl-shift-m)" };
  const key = parts.pop(); const mods = [];
  for (const p of parts) {
    const m = MOD_ALIAS[p];
    if (!m) return { ok: false, error: `알 수 없는 조합 키: ${clip(p, 20)} (ctrl, alt, shift 만 쓸 수 있습니다)` };
    if (mods.includes(m)) return { ok: false, error: `${m} 가 두 번 들어 있습니다` };
    mods.push(m);
  }
  const single = /^[a-z0-9]$/.test(key);
  if (!single && !KEY_NAMED.has(key)) return { ok: false, error: `지원하지 않는 키: ${clip(key, 20)} (영문·숫자·방향키·F1~F12·Enter·Tab·Space·Home/End/PageUp/PageDown/Insert/Delete/Backspace)` };
  if (mods.length === 0) return { ok: false, error: "Ctrl, Alt, Shift 중 하나 이상을 함께 쓰세요 (그냥 누르는 키는 터미널 입력과 겹칩니다)" };
  if (mods.includes("ctrl") && mods.includes("alt")) return { ok: false, error: "Ctrl+Alt 는 Windows 에서 AltGr(글자 입력)이라 쓸 수 없습니다" };
  if (mods.length === 1 && mods[0] === "shift" && (single || key === "space")) return { ok: false, error: "Shift 만으로는 글자가 입력됩니다. Ctrl 이나 Alt 를 함께 쓰세요" };
  if (mods.length === 1 && mods[0] === "ctrl" && /^[a-z]$/.test(key)) return { ok: false, error: "Ctrl+글자는 터미널 프로그램이 쓰는 키입니다. Shift 나 Alt 를 함께 쓰세요" };
  const norm = [...MOD_ORDER.filter((m) => mods.includes(m)), key].join("-");
  if (RESERVED.has(norm)) return { ok: false, error: "운영체제가 먼저 쓰는 키라서 쓸 수 없습니다" };
  return { ok: true, key: norm };
}

// 사람이 읽는 글자: ctrl-shift-m -> Ctrl+Shift+M
export function keyLabel(key) { return str(key).split("-").map((p) => (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))).join("+"); }

// 화면의 버튼(Ctrl/Alt/Shift)과 입력칸 글자로 키를 만든다.
export function composeKey(mods, keyText) {
  const k = str(keyText).trim().toLowerCase();
  const m = MOD_ORDER.filter((x) => mods && mods[x]);
  return normalizeKey([...m, k].join("-"));
}

const canon = (k) => { const n = normalizeKey(k); return n.ok ? n.key : str(k).trim().toLowerCase(); };

// 허더가 알려 주는 모든 구역의 단축키(keys())에서 같은 키를 이미 쓰는 줄을 찾는다. 이 모드를 여는 줄 자신은 제외한다.
// 구체적인 구역(terminal, layout:*, mod:*)이 global 보다 우선하므로 global 만 보면 안 되고 모든 구역을 본다.
export function findKeyConflict(bindings, key) {
  const want = canon(key);
  for (const b of Array.isArray(bindings) ? bindings : []) {
    if (!b || b.action === OWN_ACTION) continue;
    if (canon(b.keys) === want) return { section: str(b.section), action: clip(b.action, 60) };
  }
  return null;
}
export const ownKeys = (bindings) => (Array.isArray(bindings) ? bindings : []).filter((b) => b && b.action === OWN_ACTION).map((b) => ({ section: str(b.section), keys: str(b.keys) }));

// ---- keys.json 글자 수정: "global" 구역에서 이 모드를 여는 줄만 지우고(있으면), 새 키 한 줄을 맨 앞에 넣는다(newKey 가 null 이면 지우기만).
// 나머지 글자는 한 바이트도 건드리지 않고(들여쓰기·줄바꿈 유지), 결과를 다시 읽어 "우리 줄 말고는 전부 같다"가 아니면 거절한다(안전 쪽으로 실패).
function sectionRange(raw, name) {
  const m = new RegExp('"' + name + '"\\s*:\\s*\\{').exec(raw);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  let depth = 0, inStr = false, esc = false;
  for (let i = open; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return { open, close: i }; }
  }
  return null;
}
const stable = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

export function planKeysText(raw, newKey) {
  const text = str(raw);
  if (newKey !== null) { const n = normalizeKey(newKey); if (!n.ok) return { ok: false, error: n.error }; newKey = n.key; }
  let oldObj; try { oldObj = JSON.parse(text); } catch (e) { return { ok: false, error: "keys.json 이 올바른 JSON 이 아니라서 건드리지 않습니다" }; }
  if (!isObj(oldObj) || !isObj(oldObj.global)) return { ok: false, error: 'keys.json 에 "global" 구역이 없어 건드리지 않습니다' };
  const rg = sectionRange(text, "global");
  if (!rg) return { ok: false, error: 'keys.json 의 "global" 구역을 찾지 못했습니다' };
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const inner = text.slice(rg.open + 1, rg.close);
  const ownLine = /^[ \t]*"[^"\\]+"[ \t]*:[ \t]*"mod\.open:orch-manager"[ \t]*,?[ \t]*$/;
  const lines = inner.split(/\r?\n/);
  const kept = lines.filter((l) => !ownLine.test(l));
  const removed = lines.length - kept.length;
  const entryIdx = []; kept.forEach((l, i) => { if (l.trim() !== "") entryIdx.push(i); });
  if (newKey !== null) {
    const firstEntry = entryIdx.length ? kept[entryIdx[0]] : "";
    const indent = /^[ \t]*/.exec(firstEntry)[0] || "    ";
    const line = `${indent}"${newKey}": "${OWN_ACTION}"` + (entryIdx.length ? "," : "");
    const at = entryIdx.length ? entryIdx[0] : kept.length;
    kept.splice(at, 0, line);
  }
  // 마지막 항목 줄 끝의 쉼표는 JSON 에서 허용되지 않으므로(맨 끝 줄을 지웠을 때) 정리한다
  let li = -1; for (let i = kept.length - 1; i >= 0; i--) if (kept[i].trim() !== "") { li = i; break; }
  if (li >= 0) kept[li] = kept[li].replace(/,([ \t]*)$/, "$1");
  const out = text.slice(0, rg.open + 1) + kept.join(nl) + text.slice(rg.close);
  let newObj; try { newObj = JSON.parse(out); } catch (e) { return { ok: false, error: "수정 결과가 올바른 JSON 이 아니라서 건드리지 않습니다" }; }
  const want = JSON.parse(JSON.stringify(oldObj));
  for (const k of Object.keys(want.global)) if (want.global[k] === OWN_ACTION) delete want.global[k];
  if (newKey !== null) want.global = { [newKey]: OWN_ACTION, ...want.global };
  if (stable(newObj) !== stable(want)) return { ok: false, error: "수정 결과가 예상과 달라(다른 줄이 바뀔 수 있음) 건드리지 않습니다" };
  return { ok: true, text: out, changed: out !== text, removed, added: newKey !== null };
}

// 쓴 결과를 다시 읽어 확인할 때 쓴다: global 구역에 이 모드를 여는 줄이 (newKey 가 null 이면 0개, 아니면 그 키로 정확히 1개)인가.
export function verifyKeysText(text, newKey) {
  try {
    const g = JSON.parse(str(text)).global;
    if (!isObj(g)) return false;
    const own = Object.keys(g).filter((k) => g[k] === OWN_ACTION);
    return newKey === null ? own.length === 0 : own.length === 1 && own[0] === newKey;
  } catch { return false; }
}

// 단축키 변경의 입출력 순서(허더의 readTextFile/writeTextFile 을 주입받는다 — 시험에서는 가짜 입출력을 넣어 실패 경로까지 확인한다):
//   읽기 → 계산·검증 → (바뀔 때만) 백업 파일 만들기 → 읽은 그대로일 때만 쓰기 → 다시 읽어 확인 → 어긋나면 원래대로 되돌리기.
// write(path, text, expected): expected 가 null 이면 새 파일(이미 있으면 거절), 아니면 지금 내용이 expected 와 같을 때만 쓴다(아니면 거절).
// 돌려주는 값: { ok, msg, changed?, bak? } — 예외를 던지지 않는다.
export async function applyKeysChange({ read, write, path, newKey, stamp }) {
  let raw = null; let wrote = false; let bak = "";
  try {
    raw = await read(path);
    if (raw === null) throw new Error("keys.json 을 찾지 못했습니다");
    const plan = planKeysText(raw, newKey);
    if (!plan.ok) throw new Error(plan.error);
    if (!plan.changed) return { ok: true, changed: false, msg: "이미 그렇게 설정되어 있습니다" };
    bak = `${path}.bak-orch-key-${str(stamp)}`;
    await write(bak, raw, null);                      // 백업이 먼저(이미 있으면 거절되어 아무것도 바뀌지 않음)
    await write(path, plan.text, raw);                // 그 사이 다른 곳에서 바뀌었으면 거절됨
    wrote = true;
    const back = await read(path);
    if (back !== plan.text || !verifyKeysText(back, newKey)) throw new Error("쓴 결과를 확인하지 못했습니다");
    const name = bak.split("/").pop();
    return { ok: true, changed: true, bak, msg: newKey ? `단축키를 ${keyLabel(newKey)} 로 바꿨습니다 (백업: ${name})` : `단축키 연결을 해제했습니다 (Ctrl+Shift+P → mod.open orch-manager 로 엽니다, 백업: ${name})` };
  } catch (e) {
    const why = clip((e && e.message) || e, 160);
    if (wrote) {                                      // 쓴 뒤에 확인이 어긋났으면 원래대로 되돌린다
      try { const cur = await read(path); await write(path, raw, cur); return { ok: false, msg: `바꾸지 않았습니다(원래대로 되돌렸습니다): ${why}`, bak }; }
      catch (e2) { return { ok: false, msg: `되돌리지 못했습니다. 백업 파일로 직접 복원하세요: ${bak} (${why})`, bak }; }
    }
    return { ok: false, msg: `바꾸지 않았습니다. keys.json 은 그대로입니다: ${why}` };
  }
}

// ---------------------------------------------------------------- 화면 글자(한국어 라벨) — 영어 값은 괄호로 함께 보여 준다
export const MODE_LABEL = { "read-only": "읽기 전용", "scoped-write": "범위 내 쓰기" };
export const MODE_HINT = { "read-only": "이 역할 창은 파일을 읽기만 합니다.", "scoped-write": "아래 '쓸 수 있는 곳'에 적은 경로에만 쓸 수 있습니다." };
export const CADENCE_LABEL = { "on-request": "요청 시", periodic: "주기적" };
export const CADENCE_HINT = { "on-request": "총지휘가 시킬 때만 일합니다.", periodic: "정해진 주기마다 스스로 확인합니다." };
export const SCOPE_LABEL = { portable: "이식용", full: "전체" };
export const SCOPE_HINT = { portable: "역할 + 환경 규칙 + ignore. 이 PC의 경로 설정은 빼고 내보냅니다(다른 PC로 옮길 때).", full: "이 PC의 설정까지 전부. 같은 PC의 백업·복원용입니다." };
export const IMPORT_MODE_LABEL = { merge: "합치기", replace: "교체" };
export const IMPORT_MODE_HINT = { merge: "내 역할은 남기고, 묶음의 것을 더하거나 바꿉니다.", replace: "묶음에 없는 내 역할은 지웁니다(지운 것은 자동 백업에 남습니다)." };
export const modeLabel = (v) => (MODE_LABEL[v] ? `${MODE_LABEL[v]} (${v})` : str(v));
export const cadenceLabel = (v) => (CADENCE_LABEL[v] ? `${CADENCE_LABEL[v]} (${v})` : str(v));

// 현황 줄의 색 구분(tone)을 배지 글자로. 색만으로 구분하지 않도록 글자를 함께 쓴다.
export const toneWord = (tone) => (tone === "ok" ? "정상" : tone === "warn" ? "확인 필요" : tone === "bad" ? "오류" : "");

// 실제 창의 상태 글자와 색. 모르는 값은 "확인 불가".
const LIVE_WORD = { working: ["작업 중", "info"], blocked: ["승인 대기", "warn"], done: ["완료", "ok"], idle: ["대기", "muted"] };
export function liveStatus(s) { const k = str(s).toLowerCase(); return LIVE_WORD[k] ? { word: LIVE_WORD[k][0], tone: LIVE_WORD[k][1] } : { word: k && k !== "?" ? clip(k, 12) : "확인 불가", tone: "muted" }; }
// counts(엔진 응답의 상태별 개수) → 화면 요약 칩. 주의가 필요한 것(승인 대기)을 앞에 둔다.
export function summarizeLive(counts) {
  const c = isObj(counts) ? counts : {}; const order = ["blocked", "working", "idle", "done"]; const out = [];
  for (const k of order) if (Number.isInteger(c[k]) && c[k] > 0) out.push({ key: k, label: `${liveStatus(k).word} ${c[k]}`, tone: liveStatus(k).tone, count: c[k] });
  const other = Object.keys(c).filter((k) => !order.includes(k)).reduce((a, k) => a + (Number.isInteger(c[k]) ? c[k] : 0), 0);
  if (other > 0) out.push({ key: "other", label: `확인 불가 ${other}`, tone: "muted", count: other });
  return out;
}
// 탭 이름표 옆 "주의" 표시: 승인 대기 창이 있거나, 설정·역할에 문제가 있거나, 생성물이 낡았을 때만 보인다.
export function tabBadges(st, lv) {
  const b = {};
  if (isObj(st)) {
    const c = isObj(st.config) ? st.config : {}; const g = isObj(st.generated) ? st.generated : {};
    const roles = Array.isArray(st.roles) ? st.roles : [];
    if (st.ok === false || c.valid === false || roles.some((r) => Array.isArray(r.errors) && r.errors.length)) b.status = { text: "●", tone: "bad" };
    else if (g.state === "stale" || (Array.isArray(c.unset) && c.unset.length)) b.status = { text: "●", tone: "warn" };
  }
  if (isObj(lv) && lv.available !== false && isObj(lv.counts) && Number.isInteger(lv.counts.blocked) && lv.counts.blocked > 0) b.live = { text: `${lv.counts.blocked}`, tone: "warn" };
  return b;
}
