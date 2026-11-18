#!/usr/bin/env node
// role-watch: 역할 단위 감시. "역할 N개 중 몇 개가 정상인지"가 **바뀔 때만** 한 줄씩 알린다(총괄이 Monitor 로 이 출력을 받는다).
// 왜 필요한가: hc-watch 는 "t1bx 라는 창이 생겼다/사라졌다"만 알려서, 어느 역할이 빠졌다 돌아왔는지는 총괄이 매번 다시 맞춰 봐야 한다.
// 이 감시는 role-check(세션 ID 기준)를 주기적으로 돌려 "6번 시험 지시: 없음 → 정상 (t1br)" 처럼 역할 이름으로 알린다.
// 읽기 전용: hc 는 `ls --json` 만 부르고(role-check 가 그렇게 한다), 세션키퍼 map 은 읽기만 하며, 어떤 파일도 쓰지 않고 어느 창에도 아무것도 보내지 않는다.
// 조용하게: 변화가 CONFIRM 번 연속 같을 때만 알리고(복구 직후 map 이 몇 초 늦는 것을 걸러냄), 알림은 FLUSH 동안 모아 한 번에 낸다.
// 사용: node bin/role-watch.mjs [--once]      환경변수: ROLE_WATCH_MS(점검 간격, 기본 15000, 최소 200) · ROLE_WATCH_CONFIRM(기본 2) · ROLE_WATCH_FLUSH_MS(기본 20000)
import { fileURLToPath } from 'node:url';
import { makeCtx } from './manage-lib.mjs';
import { roleCheck } from './manage-check.mjs';

const ST = { ok: '정상', moved: '탭 밖', missing: '없음', unknown: '확인 불가', guess: '추정만', unassigned: '배정 안 됨' };
const hhmmss = (d = new Date()) => d.toTimeString().slice(0, 8);

// 점검 결과 → 비교용 상태(주소·세션ID 는 로그에 남기되 비교는 역할별 상태+주소, 미배정 창 목록, 점검 가능 여부로 한다)
export function snapshot(res) {
  if (!res || res.available === false) return { available: false, why: res && res.note ? String(res.note) : '점검 불가', roles: {}, extras: [] };
  const roles = {}; for (const r of res.roles) roles[r.id] = { name: r.name, slot: r.slot, status: r.status, address: r.address ?? null };
  return { available: true, why: null, roles, extras: res.extras.map((e) => e.address).sort(), headline: res.headline };
}

// 두 상태의 차이를 사람이 읽는 줄로. 같으면 빈 배열.
export function diffSnapshots(prev, cur) {
  const out = [];
  if (!prev) return out;
  if (prev.available && !cur.available) return [`점검 불가: ${cur.why}`];
  if (!prev.available && cur.available) return [`점검 다시 가능 — ${cur.headline}`];   // 점검 불가였던 동안의 상태는 모르니 역할별 차이는 내지 않고 현재 요약만 알린다
  if (!cur.available) return out;
  const ids = Object.keys(cur.roles).sort((a, b) => (cur.roles[a].slot - cur.roles[b].slot) || (a < b ? -1 : 1));
  for (const id of ids) {
    const a = prev.roles[id], b = cur.roles[id], tag = `${b.slot}번 ${b.name}`;
    if (!a) { out.push(`${tag}: 새로 점검 대상이 됨 (${ST[b.status]}${b.address ? ' ' + b.address : ''})`); continue; }
    if (a.status !== b.status) out.push(`${tag}: ${ST[a.status]} → ${ST[b.status]}${b.address ? ' (' + b.address + ')' : ''}`);
    else if (a.address !== b.address && a.address && b.address) out.push(`${tag}: 창 교체 ${a.address} → ${b.address} (${ST[b.status]})`);
  }
  for (const id of Object.keys(prev.roles)) if (!cur.roles[id]) out.push(`${prev.roles[id].slot}번 ${prev.roles[id].name}: 점검 대상에서 빠짐`);
  const pe = new Set(prev.extras), ce = new Set(cur.extras);
  const added = cur.extras.filter((x) => !pe.has(x)), gone = prev.extras.filter((x) => !ce.has(x));
  if (added.length) out.push(`역할 탭에 배정 안 된 새 창: ${added.join(', ')}`);
  if (gone.length) out.push(`배정 안 된 창 사라짐: ${gone.join(', ')}`);
  return out;
}

