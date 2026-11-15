#!/usr/bin/env node
// 실행: node tests/roles.test.mjs   (성공 시 종료코드 0)
// 원본 대조용 환경변수: ORCH_LEGACY_DIR (기본값 = fixtures/config.legacy.json 의 control_dir)
import { readFileSync, existsSync, mkdtempSync, cpSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT, loadRoles, loadConfig, readHeaderTemplate, renderHeader, renderBody, renderCard, normalizeNewlines, substitute, roleVars, findRoleRefs, resolveRoleRef } from '../bin/orch-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(here, 'fixtures', 'config.legacy.json');
const config = loadConfig(CONFIG);
const legacyDir = process.env.ORCH_LEGACY_DIR || config.control_dir;

// 설계서 5-5 확정 표
const EXPECTED = [
  ['commander', 'commander', []],
  ['approval-proxy', 'proxy', []],
  ['approval-reviewer', 'worker', ['ct-cc-1']],
  ['ledger-keeper', 'worker', ['ct-cc-2', 'ct-cc-10']],
  ['verifier', 'worker', ['ct-cc-3', 'ct-cc-4']],
  ['human-tasks', 'worker', ['ct-cc-5']],
  ['window-inspector', 'worker', ['ct-cc-6', 'ct-cc-12']],
  ['test-dispatcher', 'worker', ['ct-cc-7']],
  ['doc-consistency', 'worker', ['ct-cc-8', 'ct-cc-14']],
  ['git-keeper', 'worker', ['ct-cc-9']],
  ['security-guard', 'worker', ['ct-cc-11']],
  ['role-auditor', 'worker', ['ct-cc-13']],
];
const WORKER_ORDER = EXPECTED.filter((e) => e[1] === 'worker').map((e) => e[0]); // slot 1..10 순서

