import type {
  Artboard, ElementType, OPElement, ProjectDoc
} from "../types";
import { ANCHORS, ELEMENT_TYPES, typeInfo } from "../types";

let idCounter = 0;

export function genId(prefix: string): string {
  idCounter = (idCounter + 1) % 1679616;
  const rand = Math.floor(Math.random() * 1679616).toString(36).padStart(4, "0");
  const seq = idCounter.toString(36).padStart(4, "0");
  return `${prefix}_${rand}${seq}`;
}

export function createElement(partial: Partial<OPElement> = {}): OPElement {
  const type: ElementType = partial.type ?? "panel";
  return {
    id: partial.id ?? genId("el"),
    name: partial.name ?? typeInfo(type).label,
    type,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    width: partial.width ?? 200,
    height: partial.height ?? 120,
    units: partial.units ?? { x: "px", y: "px", width: "px", height: "px" },
    anchor: partial.anchor ?? "top-left",
    rotation: partial.rotation ?? 0,
    opacity: partial.opacity ?? 1,
    color: partial.color ?? typeInfo(type).color,
    visible: partial.visible ?? true,
    locked: partial.locked ?? false,
    meta: partial.meta ?? {},
    children: partial.children ?? []
  };
}

export function createArtboard(partial: Partial<Artboard> = {}): Artboard {
  return {
    id: partial.id ?? genId("ab"),
    name: partial.name ?? "아트보드",
    width: partial.width ?? 1920,
    height: partial.height ?? 1080,
    background: partial.background ?? { color: "#17171C", image: null, imageOpacity: 0.5 },
    position: partial.position ?? { x: 0, y: 0 },
    guides: partial.guides ?? { v: [], h: [] },
    children: partial.children ?? []
  };
}

export function createProject(name = "새 프로젝트"): ProjectDoc {
  return {
    format: "overlayplacer",
    version: 1,
    meta: { name, description: "" },
    artboards: [createArtboard({ name: "화면 1" })]
  };
}

export function cloneDoc<T>(v: T): T {
  return structuredClone(v);
}

/* ---------- 탐색 ---------- */

export function walkElements(
  roots: OPElement[],
  fn: (el: OPElement, parent: OPElement | null, depth: number) => void | boolean,
  parent: OPElement | null = null,
  depth = 0
): boolean {
  for (const el of roots) {
    if (fn(el, parent, depth) === false) return false;
    if (!walkElements(el.children, fn, el, depth + 1)) return false;
  }
  return true;
}

export interface FoundElement {
  el: OPElement;
  parent: OPElement | null;
  artboard: Artboard;
  siblings: OPElement[];
  index: number;
}

export function findElement(doc: ProjectDoc, id: string): FoundElement | null {
  for (const ab of doc.artboards) {
    const found = findIn(ab.children, id, null, ab);
    if (found) return found;
  }
  return null;
}

function findIn(
  list: OPElement[], id: string, parent: OPElement | null, artboard: Artboard
): FoundElement | null {
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (el.id === id) return { el, parent, artboard, siblings: list, index: i };
    const deep = findIn(el.children, id, el, artboard);
    if (deep) return deep;
  }
  return null;
}

export function findArtboard(doc: ProjectDoc, id: string): Artboard | null {
  return doc.artboards.find((a) => a.id === id) ?? null;
}

export function artboardOf(doc: ProjectDoc, elementId: string): Artboard | null {
  return findElement(doc, elementId)?.artboard ?? null;
}

/** 조상 체인 (아트보드 직계 → … → 부모) */
export function ancestorsOf(doc: ProjectDoc, id: string): OPElement[] {
  const chain: OPElement[] = [];
  for (const ab of doc.artboards) {
    if (collect(ab.children)) return chain;
  }
  return chain;

  function collect(list: OPElement[]): boolean {
    for (const el of list) {
      if (el.id === id) return true;
      chain.push(el);
      if (collect(el.children)) return true;
      chain.pop();
    }
    return false;
  }
}

export function isAncestor(doc: ProjectDoc, maybeAncestorId: string, id: string): boolean {
  return ancestorsOf(doc, id).some((a) => a.id === maybeAncestorId);
}

/** 새 요소 ID 재발급 (복제·붙여넣기용) */
export function reassignIds(el: OPElement): OPElement {
  el.id = genId("el");
  el.children.forEach(reassignIds);
  return el;
}

/* ---------- 직렬화 ---------- */

/** 프로젝트 저장용 (전체 보존) */
export function serializeProject(doc: ProjectDoc): string {
  return JSON.stringify(doc, null, 2);
}

