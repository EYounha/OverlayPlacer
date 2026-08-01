import { store } from "../state/store";
import type { ElementType, Tool } from "../types";
import { ELEMENT_TYPES } from "../types";
import { h, icon } from "./dom";
import type { IconName } from "./icons";

export class Toolbar {
  root: HTMLElement;
  private toolButtons = new Map<Tool, HTMLElement>();
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private toggles: { btn: HTMLButtonElement; on: () => boolean }[] = [];

  constructor() {
    const typeSelect = h("select", { class: "tool-type-select", title: "생성할 요소 타입" }) as HTMLSelectElement;
    for (const t of ELEMENT_TYPES) {
      typeSelect.append(h("option", { value: t.type }, t.label));
    }
    typeSelect.value = store.drawType;
    typeSelect.addEventListener("change", () => {
      store.drawType = typeSelect.value as ElementType;
      store.setTool("draw");
    });

    this.undoBtn = this.iconBtn("undo", "실행 취소 (Ctrl+Z)", () => store.undo());
    this.redoBtn = this.iconBtn("redo", "다시 실행 (Ctrl+Y)", () => store.redo());

    this.root = h(
      "div",
      { class: "toolbar" },
      h(
        "div",
        { class: "tool-group" },
        this.toolBtn("hand", "hand", "손 (Q)"),
        this.toolBtn("select", "cursor", "선택 (W)"),
        this.toolBtn("draw", "rect", "요소 그리기 (R)"),
        this.toolBtn("measure", "measure", "치수선 (M)")
      ),
      typeSelect,
      h("div", { class: "toolbar-sep" }),
      h("div", { class: "tool-group" }, this.undoBtn, this.redoBtn),
      h("div", { class: "toolbar-sep" }),
      h(
        "div",
        { class: "tool-group" },
        this.toggleBtn("grid", "격자 표시 (Ctrl+')", "showGrid"),
        this.toggleBtn("snap", "요소에 스냅", "snapElements"),
        this.toggleBtn("distributeH", "간격 스냅", "snapGaps"),
        this.toggleBtn("measure", "치수선 표시", "showMeasures")
      )
    );

    store.on("tool", () => this.syncTools());
    store.on("doc", () => this.syncHistory());
    store.on("selection", () => this.syncHistory());
    store.on("settings", () => this.syncToggles());
    this.syncTools();
    this.syncHistory();
    this.syncToggles();
  }

  private iconBtn(name: IconName, title: string, action: () => void): HTMLButtonElement {
    return h("button", { class: "tool-btn", title, onclick: action }, icon(name)) as HTMLButtonElement;
  }

  private toggleBtn(
    name: IconName, title: string, key: "showGrid" | "snapElements" | "snapGaps" | "showMeasures"
  ): HTMLButtonElement {
    const btn = this.iconBtn(name, title, () =>
      store.updateSettings({ [key]: !store.settings[key] })
    );
    this.toggles.push({ btn, on: () => store.settings[key] });
    return btn;
  }

  private syncToggles(): void {
    for (const t of this.toggles) t.btn.classList.toggle("active", t.on());
  }

  private toolBtn(tool: Tool, name: IconName, title: string): HTMLElement {
    const btn = this.iconBtn(name, title, () => store.setTool(tool));
    this.toolButtons.set(tool, btn);
    return btn;
  }

  private syncTools(): void {
    for (const [tool, btn] of this.toolButtons) {
      btn.classList.toggle("active", store.tool === tool);
    }
  }

  private syncHistory(): void {
    this.undoBtn.disabled = !store.canUndo();
    this.redoBtn.disabled = !store.canRedo();
  }
}