let pass = 0, fail = 0, skip = 0;
function check(name, fn) {
  try {
    const r = fn();
    if (r && r.skip) { skip++; console.log(`SKIP  ${name} — ${r.skip}`); return; }
    pass++; console.log(`PASS  ${name}${r && r.note ? ` (${r.note})` : ''}`);
  } catch (e) {
    fail++; console.log(`FAIL  ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
  }
}
const eq = (a, b, what) => {
  if (a !== b) {
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    throw new Error(`${what}: 달라짐 (첫 차이 위치 ${i})\n  실제: …${JSON.stringify(a.slice(Math.max(0, i - 20), i + 40))}\n  기대: …${JSON.stringify(b.slice(Math.max(0, i - 20), i + 40))}`);
  }
};
// ORCH_HOME 을 없는 임시 위치로 돌려, 이 PC 에 내 역할 폴더(<ORCH_HOME>/config/roles)가 있어도 시험 결과에 섞이지 않게 한다(정리 2)
const NO_HOME = join(tmpdir(), `orch-roles-test-nohome-${process.pid}`);
const runNode = (args) => spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ORCH_HOME: NO_HOME } });

const roles = loadRoles(join(ROOT, 'roles'));
const tpl = readHeaderTemplate(join(ROOT, 'templates'));
const byId = (id) => roles.find((r) => r.meta.id === id);

// (i) validate 통과
check('(i) validate-roles 통과', () => {
  const r = runNode(['bin/validate-roles.mjs']);
  if (r.status !== 0) throw new Error(`종료코드 ${r.status}\n${r.stderr}${r.stdout}`);
  return { note: r.stdout.trim() };
});

// (i-b) validate 가 실제로 잘못된 것을 잡는가 (복사본을 일부러 깨뜨림)
const mutations = [
  ['id 중복', (d) => edit(d, 'verifier.md', (t) => t.replace('id: verifier', 'id: git-keeper'))],
  ['같은 kind 안 slot 중복', (d) => edit(d, 'verifier.md', (t) => t.replace('slot: 3', 'slot: 1'))],
  ['본문의 허용되지 않는 변수', (d) => edit(d, 'verifier.md', (t) => t + '{secret_value}\n')],
  ['reports_to 가 없는 id', (d) => edit(d, 'verifier.md', (t) => t.replace('reports_to: commander', 'reports_to: nobody'))],
  ['id 형식 위반(대문자)', (d) => edit(d, 'verifier.md', (t) => t.replace('id: verifier', 'id: Verifier'))],
  ['replaces 형식 위반', (d) => edit(d, 'verifier.md', (t) => t.replace('[ct-cc-3, ct-cc-4]', '[CT CC 3]'))],
  ['이름 orch-<id> 32자 초과', (d) => { edit(d, 'verifier.md', (t) => t.replace('id: verifier', 'id: ' + 'a'.repeat(28))); }],
  ['read-only 인데 writes_to 있음', (d) => edit(d, 'verifier.md', (t) => t.replace('writes_to: []', 'writes_to: ["x"]'))],
  ['본문의 없는 id 참조 {n:no-such-role}', (d) => edit(d, 'verifier.md', (t) => t + '{n:no-such-role}\n')],
  ['본문의 참조 종류 위반 {role:verifier}', (d) => edit(d, 'verifier.md', (t) => t + '{role:verifier}\n')],
  ['본문의 참조 id 형식 위반 {n:Verifier}', (d) => edit(d, 'verifier.md', (t) => t + '{n:Verifier}\n')],
  ['writes_to 의 허용되지 않는 변수', (d) => edit(d, 'commander.md', (t) => t.replace('{control_dir}/README.md', '{secret_dir}/README.md'))],
  ['commander 규칙 문장에 출처 없음', (d) => edit(d, 'commander.md', (t) => t.replace(' <!-- 출처: 오케스트레이션-역할표.md 6장(이동 전) -->\n- 질문은', '\n- 질문은'))],
];
function edit(dir, file, fn) {
  const p = join(dir, file);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`시험 준비 오류: ${file} 에서 바꿀 곳을 못 찾음`);
  writeFileSync(p, after);
}
for (const [label, mutate] of mutations) {
  check(`(i-b) 깨진 입력을 거부: ${label}`, () => {
    const tmp = mkdtempSync(join(tmpdir(), 'orch-test-'));
    try {
      cpSync(join(ROOT, 'roles'), tmp, { recursive: true });
      mutate(tmp);
      const r = runNode(['bin/validate-roles.mjs', '--roles-dir', tmp]);
      if (r.status !== 1) throw new Error(`종료코드 1을 기대했으나 ${r.status}\n${r.stdout}`);
    } finally { rmSync(tmp, { recursive: true, force: true }); }
  });
}

// (ii) 12개 파일·id·kind·replaces 가 설계서 5-5 와 일치
check('(ii) 역할 12개의 id·kind·replaces 가 설계서 5-5 와 일치', () => {
  eq(String(roles.length), '12', '역할 파일 수');
  for (const [id, kind, replaces] of EXPECTED) {
    const r = byId(id);
    if (!r) throw new Error(`역할 '${id}' 없음`);
    eq(r.meta.kind, kind, `${id}.kind`);
    eq(JSON.stringify(r.meta.replaces), JSON.stringify(replaces), `${id}.replaces`);
    if (r.meta.slot !== (kind === 'worker' ? WORKER_ORDER.indexOf(id) + 1 : 0)) throw new Error(`${id}.slot 이 ${r.meta.slot}`);
    eq(r.file, `${id}.md`, `${id} 파일 이름`);
  }
  const proxy = byId('approval-proxy');
  if (proxy.meta.enabled !== false) throw new Error('approval-proxy 는 기본 꺼짐(enabled: false)이어야 함');
  return { note: '12/12' };
});

check('(ii) 쓰기 권한은 commander·ledger-keeper·human-tasks 뿐', () => {
  const writers = roles.filter((r) => r.meta.mode === 'scoped-write').map((r) => r.meta.id).sort();
  eq(writers.join(','), 'commander,human-tasks,ledger-keeper', 'scoped-write 역할');
});

// (iii) 원본 대조
const legacyFile = join(legacyDir, '역할-카드-1-10.md');
const legacyAvailable = existsSync(legacyFile);
const skipReason = legacyAvailable ? null : `원본 파일 없음: ORCH_LEGACY_DIR(${legacyDir}) 아래 역할-카드-1-10.md`;
let legacy = null;
if (legacyAvailable) {
  const lines = normalizeNewlines(readFileSync(legacyFile, 'utf8')).split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '```') {
      const j = lines.indexOf('```', i + 1);
      blocks.push({ heading: lines[i - 2], text: lines.slice(i + 1, j).join('\n') });
      i = j;
    }
  }
  legacy = { header: blocks[0]?.text, roles: blocks.slice(1), count: blocks.length };
}

