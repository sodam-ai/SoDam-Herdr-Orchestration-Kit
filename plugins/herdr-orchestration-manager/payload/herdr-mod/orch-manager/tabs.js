// tabs.js - 오케스트레이션 관리 모드의 탭별 화면. 상태·동작은 main.js 의 View(v)에 있고, 여기서는 그것을 "보여 주기만" 한다.
// 모든 탭이 ui.js 의 같은 부품(k)을 쓴다. 각 탭은 같은 순서로 상태를 다룬다: 불러오는 중 → 비어 있음 → 오류/안내 → 내용.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { keys } from "herdr";
import {
  MODES, CADENCES, MODE_LABEL, MODE_HINT, CADENCE_LABEL, CADENCE_HINT, SCOPE_LABEL, SCOPE_HINT, IMPORT_MODE_LABEL, IMPORT_MODE_HINT,
  statusRows, roleRows, buildRoleSetRequest, planHead, planRows, planNotes, backupRows, liveRows, clip, toneWord, summarizeLive, liveStatus,
  DEFAULT_KEY, composeKey, keyLabel, findKeyConflict, ownKeys, errorsText,
} from "./model.js";

const enabledDot = (k, on) => h_flex().gap(5).items_center().flex_none()
  .child(div().text_size(9).text_color(on === true ? k.t.ansi2 : k.t.muted).child("●"))
  .child(div().text_size(12).text_color(on === true ? k.t.foreground : k.t.muted).child(on === true ? "켜짐" : on === false ? "꺼짐" : "-"));

const body = (id, children, o = {}) => v_flex().id(id).flex_1().min_h(0).overflow_y_scrollbar().gap(16).when(!!o.max, (el) => el.max_w(o.max)).pr(8).pb(8).children(children);

// ================================================================ 현황
export function renderStatus(v, k) {
  const t = k.t;
  if (v.st === null) return k.loading(6);
  const rows = statusRows(v.st);
  const g = v.st && typeof v.st.generated === "object" && v.st.generated ? v.st.generated : {};
  const genBadge = g.state === "fresh" ? k.badge("생성물이 최신입니다", "ok") : g.state === "stale" ? k.badge("생성물을 다시 만들어야 합니다", "warn") : g.state === "none" ? k.badge("아직 만들지 않았습니다", "muted") : null;
  const table = k.card("현재 상태", "지금 설정과 역할을 점검한 결과입니다.", [
    v_flex().children(rows.map((r, i) =>
      h_flex().gap(12).min_h(36).items_center().when(i < rows.length - 1, (el) => el.border_b(1).border_color(t.border))
        .child(div().w(170).flex_none().text_size(12.5).text_color(t.muted).child(r.label))
        .child(div().flex_1().min_w(0).text_size(13).text_color(t.foreground).child(r.value))
        .child(r.tone && r.tone !== "" ? k.badge(toneWord(r.tone), r.tone) : div().w(0)))),
  ]);
  const action = k.card("생성물 갱신", "역할표·카드·배치 계획을 지금 설정으로 다시 만듭니다. 내 설정 폴더 밖의 파일은 바꾸지 않습니다.", [
    h_flex().gap(12).items_center()
      .child(k.btn("om-sync", "생성물 갱신 (sync 실행)", (_e, cx) => v.runSync(cx), { variant: "primary", disabled: v.acting, tip: v.acting ? "진행 중인 작업이 끝나면 누를 수 있습니다" : "" }))
      .when(!!genBadge, (el) => el.child(genBadge)),
  ]);
  return body("om-status", [action, table], { max: 900 });
}

