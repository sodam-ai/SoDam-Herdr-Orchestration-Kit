// mod-check.test.mjs - 허더 모드(herdr-mod/orch-manager)를 허더 공식 검사(herdr-app check)로 돌린다.
// 검사는 "처음 그려지는 화면"만 보므로, 초기 상태를 바꾼 복사본(탭마다·미리보기·빈 상태 등)을 임시 폴더에 만들어 모두 돌린다.
// 음성 대조: 일부러 망가뜨린 복사본(없는 함수·문법 오류·없는 변수)은 검사가 실패해야 정상이다(검사가 정말 화면 코드를 실행하는지 확인).
// 허더 설정 폴더(HERDR_APP_HOME)도 임시 폴더라 실제 허더 설정과 저장소는 건드리지 않는다. herdr-app 이 없는 PC에서는 건너뛴다.
// 실행: node tests/mod-check.test.mjs      (HERDR_APP_EXE 로 허더 앱 위치를 바꿀 수 있음)
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'herdr-mod', 'orch-manager');
const BASE = join(tmpdir(), 'orch-test-modcheck-' + Date.now());
const APP = process.env.HERDR_APP_EXE || join(process.env.LOCALAPPDATA || '', 'Programs', 'herdr-app', 'herdr-app.exe');
if (!existsSync(APP)) { console.log('SKIP  herdr-app 을 찾지 못해 모드 검사를 건너뜁니다: ' + APP); console.log('PASS 0 / FAIL 0 / SKIP 1'); process.exit(0); }
mkdirSync(join(BASE, 'home'), { recursive: true });
const main = readFileSync(join(SRC, 'main.js'), 'utf8');

const FAKE_PLAN = `{ kind: "KIND", pick: "pl-0", args: { pkg: "x" }, data: { ok: true, token: "t", mode: "merge", counts: { add: 1, change: 1, remove: 1, same: 1 }, noop: false, notes: [{ message: "알림" }], skipped: [{ path: "a", reason: "b" }], warnings: ["경고"],
  changes: [{ action: "add", path: "config/roles/x.md", role: { id: "x", name: "엑스", enabled: false }, beforeText: "", afterText: "---\\nid: x\\n---\\n본문" }, { action: "change", path: "config/env-rules.md", beforeText: "a\\nb", afterText: "a\\nc" }, { action: "remove", path: "p" }, { action: "same", path: "q" }] } }`;
const FAKE_ST = `{ ok: true, version: "1", paths: { home: "C:/h" }, config: { exists: true, valid: true, values: { commander_name: "c", scope_prefix: "s", projects_root: "p", control_dir: "d" }, unset: [] }, roles: [ { id: "commander", name: "총지휘", slot: 0, kind: "commander", enabled: true, source: "bundle", errors: [], overridden: [] }, { id: "a-b", name: "에이", slot: 1, kind: "worker", enabled: false, source: "user", errors: [], overridden: [] }, { id: "ov", name: "오브", slot: 2, kind: "worker", enabled: true, source: "override", errors: ["x"], overridden: ["name"] } ], generated: { state: "stale", note: "다름" }, backups: { count: 2, latest: { createdAt: "2026-01-01T00:00:00Z" } }, envRules: { exists: true, count: 1, errors: [] }, problems: [{ id: "ov", errors: ["x"] }] }`;
const FAKE_RL = `{ ok: true, roles: [ { id: "a-b", source: "user", errors: [], meta: { id: "a-b", name: "에이", summary: "요약", slot: 1, kind: "worker", mode: "scoped-write", writes_to: ["x/y"], reports_to: "user", cadence: "periodic", enabled: false }, body: "# 본문\\n줄", overridden: [] }, { id: "ov", source: "override", errors: [], meta: { id: "ov", name: "오브", summary: "요약", slot: 2, kind: "worker", mode: "read-only", writes_to: [], reports_to: "commander", cadence: "on-request", enabled: true }, body: "b", overridden: ["name", "body"] } ] }`;
const FAKE_BK = `{ ok: true, dir: "C:/b", backups: [ { dir: "C:/b/1", createdAt: "2026-01-01T00:00:00Z", kind: "auto", note: "메모", files: 3 }, { dir: "C:/b/2", createdAt: "2026-01-02T00:00:00Z", kind: "manual", note: "", files: 5 } ] }`;
const FAKE_LV = `{ ok: true, available: true, windows: [ { address: "t1", agent: "claude-code", status: "blocked", where: "WS / a", inScope: true }, { address: "t2", agent: "codex", status: "idle", where: "x", inScope: false } ], counts: { blocked: 1, idle: 1 }, total: 2, shown: 2, truncated: false }`;

