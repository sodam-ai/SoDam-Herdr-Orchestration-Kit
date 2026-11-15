// sync / init-config 가 함께 쓰는 공용 함수. Node 18+, 외부 패키지 없음.
// 역할 파일 읽기·변수 치환·카드 렌더링은 bin/orch-lib.mjs 의 것을 그대로 가져다 쓴다(여기서 다시 만들지 않는다).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  normalizeNewlines, renderCard, renderBody, roleVars, substitute, appendEnvRules,
} from './orch-lib.mjs';

// 설정에서 사용자가 아직 정하지 않은 값. 카드에 그대로 들어가므로 눈에 띄고,
// "이 글자로 시작하는 창" 은 없으므로 범위가 비는 쪽(안전한 쪽)으로 실패한다(설계서 3장 원칙 5, 6장 허용 목록 우선).
export const PLACEHOLDER = '(미설정)';
export const LABEL_FORMAT_VERSION = 1;          // 라벨 orch.v (설계서 9-1 채택안)
export const CONFIG_VERSION = 1;
export const NAME_PATTERN = /^[a-z0-9_-]{1,32}$/; // hc --name 형식 (설계서 9-1)
const KIND_ORDER = ['commander', 'proxy', 'worker'];
// 자리 묶음(설계서 5-6): 번호는 고정, 그 자리에 앉는 역할만 바뀐다. 마지막 묶음 뒤의 자리는 slots_per_tab 개씩 묶는다.
export const DEFAULT_TAB_GROUPS = [[1, 4], [5, 8], [9, 10]];

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// 경로 규칙(ORCH_HOME 등)은 lib/orch-paths.mjs 한 곳에만 있다(폴더를 만들지 않는 순수 함수). 여기서 다시 만들지 않는다.

// ---------- 기본 설정 (install 이 처음 한 번만 만든다) ----------
// functions: 위험(high) 기능과 부분 기능은 전부 false. 나머지는 function.json 의 default 가 on 일 때만 true.
export function defaultFunctions(functionsDir) {
  const out = {};
  const dirs = readdirSync(functionsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const d of dirs) {
    const f = join(functionsDir, d, 'function.json');
    if (!existsSync(f)) continue;
    const fn = JSON.parse(normalizeNewlines(readFileSync(f, 'utf8')));
    const on = (x) => x.risk !== 'high' && x.default === 'on';
    out[fn.id] = on(fn);
    for (const p of fn.parts ?? []) out[`${fn.id}.${p.id}`] = on(p);
  }
  return out;
}

export function defaultConfig({ orchHome, functionsDir }) {
  return {
    version: CONFIG_VERSION,
    scope_prefix: PLACEHOLDER,
    projects_root: PLACEHOLDER,
    control_dir: join(orchHome, 'control'),
    commander_name: 'orch-commander',
    // 탭 배치 (설계서 5-5, 5-6): 총지휘·승인 대행은 "<접두어>-<master_suffix>" 탭. worker 는 **자리(slot) 번호 범위**로 탭이 정해진다:
    // tab_groups(기본 [1-4] [5-8] [9-10]) 안의 자리는 그 범위 이름("<접두어>-1,2,3,4"), 그 뒤 새 자리는 slots_per_tab(4)개씩("<접두어>-11,12,13,14").
    // 켜진 역할이 아니라 자리 번호로만 정해지므로 역할을 끄거나 바꿔도 탭 이름은 변하지 않는다.
    layout: { tab_prefix: 'CT-CC', master_suffix: 'Master', tab_groups: DEFAULT_TAB_GROUPS.map((g) => [...g]), slots_per_tab: 4 },
    functions: defaultFunctions(functionsDir),
  };
}

// ---------- 설정 읽기·점검 ----------
export function parseConfig(text) {
  const errors = [];
  let cfg;
  try { cfg = JSON.parse(normalizeNewlines(text)); } catch (e) { return { config: null, errors: [`설정이 올바른 JSON 이 아님: ${e.message}`] }; }
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) return { config: null, errors: ['설정 최상위가 객체가 아님'] };
  for (const k of ['scope_prefix', 'projects_root', 'control_dir']) {
    if (typeof cfg[k] !== 'string' || cfg[k] === '') errors.push(`설정에 '${k}' 값이 없음`);
  }
  if (typeof cfg.commander_name !== 'string' || !NAME_PATTERN.test(cfg.commander_name)) {
    errors.push(`설정 'commander_name' 은 소문자·숫자·-·_ 1~32자여야 함 (현재 ${JSON.stringify(cfg.commander_name)})`);
  }
  const l = cfg.layout;
  if (l === null || typeof l !== 'object' || Array.isArray(l)) errors.push("설정에 'layout' 객체가 없음");
  else {
    for (const k of ['tab_prefix', 'master_suffix']) if (typeof l[k] !== 'string' || l[k] === '') errors.push(`설정 layout.${k} 값이 없음`);
    if (!Number.isInteger(l.slots_per_tab) || l.slots_per_tab < 1 || l.slots_per_tab > 20) errors.push('설정 layout.slots_per_tab 은 1~20 정수여야 함');
    if (l.tab_groups !== undefined) {
      const g = l.tab_groups;
      let okGroups = Array.isArray(g) && g.length > 0;
      let prevEnd = 0;
      if (okGroups) for (const x of g) {
        if (!Array.isArray(x) || x.length !== 2 || !Number.isInteger(x[0]) || !Number.isInteger(x[1]) || x[0] !== prevEnd + 1 || x[1] < x[0] || x[1] > 99) { okGroups = false; break; }
        prevEnd = x[1];
      }
      if (!okGroups) errors.push('설정 layout.tab_groups 는 [[시작,끝], ...] 이고 1번부터 빈틈·겹침 없이 이어지는 1~99 정수 범위여야 함 (예: [[1,4],[5,8],[9,10]])');
    }
  }
  if (cfg.functions === null || typeof cfg.functions !== 'object' || Array.isArray(cfg.functions)) errors.push("설정에 'functions' 객체가 없음");
  else for (const [k, v] of Object.entries(cfg.functions)) if (typeof v !== 'boolean') errors.push(`설정 functions.${k} 는 true/false 여야 함`);
  return { config: errors.length ? null : cfg, errors };
}

