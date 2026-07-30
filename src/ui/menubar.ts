import { store } from "../state/store";
import {
  copyAIToClipboard, copySelection, cutSelection, deleteSelection,
  duplicateSelection, exportAIFile, groupSelection, importFromClipboard,
  openProjectFile, paste, saveProjectFile, selectAll, toggleLocked,
  toggleVisible, ungroupSelection
} from "../actions";
import { h } from "./dom";
import { showMenu, closeMenus, type MenuItem } from "./contextmenu";
import { buildAlignMenu, buildOrderMenu } from "./sharedMenus";
import { aboutDialog, aiGuideDialog, confirmDialog, newArtboardDialog, shortcutsDialog } from "./dialogs";
import type { CanvasView } from "./canvasView";

export class MenuBar {
  root: HTMLElement;
  private title: HTMLElement;

  constructor(private canvas: CanvasView) {
    this.title = h("span", { class: "menubar-title" }, store.doc.meta.name);
    const menus: [string, () => MenuItem[]][] = [
      ["파일", () => this.fileMenu()],
      ["편집", () => this.editMenu()],
      ["보기", () => this.viewMenu()],
      ["개체", () => this.objectMenu()],
      ["도움말", () => this.helpMenu()]
    ];
    this.root = h(
      "div",
      { class: "menubar" },
      h("div", { class: "menubar-logo" }, "OverlayPlacer"),
      ...menus.map(([label, build]) =>
        h("button", {
          class: "menubar-item",
          onclick: (e: MouseEvent) => {
            const btn = e.currentTarget as HTMLElement;
            const r = btn.getBoundingClientRect();
            showMenu(build(), r.left, r.bottom + 2);
          }
        }, label)
      ),
      h("div", { class: "menubar-spacer" }),
      this.title
    );
    store.on("doc", () => {
      this.title.textContent = store.doc.meta.name;
    });
  }

  private fileMenu(): MenuItem[] {
    return [
      {
        label: "새 프로젝트",
        action: () => confirmDialog(
          "새 프로젝트",
          "현재 작업 내용을 대체합니다. 저장하지 않은 변경 사항은 사라집니다.",
          "새로 만들기",
          () => store.newProject()
        )
      },
      { label: "열기…", shortcut: "Ctrl+O", action: openProjectFile },
      { label: "프로젝트 저장", shortcut: "Ctrl+S", action: saveProjectFile },
      { separator: true },
      { label: "AI용 JSON 내보내기", shortcut: "Ctrl+E", action: exportAIFile },
      { label: "AI용 JSON 클립보드 복사", action: () => void copyAIToClipboard() },
      { label: "클립보드에서 가져오기", action: () => void importFromClipboard() },
      { separator: true },
      { label: "새 아트보드…", action: newArtboardDialog }
    ];
  }

  private editMenu(): MenuItem[] {
    return [
      { label: "실행 취소", shortcut: "Ctrl+Z", disabled: !store.canUndo(), action: () => store.undo() },
      { label: "다시 실행", shortcut: "Ctrl+Y", disabled: !store.canRedo(), action: () => store.redo() },
      { separator: true },
      { label: "잘라내기", shortcut: "Ctrl+X", disabled: store.selection.length === 0, action: cutSelection },
      { label: "복사", shortcut: "Ctrl+C", disabled: store.selection.length === 0, action: copySelection },
      { label: "붙여넣기", shortcut: "Ctrl+V", action: paste },
      { label: "복제", shortcut: "Ctrl+D", disabled: store.selection.length === 0, action: duplicateSelection },
      { label: "삭제", shortcut: "Del", disabled: store.selection.length === 0, action: deleteSelection },
      { separator: true },
      { label: "전체 선택", shortcut: "Ctrl+A", action: selectAll }
    ];
  }

  private viewMenu(): MenuItem[] {
    const s = store.settings;
    return [
      { label: "확대", shortcut: "Ctrl++", action: () => this.canvas.setZoom(store.view.zoom * 1.25) },
      { label: "축소", shortcut: "Ctrl+-", action: () => this.canvas.setZoom(store.view.zoom / 1.25) },
      { label: "선택 프레임", shortcut: "F", action: () => this.canvas.frameSelection() },
      { label: "화면에 맞추기", shortcut: "Ctrl+0", action: () => this.canvas.fitToView() },
      { label: "100%", shortcut: "Ctrl+1", action: () => this.canvas.zoomTo100() },
      { separator: true },
      { label: "격자", shortcut: "Ctrl+'", checked: s.showGrid, action: () => store.updateSettings({ showGrid: !s.showGrid }) },
      { label: "가이드", checked: s.showGuides, action: () => store.updateSettings({ showGuides: !s.showGuides }) },
      { label: "세로 가이드 추가", action: () => this.canvas.addGuide("v") },
      { label: "가로 가이드 추가", action: () => this.canvas.addGuide("h") },
      { separator: true },
      { label: "요소에 스냅", checked: s.snapElements, action: () => store.updateSettings({ snapElements: !s.snapElements }) },
      { label: "가이드에 스냅", checked: s.snapGuides, action: () => store.updateSettings({ snapGuides: !s.snapGuides }) },
      { label: "격자에 스냅", checked: s.snapGrid, action: () => store.updateSettings({ snapGrid: !s.snapGrid }) }
    ];
  }

  private objectMenu(): MenuItem[] {
    const hasSel = store.selection.length > 0;
    const els = store.selectedElements();
    return [
      { label: "그룹", shortcut: "Ctrl+G", disabled: store.selection.length < 2, action: groupSelection },
      {
        label: "그룹 해제", shortcut: "Ctrl+Shift+G",
        disabled: !els.some((e) => e.children.length > 0),
        action: ungroupSelection
      },
      { separator: true },
      { label: "순서", children: buildOrderMenu() },
      { label: "정렬", children: buildAlignMenu() },
      { separator: true },
      { label: els.length > 0 && els.every((e) => !e.visible) ? "표시" : "숨기기", disabled: !hasSel, action: toggleVisible },
      { label: els.length > 0 && els.every((e) => e.locked) ? "잠금 해제" : "잠금", disabled: !hasSel, action: toggleLocked }
    ];
  }

  private helpMenu(): MenuItem[] {
    return [
      { label: "AI 연동 가이드", action: aiGuideDialog },
      { label: "단축키", action: shortcutsDialog },
      { separator: true },
      { label: "정보", action: aboutDialog }
    ];
  }
}

export { closeMenus };
