// orch-manager (오케스트레이션 관리) - Herdr 안에서 역할을 보고·고치고, 내보내기·불러오기·백업·복구를 하고, 실제 창을 조회하는 창.
// (세션키퍼와 같은 방식의 Herdr 모드. 허더 밖의 별도 Windows 창 bin/orch-manager.ps1 과 같은 엔진을 쓴다.)
//
// 여는 법: 설치 프로그램이 키를 연결해 주면 그 키, 또는 명령 팔레트(Ctrl+Shift+P)에서 "mod.open orch-manager".
// 이 모드는 파일을 직접 고치지 않고 어느 창에도 아무것도 보내지 않는다. 모든 일은 엔진(manage.mjs)이 한다:
//   - 바꾸기 전에 후보를 검증하고, 자동 백업하고, 실패하면 되돌린다(번들은 절대 바꾸지 않고 "내 설정"에만 쓴다).
//   - 불러오기·복구는 미리보기를 먼저 보여 주고, 적용은 두 번 눌러야 한다.
//   - 실제 창 탭은 읽기 전용 조회다.
// 엔진은 표준입력을 줄 수 없는 exec 로 부르므로, 요청 값은 파일로 넘기고(--request-file) 조회는 입력 없이(--no-input) 부른다.
// 데이터를 다루는 순수 로직(행 만들기·요청 만들기·글자 정리)은 ./model.js 에 있고 tests/mod-model.test.mjs 에서 시험한다.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, TextareaState } from "gpui-base";
import { exec, home, appHome, theme, notify, props, closeOverlay, keys, pickFolder, readTextFile, writeTextFile } from "herdr";
import { parseResult, errorsText, roleRows, buildRoleSetRequest, buildRoleNewRequest, requestText, clip, ownKeys, tabBadges } from "./model.js";
import { makeUi } from "./ui.js";
import { renderStatus, renderRoles, renderShare, renderBackup, renderLive, renderKeys } from "./tabs.js";
const NODE = "node";
const TOOL = "manage.mjs";   // 설치 때 install.ps1 이 절대 경로로 바꾼다
const KEYS_TOOL = TOOL.replace(/manage\.mjs$/, "herdr-keys.mjs");   // 단축키는 이 도구(node)가 실제 디스크에 쓴다
const LIVE_MS = 15000;
const TABS = [["status", "현황"], ["roles", "역할 편집"], ["share", "내보내기 · 불러오기"], ["backup", "백업 · 복구"], ["live", "실제 창"], ["keys", "단축키"]];

export default class OrchManager extends View {
  init(_props, cx) {
    this.tab = "status";
    this.st = null;            // status 응답
    this.rl = null;            // role-list 응답(본문까지)
    this.bk = null;            // backup-list 응답
    this.lv = null;            // live-windows 응답
    this.sel = "";             // 선택한 역할 id
    this.dEnabled = true; this.dMode = "read-only"; this.dCadence = "on-request";
    this.showNew = false; this.newFromSel = false;
    this.scope = "portable";
    this.pkgDir = ""; this.impMode = "merge"; this.incEnv = false; this.incIgnore = false; this.enableImp = false;
    this.plan = null;          // { kind: "import" | "restore", data, args, pick }
    this.bkSel = "";
    this.confirm = ""; this.acting = false; this.status = "불러오는 중…";
    this.q = Promise.resolve();
    this.reqPath = home().replace(/\\/g, "/") + "/AppData/Local/Temp/herdr-orch-manager-request.json";
    this.handle = cx.focus_handle();

    this.inName = InputState.new({ placeholder: "이름" });
    this.inSum = TextareaState.new({ placeholder: "하는 일 (비울 수 없음)", rows: 2 });
    this.inSlot = InputState.new({ placeholder: "0" });
    this.inRep = InputState.new({ placeholder: "보고 대상 (예: user, commander)" });
    this.taWr = TextareaState.new({ placeholder: "쓸 수 있는 곳 (한 줄에 하나, 읽기 전용 모드면 비움)", rows: 3 });
    this.taBody = TextareaState.new({ placeholder: "지시문(본문)", rows: 10 });
    this.inNewId = InputState.new({ placeholder: "새 역할 id (영문 소문자·숫자·하이픈, 2~31자)" });
    this.inNewName = InputState.new({ placeholder: "이름 (비우면 id)" });
    this.inExpNote = InputState.new({ placeholder: "메모 (선택)" });
    this.inBkNote = InputState.new({ placeholder: "메모 (선택)" });
    this.kMods = { ctrl: true, alt: false, shift: true };   // 단축키 탭: 조합 키 버튼 상태(기본 Ctrl+Shift+M 을 만들 수 있게)
    this.inKey = InputState.new({ placeholder: "키 (예: m, 1, f5, left)", value: "m" });
    this.inKey.on("change", (_e, cx) => cx.notify());
    this.realKeys = null;     // herdr-keys status 응답(실제 디스크의 keys.json 상태)
    this.keyNote = "";        // 바꾼 뒤 허더가 새 키를 반영했는지 확인한 결과
    this.probeLines = [];     // 진단 결과
    this.showDiag = false;    // 단축키 탭의 "문제 해결" 펼침
    this.liveFilter = "all";  // 실제 창 탭 필터: all | in(관리 대상만)

    this.reloadAll(cx);
    cx.timer.every(LIVE_MS, (cx) => { if (this.tab === "live" && !this.acting) this.loadLive(cx); });
  }

