import type { Artboard, Measure, Point, Rect } from "../types";
import type { WorldEntry } from "./geometry";
import { artboardWorldRect } from "./geometry";

/**
 * 치수선의 화면 배치 정보 (월드 좌표).
 *
 * 치수선은 두 요소의 마주 보는 가장자리 사이 간격을 잰다. 겹쳐 있으면
 * 간격이 음수가 되며, 그 상태로도 숫자를 고쳐 떼어 놓을 수 있다.
 */
export interface MeasureGeom {
  axis: "h" | "v";
  /** 잰 간격 (양수 = 떨어져 있음) */
  gap: number;
  /** 치수선 양 끝 */
  a: Point;
  b: Point;
  /** 숫자를 놓을 지점 */
  label: Point;
  /** 대상이 기준의 +방향(오른쪽·아래)에 있으면 +1 */
  sign: 1 | -1;
  /** 보조선을 그릴 두 요소의 경계 (없으면 아트보드 가장자리) */
  fromRect: Rect;
  toRect: Rect | null;
}

function minOf(r: Rect, axis: "h" | "v"): number {
  return axis === "h" ? r.x : r.y;
}

function maxOf(r: Rect, axis: "h" | "v"): number {
  return axis === "h" ? r.x + r.w : r.y + r.h;
}

/** 축과 직교하는 방향의 중심 (치수선을 놓을 높이) */
function crossCenter(a: Rect, b: Rect | null, axis: "h" | "v"): number {
  const lo = (r: Rect) => (axis === "h" ? r.y : r.x);
  const hi = (r: Rect) => (axis === "h" ? r.y + r.h : r.x + r.w);
  if (!b) return (lo(a) + hi(a)) / 2;
  const overlapLo = Math.max(lo(a), lo(b));
  const overlapHi = Math.min(hi(a), hi(b));
  if (overlapHi > overlapLo) return (overlapLo + overlapHi) / 2;
  return ((lo(a) + hi(a)) / 2 + (lo(b) + hi(b)) / 2) / 2;
}

/**
 * 치수선의 월드 기하를 계산한다.
 * 참조가 끊겼거나 다른 아트보드를 가리키면 null.
 */
export function measureGeom(
  ab: Artboard, m: Measure, world: Map<string, WorldEntry>
): MeasureGeom | null {
  const from = world.get(m.fromId);
  if (!from || from.artboard.id !== ab.id) return null;
  const fromRect = from.aabb;

  let toRect: Rect | null = null;
  let sign: 1 | -1;
  if (m.toId === null) {
    const abr = artboardWorldRect(ab);
    const at = m.edge === "min" ? minOf(abr, m.axis) : maxOf(abr, m.axis);
    toRect = m.axis === "h"
      ? { x: at, y: abr.y, w: 0, h: abr.h }
      : { x: abr.x, y: at, w: abr.w, h: 0 };
    sign = m.edge === "max" ? 1 : -1;
  } else {
    const to = world.get(m.toId);
    if (!to || to.artboard.id !== ab.id) return null;
    toRect = to.aabb;
    const fc = (minOf(fromRect, m.axis) + maxOf(fromRect, m.axis)) / 2;
    const tc = (minOf(toRect, m.axis) + maxOf(toRect, m.axis)) / 2;
    sign = tc >= fc ? 1 : -1;
  }

  const gap = sign === 1
    ? minOf(toRect, m.axis) - maxOf(fromRect, m.axis)
    : minOf(fromRect, m.axis) - maxOf(toRect, m.axis);

  const p0 = sign === 1 ? maxOf(fromRect, m.axis) : minOf(fromRect, m.axis);
  const p1 = sign === 1 ? minOf(toRect, m.axis) : maxOf(toRect, m.axis);
  const cross = crossCenter(fromRect, m.toId === null ? null : toRect, m.axis);

  const a: Point = m.axis === "h" ? { x: p0, y: cross } : { x: cross, y: p0 };
  const b: Point = m.axis === "h" ? { x: p1, y: cross } : { x: cross, y: p1 };
  return {
    axis: m.axis,
    gap: Math.round(gap * 100) / 100,
    a,
    b,
    label: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    sign,
    fromRect,
    toRect: m.toId === null ? null : toRect
  };
}

/**
 * 입력한 간격을 맞추기 위해 움직여야 할 월드 이동량.
 * 어느 쪽이 움직이는지(moves)와 방향(sign)에 따라 부호가 뒤집힌다.
 */
export function measureDelta(m: Measure, geom: MeasureGeom, target: number): Point {
  const diff = target - geom.gap;
  // 가장자리 기준이면 아트보드는 움직일 수 없으므로 항상 요소가 움직인다
  const movesTo = m.toId !== null && m.moves === "to";
  const dir = (movesTo ? 1 : -1) * geom.sign;
  const d = diff * dir;
  return m.axis === "h" ? { x: d, y: 0 } : { x: 0, y: d };
}

/** 두 요소 사이에서 더 크게 벌어진 축 — 치수선을 만들 때 기본 축이 된다 */
export function dominantAxis(a: Rect, b: Rect): "h" | "v" {
  const hGap = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const vGap = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return hGap >= vGap ? "h" : "v";
}