// ================================================================ 역할 편집
function roleRow(v, k, x) {
  const t = k.t; const on = v.sel === x.id;
  return h_flex().id(`om-role-${x.id}`).h(46).px(10).gap(10).items_center().flex_none().rounded(7).cursor_pointer().tab_stop(true)
    .bg(on ? t.selected : "#00000000").hover((s) => (on ? s : s.bg(t.hover))).focus((s) => s.bg(t.hover))
    .on_click((_e, cx) => { v.showNew = false; v.selectRole(x.id); cx.notify(); })
    .child(div().w(22).flex_none().text_size(12).text_color(t.muted).child(x.slot === null ? "-" : String(x.slot)))
    .child(v_flex().flex_1().min_w(0).gap(1)
      .child(div().truncate().text_size(13).font_semibold().text_color(x.bad ? t.ansi1 : t.foreground).child(x.name))
      .child(div().truncate().text_size(11.5).text_color(t.muted).child(x.bad ? `${x.id} · 오류` : x.source === "bundle" ? x.id : `${x.id} · ${x.sourceWord}`)))
    .child(enabledDot(k, x.enabled));
}

function newRoleForm(v, k) {
  return k.card("새 역할 만들기", "새 역할은 내 설정에만 만들어지고, 만들기 직전에 자동 백업됩니다.", [
    k.field("id", k.input(v.inNewId), "영문 소문자로 시작, 소문자·숫자·하이픈 2~31자. 만든 뒤에는 바꿀 수 없습니다."),
    k.field("이름", k.input(v.inNewName), "화면에 보일 이름입니다. 비우면 id 를 씁니다."),
    k.field("시작 내용", k.seg("om-new-from", [{ value: "blank", label: "빈 역할로 시작" }, { value: "copy", label: v.sel ? `선택한 역할(${v.sel}) 복사` : "선택한 역할 복사" }], v.newFromSel ? "copy" : "blank", (val, cx) => { v.newFromSel = val === "copy" && !!v.sel; cx.notify(); }),
      "복사하면 선택한 역할의 설정과 지시문이 그대로 들어옵니다."),
    h_flex().gap(8).items_center().child(k.btn("om-new-ok", "만들기", (_e, cx) => v.createRole(cx), { variant: "primary", disabled: v.acting })).child(k.btn("om-new-cancel", "취소", (_e, cx) => { v.showNew = false; cx.notify(); }, { variant: "ghost" })),
  ], { grow: true });
}