  dismiss() { closeOverlay(props().overlay); }

  // ---------------------------------------------------------------- 엔진 호출(한 번에 하나씩 줄 세워 같은 요청 파일을 겹쳐 쓰지 않는다)
  call(cmd, req) {
    const run = async () => {
      try {
        const args = [TOOL, cmd];
        if (req === null) args.push("--no-input");
        else {
          const text = requestText(req);
          if (text === null) return { ok: false, errors: ["요청이 너무 큽니다"] };
          const cur = await readTextFile(this.reqPath);
          await writeTextFile(this.reqPath, text, cur);
          args.push("--request-file", this.reqPath);
        }
        const r = await exec(NODE, args, { timeout: 150000 });
        return parseResult(r.stdout, r.stderr);
      } catch (e) {
        return { ok: false, errors: ["엔진을 실행하지 못했습니다: " + clip((e && e.message) || e, 160)] };
      }
    };
    const p = this.q.then(run, run);
    this.q = p.then(() => null, () => null);
    return p;
  }

  setStatus(ok, msg, cx) {
    this.status = (ok ? "✔ " : "✘ ") + clip(msg, 300);
    if (!ok) notify({ title: "처리하지 못했습니다", body: clip(msg, 200), level: "warning" });
    cx.notify();
    const shown = this.status;
    cx.timer.after(20000, (cx2) => { if (this.status === shown) { this.status = ""; cx2.notify(); } });
  }

  // 한 번 더 눌러야 실행되는 버튼(되돌리기 어려운 동작용). 5초 안에 다시 누르지 않으면 원래대로.
  ask(name, cx, fn) {
    if (this.confirm === name) { this.confirm = ""; cx.notify(); fn(); return; }
    this.confirm = name; cx.notify();
    cx.timer.after(5000, (cx2) => { if (this.confirm === name) { this.confirm = ""; cx2.notify(); } });
  }

  // ---------------------------------------------------------------- 불러오기
  reloadAll(cx) {
    cx.spawn(async (cx) => {
      const [st, rl, bk] = [await this.call("status", null), await this.call("role-list", null), await this.call("backup-list", null)];
      this.st = st; this.rl = rl; this.bk = bk;
      if (st.ok === false) this.status = "✘ " + errorsText(st);
      else if (this.status.startsWith("불러오는")) this.status = "";
      this.loadRealKeys(cx);
      if (!this.sel && rl.ok && rl.roles && rl.roles.length) this.selectRole(roleRows(st.ok ? st : { roles: [] })[0] ? roleRows(st)[0].id : rl.roles[0].id);
      cx.notify();
    });
  }