// ---------- 의도적 차이 목록 (정리 1) ----------
// 원본과 렌더 결과가 다를 수 있는 곳은 아래 4가지뿐이다. 이 목록 밖의 차이는 (iii-1)~(iii-3)이 실패시킨다.
// 변수 {n:…} {name:…} 는 "차이"가 아니라 레거시 설정으로 렌더하면 원본과 글자까지 같아야 하는 것이라 (iii-5)에서 따로 본다.
const LEGACY_STATE_SENTENCE = '오케스트레이션은 지금 일시 중지 중이다. 총지휘가 "재개"라고 알리거나 요청 메시지를 보낼 때만 그 범위만큼 일하고, 스스로 반복하지 않는다(사용량 한도).';
const NEW_RULE_SENTENCE = '역할 창은 총지휘가 요청 메시지를 보낼 때만 그 범위만큼 일하고, 스스로 반복하지 않는다(사용량 한도).';
const HEADER_DIFFS = [
  { no: 1, label: '머리말: 대괄호 안 ", 사용자 허락 11-10" 삭제', from: ', 사용자 허락 11-10', to: '' },
  { no: 2, label: '머리말: 상태 문장을 상시 규칙 문장으로 교체', from: LEGACY_STATE_SENTENCE, to: NEW_RULE_SENTENCE },
];
const BODY_DIFFS = {
  'git-keeper': [{ no: 3, label: '깃 본문: 첫 문장(현재 상태) 삭제', from: '지금은 사용자 결정으로 푸시·PR·병합을 모두 보관 중이라 하지 않는다. ', to: '' }],
  'doc-consistency': [{ no: 4, label: '문서 정합 감독관 본문: "(11-09 기준 Kakao)" 삭제', from: '(11-09 기준 Kakao)', to: '' }],
  // 부팅 읽기 시험(2026-11-14)이 찾은 결함 S1: 정본 이동 뒤에도 감사관 본문이 옛 역할표 3·4·6장을 가리켰다.
  // 번들은 다른 PC에서도 쓰므로 위치(폴더 이름)는 적지 않고, 위치는 이 PC 문서(총지휘-인수인계)가 알려 준다. {n:…} {name:…} 는 레거시 설정으로 렌더한 글자와 같아야 한다.
  'role-auditor': [
    { no: 5, label: '감사관 본문: 읽을 곳을 생성된 역할표·카드로(옛 3·4·6장 대신)', from: '오케스트레이션-역할표.md(3·4·6장), queue.md', to: '생성된 역할표(sync 출력의 역할표.md)와 생성된 카드(같은 출력의 cards 폴더, 위치는 총지휘-인수인계.md), 오케스트레이션-역할표.md(4장 프로젝트 스냅샷), queue.md' },
    { no: 6, label: '감사관 본문: 비교할 역할 설명을 생성된 역할표의 "하는 일" 열과 카드로', from: '역할표 3장의 역할 설명을 서로 비교해', to: '생성된 역할표의 "하는 일" 열과 각 카드의 설명을 서로 비교해' },
    { no: 7, label: '감사관 본문: 알려진 겹침 목록을 본문에 직접 적음(옛 3장 의존 제거)', from: '이미 알려진 겹침은 역할표 3장 아래의 "아직 남은 겹침"을 보고, 새로 생긴 것', to: '이미 알려진 겹침은 다시 보고하지 않고(경계로만 정한 겹침: 시험 지시(역할 6)와 프로젝트 창 작업 펌프 A, 프로젝트 창 비밀값 1차 점검과 보안·민감정보 점검관(역할 9)), 새로 생긴 것' },
  ],
};
const count = (text, sub) => text.split(sub).length - 1;
function applyOnce(text, d, where) {
  if (count(text, d.from) !== 1) throw new Error(`${where}: 차이 ${d.no}("${d.from.slice(0, 20)}…")의 자리가 정확히 1곳이어야 하는데 ${count(text, d.from)}곳`);
  return text.replace(d.from, () => d.to);
}
const applyDiffs = (text, diffs, where) => diffs.reduce((t, d) => applyOnce(t, d, where), text);
const legacyHeaderFor = (h, r) => h.replace('{번호}', String(r.meta.slot)).replace('{이름}', r.meta.name);
const expectedHeader = (r, skipNo) => legacyHeaderFor(applyDiffs(legacy.header, HEADER_DIFFS.filter((d) => d.no !== skipNo), '머리말'), r);
const expectedBody = (id, i, skipNo) => applyDiffs(legacy.roles[i].text, (BODY_DIFFS[id] ?? []).filter((d) => d.no !== skipNo), `${id} 본문`);

