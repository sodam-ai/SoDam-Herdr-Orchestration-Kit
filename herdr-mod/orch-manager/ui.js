// ui.js - 오케스트레이션 관리 모드의 화면 부품 모음. 모든 탭이 같은 부품·같은 규칙(크기·여백·상태 표시)을 쓰게 한다.
// 허더 테마 색(theme())만 쓰므로 밝은/어두운 테마를 모두 따른다. 동작(엔진 호출·상태)은 여기 없고, 순수하게 "그리기"만 한다.
// 규칙: 간격 4/8/12/16/24 · 글자 12(보조)/12.5(본문·버튼)/13(제목)/15(창 제목) · 반경 7(버튼·입력)/10(카드) · 비활성은 흐리게+금지 커서+툴팁으로 이유 안내.
import { div } from "gpui-kit";
import { v_flex, h_flex, Input, Textarea } from "gpui-base";

export function makeUi(t) {
  const CLEAR = "#00000000";
  const TONE = { ok: t.ansi2, warn: t.ansi3, bad: t.ansi1, info: t.working, muted: t.muted };
  const tone = (k) => TONE[k] ?? t.muted;

  // ---- 버튼: primary(주요 행동, 화면당 1~2개) / secondary(보조) / ghost(글자만) / danger(되돌리기 어려운 동작)
  // disabled 이면 눌리지 않고 흐리게 보이며, tip 으로 "왜 지금은 못 누르는지"를 툴팁에 알려 준다.
  const btn = (id, label, onClick, o = {}) => {
    const v = o.variant ?? "secondary"; const dis = !!o.disabled;
    let el = h_flex().id(id).h(30).px(14).flex_none().items_center().justify_center().gap(6).rounded(7).border_1().text_size(12.5).font_medium().whitespace_nowrap();
    if (v === "primary") el = el.bg(t.solid).border_color(t.solid).text_color(t.solid_foreground);
    else if (v === "ghost") el = el.bg(CLEAR).border_color(CLEAR).text_color(t.muted);
    else el = el.bg(t.raised).border_color(t.border).text_color(v === "danger" ? t.ansi1 : t.foreground);
    if (o.tip) el = el.tooltip(o.tip);
    if (dis) return el.opacity(0.4).cursor_not_allowed().tab_stop(false).child(label);
    return el.cursor_pointer().tab_stop(true)
      .hover((s) => (v === "primary" ? s.bg(t.accent).text_color(t.accent_foreground) : s.bg(t.hover)))
      .active((s) => s.opacity(0.85))
      .focus((s) => s.border_color(t.foreground))
      .on_click(onClick).child(label);
  };

  // ---- 탭(밑줄형). 눌러서 화면을 바꾸는 "이동"이라 행동 버튼(채워진 모양)과 다르게 보이게 한다. badge: 주의가 필요할 때 점+숫자.
  const tab = (id, label, active, onClick, badge) =>
    h_flex().id(id).h(38).px(14).flex_none().items_center().gap(6).cursor_pointer().tab_stop(true)
      .border_b(2).border_color(active ? t.foreground : CLEAR)
      .text_size(13).text_color(active ? t.foreground : t.muted).when(active, (el) => el.font_semibold())
      .hover((s) => (active ? s : s.text_color(t.foreground)))
      .focus((s) => s.text_color(t.foreground))
      .on_click(onClick)
      .child(label)
      .when(!!badge, (el) => el.child(div().text_size(11).text_color(tone(badge.tone)).child(badge.text)));

  // ---- 선택 묶음(둘 이상 중 하나 고르기). 채워진 버튼이 아니라 "선택된 칸"만 은은하게 표시해 행동 버튼과 헷갈리지 않게 한다.
  const seg = (id, options, value, onChange) =>
    h_flex().flex_none().self_start().rounded(7).border_1().border_color(t.border).overflow_hidden()
      .children(options.map((o, i) => {
        const on = o.value === value;
        return h_flex().id(`${id}-${o.value}`).h(28).px(12).items_center().justify_center().text_size(12.5).cursor_pointer().tab_stop(true)
          .when(i > 0, (el) => el.border_l(1).border_color(t.border))
          .bg(on ? t.selected : CLEAR).text_color(on ? t.foreground : t.muted).when(on, (el) => el.font_semibold())
          .hover((s) => (on ? s : s.bg(t.hover).text_color(t.foreground)))
          .focus((s) => s.text_color(t.foreground))
          .when(!!o.tip, (el) => el.tooltip(o.tip))
          .on_click((e, cx) => onChange(o.value, cx))
          .child(o.label);
      }));

  // ---- 체크 항목(여러 개를 각각 켜고 끄기). 켜짐/꺼짐이 글자가 아니라 모양(체크 표시)으로 보이게 한다.
  const check = (id, label, on, onClick, hint) =>
    h_flex().id(id).gap(10).items_start().cursor_pointer().tab_stop(true).focus((s) => s.opacity(0.9)).on_click(onClick)
      .child(div().w(16).h(16).flex_none().mt(1).rounded(4).border_1().border_color(on ? t.solid : t.border).bg(on ? t.solid : CLEAR)
        .flex().items_center().justify_center().text_size(11).text_color(t.solid_foreground).child(on ? "✓" : ""))
      .child(v_flex().gap(2).min_w(0)
        .child(div().text_size(12.5).text_color(t.foreground).child(label))
        .when(!!hint, (el) => el.child(div().text_size(12).text_color(t.muted).child(hint))));

  // ---- 상태 배지(색만으로 구분하지 않고 점+글자). tone: ok / warn / bad / info / muted
  const badge = (label, k) =>
    h_flex().flex_none().self_start().h(20).px(8).gap(5).items_center().rounded(10).bg(t.background).border_1().border_color(t.border)
      .child(div().text_size(9).text_color(tone(k)).child("●"))
      .child(div().text_size(12).text_color(t.foreground).whitespace_nowrap().child(label));
  const pill = (label, color) => div().flex_none().px(7).h(20).flex().items_center().rounded(5).bg(t.background).text_size(12).text_color(color ?? t.muted).whitespace_nowrap().child(label);

  // ---- 글자
  const title = (text) => div().text_size(13).font_semibold().text_color(t.foreground).child(text);
  const note = (text, color) => div().text_size(12).text_color(color ?? t.muted).child(text);
  const label = (text) => div().text_size(12).font_medium().text_color(t.muted).child(text);

  // ---- 입력(한 줄) / 입력(여러 줄)
  const input = (state, o = {}) =>
    h_flex().flex_1().min_w(0).h(o.h ?? 32).px(10).items_center().rounded(7).border_1().border_color(t.border).bg(t.background)
      .child(Input.new(state).flex_1().h_full().text_size(12.5).text_color(t.foreground));
  const area = (state, h) =>
    div().w_full().h(h).p(8).rounded(7).border_1().border_color(t.border).bg(t.background)
      .child(Textarea.new(state).size_full().text_size(12.5).text_color(t.foreground));

  // ---- 위에 이름표가 있는 입력 묶음(폼의 기본 단위): 이름표 / 입력 / 도움말
  const field = (name, control, hint, o = {}) =>
    v_flex().gap(6).min_w(0).when(!!o.w, (el) => el.w(o.w)).when(!o.w, (el) => el.w_full())
      .child(label(name)).child(control)
      .when(!!hint, (el) => el.child(note(hint)));

  // ---- 카드(관련된 것끼리 묶는 상자). 제목·설명은 선택.
  const card = (heading, desc, children, o = {}) =>
    v_flex().gap(12).p(16).rounded(10).bg(t.raised).border_1().border_color(t.border).min_w(0).when(!!o.w, (el) => el.w(o.w)).when(!!o.grow, (el) => el.flex_1().min_h(0))
      .when(!!heading || !!desc, (el) => el.child(v_flex().gap(3).child(heading ? title(heading) : div()).when(!!desc, (e2) => e2.child(note(desc)))))
      .children(children);

  // ---- 알림 줄(결과·진행·오류). 닫을 수 있고, 색 + 기호(✔ ✘ !)로 구분한다.
  const notice = (kind, text, onClose) => {
    const sym = kind === "ok" ? "✔" : kind === "bad" ? "✘" : kind === "warn" ? "!" : "…";
    return h_flex().gap(10).px(14).py(8).items_start().rounded(8).bg(t.raised).border_1().border_color(kind === "bad" ? t.ansi1 : kind === "warn" ? t.ansi3 : t.border)
      .child(div().w(14).flex_none().text_size(13).font_bold().text_color(tone(kind === "info" ? "muted" : kind)).child(sym))
      .child(div().flex_1().min_w(0).text_size(12.5).text_color(t.foreground).child(text))
      .when(!!onClose, (el) => el.child(div().id("om-notice-x").px(6).cursor_pointer().text_size(13).text_color(t.muted).tooltip("닫기").hover((s) => s.text_color(t.foreground)).on_click(onClose).child("×")));
  };

  // ---- 빈 상태 / 불러오는 중
  const empty = (heading, desc, action) =>
    v_flex().gap(6).items_center().py(36).px(16)
      .child(div().text_size(14).font_semibold().text_color(t.foreground).child(heading))
      .when(!!desc, (el) => el.child(div().text_size(12.5).text_color(t.muted).text_center().child(desc)))
      .when(!!action, (el) => el.child(div().mt(8).child(action)));
  const loading = (rows = 4) =>
    v_flex().gap(10).p(4).children(Array.from({ length: rows }, (_x, i) => div().h(14).rounded(4).bg(t.raised).w(`${[72, 58, 66, 44, 60][i % 5]}%`)))
      .child(div().text_size(12).text_color(t.muted).child("불러오는 중…"));

  // ---- 키 모양(단축키 표시)
  const keycaps = (keyStr, o = {}) => {
    const parts = String(keyStr || "").split("-").filter(Boolean).map((p) => (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)));
    return h_flex().gap(4).items_center().flex_none()
      .children(parts.map((p, i) => h_flex().gap(4).items_center()
        .when(i > 0, (el) => el.child(div().text_size(11).text_color(t.muted).child("+")))
        .child(div().px(8).h(o.h ?? 24).flex().items_center().rounded(5).border_1().border_color(t.border).bg(t.background).text_size(o.size ?? 12).font_medium().text_color(t.foreground).child(p))));
  };

  // ---- 키 모양 토글(Ctrl/Alt/Shift 처럼 여러 개를 각각 켜고 끄는 조합 키)
  const toggle = (id, text, on, onClick) =>
    h_flex().id(id).h(30).px(14).flex_none().items_center().justify_center().rounded(7).border_1().text_size(12.5).font_medium().cursor_pointer().tab_stop(true)
      .border_color(on ? t.foreground : t.border).bg(on ? t.selected : CLEAR).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).focus((s) => s.border_color(t.foreground)).on_click(onClick).child(text);

  // ---- 표 머리줄
  const thead = (cols) =>
    h_flex().gap(10).px(10).h(26).items_center().border_b(1).border_color(t.border)
      .children(cols.map((c) => div().when(!!c.w, (el) => el.w(c.w).flex_none()).when(!c.w, (el) => el.flex_1().min_w(0)).text_size(12).font_medium().text_color(t.muted).child(c.label)));

  return { t, tone, btn, tab, seg, check, badge, pill, title, note, label, input, area, field, card, notice, empty, loading, keycaps, toggle, thead };
}
