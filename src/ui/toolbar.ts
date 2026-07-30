import { store } from "../state/store";
import type { ElementType, Tool } from "../types";
import { ELEMENT_TYPES } from "../types";
import { h } from "./dom";

export class Toolbar {
  root: HTMLElement;
  private toolButtons = new Map<Tool, HTMLElement>();
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private gridBtn: HTMLButtonElement;
  private snapBtn: HTMLButtonElement;

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

    this.undoBtn = h("button", {
      class: "tool-btn", title: "실행 취소 (Ctrl+Z)", onclick: () => store.undo()
    }, "↶") as HTMLButtonElement;
    this.redoBtn = h("button", {
      class: "tool-btn", title: "다시 실행 (Ctrl+Y)", onclick: () => store.redo()
    }, "↷") as HTMLButtonElement;

    this.gridBtn = h("button", {
      class: "tool-btn",
      title: "격자 표시 (Ctrl+')",
      onclick: () => store.updateSettings({ showGrid: !store.settings.showGrid })
    }, "▦") as HTMLButtonElement;
    this.snapBtn = h("button", {
      class: "tool-btn",
      title: "요소에 스냅",
      onclick: () => store.updateSettings({ snapElements: !store.settings.snapElements })
    }, "⌖") as HTMLButtonElement;

    this.root = h(
      "div",
      { class: "toolbar" },
      h(
        "div",
        { class: "tool-group" },
        this.toolBtn("hand", "✋", "손 (Q)"),
        this.toolBtn("select", "▲", "선택 (W)"),
        this.toolBtn("draw", "▢", "요소 그리기 (R)")
      ),
      typeSelect,
      h("div", { class: "toolbar-sep" }),
      h("div", { class: "tool-group" }, this.undoBtn, this.redoBtn),
      h("div", { class: "toolbar-sep" }),
      h("div", { class: "tool-group" }, this.gridBtn, this.snapBtn)
    );

    store.on("tool", () => this.syncTools());
    store.on("doc", () => this.syncHistory());
    store.on("selection", () => this.syncHistory());
    store.on("settings", () => this.syncToggles());
    this.syncTools();
    this.syncHistory();
    this.syncToggles();
  }

  private syncToggles(): void {
    this.gridBtn.classList.toggle("active", store.settings.showGrid);
    this.snapBtn.classList.toggle("active", store.settings.snapElements);
  }

  private toolBtn(tool: Tool, icon: string, title: string): HTMLElement {
    const btn = h("button", {
      class: "tool-btn",
      title,
      onclick: () => store.setTool(tool)
    }, icon);
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
