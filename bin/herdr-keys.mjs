#!/usr/bin/env node
// herdr-keys: 허더의 keys.json 에서 "관리 창(모드)을 여는 한 줄"만 안전하게 보고·바꾸는 CLI. 모드의 "단축키" 탭이 exec 로 부른다.
// 왜 모드 안에서 직접 쓰지 않고 이 CLI 를 쓰나: 모드의 파일 API(writeTextFile)로 바꿨을 때 화면은 "바꿨습니다"라고 했는데 실제 keys.json 은 그대로였다
//   (2026-11-15 실측: 파일도 백업도 디스크에 없었음). 그래서 실제 디스크에 쓰는 일은 node 가 하고, 모드는 결과만 보여 준다(세션키퍼도 같은 방식).
// 사용:  node herdr-keys.mjs status          지금 keys.json 에서 이 모드를 여는 줄과 파일 상태(해시)
//        node herdr-keys.mjs set <키>        이 모드를 여는 키를 바꾼다(예: alt-shift-y). 이미 쓰는 키·위험한 키는 거절
//        node herdr-keys.mjs off             키 연결만 해제(팔레트로는 계속 열 수 있음)
//        node herdr-keys.mjs default         기본값(ctrl-shift-m)으로
//        node herdr-keys.mjs probe-read <이름>   진단용: 허더 설정 폴더 또는 임시 폴더의 orch-probe-*.tmp 가 실제 디스크에 있는지
//        node herdr-keys.mjs probe-clean <이름>  진단용: 위 파일을 지움(우리가 만든 orch-probe-*.tmp 만)
// 결과는 표준출력의 JSON 한 줄. 종료코드 0 처리됨 / 1 거절 / 2 사용법 오류. 허더 설정 폴더는 HERDR_APP_HOME(없으면 ~\.config\herdr-app).
// 바꾸는 순서는 모드와 같다(herdr-mod/orch-manager/model.js 의 applyKeysChange, 시험됨): 읽기 → 계산·검증 → 백업 → 읽은 그대로일 때만 쓰기 → 다시 읽어 확인 → 어긋나면 되돌림.
import { readFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { diskIO, decode } from './herdr-keys-io.mjs';
import { normalizeKey, applyKeysChange, findKeyConflict, ownKeys, OWN_ACTION, DEFAULT_KEY, keyLabel } from '../herdr-mod/orch-manager/model.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HERDR_APP_HOME || join(homedir(), '.config', 'herdr-app');
const KEYS = join(HOME, 'keys.json');
const out = (o, code = 0) => { process.stdout.write(JSON.stringify(o) + '\n'); process.exit(code); };
const sha = (b) => createHash('sha256').update(b).digest('hex');

// keys.json 안의 모든 구역(global, terminal, layout:*, mod:* ...)의 항목을 허더 keys() 와 같은 모양으로 펼친다
function bindingsOf(text) {
  const j = JSON.parse(text); const list = [];
  for (const [section, obj] of Object.entries(j)) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue;
    for (const [k, v] of Object.entries(obj)) list.push({ section, keys: k, action: typeof v === 'string' ? v : (v && v.command) || 'object' });
  }
  return list;
}

function readKeys() { return existsSync(KEYS) ? decode(readFileSync(KEYS)) : null; }

async function change(newKey) {
  const raw = readKeys();
  if (raw === null) return out({ ok: false, stage: 'read', path: KEYS, msg: `keys.json 을 찾지 못했습니다: ${KEYS}` }, 1);
  if (newKey !== null) {                                                                              // 모든 구역에서 이미 쓰는 키는 거절(terminal 구역이 global 보다 우선하기 때문)
    let b; try { b = bindingsOf(raw); } catch { return out({ ok: false, stage: 'plan', path: KEYS, msg: 'keys.json 이 올바른 JSON 이 아니라서 건드리지 않습니다' }, 1); }
    const c = findKeyConflict(b, newKey);
    if (c) return out({ ok: false, stage: 'conflict', path: KEYS, msg: `이미 쓰는 키입니다: ${c.section} 구역의 ${c.action}. 다른 키를 고르세요` }, 1);
  }
  const stamp = process.env.ORCH_BACKUP_STAMP || new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);   // 밀리초까지(같은 초에 두 번 바꿔도 이름이 겹치지 않게). 시험에서만 환경변수로 고정
  const r = await applyKeysChange({ read: diskIO.read, write: diskIO.write, path: KEYS.replace(/\\/g, '/'), newKey, stamp });
  const now = readKeys();
  const own = now === null ? [] : (() => { try { return ownKeys(bindingsOf(now)); } catch { return []; } })();
  out({ ...r, path: KEYS, bytes: now === null ? 0 : Buffer.byteLength(now), sha256: now === null ? '' : sha(Buffer.from(now)), own }, r.ok ? 0 : 1);
}

function probePath(name, where) {
  if (!/^orch-probe-[a-z0-9]{4,24}\.tmp$/.test(name || '')) return null;                              // 진단용으로 우리가 만든 이름만
  return join(where === 'temp' ? tmpdir() : HOME, name);
}

const [cmd, arg, arg2] = process.argv.slice(2);
try {
  if (cmd === 'status') {
    const raw = readKeys();
    if (raw === null) out({ ok: false, path: KEYS, exists: false, msg: 'keys.json 이 없습니다' }, 1);
    let own = []; let sections = []; let valid = true;
    try { const b = bindingsOf(raw); own = ownKeys(b); sections = [...new Set(b.map((x) => x.section))]; } catch { valid = false; }
    const st = statSync(KEYS);
    out({ ok: true, path: KEYS, exists: true, valid, bytes: Buffer.byteLength(raw), sha256: sha(Buffer.from(raw)), mtimeMs: Math.round(st.mtimeMs), own, sections, action: OWN_ACTION });
  } else if (cmd === 'set') {
    const n = normalizeKey(arg);
    if (!n.ok) out({ ok: false, stage: 'key', msg: n.error }, 1);
    await change(n.key);
  } else if (cmd === 'off') { await change(null); }
  else if (cmd === 'default') { await change(DEFAULT_KEY); }
  else if (cmd === 'probe-read') {
    const p = probePath(arg, arg2 === 'temp' ? 'temp' : 'home');
    if (!p) out({ ok: false, msg: '진단 파일 이름이 올바르지 않습니다' }, 1);
    out(existsSync(p) ? { ok: true, exists: true, path: p, bytes: statSync(p).size, text: decode(readFileSync(p)).slice(0, 200) } : { ok: true, exists: false, path: p });
  } else if (cmd === 'probe-clean') {
    const done = [];
    for (const where of ['home', 'temp']) { const p = probePath(arg, where); if (p && existsSync(p)) { unlinkSync(p); done.push(p); } }
    out({ ok: true, removed: done });
  } else out({ ok: false, msg: '사용: node herdr-keys.mjs status | set <키> | off | default | probe-read <이름> | probe-clean <이름>' }, 2);
} catch (e) {
  out({ ok: false, stage: 'error', msg: `처리 중 오류: ${String(e && e.message || e).slice(0, 200)}` }, 1);
}