  loadLive(cx) {
    cx.spawn(async (cx) => { this.lv = await this.call("live-windows", null); cx.notify(); });
  }

  // ---------------------------------------------------------------- 역할 편집
  roleOf(id) { return this.rl && this.rl.ok && Array.isArray(this.rl.roles) ? this.rl.roles.find((r) => r.id === id) : null; }

  selectRole(id) {
    const r = this.roleOf(id);
    this.sel = id; this.confirm = "";
    if (!r || !r.meta) return;
    const m = r.meta;
    this.inName.set_value(String(m.name ?? "")); this.inSum.set_value(String(m.summary ?? ""));
    this.inSlot.set_value(String(m.slot ?? "")); this.inRep.set_value(String(m.reports_to ?? ""));
    this.taWr.set_value((Array.isArray(m.writes_to) ? m.writes_to : []).join("\n"));
    this.taBody.set_value(String(r.body ?? "").replace(/\r\n/g, "\n"));
    this.dEnabled = m.enabled === true; this.dMode = m.mode || "read-only"; this.dCadence = m.cadence || "on-request";
  }

  draft() {
    return { name: this.inName.value(), summary: this.inSum.value(), slot: this.inSlot.value(), enabled: this.dEnabled, mode: this.dMode, cadence: this.dCadence, reports_to: this.inRep.value().trim(), writes_to: this.taWr.value(), body: this.taBody.value() };
  }

  // 엔진 명령 하나를 실행하고 결과를 한 줄로 알린다. 성공하면 목록을 다시 읽는다.
  act(label, cmd, req, okText, cx, after) {
    if (this.acting) return;
    this.acting = true; this.status = label + "…"; cx.notify();
    cx.spawn(async (cx) => {
      const r = await this.call(cmd, req);
      this.acting = false;
      if (r.ok) {
        this.setStatus(true, okText + (r.backup ? "  (바꾸기 전 상태는 자동 백업됨)" : ""), cx);
        if (after) after(r);
        this.reloadAll(cx);
      } else this.setStatus(false, "적용하지 않았습니다. 내 설정은 그대로입니다. " + errorsText(r), cx);
    });
  }

  saveRole(cx) {
    const r = this.roleOf(this.sel);
    const b = buildRoleSetRequest(r, this.draft());
    if (!b.ok) { this.setStatus(false, b.error, cx); return; }
    if (b.empty) { this.setStatus(true, "바뀐 내용이 없습니다", cx); return; }
    this.act("저장하는 중", "role-set", b.request, "저장했습니다", cx);
  }

  revertRole(cx) { this.act("번들 값으로 되돌리는 중", "role-revert", { id: this.sel }, "번들 값으로 되돌렸습니다", cx, () => { this.sel = this.sel; }); }
  deleteRole(cx) { const id = this.sel; this.act("삭제하는 중", "role-delete", { id }, "삭제했습니다 (백업에는 남아 있습니다)", cx, () => { this.sel = ""; }); }

  createRole(cx) {
    const b = buildRoleNewRequest(this.inNewId.value(), this.inNewName.value(), this.newFromSel ? this.sel : "");
    if (!b.ok) { this.setStatus(false, b.error, cx); return; }
    const id = b.request.id;
    this.act("새 역할을 만드는 중", "role-new", b.request, "새 역할을 만들었습니다 (꺼진 채로 시작할 수 있으니 확인하세요)", cx, () => { this.showNew = false; this.sel = id; this.reloadThenSelect = id; });
  }

  // ---------------------------------------------------------------- 현황
  runSync(cx) { this.act("생성물을 갱신하는 중", "sync-run", {}, "생성물을 갱신했습니다", cx); }

  // ---------------------------------------------------------------- 내보내기 / 불러오기 / 백업 / 복구
  doExport(cx) {
    if (this.acting) return;
    cx.spawn(async (cx) => {
      let dir = null;
      try { dir = await pickFolder({ prompt: "여기에 내보내기" }); } catch (e) { dir = null; }
      if (!dir) return;
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const dest = String(dir).replace(/[\\/]+$/, "") + "\\orch-export-" + stamp;   // 항상 새 폴더로 내보낸다(기존 폴더를 건드리지 않음)
      this.act("내보내는 중", "export", { dest, scope: this.scope, note: this.inExpNote.value() }, "내보냈습니다: " + dest, cx);
    });
  }