function roleEditor(v, k, r, row) {
  const t = k.t;
  const b = buildRoleSetRequest(r, v.draft());
  const dirty = !(b.ok && b.empty);
  const isOverride = r.source === "override"; const isUser = r.source === "user";
  const head = h_flex().gap(10).items_center().justify_between()
    .child(v_flex().gap(2).min_w(0).child(div().truncate().text_size(15).font_semibold().text_color(t.foreground).child(String(r.meta.name || r.id))).child(div().text_size(12).text_color(t.muted).child(r.id)))
    .child(h_flex().gap(6).items_center().flex_none()
      .child(k.pill(row ? row.kindWord : "-")).child(k.pill(row ? row.sourceWord : "-"))
      .when(dirty, (el) => el.child(k.badge("저장하지 않은 변경", "warn"))));
  const fields = v_flex().id("om-editor-scroll").flex_1().min_h(0).overflow_y_scrollbar().gap(16).pr(8).pb(8)
    .when(isOverride && r.overridden.length > 0, (el) => el.child(k.note("번들 값에서 내가 바꾼 항목: " + r.overridden.join(", "))))
    .child(h_flex().gap(12).items_start().child(k.field("이름", k.input(v.inName))).child(k.field("자리", k.input(v.inSlot), null, { w: 90 })))
    .child(k.field("하는 일", k.area(v.inSum, 56), "이 역할이 맡은 일을 한두 문장으로. 비울 수 없습니다."))
    .child(k.field("보고 대상", k.input(v.inRep), "이 역할이 결과를 보고할 곳입니다(예: user, commander)."))
    .child(h_flex().gap(20).items_start().flex_wrap()
      .child(k.field("상태", k.seg("om-en", [{ value: "on", label: "켜짐" }, { value: "off", label: "꺼짐" }], v.dEnabled ? "on" : "off", (val, cx) => { v.dEnabled = val === "on"; cx.notify(); }), null, { w: 150 }))
      .child(k.field("모드", k.seg("om-mode", MODES.map((m) => ({ value: m, label: MODE_LABEL[m], tip: m })), v.dMode, (val, cx) => { v.dMode = val; cx.notify(); }), MODE_HINT[v.dMode] || "", { w: 330 }))
      .child(k.field("주기", k.seg("om-cad", CADENCES.map((m) => ({ value: m, label: CADENCE_LABEL[m], tip: m })), v.dCadence, (val, cx) => { v.dCadence = val; cx.notify(); }), CADENCE_HINT[v.dCadence] || "", { w: 260 })))
    .child(k.field("쓸 수 있는 곳", k.area(v.taWr, 76), "한 줄에 하나. 읽기 전용 모드면 비워 둡니다."))
    .child(k.field("지시문(본문)", k.area(v.taBody, 280), "이 역할 창이 읽는 글입니다. 저장한 뒤 현황 탭에서 [생성물 갱신]을 누르면 카드에 반영됩니다."));
  const bar = h_flex().gap(8).items_center().pt(12).border_t(1).border_color(t.border)
    .child(k.btn("om-save", "저장", (_e, cx) => v.saveRole(cx), { variant: "primary", disabled: !dirty || v.acting, tip: !dirty ? "바뀐 내용이 없습니다" : v.acting ? "진행 중인 작업이 끝나면 누를 수 있습니다" : "Ctrl+S" }))
    .when(dirty, (el) => el.child(k.btn("om-discard", "변경 취소", (_e, cx) => { v.selectRole(v.sel); cx.notify(); }, { variant: "ghost" })))
    .when(dirty && !b.ok, (el) => el.child(k.note(b.error, t.ansi1)))
    .child(div().flex_1().min_w(0))
    .child(k.btn("om-new", "새 역할 만들기…", (_e, cx) => { v.showNew = true; cx.notify(); }))
    .when(isOverride, (el) => el.child(k.btn("om-revert", v.confirm === "revert" ? "한 번 더 누르면 되돌립니다" : "번들 값으로 되돌리기", (_e, cx) => v.ask("revert", cx, () => v.revertRole(cx)), { variant: "danger" })))
    .when(isUser, (el) => el.child(k.btn("om-del", v.confirm === "del" ? "한 번 더 누르면 삭제합니다" : "내가 만든 역할 삭제", (_e, cx) => v.ask("del", cx, () => v.deleteRole(cx)), { variant: "danger" })));
  return v_flex().gap(14).p(16).flex_1().min_w(0).h_full().rounded(10).bg(t.raised).border_1().border_color(t.border).child(head).child(fields).child(bar);
}

