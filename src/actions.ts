import { store } from "./state/store";
import type { Artboard, Measure, OPElement, Point, Rect } from "./types";
import {
  ancestorsOf, cloneDoc, createArtboard, createElement, findArtboard, findElement,
  genId, isAncestor, parseProject, pruneMeasures, reassignIds, serializeForAI,
  serializeProject
} from "./model/doc";
import {
  applyMat, buildWorldMap, localRectOf, matInvert, matMul, matRotateDeg, matTranslate,
  parentWorldMatrix, worldInfoOf, writeLocalRect, type Mat
} from "./model/geometry";
import { dominantAxis, measureDelta, measureGeom } from "./model/measure";
import { toast } from "./ui/toast";
import { imagesReady, registerImage } from "./state/imageStore";
import { openTextFile, readClipboardText, saveTextFile, writeClipboardText } from "./platform";
import type { ProjectDoc } from "./types";

/**
 * 요소의 로컬 좌표계 -> 부모 좌표계 변환.
 * worldInfoOf와 같은 규칙(원점 이동 후 요소 중심 기준 회전)을 따른다.
 */
function groupLocalToParent(rect: Rect, rotation: number): Mat {
  const base = matTranslate(rect.x, rect.y);
  if (rotation === 0) return base;
  return matMul(
    base,
    matMul(
      matTranslate(rect.w / 2, rect.h / 2),
      matMul(matRotateDeg(rotation), matTranslate(-rect.w / 2, -rect.h / 2))
    )
  );
}

/** -180 ~ 180 범위로 정규화 */
function normalizeAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

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
  // 치수선이 선택돼 있으면 그것이 삭제 대상이다 (요소 선택과 배타적)
  const picked = store.selectedMeasure();
  if (picked) {
    deleteMeasure(picked.artboard.id, picked.measure.id);
    return;
  }
  const ids = store.editableSelection();
  if (ids.length === 0) return;
  store.beginChange();
  for (const id of ids) {
    const found = findElement(store.doc, id);
    if (found) found.siblings.splice(found.siblings.indexOf(found.el), 1);
  }
  // 사라진 요소를 가리키는 치수선은 문서에 남기지 않는다
  pruneMeasures(store.doc);
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
    // 원본은 그대로 두므로 잠긴 요소도 복제할 수 있다.
    // 다만 사본은 바로 편집할 수 있어야 하므로 잠금을 푼다.
    copy.locked = false;
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
  // 시스템 클립보드에는 다시 가져올 수 있는 형식으로 쓴다
  void writeClipboardText(JSON.stringify(
    { format: "overlayplacer-clip", version: 1, elements: internalClipboard }, null, 2
  ));
  toast(`${internalClipboard.length}개 요소 복사됨`);
}

export function cutSelection(): void {
  copySelection();
  deleteSelection();
}

function insertElements(els: OPElement[]): void {
  if (els.length === 0) return;
  store.beginChange();
  const ab = store.activeArtboard();
  const newIds: string[] = [];
  for (const el of els) {
    const copy = reassignIds(cloneDoc(el));
    copy.x += copy.units.x === "%" ? 2 : 16;
    copy.y += copy.units.y === "%" ? 2 : 16;
    ab.children.push(copy);
    newIds.push(copy.id);
  }
  store.selection = newIds;
  store.commit();
}

/**
 * 붙여넣기. 앱 내부 클립보드를 우선 쓰고, 비어 있으면 시스템 클립보드를
 * 해석한다 — 요소 묶음(overlayplacer-clip)은 삽입, 전체 레이아웃 문서는
 * 확인 후 가져온다. AI가 준 JSON을 Ctrl+V로 바로 넣는 핵심 경로다.
 */
