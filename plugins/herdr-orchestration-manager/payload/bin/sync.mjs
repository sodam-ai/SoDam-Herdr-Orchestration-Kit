#!/usr/bin/env node
// sync: 역할 파일(roles/*.md) + 설정(orchestration.json) → 역할표, 카드, 탭 배치 계획을 만든다.
// 계획만 만든다. 창을 만들거나 hc 를 부르거나 어느 창에도 아무것도 보내지 않는다.
// 사용: node bin/sync.mjs [--config <json>] [--out <폴더>] [--roles-dir <폴더>] [--user-roles-dir <폴더>] [--templates-dir <폴더>] [--schema <파일>] [--env-rules <파일>]
//   --config 기본: <ORCH_HOME>\config\orchestration.json     --out 기본: <ORCH_HOME>\state\generated
//   --env-rules 기본: <ORCH_HOME>\config\env-rules.md (이 PC 전용 규칙. 기본 위치에 없으면 없는 대로 진행, --env-rules 로 직접 준 파일이 없으면 오류). 모든 카드 끝에 한 줄로 붙는다.
//   역할은 번들 roles/ + 내 역할 폴더(기본 <ORCH_HOME>\config\roles)를 한 로더(orch-lib.mjs loadAllRoles)로 읽는다. --roles-dir 만 주면 내 역할 폴더는 쓰지 않는다.
//   내 역할 파일이 하나라도 잘못되면 sync 는 멈춘다(출력은 그대로).
// 종료코드: 0 성공 / 1 역할 검증·배치 실패(출력은 건드리지 않음) / 2 사용법·설정 오류
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, resolve, sep, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, loadAllRoles, resolveRoleDirs, readHeaderTemplate, parseEnvRules, readUtf8Strict } from './orch-lib.mjs';
import { parseConfig, unsetKeys, buildOutputs, checkPlan, sha256 } from './sync-lib.mjs';
import { resolvePaths } from '../lib/orch-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OPTS = ['--config', '--out', '--roles-dir', '--user-roles-dir', '--templates-dir', '--schema', '--env-rules'];
const MANIFEST = 'sync-manifest.json';

function die(code, msg) { console.error(msg); process.exit(code); }

const args = process.argv.slice(2);
const given = {};
for (let i = 0; i < args.length; i++) {
  if (!OPTS.includes(args[i]) || i + 1 >= args.length) die(2, `오류: 알 수 없거나 값이 없는 옵션 '${args[i]}'\n사용: node bin/sync.mjs [${OPTS.map((o) => `${o} <값>`).join('] [')}]`);
  given[args[i]] = args[++i];
}
const paths = resolvePaths();   // 경로 규칙은 lib/orch-paths.mjs 한 곳 (폴더를 만들지 않음)
const configPath = given['--config'] ?? join(paths.config, 'orchestration.json');
const outDir = resolve(given['--out'] ?? join(paths.state, 'generated'));
const roleOpts = { rolesDir: given['--roles-dir'], userRolesDir: given['--user-roles-dir'] };   // 주지 않은 것은 undefined → 기본 규칙
const templatesDir = given['--templates-dir'] ?? join(ROOT, 'templates');
const schemaPath = given['--schema'] ?? join(ROOT, 'schema', 'role.schema.json');

// 1) 역할 검증: validate-roles 를 그대로 실행한다(규칙을 여기서 다시 쓰지 않는다)
const vArgs = [join(HERE, 'validate-roles.mjs'), '--templates-dir', templatesDir, '--schema', schemaPath];
if (given['--roles-dir'] !== undefined) vArgs.push('--roles-dir', given['--roles-dir']);
if (given['--user-roles-dir'] !== undefined) vArgs.push('--user-roles-dir', given['--user-roles-dir']);
const v = spawnSync(process.execPath, vArgs, { encoding: 'utf8' });
if (v.status !== 0) die(1, `sync 중단: 역할 검증 실패 (출력은 바꾸지 않았음)\n${(v.stderr || v.stdout || '').trimEnd()}`);

// 2) 설정
if (!existsSync(configPath)) die(2, `오류: 설정 파일이 없음: ${configPath}\n(install 을 먼저 실행하거나 --config 로 알려 주세요)`);
let cfgText;
try { cfgText = readUtf8Strict(configPath); } catch (e) { die(2, `오류: 설정 파일을 읽을 수 없음 (${configPath}): ${e.message}`); }
const { config, errors: cfgErrors } = parseConfig(cfgText);
if (!config) die(2, `오류: 설정 점검 실패 (${configPath})\n${cfgErrors.map((e) => `  - ${e}`).join('\n')}`);

