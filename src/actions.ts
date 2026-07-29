import { store } from "./state/store";
import type { Artboard, OPElement, Rect } from "./types";
import {
  cloneDoc, createArtboard, createElement, findArtboard, findElement,
  genId, isAncestor, parseProject, reassignIds, serializeForAI, serializeProject
} from "./model/doc";
import { localRectOf, worldInfoOf, writeLocalRect } from "./model/geometry";
import { toast } from "./ui/toast";

/* ---------- 선택 ---------- */

export function selectAll(): void {
  const ab = store.activeArtboard();
  store.select(ab.children.filter((e) => !e.locked && e.visible).map((e) => e.id));
}

export function selectParent(): void {
  if (store.selection.length !== 1) return;
  const found = findElement(store.doc, store.selection[0]);
  if (found?.parent) store.select([found.parent.id]);
}

/* ---------- 삭제 · 복제 ---------- */

export function deleteSelection(): void {
  const ids = store.topLevelSelection();
  if (ids.length === 0) return;
  store.beginChange();
  for (const id of ids) {
    const found = findElement(store.doc, id);
    if (found) found.siblings.splice(found.siblings.indexOf(found.el), 1);
  }
  store.selection = [];
  store.commit();
}

export function duplicateSelection(): void {
  const ids = store.topLevelSelection();
  if (ids.length === 0) return;
  store.beginChange();
  const newIds: string[] = [];
  for (const id of ids) {
    const found = findElement(store.doc, id);
    if (!found) continue;
    const copy = reassignIds(cloneDoc(found.el));
    copy.x += found.el.units.x === "%" ? 2 : 16;
    copy.y += found.el.units.y === "%" ? 2 : 16;
    found.siblings.splice(found.index + 1, 0, copy);
    newIds.push(copy.id);
  }
  store.selection = newIds;
  store.commit();
}

/* ---------- 클립보드 ---------- */

let internalClipboard: OPElement[] = [];