// 초기 상태를 주입하는 변형: init 끝(reloadAll 호출 직전)에 대입문을 끼워 넣는다. reloadAll 은 비동기 호출이라 검사 시점에 결과가 오지 않는다.
const inject = (extra) => main.replace('    this.reloadAll(cx);\n', `    ${extra}\n    this.reloadAll(cx);\n`);
const variants = {
  status: main,
  'status-data': inject(`this.st = ${FAKE_ST};`),
  roles: inject(`this.tab = "roles"; this.st = ${FAKE_ST}; this.rl = ${FAKE_RL}; this.selectRole("a-b");`),
  'roles-override': inject(`this.tab = "roles"; this.st = ${FAKE_ST}; this.rl = ${FAKE_RL}; this.selectRole("ov"); this.confirm = "revert";`),
  'roles-new': inject(`this.tab = "roles"; this.st = ${FAKE_ST}; this.rl = ${FAKE_RL}; this.showNew = true; this.newFromSel = true; this.sel = "a-b";`),
  'roles-empty': inject(`this.tab = "roles";`),
  share: inject(`this.tab = "share"; this.pkgDir = "C:/pk"; this.impMode = "replace"; this.incEnv = true;`),
  'share-plan': inject(`this.tab = "share"; this.pkgDir = "C:/pk"; this.plan = ${FAKE_PLAN.replace('KIND', 'import')}; this.confirm = "apply";`),
  backup: inject(`this.tab = "backup"; this.bk = ${FAKE_BK}; this.bkSel = "C:/b/1";`),
  'backup-plan': inject(`this.tab = "backup"; this.bk = ${FAKE_BK}; this.plan = ${FAKE_PLAN.replace('KIND', 'restore')};`),
  'backup-empty': inject(`this.tab = "backup"; this.bk = { ok: true, backups: [] };`),
  live: inject(`this.tab = "live"; this.lv = ${FAKE_LV};`),
  'live-unavailable': inject(`this.tab = "live"; this.lv = { ok: true, available: false, note: "hc 없음" };`),
  'live-null': inject(`this.tab = "live";`),
  'status-attention': inject(`this.st = { ok: true, version: "1", paths: { home: "C:/h" }, config: { exists: true, valid: true, values: {}, unset: ["control_dir"] }, roles: [ { id: "x", name: "엑스", slot: 1, kind: "worker", enabled: true, source: "bundle", errors: ["형식 오류"], overridden: [] } ], generated: { state: "stale", note: "다름" }, backups: { count: 0 }, envRules: { exists: false, count: 0, errors: [] }, problems: [{ id: "x", errors: ["형식 오류"] }] };`),
  'status-failed': inject(`this.st = { ok: false, errors: ["설정 파일이 없음"] };`),
  'roles-dirty': inject(`this.tab = "roles"; this.st = ${FAKE_ST}; this.rl = ${FAKE_RL}; this.selectRole("a-b"); this.inName.set_value("바뀐 이름");`),
  'roles-bad-draft': inject(`this.tab = "roles"; this.st = ${FAKE_ST}; this.rl = ${FAKE_RL}; this.selectRole("a-b"); this.inSum.set_value("");`),
  'roles-busy': inject(`this.tab = "roles"; this.st = ${FAKE_ST}; this.rl = ${FAKE_RL}; this.selectRole("a-b"); this.acting = true; this.inName.set_value("바뀐 이름");`),
  'notice-ok': inject(`this.status = "✔ 저장했습니다  (바꾸기 전 상태는 자동 백업됨)";`),
  'notice-bad': inject(`this.status = "✘ 적용하지 않았습니다. 내 설정은 그대로입니다. 오류";`),
  'notice-info': inject(`this.status = "저장하는 중…"; this.acting = true;`),
  'live-filter-in': inject(`this.tab = "live"; this.liveFilter = "in"; this.lv = ${FAKE_LV};`),
  'live-empty-in': inject(`this.tab = "live"; this.liveFilter = "in"; this.lv = { ok: true, available: true, windows: [{ address: "t2", agent: "codex", status: "?", where: "x", inScope: false }], counts: { "?": 1 }, total: 1, shown: 1, truncated: true };`),
  'backup-selected': inject(`this.tab = "backup"; this.bk = ${FAKE_BK}; this.bkSel = "C:/b/2";`),
  'share-ready': inject(`this.tab = "share"; this.pkgDir = "C:/pk"; this.incEnv = true; this.incIgnore = true; this.enableImp = true; this.impMode = "replace"; this.scope = "full";`),
  'keys-diag-open': inject(`this.tab = "keys"; this.showDiag = true; this.realKeys = { ok: true, own: [], bytes: 1200, sha256: "abcdef0123456789abcd", sections: ["global"] };`),
  keys: inject(`this.tab = "keys";`),
  'keys-free': inject(`this.tab = "keys"; this.kMods = { ctrl: true, alt: false, shift: true }; this.inKey.set_value("y");`),
  'keys-conflict': inject(`this.tab = "keys"; this.kMods = { ctrl: false, alt: true, shift: false }; this.inKey.set_value("j");`),
  'keys-invalid': inject(`this.tab = "keys"; this.kMods = { ctrl: true, alt: true, shift: false }; this.inKey.set_value("m");`),
  'keys-empty': inject(`this.tab = "keys"; this.inKey.set_value("");`),
  'keys-confirm': inject(`this.tab = "keys"; this.confirm = "key"; this.inKey.set_value("y");`),
  'keys-real': inject(`this.tab = "keys"; this.realKeys = { ok: true, own: [{ section: "global", keys: "ctrl-shift-m" }], bytes: 2282, sha256: "abcdef0123456789", sections: ["global", "terminal"] };`),
  'keys-real-none': inject(`this.tab = "keys"; this.realKeys = { ok: true, own: [], bytes: 10, sha256: "00", sections: [] };`),
  'keys-real-error': inject(`this.tab = "keys"; this.realKeys = { ok: false, msg: "단축키 도구를 실행하지 못했습니다" };`),
  'keys-note-probe': inject(`this.tab = "keys"; this.keyNote = "keys.json 은 바뀌었지만 허더가 아직 새 키를 반영하지 않았습니다."; this.probeLines = ["허더 설정 폴더(appHome): C:/x", "설정 폴더: 허더로 쓰기 성공 → 같은 내용 → 실제 디스크에 없음", "임시 폴더: 허더로 쓰기 거절: x → 없음 → 실제 디스크에 없음"];`),
};
// 음성 대조: 일부러 없는 함수를 부르면 검사가 실패해야 한다.
variants['NEGATIVE-bad-method'] = main.replace('      .child(footer);', '      .child(footer).no_such_method_xyz();');
variants['NEGATIVE-syntax'] = main.replace('export default class', 'export default clas');
variants['NEGATIVE-undefined-var'] = main.replace('      .child(footer);', '      .child(footerXYZ);');

