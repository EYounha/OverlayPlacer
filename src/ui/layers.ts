import { store } from "../state/store";
import type { Artboard, OPElement } from "../types";
import { typeInfo } from "../types";
import { findArtboard, findElement } from "../model/doc";
import { deleteArtboard, duplicateArtboard, moveInTree } from "../actions";
import { h, clearChildren } from "./dom";
import { showMenu } from "./contextmenu";
import { buildElementContextMenu } from "./sharedMenus";
import { confirmDialog, newArtboardDialog } from "./dialogs";

interface DropTarget {
  artboardId: string;
  parentId: string | null;
  index: number;
  indicator: { el: HTMLElement; mode: "before" | "after" | "inside" };
}

export class LayersPanel {
  root: HTMLElement;
  private list: HTMLElement;
  private collapsed = new Set<string>();
  private dragIds: string[] | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private dropTarget: DropTarget | null = null;
  private ghost: HTMLElement | null = null;

  constructor() {
    this.list = h("div", { class: "layers-list" });
    this.root = h(
      "div",
      { class: "panel panel-left" },
      h(
        "div",
        { class: "panel-header" },
        h("span", {}, "레이어"),
        h("button", {
          class: "icon-btn",
          title: "새 아트보드",
          onclick: () => newArtboardDialog()
        }, "+")
      ),
      this.list
    );
    store.on("doc", () => this.render());
    store.on("selection", () => this.render());
    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", () => this.onPointerUp());
    this.render();
  }

  private render(): void {
    clearChildren(this.list);
    for (const ab of store.doc.artboards) {
      this.list.append(this.artboardRow(ab));
      if (!this.collapsed.has(ab.id)) {
        this.renderChildren(ab.children, ab, null, 1);
      }
    }
  }