export function renderRoles(v, k) {
  const t = k.t;
  if (v.st === null || v.rl === null) return k.loading(8);
  const rows = roleRows(v.st);
  if (rows.length === 0) return k.empty("역할을 찾지 못했습니다", "현황 탭에서 설정 문제를 먼저 확인하세요.");
  const list = v_flex().w(320).flex_none().h_full().rounded(10).bg(t.raised).border_1().border_color(t.border)
    .child(h_flex().h(40).px(14).items_center().justify_between().border_b(1).border_color(t.border)
      .child(k.title(`역할 ${rows.length}개`)).child(k.note(`켜짐 ${rows.filter((r) => r.enabled === true).length}`)))
    .child(v_flex().id("om-role-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(2).children(rows.map((x) => roleRow(v, k, x))));
  const r = v.roleOf(v.sel); const row = rows.find((x) => x.id === v.sel);
  const right = v.showNew ? newRoleForm(v, k) : !r ? k.empty("역할을 골라 주세요", "왼쪽 목록에서 역할을 고르면 여기서 고칠 수 있습니다.") : roleEditor(v, k, r, row);
  return h_flex().gap(16).flex_1().min_h(0).items_start().child(list).child(right);
}

// ================================================================ 미리보기 패널(불러오기·복구 공용)
const ACTION_SYM = { add: ["+", "ok"], change: ["~", "warn"], remove: ["−", "bad"], same: ["=", "muted"] };
export function planPanel(v, k, kind) {
  const t = k.t; const p = v.plan && v.plan.kind === kind ? v.plan : null;
  if (!p) return null;
  const d = p.data; const rows = planRows(d); const picked = rows.find((r) => r.key === p.pick);
  const lines = (s) => v_flex().gap(1).children(String(s || "").split("\n").slice(0, 150).map((l) => div().text_size(11.5).text_color(t.foreground).child(l === "" ? " " : clip(l, 160))));
  const pane = (id, name, text) => v_flex().flex_1().min_w(0).min_h(0).gap(4).child(k.label(name))
    .child(v_flex().id(id).h(150).p(8).rounded(7).bg(t.background).border_1().border_color(t.border).overflow_y_scrollbar().child(picked ? lines(text || "(없음)") : div().text_size(12).text_color(t.muted).child("위 목록에서 한 줄을 고르면 바뀌는 내용이 보입니다.")));
  return k.card(kind === "import" ? "불러오기 미리보기" : "복구 미리보기", planHead(d), [
    v_flex().gap(2).children(planNotes(d).slice(0, 6).map((l) => div().text_size(12).text_color(t.muted).child(l))),
    v_flex().gap(0).child(k.thead([{ label: "", w: 22 }, { label: "파일" }, { label: "역할", w: 150 }, { label: "켜짐 (전 → 후)", w: 130 }]))
      .child(v_flex().id(`om-plan-list-${kind}`).h(140).overflow_y_scrollbar().children(rows.map((r) => {
        const sym = ACTION_SYM[r.action] || ["?", "muted"]; const on = p.pick === r.key;
        return h_flex().id(`om-plan-${kind}-${r.key}`).h(28).gap(10).px(10).items_center().flex_none().cursor_pointer().tab_stop(true)
          .bg(on ? t.selected : "#00000000").hover((s) => (on ? s : s.bg(t.hover))).on_click((_e, cx) => { v.plan = { ...v.plan, pick: r.key }; cx.notify(); })
          .child(div().w(22).flex_none().text_size(13).font_bold().text_color(k.tone(sym[1])).tooltip(r.actionWord).child(sym[0]))
          .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(r.path))
          .child(div().w(150).flex_none().truncate().text_size(12).text_color(t.muted).child(r.roleText))
          .child(div().w(130).flex_none().truncate().text_size(12).text_color(t.muted).child(r.onText));
      }))),
    h_flex().gap(12).items_start().child(pane(`om-before-${kind}`, "지금(이 PC)", picked ? picked.before : "")).child(pane(`om-after-${kind}`, "적용 후", picked ? picked.after : "")),
    h_flex().gap(8).items_center()
      .child(d.noop ? k.note("바뀌는 것이 없습니다.") : k.btn(`om-apply-${kind}`, v.confirm === "apply" ? "한 번 더 누르면 적용합니다 (자동 백업 후)" : kind === "import" ? "불러오기 적용" : "이 백업으로 복구 적용", (_e, cx) => v.ask("apply", cx, () => v.applyPlan(cx)), { variant: "primary", disabled: v.acting }))
      .child(k.btn(`om-plan-close-${kind}`, "닫기", (_e, cx) => { v.plan = null; cx.notify(); }, { variant: "ghost" }))
      .when(!d.noop, (el) => el.child(k.note("적용 직전 현재 상태가 자동 백업되고, 문제가 생기면 자동으로 되돌립니다."))),
  ]);
}

// ================================================================ 내보내기 · 불러오기
export function renderShare(v, k) {
  const t = k.t;
  const exp = k.card("내보내기", "역할 구성을 폴더 하나(묶음)로 내보냅니다. 다른 PC로 옮기거나 보관할 때 씁니다.", [
    k.field("범위", k.seg("om-scope", ["portable", "full"].map((s) => ({ value: s, label: SCOPE_LABEL[s], tip: s })), v.scope, (val, cx) => { v.scope = val; cx.notify(); }), SCOPE_HINT[v.scope]),
    k.field("메모(선택)", k.input(v.inExpNote), "묶음에 함께 적히는 설명입니다."),
    h_flex().gap(12).items_center()
      .child(k.btn("om-export", "폴더 고르고 내보내기", (_e, cx) => v.doExport(cx), { variant: "primary", disabled: v.acting }))
      .child(k.note("고른 폴더 안에 새 폴더(orch-export-시각)를 만듭니다. 기존 폴더는 건드리지 않습니다.")),
  ]);
  const imp = k.card("불러오기", "다른 PC나 백업에서 가져옵니다. 적용하기 전에 항상 바뀔 내용을 먼저 보여 드립니다.", [
    k.field("1. 묶음 폴더", h_flex().gap(10).items_center().child(k.btn("om-pick", v.pkgDir ? "다른 폴더 고르기" : "폴더 고르기", (_e, cx) => v.pickPackage(cx))).child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(v.pkgDir ? t.foreground : t.muted).child(v.pkgDir || "아직 고르지 않았습니다"))),
    k.field("2. 방식", k.seg("om-impmode", ["merge", "replace"].map((m) => ({ value: m, label: IMPORT_MODE_LABEL[m], tip: m })), v.impMode, (val, cx) => { v.impMode = val; v.plan = null; cx.notify(); }), IMPORT_MODE_HINT[v.impMode]),
    k.field("3. 함께 받을 것", v_flex().gap(10)
      .child(k.check("om-inc-env", "환경 규칙", v.incEnv, (_e, cx) => { v.incEnv = !v.incEnv; v.plan = null; cx.notify(); }, "모든 카드 끝에 붙는 지시문입니다. 내가 만든 묶음일 때만 받으세요."))
      .child(k.check("om-inc-ign", "무시 목록(ignore)", v.incIgnore, (_e, cx) => { v.incIgnore = !v.incIgnore; v.plan = null; cx.notify(); }, "승인 대기 창을 가릴 수 있어, 내가 만든 묶음일 때만 받으세요."))
      .child(k.check("om-enable-imp", "불러온 역할을 켠 채로", v.enableImp, (_e, cx) => { v.enableImp = !v.enableImp; v.plan = null; cx.notify(); }, "꺼 두면 남의 묶음이어도 안전합니다. 기본은 꺼진 채로 들어옵니다."))),
    h_flex().gap(12).items_center()
      .child(k.btn("om-preview", "미리보기", (_e, cx) => v.previewImport(cx), { variant: "primary", disabled: !v.pkgDir || v.acting, tip: !v.pkgDir ? "먼저 묶음 폴더를 고르세요" : v.acting ? "진행 중인 작업이 끝나면 누를 수 있습니다" : "" }))
      .child(k.note("이 PC 고유 설정(경로 등)은 불러오기로 바뀌지 않습니다.")),
  ]);
  const plan = planPanel(v, k, "import");
  return body("om-share", plan ? [plan, exp, imp] : [exp, imp], { max: 900 });   // 미리보기가 있으면 맨 위에(아래에 있으면 스크롤해야 보임)
}