let bad = 0, okCount = 0;
for (const [name, src] of Object.entries(variants)) {
  if (name !== 'status' && src === main) { console.log(`FAIL  ${name}: 주입 위치를 찾지 못함(main.js 의 init 끝 reloadAll 호출이 바뀜)`); bad++; continue; }
  const d = join(BASE, name); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'main.js'), src);
  for (const f of readdirSync(SRC)) if (f !== 'main.js' && (f === 'mod.json' || f.endsWith('.js'))) copyFileSync(join(SRC, f), join(d, f));   // main.js 가 불러오는 model.js·ui.js·tabs.js 도 함께
  const r = spawnSync(APP, ['check', d], { encoding: 'utf8', env: { ...process.env, HERDR_APP_HOME: join(BASE, 'home') }, timeout: 120000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 260);
  const neg = name.startsWith('NEGATIVE');
  const passed = /check passed/.test(out) && r.status === 0;
  const good = neg ? !passed : passed;
  if (!good) bad++;
  console.log(`${good ? 'PASS' : 'FAIL'}  ${name}: ${passed ? 'check passed' : 'check FAILED'}${neg ? ' (망가뜨린 복사본이라 실패해야 정상)' : ''}${good ? '' : '  ' + out}`);
  if (good) okCount++;
}
console.log(`\n시험 폴더(지우지 않음): ${BASE}`);
console.log(`PASS ${okCount} / FAIL ${bad} / SKIP 0`);
process.exit(bad ? 1 : 0);