  pickPackage(cx, then) {
    cx.spawn(async (cx) => {
      let dir = null;
      try { dir = await pickFolder({ prompt: "묶음 폴더 선택" }); } catch (e) { dir = null; }
      if (!dir) return;
      this.pkgDir = String(dir); this.plan = null; cx.notify();
      if (then) then();
    });
  }

  importArgs() { return { pkg: this.pkgDir, mode: this.impMode, includeEnvRules: this.incEnv, includeIgnore: this.incIgnore, enableImported: this.enableImp }; }

  previewImport(cx) {
    if (!this.pkgDir || this.acting) { if (!this.pkgDir) this.setStatus(false, "먼저 묶음 폴더를 고르세요", cx); return; }
    this.acting = true; this.status = "미리보기를 계산하는 중…"; cx.notify();
    cx.spawn(async (cx) => {
      const args = this.importArgs();
      const r = await this.call("import-plan", args);
      this.acting = false; this.status = "";
      if (r.ok) this.plan = { kind: "import", data: r, args, pick: "" };
      else this.plan = null;
      if (!r.ok) this.setStatus(false, errorsText(r), cx);
      cx.notify();
    });
  }

  applyPlan(cx) {
    const p = this.plan; if (!p || !p.data || !p.data.token || p.data.noop) return;
    if (p.kind === "import") this.act("적용하는 중", "import-apply", { ...p.args, token: p.data.token }, "불러왔습니다", cx, () => { this.plan = null; });
    else this.act("복구하는 중", "restore-apply", { pkg: p.args.pkg, token: p.data.token }, "복구했습니다", cx, () => { this.plan = null; });
  }

  backupNow(cx) { this.act("백업하는 중", "backup", { note: this.inBkNote.value() }, "백업했습니다", cx); }

  previewRestore(cx) {
    if (!this.bkSel || this.acting) { if (!this.bkSel) this.setStatus(false, "먼저 목록에서 백업을 고르세요", cx); return; }
    this.acting = true; this.status = "복구 미리보기를 계산하는 중…"; cx.notify();
    cx.spawn(async (cx) => {
      const args = { pkg: this.bkSel };
      const r = await this.call("restore-plan", args);
      this.acting = false; this.status = "";
      if (r.ok) this.plan = { kind: "restore", data: r, args, pick: "" }; else { this.plan = null; this.setStatus(false, errorsText(r), cx); }
      cx.notify();
    });
  }

  openBackupFolder(cx) {
    const d = this.bk && this.bk.ok && this.bk.dir ? this.bk.dir : "";
    if (!d) return;
    cx.spawn(async (cx) => { try { await exec("explorer.exe", [d]); } catch (e) { /* 탐색기는 성공해도 종료 코드가 1 일 수 있다 */ } });
  }

