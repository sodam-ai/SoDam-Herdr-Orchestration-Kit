#!/usr/bin/env node
// 실행: node tests/cleanup.test.mjs   (성공 시 종료코드 0, 외부 패키지 없음)
// tools/cleanup-test-temp.mjs (시험이 남긴 %TEMP% 폴더 정리 도구)의 "무엇을 고르는가"와 안전 장치를 시험한다.
// 이 시험은 아무것도 지우지 않는다. 삭제 경로(--apply)는 AI가 폴더를 지우지 않는 규칙 때문에 시험하지 않는다(맨 아래 (9) 참고).
// 시험 폴더는 %TEMP%\orch-test-<6자> 이름이라 이 도구가 나중에 정리 대상으로 잡는다.
import { mkdirSync, writeFileSync, existsSync, symlinkSync, utimesSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools', 'cleanup-test-temp.mjs');
let pass = 0, fail = 0, skip = 0;
function check(name, fn) {
  try { const r = fn(); if (r && r.skip) { skip++; console.log(`SKIP  ${name} - ${r.skip}`); return; } pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, w) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${w}: 기대 ${JSON.stringify(b)} / 실제 ${JSON.stringify(a)}`); };

const ALNUM = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const rnd = (n) => Array.from({ length: n }, () => ALNUM[Math.floor(Math.random() * ALNUM.length)]).join('');
const BASE = join(tmpdir(), `orch-test-${rnd(6)}`);
mkdirSync(BASE, { recursive: true });
const OLD = Date.now() - 3 * 86400 * 1000;   // 3일 전
const mk = (name, { old = true, file = false } = {}) => {
  const p = join(BASE, name);
  if (file) writeFileSync(p, 'x'); else mkdirSync(p, { recursive: true });
  if (old) utimesSync(p, new Date(OLD), new Date(OLD));
  return p;
};
const lib = await import(pathToFileURL(TOOL).href).catch((e) => ({ __err: e }));
const need = () => { if (lib.__err) throw new Error(`도구를 불러오지 못함: ${lib.__err.message.split('\n')[0]}`); };
const NOW = Date.now();
const ent = (name, o = {}) => ({ name, isDir: true, isLink: false, mtimeMs: OLD, ...o });

check('(1) 자동 선택은 orch-test-<영숫자 6자>와 orch-e-<16진 8자>만', () => {
  need();
  const names = ['orch-test-AbC123', 'orch-e-0123abcd', 'orch-test-AbC12', 'orch-test-AbC1234', 'orch-e-0123abc', 'orch-e-0123abcdef', 'orch-e-0123abcg', 'orch-test-', 'xorch-test-AbC123', 'orch-test-AbC123-x'];
  const r = lib.classify(names.map((n) => ent(n)), NOW, {});
  eq(r.targets.map((t) => t.name).sort(), ['orch-e-0123abcd', 'orch-test-AbC123'], '선택된 것');
});
check('(2) 출처 불명 orch-* 폴더는 삭제 대상이 아니라 "확인 필요" 목록으로만', () => {
  need();
  const r = lib.classify(['orch-e-man-1863895669', 'orch-e-oNq2', 'orch-clone-final-001815', 'orch-readme-check', 'orch-i11'].map((n) => ent(n)), NOW, {});
  eq(r.targets, [], '삭제 대상');
  eq(r.review.map((t) => t.name).sort(), ['orch-clone-final-001815', 'orch-e-man-1863895669', 'orch-e-oNq2', 'orch-i11', 'orch-readme-check'], '확인 필요 목록');
});
check('(3) orch- 로 시작하지 않는 항목은 목록에도 나오지 않는다', () => {
  need();
  const r = lib.classify([ent('claude'), ent('npm-cache'), ent('Orch-test-AbC123'), ent('tmpABC123')], NOW, {});
  eq([r.targets, r.review, r.skipped], [[], [], []], '결과');
});
check('(4) 파일·링크·너무 새 폴더는 이름이 맞아도 건너뛴다(이유 표시)', () => {
  need();
  const r = lib.classify([
    ent('orch-test-FILE01', { isDir: false }),
    ent('orch-test-LINK01', { isLink: true }),
    ent('orch-test-NEW001', { mtimeMs: NOW - 5 * 60 * 1000 }),
    ent('orch-test-OLD001'),
  ], NOW, { minAgeMin: 60 });
  eq(r.targets.map((t) => t.name), ['orch-test-OLD001'], '선택');
  eq(Object.fromEntries(r.skipped.map((s) => [s.name, s.reason])), { 'orch-test-FILE01': 'not-dir', 'orch-test-LINK01': 'link', 'orch-test-NEW001': 'too-new' }, '건너뜀 이유');
});
check('(5) 오래된 것부터 정렬되고 --limit 이 앞에서부터 자른다', () => {
  need();
  const r = lib.classify([ent('orch-test-bbbbbb', { mtimeMs: 2000 }), ent('orch-test-aaaaaa', { mtimeMs: 1000 }), ent('orch-test-cccccc', { mtimeMs: 3000 })], NOW, { limit: 2 });
  eq(r.targets.map((t) => t.name), ['orch-test-aaaaaa', 'orch-test-bbbbbb'], '정렬+limit');
});
check('(6) 실행(미리보기): 아무것도 지우지 않고 대상·확인필요·건너뜀을 보여 준다', () => {
  const sb = join(BASE, 'sb6'); mkdirSync(sb, { recursive: true });
  const mk2 = (n, o) => { const p = join(sb, n); if (o?.file) writeFileSync(p, 'x'); else mkdirSync(p); utimesSync(p, new Date(OLD), new Date(OLD)); return p; };
  const a = mk2('orch-test-Zz9Zz9'); mk2('orch-e-12345678'); const u = mk2('orch-e-man-111'); const f = mk2('orch-test-FILE99', { file: true }); mk2('keep-me');
  const r = spawnSync(process.execPath, [TOOL, '--dir', sb], { encoding: 'utf8' });
  eq(r.status, 0, `종료코드\n${r.stdout}${r.stderr}`);
  ok(/미리보기/.test(r.stdout) && !/삭제 완료/.test(r.stdout), `미리보기 표시가 없음\n${r.stdout}`);
  ok(r.stdout.includes('orch-test-Zz9Zz9') && r.stdout.includes('orch-e-12345678'), '대상 목록에 없음');
  ok(r.stdout.includes('orch-e-man-111'), '확인 필요 목록에 없음');
  ok(existsSync(a) && existsSync(u) && existsSync(f) && existsSync(join(sb, 'keep-me')), '미리보기인데 무언가 사라짐');
});
check('(7) 위험한 --dir(없음·폴더 아님·드라이브 루트·홈)은 종료코드 2로 거부, --apply 여도 똑같다', () => {
  const run = (...a) => spawnSync(process.execPath, [TOOL, ...a], { encoding: 'utf8' });
  const f = join(BASE, 'afile.txt'); writeFileSync(f, 'x');
  for (const args of [['--dir', join(BASE, 'nope')], ['--dir', f], ['--dir', 'C:\\'], ['--dir', homedir()], ['--dir', homedir(), '--apply'], ['--dir']]) {
    const r = run(...args);
    eq(r.status, 2, `${args.join(' ')} 종료코드\n${r.stdout}${r.stderr}`);
  }
});
check('(8) 알 수 없는 옵션·잘못된 숫자는 종료코드 2', () => {
  const run = (...a) => spawnSync(process.execPath, [TOOL, '--dir', BASE, ...a], { encoding: 'utf8' });
  for (const a of [['--zzz'], ['--limit', 'x'], ['--limit', '-1'], ['--min-age-min', 'abc']]) eq(run(...a).status, 2, `${a.join(' ')}`);
});
check('(9) 삭제 경로는 이 시험이 실행하지 않는다 — 소스에 링크를 따라가지 않는 처리와 삭제 직전 재확인이 있는지만 본다', () => {
  const src = readFileSync(TOOL, 'utf8');
  ok(/lstat/.test(src), 'lstat(링크를 따라가지 않음) 사용이 없음');
  ok(/isSymbolicLink/.test(src), '링크 판별이 없음');
  ok(/AUTO_PATTERNS/.test(src) && /rmdirSync/.test(src), '재확인/삭제 구성요소가 없음');
  ok(!/rmSync/.test(src), 'rmSync(링크 동작이 불명확) 대신 직접 만든 삭제기를 써야 함');
});
let linkTest = true;
check('(10) 실제 심볼릭 링크 폴더는 미리보기에서 "link" 로 건너뛴다', () => {
  const sb = join(BASE, 'sb10'); mkdirSync(sb, { recursive: true });
  const real = join(BASE, 'real-target'); mkdirSync(real, { recursive: true });
  try { symlinkSync(real, join(sb, 'orch-test-LinkAA'), 'junction'); } catch { return { skip: '이 환경에서 링크를 만들 수 없음' }; }
  const r = spawnSync(process.execPath, [TOOL, '--dir', sb, '--min-age-min', '0'], { encoding: 'utf8' });
  eq(r.status, 0, `종료코드\n${r.stdout}${r.stderr}`);
  ok(/link/.test(r.stdout) && !/대상 1/.test(r.stdout), `링크가 건너뛰어지지 않음\n${r.stdout}`);
  ok(existsSync(real), '링크 대상이 사라짐');
});

console.log(`\n시험 폴더(지우지 않음): ${BASE}`);
console.log(`PASS ${pass} / FAIL ${fail} / SKIP ${skip}`);
process.exit(fail ? 1 : 0);
