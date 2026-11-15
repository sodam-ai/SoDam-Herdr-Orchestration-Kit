#!/usr/bin/env node
// roles/*.md 점검. 실패하면 이유를 출력하고 종료코드 1.
// 사용: node bin/validate-roles.mjs [--roles-dir <폴더>] [--user-roles-dir <폴더>] [--templates-dir <폴더>] [--schema <파일>]
//   내 역할 폴더(기본 <ORCH_HOME>/config/roles)가 있으면 번들 위에 얹어 함께 검증한다(규칙은 orch-lib.mjs loadRolesLayered 한 곳).
//   --roles-dir 만 주면 내 역할 폴더는 쓰지 않는다. 잘못된 내 역할 파일이 하나라도 있으면 실패(종료코드 1).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, ALLOWED_VARS, ROLE_REF_KINDS, ID_PATTERN, resolveRoleDirs, loadRolesLayered, findVariables, findRoleRefs, validateSchema, readHeaderTemplate } from './orch-lib.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const rolesDir = opt('--roles-dir');
const userRolesDir = opt('--user-roles-dir');
const templatesDir = opt('--templates-dir', join(ROOT, 'templates'));
const schemaPath = opt('--schema', join(ROOT, 'schema', 'role.schema.json'));

// commander·proxy 본문의 규칙 문장에 붙여야 하는 출처 주석에서 허용하는 문서
const SOURCE_FILES = ['오케스트레이션-역할표.md', '총지휘-인수인계.md', '역할-카드-1-10.md', 'autopress.ps1', '01_이식-설계서.md'];

