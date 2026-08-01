import type { MenuItem } from "./contextmenu";
import { store } from "../state/store";
import {
  align, copySelection, cutSelection, deleteSelection, distribute,
  duplicateSelection, groupSelection, measureSelection, paste, reorder,
  toggleLocked, toggleVisible, ungroupSelection, type AlignTo
} from "../actions";

function alignItems(to: AlignTo): MenuItem[] {
  return [
    { label: "왼쪽 정렬", action: () => align("left", to) },
    { label: "가로 가운데 정렬", action: () => align("center-h", to) },
    { label: "오른쪽 정렬", action: () => align("right", to) },
    { separator: true },
    { label: "위쪽 정렬", action: () => align("top", to) },
    { label: "세로 가운데 정렬", action: () => align("center-v", to) },
    { label: "아래쪽 정렬", action: () => align("bottom", to) }
  ];
}

export function buildAlignMenu(): MenuItem[] {
  return [
    ...alignItems("selection"),
    { separator: true },
    { label: "부모 영역 기준", children: alignItems("parent") },
    { label: "기준 개체에 맞춤", children: alignItems("key") },
    { separator: true },
    { label: "가로 등간격 분배", action: () => distribute("h") },
    { label: "세로 등간격 분배", action: () => distribute("v") }
  ];
}

export function buildOrderMenu(): MenuItem[] {
  return [
    { label: "맨 앞으로 가져오기", shortcut: "Ctrl+Shift+]", action: () => reorder("front") },
    { label: "앞으로 가져오기", shortcut: "Ctrl+]", action: () => reorder("forward") },
    { label: "뒤로 보내기", shortcut: "Ctrl+[", action: () => reorder("backward") },
    { label: "맨 뒤로 보내기", shortcut: "Ctrl+Shift+[", action: () => reorder("back") }
  ];
}

export function buildElementContextMenu(): MenuItem[] {
  const hasSel = store.selection.length > 0;
  const els = store.selectedElements();
  const anyGroup = els.some((e) => e.children.length > 0);
  return [
    { label: "잘라내기", shortcut: "Ctrl+X", disabled: !hasSel, action: cutSelection },
    { label: "복사", shortcut: "Ctrl+C", disabled: !hasSel, action: copySelection },
    { label: "붙여넣기", shortcut: "Ctrl+V", action: paste },
    { label: "복제", shortcut: "Ctrl+D", disabled: !hasSel, action: duplicateSelection },
    { separator: true },
    { label: "그룹", shortcut: "Ctrl+G", disabled: store.selection.length < 2, action: groupSelection },
    { label: "그룹 해제", shortcut: "Ctrl+Shift+G", disabled: !anyGroup, action: ungroupSelection },
    { separator: true },
    { label: "순서", children: buildOrderMenu() },
    { label: "정렬", children: buildAlignMenu() },
    {
      label: "치수선 추가",
      disabled: store.selection.length !== 2,
      action: measureSelection
    },
    { separator: true },
    {
      label: els.every((e) => !e.visible) ? "표시" : "숨기기",
      disabled: !hasSel,
      action: toggleVisible
    },
    {
      label: els.every((e) => e.locked) ? "잠금 해제" : "잠금",
      disabled: !hasSel,
      action: toggleLocked
    },
    { separator: true },
    { label: "삭제", shortcut: "Del", disabled: !hasSel, action: deleteSelection }
  ];
}