check('(iii-0) 원본 구조 확인: 코드블록 11개, 역할 제목·이름이 역할 파일과 같음', () => {
  if (!legacyAvailable) return { skip: skipReason };
  eq(String(legacy.count), '11', '원본 코드블록 수');
  WORKER_ORDER.forEach((id, i) => {
    const r = byId(id);
    eq(legacy.roles[i].heading, `### 역할 ${r.meta.slot} · ${r.meta.name}`, `${id} 원본 제목`);
  });
});

check('(iii-1) worker 10개 본문 = 원본 3장 코드블록에 의도적 차이(3·4번)만 적용한 결과 (글자 단위 일치)', () => {
  if (!legacyAvailable) return { skip: skipReason };
  WORKER_ORDER.forEach((id, i) => eq(renderBody(byId(id), roles, config), expectedBody(id, i), `${id} 본문`));
  return { note: '10/10' };
});

check('(iii-2) worker 10개 머리말 = 원본 2장에 의도적 차이(1·2번)만 적용한 결과 (글자 단위 일치)', () => {
  if (!legacyAvailable) return { skip: skipReason };
  for (const id of WORKER_ORDER) eq(renderHeader(tpl, byId(id), roles, config), expectedHeader(byId(id)), `${id} 머리말`);
  return { note: '10/10' };
});

check('(iii-3) 전체 카드 = 기대 머리말 + 공백 + 기대 본문', () => {
  if (!legacyAvailable) return { skip: skipReason };
  WORKER_ORDER.forEach((id, i) => eq(renderCard(tpl, byId(id), roles, config), `${expectedHeader(byId(id))} ${expectedBody(id, i)}`, `${id} 카드`));
});

