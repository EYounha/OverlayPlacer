import { store } from "../state/store";
import { h, icon } from "./dom";
import type { CanvasView } from "./canvasView";

export class StatusBar {
  root: HTMLElement;
  private coords: HTMLElement;
  private selInfo: HTMLElement;
  private persist: HTMLElement;
  private zoomLabel: HTMLElement;

  constructor(private canvas: CanvasView) {
    this.coords = h("span", { class: "status-item" }, "0, 0");
    this.selInfo = h("span", { class: "status-item" }, "");
    this.persist = h("span", { class: "status-persist" }, "");
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
      this.persist,
      h("button", {
        class: "status-btn", title: "축소",
        onclick: () => this.canvas.setZoom(store.view.zoom / 1.25)
      }, icon("zoomOut", 15)),
      this.zoomLabel,
      h("button", {
        class: "status-btn", title: "확대",
        onclick: () => this.canvas.setZoom(store.view.zoom * 1.25)
      }, icon("zoomIn", 15)),
      h("button", {
        class: "status-btn", title: "선택 프레임 (F)",
        onclick: () => this.canvas.frameSelection()
      }, icon("frame", 14)),
      h("button", {
        class: "status-btn", title: "화면에 맞추기 (Ctrl+0)",
        onclick: () => this.canvas.fitToView()
      }, icon("fitScreen", 15))
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
    store.on("persist", () => this.syncPersist());
  }

  private syncPersist(): void {
    const state = store.persistState;
    if (state.kind === "failed") {
      this.persist.textContent = `⚠ ${state.reason} · 파일로 저장하세요`;
      this.persist.className = "status-persist failed";
      this.persist.title =
        "브라우저 자동 저장이 실패했습니다. 파일 > 프로젝트 저장으로 직접 저장하세요.";
    } else {
      this.persist.textContent = "";
      this.persist.className = "status-persist";
      this.persist.title = "";
    }
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
