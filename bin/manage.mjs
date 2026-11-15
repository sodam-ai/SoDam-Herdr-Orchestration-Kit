#!/usr/bin/env node
// manage: 관리 도구 CLI. 창(orch-manager.ps1)이 이것을 부른다. 사람이 직접 써도 된다.
// 사용: node bin/manage.mjs <명령> [--stdin]      요청 값은 표준입력의 JSON, 결과는 표준출력의 JSON 한 개.
//   명령: status | role-list | role-set | role-new | role-revert | role-delete | export | import-plan | import-apply |
//         backup | backup-list | restore-plan | restore-apply | sync-run | live-windows(hc ls 읽기 전용 조회)
// 종료코드: 0 요청 처리됨(결과의 ok 가 true) / 1 요청을 거절함(ok:false, errors 에 이유) / 2 사용법 오류
// 어느 창에도 아무것도 보내지 않고 hc 를 부르지 않는다. 경로는 ORCH_HOME(없으면 %LOCALAPPDATA%\Herdr-Orchestration).
import { readFileSync, fstatSync } from 'node:fs';
import { liveWindows } from './manage-live.mjs';
import { makeCtx, status, roleList, roleSet, roleNew, roleRevert, roleDelete, exportPackage, planImport, applyImport, planRestore, applyRestore, backupNow, listBackups, runSync } from './manage-lib.mjs';

const cmd = process.argv[2];
function readStdin() {
  try { if (fstatSync(0).isCharacterDevice()) return {}; const t = readFileSync(0, 'utf8').replace(/^﻿/, '').trim(); return t ? JSON.parse(t) : {}; }
  catch (e) { return { __error: e.message }; }
}
const pub = (p) => { if (!p || !p.candidate) return p; const { candidate, ...rest } = p; return rest; };
const COMMANDS = {
  'status': (c, a) => status(c, { generated: a.generated }),
  'role-list': (c) => roleList(c),
  'role-set': (c, a) => roleSet(c, a.id, a.fields ?? {}, { body: a.body }),
  'role-new': (c, a) => roleNew(c, { id: a.id, from: a.from, fields: a.fields ?? {}, body: a.body }),
  'role-revert': (c, a) => roleRevert(c, a.id),
  'role-delete': (c, a) => roleDelete(c, a.id),
  'export': (c, a) => exportPackage(c, { dest: a.dest, scope: a.scope, note: a.note }),
  'import-plan': (c, a) => pub(planImport(c, a.pkg, { mode: a.mode, trust: false, includeEnvRules: !!a.includeEnvRules, includeIgnore: !!a.includeIgnore, enableImported: !!a.enableImported })),
  'import-apply': (c, a) => applyImport(c, a.pkg, { mode: a.mode, trust: false, includeEnvRules: !!a.includeEnvRules, includeIgnore: !!a.includeIgnore, enableImported: !!a.enableImported }, { token: a.token }),
  'backup': (c, a) => backupNow(c, { note: a.note }),
  'backup-list': (c) => listBackups(c),
  'restore-plan': (c, a) => pub(planRestore(c, a.pkg)),
  'restore-apply': (c, a) => applyRestore(c, a.pkg, { token: a.token }),
  'sync-run': (c, a) => runSync(c, { out: a.out }),
  'live-windows': (c, a) => liveWindows(c, { scopePrefix: a.scopePrefix }),
};
if (!cmd || !COMMANDS[cmd]) { console.error(`사용: node bin/manage.mjs <${Object.keys(COMMANDS).join('|')}>  (요청 값은 표준입력 JSON)`); process.exit(2); }
const args = readStdin();
if (args.__error) { console.log(JSON.stringify({ ok: false, errors: [`요청 JSON 을 읽을 수 없음: ${args.__error}`] })); process.exit(1); }
let result;
try { result = COMMANDS[cmd](makeCtx(), args); }
catch (e) { result = { ok: false, errors: [`처리 중 오류: ${e.message}`] }; }
process.stdout.write(JSON.stringify(result) + '\n');
process.exit(result && result.ok === false ? 1 : 0);
