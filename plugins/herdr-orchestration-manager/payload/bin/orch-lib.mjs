// 공용 함수: 역할 파일 읽기(머리말 파싱), 변수 치환, 머리말 틀 렌더링.
// Node 18+, 외부 패키지 없음. validate-roles / render-card / 시험이 함께 쓴다.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePaths } from '../lib/orch-paths.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 본문·머리말 틀에서 쓸 수 있는 변수 (설계서 5-2)
export const ALLOWED_VARS = [
  'commander', 'control_dir', 'projects_root', 'scope_prefix',
  'role_number', 'role_name', 'roles_summary',
];
// 다른 역할을 가리키는 참조 변수 (정리 1, C2): {n:<id>} = 그 역할의 현재 slot 숫자, {name:<id>} = 그 역할의 현재 name.
// <id> 는 역할 파일의 id 와 같은 형식(스키마 id 규칙)이어야 한다.
export const ROLE_REF_KINDS = ['n', 'name'];
export const ID_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
// 설정 파일(--config)이 반드시 가져야 하는 값
export const CONFIG_KEYS = ['commander', 'control_dir', 'projects_root', 'scope_prefix'];

export function normalizeNewlines(s) {
  return s.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

// 사용자가 직접 만드는 입력 파일(환경 규칙·설정·내 역할 파일) 읽기. 그냥 'utf8' 로 읽으면 UTF-8 이 아닌 글자(메모장 ANSI 저장 등)가
// 오류 없이 깨진 글자(�)로 바뀌어 카드에 들어간다. 엄격하게 읽어 UTF-8 이 아니면 안내 문구와 함께 실패시킨다(BOM 은 벗김).
export function readUtf8Strict(path) {
  const buf = readFileSync(path);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { const e = new Error('UTF-8 글자 형식이 아님(메모장이라면 "다른 이름으로 저장"에서 인코딩을 UTF-8 로 저장하세요)'); e.code = 'NOT_UTF8'; throw e; }
}

// ---------- 간단한 YAML 부분집합 ----------
// 지원: `key: 값` 한 줄씩. 값은 "문자열" / '문자열' / 맨문자열 / 정수 / true·false / [a, "b"] 한 줄 목록.
function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') throw new Error('빈 값');
  if (s[0] === '"') {
    const m = s.match(/^"((?:[^"\\]|\\.)*)"$/);
    if (!m) throw new Error(`따옴표가 맞지 않음: ${s}`);
    try { return JSON.parse(s); } catch { throw new Error(`잘못된 이스케이프: ${s}`); }
  }
  if (s[0] === "'") {
    const m = s.match(/^'((?:[^']|'')*)'$/);
    if (!m) throw new Error(`따옴표가 맞지 않음: ${s}`);
    return m[1].replace(/''/g, "'");
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

// 따옴표 밖의 쉼표·# 만 구분자로 본다
function splitOutsideQuotes(s, sep) {
  const out = [];
  let cur = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"') { cur += s[++i] ?? ''; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  if (q) throw new Error('따옴표가 닫히지 않음');
  out.push(cur);
  return out;
}

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}

function parseValue(raw) {
  const s = stripComment(raw).trim();
  if (s[0] === '[') {
    if (s[s.length - 1] !== ']') throw new Error(`목록이 ]로 끝나지 않음: ${s}`);
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return splitOutsideQuotes(inner, ',').map(parseScalar);
  }
  return parseScalar(s);
}

