// manage-live: 지금 떠 있는 Herdr 창의 상태를 "읽기만" 한다(관리 창의 '실제 창' 탭용).
// 이 파일이 hc 를 부르는 유일한 곳이고, 부르는 것은 정확히 `hc ls --json` 하나뿐이다(조회). send·keys·read·do·label 등은 부르지 않는다.
// 어느 창에도 아무것도 보내지 않으며, 결과를 파일·로그에 저장하지 않는다. hc 가 없거나 실패하면 오류가 아니라 "조회 불가"로 돌려준다.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { readUtf8Strict } from './orch-lib.mjs';
import { parseConfig } from './sync-lib.mjs';

const MAX_WINDOWS = 500;
const clip = (v, n = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, n);

export function liveWindows(ctx, { scopePrefix } = {}) {
  let scope = scopePrefix;
  if (scope === undefined) {                                           // 설정의 범위(scope_prefix)를 읽는다. 없으면 범위 표시 없음
    try {
      const p = join(ctx.paths.config, 'orchestration.json');
      if (existsSync(p)) { const c = parseConfig(readUtf8Strict(p)).config; if (c && c.scope_prefix && c.scope_prefix !== '(미설정)') scope = c.scope_prefix; }
    } catch { scope = null; }
  }
  const hc = ctx.env.HC_BIN || 'hc';
  const r = spawnSync(hc, ['ls', '--json'], { encoding: 'utf8', timeout: 15000, windowsHide: true, env: ctx.env, maxBuffer: 16 * 1024 * 1024 });
  const none = (note) => ({ ok: true, available: false, note, windows: [], counts: {}, scope: scope ?? null });
  if (r.error) return none(`hc 를 실행할 수 없습니다(${r.error.code ?? r.error.message}). Herdr 가 설치되어 있고 hc 가 PATH 에 있는지 확인하세요`);
  if (r.status !== 0) return none(`hc ls 가 실패했습니다(종료코드 ${r.status}). Herdr 서버가 켜져 있는지 확인하세요`);
  let j;
  try { j = JSON.parse(String(r.stdout ?? '').replace(/^﻿/, '')); } catch { return none('hc ls 의 응답을 읽을 수 없습니다(JSON 아님)'); }
  const arr = j && Array.isArray(j.terminals) ? j.terminals : null;
  if (!arr) return none('hc ls 의 응답 형식이 예상과 다릅니다(terminals 목록 없음)');
  const sc = scope ? String(scope).trim() : '';
  const windows = arr.slice(0, MAX_WINDOWS).filter((t) => t && typeof t === 'object').map((t) => {
    const where = clip(t.where);
    return { address: clip(t.address, 40), agent: clip(t.agent, 40), status: clip(t.status, 20), state: clip(t.state, 20), turn: Number.isInteger(t.turn) ? t.turn : null, where, inScope: sc ? where.startsWith(sc) : null };
  });
  const counts = {};
  for (const w of windows) counts[w.status || '?'] = (counts[w.status || '?'] ?? 0) + 1;
  return { ok: true, available: true, windows, counts, total: arr.length, shown: windows.length, truncated: arr.length > MAX_WINDOWS, scope: sc || null, hiddenFinished: Number.isInteger(j.hidden_finished) ? j.hidden_finished : null };
}
