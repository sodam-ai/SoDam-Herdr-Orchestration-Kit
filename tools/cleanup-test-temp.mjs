#!/usr/bin/env node
// 시험이 %TEMP% 에 남긴 폴더를 정리하는 도구. **사용자가 직접 실행한다**(AI 는 폴더를 지우지 않는 규칙).
// 기본은 미리보기: 아무것도 지우지 않고 무엇이 지워질지만 보여 준다. 지우려면 --apply.
//   node tools/cleanup-test-temp.mjs                      미리보기
//   node tools/cleanup-test-temp.mjs --apply --limit 1    가장 오래된 1개만 지워 보기(처음 쓸 때 권장)
//   node tools/cleanup-test-temp.mjs --apply              대상 전부 지우기
// 옵션: --dir <폴더>(기본 %TEMP%)  --limit <개수>  --min-age-min <분>(기본 60: 이보다 새 폴더는 건너뜀)
// 자동으로 지우는 것은 이 두 이름뿐이다: orch-test-<영숫자 6자>, orch-e-<16진수 8자>.
//   그 밖의 orch-* 폴더(orch-e-man-*, orch-clone-* 등)는 출처를 모르므로 "확인 필요" 목록으로만 보여 주고 지우지 않는다.
// 안전 장치: 링크(심볼릭·정션)는 따라가지 않고 건너뜀 / 삭제 직전에 폴더·이름·위치를 다시 확인 / 드라이브 루트·홈 폴더는 --dir 로 거부.
// 종료코드: 0 정상 / 1 삭제 중 실패 있음 / 2 사용법·위험한 --dir
import { readdirSync, lstatSync, statSync, unlinkSync, rmdirSync, chmodSync } from 'node:fs';
import { join, resolve, dirname, parse } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

export const AUTO_PATTERNS = [/^orch-test-[A-Za-z0-9]{6}$/, /^orch-e-[0-9a-f]{8}$/];
const isAuto = (name) => AUTO_PATTERNS.some((re) => re.test(name));

// entries: [{ name, isDir, isLink, mtimeMs }] → { targets, review, skipped }
export function classify(entries, now, { minAgeMin = 60, limit } = {}) {
  const targets = [], review = [], skipped = [];
  for (const e of entries) {
    if (!e.name.startsWith('orch-')) continue;
    if (isAuto(e.name)) {
      if (!e.isDir && !e.isLink) skipped.push({ name: e.name, reason: 'not-dir' });
      else if (e.isLink) skipped.push({ name: e.name, reason: 'link' });
      else if (now - e.mtimeMs < minAgeMin * 60 * 1000) skipped.push({ name: e.name, reason: 'too-new' });
      else targets.push(e);
    } else if (e.isDir && !e.isLink) review.push(e);
  }
  targets.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return { targets: limit === undefined ? targets : targets.slice(0, limit), review, skipped };
}

// 링크를 따라가지 않고 크기를 센다(상한 없이 파일 수만큼 lstat)
function sizeOf(p) {
  let st; try { st = lstatSync(p); } catch { return 0; }
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return st.size;
  let n = 0; try { for (const c of readdirSync(p)) n += sizeOf(join(p, c)); } catch { /* 읽을 수 없으면 0 */ }
  return n;
}
const kb = (b) => `${Math.max(1, Math.round(b / 1024)).toLocaleString('ko-KR')} KB`;
const ago = (ms, now) => { const m = Math.round((now - ms) / 60000); return m < 120 ? `${m}분 전` : m < 2880 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };

// 링크는 링크만 지우고 안으로 들어가지 않는다. 파일은 읽기 전용이면 풀고 다시 시도한다.
function removeTree(p) {
  const st = lstatSync(p);
  if (st.isSymbolicLink()) { try { unlinkSync(p); } catch { rmdirSync(p); } return; }
  if (st.isDirectory()) { for (const c of readdirSync(p)) removeTree(join(p, c)); rmdirSync(p); return; }
  try { unlinkSync(p); } catch (e) { if (e.code === 'EPERM' || e.code === 'EACCES') { chmodSync(p, 0o666); unlinkSync(p); } else throw e; }
}

