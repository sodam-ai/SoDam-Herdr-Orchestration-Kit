// hc-watch.mjs v3 - Herdr control-center watcher.
// stdout = notifications to the controller session. EVERY notification wakes the model
// (and costs tokens), so this script is deliberately quiet:
//   - blocked  : only if still blocked after BLOCK_MS (default 300s = really neglected)
//   - done     : only if stable for DONE_MS (default 60s)   -> "your turn" marker
//   - error    : after ERROR_MS (default 5s)
//   - new / gone / renamed sessions: reported (rare)
//   - working / idle / turn / progress messages: never reported
//   - lines are buffered and flushed together every FLUSH_MS (default 60s)
//   - safety valve: more than 8 flushes in 10 minutes -> prints a notice and exits
// The ONLY write it ever does (owner's rule, 2026-11-02): when a Claude Code session's
// context usage is >= CTX_PCT (default 57) it types `/compact` into THAT session, and only if
//   done/idle + empty input box + no dialog on screen (checked twice, 1.5s apart) + fresh `hc ls`
//   agrees + not within 20 min of the last one + <=1 per scan + <=3 per 10 min + no compact.off file.
//   DRY_RUN=1 only reports what it would do. Create `compact.off` in the config folder to disable (the old state folder still works).
// PORTABLE VERSION: auto /compact is OFF unless ORCH_AUTOCOMPACT=1 AND WATCH_ONLY (the allow list) is not empty.
//   Otherwise one line says why and only the alerts keep working.
// Files: ignore.txt and compact.off in config\ (see lib/orch-paths.mjs; ORCH_HOME moves them).
// Sources: `hc events --json` (push) + `hc ls --json` every 30s (safety net for new/gone).
import { spawn, execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { resolvePaths, ensurePaths } from '../../lib/orch-paths.mjs';

// Where the config and state files live. The folders are created here, at start-up, on purpose (the lib itself never creates anything).
const orchPaths = ensurePaths(resolvePaths());

const HC = process.env.HC_BIN || 'hc';
const SELF = process.env.HC_SELF || process.env.HC_TERMINAL_ID;
const ADDR_RE = /^t[0-9a-z]+$/;
if (!SELF || !ADDR_RE.test(SELF)) {
  console.log('[감시 시작 실패] 자기 터미널(HC_SELF/HC_TERMINAL_ID)을 알 수 없어 안전하게 종료합니다.');
  process.exit(1);
}
// compact.off is a switch the USER creates, so it lives in config\. The old place (state\) still counts, with a one-time notice.
const KILL_FILE = path.join(orchPaths.config, 'compact.off');
const LEGACY_KILL_FILE = path.join(orchPaths.state, 'compact.off');
let legacyKillNoted = false;
function compactKilled() {
  if (existsSync(KILL_FILE)) return true;
  if (existsSync(LEGACY_KILL_FILE)) {
    if (!legacyKillNoted) { legacyKillNoted = true; emit('[안내] compact.off 이 옛 위치(state)에 있어 지금은 그대로 꺼짐으로 인정합니다. config 폴더로 옮겨 주세요'); }
    return true;
  }
  return false;
}
// ignore.txt (config folder): one name fragment per line ("where" label = tab/folder name). Sessions that
// match are the owner's own ("신경 쓰지 마") - never alerted, never typed into. Re-read on every `hc ls`.
const IGNORE_FILE = path.join(orchPaths.config, 'ignore.txt');
const ignoredAddrs = new Set();
// WATCH_ONLY (2026-11-10, cost cut): when set, ONLY sessions whose "where" label starts with this text are watched
// (alerts AND auto-/compact). Everything else is treated like ignore.txt. Example: WATCH_ONLY="My-Space-1 /".
// Unset/empty = old behaviour (watch everything except ignore.txt).
const WATCH_ONLY = String(process.env.WATCH_ONLY ?? '').trim();
function loadIgnore() {
  try { return readFileSync(IGNORE_FILE, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')); } catch { return []; }
}
const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);
const DEBOUNCE = {
  blocked: num(process.env.BLOCK_MS, 300000),
  done: num(process.env.DONE_MS, 60000),
  error: num(process.env.ERROR_MS, 5000),
};
const DRY_RUN = process.env.DRY_RUN === '1';
const FLUSH_MS = Math.max(1000, num(process.env.FLUSH_MS, 60000));
const RECONCILE_MS = 30000;
const SILENCE_MS = 90000;
const MAX_FLUSHES_PER_10MIN = 8;
// the real-send threshold can never be configured below 57 (only DRY_RUN may test lower values)
const CTX_THRESHOLD = DRY_RUN ? num(process.env.CTX_PCT, 57) : Math.max(57, num(process.env.CTX_PCT, 57));
const CTX_SCAN_MS = Math.max(DRY_RUN ? 3000 : 15000, num(process.env.CTX_SCAN_MS, 45000));
const COMPACT_COOLDOWN_MS = num(process.env.COMPACT_COOLDOWN_MS, 20 * 60000);
// Control-tower windows (name contains CTRL_MATCH) + this controller itself compact LATER and LESS OFTEN (owner's rule, 2026-11-02 07:38)
const CTRL_MATCH = process.env.ORCH_CTRL_MATCH || process.env.CTRL_MATCH || 'Control-Tower';
const CTRL_THRESHOLD = Math.max(65, num(process.env.CTRL_PCT, 70));
const CTRL_COOLDOWN_MS = num(process.env.CTRL_COOLDOWN_MS, 60 * 60000);
// Allow-list-first rule: auto /compact types into other sessions, so it needs an explicit opt-in AND a list of places to watch.
const AUTOCOMPACT_REQUESTED = process.env.ORCH_AUTOCOMPACT === '1';
const COMPACT_OFF_WHY = !AUTOCOMPACT_REQUESTED ? 'ORCH_AUTOCOMPACT=1 이 아니라서'
  : !WATCH_ONLY ? 'WATCH_ONLY(볼 곳 목록)가 비어 있어서' : '';
const COMPACT_ENABLED = COMPACT_OFF_WHY === '';
const NO_BAR_SCANS = 2; // consecutive scans without any readable status bar before we say so (a dialog can hide it once)
const MAX_COMPACTS_PER_10MIN = 3;
const STABLE_MS = 60000; // status must be unchanged this long before we may type into a session

const terms = new Map();       // addr -> { where, agent, status, msg }
const pending = new Map();     // addr -> debounce timer
const lastEmitted = new Map(); // addr -> "state|msg"
const missed = new Map();      // addr -> consecutive reconcile misses
const lastCompact = new Map(); // addr -> timestamp
const compactTimes = [];       // timestamps of recent /compact sends
const ctxNoted = new Set();
const seenTypes = new Set(['status', 'turn', 'size', 'created', 'foreground', 'labels', 'finished', 'removed', 'doc', 'title']);
let initialized = false;
let buffer = [];
let flushTimer = null;
let exiting = false;
const flushTimes = [];

const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
const clip = (s, n = 160) => (s.length > n ? s.slice(0, n) + '...' : s);
const short = (w) => clean(w ?? '?').replace(/^\S+\s*\/\s*/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let suppressed = 0;
let mustFlush = false; // true when the buffer holds a line that must never be dropped (actions taken)

function flush() {
  flushTimer = null;
  if (!buffer.length) return;
  const now = Date.now();
  while (flushTimes.length && now - flushTimes[0] > 600000) flushTimes.shift();
  if (flushTimes.length >= MAX_FLUSHES_PER_10MIN && !mustFlush) {
    // notification budget used up: keep watching, drop this batch, tell once later
    suppressed += buffer.length;
    buffer = [];
    return;
  }
  const head = suppressed ? [`(알림이 많아 ${suppressed}건 생략됨)`] : [];
  suppressed = 0;
  console.log([...head, ...buffer].join('\n')); // one write -> one notification
  buffer = [];
  mustFlush = false;
  flushTimes.push(now);
}

// `important` lines (a /compact was typed, or failed) are never suppressed.
function emit(text, immediate = false, important = false) {
  buffer.push(text);
  if (important) mustFlush = true;
  if (immediate || important) { clearTimeout(flushTimer); flush(); return; }
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
}

function runHc(args) {
  return new Promise((resolve) => {
    execFile(HC, args, { maxBuffer: 16e6, encoding: 'utf8', windowsHide: true, timeout: 15000 }, (err, out) => resolve(err ? null : out));
  });
}
async function runLs() {
  const out = await runHc(['ls', '--json']);
  if (out === null) return null;
  try {
    const l = JSON.parse(out).terminals;
    if (!Array.isArray(l)) return null;
    const ign = loadIgnore();
    ignoredAddrs.clear();
    return l.filter((x) => {
      if (!x || !ADDR_RE.test(x.address)) return false;
      if (ign.length && ign.some((p) => String(x.where ?? '').includes(p))) { ignoredAddrs.add(x.address); return false; }
      if (WATCH_ONLY && !String(x.where ?? '').startsWith(WATCH_ONLY)) { ignoredAddrs.add(x.address); return false; }
      // 2026-11-02 user rule: control Claude Code sessions only (a shell that later starts claude shows up then)
      if (x.agent !== 'claude-code') { ignoredAddrs.add(x.address); return false; }
      return true;
    });
  } catch { return null; }
}

function fire(addr, state) {
  pending.delete(addr);
  const t = terms.get(addr);
  if (!t || t.status !== state) return;
  const key = `${state}|${t.msg}`;
  if (lastEmitted.get(addr) === key) return;
  lastEmitted.set(addr, key);
  const label = { blocked: '승인/답변 대기(방치됨)', done: '턴 끝-사용자 차례', error: '오류' }[state];
  emit(`[${label}:${state}] ${addr} ${short(t.where)}${t.msg ? ' - ' + clip(t.msg) : ''}`);
}

function onStatus(addr, state, msg) {
  if (addr === SELF || ignoredAddrs.has(addr) || !ADDR_RE.test(addr)) return;
  const t = terms.get(addr);
  if (!t) { scheduleReconcile(); return; } // unknown yet: let reconcile register it properly
  if (!state) { // agent exited / status cleared: forget pending alerts
    clearTimeout(pending.get(addr)); pending.delete(addr); lastEmitted.delete(addr);
    if (t.status !== null) t.since = Date.now();
    t.status = null; t.msg = '';
    return;
  }
  const same = t.status === state;
  if (!same) t.since = Date.now();
  t.status = state;
  t.msg = clean(msg);
  if (state in DEBOUNCE) {
    if (same && pending.has(addr)) return; // keep the original timer, only the message was refreshed
    clearTimeout(pending.get(addr));
    pending.set(addr, setTimeout(() => fire(addr, state), DEBOUNCE[state]));
  } else {
    clearTimeout(pending.get(addr)); pending.delete(addr);
    lastEmitted.delete(addr); // back to work/idle: the next blocked/done is news again
  }
}

function reconcile(list) {
  const seen = new Set();
  for (const x of list) {
    if (x.address === SELF) continue;
    seen.add(x.address);
    missed.delete(x.address);
    const t = terms.get(x.address);
    if (!t) {
      terms.set(x.address, { where: clean(x.where ?? '?'), agent: x.agent ?? 'shell', status: x.status ?? null, msg: '', since: Date.now() });
      if (initialized) {
        emit(`[새 세션] ${x.address} ${short(x.where)} (${x.agent ?? 'shell'}, ${x.status ?? '상태없음'})`);
        if (x.status in DEBOUNCE) onStatus(x.address, x.status, '');
      }
      continue;
    }
    if (x.agent && x.agent !== t.agent) t.agent = x.agent; // e.g. a shell that started claude-code
    const w = clean(x.where ?? '');
    if (w && w !== t.where) {
      emit(`[이름/위치 변경] ${x.address} ${short(t.where)} -> ${short(w)}`);
      t.where = w;
    }
    if ((x.status ?? null) !== (t.status ?? null)) onStatus(x.address, x.status ?? null, ''); // missed event
  }
  for (const [addr, t] of [...terms]) {
    if (seen.has(addr)) continue;
    const n = (missed.get(addr) ?? 0) + 1; // require two consecutive misses (ls can race with creation)
    missed.set(addr, n);
    if (n < 2) continue;
    clearTimeout(pending.get(addr));
    for (const m of [pending, lastEmitted, missed, lastCompact]) m.delete(addr);
    ctxNoted.delete(addr);
    terms.delete(addr);
    if (!ignoredAddrs.has(addr)) emit(`[세션 종료/사라짐] ${addr} ${short(t.where)} (${t.agent})`);
  }
  if (!initialized) {
    initialized = true;
    const groups = {};
    for (const [addr, t] of terms) (groups[t.status ?? 'none'] ??= []).push(`${addr} ${short(t.where)}`);
    const parts = Object.entries(groups).map(([k, v]) => `${k}: ${v.join(', ')}`);
    emit(`[감시 시작 v3${DRY_RUN ? ' DRY_RUN' : ''}] 살아있는 세션 ${terms.size}개 (나=${SELF} 제외) | ${parts.join(' | ')}`, true);
  }
}

async function reconcileNow() {
  try { const list = await runLs(); if (list) reconcile(list); } catch { /* keep running */ }
}
let rcTimer;
function scheduleReconcile() { clearTimeout(rcTimer); rcTimer = setTimeout(reconcileNow, 1500); }

function handleEvent(p) {
  const addr = p.terminal;
  if (addr === SELF || ignoredAddrs.has(addr)) return;
  if (p.type === 'status') {
    const s = p.data?.status ?? {};
    onStatus(addr, s.state, s.msg);
    return;
  }
  if (p.type === 'turn') return;
  if (!seenTypes.has(p.type)) { // first time we see a new event kind: tell once, then stay quiet
    seenTypes.add(p.type);
    emit(`[새 이벤트 종류:${clean(p.type)}] ${clean(addr ?? '')} ${clip(clean(JSON.stringify(p.data ?? {})), 140)}`);
  }
  scheduleReconcile();
}

let failures = 0;
function startEvents() {
  let retried = false;
  const child = spawn(HC, ['events', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  child.stdout.setEncoding('utf8');
  let lastData = Date.now();
  let upSince = 0;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    try {
      lastData = Date.now();
      if (!upSince) upSince = lastData;
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.terminals || m.method !== 'event' || !m.params) return; // snapshot/heartbeat: reconcile covers it
      handleEvent(m.params);
    } catch { /* never let one bad line stop the watch */ }
  });
  const watchdog = setInterval(() => { if (Date.now() - lastData > SILENCE_MS) child.kill(); }, 15000);
  const retry = (why) => {
    if (retried) return;
    retried = true;
    clearInterval(watchdog);
    if (upSince && Date.now() - upSince > 60000) failures = 0; // only a connection that lived a while counts as healthy
    if (failures === 0) emit(`[감시 끊김] hc events ${why} - 재연결 시도`);
    failures++;
    setTimeout(() => { reconcileNow(); startEvents(); }, Math.min(30000, 3000 * 2 ** Math.min(failures, 4)));
  };
  child.on('error', (e) => retry(`오류(${clean(e.code ?? e.message)})`));
  child.on('exit', (code) => retry(`종료(code ${code})`));
}

// ---- owner's rule: when a session's context nears 60%, run /compact in it ----
function inspect(scr) {
  const rows = scr.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(-12); // bottom of the screen only
  let promptIdx = -1;
  let barIdx = -1;
  let pct = null;
  rows.forEach((r, i) => {
    if (r.startsWith('❯')) promptIdx = i;
    const m = r.match(/컨텍스트\s+\S+\s+(\d+)%/);
    if (m) { barIdx = i; pct = Number(m[1]); }
  });
  const dialog = /Esc to cancel|Do you want|❯\s*\d\.|^\d\.\s+(Yes|No)\b/m.test(rows.join('\n'));
  // empty box = a lone prompt row, a border line directly under it, and the status bar further down
  // (a multi-line input would have text rows between the prompt and the border)
  const inputEmpty = promptIdx >= 0 && rows[promptIdx] === '❯' && barIdx > promptIdx
    && /^[─━╌-]{10,}$/.test(rows[promptIdx + 1] ?? '');
  const promptArea = promptIdx >= 0 ? rows.slice(0, promptIdx + 1).join('\n') : '';
  return { pct, dialog, inputEmpty, promptArea };
}

let scanning = false;
let barEverSeen = false;
let noBarScans = 0;
let noBarNoted = false;
async function scanContext() {
  if (scanning) return;
  scanning = true;
  try {
    let sent = 0;
    let scanned = 0;
    let barsThisScan = 0;
    for (const [addr, t] of [...terms]) {
      if (addr === SELF || !ADDR_RE.test(addr) || t.agent !== 'claude-code') continue;
      const scr1 = await runHc(['read', addr]);
      if (!scr1) continue;
      scanned++;
      const a = inspect(scr1);
      if (a.pct === null) continue; // status bar hidden (dialog open) or not a Claude Code screen
      barsThisScan++;
      barEverSeen = true;
      const isCtl = String(t.where ?? '').includes(CTRL_MATCH);
      if (a.pct < (isCtl ? CTRL_THRESHOLD : CTX_THRESHOLD)) { ctxNoted.delete(addr); continue; }
      const cur = terms.get(addr);
      const idle = !!cur && (cur.status === 'done' || cur.status === 'idle') && Date.now() - (cur.since ?? 0) >= STABLE_MS;
      const now = Date.now();
      while (compactTimes.length && now - compactTimes[0] > 600000) compactTimes.shift();
      const cooled = now - (lastCompact.get(addr) ?? 0) >= (isCtl ? CTRL_COOLDOWN_MS : COMPACT_COOLDOWN_MS);
      const allowed = !compactKilled() && sent < 1 && compactTimes.length < MAX_COMPACTS_PER_10MIN;
      if (idle && a.inputEmpty && !a.dialog && cooled && allowed) {
        await sleep(1500); // second look: nothing may have changed in between
        const scr2 = await runHc(['read', addr]);
        const b = scr2 ? inspect(scr2) : null;
        const ls = await runLs();
        const live = ls ? ls.find((x) => x.address === addr) : null;
        const ok = b && b.inputEmpty && !b.dialog && b.pct !== null && b.promptArea === a.promptArea
          && live && live.agent === 'claude-code' && (live.status === 'done' || live.status === 'idle');
        if (!ok) continue; // changed under us: try again next scan
        lastCompact.set(addr, Date.now()); // set before sending: never double-send
        compactTimes.push(Date.now());
        sent++;
        ctxNoted.delete(addr);
        if (DRY_RUN) { emit(`[DRY_RUN /compact 대상] ${addr} ${short(t.where)} (컨텍스트 ${a.pct}%)`); continue; }
        // VERIFIED 2026-11-02: `hc send` wraps text as <hc from="..">..</hc>, so a slash command is NOT run
        // (the target answered "I cannot run /compact"). Type the characters as real keys instead,
        // check the input line shows exactly "/compact", and only then press Enter.
        const typed = await runHc(['keys', addr, '/', 'c', 'o', 'm', 'p', 'a', 'c', 't']);
        let pressed = false;
        if (typed !== null) {
          await sleep(700);
          const scr3 = await runHc(['read', addr]);
          // NOTE: Claude Code draws a NO-BREAK SPACE (U+00A0) after the prompt arrow, so a literal ' ' never matched
          // (found 2026-11-02: t15/t17 auto-compact "failed"). \s+ matches both a normal space and U+00A0.
          if (scr3 && /^❯\s+\/compact\s*$/m.test(scr3)) {
            pressed = (await runHc(['keys', addr, 'enter'])) !== null;
          } else {
            await runHc(['keys', addr, 'backspace', 'backspace', 'backspace', 'backspace', 'backspace', 'backspace', 'backspace', 'backspace']); // never leave stray text in someone's input box
          }
        }
        emit(pressed
          ? `[자동 /compact 실행] ${addr} ${short(t.where)} (컨텍스트 ${a.pct}%)`
          : `[/compact 실행 실패 또는 보류] ${addr} ${short(t.where)} (컨텍스트 ${a.pct}%) - 직접 확인 필요`, false, true);
      } else if (!ctxNoted.has(addr)) {
        ctxNoted.add(addr);
        const why = !idle ? '작업/승인 대기 중이라 끝나면 실행'
          : a.dialog ? '화면에 선택창이 있어 보류'
          : !a.inputEmpty ? '입력창에 글자가 있어 보류'
          : !cooled ? '최근 20분 안에 이미 실행'
          : '안전 상한/중지 파일 때문에 보류';
        emit(`[컨텍스트 ${a.pct}% 접근] ${addr} ${short(t.where)} - ${why}`);
      }
    }
    // Never fail silently: no `컨텍스트 N%` status bar anywhere -> say it once (auto compact cannot work without it).
    if (scanned > 0 && barsThisScan === 0 && !barEverSeen) {
      noBarScans++;
      if (noBarScans >= NO_BAR_SCANS && !noBarNoted) {
        noBarNoted = true;
        emit('[자동 압축 비활성: 상태줄 없음] 화면 아래에 "컨텍스트 N%" 상태줄이 읽히지 않아 자동 압축을 하지 않습니다', false, true);
      }
    } else if (barsThisScan > 0) { noBarScans = 0; }
  } catch { /* a failed scan must never stop the watcher */ } finally { scanning = false; }
}

// ---- this controller session itself: compact at >= CTRL_THRESHOLD, only when idle with an empty input box ----
let selfNotedAt = 0;
let selfLastCompact = 0;
async function scanSelf() {
  try {
    const scr = await runHc(['read', SELF]);
    if (!scr) return;
    const a = inspect(scr);
    if (a.pct === null || a.pct < CTRL_THRESHOLD) return;
    const raw = await runHc(['get', SELF, '--json']);
    let st = null;
    try { st = JSON.parse(String(raw).replace(/^﻿/, '')).status?.state ?? null; } catch { /* unknown state: treat as busy */ }
    const now = Date.now();
    const idle = (st === 'done' || st === 'idle') && a.inputEmpty && !a.dialog;
    if (idle && !compactKilled() && now - selfLastCompact >= CTRL_COOLDOWN_MS) {
      await sleep(2000);
      const b = inspect((await runHc(['read', SELF])) ?? '');
      if (!b.inputEmpty || b.dialog) return;
      selfLastCompact = now;
      if (DRY_RUN) { emit(`[DRY_RUN 컨트롤센터(나) /compact 대상] 컨텍스트 ${a.pct}%`); return; }
      const typed = await runHc(['keys', SELF, '/', 'c', 'o', 'm', 'p', 'a', 'c', 't']);
      let pressed = false;
      if (typed !== null) {
        await sleep(700);
        const scr3 = await runHc(['read', SELF]);
        if (scr3 && /^❯\s+\/compact\s*$/m.test(scr3)) pressed = (await runHc(['keys', SELF, 'enter'])) !== null;
        else await runHc(['keys', SELF, 'backspace', 'backspace', 'backspace', 'backspace', 'backspace', 'backspace', 'backspace', 'backspace']);
      }
      emit(pressed ? `[컨트롤센터(나) 자동 /compact 실행] 컨텍스트 ${a.pct}%` : `[컨트롤센터(나) /compact 실패 또는 보류] 컨텍스트 ${a.pct}% - 직접 확인 필요`, false, true);
    } else if (now - selfNotedAt > 600000) {
      selfNotedAt = now;
      emit(`[컨트롤센터(나) 컨텍스트 ${a.pct}%] 기준 ${CTRL_THRESHOLD}% 이상 - 지금 일을 끝내고 /compact 필요`, false, true);
    }
  } catch { /* never stop the watcher */ }
}
if (COMPACT_ENABLED) setInterval(() => { scanSelf(); }, 45000);

// Auto compact off = say why once (alerts keep working); on = start the scanners.
if (!COMPACT_ENABLED) emit(`[자동 압축 꺼짐] ${COMPACT_OFF_WHY} 압축 기능을 끄고 알림만 동작합니다`, true);
await reconcileNow();
setInterval(reconcileNow, RECONCILE_MS);
if (COMPACT_ENABLED) setInterval(() => { scanContext(); }, CTX_SCAN_MS);
startEvents();