// ================================================================ 백업 · 복구
export function renderBackup(v, k) {
  const t = k.t;
  if (v.bk === null) return k.loading(5);
  const rows = backupRows(v.bk);
  const now = k.card("지금 백업", "내 설정을 바꾸기 직전에는 자동으로 백업이 만들어집니다. 직접 만들어 두고 싶을 때 쓰세요.", [
    h_flex().gap(10).items_center().child(k.input(v.inBkNote)).child(k.btn("om-backup", "지금 백업", (_e, cx) => v.backupNow(cx), { variant: "primary", disabled: v.acting, tip: v.acting ? "진행 중인 작업이 끝나면 누를 수 있습니다" : "" })),
  ]);
  const list = k.card(`백업 목록${rows.length ? ` (${rows.length}개)` : ""}`, "백업은 지워지지 않고 쌓입니다. 정리는 사용자가 직접 폴더에서 하세요.", [
    rows.length === 0
      ? k.empty("아직 백업이 없습니다", "처음 설정을 바꾸면 그 직전에 자동으로 만들어집니다. 위의 [지금 백업]으로 미리 만들어 둘 수도 있습니다.")
      : v_flex().child(k.thead([{ label: "시각", w: 190 }, { label: "종류", w: 80 }, { label: "메모" }, { label: "파일", w: 70 }]))
        .child(v_flex().id("om-backup-list").max_h(260).overflow_y_scrollbar().children(rows.map((x) => {
          const on = v.bkSel === x.dir;
          return h_flex().id(`om-bk-${x.key}`).h(36).gap(10).px(10).items_center().flex_none().cursor_pointer().tab_stop(true)
            .bg(on ? t.selected : "#00000000").hover((s) => (on ? s : s.bg(t.hover))).on_click((_e, cx) => { v.bkSel = x.dir; v.plan = null; cx.notify(); })
            .child(div().w(190).flex_none().text_size(12.5).text_color(t.foreground).child(x.at))
            .child(div().w(80).flex_none().text_size(12).text_color(t.muted).child(x.kind))
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(x.note))
            .child(div().w(70).flex_none().text_size(12).text_color(t.muted).child(`${x.files}개`));
        }))),
    rows.length === 0 ? div() : h_flex().gap(8).items_center().pt(4)
      .child(k.btn("om-restore-preview", "복구 미리보기", (_e, cx) => v.previewRestore(cx), { variant: "primary", disabled: !v.bkSel || v.acting, tip: !v.bkSel ? "목록에서 백업을 먼저 고르세요" : v.acting ? "진행 중인 작업이 끝나면 누를 수 있습니다" : "" }))
      .child(k.btn("om-open-backups", "백업 폴더 열기", (_e, cx) => v.openBackupFolder(cx), { disabled: !(v.bk && v.bk.ok && v.bk.dir), tip: "탐색기에서 백업 폴더를 엽니다" }))
      .child(k.note("복구는 \"교체\" 방식입니다. 백업에 없는 내 파일은 지워지고, 그 내용은 적용 직전 백업에 남습니다.")),
  ]);
  const plan = planPanel(v, k, "restore");
  return body("om-backup", plan ? [plan, now, list] : [now, list], { max: 900 });
}