export function parseYamlSubset(text) {
  const meta = {};
  const errors = [];
  text.split('\n').forEach((line, i) => {
    if (line.trim() === '' || /^\s*#/.test(line)) return;
    const m = line.match(/^([a-z_][a-z0-9_]*):(?:\s+(.*)|\s*)$/);
    if (!m) { errors.push(`머리말 ${i + 1}째 줄을 읽을 수 없음: ${line}`); return; }
    if (Object.prototype.hasOwnProperty.call(meta, m[1])) { errors.push(`머리말에 '${m[1]}'가 두 번 있음`); return; }
    try { meta[m[1]] = parseValue(m[2] ?? ''); }
    catch (e) { errors.push(`머리말 '${m[1]}': ${e.message}`); }
  });
  return { meta, errors };
}

// 파일 전체 → { meta, body, errors }
export function parseRoleFile(rawText) {
  const text = normalizeNewlines(rawText);
  const lines = text.split('\n');
  if (lines[0] !== '---') return { meta: {}, body: '', errors: ["맨 첫 줄이 '---'가 아님(머리말 없음)"] };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { meta: {}, body: '', errors: ["머리말을 닫는 '---' 줄이 없음"] };
  const { meta, errors } = parseYamlSubset(lines.slice(1, end).join('\n'));
  const body = lines.slice(end + 1).join('\n').replace(/^\n+/, '').replace(/\s+$/, '');
  return { meta, body, errors };
}

export function loadRoles(dir) {
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((file) => {
    const r = parseRoleFile(readFileSync(join(dir, file), 'utf8'));
    return { file, ...r };
  });
}

// ---------- 내 역할 폴더 (정리 2, I8): 번들 roles/ 위에 <ORCH_HOME>\config\roles\ 를 얹는다 ----------
// 로딩 규칙은 여기 한 곳뿐이다. validate-roles, sync, render-card 가 모두 loadAllRoles() 로 읽는다.
//  - 번들 roles/*.md 를 읽고, 내 역할 폴더의 *.md 를 그 위에 얹는다. 파일 이름(확장자 뺀 것)이 역할 id 다(ID_PATTERN 검증).
//  - 같은 id 가 번들에 있으면 '덮어쓰기': 머리말은 **필드 단위로 병합**(내 파일에 적은 필드만 번들 값을 이기고, 안 적은 필드는 번들 값 유지.
//    배열 필드(writes_to, replaces, needs)는 합치지 않고 통째로 대체), 본문은 내 파일에 본문이 있으면 통째로 대체, 비어 있으면 번들 본문 유지.
//    그래서 `enabled: false` 한 줄만 적은 파일로 번들 역할을 끌 수 있다.
//  - 번들에 없는 id 는 '새 역할': 필수 필드를 모두 적어야 한다(id 는 생략해도 파일 이름으로 채움).
//  - 잘못된 파일(머리말 오류, 파일 이름 ≠ id, 링크, 읽을 수 없음)은 건너뛰지 않고 errors 가 든 항목으로 돌려준다 → 검증(validate-roles)이 실패로 보고하고
//    sync 가 멈춘다(실패 쪽으로 닫힘). .md 가 아닌 파일과 하위 폴더는 무시한다(README.txt 같은 설명 파일용).
// 머리말에 쓸 수 있는 필드는 schema/role.schema.json 이 정한다(additionalProperties: false): 기능을 켜는 필드 같은 것은 만들 수 없다.
// 돌려주는 항목: { file, label, source: 'bundle'|'override'|'user', meta, body, errors } — label 은 오류 메시지에 쓰는 이름.
export function resolveRoleDirs({ rolesDir, userRolesDir } = {}, env = process.env) {
  const bundle = rolesDir ?? join(ROOT, 'roles');
  let user;
  if (userRolesDir !== undefined) user = userRolesDir || null;       // 명시: 그 폴더(빈 글자면 쓰지 않음)
  else if (rolesDir !== undefined) user = null;                      // --roles-dir 만 줬으면 호출한 쪽이 전체 역할 집합을 정한 것: 내 역할 폴더를 몰래 얹지 않는다
  else user = resolvePaths(env).roles;                               // 기본: <ORCH_HOME>\config\roles
  return { bundle, user };
}

export function loadAllRoles(opts = {}, env = process.env) {
  const d = resolveRoleDirs(opts, env);
  return loadRolesLayered(d.bundle, d.user);
}

export function loadRolesLayered(bundleDir, userDir) {
  const roles = loadRoles(bundleDir).map((r) => ({ ...r, label: r.file, source: 'bundle' }));
  if (!userDir || !existsSync(userDir)) return roles;
  if (!statSync(userDir).isDirectory()) {
    return [...roles, { file: userDir, label: '내 역할 폴더', source: 'user', meta: {}, body: '', errors: ['내 역할 폴더 경로가 폴더가 아님'] }];
  }
  const bad = (file, msg) => ({ file, label: `내 역할/${file}`, source: 'user', meta: {}, body: '', errors: [msg] });
  const out = [...roles];
  for (const ent of readdirSync(userDir, { withFileTypes: true }).filter((e) => e.name.endsWith('.md')).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = ent.name;
    const stem = file.slice(0, -3);
    if (ent.isSymbolicLink()) { out.push(bad(file, '심볼릭 링크는 읽지 않음(링크가 가리키는 파일을 따라가지 않는다). 실제 파일로 두세요')); continue; }
    if (!ent.isFile()) continue;                                      // 폴더 등은 무시
    if (!ID_PATTERN.test(stem)) { out.push(bad(file, `파일 이름이 역할 id 형식(소문자·숫자·하이픈, 2~31자, 소문자로 시작)이 아님: '${stem}'`)); continue; }
    let parsed;
    try { parsed = parseRoleFile(readUtf8Strict(join(userDir, file))); }
    catch (e) { out.push(bad(file, `읽을 수 없음: ${e.message}`)); continue; }
    if (parsed.errors.length) { out.push({ ...bad(file, parsed.errors[0]), errors: parsed.errors }); continue; }
    if (parsed.meta.id !== undefined && parsed.meta.id !== stem) { out.push(bad(file, `머리말 id(${JSON.stringify(parsed.meta.id)})가 파일 이름(${stem})과 다름`)); continue; }
    const at = out.findIndex((r) => r.source === 'bundle' && !r.errors.length && r.meta.id === stem);
    if (at >= 0) {
      const base = out[at];
      out[at] = {
        file: base.file, label: `${base.file} (+내 역할 폴더 덮어쓰기)`, source: 'override',
        meta: { ...base.meta, ...parsed.meta, id: stem },
        body: parsed.body !== '' ? parsed.body : base.body,
        errors: [],
      };
    } else {
      out.push({ file, label: `내 역할/${file}`, source: 'user', meta: { ...parsed.meta, id: stem }, body: parsed.body, errors: [] });
    }
  }
  return out;
}

// ---------- 변수 ----------
// 맨 변수 {이름} 만 찾는다(참조 변수 {n:id} {name:id} 는 findRoleRefs 로 따로 찾는다).
export function findVariables(text) {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
}

// 참조 변수 후보 {종류:값} 를 모두 찾는다(종류·값이 올바른지는 부르는 쪽이 본다). [{ raw, kind, id }]
export function findRoleRefs(text) {
  return [...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*):([^{}\s]*)\}/g)].map((m) => ({ raw: m[0], kind: m[1], id: m[2] }));
}