/** AI 전달용 — 편집기 전용 필드(배경 이미지, 캔버스 위치, 가이드) 제거 */
export function serializeForAI(doc: ProjectDoc): string {
  const out = {
    format: doc.format,
    version: doc.version,
    meta: doc.meta,
    artboards: doc.artboards.map((ab) => ({
      id: ab.id,
      name: ab.name,
      width: ab.width,
      height: ab.height,
      children: ab.children.map(cleanElement)
    }))
  };
  return JSON.stringify(out, null, 2);

  function cleanElement(el: OPElement): unknown {
    const o: Record<string, unknown> = {
      id: el.id,
      name: el.name,
      type: el.type,
      x: round2(el.x),
      y: round2(el.y),
      width: round2(el.width),
      height: round2(el.height),
      anchor: el.anchor
    };
    if (el.units.x !== "px" || el.units.y !== "px" || el.units.width !== "px" || el.units.height !== "px") {
      o.units = el.units;
    }
    if (el.rotation !== 0) o.rotation = round2(el.rotation);
    if (el.opacity !== 1) o.opacity = el.opacity;
    if (!el.visible) o.visible = false;
    if (Object.keys(el.meta).length > 0) o.meta = el.meta;
    if (el.children.length > 0) o.children = el.children.map(cleanElement);
    return o;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ---------- 역직렬화 · 정규화 ---------- */

const VALID_TYPES = new Set(ELEMENT_TYPES.map((t) => t.type));
const VALID_ANCHORS = new Set<string>(ANCHORS);

/**
 * 외부 JSON(AI 생성 포함)을 관용적으로 해석해 완전한 문서로 정규화.
 * 누락 필드는 기본값으로 채우고, 형식 오류는 예외를 던진다.
 */
export function parseProject(text: string): ProjectDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("JSON 구문을 해석할 수 없습니다.");
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error("올바른 레이아웃 문서가 아닙니다.");
  }
  const r = raw as Record<string, unknown>;

  // 아트보드 배열이 없고 요소 배열만 있는 축약형도 허용
  let artboardsRaw: unknown[] = [];
  if (Array.isArray(r.artboards)) {
    artboardsRaw = r.artboards;
  } else if (Array.isArray(r.children) || Array.isArray(r.elements)) {
    artboardsRaw = [r];
  } else {
    throw new Error("artboards 배열을 찾을 수 없습니다.");
  }
  if (artboardsRaw.length === 0) {
    throw new Error("아트보드가 비어 있습니다.");
  }

  const meta = (typeof r.meta === "object" && r.meta !== null ? r.meta : {}) as Record<string, unknown>;
  const seenIds = new Set<string>();
  // 위치 정보가 없는 아트보드는 겹치지 않게 순서대로 나란히 배치
  let nextX = 0;

  const doc: ProjectDoc = {
    format: "overlayplacer",
    version: 1,
    meta: {
      name: str(meta.name, "가져온 프로젝트"),
      description: str(meta.description, "")
    },
    artboards: artboardsRaw.map((a, i) => normArtboard(a, i))
  };
  return doc;

  function normArtboard(a: unknown, i: number): Artboard {
    const o = (typeof a === "object" && a !== null ? a : {}) as Record<string, unknown>;
    const kids = Array.isArray(o.children) ? o.children : Array.isArray(o.elements) ? o.elements : [];
    const bg = (typeof o.background === "object" && o.background !== null ? o.background : {}) as Record<string, unknown>;
    const pos = (typeof o.position === "object" && o.position !== null ? o.position : {}) as Record<string, unknown>;
    const guides = (typeof o.guides === "object" && o.guides !== null ? o.guides : {}) as Record<string, unknown>;
    const width = num(o.width, 1920, 1);
    const hasPos = typeof pos.x === "number" && typeof pos.y === "number";
    const px = hasPos ? num(pos.x, 0, -1e7) : nextX;
    const py = hasPos ? num(pos.y, 0, -1e7) : 0;
    nextX = Math.max(nextX, px + width + 160);
    return createArtboard({
      id: uniqueId(str(o.id, ""), "ab"),
      name: str(o.name, `화면 ${i + 1}`),
      width,
      height: num(o.height, 1080, 1),
      background: {
        color: str(bg.color, "#17171C"),
        image: typeof bg.image === "string" && bg.image.startsWith("data:") ? bg.image : null,
        imageOpacity: clamp(num(bg.imageOpacity, 0.5, 0), 0, 1)
      },
      position: { x: px, y: py },
      guides: {
        v: numArr(guides.v),
        h: numArr(guides.h)
      },
      children: kids.map((k) => normElement(k))
    });
  }

  function normElement(e: unknown): OPElement {
    const o = (typeof e === "object" && e !== null ? e : {}) as Record<string, unknown>;
    const units = (typeof o.units === "object" && o.units !== null ? o.units : {}) as Record<string, unknown>;
    const type = VALID_TYPES.has(o.type as ElementType) ? (o.type as ElementType) : "custom";
    const kids = Array.isArray(o.children) ? o.children : [];
    const metaRaw = (typeof o.meta === "object" && o.meta !== null ? o.meta : {}) as Record<string, unknown>;
    const metaOut: Record<string, string> = {};
    for (const [k, v] of Object.entries(metaRaw)) {
      metaOut[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return createElement({
      id: uniqueId(str(o.id, ""), "el"),
      name: str(o.name, typeInfo(type).label),
      type,
      x: num(o.x, 0, -1e7),
      y: num(o.y, 0, -1e7),
      width: num(o.width, 200, 0),
      height: num(o.height, 120, 0),
      units: {
        x: unit(units.x),
        y: unit(units.y),
        width: unit(units.width),
        height: unit(units.height)
      },
      anchor: VALID_ANCHORS.has(o.anchor as string) ? (o.anchor as OPElement["anchor"]) : "top-left",
      rotation: num(o.rotation, 0, -36000),
      opacity: clamp(num(o.opacity, 1, 0), 0, 1),
      color: typeof o.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(o.color) ? o.color : typeInfo(type).color,
      visible: o.visible !== false,
      locked: o.locked === true,
      meta: metaOut,
      children: kids.map((k) => normElement(k))
    });
  }

  function uniqueId(candidate: string, prefix: string): string {
    let id = candidate || genId(prefix);
    while (seenIds.has(id)) id = genId(prefix);
    seenIds.add(id);
    return id;
  }

  function unit(v: unknown): "px" | "%" {
    return v === "%" ? "%" : "px";
  }

  function str(v: unknown, dflt: string): string {
    return typeof v === "string" ? v : dflt;
  }

  function num(v: unknown, dflt: number, min: number): number {
    const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
    return Math.max(min, n);
  }

  function numArr(v: unknown): number[] {
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
  }

  function clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, n));
  }
}
