import { store } from "../state/store";
import { h } from "./dom";
import type { CanvasView } from "./canvasView";

export class StatusBar {
  root: HTMLElement;
  private coords: HTMLElement;
  private selInfo: HTMLElement;
  private zoomLabel: HTMLElement;

  constructor(private canvas: CanvasView) {
    this.coords = h("span", { class: "status-item" }, "0, 0");
    this.selInfo = h("span", { class: "status-item" }, "");
    this.zoomLabel = h("button", {
      class: "status-zoom",
      title: "100%로",
      onclick: () => this.canvas.zoomTo100()
    }, "100%");

    this.root = h(
      "div",
      { class: "statusbar" },
      this.coords,
      this.selInfo,
      h("div", { class: "menubar-spacer" }),
      h("button", { class: "status-btn", title: "축소", onclick: () => this.canvas.setZoom(store.view.zoom / 1.25) }, "−"),
      this.zoomLabel,
      h("button", { class: "status-btn", title: "확대", onclick: () => this.canvas.setZoom(store.view.zoom * 1.25) }, "+"),
      h("button", { class: "status-btn wide", title: "화면에 맞추기 (Ctrl+0)", onclick: () => this.canvas.fitToView() }, "⤢")
    );

    window.addEventListener("op:cursor", ((e: CustomEvent) => {
      const d = e.detail as { x: number; y: number; artboard: string };
      this.coords.textContent = `${d.artboard} · ${d.x}, ${d.y}`;
    }) as EventListener);

    store.on("view", () => {
      this.zoomLabel.textContent = `${Math.round(store.view.zoom * 100)}%`;
    });
    store.on("selection", () => this.syncSelection());
    store.on("doc", () => this.syncSelection());
  }

  private syncSelection(): void {
    const n = store.selection.length;
    if (n === 0) {
      this.selInfo.textContent = "";
    } else if (n === 1) {
      const el = store.selectedElements()[0];
      this.selInfo.textContent = el ? `${el.name}` : "";
    } else {
      this.selInfo.textContent = `${n}개 선택`;
    }
  }
}