export async function paste(): Promise<void> {
  if (internalClipboard.length > 0) {
    insertElements(internalClipboard);
    return;
  }
  const text = await readClipboardText();
  if (!text) return;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return; // 일반 텍스트 — 붙여넣을 것 없음
  }
  if (typeof raw !== "object" || raw === null) return;
  const r = raw as Record<string, unknown>;
  if (r.format === "overlayplacer-clip" && Array.isArray(r.elements)) {
    // 관용 파서를 재사용하기 위해 임시 문서로 감싼다
    try {
      const doc = parseProject(JSON.stringify({
        artboards: [{ width: 1920, height: 1080, children: r.elements }]
      }));
      insertElements(doc.artboards[0].children);
      toast(`${doc.artboards[0].children.length}개 요소 붙여넣음`);
    } catch {
      toast("붙여넣을 수 없는 형식입니다");
    }
    return;
  }
  if (Array.isArray(r.artboards) || Array.isArray(r.children) || Array.isArray(r.elements)) {
    importText(text);
  }
}

/* ---------- 그룹 ---------- */

export function groupSelection(): void {
  const ids = store.editableSelection();
  if (ids.length < 2) return;
  const found = ids
    .map((id) => findElement(store.doc, id))
    .filter((f): f is NonNullable<typeof f> => !!f);
  if (found.length < 2) return;
  // 동일 부모 하위만 그룹화
  const parentId = found[0].parent?.id ?? null;
  if (!found.every((f) => (f.parent?.id ?? null) === parentId)) {
    toast("같은 부모에 속한 요소만 그룹화할 수 있습니다");
    return;
  }
  store.beginChange();
  const artboard = found[0].artboard;
  const parent = found[0].parent;
  const parentW = parent ? worldInfoOf(store.doc, parent.id)!.w : artboard.width;
  const parentH = parent ? worldInfoOf(store.doc, parent.id)!.h : artboard.height;

  // 회전된 자식은 비회전 사각형이 아니라 회전 반영 AABB로 감싸야 한다
  const rects = found.map((f) => {
    const r = localRectOf(f.el, parentW, parentH);
    if (!f.el.rotation) return r;
    const rad = (f.el.rotation * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const w = r.w * cos + r.h * sin;
    const hh = r.w * sin + r.h * cos;
    return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - hh / 2, w, h: hh };
  });
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
  const ids = store.editableSelection();
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
    // 그룹 로컬 -> 부모 좌표계 변환. 그룹이 회전해 있으면 자식 위치도
    // 그 회전을 따라 옮겨야 하므로 평행이동만으로는 어긋난다.
    const groupMat = groupLocalToParent(groupRect, el.rotation);
    for (const child of children) {
      const r = localRectOf(child, groupRect.w, groupRect.h);
      const center = applyMat(groupMat, { x: r.x + r.w / 2, y: r.y + r.h / 2 });
      child.units = { x: "px", y: "px", width: "px", height: "px" };
      child.anchor = "top-left";
      child.rotation = normalizeAngle(child.rotation + el.rotation);
      writeLocalRect(child, parentW, parentH, {
        x: center.x - r.w / 2, y: center.y - r.h / 2, w: r.w, h: r.h
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
  const ids = store.editableSelection();
  if (ids.length === 0) return;
  store.beginChange();

  // 형제 배열 단위로 묶는다 — 선택이 여러 부모에 걸칠 수 있다
  const groups = new Map<OPElement[], OPElement[]>();
  for (const id of ids) {
    const found = findElement(store.doc, id);
    if (!found) continue;
    const list = groups.get(found.siblings) ?? [];
    list.push(found.el);
    groups.set(found.siblings, list);
  }

  for (const [siblings, els] of groups) {
    // z순서(배열 순서) 기준 오름차순으로 정리해 상대 순서를 보존한다
    els.sort((a, b) => siblings.indexOf(a) - siblings.indexOf(b));
    const selected = new Set(els);
    switch (direction) {
      case "front": {
        for (const el of els) siblings.splice(siblings.indexOf(el), 1);
        siblings.push(...els);
        break;
      }
      case "back": {
        for (const el of els) siblings.splice(siblings.indexOf(el), 1);
        siblings.unshift(...els);
        break;
      }
      case "forward": {
        // 위(뒤쪽 인덱스)부터 처리해야 선택끼리 서로 뛰어넘지 않는다
        for (let i = els.length - 1; i >= 0; i--) {
          const idx = siblings.indexOf(els[i]);
          if (idx >= siblings.length - 1) continue;
          if (selected.has(siblings[idx + 1])) continue;
          siblings.splice(idx, 1);
          siblings.splice(idx + 1, 0, els[i]);
        }
        break;
      }
      case "backward": {
        for (const el of els) {
          const idx = siblings.indexOf(el);
          if (idx <= 0) continue;
          if (selected.has(siblings[idx - 1])) continue;
          siblings.splice(idx, 1);
          siblings.splice(idx - 1, 0, el);
        }
        break;
      }
    }
  }
  store.commit();
}

/* ---------- 정렬 · 분배 ---------- */

export type AlignOp = "left" | "center-h" | "right" | "top" | "center-v" | "bottom";
/**
 * 정렬 기준.
 *  selection — 선택 묶음의 바깥 경계 (2개 이상일 때 기본)
 *  parent    — 부모(아트보드 또는 상위 요소) 영역
 *  key       — 마지막에 선택한 요소(기준 요소)
 */
export type AlignTo = "selection" | "parent" | "key";

export function align(op: AlignOp, to: AlignTo = "selection"): void {
  const ids = store.editableSelection();
  if (ids.length === 0) return;
  const found = ids
    .map((id) => findElement(store.doc, id))
    .filter((f): f is NonNullable<typeof f> => !!f);
  if (found.length === 0) return;

  const items = found.map((f) => {
    const parent = f.parent;
    const pw = parent ? worldInfoOf(store.doc, parent.id)!.w : f.artboard.width;
    const ph = parent ? worldInfoOf(store.doc, parent.id)!.h : f.artboard.height;
    return { f, pw, ph, rect: localRectOf(f.el, pw, ph) };
  });

  // 기준 영역 결정
  let bounds: Rect;
  if (to === "parent" || items.length === 1) {
    bounds = { x: 0, y: 0, w: items[0].pw, h: items[0].ph };
  } else if (to === "key") {
    // 마지막으로 선택한 요소를 기준으로 삼는다 (유니티·피그마의 기준 개체)
    const keyId = store.selection[store.selection.length - 1];
    const key = items.find((i) => i.f.el.id === keyId) ?? items[items.length - 1];
    bounds = key.rect;
  } else {
    const minX = Math.min(...items.map((i) => i.rect.x));
    const minY = Math.min(...items.map((i) => i.rect.y));
    const maxX = Math.max(...items.map((i) => i.rect.x + i.rect.w));
    const maxY = Math.max(...items.map((i) => i.rect.y + i.rect.h));
    bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  store.beginChange();
  const keyId = to === "key" ? (store.selection[store.selection.length - 1] ?? "") : "";
  for (const it of items) {
    if (to === "key" && it.f.el.id === keyId) continue; // 기준 자신은 그대로
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
  const ids = store.editableSelection();
  if (ids.length < 3) {
    toast("등간격 분배는 3개 이상 선택 시 사용할 수 있습니다");
    return;
  }
  store.beginChange();
  const found = ids
    .map((id) => findElement(store.doc, id))
    .filter((f): f is NonNullable<typeof f> => !!f);
  const items = found.map((f) => {
    const parent = f.parent;
    const pw = parent ? worldInfoOf(store.doc, parent.id)!.w : f.artboard.width;
    const ph = parent ? worldInfoOf(store.doc, parent.id)!.h : f.artboard.height;
    return { f, pw, ph, rect: localRectOf(f.el, pw, ph) };
  });

  const pos = axis === "h" ? (r: Rect) => r.x : (r: Rect) => r.y;
  const size = axis === "h" ? (r: Rect) => r.w : (r: Rect) => r.h;
  const setPos = axis === "h"
    ? (r: Rect, v: number) => { r.x = v; }
    : (r: Rect, v: number) => { r.y = v; };

  items.sort((a, b) => pos(a.rect) - pos(b.rect));
  const first = items[0].rect;
  const last = items[items.length - 1].rect;
  const total = pos(last) + size(last) - pos(first);
  const occupied = items.reduce((sum, i) => sum + size(i.rect), 0);
  const gap = (total - occupied) / (items.length - 1);

  let cursor = pos(first);
  for (const it of items) {
    setPos(it.rect, cursor);
    cursor += size(it.rect) + gap;
    writeLocalRect(it.f.el, it.pw, it.ph, it.rect);
  }
  store.commit();
}

/**
 * 간격을 직접 지정해 늘어놓는다. 첫 요소 위치를 유지한 채
 * 나머지를 gap만큼 띄운다 (2개 이상이면 동작).
 */
export function spaceEvenly(axis: "h" | "v", gap: number): void {
  const ids = store.editableSelection();
  if (ids.length < 2) {
    toast("간격 적용은 2개 이상 선택 시 사용할 수 있습니다");
    return;
  }
  store.beginChange();
  const found = ids
    .map((id) => findElement(store.doc, id))
    .filter((f): f is NonNullable<typeof f> => !!f);
  const items = found.map((f) => {
    const parent = f.parent;
    const pw = parent ? worldInfoOf(store.doc, parent.id)!.w : f.artboard.width;
    const ph = parent ? worldInfoOf(store.doc, parent.id)!.h : f.artboard.height;
    return { f, pw, ph, rect: localRectOf(f.el, pw, ph) };
  });
  const pos = axis === "h" ? (r: Rect) => r.x : (r: Rect) => r.y;
  const size = axis === "h" ? (r: Rect) => r.w : (r: Rect) => r.h;
  const setPos = axis === "h"
    ? (r: Rect, v: number) => { r.x = v; }
    : (r: Rect, v: number) => { r.y = v; };

  items.sort((a, b) => pos(a.rect) - pos(b.rect));
  let cursor = pos(items[0].rect);
  for (const it of items) {
    setPos(it.rect, cursor);
    cursor += size(it.rect) + gap;
    writeLocalRect(it.f.el, it.pw, it.ph, it.rect);
  }
  store.commit();
}

/* ---------- 치수선 ---------- */

/**
 * 요소를 월드 기준으로 옮긴다. 부모가 회전해 있으면 그 회전을 벗겨
 * 부모 좌표계 이동량으로 환산한다.
 */
function moveElementWorld(id: string, dx: number, dy: number): void {
  const found = findElement(store.doc, id);
  const info = worldInfoOf(store.doc, id);
  if (!found || !info) return;
  const pm = parentWorldMatrix(store.doc, id);
  const rotOnly: Mat = [pm[0], pm[1], pm[2], pm[3], 0, 0];
  const local = applyMat(matInvert(rotOnly), { x: dx, y: dy });
  const r = info.localRect;
  writeLocalRect(found.el, info.parentW, info.parentH, {
    x: r.x + local.x, y: r.y + local.y, w: r.w, h: r.h
  });
}

/** 두 요소(또는 요소와 아트보드 가장자리) 사이에 치수선을 만든다 */
export function addMeasure(artboardId: string, m: Omit<Measure, "id">): string | null {
  const ab = findArtboard(store.doc, artboardId);
  if (!ab) return null;
  const dup = ab.measures.find(
    (x) => x.fromId === m.fromId && x.toId === m.toId && x.axis === m.axis && x.edge === m.edge
  );
  if (dup) return dup.id;
  store.beginChange();
  const measure: Measure = { ...m, id: genId("ms") };
  ab.measures.push(measure);
  store.commit();
  return measure.id;
}

/** 선택한 두 요소 사이에 치수선을 만든다 (도구를 바꾸지 않고도 쓸 수 있게) */
export function measureSelection(): void {
  const ids = store.topLevelSelection();
  if (ids.length !== 2) {
    toast("치수선은 두 요소를 선택했을 때 만들 수 있습니다");
    return;
  }
  const world = buildWorldMap(store.doc);
  const a = world.get(ids[0]);
  const b = world.get(ids[1]);
  if (!a || !b) return;
  if (a.artboard.id !== b.artboard.id) {
    toast("같은 아트보드의 요소끼리만 잴 수 있습니다");
    return;
  }
  addMeasure(a.artboard.id, {
    fromId: ids[0], toId: ids[1], edge: "min",
    axis: dominantAxis(a.aabb, b.aabb), moves: "to"
  });
}

/** 활성 아트보드의 치수선을 모두 지운다 */
export function clearMeasures(): void {
  const ab = store.activeArtboard();
  if (ab.measures.length === 0) return;
  store.beginChange();
  ab.measures = [];
  store.commit();
}

export function deleteMeasure(artboardId: string, measureId: string): void {
  const ab = findArtboard(store.doc, artboardId);
  if (!ab) return;
  store.beginChange();
  ab.measures = ab.measures.filter((m) => m.id !== measureId);
  if (store.selectedMeasureId === measureId) store.selectedMeasureId = null;
  store.commit();
}

/** 재는 방향을 가로·세로로 바꾼다 */
export function setMeasureAxis(artboardId: string, measureId: string, axis: "h" | "v"): void {
  const ab = findArtboard(store.doc, artboardId);
  const m = ab?.measures.find((x) => x.id === measureId);
  if (!ab || !m || m.axis === axis) return;
  store.beginChange();
  m.axis = axis;
  store.commit();
}

/** 기준·대상을 서로 바꿔 어느 쪽이 움직일지 뒤집는다 */
export function flipMeasureTarget(artboardId: string, measureId: string): void {
  const ab = findArtboard(store.doc, artboardId);
  const m = ab?.measures.find((x) => x.id === measureId);
  if (!ab || !m || m.toId === null) return;
  store.beginChange();
  m.moves = m.moves === "to" ? "from" : "to";
  store.commit();
}

/**
 * 치수선의 숫자를 고친다 — 지정한 쪽이 그만큼 움직인다.
 * 구속이 아니라 한 번의 이동이므로 이후 자유롭게 다시 옮길 수 있다.
 */
export function applyMeasure(artboardId: string, measureId: string, value: number): void {
  const ab = findArtboard(store.doc, artboardId);
  const m = ab?.measures.find((x) => x.id === measureId);
  if (!ab || !m) return;
  const geom = measureGeom(ab, m, buildWorldMap(store.doc));
  if (!geom) return;
  const movingId = m.toId !== null && m.moves === "to" ? m.toId : m.fromId;
  const found = findElement(store.doc, movingId);
  if (!found) return;
  if (found.el.locked) {
    toast("잠긴 요소는 옮길 수 없습니다");
    return;
  }
  const d = measureDelta(m, geom, value);
  if (d.x === 0 && d.y === 0) return;
  store.beginChange();
  moveElementWorld(movingId, d.x, d.y);
  store.commit();
}

/* ---------- 표시 · 잠금 ---------- */

export function toggleVisible(): void {
  const els = store.editableSelection()
    .map((id) => findElement(store.doc, id)?.el)
    .filter((el): el is OPElement => !!el);
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

  // 부모가 바뀌면 좌표계가 바뀐다. 화면상 위치를 유지하려면
  // 옮기기 전의 월드 기준 중심·크기·누적 회전을 기억해 두어야 한다.
  const moved: OPElement[] = [];
  const keep = new Map<string, { center: Point; w: number; h: number; rot: number }>();
  for (const id of ids) {
    const found = findElement(store.doc, id);
    if (!found) continue;
    const info = worldInfoOf(store.doc, id);
    if (info) {
      keep.set(id, {
        center: applyMat(info.matrix, { x: info.w / 2, y: info.h / 2 }),
        w: info.w,
        h: info.h,
        rot: accumulatedRotation(store.doc, id)
      });
    }
    found.siblings.splice(found.siblings.indexOf(found.el), 1);
    moved.push(found.el);
  }

  const targetList = target.parentId
    ? findElement(store.doc, target.parentId)?.el.children
    : ab.children;
  if (!targetList) { store.cancelChange(); return; }
  const idx = Math.max(0, Math.min(target.index, targetList.length));
  targetList.splice(idx, 0, ...moved);

  // 새 부모 좌표계로 환산해 월드 위치를 복원한다
  const parentRot = target.parentId ? accumulatedRotation(store.doc, target.parentId) : 0;
  for (const el of moved) {
    const prev = keep.get(el.id);
    if (!prev) continue;
    const parentInfo = target.parentId ? worldInfoOf(store.doc, target.parentId) : null;
    const parentW = parentInfo ? parentInfo.w : ab.width;
    const parentH = parentInfo ? parentInfo.h : ab.height;
    const pm = parentWorldMatrix(store.doc, el.id);
    const localCenter = applyMat(matInvert(pm), prev.center);
    el.rotation = normalizeAngle(prev.rot - parentRot);
    writeLocalRect(el, parentW, parentH, {
      x: localCenter.x - prev.w / 2,
      y: localCenter.y - prev.h / 2,
      w: prev.w,
      h: prev.h
    });
  }
  store.commit();
}

/** 조상 체인의 회전 합 (모든 변환이 이동+회전이라 단순 합산으로 충분) */
function accumulatedRotation(doc: typeof store.doc, id: string): number {
  const chain = [...ancestorsOf(doc, id)];
  const self = findElement(doc, id)?.el;
  if (self) chain.push(self);
  return chain.reduce((sum, el) => sum + el.rotation, 0);
}

/* ---------- 파일 입출력 ---------- */

export async function saveProjectFile(): Promise<void> {
  // 이미지 복원(IndexedDB)이 끝나기 전에 저장하면 배경이 빠진 파일이 나온다
  await imagesReady();
  const text = serializeProject(store.doc);
  const result = await saveTextFile(`${sanitizeFileName(store.doc.meta.name)}.opl.json`, text);
  if (result === "cancelled") return;
  store.dirty = false;
  toast(result === "saved" ? "프로젝트 저장됨" : "프로젝트 파일을 내려받습니다");
}

export async function exportAIFile(): Promise<void> {
  const text = serializeForAI(store.doc);
  const result = await saveTextFile(`${sanitizeFileName(store.doc.meta.name)}.layout.json`, text);
  if (result === "cancelled") return;
  toast("AI용 레이아웃 JSON 내보내기 완료");
}

export async function copyAIToClipboard(): Promise<void> {
  const text = serializeForAI(store.doc);
  const ok = await writeClipboardText(text);
  toast(ok ? "AI용 레이아웃 JSON이 클립보드에 복사되었습니다" : "클립보드 접근이 거부되었습니다");
}

export async function importFromClipboard(): Promise<void> {
  const text = await readClipboardText();
  if (text === null) {
    toast("클립보드 접근이 거부되었습니다 · 파일 열기를 이용하세요");
    return;
  }
  importText(text);
}

/**
 * 문서 가져오기. 현재 문서에 작업 내용이 있으면 확인을 거친다 —
 * 파일을 잘못 떨구는 것만으로 전체가 교체되는 사고를 막는다.
 * (되돌리기로 복구는 가능하지만, 묻는 쪽이 안전하다)
 */
export function importText(text: string): void {
  let doc: ProjectDoc;
  try {
    doc = parseProject(text);
  } catch (e) {
    toast(`불러오기 실패 · ${(e as Error).message}`);
    return;
  }
  const apply = () => {
    store.replaceDoc(doc);
    toast(`불러오기 완료 · 아트보드 ${doc.artboards.length}개`);
  };
  const hasWork = store.doc.artboards.length > 1 ||
    store.doc.artboards.some((a) => a.children.length > 0);
  if (!hasWork) {
    apply();
    return;
  }
  void import("./ui/dialogs").then((d) =>
    d.confirmDialog(
      "레이아웃 가져오기",
      "가져오면 현재 문서를 대체합니다. (실행 취소로 되돌릴 수 있습니다)",
      "가져오기",
      apply
    )
  );
}

export async function openProjectFile(): Promise<void> {
  const text = await openTextFile();
  if (text !== null) importText(text);
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
      ab.background.image = registerImage(reader.result as string);
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
  // 실제 이미지 데이터는 여기서 지우지 않는다 — 되돌리기로 복구할 수 있어야
  // 하기 때문이다. 참조를 잃은 이미지는 다음 시작 시(pruneStaleImages) 정리된다.
  ab.background.image = null;
  store.commit();
}
