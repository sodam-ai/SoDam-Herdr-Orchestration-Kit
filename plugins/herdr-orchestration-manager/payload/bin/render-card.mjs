#!/usr/bin/env node
// worker 역할의 카드(머리말 틀 + 본문)를 변수 치환해 stdout 으로 출력한다.
// 사용: node bin/render-card.mjs <id> --config <json> [--roles-dir <폴더>] [--user-roles-dir <폴더>] [--templates-dir <폴더>]
//   역할은 validate-roles·sync 와 같은 로더(orch-lib.mjs loadAllRoles)로 읽는다: 번들 roles/ + 내 역할 폴더(기본 <ORCH_HOME>/config/roles).
//   --roles-dir 만 주면 내 역할 폴더는 쓰지 않는다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadAllRoles, loadConfig, readHeaderTemplate, renderCard, validateSchema } from './orch-lib.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const id = args[0] && !args[0].startsWith('--') ? args[0] : undefined;
const configPath = opt('--config');
const templatesDir = opt('--templates-dir', join(ROOT, 'templates'));

function die(msg) { console.error(`오류: ${msg}`); process.exit(2); }

if (!id || !configPath) die('사용법: node bin/render-card.mjs <id> --config <json>');
try {
  const roles = loadAllRoles({ rolesDir: opt('--roles-dir'), userRolesDir: opt('--user-roles-dir') });
  const schema = JSON.parse(readFileSync(opt('--schema', join(ROOT, 'schema', 'role.schema.json')), 'utf8'));
  const broken = roles.map((r) => ({ r, errs: r.errors.length ? r.errors : validateSchema(r.meta, schema) })).filter((x) => x.errs.length);
  if (broken.length) die(`역할 파일에 오류가 있어 카드를 만들지 않음 (먼저 validate-roles 로 확인하세요)\n${broken.map((x) => `  - ${x.r.label ?? x.r.file}: ${x.errs[0]}`).join('\n')}`);
  const role = roles.find((r) => r.meta.id === id);
  if (!role) die(`역할 '${id}' 를 찾을 수 없음`);
  if (role.meta.kind !== 'worker') die(`'${id}' 는 worker 가 아니라 카드가 없음 (kind: ${role.meta.kind})`);
  const card = renderCard(readHeaderTemplate(templatesDir), role, roles, loadConfig(configPath));
  process.stdout.write(card + '\n');
} catch (e) {
  die(e.message);
}