// 참조 하나를 값으로 바꾼다. 종류·형식·존재가 틀리면 오류.
export function resolveRoleRef(kind, id, roles) {
  if (!ROLE_REF_KINDS.includes(kind)) throw new Error(`허용되지 않는 변수: {${kind}:${id}} (참조 변수는 ${ROLE_REF_KINDS.map((k) => `{${k}:<id>}`).join(', ')} 만)`);
  if (!ID_PATTERN.test(id)) throw new Error(`참조 id 형식이 틀림: {${kind}:${id}}`);
  if (!Array.isArray(roles)) throw new Error(`역할 목록이 주어지지 않아 {${kind}:${id}} 를 풀 수 없음`);
  const target = roles.find((r) => r.meta && r.meta.id === id);
  if (!target) throw new Error(`없는 역할 id 를 참조함: {${kind}:${id}}`);
  return kind === 'n' ? target.meta.slot : target.meta.name;
}

// roleVars() 가 돌려주는 객체에 (열거되지 않는 값으로) 역할 목록을 같이 실어 둔다.
// 그래서 substitute(text, roleVars(...)) 처럼 예전 방식으로 불러도 {n:id} {name:id} 가 풀린다.
const ROLES_KEY = '__roles';

// 한 번만 훑어 치환(치환된 값 안의 중괄호는 다시 보지 않는다). 모르는 변수·빠진 값은 오류.
// roles(선택): 참조 변수 {n:id} {name:id} 를 풀 때 쓰는 역할 목록. 생략하면 vars 에 roleVars() 가 실어 둔 목록을 쓴다.
export function substitute(text, vars, roles = vars?.[ROLES_KEY]) {
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)(?::([^{}\s]*))?\}/g, (all, name, arg) => {
    if (arg !== undefined) return String(resolveRoleRef(name, arg, roles));
    if (!ALLOWED_VARS.includes(name)) throw new Error(`허용되지 않는 변수: {${name}}`);
    if (!(name in vars)) throw new Error(`값이 주어지지 않은 변수: {${name}}`);
    return String(vars[name]);
  });
}

// 머리말의 "역할 이름 목록": 켜진 worker 를 slot 순서로 "1 이름, 2 이름, ..."
export function buildRolesSummary(roles) {
  return roles
    .filter((r) => r.meta.kind === 'worker' && r.meta.enabled === true)
    .sort((a, b) => a.meta.slot - b.meta.slot)
    .map((r) => `${r.meta.slot} ${r.meta.name}`)
    .join(', ');
}