// (iii-4) 의도적 차이를 하나씩 따로 검증: 자리가 1곳뿐, 다른 문서에는 없음, 렌더 결과에서 사라짐/바뀜, 그 차이만 빼면 결과가 달라짐
for (const d of HEADER_DIFFS) {
  check(`(iii-4) 의도적 차이 ${d.no}: ${d.label}`, () => {
    if (!legacyAvailable) return { skip: skipReason };
    eq(String(count(legacy.header, d.from)), '1', '원본 머리말에서 이 문장의 자리 수');
    legacy.roles.forEach((b, i) => { if (count(b.text, d.from) !== 0) throw new Error(`원본 본문 ${i + 1}번에도 같은 문장이 있음`); });
    for (const id of WORKER_ORDER) {
      const r = byId(id);
      const out = renderHeader(tpl, r, roles, config);
      eq(String(count(out, d.from)), '0', `${id} 렌더 머리말에 남은 원문 수`);
      if (d.to) eq(String(count(out, d.to)), '1', `${id} 렌더 머리말의 새 문장 수`);
      eq(out, applyDiffs(expectedHeader(r, d.no), [d], '머리말'), `${id}: 이 차이 하나만 적용한 결과`);
      if (out === expectedHeader(r, d.no)) throw new Error(`${id}: 이 차이가 결과에 반영되지 않음`);
    }
  });
}
for (const [id, diffs] of Object.entries(BODY_DIFFS)) {
  for (const d of diffs) {
    check(`(iii-4) 의도적 차이 ${d.no}: ${d.label}`, () => {
      if (!legacyAvailable) return { skip: skipReason };
      const idx = WORKER_ORDER.indexOf(id);
      eq(String(count(legacy.roles[idx].text, d.from)), '1', `원본 ${id} 본문에서 이 문장의 자리 수`);
      legacy.roles.forEach((b, i) => { if (i !== idx && count(b.text, d.from) !== 0) throw new Error(`원본 본문 ${i + 1}번에도 같은 문장이 있음`); });
      if (count(legacy.header, d.from) !== 0) throw new Error('원본 머리말에도 같은 문장이 있음');
      const out = renderBody(byId(id), roles, config);
      eq(String(count(out, d.from)), '0', `${id} 렌더 본문에 남은 원문 수`);
      eq(out, applyDiffs(expectedBody(id, idx, d.no), [d], `${id} 본문`), '이 차이 하나만 적용한 결과');
      if (out === expectedBody(id, idx, d.no)) throw new Error('이 차이가 결과에 반영되지 않음');
      // 다른 9개 본문은 원본 그대로(차이 없음)
      WORKER_ORDER.forEach((other, i) => { if (other !== id && !BODY_DIFFS[other]) eq(renderBody(byId(other), roles, config), legacy.roles[i].text, `${other} 본문(차이 없어야 함)`); });
    });
  }
}