// ================================================================ 실제 창(읽기 전용)
export function renderLive(v, k) {
  const t = k.t;
  if (v.lv === null) return k.loading(8);
  const view = liveRows(v.lv);
  if (!view.available) return k.empty("실제 창을 조회할 수 없습니다", view.note, k.btn("om-live-retry", "다시 조회", (_e, cx) => v.loadLive(cx)));
  const all = view.rows; const shown = v.liveFilter === "in" ? all.filter((x) => x.inScope === true) : all;
  const chips = summarizeLive(view.counts);
  const header = h_flex().gap(10).items_center().flex_wrap()
    .children(chips.map((c) => k.badge(c.label, c.tone)))
    .child(div().flex_1().min_w(0))
    .child(k.seg("om-live-filter", [{ value: "all", label: `전체 ${all.length}` }, { value: "in", label: `관리 대상 ${all.filter((x) => x.inScope === true).length}` }], v.liveFilter, (val, cx) => { v.liveFilter = val; cx.notify(); }));
  const table = v_flex().flex_1().min_h(0).rounded(10).bg(t.raised).border_1().border_color(t.border)
    .child(k.thead([{ label: "주소", w: 64 }, { label: "에이전트", w: 120 }, { label: "상태", w: 110 }, { label: "위치" }, { label: "범위", w: 90 }]))
    .child(shown.length === 0
      ? k.empty("보여 줄 창이 없습니다", v.liveFilter === "in" ? "관리 대상 공간에 열린 창이 없습니다. '전체'로 바꿔 보세요." : "허더에 열린 창이 없습니다.")
      : v_flex().id("om-live-list").flex_1().min_h(0).overflow_y_scrollbar().p(4).children(shown.map((x) => {
        const s = liveStatus(x.status);
        return h_flex().h(34).gap(10).px(8).items_center().flex_none().rounded(6)
          .child(div().w(64).flex_none().text_size(12.5).font_semibold().text_color(t.foreground).child(x.address))
          .child(div().w(120).flex_none().truncate().text_size(12.5).text_color(t.muted).child(x.agent))
          .child(div().w(110).flex_none().child(k.badge(s.word, s.tone)))
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(x.where))
          .child(div().w(90).flex_none().text_size(12).text_color(x.inScope === true ? t.foreground : t.muted).child(x.inScope === true ? "관리 대상" : x.inScope === false ? "범위 밖" : ""));
      })));
  return v_flex().gap(12).flex_1().min_h(0).child(header).child(k.note(`읽기 전용 조회입니다. 어느 창에도 아무것도 보내지 않습니다.${view.note ? " " + view.note : ""}`)).child(table);
}