// 사용자가 아직 정하지 않은 설정 이름들 (경고용)
export const unsetKeys = (cfg) => ['scope_prefix', 'projects_root'].filter((k) => cfg[k] === PLACEHOLDER);

// orch-lib 의 변수 치환이 기대하는 모양으로 바꾼다. {commander} = 총지휘 창 이름(hc send 로 보고할 때 쓰는 이름)
export const toVarsConfig = (cfg) => ({
  commander: cfg.commander_name,
  control_dir: cfg.control_dir,
  projects_root: cfg.projects_root,
  scope_prefix: cfg.scope_prefix,
});

// ---------- 정렬·표 ----------
const kindRank = (k) => KIND_ORDER.indexOf(k);
export const sortRoles = (roles) => [...roles].sort((a, b) =>
  kindRank(a.meta.kind) - kindRank(b.meta.kind) || a.meta.slot - b.meta.slot || a.meta.id.localeCompare(b.meta.id));

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function renderRoleTable(roles, vcfg, envRules = []) {
  const on = sortRoles(roles.filter((r) => r.meta.enabled));
  const off = sortRoles(roles.filter((r) => !r.meta.enabled));
  const L = [];
  L.push('> **자동 생성 — 수정 금지.** 이 파일은 `sync` 가 역할 파일(`roles/*.md`)과 설정(`orchestration.json`)에서 만들었습니다.');
  L.push('> 바꾸려면 역할 파일이나 설정을 고치고 `sync` 를 다시 실행하세요. 직접 고치면 다음 `sync` 때 사라집니다.');
  L.push('');
  L.push('# 오케스트레이션 역할표');
  L.push('');
  L.push(`## 켜진 역할 (${on.length}개)`);
  L.push('');
  L.push('| slot | id | 이름 | 하는 일 | kind | mode | 쓸 수 있는 곳 | 보고 대상 |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const r of on) {
    const m = r.meta;
    const writes = m.writes_to.length ? m.writes_to.map((w) => `\`${substitute(w, roleVars(r, roles, vcfg))}\``).join(', ') : '-';
    L.push(`| ${m.slot} | ${cell(m.id)} | ${cell(m.name)} | ${cell(m.summary ?? '-')} | ${m.kind} | ${m.mode} | ${cell(writes)} | ${cell(m.reports_to)} |`);
  }
  L.push('');
  L.push(`## 꺼진 역할 (${off.length}개)`);
  L.push('');
  if (off.length === 0) L.push('없음');
  else {
    L.push('| slot | id | 이름 | kind |');
    L.push('|---|---|---|---|');
    for (const r of off) L.push(`| ${r.meta.slot} | ${cell(r.meta.id)} | ${cell(r.meta.name)} | ${r.meta.kind} |`);
    L.push('');
    L.push('꺼진 역할은 카드와 탭 배치 계획에서 빠집니다. 파일은 지우지 않았습니다. 열려 있는 창은 사용자가 닫습니다.');
  }
  L.push('');
  L.push('## 옛 이름 → 새 id (`replaces`)');
  L.push('');
  const map = [];
  for (const r of roles) for (const old of r.meta.replaces) map.push({ old, r });
  map.sort((a, b) => a.old.localeCompare(b.old, 'en', { numeric: true }));
  if (map.length === 0) L.push('없음');
  else {
    L.push('| 옛 이름 | 새 id | 상태 |');
    L.push('|---|---|---|');
    for (const { old, r } of map) L.push(`| ${cell(old)} | ${cell(r.meta.id)} | ${r.meta.enabled ? '켜짐' : '꺼짐'} |`);
  }
  L.push('');
  if (envRules.length) {
    L.push(`## 이 PC 전용 규칙 (${envRules.length}개)`);
    L.push('');
    L.push('모든 카드 끝에 한 줄로 붙습니다. 바꾸려면 설정 폴더의 `env-rules.md` 를 고치고 `sync` 를 다시 실행하세요.');
    L.push('');
    envRules.forEach((rule, i) => L.push(`${i + 1}. ${rule}`));
    L.push('');
  }
  return L.join('\n');
}