// (iii-5) 변수 {n:…} {name:…} 는 레거시 설정으로 풀면 원본의 번호·이름과 글자까지 같다
check('(iii-5) {n:<id>} {name:<id>} 의 값 = 원본 3장 제목의 번호·이름 (참조 전부)', () => {
  if (!legacyAvailable) return { skip: skipReason };
  const heading = Object.fromEntries(WORKER_ORDER.map((id, i) => [id, legacy.roles[i].heading.match(/^### 역할 (\d+) · (.+)$/)]));
  let n = 0;
  for (const r of roles) {
    for (const ref of findRoleRefs(r.body)) {
      const h = heading[ref.id];
      if (!h) throw new Error(`${r.file}: ${ref.raw} 가 worker 가 아닌 역할을 가리킴`);
      const want = ref.kind === 'n' ? h[1] : h[2];
      eq(String(resolveRoleRef(ref.kind, ref.id, roles)), want, `${r.file} ${ref.raw}`);
      n++;
    }
  }
  if (n < 40) throw new Error(`참조 변수가 너무 적음(${n}개) — 번호·이름 참조를 변수로 바꿨는지 확인`);
  return { note: `참조 ${n}개 일치` };
});

// (iii-6) 리터럴 "역할 <숫자>" 가 하나도 없다 (역할 파일 본문 12개 + 머리말 틀)
check('(iii-6) 역할 본문 12개와 머리말 틀에 리터럴 "역할 <숫자>" 가 0건', () => {
  const hits = [];
  for (const r of roles) for (const m of r.body.matchAll(/역할\s*\d/g)) hits.push(`${r.file}: …${r.body.slice(Math.max(0, m.index - 10), m.index + 15)}…`);
  for (const m of tpl.matchAll(/역할\s*\d/g)) hits.push(`card-header.md: …${tpl.slice(Math.max(0, m.index - 10), m.index + 15)}…`);
  if (hits.length) throw new Error(hits.join('\n'));
});

// (iii-7) 현재 상태·날짜가 카드에 남지 않았다
check('(iii-7) 머리말 틀과 역할 본문에 "일시 중지"·"재개"·날짜 표기가 없다', () => {
  const bad = [/일시 중지/, /재개/, /(?<![\w-])\d{1,2}-\d{1,2}(?![\w-])/, /지금은/];
  const hits = [];
  const docs = [['card-header.md', tpl], ...roles.filter((r) => r.meta.kind === 'worker').map((r) => [r.file, r.body])];
  for (const [f, text] of docs) for (const rx of bad) { const m = text.match(rx); if (m) hits.push(`${f} ~ ${rx}: …${text.slice(Math.max(0, m.index - 10), m.index + 20)}…`); }
  if (hits.length) throw new Error(hits.join('\n'));
});

check('(iii-8) 머리말에 상시 규칙 문장이 정확히 한 번, 상태 표현 없이 들어 있다', () => {
  eq(String(count(tpl, NEW_RULE_SENTENCE)), '1', '상시 규칙 문장 수');
  if (!tpl.endsWith(NEW_RULE_SENTENCE)) throw new Error('상시 규칙 문장이 머리말 맨 끝(원본 상태 문장 자리)에 있어야 함');
});

// S5(부팅 읽기 시험): 인수인계가 "역할이 바뀌면 역할표 10장 이력과 인수인계도 고치라"고 하므로 두 파일을 쓰기 범위에 더했다.
check('(iii-9) 총지휘: mode scoped-write, writes_to 는 queue.md·창-대응표.md·README.md·총지휘-인수인계.md·오케스트레이션-역할표.md 5개', () => {
  const c = byId('commander');
  eq(c.meta.mode, 'scoped-write', 'commander.mode');
  const want = ['queue.md', '창-대응표.md', 'README.md', '총지휘-인수인계.md', '오케스트레이션-역할표.md'];
  eq(JSON.stringify(c.meta.writes_to), JSON.stringify(want.map((f) => `{control_dir}/${f}`)), 'commander.writes_to');
  eq(JSON.stringify(substitute(c.meta.writes_to.join('|'), roleVars(c, roles, config)).split('|')),
    JSON.stringify(want.map((f) => `${config.control_dir}/${f}`)), '치환된 writes_to');
});

check('(iii-10) 감사관 본문에 정본 이동 전 장 번호 참조(3·4·6장, 역할표 3장)가 남아 있지 않다', () => {
  const t = renderBody(byId('role-auditor'), roles, config);
  for (const s of ['(3·4·6장)', '역할표 3장']) eq(String(count(t, s)), '0', `감사관 본문에 남은 "${s}"`);
});


// (iv) render-card 명령
check('(iv) render-card 명령이 렌더 결과를 그대로 출력', () => {
  const r = runNode(['bin/render-card.mjs', 'verifier', '--config', CONFIG]);
  if (r.status !== 0) throw new Error(r.stderr);
  eq(r.stdout, renderCard(tpl, byId('verifier'), roles, config) + '\n', 'stdout');
  const bad = runNode(['bin/render-card.mjs', 'commander', '--config', CONFIG]);
  if (bad.status === 0) throw new Error('worker 가 아닌 역할은 거부해야 함');
});

// (v) 개인 값 누출 없음 (fixture 만 예외)
check('(v) roles·templates·schema·bin 에 개인 값(옛 주소·드라이브 경로·이메일)이 없음', () => {
  const bad = [/\bt2n\b/, /[A-Za-z]:\\[A-Za-z_]/, /[A-Za-z]:\/[A-Za-z_]/, /[\w.+-]+@[\w-]+\.[\w.]+/, /My-Space-1/];
  const hits = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const t = readFileSync(p, 'utf8');
        for (const rx of bad) if (rx.test(t)) hits.push(`${p.slice(ROOT.length + 1)} ~ ${rx}`);
      }
    }
  };
  for (const d of ['roles', 'templates', 'schema', 'bin']) walk(join(ROOT, d));
  if (hits.length) throw new Error(hits.join('\n'));
});

// ---------- 변경 시나리오 (임시 사본에서) ----------
function withTempRoles(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'orch-scn-'));
  try {
    cpSync(join(ROOT, 'roles'), tmp, { recursive: true });
    return fn(tmp);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const validateDir = (dir) => runNode(['bin/validate-roles.mjs', '--roles-dir', dir]);
// 모든 역할 본문(+worker 머리말)을 렌더한 글을 이어 붙인다
const renderAll = (rs) => rs.map((r) => (r.meta.kind === 'worker' ? renderCard(tpl, r, rs, config) : renderBody(r, rs, config))).join('\n=====\n');
const refCount = (kind, id) => roles.reduce((n, r) => n + findRoleRefs(r.body).filter((x) => x.kind === kind && x.id === id).length, 0);

check('(vi-a) slot 을 바꾸면 그 역할을 가리키는 모든 숫자가 따라 바뀌고 낡은 숫자가 남지 않는다', () => withTempRoles((dir) => {
  edit(dir, 'verifier.md', (t) => t.replace('slot: 3', 'slot: 11'));
  const v = validateDir(dir);
  if (v.status !== 0) throw new Error(`slot 변경 뒤 검증 실패\n${v.stderr}`);
  const rs = loadRoles(dir);
  const before = renderAll(roles), after = renderAll(rs);
  const refs = refCount('n', 'verifier');
  if (refs < 2) throw new Error(`verifier 를 숫자로 가리키는 곳이 너무 적음(${refs})`);
  // 본문 참조 refs 곳 + verifier 자기 머리말("역할 {role_number}번") 1곳이 새 숫자 11 로 나와야 하고 "역할 3" 은 없어야 함
  eq(String((after.match(/역할 11(?!\d)/g) ?? []).length), String(refs + 1), '새 숫자가 나온 곳');
  if (/역할 3(?!\d)/.test(after)) throw new Error('낡은 숫자 "역할 3" 이 남아 있음');
  if (!/역할 3(?!\d)/.test(before)) throw new Error('시험 준비 오류: 원래 렌더에는 "역할 3" 이 있어야 함');
  // 머리말의 이름 목록도 slot 순서로 다시 만들어졌는가: 11 검증관 이 10 뒤에 온다
  if (!/10 역할 중복·범위 감사관, 11 검증관/.test(after)) throw new Error('머리말 이름 목록이 새 slot 을 따르지 않음');
  return { note: `참조 ${refs}곳이 3→11` };
}));

check('(vi-b) name 을 바꾸면 그 역할을 이름으로 가리키는 참조가 따라 바뀌고 낡은 이름이 남지 않는다', () => withTempRoles((dir) => {
  edit(dir, 'verifier.md', (t) => t.replace('name: "검증관"', 'name: "최종 확인 담당"'));
  const v = validateDir(dir);
  if (v.status !== 0) throw new Error(`name 변경 뒤 검증 실패\n${v.stderr}`);
  const after = renderAll(loadRoles(dir));
  const refs = refCount('name', 'verifier');
  if (refs < 4) throw new Error(`verifier 를 이름으로 가리키는 곳이 너무 적음(${refs})`);
  // 본문 참조 refs 곳 + verifier 자기 머리말의 role_name 1곳 + worker 10개 머리말의 이름 목록 10곳
  eq(String(count(after, '최종 확인 담당')), String(refs + 1 + 10), '새 이름이 나온 곳');
  if (after.includes('검증관')) { const i = after.indexOf('검증관'); throw new Error(`낡은 이름이 남음: …${after.slice(Math.max(0, i - 30), i + 20)}…`); }
  if (!renderAll(roles).includes('검증관')) throw new Error('시험 준비 오류: 원래 렌더에는 "검증관" 이 있어야 함');
  return { note: `참조 ${refs}곳` };
}));

check('(vi-c) 없는 id 참조는 검증 실패이고 렌더도 막힌다', () => withTempRoles((dir) => {
  edit(dir, 'verifier.md', (t) => t + '{name:ghost-role}\n');
  const v = validateDir(dir);
  if (v.status !== 1 || !/없는 역할 id/.test(v.stderr)) throw new Error(`종료코드 1·"없는 역할 id" 를 기대: ${v.status}\n${v.stderr}`);
  let threw = false;
  try { renderBody(loadRoles(dir).find((r) => r.meta.id === 'verifier'), loadRoles(dir), config); } catch (e) { threw = /없는 역할 id/.test(e.message); }
  if (!threw) throw new Error('렌더가 없는 id 참조를 막지 않음');
}));

check('(vi-d) 켜진 역할이 꺼진(enabled: false) 역할을 가리키면 "경고"(종료코드 0)이고, 꺼진 역할 자신의 자기 참조는 경고가 아니다', () => withTempRoles((dir) => {
  edit(dir, 'security-guard.md', (t) => t.replace('enabled: true', 'enabled: false'));
  const v = validateDir(dir);
  if (v.status !== 0) throw new Error(`꺼진 역할 참조는 실패가 아니라 경고여야 함(종료코드 0): ${v.status}
${v.stderr}`);
  if (!/경고 \d+건/.test(v.stderr)) throw new Error(`"경고" 출력이 없음
${v.stderr}`);
  for (const f of ['verifier.md', 'git-keeper.md', 'commander.md']) if (!v.stderr.includes(`${f}: 꺼진`)) throw new Error(`${f} 에 대한 경고가 없음
${v.stderr}`);
  if (v.stderr.includes('security-guard.md:')) throw new Error('꺼진 역할 자신의 글(자기 참조)은 경고하면 안 됨');
  if (!v.stdout.startsWith('OK:')) throw new Error(`stdout 은 그대로 OK 로 시작해야 함: ${v.stdout}`);
  // 가리키는 쪽 역할도 끄면 그 파일의 경고가 사라진다
  edit(dir, 'verifier.md', (t) => t.replace('enabled: true', 'enabled: false'));
  edit(dir, 'git-keeper.md', (t) => t.replace('enabled: true', 'enabled: false'));
  const v2 = validateDir(dir);
  for (const f of ['verifier.md', 'git-keeper.md']) if (v2.stderr.includes(`${f}: 꺼진`)) throw new Error(`${f} 도 꺼졌는데 계속 경고함
${v2.stderr}`);
  // 모두 켜져 있으면 경고가 없다
  const ok = validateDir(join(ROOT, 'roles'));
  if (ok.stderr.includes('경고')) throw new Error(`기본 12개에서는 경고가 없어야 함
${ok.stderr}`);
}));

check('(vi-e) 호환: substitute 의 옛 호출 방식과 새 선택 인자, renderHeader/Body/Card 서명', () => {
  const r = byId('git-keeper');
  const vars = roleVars(r, roles, config);
  eq(substitute('{n:verifier}|{name:verifier}|{role_number}|{commander}', vars), '3|검증관|8|t9m', 'roleVars 에 실린 목록으로 풀기');
  eq(substitute('{n:verifier}', { commander: 'x' }, roles), '3', '세 번째 인자로 목록을 주기');
  let threw = false;
  try { substitute('{n:verifier}', { commander: 'x' }); } catch (e) { threw = /역할 목록/.test(e.message); }
  if (!threw) throw new Error('목록 없이 참조를 풀면 오류여야 함');
  eq(Object.keys(vars).join(','), 'commander,control_dir,projects_root,scope_prefix,role_number,role_name,roles_summary', 'roleVars 의 열거 가능한 키는 그대로');
  eq(String(renderHeader.length) + String(renderBody.length) + String(renderCard.length), '434', '렌더 함수 인자 수');
});

console.log(`\n결과: PASS ${pass} / FAIL ${fail} / SKIP ${skip}`);
process.exit(fail ? 1 : 0);