export function loadConfig(path) {
  const cfg = JSON.parse(normalizeNewlines(readFileSync(path, 'utf8')));
  for (const k of CONFIG_KEYS) {
    if (typeof cfg[k] !== 'string' || cfg[k] === '') throw new Error(`설정에 '${k}' 값이 없음`);
  }
  return cfg;
}

export function readHeaderTemplate(templatesDir) {
  return normalizeNewlines(readFileSync(join(templatesDir, 'card-header.md'), 'utf8')).replace(/\s+$/, '');
}

export function roleVars(role, roles, config) {
  const vars = {
    commander: config.commander,
    control_dir: config.control_dir,
    projects_root: config.projects_root,
    scope_prefix: config.scope_prefix,
    role_number: role.meta.slot,
    role_name: role.meta.name,
    roles_summary: buildRolesSummary(roles),
  };
  Object.defineProperty(vars, ROLES_KEY, { value: roles, enumerable: false });
  return vars;
}

export const renderHeader = (tpl, role, roles, config) => substitute(tpl, roleVars(role, roles, config));
export const renderBody = (role, roles, config) => substitute(role.body, roleVars(role, roles, config));

// ---------- 환경 규칙 층 (F-0 결정 D1): 이 PC 전용 규칙을 번들 밖 <ORCH_HOME>\config\env-rules.md 에 둔다 ----------
// 한 줄에 규칙 하나. 빈 줄과 '#' 로 시작하는 줄은 무시, 줄 앞의 '- ' 는 떼어 낸다.
// 규칙 글자는 변수 치환을 거치지 않고(중괄호도 그대로) 모든 카드 끝에 한 줄로 붙는다. 한 줄 300자, 20개까지.
export const ENV_RULES_TAG = ' [이 PC 전용 규칙] ';
export const ENV_RULES_MAX_LEN = 300;
export const ENV_RULES_MAX_COUNT = 20;
export function parseEnvRules(rawText) {
  const rules = [];
  const errors = [];
  normalizeNewlines(rawText).split('\n').forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const rule = line.replace(/^-\s+/, '');
    if (/[\u0000-\u001f\u007f]/.test(rule)) { errors.push(`${i + 1}째 줄에 제어 문자가 있음`); return; }
    if ([...rule].length > ENV_RULES_MAX_LEN) { errors.push(`${i + 1}째 줄이 ${ENV_RULES_MAX_LEN}자를 넘음`); return; }
    rules.push(rule);
  });
  if (rules.length > ENV_RULES_MAX_COUNT) errors.push(`규칙이 ${rules.length}개임(최대 ${ENV_RULES_MAX_COUNT}개)`);
  return { rules, errors };
}
export const appendEnvRules = (text, rules = []) => (rules.length ? `${text}${ENV_RULES_TAG}${rules.join(' / ')}` : text);

// 카드 = 머리말 + 공백 한 칸 + 본문 (원본이 "머리말 뒤에 이어 붙임") [+ 환경 규칙]
export const renderCard = (tpl, role, roles, config, envRules = []) =>
  appendEnvRules(`${renderHeader(tpl, role, roles, config)} ${renderBody(role, roles, config)}`, envRules);

// ---------- 아주 작은 JSON Schema 해석기 (필요한 키워드만) ----------
export function validateSchema(value, schema, path = '$') {
  const errs = [];
  const t = schema.type;
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
  if (t) {
    const ok = t === actual || (t === 'number' && actual === 'integer');
    if (!ok) return [`${path}: ${t} 이어야 하는데 ${actual}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(schema.enum)} 중 하나여야 함 (현재 ${JSON.stringify(value)})`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: 형식(${schema.pattern})에 맞지 않음 (현재 ${JSON.stringify(value)})`);
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${path}: 너무 짧음`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${path}: 너무 김`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: ${schema.minimum} 이상이어야 함`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: ${schema.maximum} 이하여야 함`);
  }
  if (Array.isArray(value)) {
    if (schema.uniqueItems && new Set(value).size !== value.length) errs.push(`${path}: 같은 항목이 두 번 있음`);
    if (schema.items) value.forEach((v, i) => errs.push(...validateSchema(v, schema.items, `${path}[${i}]`)));
  }
  if (actual === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${path}: 필수 항목 '${k}' 없음`);
    for (const [k, sub] of Object.entries(schema.properties ?? {})) if (k in value) errs.push(...validateSchema(value[k], sub, `${path}.${k}`));
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in (schema.properties ?? {}))) errs.push(`${path}: 정의에 없는 항목 '${k}'`);
    }
  }
  return errs;
}