const keyOf = (s) => JSON.stringify(s.available ? { r: s.roles, e: s.extras } : { a: false, w: s.why });

// 감시 상태기계(시간·점검 함수를 주입할 수 있게 분리: 시험에서 가짜로 돌린다)
export function makeWatcher({ check, confirm = 2 }) {
  let reported = null;            // 마지막으로 알린(확정된) 상태
  let candidate = null, streak = 0;
  return {
    // 한 번 점검하고, 확정된 변화가 있으면 줄 배열을, 없으면 빈 배열을 돌려준다. 첫 점검은 기준선(baseline)을 한 번 알린다.
    step() {
      const cur = snapshot(check());
      if (reported === null) { reported = cur; candidate = cur; streak = confirm; return { baseline: true, lines: baselineLines(cur) }; }
      if (keyOf(cur) === keyOf(reported)) { candidate = cur; streak = 0; return { baseline: false, lines: [] }; }
      if (candidate && keyOf(cur) === keyOf(candidate)) streak++; else { candidate = cur; streak = 1; }
      if (streak < confirm) return { baseline: false, lines: [] };
      const lines = diffSnapshots(reported, cur); reported = cur; streak = 0;
      return { baseline: false, lines };
    },
  };
}
function baselineLines(s) {
  if (!s.available) return [`역할 감시 시작 — 점검 불가: ${s.why}`];
  const bad = Object.values(s.roles).filter((r) => r.status !== 'ok').sort((a, b) => a.slot - b.slot).map((r) => `${r.slot}번 ${r.name}[${ST[r.status]}${r.address ? ' ' + r.address : ''}]`);
  return [`역할 감시 시작 — ${s.headline}`, ...(bad.length ? ['  정상 아님: ' + bad.join(' · ')] : [])];
}

async function main() {
  const once = process.argv.includes('--once');
  const num = (v, d, min) => { const n = Number(v); return Number.isFinite(n) && v !== undefined && v !== '' ? Math.max(min, n) : d; };
  const every = num(process.env.ROLE_WATCH_MS, 15000, 200), confirm = Math.floor(num(process.env.ROLE_WATCH_CONFIRM, 2, 1)), flushMs = num(process.env.ROLE_WATCH_FLUSH_MS, 20000, 100);
  const ctx = makeCtx();
  const w = makeWatcher({ check: () => roleCheck(ctx), confirm });
  const first = w.step();
  for (const l of first.lines) console.log(`[${hhmmss()}] ${l}`);
  if (once) return;
  let buf = []; let flushAt = 0;
  const flush = () => { if (buf.length) { for (const l of buf) console.log(`[${hhmmss()}] ${l}`); buf = []; } flushAt = 0; };
  // 고아 방지: Monitor 가 끝날 때 이 프로세스만 남으면 30분마다 감시가 쌓여 알림이 겹친다. 부모(Monitor 의 셸)가 사라지면 스스로 끝낸다.
  const ppid = process.ppid;
  const parentAlive = () => { if (!(ppid > 1)) return true; try { process.kill(ppid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  process.stdout.on('error', () => process.exit(0));   // 출력 파이프가 닫히면 끝낸다
  const tick = () => {
    if (!parentAlive()) { stop(); return; }
    let r; try { r = w.step(); } catch (e) { r = { lines: [`감시 오류: ${String(e.message).slice(0, 120)}`] }; }
    if (r.lines.length) { buf.push(...r.lines); if (!flushAt) flushAt = Date.now() + flushMs; }
    if (flushAt && Date.now() >= flushAt) flush();
  };
  const timer = setInterval(tick, every);
  const fl = setInterval(() => { if (flushAt && Date.now() >= flushAt) flush(); }, Math.min(1000, flushMs));
  const stop = () => { clearInterval(timer); clearInterval(fl); flush(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