// ================================================================ 단축키
export function renderKeys(v, k) {
  const t = k.t;
  const bindings = keys(); const cur = ownKeys(bindings);
  const built = composeKey(v.kMods, v.inKey.value());
  const conflict = built.ok ? findKeyConflict(bindings, built.key) : null;
  const already = built.ok && cur.some((c) => c.section === "global" && c.keys.toLowerCase() === built.key);
  const canApply = built.ok && !conflict && !already;
  const defaultFree = !findKeyConflict(bindings, DEFAULT_KEY) && !cur.some((c) => c.section === "global" && c.keys.toLowerCase() === DEFAULT_KEY);
  const verdict = !built.ok ? [built.error, "bad", "✘"] : conflict ? [`이미 쓰는 키입니다: ${conflict.section} 구역의 ${conflict.action}. 다른 키를 고르세요`, "bad", "✘"] : already ? ["이미 이 키로 연결되어 있습니다", "muted", "="] : ["비어 있는 키입니다. 바꿀 수 있습니다", "ok", "✔"];
  const rk = v.realKeys;
  const fileLine = rk && rk.ok ? `keys.json 확인됨 · ${rk.bytes.toLocaleString ? rk.bytes.toLocaleString() : rk.bytes}바이트${rk.own.length ? "" : " · 이 모드를 여는 키 없음"}` : rk ? `keys.json 을 읽지 못했습니다: ${clip(rk.msg || errorsText(rk), 100)}` : "keys.json 확인 중…";
  const mismatch = rk && rk.ok && (rk.own.length !== cur.length);
  const now = k.card("열기 단축키", "허더 화면에서 이 창을 여는 키입니다. 키 목록에 없으면 Ctrl+Shift+P → mod.open orch-manager 로 열 수 있습니다.", [
    cur.length ? h_flex().gap(14).items_center().flex_wrap().children(cur.map((c) => h_flex().gap(8).items_center().child(k.keycaps(c.keys, { h: 28, size: 13 })).child(k.note(c.section))))
      : div().text_size(13).text_color(t.muted).child("연결된 단축키가 없습니다"),
    k.note(fileLine),
    v.keyNote ? k.notice("warn", v.keyNote) : (mismatch ? k.notice("warn", "keys.json 과 허더가 인식하는 키가 다릅니다. 잠시 뒤 [새로고침]을 눌러 보세요.") : div()),
  ]);
  const change = k.card("다른 키로 바꾸기", "Ctrl, Alt, Shift 중 하나 이상과 키 하나를 고릅니다. 직접 눌러서 정하지 않는 이유: 누르는 순간 그 키의 기존 동작(새 탭 열기 등)이 실행될 수 있기 때문입니다.", [
    h_flex().gap(8).items_center().flex_wrap()
      .children([["ctrl", "Ctrl"], ["alt", "Alt"], ["shift", "Shift"]].map(([m, label]) => k.toggle(`om-km-${m}`, label, !!v.kMods[m], (_e, cx) => { v.kMods = { ...v.kMods, [m]: !v.kMods[m] }; v.confirm = ""; cx.notify(); })))
      .child(div().text_size(13).text_color(t.muted).child("+"))
      .child(div().w(150).flex_none().child(k.input(v.inKey)))
      .child(div().w(8))
      .child(built.ok ? k.keycaps(built.key, { h: 28, size: 13 }) : div().text_size(12.5).text_color(t.muted).child("키를 완성하세요")),
    h_flex().gap(8).items_start().child(div().w(14).flex_none().text_size(13).font_bold().text_color(k.tone(verdict[1])).child(verdict[2])).child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(verdict[0])),
    h_flex().gap(8).items_center().flex_wrap()
      .child(k.btn("om-key-apply", v.confirm === "key" ? `한 번 더 누르면 ${keyLabel(built.ok ? built.key : "")} 로 바꿉니다` : "이 키로 바꾸기", (_e, cx) => v.ask("key", cx, () => v.changeKey(built.key, cx)), { variant: "primary", disabled: !canApply || v.acting, tip: !built.ok ? "키를 완성하세요" : conflict ? "이미 쓰는 키입니다" : already ? "이미 이 키입니다" : v.acting ? "진행 중인 작업이 끝나면 누를 수 있습니다" : "" }))
      .child(k.btn("om-key-default", v.confirm === "keydef" ? `한 번 더 누르면 ${keyLabel(DEFAULT_KEY)} 로 되돌립니다` : `기본값(${keyLabel(DEFAULT_KEY)})으로`, (_e, cx) => v.ask("keydef", cx, () => v.changeKey(DEFAULT_KEY, cx)), { disabled: !defaultFree || (cur.length === 1 && cur[0].keys.toLowerCase() === DEFAULT_KEY) || v.acting, tip: !defaultFree ? "기본 키를 다른 곳에서 쓰고 있습니다" : "이미 기본 키입니다" }))
      .child(k.btn("om-key-off", v.confirm === "keyoff" ? "한 번 더 누르면 연결을 해제합니다" : "연결 해제", (_e, cx) => v.ask("keyoff", cx, () => v.changeKey(null, cx)), { variant: "danger", disabled: cur.length === 0 || v.acting, tip: cur.length === 0 ? "연결된 키가 없습니다" : "" })),
    v_flex().gap(3)
      .child(k.note("· 바꾸기 전에 keys.json 백업(keys.json.bak-orch-key-시각)을 만들고, 이 창을 여는 한 줄만 고칩니다."))
      .child(k.note("· 이미 다른 곳(터미널 구역 포함)에서 쓰는 키, Ctrl+글자(터미널 프로그램이 씀), Ctrl+Alt(AltGr), Shift만 쓴 글자는 고를 수 없습니다."))
      .child(k.note("· 허더는 저장 즉시 새 키를 반영합니다. 문제가 생겨도 Ctrl+Alt+Shift+Esc 는 항상 동작합니다.")),
  ]);
  const diag = k.card(null, null, [
    h_flex().id("om-diag-toggle").gap(8).items_center().cursor_pointer().tab_stop(true).on_click((_e, cx) => { v.showDiag = !v.showDiag; cx.notify(); })
      .child(div().w(12).text_size(11).text_color(t.muted).child(v.showDiag ? "▾" : "▸")).child(k.title("문제 해결")).child(k.note("바꿔도 반영이 안 될 때")),
    v.showDiag ? v_flex().gap(10)
      .child(k.note("허더의 파일 쓰기가 실제 디스크에 되는지 확인합니다(진단용 임시 파일 1개만 쓰고 지웁니다)."))
      .child(h_flex().gap(8).items_center().child(k.btn("om-probe", "저장 진단", (_e, cx) => v.runProbe(cx), { disabled: v.acting })))
      .when(v.probeLines.length > 0, (el) => el.child(v_flex().gap(3).p(10).rounded(7).bg(t.background).border_1().border_color(t.border).children(v.probeLines.map((l) => div().text_size(12).text_color(t.foreground).child(l)))))
      .when(!!(rk && rk.ok), (el) => el.child(k.note(`keys.json 확인값(해시): ${String(rk.sha256).slice(0, 12)}`))) : div(),
  ]);
  return body("om-keys", [now, change, diag], { max: 900 });
}
