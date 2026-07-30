import type { Artboard, OPElement, Point, ProjectDoc, Rect } from "../types";
import { anchorFractions } from "../types";
import { ancestorsOf, findElement } from "./doc";

/** 2D 아핀 행렬 [a c e; b d f] */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function matMul(m1: Mat, m2: Mat): Mat {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1
  ];
}

export function matTranslate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

export function matRotateDeg(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

export function matInvert(m: Mat): Mat {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det;
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)];
}

export function applyMat(m: Mat, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/* ---------- 앵커 · 단위 좌표 변환 ---------- */

/** 요소의 부모 좌표계(px) 기준 사각형 (회전 미적용) */
export function localRectOf(el: OPElement, parentW: number, parentH: number): Rect {
  const { ax, ay } = anchorFractions(el.anchor);
  const w = el.units.width === "%" ? (el.width / 100) * parentW : el.width;
  const h = el.units.height === "%" ? (el.height / 100) * parentH : el.height;
  const xOff = el.units.x === "%" ? (el.x / 100) * parentW : el.x;
  const yOff = el.units.y === "%" ? (el.y / 100) * parentH : el.y;
  return {
    x: ax * (parentW - w) + xOff,
    y: ay * (parentH - h) + yOff,
    w,
    h
  };
}

/** 부모 좌표계(px) 사각형을 앵커·단위 설정에 맞게 요소 필드로 역기록 */
export function writeLocalRect(el: OPElement, parentW: number, parentH: number, rect: Rect): void {
  const { ax, ay } = anchorFractions(el.anchor);
  const xOff = rect.x - ax * (parentW - rect.w);
  const yOff = rect.y - ay * (parentH - rect.h);
  el.x = el.units.x === "%" ? safePct(xOff, parentW) : round2(xOff);
  el.y = el.units.y === "%" ? safePct(yOff, parentH) : round2(yOff);
  el.width = el.units.width === "%" ? safePct(rect.w, parentW) : round2(rect.w);
  el.height = el.units.height === "%" ? safePct(rect.h, parentH) : round2(rect.h);
}

function safePct(v: number, base: number): number {
  return base === 0 ? 0 : round2((v / base) * 100);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ---------- 월드(캔버스) 좌표 ---------- */

export interface WorldInfo {
  /** 요소 로컬(0,0=좌상단) → 월드 변환 */
  matrix: Mat;
  /** 로컬 px 크기 */
  w: number;
  h: number;
  /** 부모 콘텐츠 px 크기 */
  parentW: number;
  parentH: number;
  /** 부모 좌표계 기준 사각형 */
  localRect: Rect;
}

/** 조상 체인을 따라 요소의 월드 변환 계산 */
export function worldInfoOf(doc: ProjectDoc, elementId: string): WorldInfo | null {
  const found = findElement(doc, elementId);
  if (!found) return null;
  const ab = found.artboard;
  const chain = [...ancestorsOf(doc, elementId), found.el];

  let m: Mat = matTranslate(ab.position.x, ab.position.y);
  let pw = ab.width;
  let ph = ab.height;
  let localRect: Rect = { x: 0, y: 0, w: pw, h: ph };

  for (const el of chain) {
    localRect = localRectOf(el, pw, ph);
    const { x, y, w, h } = localRect;
    m = matMul(m, matTranslate(x, y));
    if (el.rotation !== 0) {
      m = matMul(m, matMul(matTranslate(w / 2, h / 2), matMul(matRotateDeg(el.rotation), matTranslate(-w / 2, -h / 2))));
    }
    pw = w;
    ph = h;
  }

  const parent = found.parent;
  let parentW = ab.width;
  let parentH = ab.height;
  if (parent) {
    const pInfo = worldInfoOf(doc, parent.id);
    if (pInfo) {
      parentW = pInfo.w;
      parentH = pInfo.h;
    }
  }
  return { matrix: m, w: pw, h: ph, parentW, parentH, localRect };
}

export interface WorldEntry extends WorldInfo {
  el: OPElement;
  parent: OPElement | null;
  artboard: Artboard;
}

/**
 * 문서 전체의 월드 변환을 한 번의 순회로 계산한다.
 *
 * worldInfoOf는 호출마다 조상 체인을 다시 걷기 때문에 요소마다 부르면
 * O(n^2)이 된다. 오버레이 렌더링·히트테스트·마퀴·스냅처럼 모든 요소를
 * 훑는 경로에서는 반드시 이 맵을 써야 한다.
 */
export function buildWorldMap(doc: ProjectDoc): Map<string, WorldEntry> {
  const map = new Map<string, WorldEntry>();
  for (const ab of doc.artboards) {
    walk(ab.children, matTranslate(ab.position.x, ab.position.y), ab.width, ab.height, null, ab);
  }
  return map;

  function walk(
    els: OPElement[], parentMat: Mat, pw: number, ph: number,
    parent: OPElement | null, artboard: Artboard
  ): void {
    for (const el of els) {
      const rect = localRectOf(el, pw, ph);
      let m = matMul(parentMat, matTranslate(rect.x, rect.y));
      if (el.rotation !== 0) {
        m = matMul(m, matMul(
          matTranslate(rect.w / 2, rect.h / 2),
          matMul(matRotateDeg(el.rotation), matTranslate(-rect.w / 2, -rect.h / 2))
        ));
      }
      map.set(el.id, {
        matrix: m, w: rect.w, h: rect.h,
        parentW: pw, parentH: ph, localRect: rect,
        el, parent, artboard
      });
      if (el.children.length > 0) walk(el.children, m, rect.w, rect.h, el, artboard);
    }
  }
}

/** 부모의 월드 변환 (요소 로컬 → 월드 이전 단계) */
export function parentWorldMatrix(doc: ProjectDoc, elementId: string): Mat {
  const found = findElement(doc, elementId);
  if (!found) return IDENTITY;
  if (found.parent) {
    return worldInfoOf(doc, found.parent.id)?.matrix ?? IDENTITY;
  }
  return matTranslate(found.artboard.position.x, found.artboard.position.y);
}

/** 월드 기준 4개 꼭짓점 */
export function worldCorners(info: WorldInfo): Point[] {
  return [
    applyMat(info.matrix, { x: 0, y: 0 }),
    applyMat(info.matrix, { x: info.w, y: 0 }),
    applyMat(info.matrix, { x: info.w, y: info.h }),
    applyMat(info.matrix, { x: 0, y: info.h })
  ];
}

/** 월드 AABB */
export function worldAABB(info: WorldInfo): Rect {
  const pts = worldCorners(info);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectContains(a: Rect, b: Rect): boolean {
  return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
}

/** 월드 좌표가 요소 내부인지 (회전 반영) */
export function pointInElement(info: WorldInfo, p: Point): boolean {
  const local = applyMat(matInvert(info.matrix), p);
  return local.x >= 0 && local.y >= 0 && local.x <= info.w && local.y <= info.h;
}

/** 아트보드의 월드 사각형 */
export function artboardWorldRect(ab: Artboard): Rect {
  return { x: ab.position.x, y: ab.position.y, w: ab.width, h: ab.height };
}