  // ---------------------------------------------------------------- 단축키 바꾸기
  // keys.json 의 "이 모드를 여는 한 줄"만 바꾼다. 실제 디스크에 쓰는 일은 node 도구(herdr-keys.mjs)가 한다:
  // 모드 안에서 허더의 writeTextFile 로 바꿨을 때 화면은 "바꿨습니다"인데 실제 파일은 그대로였던 일이 있어(2026-11-15), 허더 파일 API 에 맡기지 않는다.
  // 도구가 하는 일(시험됨): 읽기 → 계산·검증(모든 구역 충돌 검사) → 백업 → 읽은 그대로일 때만 쓰기 → 다시 읽어 확인 → 어긋나면 되돌림. 응답에 실제 파일의 해시가 들어 있다.
  changeKey(newKey, cx) {
    if (this.acting) return;
    this.acting = true; this.keyNote = ""; this.status = "단축키를 바꾸는 중…"; cx.notify();
    cx.spawn(async (cx) => {
      let r;
      try {
        const x = await exec(NODE, [KEYS_TOOL, ...(newKey === null ? ["off"] : ["set", newKey])], { timeout: 30000 });
        r = parseResult(x.stdout, x.stderr);
        if (typeof r.ok !== "boolean") r = { ok: false, msg: errorsText(r) };
      } catch (e) {
        r = { ok: false, msg: "단축키 도구를 실행하지 못했습니다: " + clip((e && e.message) || e, 160) };
      }
      this.acting = false;
      this.setStatus(r.ok, r.msg || errorsText(r), cx);
      this.loadRealKeys(cx);
      if (r.ok && r.changed) {                       // 파일은 바뀌었는데 허더가 아직 새 키를 반영하지 않았는지 잠시 뒤 확인한다
        cx.timer.after(1500, (cx2) => {
          const eff = ownKeys(keys());
          const reflected = newKey === null ? eff.length === 0 : eff.some((c) => c.keys.toLowerCase() === newKey);
          this.keyNote = reflected ? "" : "keys.json 은 바뀌었지만 허더가 아직 새 키를 반영하지 않았습니다. 잠시 뒤에도 그대로면 허더를 다시 시작해 보세요.";
          cx2.notify();
        });
      }
    });
  }

  // 실제 디스크의 keys.json 상태(해시·이 모드를 여는 줄)를 읽는다. 허더가 인식하는 값(keys())과 비교해 보여 주기 위해.
  loadRealKeys(cx) {
    cx.spawn(async (cx) => {
      try { const x = await exec(NODE, [KEYS_TOOL, "status"], { timeout: 15000 }); this.realKeys = parseResult(x.stdout, x.stderr); }
      catch (e) { this.realKeys = { ok: false, msg: "단축키 도구를 실행하지 못했습니다: " + clip((e && e.message) || e, 120) }; }
      cx.notify();
    });
  }

  // 진단: 허더의 파일 쓰기(writeTextFile)가 실제 디스크에 반영되는지 확인한다(설정 폴더와 임시 폴더 각각, 우리가 만든 orch-probe-*.tmp 한 개만 쓰고 지운다).
  runProbe(cx) {
    if (this.acting) return;
    this.acting = true; this.probeLines = ["진단 중…"]; cx.notify();
    cx.spawn(async (cx) => {
      const L = [];
      const name = `orch-probe-${Date.now().toString(36)}.tmp`;
      try {
        const ah = appHome().replace(/\\/g, "/");
        L.push(`허더 설정 폴더(appHome): ${ah}`);
        for (const [label, dir, where] of [["설정 폴더", ah, "home"], ["임시 폴더", home().replace(/\\/g, "/") + "/AppData/Local/Temp", "temp"]]) {
          const path = `${dir}/${name}`;
          let wrote = "";
          try { await writeTextFile(path, "probe-ok", null); wrote = "성공(예외 없음)"; } catch (e) { wrote = "거절: " + clip((e && e.message) || e, 80); }
          let back = "";
          try { const t = await readTextFile(path); back = t === null ? "없음(null)" : t === "probe-ok" ? "같은 내용" : "다른 내용"; } catch (e) { back = "거절: " + clip((e && e.message) || e, 80); }
          let disk = "";
          try { const x = await exec(NODE, [KEYS_TOOL, "probe-read", name, where], { timeout: 15000 }); const j = parseResult(x.stdout, x.stderr); disk = j.exists ? `실제 디스크에 있음(${j.bytes}바이트)` : "실제 디스크에 없음"; } catch (e) { disk = "node 확인 실패: " + clip((e && e.message) || e, 80); }
          L.push(`${label}: 허더로 쓰기 ${wrote} → 허더가 다시 읽으면 ${back} → ${disk}`);
        }
        try { await exec(NODE, [KEYS_TOOL, "probe-clean", name], { timeout: 15000 }); } catch (e) { /* 지우기 실패는 무시(우리 진단 파일뿐) */ }
      } catch (e) { L.push("진단 중 오류: " + clip((e && e.message) || e, 120)); }
      this.probeLines = L; this.acting = false; cx.notify();
    });
  }