  private renderChildren(els: OPElement[], ab: Artboard, parentId: string | null, depth: number): void {
    // 캔버스 z순서는 배열 뒤가 위 → 패널에는 위 요소를 먼저 표시
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      this.list.append(this.elementRow(el, ab, parentId, i, depth));
      if (el.children.length > 0 && !this.collapsed.has(el.id)) {
        this.renderChildren(el.children, ab, el.id, depth + 1);
      }
    }
  }

  private artboardRow(ab: Artboard): HTMLElement {
    const active = ab.id === store.activeArtboardId;
    const row = h(
      "div",
      { class: `layer-row ab-row${active ? " active" : ""}`, dataset: { abId: ab.id } },
      h("button", {
        class: `tree-toggle${ab.children.length === 0 ? " empty" : ""}`,
        onclick: (e: Event) => {
          e.stopPropagation();
          this.toggleCollapse(ab.id);
        }
      }, this.collapsed.has(ab.id) ? "▸" : "▾"),
      h("span", { class: "ab-icon" }, "▣"),
      h("span", { class: "layer-name" }, ab.name),
      h("span", { class: "layer-dim" }, `${ab.width}×${ab.height}`)
    );
    row.addEventListener("click", () => {
      store.setActiveArtboard(ab.id);
      store.clearSelection();
    });
    row.addEventListener("dblclick", () => this.startRename(row, ab.name, (name) => {
      store.beginChange();
      const target = findArtboard(store.doc, ab.id);
      if (target) target.name = name;
      store.commit();
    }));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      store.setActiveArtboard(ab.id);
      showMenu([
        { label: "아트보드 복제", action: () => duplicateArtboard(ab.id) },
        { separator: true },
        {
          label: "아트보드 삭제",
          disabled: store.doc.artboards.length <= 1,
          action: () => confirmDialog(
            "아트보드 삭제",
            `'${ab.name}' 아트보드와 포함된 모든 요소가 삭제됩니다.`,
            "삭제",
            () => deleteArtboard(ab.id)
          )
        }
      ], e.clientX, e.clientY);
    });
    return row;
  }

  private elementRow(el: OPElement, ab: Artboard, parentId: string | null, index: number, depth: number): HTMLElement {
    const selected = store.selection.includes(el.id);
    const info = typeInfo(el.type);
    const row = h(
      "div",
      {
        class: `layer-row el-row${selected ? " selected" : ""}${el.visible ? "" : " hidden-el"}`,
        dataset: { elId: el.id, abId: ab.id, parentId: parentId ?? "", index: String(index) }
      },
      h("span", { style: { width: `${depth * 14}px`, flexShrink: "0" } }),
      h("button", {
        class: `tree-toggle${el.children.length === 0 ? " empty" : ""}`,
        onclick: (e: Event) => {
          e.stopPropagation();
          this.toggleCollapse(el.id);
        }
      }, el.children.length === 0 ? "" : this.collapsed.has(el.id) ? "▸" : "▾"),
      h("span", { class: "type-dot", style: { background: el.color || info.color } }),
      h("span", { class: "layer-name" }, el.name),
      h("button", {
        class: `row-action${el.locked ? " on" : ""}`,
        title: el.locked ? "잠금 해제" : "잠금",
        onclick: (e: Event) => {
          e.stopPropagation();
          store.beginChange();
          const f = findElement(store.doc, el.id);
          if (f) f.el.locked = !f.el.locked;
          store.commit();
        }
      }, el.locked ? "🔒" : "🔓"),
      h("button", {
        class: `row-action${el.visible ? "" : " on"}`,
        title: el.visible ? "숨기기" : "표시",
        onclick: (e: Event) => {
          e.stopPropagation();
          store.beginChange();
          const f = findElement(store.doc, el.id);
          if (f) f.el.visible = !f.el.visible;
          store.commit();
        }
      }, el.visible ? "👁" : "―")
    );

    row.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      if (e.shiftKey) {
        store.toggleSelect(el.id);
      } else if (!store.selection.includes(el.id)) {
        store.select([el.id]);
      }
      this.dragIds = store.topLevelSelection();
      this.dragStart = { x: e.clientX, y: e.clientY };
    });
    row.addEventListener("dblclick", () => this.startRename(row, el.name, (name) => {
      store.beginChange();
      const f = findElement(store.doc, el.id);
      if (f) f.el.name = name;
      store.commit();
    }));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (!store.selection.includes(el.id)) store.select([el.id]);
      showMenu(buildElementContextMenu(), e.clientX, e.clientY);
    });
    return row;
  }

  private toggleCollapse(id: string): void {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    this.render();
  }

  private startRename(row: HTMLElement, current: string, apply: (name: string) => void): void {
    const nameEl = row.querySelector(".layer-name") as HTMLElement | null;
    if (!nameEl) return;
    const input = h("input", { class: "rename-input", value: current, spellcheck: "false" }) as HTMLInputElement;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const finish = (commit: boolean) => {
      const value = input.value.trim();
      input.replaceWith(nameEl);
      if (commit && value && value !== current) apply(value);
    };
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  /* ---------- 트리 드래그 ---------- */

  private onPointerMove(e: PointerEvent): void {
    if (!this.dragIds || !this.dragStart) return;
    if (!this.dragging) {
      if (Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) < 5) return;
      this.dragging = true;
      this.ghost = h("div", { class: "drag-ghost" }, `${this.dragIds.length}개 요소`);
      document.body.append(this.ghost);
    }
    if (this.ghost) {
      this.ghost.style.left = `${e.clientX + 12}px`;
      this.ghost.style.top = `${e.clientY + 8}px`;
    }
    this.clearIndicator();

    const target = (e.target as HTMLElement).closest?.(".layer-row") as HTMLElement | null;
    if (!target || !this.list.contains(target)) {
      this.dropTarget = null;
      return;
    }
    const rect = target.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;

    if (target.dataset.abId && !target.dataset.elId) {
      // 아트보드 행 위 → 해당 아트보드 최상위로
      target.classList.add("drop-inside");
      this.dropTarget = {
        artboardId: target.dataset.abId,
        parentId: null,
        index: Number.MAX_SAFE_INTEGER,
        indicator: { el: target, mode: "inside" }
      };
      return;
    }

    const elId = target.dataset.elId!;
    const abId = target.dataset.abId!;
    const parentId = target.dataset.parentId || null;
    const index = Number(target.dataset.index);
    if (this.dragIds.includes(elId)) {
      this.dropTarget = null;
      return;
    }
    const found = findElement(store.doc, elId);
    const isContainer = !!found && (found.el.children.length > 0 || found.el.type === "panel");

    if (isContainer && ratio > 0.3 && ratio < 0.7) {
      target.classList.add("drop-inside");
      this.dropTarget = {
        artboardId: abId,
        parentId: elId,
        index: Number.MAX_SAFE_INTEGER,
        indicator: { el: target, mode: "inside" }
      };
    } else if (ratio <= 0.5) {
      // 패널 표시상 위 = 배열에서 뒤 (z순서 역순 표시)
      target.classList.add("drop-before");
      this.dropTarget = {
        artboardId: abId,
        parentId,
        index: index + 1,
        indicator: { el: target, mode: "before" }
      };
    } else {
      target.classList.add("drop-after");
      this.dropTarget = {
        artboardId: abId,
        parentId,
        index,
        indicator: { el: target, mode: "after" }
      };
    }
  }

  private onPointerUp(): void {
    if (this.dragging && this.dropTarget && this.dragIds) {
      moveInTree(this.dragIds, {
        artboardId: this.dropTarget.artboardId,
        parentId: this.dropTarget.parentId,
        index: this.dropTarget.index
      });
    }
    this.clearIndicator();
    this.ghost?.remove();
    this.ghost = null;
    this.dragIds = null;
    this.dragStart = null;
    this.dragging = false;
    this.dropTarget = null;
  }

  private clearIndicator(): void {
    this.list.querySelectorAll(".drop-before, .drop-after, .drop-inside").forEach((el) => {
      el.classList.remove("drop-before", "drop-after", "drop-inside");
    });
  }
}
