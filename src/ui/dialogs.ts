import { h } from "./dom";
import { ARTBOARD_PRESETS, PRESET_GROUPS } from "../presets";
import { addArtboard } from "../actions";
import { AI_GUIDE_MARKDOWN } from "../aiGuide";
import { toast } from "./toast";
import { writeClipboardText } from "../platform";

function openModal(title: string, body: HTMLElement, footer?: HTMLElement): HTMLElement {
  const overlay = h("div", { class: "modal-overlay" });
  const modal = h(
    "div",
    { class: "modal" },
    h(
      "div",
      { class: "modal-header" },
      h("span", {}, title),
      h("button", { class: "modal-close", onclick: () => overlay.remove() }, "✕")
    ),
    h("div", { class: "modal-body" }, body),
    footer ? h("div", { class: "modal-footer" }, footer) : null
  );
  overlay.append(modal);
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  window.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") {
      overlay.remove();
      window.removeEventListener("keydown", esc);
    }
  });
  document.body.append(overlay);
  return overlay;
}

export function confirmDialog(title: string, message: string, confirmLabel: string, onConfirm: () => void): void {
  const body = h("div", { class: "dialog-message" }, message);
  const footer = h(
    "div",
    { class: "dialog-actions" },
    h("button", { class: "btn", onclick: () => overlay.remove() }, "취소"),
    h("button", {
      class: "btn btn-danger",
      onclick: () => { overlay.remove(); onConfirm(); }
    }, confirmLabel)
  );
  const overlay = openModal(title, body, footer);
}

export function newArtboardDialog(): void {
  let selWidth = 1920;
  let selHeight = 1080;
  const nameInput = h("input", { class: "field-input", value: "새 화면", spellcheck: "false" }) as HTMLInputElement;
  const wInput = h("input", { class: "field-input num", type: "number", value: "1920", min: "1" }) as HTMLInputElement;
  const hInput = h("input", { class: "field-input num", type: "number", value: "1080", min: "1" }) as HTMLInputElement;

  const presetList = h("div", { class: "preset-list" });
  for (const group of PRESET_GROUPS) {
    presetList.append(h("div", { class: "preset-group" }, group));
    for (const p of ARTBOARD_PRESETS.filter((x) => x.group === group)) {
      const row = h(
        "button",
        {
          class: "preset-item",
          onclick: () => {
            selWidth = p.width;
            selHeight = p.height;
            wInput.value = String(p.width);
            hInput.value = String(p.height);
            presetList.querySelectorAll(".preset-item").forEach((el) => el.classList.remove("active"));
            row.classList.add("active");
            if (nameInput.value === "새 화면" || nameInput.dataset.auto === "1") {
              nameInput.value = p.label;
              nameInput.dataset.auto = "1";
            }
          }
        },
        h("span", {}, p.label),
        h("span", { class: "preset-size" }, `${p.width} × ${p.height}`)
      );
      presetList.append(row);
    }
  }
  nameInput.addEventListener("input", () => { nameInput.dataset.auto = "0"; });

  const body = h(
    "div",
    { class: "new-artboard" },
    presetList,
    h(
      "div",
      { class: "new-artboard-fields" },
      h("label", { class: "field-label" }, "이름"),
      nameInput,
      h("label", { class: "field-label" }, "크기"),
      h("div", { class: "field-row" }, wInput, h("span", { class: "field-x" }, "×"), hInput)
    )
  );
  const footer = h(
    "div",
    { class: "dialog-actions" },
    h("button", { class: "btn", onclick: () => overlay.remove() }, "취소"),
    h("button", {
      class: "btn btn-primary",
      onclick: () => {
        const w = Math.max(1, Number(wInput.value) || selWidth);
        const hgt = Math.max(1, Number(hInput.value) || selHeight);
        addArtboard(nameInput.value.trim() || "새 화면", w, hgt);
        overlay.remove();
      }
    }, "만들기")
  );
  const overlay = openModal("새 아트보드", body, footer);
}

export function shortcutsDialog(): void {
  const rows: [string, string][] = [
    ["W · V", "선택 도구"],
    ["Q · H · Space 유지", "손 도구 (이동)"],
    ["R", "요소 그리기 도구"],
    ["F", "선택 프레임"],
    ["휠", "확대 / 축소 (커서 기준)"],
    ["휠 클릭 드래그", "화면 이동"],
    ["Ctrl+Z / Ctrl+Y", "실행 취소 / 다시 실행"],
    ["Ctrl+C / X / V", "복사 / 잘라내기 / 붙여넣기"],
    ["Ctrl+D", "복제"],
    ["Delete", "삭제"],
    ["Ctrl+A", "전체 선택"],
    ["Ctrl+G / Ctrl+Shift+G", "그룹 / 그룹 해제"],
    ["Ctrl+] / Ctrl+[", "앞으로 / 뒤로 보내기"],
    ["Ctrl+Shift+] / Ctrl+Shift+[", "맨 앞 / 맨 뒤로"],
    ["방향키 / Shift+방향키", "1px / 10px 이동"],
    ["Escape", "부모 선택 · 선택 해제"],
    ["Ctrl+0 / Ctrl+1", "화면에 맞추기 / 100%"],
    ["Ctrl+S", "프로젝트 저장"],
    ["Ctrl+E", "AI용 JSON 내보내기"],
    ["Ctrl+' ", "격자 표시"],
    ["드래그 중 Shift", "축 고정 · 비율 유지 · 15° 회전"],
    ["드래그 중 Alt", "중심 기준 크기 조절"]
  ];
  const body = h(
    "div",
    { class: "shortcut-grid" },
    ...rows.flatMap(([k, v]) => [
      h("div", { class: "shortcut-key" }, k),
      h("div", { class: "shortcut-desc" }, v)
    ])
  );
  openModal("단축키", body);
}

export function aiGuideDialog(): void {
  const pre = h("pre", { class: "guide-pre" }, AI_GUIDE_MARKDOWN);
  const footer = h(
    "div",
    { class: "dialog-actions" },
    h("button", {
      class: "btn btn-primary",
      onclick: () => {
        void writeClipboardText(AI_GUIDE_MARKDOWN).then((ok) =>
          toast(ok ? "AI 연동 가이드가 클립보드에 복사되었습니다" : "클립보드 접근이 거부되었습니다")
        );
      }
    }, "클립보드에 복사")
  );
  openModal("AI 연동 가이드", pre, footer);
}

export function aboutDialog(): void {
  const body = h(
    "div",
    { class: "about" },
    h("div", { class: "about-logo" }, "OverlayPlacer"),
    h("div", { class: "about-version" }, "버전 1.0.0"),
    h("div", { class: "about-desc" }, "AI 협업형 UI 레이아웃 배치 편집기")
  );
  openModal("정보", body);
}