export function validate({ rolesDir, userRolesDir, templatesDir, schemaPath }) {
  const fails = [];
  const warns = [];
  const fail = (file, msg) => fails.push(`${file}: ${msg}`);
  const dirs = resolveRoleDirs({ rolesDir, userRolesDir });
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  let roles;
  try { roles = loadRolesLayered(dirs.bundle, dirs.user); }
  catch (e) { return { fails: [`${dirs.bundle}: 역할 폴더를 읽을 수 없음: ${e.message}`], warns, count: 0, mine: { override: 0, user: 0, dir: dirs.user } }; }
  if (roles.length === 0) fail(dirs.bundle, '역할 파일(*.md)이 하나도 없음');
  const L = (r) => r.label ?? r.file;   // 오류 메시지에 쓰는 이름(내 역할 폴더에서 온 것은 그렇게 표시)

  for (const r of roles) {
    for (const e of r.errors) fail(L(r), e);
    if (r.errors.length) continue;
    for (const e of validateSchema(r.meta, schema)) fail(L(r), e);
    const m = r.meta;
    if (typeof m.id === 'string' && r.file !== `${m.id}.md`) fail(L(r), `파일 이름이 id(${m.id}.md)와 다름`);
    if (typeof m.id === 'string' && `orch-${m.id}`.length > 32) fail(L(r), `창 이름 orch-${m.id} 가 32자를 넘음`);
    if (m.mode === 'read-only' && Array.isArray(m.writes_to) && m.writes_to.length) fail(L(r), 'mode 가 read-only 인데 writes_to 가 비어 있지 않음');
    if (m.mode === 'scoped-write' && Array.isArray(m.writes_to) && !m.writes_to.length) fail(L(r), 'mode 가 scoped-write 인데 writes_to 가 비어 있음');
    if (m.kind === 'worker' && Number.isInteger(m.slot) && m.slot < 1) fail(L(r), 'worker 의 slot 은 1 이상');
    if ((m.kind === 'commander' || m.kind === 'proxy') && m.slot !== 0) fail(L(r), `${m.kind} 의 slot 은 0`);
    if (m.reports_to === m.id) fail(L(r), '자기 자신에게 보고하도록 되어 있음');
    if (m.reports_to === 'user' && m.kind !== 'commander') fail(L(r), "사용자(user)에게 보고할 수 있는 것은 commander 뿐");

    if (r.body === '') fail(L(r), '본문이 비어 있음');
    for (const v of new Set(findVariables(r.body))) {
      if (!ALLOWED_VARS.includes(v)) fail(L(r), `본문에 허용되지 않는 변수 {${v}}`);
    }
    // writes_to 안의 변수도 같은 허용 목록(치환할 때 모르는 변수는 오류가 되므로 미리 잡는다)
    for (const w of Array.isArray(m.writes_to) ? m.writes_to : []) {
      if (typeof w !== 'string') continue;
      for (const v of new Set(findVariables(w))) if (!ALLOWED_VARS.includes(v)) fail(L(r), `writes_to 에 허용되지 않는 변수 {${v}}`);
    }
    if (m.kind === 'commander' || m.kind === 'proxy') {
      r.body.split('\n').forEach((line, i) => {
        if (line.trim() === '' || /^#{1,6} /.test(line)) return;
        const c = line.match(/^- .*<!-- 출처: (.+) -->$/);
        if (!c) { fail(L(r), `본문 ${i + 1}째 줄: 규칙 문장은 '- 문장 <!-- 출처: 파일명 장 -->' 형식이어야 함`); return; }
        for (const part of c[1].split(';')) {
          if (!SOURCE_FILES.some((f) => part.trim().startsWith(f))) fail(L(r), `본문 ${i + 1}째 줄: 알 수 없는 출처 '${part.trim()}'`);
        }
      });
    }
  }

  const ok = roles.filter((r) => !r.errors.length);
  const seen = (pick, label, scope) => {
    const map = new Map();
    for (const r of ok) {
      const key = scope ? `${r.meta.kind}/${pick(r)}` : pick(r);
      if (map.has(key)) fail(L(r), `${label} '${pick(r)}' 가 ${map.get(key)} 와 겹침`);
      else map.set(key, L(r));
    }
  };
  seen((r) => r.meta.id, 'id', false);
  seen((r) => r.meta.slot, 'slot(같은 kind 안)', true);

  const ids = new Set(ok.map((r) => r.meta.id));
  const enabledOf = new Map(ok.map((r) => [r.meta.id, r.meta.enabled === true]));

  // 참조 변수 {n:<id>} {name:<id>}: 종류·id 형식·존재를 본다.
  // 켜진 역할의 글이 꺼진 역할을 가리키면 '경고'(실패 아님, 종료코드 0): 그 글은 "그 역할에게 맡긴다/그 결과가 필요하다"처럼
  // 안내하는데 꺼진 역할은 일하지 않으므로 안내가 틀려진다. 그래도 실패로 두지 않는 이유: 사용자가 역할을 끄는 것(제거)은
  // 언제든 되어야 하고(설계서 I6 결정), 실패로 두면 다른 역할의 글을 먼저 고치기 전에는 끌 수 없게 된다(설치 시험 8c도 이 흐름을 요구).
  // 고치는 길: 경고에 나온 글에서 그 참조를 지우거나 그 역할을 다시 켠다. 꺼진 역할 자신의 글은 나가지 않으므로 존재만 본다.
  const warned = new Set();
  const checkRefs = (file, text, referrerEnabled) => {
    for (const ref of findRoleRefs(text)) {
      if (!ROLE_REF_KINDS.includes(ref.kind)) { fail(file, `허용되지 않는 변수 ${ref.raw} (참조 변수는 ${ROLE_REF_KINDS.map((k) => `{${k}:<id>}`).join(', ')} 만)`); continue; }
      if (!ID_PATTERN.test(ref.id)) { fail(file, `참조 id 형식이 틀림 ${ref.raw} (id 는 소문자·숫자·하이픈)`); continue; }
      if (!ids.has(ref.id)) { fail(file, `없는 역할 id 를 참조함 ${ref.raw}`); continue; }
      if (referrerEnabled && enabledOf.get(ref.id) === false) { const w = `${file}: 꺼진(enabled: false) 역할을 가리킴 ${ref.raw} — 켜진 역할의 글이 꺼진 역할을 안내하면 틀려짐`; if (!warned.has(w)) { warned.add(w); warns.push(w); } }
    }
  };
  for (const r of ok) {
    checkRefs(L(r), r.body, r.meta.enabled === true);
    for (const w of Array.isArray(r.meta.writes_to) ? r.meta.writes_to : []) if (typeof w === 'string') checkRefs(L(r), w, r.meta.enabled === true);
  }
  const claimed = new Map();
  for (const r of ok) {
    if (typeof r.meta.reports_to === 'string' && r.meta.reports_to !== 'user' && !ids.has(r.meta.reports_to)) {
      fail(L(r), `reports_to '${r.meta.reports_to}' 는 실제 역할 id 가 아님`);
    }
    for (const old of Array.isArray(r.meta.replaces) ? r.meta.replaces : []) {
      if (ids.has(old)) fail(L(r), `replaces '${old}' 는 현재 역할 id 와 같음`);
      if (claimed.has(old)) fail(L(r), `replaces '${old}' 를 ${claimed.get(old)} 도 주장함`);
      else claimed.set(old, L(r));
    }
  }

  // 머리말 틀
  const tplFile = join(templatesDir, 'card-header.md');
  if (existsSync(tplFile)) {
    const tplText = readHeaderTemplate(templatesDir);
    checkRefs('templates/card-header.md', tplText, true);
    const vars = new Set(findVariables(tplText));
    for (const v of vars) if (!ALLOWED_VARS.includes(v)) fail('templates/card-header.md', `허용되지 않는 변수 {${v}}`);
    for (const v of ['role_number', 'role_name', 'roles_summary']) if (!vars.has(v)) fail('templates/card-header.md', `필수 변수 {${v}} 가 없음`);
  } else fail('templates/card-header.md', '파일이 없음');

  const mine = { override: roles.filter((r) => r.source === 'override').length, user: roles.filter((r) => r.source === 'user').length, dir: dirs.user };
  return { fails, warns, count: roles.length, mine };
}

const { fails, warns, count, mine } = validate({ rolesDir, userRolesDir, templatesDir, schemaPath });
if (fails.length) {
  console.error(`검증 실패 ${fails.length}건 (역할 파일 ${count}개)`);
  for (const f of fails) console.error(`  - ${f}`);
  if (warns.length) { console.error(`경고 ${warns.length}건`); for (const w of warns) console.error(`  - ${w}`); }
  process.exit(1);
}
console.log(`OK: 역할 파일 ${count}개 검증 통과`);
if (mine.dir && (mine.override || mine.user)) console.log(`  내 역할 폴더(${mine.dir}): 번들 덮어쓰기 ${mine.override}개, 새 역할 ${mine.user}개 포함`);
if (warns.length) {
  console.error(`경고 ${warns.length}건 (실패는 아님)`);
  for (const w of warns) console.error(`  - ${w}`);
}