// 2-1) 환경 규칙(이 PC 전용). 직접 준 파일이 없으면 오류, 기본 위치에 없으면 규칙 0개로 진행
const envRulesPath = given['--env-rules'] ?? join(paths.config, 'env-rules.md');
let envRules = [];
if (existsSync(envRulesPath)) {
  let rulesText;
  try {
    if (!statSync(envRulesPath).isFile()) die(2, `오류: 환경 규칙이 파일이 아님: ${envRulesPath}`);
    rulesText = readUtf8Strict(envRulesPath);   // UTF-8 이 아니면 깨진 글자가 모든 카드에 들어가므로 멈춘다
  } catch (e) { die(2, `오류: 환경 규칙 파일을 읽을 수 없음 (${envRulesPath}): ${e.message}`); }
  const parsed = parseEnvRules(rulesText);
  if (parsed.errors.length) die(2, `오류: 환경 규칙 점검 실패 (${envRulesPath})\n${parsed.errors.map((e) => `  - ${e}`).join('\n')}`);
  envRules = parsed.rules;
} else if (given['--env-rules'] !== undefined) die(2, `오류: 환경 규칙 파일이 없음: ${envRulesPath}`);

// 3) 생성물 계산 (파일에 쓰기 전에 모든 문제를 먼저 찾는다)
let roles, built;
try {
  roles = loadAllRoles(roleOpts);
  built = buildOutputs(roles, config, readHeaderTemplate(templatesDir), envRules);
} catch (e) { die(1, `sync 중단: ${e.message}`); }
const planErrors = checkPlan(built.plan, roles);
if (planErrors.length) die(1, `sync 중단: 배치 문제 (출력은 바꾸지 않았음)\n${planErrors.map((e) => `  - ${e}`).join('\n')}`);

// 4) 쓰기. 같은 내용이면 건드리지 않는다. 지난번에 만들었는데 이번에 없는 파일(꺼진 역할의 카드 등)은 파일 하나씩만 지운다.
const safeRel = (rel) => typeof rel === 'string' && rel !== '' && !isAbsolute(rel) && !rel.split(/[\\/]/).includes('..');
const manifestPath = join(outDir, MANIFEST);
let prev = [];
if (existsSync(manifestPath)) {
  try { prev = (JSON.parse(readFileSync(manifestPath, 'utf8')).files ?? []).map((f) => f.path); } catch { prev = []; }
}
if (existsSync(outDir) && !statSync(outDir).isDirectory()) die(2, `오류: --out 이 폴더가 아님: ${outDir}`);
let wrote = 0, removed = 0;
const listing = [];
try {
  mkdirSync(join(outDir, 'cards'), { recursive: true });
  for (const [rel, text] of built.files) {
    const full = join(outDir, ...rel.split('/'));
    const bytes = Buffer.from(text, 'utf8');
    if (!(existsSync(full) && readFileSync(full).equals(bytes))) { writeFileSync(full, bytes); wrote++; }
    listing.push({ path: rel, sha256: sha256(bytes) });
  }
  for (const old of prev) {
    if (built.files.has(old) || !safeRel(old)) continue;
    const full = resolve(outDir, ...old.split('/'));
    if (!full.startsWith(outDir + sep)) continue;
    if (existsSync(full)) { unlinkSync(full); removed++; }
  }
  writeFileSync(manifestPath, JSON.stringify({ generated_by: 'sync', files: listing }, null, 2) + '\n');
} catch (e) {
  // 권한·디스크·경로 문제 등. 스택 트레이스 대신 안내만 하고, 일부 파일만 쓰였을 수 있으니 고친 뒤 다시 실행하게 한다(같은 내용 파일은 건드리지 않으므로 다시 실행해도 안전).
  die(1, `sync 중단: 출력 폴더에 쓰지 못함 (${outDir})\n  ${e.code ?? ''} ${e.message}\n  일부 파일만 쓰였을 수 있습니다. 원인을 해결한 뒤 sync 를 다시 실행하세요.`);
}

// 5) 보고
const on = roles.filter((r) => r.meta.enabled).length;
const cards = [...built.files.keys()].filter((k) => k.startsWith('cards/')).length;
console.log(`sync 완료: 역할 ${roles.length}개 (켜짐 ${on}, 꺼짐 ${roles.length - on}) → 역할표 1, 카드 ${cards}, 탭 ${built.plan.tabs.length}개 계획`);
console.log(`  출력: ${outDir}  (바뀐 파일 ${wrote}, 지운 옛 파일 ${removed})`);
if (envRules.length) console.log(`  이 PC 전용 규칙: ${envRules.length}개 (${envRulesPath})`);
const mineDir = resolveRoleDirs(roleOpts).user;
const nOver = roles.filter((r) => r.source === 'override').length, nNew = roles.filter((r) => r.source === 'user').length;
if (mineDir && (nOver || nNew)) console.log(`  내 역할 폴더: ${mineDir}  (번들 덮어쓰기 ${nOver}개, 새 역할 ${nNew}개)`);
const unset = unsetKeys(config);
if (unset.length) console.error(`경고: 설정 ${unset.map((k) => `'${k}'`).join(', ')} 이(가) 아직 '${config[unset[0]]}' 입니다. 카드에 그대로 들어가고 해당 범위의 창은 하나도 잡히지 않습니다. ${configPath} 에서 고치세요.`);