  // ---------------------------------------------------------------- 그리기
  // 화면 구조: 제목줄 → 탭 → (알림 줄) → 탭 내용 → 안내줄. 각 탭의 내용은 tabs.js, 공통 부품은 ui.js.
  render() {
    const t = theme();
    const k = makeUi(t);
    const badges = tabBadges(this.st, this.lv);

    const header = h_flex().h(44).items_center().justify_between()
      .child(div().text_size(15).font_bold().text_color(t.foreground).child("오케스트레이션 관리"))
      .child(h_flex().gap(4).items_center()
        .child(k.btn("om-refresh", "새로고침", (_e, cx) => { this.reloadAll(cx); if (this.tab === "live") this.loadLive(cx); }, { variant: "ghost", disabled: this.acting, tip: "F5" }))
        .child(k.btn("om-close", "닫기", () => this.dismiss(), { variant: "ghost", tip: "Esc" })));

    const tabsRow = h_flex().gap(2).border_b(1).border_color(t.border)
      .children(TABS.map(([id, label]) => k.tab(`om-tab-${id}`, label, this.tab === id, (_e, cx) => { this.tab = id; this.confirm = ""; if (id === "live") this.loadLive(cx); cx.notify(); }, badges[id])));

    // 알림 줄: 진행 중("…")·성공(✔)·실패(✘). 처음 불러오는 동안의 글자는 각 탭의 "불러오는 중" 표시가 대신하므로 숨긴다.
    const s = this.status || "";
    const showNotice = s !== "" && !s.startsWith("불러오는");
    const kind = s.startsWith("✔") ? "ok" : s.startsWith("✘") ? "bad" : "info";
    const noticeEl = showNotice ? k.notice(kind, s.replace(/^[✔✘]\s*/, ""), kind === "info" ? null : (_e, cx) => { this.status = ""; cx.notify(); }) : null;

    const content = this.tab === "status" ? renderStatus(this, k)
      : this.tab === "roles" ? renderRoles(this, k)
        : this.tab === "share" ? renderShare(this, k)
          : this.tab === "backup" ? renderBackup(this, k)
            : this.tab === "live" ? renderLive(this, k)
              : renderKeys(this, k);

    const openKey = keys().find((x) => x.action === "mod.open:orch-manager")?.keys;
    const footer = h_flex().h(24).gap(16).items_center()
      .child(div().flex_none().text_size(12).text_color(t.muted).child(`Esc 닫기 · Ctrl+1~6 탭 · F5 새로고침${this.tab === "roles" ? " · Ctrl+S 저장" : ""}${openKey ? ` · 열기 ${openKey}` : ""}`))
      .child(div().flex_1().min_w(0))
      .child(div().truncate().max_w(520).text_size(12).text_color(t.muted).tooltip("내 설정 위치").child(clip(this.st && this.st.paths ? this.st.paths.home : "", 90)));

    return v_flex()
      .id("om-root")
      .track_focus(this.handle)
      .size_full()
      .px(20).pt(8).pb(10).gap(12)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { this.dismiss(); cx.stop_propagation(); return; }
        if (e.keystroke === "f5") { this.reloadAll(cx); if (this.tab === "live") this.loadLive(cx); cx.stop_propagation(); return; }
        if (e.keystroke === "ctrl-s" && this.tab === "roles" && !this.showNew && !this.acting) { this.saveRole(cx); cx.stop_propagation(); return; }
        const m = /^ctrl-([1-6])$/.exec(e.keystroke || "");
        if (m) { this.tab = TABS[Number(m[1]) - 1][0]; this.confirm = ""; if (this.tab === "live") this.loadLive(cx); cx.notify(); cx.stop_propagation(); }
      })
      .child(v_flex().child(header).child(tabsRow))
      .when(!!noticeEl, (el) => el.child(noticeEl))
      .child(v_flex().flex_1().min_h(0).child(content))
      .child(footer);
  }
}
