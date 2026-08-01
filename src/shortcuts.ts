import { store } from "./state/store";
import {
  copySelection, cutSelection, deleteSelection, duplicateSelection,
  exportAIFile, groupSelection, openProjectFile, paste, reorder,
  saveProjectFile, selectAll, selectParent, ungroupSelection
} from "./actions";
import { buildElementIndex, findElement } from "./model/doc";
import { buildWorldMap, writeLocalRect } from "./model/geometry";
import type { CanvasView } from "./ui/canvasView";
import { closeMenus } from "./ui/contextmenu";

export function initShortcuts(canvas: CanvasView): void {
  window.addEventListener("keydown", (e) => {
    if (isEditable(e.target)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (ctrl) {
      switch (key) {
        case "z":
          e.preventDefault();
          if (e.shiftKey) store.redo();
          else store.undo();
          return;
        case "y":
          e.preventDefault();
          store.redo();
          return;
        case "c":
          e.preventDefault();
          copySelection();
          return;
        case "x":
          e.preventDefault();
          cutSelection();
          return;
        case "v":
          e.preventDefault();
          paste();
          return;
        case "d":
          e.preventDefault();
          duplicateSelection();
          return;
        case "a":
          e.preventDefault();
          selectAll();
          return;
        case "g":
          e.preventDefault();
          if (e.shiftKey) ungroupSelection();
          else groupSelection();
          return;
        case "s":
          e.preventDefault();
          saveProjectFile();
          return;
        case "e":
          e.preventDefault();
          exportAIFile();
          return;
        case "o":
          e.preventDefault();
          openProjectFile();
          return;
        case "0":
          e.preventDefault();
          canvas.fitToView();
          return;
        case "1":
          e.preventDefault();
          canvas.zoomTo100();
          return;
        case "=":
        case "+":
          e.preventDefault();
          canvas.setZoom(store.view.zoom * 1.25);
          return;
        case "-":
          e.preventDefault();
          canvas.setZoom(store.view.zoom / 1.25);
          return;
        case "'":
          e.preventDefault();
          store.updateSettings({ showGrid: !store.settings.showGrid });
          return;
        case "]":
          e.preventDefault();
          reorder(e.shiftKey ? "front" : "forward");
          return;
        case "[":
          e.preventDefault();
          reorder(e.shiftKey ? "back" : "backward");
          return;
      }
      return;
    }

    switch (key) {
      case "v":
      case "w":
        store.setTool("select");
        return;
      case "h":
      case "q":
        store.setTool("hand");
        return;
      case "r":
      case "b":
        store.setTool("draw");
        return;
      case "m":
        store.setTool("measure");
        return;
      case "f":
        e.preventDefault();
        canvas.frameSelection();
        return;
      case "delete":
      case "backspace":
        e.preventDefault();
        deleteSelection();
        return;
      case "escape":
        closeMenus();
        if (canvas.cancelMeasure()) return;
        if (store.selection.length === 1) {
          const found = findElement(store.doc, store.selection[0]);
          if (found?.parent) {
            selectParent();
            return;
          }
        }
        store.clearSelection();
        return;
      case "arrowleft":
      case "arrowright":
      case "arrowup":
      case "arrowdown": {
        if (store.selection.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        nudgeSelection(dx, dy);
        return;
      }
    }
  });

  window.addEventListener("beforeunload", (e) => {
    // 디바운스 대기 중인 자동저장을 흘려보내 마지막 편집을 잃지 않도록 한다
    store.flushAutosave();
    // 자동저장이 정상이면 닫아도 잃는 것이 없다 — 실패 상태일 때만 경고한다
    if (store.persistState.kind === "failed") {
      e.preventDefault();
    }
  });
}

function nudgeSelection(dx: number, dy: number): void {
  const ids = store.editableSelection();
  if (ids.length === 0) return;
  store.beginChange();
  // 요소마다 worldInfoOf를 부르면 선택이 클 때 제곱으로 느려진다
  const world = buildWorldMap(store.doc);
  const index = buildElementIndex(store.doc);
  for (const id of ids) {
    const el = index.get(id)?.el;
    const info = world.get(id);
    if (!el || !info) continue;
    writeLocalRect(el, info.parentW, info.parentH, {
      x: info.localRect.x + dx,
      y: info.localRect.y + dy,
      w: info.localRect.w,
      h: info.localRect.h
    });
  }
  store.commit();
}

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