function die(msg) { console.error(msg); process.exit(2); }
function main() {
  const a = process.argv.slice(2);
  const o = { dir: tmpdir(), apply: false, limit: undefined, minAgeMin: 60 };
  const num = (s, flag) => { if (!/^\d+$/.test(s ?? '')) die(`오류: ${flag} 은(는) 0 이상의 정수여야 함 (받은 값: ${s})`); return Number(s); };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--apply') o.apply = true;
    else if (a[i] === '--dir') { if (a[i + 1] === undefined) die('오류: --dir 에 값이 없음'); o.dir = a[++i]; }
    else if (a[i] === '--limit') o.limit = num(a[++i], '--limit');
    else if (a[i] === '--min-age-min') o.minAgeMin = num(a[++i], '--min-age-min');
    else die(`오류: 알 수 없는 옵션 '${a[i]}'\n사용: node tools/cleanup-test-temp.mjs [--apply] [--limit N] [--min-age-min N] [--dir 폴더]`);
  }
  const dir = resolve(o.dir);
  let st; try { st = statSync(dir); } catch { die(`오류: 폴더가 없음: ${dir}`); }
  if (!st.isDirectory()) die(`오류: 폴더가 아님: ${dir}`);
  if (parse(dir).root === dir) die(`오류: 드라이브 루트는 거부함: ${dir}`);
  if (dir.toLowerCase() === resolve(homedir()).toLowerCase()) die(`오류: 홈 폴더는 거부함: ${dir}`);

  const now = Date.now();
  const entries = readdirSync(dir, { withFileTypes: true }).map((d) => {
    const full = join(dir, d.name);
    let l; try { l = lstatSync(full); } catch { return null; }
    return { name: d.name, isDir: l.isDirectory(), isLink: l.isSymbolicLink(), mtimeMs: l.mtimeMs };
  }).filter(Boolean);
  const { targets, review, skipped } = classify(entries, now, { minAgeMin: o.minAgeMin, limit: o.limit });

  console.log(`${o.apply ? '[삭제 실행]' : '[미리보기: 아무것도 지우지 않음]'} 폴더: ${dir}`);
  let total = 0;
  const sizes = targets.map((t) => { const s = sizeOf(join(dir, t.name)); total += s; return s; });
  console.log(`삭제 대상 ${targets.length}개 (약 ${kb(total)}):`);
  targets.forEach((t, i) => console.log(`  ${t.name}  ${ago(t.mtimeMs, now)}  ${kb(sizes[i])}`));
  if (review.length) { console.log(`확인 필요 ${review.length}개 (출처를 몰라 자동 삭제 안 함, 필요하면 직접 지우세요):`); review.forEach((t) => console.log(`  ${t.name}  ${ago(t.mtimeMs, now)}`)); }
  if (skipped.length) { console.log(`건너뜀 ${skipped.length}개:`); skipped.forEach((s) => console.log(`  ${s.name}  (${s.reason})`)); }

  if (!o.apply) { console.log(targets.length ? '\n지우려면 같은 명령에 --apply 를 붙이세요. 처음에는 --apply --limit 1 로 하나만 지워 보기를 권합니다.' : '\n지울 것이 없습니다.'); return; }
  let done = 0, failed = 0;
  for (const t of targets) {
    const full = join(dir, t.name);
    try {
      const l = lstatSync(full);   // 삭제 직전 재확인: 폴더이고 링크가 아니고 이름이 맞고 --dir 의 직접 자식이어야 한다
      if (!l.isDirectory() || l.isSymbolicLink() || !isAuto(t.name) || dirname(resolve(full)) !== dir) { console.log(`  건너뜀(재확인 불일치): ${t.name}`); continue; }
      removeTree(full); done++;
    } catch (e) { failed++; console.log(`  실패: ${t.name} - ${e.code ?? e.message}`); }
  }
  console.log(`\n삭제 완료 ${done}개 / 실패 ${failed}개`);
  if (failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