export function copySelection(): void {
  const ids = store.topLevelSelection();
  if (ids.length === 0) return;
  internalClipboard = ids
    .map((id) => findElement(store.doc, id)?.el)
    .filter((el): el is OPElement => !!el)
    .map((el) => cloneDoc(el));
  void navigator.clipboard?.writeText(JSON.stringify(internalClipboard, null, 2)).catch(() => {});
  toast(`${internalClipboard.length}개 요소 복사됨`);
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

export function paste(): void {
  if (internalClipboard.length === 0) return;
  store.beginChange();
  const ab = store.activeArtboard();
  const newIds: string[] = [];
  for (const el of internalClipboard) {
    const copy = reassignIds(cloneDoc(el));
    copy.x += copy.units.x === "%" ? 2 : 16;
    copy.y += copy.units.y === "%" ? 2 : 16;
    ab.children.push(copy);
    newIds.push(copy.id);
  }
  store.selection = newIds;
  store.commit();
}

/* ---------- 그룹 ---------- */

export function groupSelection(): void {
  const ids = store.topLevelSelection();
  if (ids.length < 1) return;
  const firsts = ids.map((id) => findElement(store.doc, id)!).filter(Boolean);
  // 동일 부모 하위만 그룹화
  const parentId = firsts[0].parent?.id ?? null;
  if (!firsts.every((f) => (f.parent?.id ?? null) === parentId)) {
    toast("같은 부모에 속한 요소만 그룹화할 수 있습니다");
    return;
  }
  store.beginChange();
  const found = ids.map((id) => findElement(store.doc, id)!);
  const artboard = found[0].artboard;
  const parent = found[0].parent;
  const parentW = parent ? worldInfoOf(store.doc, parent.id)!.w : artboard.width;
  const parentH = parent ? worldInfoOf(store.doc, parent.id)!.h : artboard.height;

  const rects = found.map((f) => localRectOf(f.el, parentW, parentH));
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  const groupRect: Rect = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

  const group = createElement({
    type: "panel",
    name: "그룹",
    color: "#5B6478"
  });
  writeLocalRect(group, parentW, parentH, groupRect);

  const siblings = parent ? parent.children : artboard.children;
  const sorted = found
    .map((f) => ({ f, idx: siblings.indexOf(f.el) }))
    .sort((a, b) => a.idx - b.idx);
  const insertAt = Math.min(...sorted.map((s) => s.idx));

  for (const { f } of sorted) {
    const r = localRectOf(f.el, parentW, parentH);
    siblings.splice(siblings.indexOf(f.el), 1);
    f.el.units = { x: "px", y: "px", width: "px", height: "px" };
    f.el.anchor = "top-left";
    writeLocalRect(f.el, groupRect.w, groupRect.h, { x: r.x - minX, y: r.y - minY, w: r.w, h: r.h });
    group.children.push(f.el);
  }
  siblings.splice(Math.min(insertAt, siblings.length), 0, group);
  store.selection = [group.id];
  store.commit();
}

export function ungroupSelection(): void {
  const ids = store.topLevelSelection();
  if (ids.length === 0) return;
  store.beginChange();
  const newIds: string[] = [];
  let changed = false;
  for (const id of ids) {
    const found = findElement(store.doc, id);
    if (!found || found.el.children.length === 0) {
      if (found) newIds.push(found.el.id);
      continue;
    }
    const { el, siblings, artboard, parent } = found;
    const parentW = parent ? worldInfoOf(store.doc, parent.id)!.w : artboard.width;
    const parentH = parent ? worldInfoOf(store.doc, parent.id)!.h : artboard.height;
    const groupRect = localRectOf(el, parentW, parentH);
    const idx = siblings.indexOf(el);
    const children = [...el.children];
    for (const child of children) {
      const r = localRectOf(child, groupRect.w, groupRect.h);
      child.units = { x: "px", y: "px", width: "px", height: "px" };
      child.anchor = "top-left";
      child.rotation += el.rotation;
      writeLocalRect(child, parentW, parentH, {
        x: groupRect.x + r.x, y: groupRect.y + r.y, w: r.w, h: r.h
      });
      newIds.push(child.id);
    }
    siblings.splice(idx, 1, ...children);
    changed = true;
  }
  if (!changed) {
    store.cancelChange();
    return;
  }
  store.selection = newIds;
  store.commit();
}

/* ---------- Z 순서 ---------- */

export function reorder(direction: "front" | "back" | "forward" | "backward"): void {
  const ids = store.topLevelSelection();
  if (ids.length === 0) return;
  store.beginChange();
  for (const id of ids) {
    const found = findElement(store.doc, id);
    if (!found) continue;
    const { siblings, el } = found;
    const idx = siblings.indexOf(el);
    siblings.splice(idx, 1);
    let target = idx;
    switch (direction) {
      case "front": target = siblings.length; break;
      case "back": target = 0; break;
      case "forward": target = Math.min(siblings.length, idx + 1); break;
      case "backward": target = Math.max(0, idx - 1); break;
    }
    siblings.splice(target, 0, el);
  }
  store.commit();
}

/* ---------- 정렬 · 분배 ---------- */

export type AlignOp = "left" | "center-h" | "right" | "top" | "center-v" | "bottom";

export function align(op: AlignOp): void {
  const ids = store.topLevelSelection();
  if (ids.length === 0) return;
  store.beginChange();
  const found = ids.map((id) => findElement(store.doc, id)!).filter(Boolean);

  // 기준 영역: 다중 선택 → 선택 묶음 AABB(부모 좌표계), 단일 선택 → 부모 콘텐츠 영역
  const items = found.map((f) => {
    const parent = f.parent;
    const pw = parent ? worldInfoOf(store.doc, parent.id)!.w : f.artboard.width;
    const ph = parent ? worldInfoOf(store.doc, parent.id)!.h : f.artboard.height;
    return { f, pw, ph, rect: localRectOf(f.el, pw, ph) };
  });

  let bounds: Rect;
  if (items.length > 1) {
    const minX = Math.min(...items.map((i) => i.rect.x));
    const minY = Math.min(...items.map((i) => i.rect.y));
    const maxX = Math.max(...items.map((i) => i.rect.x + i.rect.w));
    const maxY = Math.max(...items.map((i) => i.rect.y + i.rect.h));
    bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  } else {
    bounds = { x: 0, y: 0, w: items[0].pw, h: items[0].ph };
  }

  for (const it of items) {
    const r = { ...it.rect };
    switch (op) {
      case "left": r.x = bounds.x; break;
      case "center-h": r.x = bounds.x + (bounds.w - r.w) / 2; break;
      case "right": r.x = bounds.x + bounds.w - r.w; break;
      case "top": r.y = bounds.y; break;
      case "center-v": r.y = bounds.y + (bounds.h - r.h) / 2; break;
      case "bottom": r.y = bounds.y + bounds.h - r.h; break;
    }
    writeLocalRect(it.f.el, it.pw, it.ph, r);
  }
  store.commit();
}

export function distribute(axis: "h" | "v"): void {
  const ids = store.topLevelSelection();
  if (ids.length < 3) {
    toast("등간격 분배는 3개 이상 선택 시 사용할 수 있습니다");
    return;
  }
  store.beginChange();
  const found = ids.map((id) => findElement(store.doc, id)!).filter(Boolean);
  const items = found.map((f) => {
    const parent = f.parent;
    const pw = parent ? worldInfoOf(store.doc, parent.id)!.w : f.artboard.width;
    const ph = parent ? worldInfoOf(store.doc, parent.id)!.h : f.artboard.height;
    return { f, pw, ph, rect: localRectOf(f.el, pw, ph) };
  });

  const key = axis === "h" ? "x" : "y";
  const size = axis === "h" ? "w" : "h";
  items.sort((a, b) => (a.rect as never as Record<string, number>)[key] - (b.rect as never as Record<string, number>)[key]);
  const first = items[0].rect as never as Record<string, number>;
  const last = items[items.length - 1].rect as never as Record<string, number>;
  const total = last[key] + last[size] - first[key];
  const occupied = items.reduce((s, i) => s + (i.rect as never as Record<string, number>)[size], 0);
  const gap = (total - occupied) / (items.length - 1);

  let cursor = first[key];
  for (const it of items) {
    const r = it.rect as never as Record<string, number>;
    r[key] = cursor;
    cursor += r[size] + gap;
    writeLocalRect(it.f.el, it.pw, it.ph, it.rect);
  }
  store.commit();
}

/* ---------- 표시 · 잠금 ---------- */

export function toggleVisible(): void {
  const els = store.selectedElements();
  if (els.length === 0) return;
  store.beginChange();
  const target = !els.every((e) => e.visible === false);
  for (const el of els) el.visible = !target ? true : false;
  store.commit();
}

export function toggleLocked(): void {
  const els = store.selectedElements();
  if (els.length === 0) return;
  store.beginChange();
  const anyUnlocked = els.some((e) => !e.locked);
  for (const el of els) el.locked = anyUnlocked;
  store.commit();
}

/* ---------- 아트보드 ---------- */

export function addArtboard(name: string, width: number, height: number): void {
  store.beginChange();
  const maxRight = Math.max(...store.doc.artboards.map((a) => a.position.x + a.width), 0);
  const minTop = Math.min(...store.doc.artboards.map((a) => a.position.y), 0);
  const ab = createArtboard({
    name,
    width,
    height,
    position: { x: maxRight + 160, y: minTop }
  });
  store.doc.artboards.push(ab);
  store.activeArtboardId = ab.id;
  store.selection = [];
  store.commit();
}

export function duplicateArtboard(id: string): void {
  const src = findArtboard(store.doc, id);
  if (!src) return;
  store.beginChange();
  const copy = cloneDoc(src);
  copy.id = genId("ab");
  copy.name = `${src.name} 사본`;
  copy.position = { x: src.position.x + src.width + 160, y: src.position.y };
  copy.children.forEach(reassignIds);
  const idx = store.doc.artboards.findIndex((a) => a.id === id);
  store.doc.artboards.splice(idx + 1, 0, copy);
  store.activeArtboardId = copy.id;
  store.selection = [];
  store.commit();
}

export function deleteArtboard(id: string): void {
  if (store.doc.artboards.length <= 1) {
    toast("마지막 아트보드는 삭제할 수 없습니다");
    return;
  }
  store.beginChange();
  store.doc.artboards = store.doc.artboards.filter((a) => a.id !== id);
  if (store.activeArtboardId === id) {
    store.activeArtboardId = store.doc.artboards[0].id;
  }
  store.selection = store.selection.filter((sid) => findElement(store.doc, sid));
  store.commit();
}

/* ---------- 계층 이동 (레이어 패널 드래그) ---------- */

export function moveInTree(
  dragIds: string[],
  target: { artboardId: string; parentId: string | null; index: number }
): void {
  const ids = dragIds.filter((id) => {
    // 자기 자신 혹은 자신의 자손으로 이동 금지
    if (target.parentId && (id === target.parentId || isAncestor(store.doc, id, target.parentId))) return false;
    return true;
  });
  if (ids.length === 0) return;
  store.beginChange();
  const ab = findArtboard(store.doc, target.artboardId);
  if (!ab) { store.cancelChange(); return; }

  const moved: OPElement[] = [];
  for (const id of ids) {
    const found = findElement(store.doc, id);
    if (!found) continue;
    found.siblings.splice(found.siblings.indexOf(found.el), 1);
    moved.push(found.el);
  }

  const targetList = target.parentId
    ? findElement(store.doc, target.parentId)?.el.children
    : ab.children;
  if (!targetList) { store.cancelChange(); return; }
  const idx = Math.max(0, Math.min(target.index, targetList.length));
  targetList.splice(idx, 0, ...moved);

  // 새 부모 좌표계에 맞춰 로컬 좌표 재계산은 단순화: px 기준 유지
  store.commit();
}

/* ---------- 파일 입출력 ---------- */

export function saveProjectFile(): void {
  const text = serializeProject(store.doc);
  downloadText(text, `${sanitizeFileName(store.doc.meta.name)}.opl.json`);
  store.dirty = false;
  toast("프로젝트 저장됨");
}

export function exportAIFile(): void {
  const text = serializeForAI(store.doc);
  downloadText(text, `${sanitizeFileName(store.doc.meta.name)}.layout.json`);
  toast("AI용 레이아웃 JSON 내보내기 완료");
}

export async function copyAIToClipboard(): Promise<void> {
  const text = serializeForAI(store.doc);
  try {
    await navigator.clipboard.writeText(text);
    toast("AI용 레이아웃 JSON이 클립보드에 복사되었습니다");
  } catch {
    toast("클립보드 접근이 거부되었습니다");
  }
}

export async function importFromClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    importText(text);
  } catch {
    toast("클립보드 접근이 거부되었습니다 · 파일 열기를 이용하세요");
  }
}

export function importText(text: string): void {
  try {
    const doc = parseProject(text);
    store.replaceDoc(doc);
    toast(`불러오기 완료 · 아트보드 ${doc.artboards.length}개`);
  } catch (e) {
    toast(`불러오기 실패 · ${(e as Error).message}`);
  }
}

export function openProjectFile(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then(importText);
  };
  input.click();
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function sanitizeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, "_");
  return cleaned || "overlayplacer";
}

/* ---------- 배경 이미지 ---------- */

export function loadBackgroundImage(artboard: Artboard): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      store.beginChange();
      const ab = findArtboard(store.doc, artboard.id);
      if (!ab) { store.cancelChange(); return; }
      ab.background.image = reader.result as string;
      store.commit();
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

export function clearBackgroundImage(artboard: Artboard): void {
  store.beginChange();
  const ab = findArtboard(store.doc, artboard.id);
  if (!ab) { store.cancelChange(); return; }
  ab.background.image = null;
  store.commit();
}