// ---------- 탭 배치 계획 (계획만. 창을 만들거나 hc 를 부르지 않는다) ----------
// 자리 번호 → 그 자리가 속한 범위 [시작, 끝]. 켜진/꺼진 역할과 무관하게 자리 번호와 설정(tab_groups, slots_per_tab)만으로 정해진다.
export function seatRange(slot, lay) {
  const groups = lay.tab_groups ?? DEFAULT_TAB_GROUPS;
  for (const [from, to] of groups) if (slot >= from && slot <= to) return [from, to];
  const lastEnd = groups[groups.length - 1][1];
  const from = lastEnd + 1 + Math.floor((slot - lastEnd - 1) / lay.slots_per_tab) * lay.slots_per_tab;
  return [from, from + lay.slots_per_tab - 1];
}

export function buildLayoutPlan(roles, cfg) {
  const lay = cfg.layout;
  const entryOf = (r) => {
    const m = r.meta;
    return {
      id: m.id,
      display_name: m.name,
      kind: m.kind,
      slot: m.slot,
      // 총지휘는 설정의 commander_name 으로 부른다(카드의 {commander} 와 같은 글자여야 하므로)
      hc_name: m.kind === 'commander' ? cfg.commander_name : `orch-${m.id}`,
      labels: { 'orch.role': m.id, 'orch.slot': String(m.slot), 'orch.v': String(LABEL_FORMAT_VERSION) },
    };
  };
  const enabled = sortRoles(roles.filter((r) => r.meta.enabled));
  const tabs = [];
  const master = enabled.filter((r) => r.meta.kind !== 'worker');
  if (master.length) tabs.push({ name: `${lay.tab_prefix}-${lay.master_suffix}`, seats: [0], roles: master.map(entryOf) });
  // worker: 탭은 자리 번호 범위로만 정한다(seatRange). 켜진 역할이 하나도 없는 범위는 계획에서 빠질 뿐, 다른 탭의 이름은 그대로다.
  const chunks = new Map();   // 범위 시작 자리 → { range, roles }
  for (const r of enabled.filter((x) => x.meta.kind === 'worker')) {
    const range = seatRange(r.meta.slot, lay);
    if (!chunks.has(range[0])) chunks.set(range[0], { range, roles: [] });
    chunks.get(range[0]).roles.push(r);
  }
  for (const from of [...chunks.keys()].sort((a, b) => a - b)) {
    const { range, roles: rs } = chunks.get(from);
    const seats = Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i);
    tabs.push({ name: `${lay.tab_prefix}-${seats.join(',')}`, seats, roles: rs.map(entryOf) });
  }
  const disabled = sortRoles(roles.filter((r) => !r.meta.enabled)).map((r) => ({ id: r.meta.id, slot: r.meta.slot, kind: r.meta.kind }));
  return { format: 1, label_format: LABEL_FORMAT_VERSION, commander_name: cfg.commander_name, tabs, disabled };
}

// validate-roles 가 보지 않는, 배치에서만 생기는 문제 (창 이름 겹침, 총지휘 부재·중복)
export function checkPlan(plan, roles) {
  const errs = [];
  const seen = new Map();
  for (const t of plan.tabs) for (const e of t.roles) {
    if (!NAME_PATTERN.test(e.hc_name)) errs.push(`창 이름 '${e.hc_name}' 이 형식(소문자·숫자·-·_ 1~32자)에 맞지 않음`);
    if (seen.has(e.hc_name)) errs.push(`창 이름 '${e.hc_name}' 이 ${seen.get(e.hc_name)} 와 겹침`);
    else seen.set(e.hc_name, e.id);
  }
  const cmds = roles.filter((r) => r.meta.kind === 'commander' && r.meta.enabled);
  if (cmds.length === 0) errs.push('켜진 총지휘(kind: commander) 역할이 없음');
  if (cmds.length > 1) errs.push(`켜진 총지휘가 ${cmds.length}개임 (${cmds.map((r) => r.meta.id).join(', ')})`);
  return errs;
}

// ---------- 생성물 전부 (경로 → 내용). 시각 같은 흔들리는 값은 넣지 않아 같은 입력이면 같은 바이트가 나온다 ----------
export function buildOutputs(roles, cfg, headerTpl, envRules = []) {
  const vcfg = toVarsConfig(cfg);
  const plan = buildLayoutPlan(roles, cfg);
  const files = new Map();
  files.set('역할표.md', renderRoleTable(roles, vcfg, envRules));
  files.set('layout-plan.json', JSON.stringify(plan, null, 2) + '\n');
  for (const r of sortRoles(roles.filter((x) => x.meta.enabled))) {
    // worker 는 머리말 틀 + 본문, commander·proxy 는 머리말 틀 없이 본문만 (render-card.mjs 와 같은 함수)
    const text = r.meta.kind === 'worker' ? renderCard(headerTpl, r, roles, vcfg, envRules) : appendEnvRules(renderBody(r, roles, vcfg), envRules);
    files.set(`cards/${r.meta.id}.md`, text + '\n');
  }
  return { files, plan };
}
