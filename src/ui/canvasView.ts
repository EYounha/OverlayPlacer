import { store } from "../state/store";
import type { Artboard, Measure, OPElement, Point, Rect } from "../types";
import { typeInfo } from "../types";
import { findArtboard, findElement, createElement, genId } from "../model/doc";
import {
  applyMat, artboardWorldRect, localRectOf, matInvert, parentWorldMatrix,
  buildWorldMap, pointInElement, rectsIntersect, worldAABB, worldCorners,
  worldInfoOf, writeLocalRect, type WorldEntry,
  type Mat, type WorldInfo
} from "../model/geometry";
import { dominantAxis, measureGeom, type MeasureGeom } from "../model/measure";
import { h, svgEl, clearChildren } from "./dom";
import { showMenu, type MenuItem } from "./contextmenu";
import { buildElementContextMenu } from "./sharedMenus";
import { addMeasure, applyMeasure, deleteMeasure, flipMeasureTarget, importText } from "../actions";
import { toast } from "./toast";
import { getImage, registerImage } from "../state/imageStore";

const SNAP_SCREEN_PX = 7;
/** 화면 밖 여유 — 이 안에서 움직이는 동안은 DOM을 다시 만들지 않는다 */
const CULL_MARGIN_PX = 600;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 32;
/** 이름표 한 줄 높이 (화면 px) — 겹칠 때 이만큼씩 내려 자리를 만든다 */
const LABEL_LANE_PX = 14;
/** 이름표를 밀어 내릴 수 있는 최대 줄 수. 넘으면 감춘다 */
const LABEL_MAX_LANES = 6;
/** 치수선을 집을 수 있는 여유 (화면 px) */
const MEASURE_PICK_PX = 6;
/** 이 크기보다 작게 보이는 요소는 이름표를 그리지 않는다 (화면 px) */
const LABEL_MIN_W = 26;
const LABEL_MIN_H = 11;

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface ArtboardNode {
  root: HTMLElement;
  bg: HTMLElement;
  grid: HTMLElement;
  content: HTMLElement;
  guides: HTMLElement;
}

/**
 * 요소 하나에 대응하는 DOM과 마지막으로 적용한 값.
 *
 * DOM을 되읽는 것만으로도 요소 수만큼 비용이 붙으므로, 라벨의 글자·색·
 * 표시 여부·줄 위치는 여기에 기억해 두고 달라질 때만 손댄다.
 */
interface ElNode {
  node: HTMLElement;
  label: HTMLElement;
  /** 마지막으로 적용한 top (줄 내림) */
  top: string;
  hidden: boolean;
  text: string;
  color: string;
}

/** 값이 실제로 달라질 때만 쓴다 — 불필요한 스타일 재계산을 막는다 */
function setStyle(node: HTMLElement, prop: string, value: string): void {
  const style = node.style as unknown as Record<string, string>;
  if (style[prop] !== value) style[prop] = value;
}

interface MoveItem {
  id: string;
  initRect: Rect;
  parentW: number;
  parentH: number;
  invParentRot: Mat;
}

type DragState =
  | { mode: "pan"; sx: number; sy: number; panX: number; panY: number }
  | {
      mode: "move"; startWorld: Point; items: MoveItem[]; initAABB: Rect;
      artboardId: string; mutated: boolean;
      /** 이 클릭이 선택을 바꿨는지 — 겹침 선택 메뉴를 언제 띄울지 판단한다 */
      selectionChanged: boolean;
    }
  | {
      mode: "resize"; handle: Handle; id: string; initInfo: WorldInfo;
      invInit: Mat; startLocal: Point; parentMat: Mat; axisAligned: boolean;
      artboardId: string; mutated: boolean;
    }
  | {
      mode: "rotate"; id: string; center: Point; startPointerAngle: number;
      initRotation: number; mutated: boolean;
    }
  | { mode: "marquee"; startWorld: Point; additive: boolean; base: string[] }
  | { mode: "draw"; artboardId: string; startLocal: Point; elId: string | null; mutated: boolean }
  | { mode: "artboard"; id: string; startWorld: Point; initPos: Point; mutated: boolean }
  | {
      mode: "guide"; artboardId: string; axis: "v" | "h"; index: number;
      mutated: boolean;
    };

interface SnapLine {
  axis: "v" | "h";
  world: number;
}

/** 드래그 중 맞물린 간격을 보여 주는 임시 치수 표시 */
interface GapHint {
  axis: "h" | "v";
  a: Point;
  b: Point;
  value: number;
}

/** 스냅 대상 사전 계산 결과 */
interface SnapTargets {
  xs: number[];
  ys: number[];
  /** 같은 크기에 맞추기 위한 정지 요소들의 폭·높이 */
  ws: number[];
  hs: number[];
  /** 간격 스냅용 정지 요소 경계 */
  rects: Rect[];
}

/** 화면 좌표로 계산해 둔 치수선 — 선 선택과 숫자 편집에 쓴다 */
interface MeasureHit {
  artboardId: string;
  measure: Measure;
  geom: MeasureGeom;
  /** 숫자 칩의 화면 사각형 */
  chip: Rect;
  /** 선 양 끝의 화면 좌표 */
  sa: Point;
  sb: Point;
}

/** 마우스 아래에 있는 선택 후보 */
type PickCandidate =
  | {
      kind: "element"; id: string; artboardId: string;
      label: string; hint: string; swatch: string; selected: boolean;
    }
  | { kind: "measure"; id: string; label: string; hint: string; selected: boolean };

export class CanvasView {
  root: HTMLElement;
  private viewport: HTMLElement;
  private world: HTMLElement;
  private overlay: SVGSVGElement;
  /** 선택 외곽선 전용 레이어 (노드 재사용) */
  private selLayer: SVGGElement;
  /** 핸들·배지·스냅선·마퀴 등 매번 새로 그리는 레이어 */
  private decorLayer: SVGGElement;
  private labelLayer: HTMLElement;
  private nodeMap = new Map<string, ElNode>();
  private abNodes = new Map<string, ArtboardNode>();
  private drag: DragState | null = null;
  private hoverId: string | null = null;
  private spaceHeld = false;
  private snapLines: SnapLine[] = [];
  /** 드래그 중 맞물린 간격 표시 */
  private gapHints: GapHint[] = [];
  /** 드래그 시작 시 한 번 모으는 스냅 대상 좌표 */
  private snapTargets: SnapTargets | null = null;
  /** 치수선 도구로 고른 첫 번째 요소 */
  private measureFrom: string | null = null;
  /** 이번 프레임에 그린 치수선의 화면 위치 (숫자 클릭 판정용) */
  private measureHits: MeasureHit[] = [];
  private measureEditor: HTMLInputElement | null = null;
  /** 선택 메뉴에서 가리키고 있는 대상 (요소 또는 치수선 id) */
  private pickHighlight: string | null = null;
  /** 이름표 재배치는 배율이 바뀔 때만 다시 한다 */
  private labelZoom = 0;
  /** 이번 syncWorld에서 노드를 새로 만들었는지 (이름표 배치 필요 여부) */
  private createdNodes = false;
  /**
   * 월드 변환 캐시. 호버 히트테스트가 pointermove마다 도는 가장 뜨거운
   * 경로이므로, 문서가 바뀔 때만 무효화하고 그 사이에는 재사용한다.
   */
  private worldCache: Map<string, WorldEntry> | null = null;
  /** 조작이 멎은 뒤 고해상도로 다시 그리게 하는 타이머 */
  private settleTimer: number | null = null;
  /**
   * 마지막으로 DOM을 만든 월드 영역(여유 포함).
   * 화면이 이 안에 있으면 새로 보일 것이 없으므로 다시 만들지 않는다.
   */
  private culledRect: Rect | null = null;
  private lastPointer: Point = { x: 0, y: 0 };

  private worldMap(): Map<string, WorldEntry> {
    if (!this.worldCache) this.worldCache = buildWorldMap(store.doc);
    return this.worldCache;
  }

  constructor() {
    this.world = h("div", { class: "world" });
    this.overlay = svgEl("svg", { class: "canvas-overlay" });
    this.selLayer = svgEl("g");
    this.decorLayer = svgEl("g");
    this.overlay.append(this.selLayer, this.decorLayer);
    this.labelLayer = h("div", { class: "ab-label-layer" });
    this.viewport = h("div", { class: "viewport", tabindex: "-1" }, this.world, this.labelLayer);
    this.viewport.append(this.overlay);
    this.root = h(
      "div",
      { class: "canvas-area" },
      h("div", { class: "tab-strip" }, h("div", { class: "tab active" }, "씬")),
      this.viewport
    );

    this.bindEvents();
    store.on("doc", () => { this.worldCache = null; this.syncWorld(); this.renderOverlay(); });
    store.on("transient", () => { this.worldCache = null; this.syncWorld(); this.renderOverlay(); });
    store.on("view", () => {
      this.applyViewTransform();
      this.markInteracting();
      // 여유 영역을 벗어났을 때만 DOM을 다시 만든다
      if (this.needsRecull()) this.syncWorld();
      // 이름표 크기는 화면 기준이므로 배율이 바뀌면 겹침이 달라진다.
      // 이동만으로는 서로의 관계가 그대로라 다시 계산할 필요가 없다.
      else if (store.view.zoom !== this.labelZoom) this.layoutLabels();
      this.renderOverlay();
      this.syncLabels();
    });
    store.on("selection", () => { this.renderOverlay(); this.syncLabels(); });
    store.on("settings", () => { this.syncWorld(); this.renderOverlay(); });
    store.on("tool", () => {
      this.updateCursor();
      if (store.tool !== "measure") this.cancelMeasure();
    });

    new ResizeObserver(() => { this.renderOverlay(); this.syncLabels(); }).observe(this.viewport);
  }

  mounted(): void {
    this.syncWorld();
    this.fitToView();
  }

  /* ================= 좌표 변환 ================= */

  private screenToWorld(sx: number, sy: number): Point {
    const { zoom, panX, panY } = store.view;
    const r = this.viewport.getBoundingClientRect();
    return { x: (sx - r.left - panX) / zoom, y: (sy - r.top - panY) / zoom };
  }

  private worldToScreen(p: Point): Point {
    const { zoom, panX, panY } = store.view;
    return { x: p.x * zoom + panX, y: p.y * zoom + panY };
  }

  /* ================= 렌더링 ================= */

  /** 현재 화면에 대응하는 월드 영역 (margin은 화면 픽셀 단위 여유) */
  private visibleWorldRect(marginPx: number): Rect {
    const r = this.viewport.getBoundingClientRect();
    const { zoom, panX, panY } = store.view;
    const m = marginPx / zoom;
    return {
      x: -panX / zoom - m,
      y: -panY / zoom - m,
      w: r.width / zoom + m * 2,
      h: r.height / zoom + m * 2
    };
  }

  /** 지난번 만든 영역으로 지금 화면을 감당할 수 있는지 */
  private needsRecull(): boolean {
    if (!this.culledRect) return true;
    // 밖으로 나갔으면 새로 보일 것이 있다
    if (!rectContainsRect(this.culledRect, this.visibleWorldRect(0))) return true;
    // 확대해서 필요한 영역이 훨씬 좁아졌으면 남은 노드를 걷어낸다.
    // 이 조건이 없으면 축소 상태에서 만든 노드가 계속 남는다.
    const want = this.visibleWorldRect(CULL_MARGIN_PX);
    return this.culledRect.w * this.culledRect.h > want.w * want.h * 4;
  }

  /** 뷰 변환만 반영한다 (will-change는 건드리지 않는다) */
  private applyViewTransform(): void {
    const { zoom, panX, panY } = store.view;
    this.world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
    // 테두리·라벨·가이드가 화면 기준 크기를 유지하도록 역배율을 넘긴다
    this.world.style.setProperty("--zoom", String(zoom));
    this.world.style.setProperty("--inv-zoom", String(1 / zoom));
  }

  /**
   * 확대·이동 중에만 will-change를 켠다.
   *
   * 상시로 켜두면 브라우저가 원래 배율의 래스터를 그대로 확대해 텍스트와
   * 테두리가 뭉개진다. 움직임이 멎으면 떼어내 현재 배율로 다시 그리게 한다.
   * 문서 편집 경로에서는 부르지 않는다 — 켜고 끄기를 반복하면 레이어
   * 승격·해제가 되풀이돼 편집마다 전체를 다시 래스터하게 된다.
   */
  private markInteracting(): void {
    this.world.classList.add("interacting");
    if (this.settleTimer !== null) window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => {
      this.settleTimer = null;
      this.world.classList.remove("interacting");
    }, 180);
  }

  /**
   * 문서를 DOM에 반영한다.
   *
   * 매번 허물고 다시 만들면 편집마다 화면이 번쩍이고 요소 수에 비례해
   * 비용이 커진다. 여기서는 id로 노드를 재사용하고 바뀐 것만 손댄다.
   */
  private syncWorld(): void {
    // 화면 밖 요소는 DOM을 만들지 않는다. 여유를 크게 잡아 두면 이동
    // 중에는 대부분 다시 만들 필요가 없어 팬이 계속 가벼운 변환으로 끝난다.
    const cull = this.visibleWorldRect(CULL_MARGIN_PX);
    this.culledRect = cull;
    const world = this.worldMap();
    const seenAb = new Set<string>();
    let cursor: Element | null = this.world.firstElementChild;
    for (const ab of store.doc.artboards) {
      seenAb.add(ab.id);
      let parts = this.abNodes.get(ab.id);
      if (!parts) {
        parts = this.createArtboardNode(ab.id);
        this.abNodes.set(ab.id, parts);
      }
      if (parts.root !== cursor) {
        this.world.insertBefore(parts.root, cursor);
      } else {
        cursor = cursor.nextElementSibling;
      }
      this.syncArtboard(ab, parts, cull, world);
    }
    for (const [id, parts] of [...this.abNodes]) {
      if (!seenAb.has(id)) {
        parts.root.remove();
        this.abNodes.delete(id);
      }
    }
    this.applyViewTransform();
    // 드래그 중에는 건너뛴다 — 프레임마다 다시 배치하면 그만큼 무거워지고,
    // 손을 뗀 뒤 한 번만 맞춰도 결과는 같다. 다만 화면에 새로 들어온 노드는
    // 자리를 배정받은 적이 없으므로 그때는 미루지 않는다.
    if (!this.drag || this.createdNodes) this.layoutLabels();
    this.createdNodes = false;
    this.syncLabels();
  }

  private createArtboardNode(id: string): ArtboardNode {
    const bg = h("div", { class: "artboard-bg" });
    const grid = h("div", { class: "artboard-grid" });
    const content = h("div", { class: "artboard-content" });
    const guides = h("div", { class: "artboard-guides" });
    const root = h("div", { class: "artboard", dataset: { id } }, bg, grid, content, guides);
    return { root, bg, grid, content, guides };
  }

  private syncArtboard(
    ab: Artboard, parts: ArtboardNode, cull: Rect, world: Map<string, WorldEntry>
  ): void {
    const { root, bg, grid, content, guides } = parts;
    setStyle(root, "left", `${ab.position.x}px`);
    setStyle(root, "top", `${ab.position.y}px`);
    setStyle(root, "width", `${ab.width}px`);
    setStyle(root, "height", `${ab.height}px`);
    setStyle(root, "background", ab.background.color);

    const bgUrl = getImage(ab.background.image);
    setStyle(bg, "display", bgUrl ? "" : "none");
    if (bgUrl) {
      setStyle(bg, "backgroundImage", `url(${bgUrl})`);
      setStyle(bg, "opacity", String(ab.background.imageOpacity));
    }

    setStyle(grid, "display", store.settings.showGrid ? "" : "none");
    if (store.settings.showGrid) {
      setStyle(grid, "backgroundSize", `${store.settings.gridSize}px ${store.settings.gridSize}px`);
    }

    this.syncGuides(ab, guides);
    // 아트보드 전체가 화면 밖이면 내용까지 걷어낸다
    const visible = rectsIntersect(cull, artboardWorldRect(ab));
    this.syncElements(
      content, visible ? ab.children : [], ab.width, ab.height,
      content.firstElementChild, cull, world
    );
  }

  private syncGuides(ab: Artboard, layer: HTMLElement): void {
    const show = store.settings.showGuides;
    const want = show ? ab.guides.v.length + ab.guides.h.length : 0;
    while (layer.childElementCount > want) layer.lastElementChild!.remove();
    while (layer.childElementCount < want) layer.append(h("div", { class: "guide" }));
    if (!show) return;
    let i = 0;
    for (const v of ab.guides.v) {
      const node = layer.children[i++] as HTMLElement;
      node.className = "guide guide-v";
      node.style.top = "";
      setStyle(node, "left", `${v}px`);
    }
    for (const gh of ab.guides.h) {
      const node = layer.children[i++] as HTMLElement;
      node.className = "guide guide-h";
      node.style.left = "";
      setStyle(node, "top", `${gh}px`);
    }
  }

  /**
   * 컨테이너의 자식 노드를 문서 순서에 맞게 재사용·재배치한다.
   *
   * 요소 노드는 첫 자식이 항상 .el-label이어야 하므로, 자식 요소를 넣을 때는
   * 라벨 다음부터 시작한다(from). 그러지 않으면 라벨이 밀려나 갱신되지 않고
   * 뒤처리 루프에 지워진다.
   */
  private syncElements(
    container: HTMLElement, els: OPElement[], pw: number, ph: number,
    from: Element | null, cull: Rect, world: Map<string, WorldEntry>
  ): void {
    let cursor: Element | null = from;
    const rendered = new Set<string>();
    for (const el of els) {
      // 자손까지 포함한 경계가 화면 밖이면 통째로 건너뛴다
      const entry = world.get(el.id);
      if (entry && !rectsIntersect(cull, entry.subtreeAABB)) continue;
      rendered.add(el.id);
      let rec = this.nodeMap.get(el.id);
      if (!rec) {
        const label = h("div", { class: "el-label" });
        const node = h("div", { class: "op-el", dataset: { id: el.id } }, label);
        rec = { node, label, top: "", hidden: false, text: "", color: "" };
        this.nodeMap.set(el.id, rec);
        this.createdNodes = true;
      }
      const node = rec.node;
      // 재귀 중 커서가 가리키던 노드가 다른 부모로 옮겨졌을 수 있다
      if (cursor && cursor.parentElement !== container) cursor = null;
      if (node !== cursor) {
        container.insertBefore(node, cursor);
      } else {
        cursor = cursor.nextElementSibling;
      }
      const r = this.applyElementStyle(rec, el, pw, ph);
      // 첫 자식은 라벨이므로 그 다음부터 자식 요소를 배치한다
      this.syncElements(node, el.children, r.w, r.h, rec.label.nextElementSibling, cull, world);
    }
    // 문서에서 사라진 노드만 걷어낸다.
    // 커서를 따라가며 지우면, 재귀 중 다른 부모로 옮겨진 노드까지
    // 함께 지워진다(레이어 패널로 부모를 바꿀 때 요소가 사라지던 원인).
    // 컬링된 것도 여기서 걷힌다 (rendered에 없으므로)
    const wanted = rendered;
    for (const child of [...container.children]) {
      const id = (child as HTMLElement).dataset?.id;
      if (!id) continue; // .el-label 등 요소가 아닌 노드
      if (!wanted.has(id)) {
        this.forgetSubtree(id, child as HTMLElement);
        child.remove();
      }
    }
  }

  private forgetSubtree(id: string, node: HTMLElement): void {
    this.nodeMap.delete(id);
    for (const child of [...node.children]) {
      const cid = (child as HTMLElement).dataset?.id;
      if (cid) this.forgetSubtree(cid, child as HTMLElement);
    }
  }

  private applyElementStyle(rec: ElNode, el: OPElement, pw: number, ph: number): Rect {
    const node = rec.node;
    const r = localRectOf(el, pw, ph);
    setStyle(node, "left", `${r.x}px`);
    setStyle(node, "top", `${r.y}px`);
    setStyle(node, "width", `${r.w}px`);
    setStyle(node, "height", `${r.h}px`);
    setStyle(node, "transform", el.rotation ? `rotate(${el.rotation}deg)` : "");
    setStyle(node, "opacity", String(el.opacity));
    setStyle(node, "display", el.visible ? "" : "none");
    // 테두리는 box-shadow로 그리므로 색만 넘긴다 (위 .op-el 주석 참조)
    if (node.style.getPropertyValue("--el-color") !== el.color) {
      node.style.setProperty("--el-color", el.color);
    }
    setStyle(node, "background", hexWithAlpha(el.color, 0.14));
    // 라벨의 글자·색은 마지막으로 적은 값을 기억해 두고 달라질 때만 손댄다.
    // DOM을 되읽는 것만으로도 요소 수만큼 비용이 붙는다.
    const text = el.name || typeInfo(el.type).label;
    if (rec.text !== text) {
      rec.label.textContent = text;
      rec.text = text;
    }
    if (rec.color !== el.color) {
      rec.label.style.color = el.color;
      rec.color = el.color;
    }
    return r;
  }

  /**
   * 요소 이름표가 서로 가리지 않도록 자리를 잡는다.
   *
   * 겹친 요소는 이름표도 같은 자리에 포개져 아무것도 읽을 수 없다.
   * 화면 기준으로 위에서 아래로 훑으며 이미 놓인 이름표와 부딪히면 한 줄씩
   * 내리고, 더 내릴 자리가 없으면 감춘다. 너무 작게 보이는 요소도 감춘다.
   */
  private layoutLabels(): void {
    const { zoom, panX, panY } = store.view;
    this.labelZoom = zoom;
    const show = store.settings.showLabels;
    const world = this.worldMap();
    const items: { rec: ElNode; box: LabelBox }[] = [];

    for (const [id, rec] of this.nodeMap) {
      const entry = world.get(id);
      if (!show || !entry || !entry.el.visible ||
        // 이름표가 요소보다 커 보이면 읽히지도 않고 옆 요소만 가린다
        entry.aabb.w * zoom < LABEL_MIN_W || entry.aabb.h * zoom < LABEL_MIN_H) {
        hideLabel(rec);
        continue;
      }
      // 라벨은 요소 로컬 원점에 붙으므로 행렬의 평행이동 성분이 곧 그 위치다
      items.push({
        rec,
        box: {
          x: entry.matrix[4] * zoom + panX,
          y: entry.matrix[5] * zoom + panY,
          w: Math.min(entry.aabb.w * zoom, textWidthPx(rec.text))
        }
      });
    }

    // 활성 목록에는 아직 세로로 겹칠 수 있는 것만 남겨 비교 횟수를 줄인다
    items.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    const active: LabelBox[] = [];
    for (const { rec, box } of items) {
      const cutoff = box.y - LABEL_LANE_PX * (LABEL_MAX_LANES + 1);
      while (active.length > 0 && active[0].y < cutoff) active.shift();
      let lane = 0;
      while (lane < LABEL_MAX_LANES) {
        const y = box.y + lane * LABEL_LANE_PX;
        if (!active.some((p) => labelsOverlap(p, box.x, y, box.w))) break;
        lane++;
      }
      if (lane >= LABEL_MAX_LANES) {
        hideLabel(rec);
        continue;
      }
      active.push({ x: box.x, y: box.y + lane * LABEL_LANE_PX, w: box.w });
      // 라벨은 요소 좌표계에 놓이므로 화면 오프셋을 배율로 되돌려 넣는다
      showLabel(rec, lane === 0 ? "0px" : `${(lane * LABEL_LANE_PX) / zoom}px`);
    }
  }

  private syncLabels(): void {
    const want = store.doc.artboards.length;
    while (this.labelLayer.childElementCount > want) this.labelLayer.lastElementChild!.remove();
    while (this.labelLayer.childElementCount < want) {
      const label = h("div", { class: "ab-label" }, h("span", { class: "ab-label-name" }),
        h("span", { class: "ab-label-size" }));
      label.addEventListener("pointerdown", (e) => {
        const id = label.dataset.id;
        if (id) this.onArtboardLabelDown(e, id);
      });
      this.labelLayer.append(label);
    }
    store.doc.artboards.forEach((ab, i) => {
      const label = this.labelLayer.children[i] as HTMLElement;
      label.dataset.id = ab.id;
      const cls = `ab-label${ab.id === store.activeArtboardId ? " active" : ""}`;
      if (label.className !== cls) label.className = cls;
      const nameEl = label.firstElementChild as HTMLElement;
      const sizeEl = label.lastElementChild as HTMLElement;
      if (nameEl.textContent !== ab.name) nameEl.textContent = ab.name;
      const size = ` ${ab.width}×${ab.height}`;
      if (sizeEl.textContent !== size) sizeEl.textContent = size;
      const s = this.worldToScreen({ x: ab.position.x, y: ab.position.y });
      setStyle(label, "left", `${s.x}px`);
      setStyle(label, "top", `${s.y - 22}px`);
    });
  }

  /* ================= 오버레이 ================= */

  private renderOverlay(): void {
    clearChildren(this.decorLayer);
    const frag = document.createDocumentFragment();
    // 선택이 클 때 요소마다 조상 체인을 다시 걷지 않도록 한 번만 계산한다
    const world = this.worldMap();

    // 호버 표시
    if (this.hoverId && !store.selection.includes(this.hoverId) && !this.drag) {
      const info = world.get(this.hoverId);
      if (info) {
        frag.append(this.outlinePolygon(info, "op-hover-outline"));
      }
    }

    // 선택 메뉴에서 가리키고 있는 요소 강조
    if (this.pickHighlight) {
      const info = world.get(this.pickHighlight);
      if (info) frag.append(this.outlinePolygon(info, "op-pick-outline"));
    }

    // 선택 외곽선은 개수가 많아질 수 있으므로 노드를 재사용한다.
    // 매 프레임 수백 개를 새로 만들면 방향키 한 번에도 화면이 멈춘다.
    // 화면 밖 선택 항목의 외곽선은 그리지 않는다 — 전체 선택 시 대부분이
    // 화면 밖인데 SVG를 다 만들면 그만큼 낭비다
    const visible = this.visibleWorldRect(0);
    const selInfos = store.selection
      .map((id) => world.get(id))
      .filter((i): i is WorldEntry => !!i && rectsIntersect(visible, i.aabb));
    this.syncSelectionOutlines(selInfos);

    const single = store.selection.length === 1;
    if (single && store.tool === "select" && selInfos.length === 1) {
      this.appendHandles(frag, selInfos[0]);
      this.appendSizeBadge(frag, selInfos[0]);
    }

    // 다중 선택 묶음 외곽
    if (store.selection.length > 1) {
      const aabb = this.selectionWorldAABB(world);
      if (aabb) {
        const a = this.worldToScreen({ x: aabb.x, y: aabb.y });
        const b = this.worldToScreen({ x: aabb.x + aabb.w, y: aabb.y + aabb.h });
        const rect = svgEl("rect", {
          x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y, class: "op-multi-outline"
        });
        frag.append(rect);
      }
    }

    // 스냅 가이드 라인
    for (const line of this.snapLines) {
      const vr = this.viewport.getBoundingClientRect();
      if (line.axis === "v") {
        const sx = this.worldToScreen({ x: line.world, y: 0 }).x;
        frag.append(svgEl("line", { x1: sx, y1: 0, x2: sx, y2: vr.height, class: "op-snapline" }));
      } else {
        const sy = this.worldToScreen({ x: 0, y: line.world }).y;
        frag.append(svgEl("line", { x1: 0, y1: sy, x2: vr.width, y2: sy, class: "op-snapline" }));
      }
    }

    // 치수선 — 저장된 것과 드래그 중 임시 표시
    this.renderMeasures(frag, world);
    for (const hint of this.gapHints) {
      this.appendMeasureLine(frag, hint.axis, hint.a, hint.b, fmt(hint.value), "op-gap");
    }

    // 치수선 도구로 고른 첫 요소 표시
    if (this.measureFrom) {
      const info = world.get(this.measureFrom);
      if (info) frag.append(this.outlinePolygon(info, "op-measure-pick"));
    }

    // 마퀴
    if (this.drag?.mode === "marquee") {
      const a = this.worldToScreen(this.drag.startWorld);
      const b = this.worldToScreen(this.lastPointerWorld());
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      frag.append(svgEl("rect", {
        x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), class: "op-marquee"
      }));
    }

    this.decorLayer.append(frag);
  }

  /** 선택 외곽선 폴리곤을 풀에서 재사용한다 */
  private syncSelectionOutlines(infos: WorldInfo[]): void {
    const layer = this.selLayer;
    while (layer.childElementCount > infos.length) layer.lastElementChild!.remove();
    while (layer.childElementCount < infos.length) {
      layer.append(svgEl("polygon", { class: "op-sel-outline" }));
    }
    infos.forEach((info, i) => {
      const poly = layer.children[i] as SVGPolygonElement;
      const pts = worldCorners(info)
        .map((p) => this.worldToScreen(p))
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      if (poly.getAttribute("points") !== pts) poly.setAttribute("points", pts);
    });
  }

  private outlinePolygon(info: WorldInfo, cls: string): SVGPolygonElement {
    const pts = worldCorners(info).map((p) => this.worldToScreen(p));
    return svgEl("polygon", {
      points: pts.map((p) => `${p.x},${p.y}`).join(" "),
      class: cls
    });
  }

  private appendHandles(frag: DocumentFragment, info: WorldInfo): void {
    const positions = this.handlePositions(info);
    for (const [handle, p] of Object.entries(positions)) {
      const s = this.worldToScreen(p);
      frag.append(svgEl("rect", {
        x: s.x - 4, y: s.y - 4, width: 8, height: 8,
        class: "op-handle", "data-handle": handle
      }));
    }
    // 회전 핸들
    const rot = this.rotateHandleWorld(info);
    const topC = this.worldToScreen(applyMat(info.matrix, { x: info.w / 2, y: 0 }));
    const rs = this.worldToScreen(rot);
    frag.append(svgEl("line", { x1: topC.x, y1: topC.y, x2: rs.x, y2: rs.y, class: "op-rot-line" }));
    frag.append(svgEl("circle", { cx: rs.x, cy: rs.y, r: 5, class: "op-rot-handle" }));
  }

  private appendSizeBadge(frag: DocumentFragment, info: WorldInfo): void {
    const bottomC = this.worldToScreen(applyMat(info.matrix, { x: info.w / 2, y: info.h }));
    const text = svgEl("text", {
      x: bottomC.x, y: bottomC.y + 18, class: "op-size-badge", "text-anchor": "middle"
    });
    text.textContent = `${fmt(info.localRect.w)} × ${fmt(info.localRect.h)}`;
    frag.append(text);
  }

  /* ---------- 치수선 그리기 ---------- */

  private renderMeasures(frag: DocumentFragment, world: Map<string, WorldEntry>): void {
    this.measureHits = [];
    if (!store.settings.showMeasures) return;
    const visible = this.visibleWorldRect(60);
    for (const ab of store.doc.artboards) {
      for (const m of ab.measures) {
        const geom = measureGeom(ab, m, world);
        if (!geom) continue;
        if (!rectsIntersect(visible, lineBounds(geom.a, geom.b))) continue;
        const on = store.selectedMeasureId === m.id || this.pickHighlight === m.id;
        const drawn = this.appendMeasureLine(
          frag, geom.axis, geom.a, geom.b, fmt(geom.gap), "op-measure", on
        );
        this.measureHits.push({ artboardId: ab.id, measure: m, geom, ...drawn });
      }
    }
  }

  /** 치수선 한 줄을 그리고 화면상의 선·숫자 칩 위치를 돌려준다 */
  private appendMeasureLine(
    frag: DocumentFragment, axis: "h" | "v", aw: Point, bw: Point,
    text: string, cls: string, selected = false
  ): { chip: Rect; sa: Point; sb: Point } {
    const on = selected ? " sel" : "";
    const a = this.worldToScreen(aw);
    const b = this.worldToScreen(bw);
    frag.append(svgEl("line", {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `${cls}-line${on}`
    }));
    const tick = selected ? 6 : 4;
    for (const p of [a, b]) {
      frag.append(svgEl("line", {
        x1: axis === "h" ? p.x : p.x - tick,
        y1: axis === "h" ? p.y - tick : p.y,
        x2: axis === "h" ? p.x : p.x + tick,
        y2: axis === "h" ? p.y + tick : p.y,
        class: `${cls}-tick${on}`
      }));
    }
    const w = textWidthPx(text) + 2;
    const hh = 15;
    // 가로 치수선은 숫자를 위로, 세로 치수선은 옆으로 비켜 놓는다
    const cx = (a.x + b.x) / 2 + (axis === "h" ? 0 : w / 2 + 5);
    const cy = (a.y + b.y) / 2 - (axis === "h" ? 9 : 0);
    const chip: Rect = { x: cx - w / 2, y: cy - hh / 2, w, h: hh };
    frag.append(svgEl("rect", {
      x: chip.x, y: chip.y, width: chip.w, height: chip.h, rx: 2, class: `${cls}-chip${on}`
    }));
    const label = svgEl("text", {
      x: cx, y: cy + 4, class: `${cls}-text${on}`, "text-anchor": "middle"
    });
    label.textContent = text;
    frag.append(label);
    return { chip, sa: a, sb: b };
  }

  private handlePositions(info: WorldInfo): Record<Handle, Point> {
    const { w, h: hh, matrix } = info;
    const l = (x: number, y: number) => applyMat(matrix, { x, y });
    return {
      nw: l(0, 0), n: l(w / 2, 0), ne: l(w, 0),
      w: l(0, hh / 2), e: l(w, hh / 2),
      sw: l(0, hh), s: l(w / 2, hh), se: l(w, hh)
    };
  }

  private rotateHandleWorld(info: WorldInfo): Point {
    const { zoom } = store.view;
    const d = 26 / zoom;
    return applyMat(info.matrix, { x: info.w / 2, y: -d });
  }

  private selectionWorldAABB(world?: Map<string, WorldEntry>): Rect | null {
    const map = world ?? this.worldMap();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of store.selection) {
      const info = map.get(id);
      if (!info) continue;
      const bb = worldAABB(info);
      minX = Math.min(minX, bb.x);
      minY = Math.min(minY, bb.y);
      maxX = Math.max(maxX, bb.x + bb.w);
      maxY = Math.max(maxY, bb.y + bb.h);
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /* ================= 뷰 제어 ================= */

  setZoom(zoom: number, centerScreen?: Point): void {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const r = this.viewport.getBoundingClientRect();
    const c = centerScreen ?? { x: r.width / 2, y: r.height / 2 };
    const before = {
      x: (c.x - store.view.panX) / store.view.zoom,
      y: (c.y - store.view.panY) / store.view.zoom
    };
    store.setView({
      zoom: z,
      panX: c.x - before.x * z,
      panY: c.y - before.y * z
    });
  }

  fitToView(): void {
    const r = this.viewport.getBoundingClientRect();
    if (r.width < 10) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ab of store.doc.artboards) {
      minX = Math.min(minX, ab.position.x);
      minY = Math.min(minY, ab.position.y);
      maxX = Math.max(maxX, ab.position.x + ab.width);
      maxY = Math.max(maxY, ab.position.y + ab.height);
    }
    if (!Number.isFinite(minX)) return;
    const margin = 60;
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min(
        (r.width - margin * 2) / (maxX - minX),
        (r.height - margin * 2) / (maxY - minY)
      ))
    );
    store.setView({
      zoom,
      panX: (r.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      panY: (r.height - (maxY - minY) * zoom) / 2 - minY * zoom
    });
  }

  zoomTo100(): void {
    const ab = store.activeArtboard();
    const r = this.viewport.getBoundingClientRect();
    store.setView({
      zoom: 1,
      panX: r.width / 2 - (ab.position.x + ab.width / 2),
      panY: r.height / 2 - (ab.position.y + ab.height / 2)
    });
  }

  /* ================= 이벤트 ================= */

  private bindEvents(): void {
    this.viewport.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    window.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    // 터치 중단·브라우저 제스처로 up 없이 끝나면 드래그 상태가 영구히 남는다
    window.addEventListener("pointercancel", () => this.onPointerCancel());
    window.addEventListener("blur", () => {
      this.spaceHeld = false;
      this.updateCursor();
      this.onPointerCancel();
    });
    this.viewport.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.viewport.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    this.viewport.addEventListener("dblclick", (e) => this.onDblClick(e));

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !isEditableTarget(e.target)) {
        if (!this.spaceHeld) {
          this.spaceHeld = true;
          this.updateCursor();
        }
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") {
        this.spaceHeld = false;
        this.updateCursor();
      }
    });


    // 드래그 앤드 드롭으로 JSON/이미지 열기
    this.viewport.addEventListener("dragover", (e) => e.preventDefault());
    this.viewport.addEventListener("drop", (e) => this.onDrop(e));
  }

  private updateCursor(): void {
    const t = this.spaceHeld ? "hand" : store.tool;
    this.viewport.dataset.cursor = t;
  }

  private lastPointerWorld(): Point {
    return this.screenToWorld(this.lastPointer.x, this.lastPointer.y);
  }

  /** 유니티 씬 뷰 방식: 휠 = 커서 기준 확대/축소, Shift+휠 = 가로 이동 */
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.viewport.getBoundingClientRect();
    if (e.shiftKey) {
      store.setView({ panX: store.view.panX - (e.deltaY || e.deltaX) });
      return;
    }
    // 트랙패드 핀치는 ctrlKey가 실린 휠 이벤트로 들어온다 — 더 미세하게
    const speed = e.ctrlKey || e.metaKey ? 0.0015 : 0.002;
    const factor = Math.exp(-e.deltaY * speed);
    this.setZoom(store.view.zoom * factor, { x: e.clientX - r.left, y: e.clientY - r.top });
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    // preventScroll 없이 포커스를 주면 브라우저가 스크롤 조상을 움직여
    // 메뉴바·툴바를 화면 밖으로 밀어낼 수 있다
    this.viewport.focus({ preventScroll: true });
    this.lastPointer = { x: e.clientX, y: e.clientY };
    const world = this.screenToWorld(e.clientX, e.clientY);
    const screenLocal = this.screenPoint(e);

    // 팬: 중클릭 · 손 도구 · 스페이스
    if (e.button === 1 || store.tool === "hand" || this.spaceHeld) {
      this.drag = { mode: "pan", sx: e.clientX, sy: e.clientY, panX: store.view.panX, panY: store.view.panY };
      this.viewport.setPointerCapture(e.pointerId);
      this.viewport.dataset.cursor = "grabbing";
      e.preventDefault();
      return;
    }

    // 치수선: 선을 찍으면 선택, 숫자를 찍으면 그 자리에서 값을 고친다
    const measureHit = this.hitMeasure(screenLocal);
    if (measureHit) {
      e.preventDefault();
      store.selectMeasure(measureHit.hit.measure.id);
      if (measureHit.onChip) this.openMeasureEditor(measureHit.hit);
      return;
    }
    store.selectMeasure(null);

    // Alt+클릭 — 겹친 대상 중에서 곧바로 고른다
    if (e.altKey && store.tool === "select") {
      const cands = this.candidatesAt(world, screenLocal);
      if (cands.length > 1) {
        e.preventDefault();
        this.showPickMenu(cands, e.clientX, e.clientY);
        return;
      }
    }

    // 치수선 도구
    if (store.tool === "measure") {
      this.onMeasureClick(world);
      return;
    }

    // 그리기 도구
    if (store.tool === "draw") {
      const ab = this.artboardAt(world) ?? store.activeArtboard();
      store.setActiveArtboard(ab.id);
      const local = { x: world.x - ab.position.x, y: world.y - ab.position.y };
      this.drag = { mode: "draw", artboardId: ab.id, startLocal: local, elId: null, mutated: false };
      this.viewport.setPointerCapture(e.pointerId);
      return;
    }

    // 단일 선택 시 핸들 검사 (화면 좌표)
    if (store.selection.length === 1) {
      const info = worldInfoOf(store.doc, store.selection[0]);
      const found = findElement(store.doc, store.selection[0]);
      if (info && found && !found.el.locked) {
        const rs = this.worldToScreen(this.rotateHandleWorld(info));
        if (dist(screenLocal, rs) <= 8) {
          const centerW = applyMat(info.matrix, { x: info.w / 2, y: info.h / 2 });
          const cs = this.worldToScreen(centerW);
          this.drag = {
            mode: "rotate",
            id: found.el.id,
            center: centerW,
            startPointerAngle: Math.atan2(screenLocal.y - cs.y, screenLocal.x - cs.x),
            initRotation: found.el.rotation,
            mutated: false
          };
          this.viewport.setPointerCapture(e.pointerId);
          return;
        }
        const positions = this.handlePositions(info);
        for (const [handle, p] of Object.entries(positions)) {
          if (dist(screenLocal, this.worldToScreen(p)) <= 7) {
            const m = info.matrix;
            const axisAligned = Math.abs(m[1]) < 1e-6 && Math.abs(m[2]) < 1e-6;
            this.drag = {
              mode: "resize",
              handle: handle as Handle,
              id: found.el.id,
              initInfo: info,
              invInit: matInvert(info.matrix),
              startLocal: applyMat(matInvert(info.matrix), world),
              parentMat: parentWorldMatrix(store.doc, found.el.id),
              axisAligned,
              artboardId: found.artboard.id,
              mutated: false
            };
            this.prepareSnapTargets(found.artboard.id, new Set([found.el.id]));
            this.viewport.setPointerCapture(e.pointerId);
            return;
          }
        }
      }
    }

    // 가이드 잡기
    const guideHit = this.hitGuide(world);
    if (guideHit && store.settings.showGuides) {
      this.drag = { ...guideHit, mode: "guide", mutated: false };
      this.viewport.setPointerCapture(e.pointerId);
      return;
    }

    // 요소 히트 테스트. 다중 선택은 Ctrl — Shift는 이동 축 고정에 쓴다
    const additive = e.ctrlKey || e.metaKey;
    const hit = this.hitElement(world);
    if (hit) {
      store.setActiveArtboard(hit.artboardId);
      if (additive) {
        store.toggleSelect(hit.id);
        return;
      }
      const already = store.selection.includes(hit.id);
      if (!already) store.select([hit.id]);
      this.beginMoveDrag(world, e.pointerId, !already);
      return;
    }

    // 아트보드 배경 → 활성 전환 + 마퀴
    const ab = this.artboardAt(world);
    if (ab) store.setActiveArtboard(ab.id);
    this.drag = {
      mode: "marquee",
      startWorld: world,
      additive,
      base: additive ? [...store.selection] : []
    };
    if (!additive) store.clearSelection();
    this.viewport.setPointerCapture(e.pointerId);
  }

  /* ---------- 치수선 조작 ---------- */

  /**
   * 치수선 집기. 숫자 칩이 먼저이고, 그다음이 선 자체다.
   * 선을 집으면 선택만 하고, 숫자를 집으면 값 편집까지 연다.
   */
  private hitMeasure(screen: Point): { hit: MeasureHit; onChip: boolean } | null {
    if (!store.settings.showMeasures) return null;
    for (const hit of this.measureHits) {
      const r = hit.chip;
      if (screen.x >= r.x && screen.x <= r.x + r.w && screen.y >= r.y && screen.y <= r.y + r.h) {
        return { hit, onChip: true };
      }
    }
    for (const hit of this.measureHits) {
      if (distToSegment(screen, hit.sa, hit.sb) <= MEASURE_PICK_PX) {
        return { hit, onChip: false };
      }
    }
    return null;
  }

  /**
   * 마우스 아래에 있는 모든 대상을 위에 그려진 순서대로 모은다.
   * 겹쳐 있을 때 무엇을 고를지 메뉴로 물어보기 위한 목록이다.
   */
  private candidatesAt(world: Point, screen: Point): PickCandidate[] {
    const out: PickCandidate[] = [];
    if (store.settings.showMeasures) {
      for (const hit of this.measureHits) {
        const r = hit.chip;
        const onChip = screen.x >= r.x && screen.x <= r.x + r.w &&
          screen.y >= r.y && screen.y <= r.y + r.h;
        if (!onChip && distToSegment(screen, hit.sa, hit.sb) > MEASURE_PICK_PX) continue;
        out.push({
          kind: "measure",
          id: hit.measure.id,
          label: `치수선 ${fmt(hit.geom.gap)}`,
          hint: hit.measure.axis === "h" ? "가로" : "세로",
          selected: store.selectedMeasureId === hit.measure.id
        });
      }
    }
    const map = this.worldMap();
    // 히트 테스트와 같은 순서(위 → 아래, 자손 먼저)로 훑는다
    const walk = (els: OPElement[], artboardId: string): void => {
      for (let i = els.length - 1; i >= 0; i--) {
        const el = els[i];
        if (!el.visible || el.locked) continue;
        walk(el.children, artboardId);
        const info = map.get(el.id);
        if (!info || !pointInElement(info, world)) continue;
        const t = typeInfo(el.type);
        out.push({
          kind: "element",
          id: el.id,
          artboardId,
          label: el.name || t.label,
          hint: t.label,
          swatch: el.color || t.color,
          selected: store.selection.includes(el.id)
        });
      }
    };
    for (let i = store.doc.artboards.length - 1; i >= 0; i--) {
      const ab = store.doc.artboards[i];
      walk(ab.children, ab.id);
    }
    return out;
  }

  /** 겹친 대상 목록을 커서 옆에 띄운다. 항목에 올리면 캔버스에서 강조된다 */
  private showPickMenu(cands: PickCandidate[], clientX: number, clientY: number): void {
    const items: MenuItem[] = cands.map((c) => ({
      label: c.label,
      shortcut: c.selected ? "선택됨" : c.hint,
      swatch: c.kind === "element" ? c.swatch : undefined,
      checked: c.kind === "measure",
      onHover: () => {
        if (this.pickHighlight === c.id) return;
        this.pickHighlight = c.id;
        this.renderOverlay();
      },
      action: () => {
        if (c.kind === "measure") {
          store.selectMeasure(c.id);
        } else {
          store.setActiveArtboard(c.artboardId);
          store.select([c.id]);
        }
      }
    }));
    showMenu(items, clientX + 2, clientY + 2, () => {
      if (this.pickHighlight === null) return;
      this.pickHighlight = null;
      this.renderOverlay();
    });
  }

  /**
   * 치수선 도구 클릭. 첫 번째 요소를 고른 뒤 두 번째 요소를 찍으면
   * 둘 사이에, 빈 곳을 찍으면 가장 가까운 아트보드 가장자리까지 치수선을 만든다.
   */
  private onMeasureClick(world: Point): void {
    const map = this.worldMap();
    const hit = this.hitElement(world);
    if (!this.measureFrom) {
      if (!hit) return;
      store.setActiveArtboard(hit.artboardId);
      this.measureFrom = hit.id;
      this.renderOverlay();
      return;
    }
    const from = map.get(this.measureFrom);
    const fromId = this.measureFrom;
    this.measureFrom = null;
    if (!from) { this.renderOverlay(); return; }

    if (hit && hit.id !== fromId) {
      const to = map.get(hit.id);
      if (to && to.artboard.id === from.artboard.id) {
        addMeasure(from.artboard.id, {
          fromId, toId: hit.id, edge: "min",
          axis: dominantAxis(from.aabb, to.aabb), moves: "to"
        });
      } else {
        toast("같은 아트보드의 요소끼리만 잴 수 있습니다");
      }
    } else if (!hit) {
      const bb = from.aabb;
      const away = [
        { d: bb.x - world.x, axis: "h" as const, edge: "min" as const },
        { d: world.x - (bb.x + bb.w), axis: "h" as const, edge: "max" as const },
        { d: bb.y - world.y, axis: "v" as const, edge: "min" as const },
        { d: world.y - (bb.y + bb.h), axis: "v" as const, edge: "max" as const }
      ].reduce((best, c) => (c.d > best.d ? c : best));
      addMeasure(from.artboard.id, {
        fromId, toId: null, edge: away.edge, axis: away.axis, moves: "from"
      });
    }
    this.renderOverlay();
  }

  /** 치수선의 숫자를 그 자리에서 고친다 — 확정하면 지정한 쪽이 움직인다 */
  private openMeasureEditor(hit: MeasureHit): void {
    this.closeMeasureEditor();
    const input = h("input", {
      class: "measure-input",
      type: "number",
      value: String(hit.geom.gap),
      style: {
        left: `${Math.round(hit.chip.x + hit.chip.w / 2 - 30)}px`,
        top: `${Math.round(hit.chip.y - 3)}px`
      }
    }) as HTMLInputElement;
    this.measureEditor = input;
    this.viewport.append(input);
    input.focus({ preventScroll: true });
    input.select();
    let settled = false;
    const finish = (commit: boolean) => {
      if (settled) return;
      settled = true;
      const v = Number(input.value);
      input.remove();
      if (this.measureEditor === input) this.measureEditor = null;
      if (commit && Number.isFinite(v)) applyMeasure(hit.artboardId, hit.measure.id, v);
    };
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") input.blur();
      if (ev.key === "Escape") finish(false);
    });
    input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  }

  private closeMeasureEditor(): void {
    this.measureEditor?.remove();
    this.measureEditor = null;
  }

  /** 치수선 도구의 대기 상태를 푼다 (Esc·도구 전환) */
  cancelMeasure(): boolean {
    if (!this.measureFrom) return false;
    this.measureFrom = null;
    this.renderOverlay();
    return true;
  }

  private beginMoveDrag(world: Point, pointerId: number, selectionChanged = false): void {
    const ids = store.editableSelection();
    if (ids.length === 0) return;
    const items: MoveItem[] = [];
    for (const id of ids) {
      const f = findElement(store.doc, id)!;
      const pm = parentWorldMatrix(store.doc, id);
      const pInfo = f.parent ? worldInfoOf(store.doc, f.parent.id) : null;
      const pw = pInfo ? pInfo.w : f.artboard.width;
      const ph = pInfo ? pInfo.h : f.artboard.height;
      const rotOnly: Mat = [pm[0], pm[1], pm[2], pm[3], 0, 0];
      items.push({
        id,
        initRect: localRectOf(f.el, pw, ph),
        parentW: pw,
        parentH: ph,
        invParentRot: matInvert(rotOnly)
      });
    }
    const aabb = this.selectionWorldAABB();
    this.drag = {
      mode: "move",
      startWorld: world,
      items,
      initAABB: aabb ?? { x: world.x, y: world.y, w: 0, h: 0 },
      artboardId: store.activeArtboardId,
      mutated: false,
      selectionChanged
    };
    this.prepareSnapTargets(store.activeArtboardId, new Set(ids));
    this.viewport.setPointerCapture(pointerId);
  }

  private onPointerMove(e: PointerEvent): void {
    this.lastPointer = { x: e.clientX, y: e.clientY };
    const world = this.screenToWorld(e.clientX, e.clientY);
    this.emitCursorStatus(world);

    if (!this.drag) {
      if (store.tool === "select") {
        const hit = this.hitElement(world);
        const newHover = hit?.id ?? null;
        if (newHover !== this.hoverId) {
          this.hoverId = newHover;
          this.renderOverlay();
        }
      }
      return;
    }

    const d = this.drag;
    switch (d.mode) {
      case "pan": {
        store.setView({ panX: d.panX + (e.clientX - d.sx), panY: d.panY + (e.clientY - d.sy) });
        break;
      }
      case "move": {
        let dx = world.x - d.startWorld.x;
        let dy = world.y - d.startWorld.y;
        // 임계값은 화면 픽셀 기준 — 월드 단위로 두면 줌에 따라 감도가 달라진다
        const moveThreshold = 1.5 / store.view.zoom;
        if (Math.abs(dx) < moveThreshold && Math.abs(dy) < moveThreshold && !d.mutated) return;
        if (!d.mutated) {
          store.beginChange();
          d.mutated = true;
        }
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const snapped = this.applyMoveSnap(d, dx, dy, e.altKey);
        dx = snapped.dx;
        dy = snapped.dy;
        for (const item of d.items) {
          const f = findElement(store.doc, item.id);
          if (!f) continue;
          const local = applyMat(item.invParentRot, { x: dx, y: dy });
          writeLocalRect(f.el, item.parentW, item.parentH, {
            x: item.initRect.x + local.x,
            y: item.initRect.y + local.y,
            w: item.initRect.w,
            h: item.initRect.h
          });
        }
        store.notifyTransient();
        break;
      }
      case "resize": {
        if (!d.mutated) {
          store.beginChange();
          d.mutated = true;
        }
        this.performResize(d, world, e.shiftKey, e.altKey);
        store.notifyTransient();
        break;
      }
      case "rotate": {
        if (!d.mutated) {
          store.beginChange();
          d.mutated = true;
        }
        const cs = this.worldToScreen(d.center);
        const s = this.screenPoint(e);
        const angle = Math.atan2(s.y - cs.y, s.x - cs.x);
        let deg = d.initRotation + ((angle - d.startPointerAngle) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        deg = ((deg % 360) + 360) % 360;
        if (deg > 180) deg -= 360;
        const f = findElement(store.doc, d.id);
        if (f) f.el.rotation = Math.round(deg * 10) / 10;
        store.notifyTransient();
        break;
      }
      case "marquee": {
        this.updateMarquee(d);
        this.renderOverlay();
        break;
      }
      case "draw": {
        const ab = findArtboard(store.doc, d.artboardId);
        if (!ab) break;
        const local = { x: world.x - ab.position.x, y: world.y - ab.position.y };
        let x0 = Math.min(d.startLocal.x, local.x);
        let y0 = Math.min(d.startLocal.y, local.y);
        let w = Math.abs(local.x - d.startLocal.x);
        let hh = Math.abs(local.y - d.startLocal.y);
        if (store.settings.snapGrid) {
          const g = store.settings.gridSize;
          x0 = Math.round(x0 / g) * g;
          y0 = Math.round(y0 / g) * g;
          w = Math.max(g, Math.round(w / g) * g);
          hh = Math.max(g, Math.round(hh / g) * g);
        }
        if (w < 2 && hh < 2 && !d.elId) return;
        if (!d.mutated) {
          store.beginChange();
          d.mutated = true;
        }
        if (!d.elId) {
          const el = createElement({ type: store.drawType, id: genId("el") });
          el.x = x0; el.y = y0; el.width = Math.max(1, w); el.height = Math.max(1, hh);
          ab.children.push(el);
          d.elId = el.id;
          store.selection = [el.id];
          store.emit("doc");
        } else {
          const f = findElement(store.doc, d.elId);
          if (f) {
            f.el.x = round2(x0); f.el.y = round2(y0);
            f.el.width = round2(Math.max(1, w)); f.el.height = round2(Math.max(1, hh));
          }
          store.notifyTransient();
        }
        break;
      }
      case "artboard": {
        const ab = findArtboard(store.doc, d.id);
        if (!ab) break;
        if (!d.mutated) {
          store.beginChange();
          d.mutated = true;
        }
        ab.position.x = Math.round(d.initPos.x + (world.x - d.startWorld.x));
        ab.position.y = Math.round(d.initPos.y + (world.y - d.startWorld.y));
        store.notifyTransient();
        break;
      }
      case "guide": {
        const ab = findArtboard(store.doc, d.artboardId);
        if (!ab) break;
        if (!d.mutated) {
          store.beginChange();
          d.mutated = true;
        }
        const v = d.axis === "v" ? world.x - ab.position.x : world.y - ab.position.y;
        const arr = d.axis === "v" ? ab.guides.v : ab.guides.h;
        arr[d.index] = Math.round(v);
        store.emit("doc");
        break;
      }
    }
  }

  /**
   * up 없이 끝난 드래그 정리. 이미 문서를 손댔다면(beginChange 이후)
   * 그 상태로 확정한다 — 버리면 히스토리에 짝 잃은 스냅샷이 남는다.
   */
  private onPointerCancel(): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.snapLines = [];
    this.gapHints = [];
    this.snapTargets = null;
    this.updateCursor();
    switch (d.mode) {
      case "move":
      case "resize":
      case "rotate":
      case "artboard":
      case "guide":
        if (d.mutated) store.commit();
        break;
      case "draw":
        if (d.mutated) store.commit();
        store.setTool("select");
        break;
      default:
        this.renderOverlay();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.snapLines = [];
    this.gapHints = [];
    this.snapTargets = null;
    this.updateCursor();

    switch (d.mode) {
      case "pan":
        break;
      case "move": {
        if (d.mutated) {
          store.commit();
          break;
        }
        // 끌지 않고 그냥 눌렀다 뗀 경우. 이미 선택돼 있던 것을 다시 찍었다면
        // "다른 걸 고르고 싶다"는 뜻으로 보고, 아래에 겹친 대상을 메뉴로 보여 준다.
        //
        // 첫 클릭에도 띄우면 고른 다음 곧바로 끌 수가 없다 — 메뉴가 화면을
        // 덮어 다음 누름이 메뉴를 닫는 데 쓰이기 때문이다.
        if (!store.settings.pickMenu || d.selectionChanged) break;
        const cands = this.candidatesAt(d.startWorld, this.worldToScreen(d.startWorld));
        if (cands.length > 1) this.showPickMenu(cands, e.clientX, e.clientY);
        break;
      }
      case "resize":
      case "rotate":
      case "artboard":
        if (d.mutated) store.commit();
        break;
      case "marquee":
        this.renderOverlay();
        break;
      case "draw": {
        if (d.mutated && d.elId) {
          const f = findElement(store.doc, d.elId);
          if (f && (f.el.width < 4 || f.el.height < 4)) {
            f.el.width = 200;
            f.el.height = 120;
          }
          store.commit();
        } else {
          // 클릭만 한 경우: 기본 크기 요소 생성
          const world = this.screenToWorld(e.clientX, e.clientY);
          const ab = findArtboard(store.doc, d.artboardId);
          if (ab) {
            store.beginChange();
            const el = createElement({ type: store.drawType });
            el.x = round2(world.x - ab.position.x);
            el.y = round2(world.y - ab.position.y);
            ab.children.push(el);
            store.selection = [el.id];
            store.commit();
          }
        }
        store.setTool("select");
        break;
      }
      case "guide": {
        const ab = findArtboard(store.doc, d.artboardId);
        if (ab && d.mutated) {
          const arr = d.axis === "v" ? ab.guides.v : ab.guides.h;
          const val = arr[d.index];
          const max = d.axis === "v" ? ab.width : ab.height;
          // 아트보드 밖으로 끌어내면 삭제
          if (val < 0 || val > max) arr.splice(d.index, 1);
          store.commit();
        }
        break;
      }
    }
  }

  private onDblClick(e: MouseEvent): void {
    const world = this.screenToWorld(e.clientX, e.clientY);
    const ab = this.artboardAt(world);
    if (!ab) {
      this.fitToView();
    }
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const measureHit = this.hitMeasure(this.screenPoint(e))?.hit;
    if (measureHit) {
      const { artboardId, measure } = measureHit;
      store.selectMeasure(measure.id);
      showMenu([
        {
          label: "간격 수정…",
          action: () => this.openMeasureEditor(measureHit)
        },
        {
          label: "움직일 쪽 바꾸기",
          disabled: measure.toId === null,
          action: () => flipMeasureTarget(artboardId, measure.id)
        },
        { separator: true },
        { label: "치수선 삭제", action: () => deleteMeasure(artboardId, measure.id) }
      ], e.clientX, e.clientY);
      return;
    }
    const world = this.screenToWorld(e.clientX, e.clientY);
    const hit = this.hitElement(world);
    if (hit && !store.selection.includes(hit.id)) {
      store.select([hit.id]);
    }
    if (store.selection.length > 0) {
      showMenu(buildElementContextMenu(), e.clientX, e.clientY);
    }
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.type.startsWith("image/")) {
      const world = this.screenToWorld(e.clientX, e.clientY);
      const ab = this.artboardAt(world) ?? store.activeArtboard();
      const reader = new FileReader();
      reader.onload = () => {
        store.beginChange();
        const target = findArtboard(store.doc, ab.id);
        if (!target) { store.cancelChange(); return; }
        target.background.image = registerImage(reader.result as string);
        store.commit();
      };
      reader.readAsDataURL(file);
    } else {
      void file.text().then((text) => importText(text));
    }
  }

  /* ================= 히트 테스트 ================= */

  private artboardAt(world: Point): Artboard | null {
    for (let i = store.doc.artboards.length - 1; i >= 0; i--) {
      const ab = store.doc.artboards[i];
      const r = artboardWorldRect(ab);
      if (world.x >= r.x && world.y >= r.y && world.x <= r.x + r.w && world.y <= r.y + r.h) {
        return ab;
      }
    }
    return null;
  }

  private hitElement(world: Point): { id: string; artboardId: string } | null {
    // 문서가 안 바뀌었으면 캐시를 재사용한다 — 호버가 가장 뜨거운 경로다
    const map = this.worldMap();
    for (let i = store.doc.artboards.length - 1; i >= 0; i--) {
      const ab = store.doc.artboards[i];
      const hit = this.hitIn(ab.children, world, map);
      if (hit) return { id: hit, artboardId: ab.id };
    }
    return null;
  }

  private hitIn(
    els: OPElement[], world: Point, map: Map<string, WorldEntry>
  ): string | null {
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (!el.visible || el.locked) {
        // 잠긴 요소는 통과하되 자식도 제외
        continue;
      }
      const deep = this.hitIn(el.children, world, map);
      if (deep) return deep;
      const info = map.get(el.id);
      if (info && pointInElement(info, world)) return el.id;
    }
    return null;
  }

  private hitGuide(world: Point): { artboardId: string; axis: "v" | "h"; index: number } | null {
    const threshold = 5 / store.view.zoom;
    for (const ab of store.doc.artboards) {
      const r = artboardWorldRect(ab);
      if (!pointNearRect(world, r, threshold)) continue;
      for (let i = 0; i < ab.guides.v.length; i++) {
        if (Math.abs(world.x - (r.x + ab.guides.v[i])) <= threshold) {
          return { artboardId: ab.id, axis: "v", index: i };
        }
      }
      for (let i = 0; i < ab.guides.h.length; i++) {
        if (Math.abs(world.y - (r.y + ab.guides.h[i])) <= threshold) {
          return { artboardId: ab.id, axis: "h", index: i };
        }
      }
    }
    return null;
  }

  /* ================= 스냅 ================= */

  /**
   * 드래그 시작 시 스냅 대상 좌표를 모아 둔다.
   * 아트보드 경계·중앙, 가이드, 그리고 움직이지 않는 다른 요소의 경계·중앙.
   */
  private prepareSnapTargets(artboardId: string, excluded: Set<string>): void {
    const empty: SnapTargets = { xs: [], ys: [], ws: [], hs: [], rects: [] };
    const ab = findArtboard(store.doc, artboardId);
    if (!ab) { this.snapTargets = empty; return; }
    const abr = artboardWorldRect(ab);
    const xs = [abr.x, abr.x + abr.w / 2, abr.x + abr.w];
    const ys = [abr.y, abr.y + abr.h / 2, abr.y + abr.h];
    const ws: number[] = [];
    const hs: number[] = [];
    const rects: Rect[] = [];

    if (store.settings.snapGuides && store.settings.showGuides) {
      for (const v of ab.guides.v) xs.push(abr.x + v);
      for (const gh of ab.guides.h) ys.push(abr.y + gh);
    }
    if (store.settings.snapElements) {
      const map = this.worldMap();
      // 자손까지 훑는다 — 패널 안쪽 요소에도 붙을 수 있어야 한다.
      // 움직이는 요소는 그 자손까지 통째로 건너뛴다.
      const walk = (els: OPElement[]): void => {
        for (const el of els) {
          if (excluded.has(el.id) || !el.visible) continue;
          const info = map.get(el.id);
          if (info) {
            const bb = info.aabb;
            xs.push(bb.x, bb.x + bb.w / 2, bb.x + bb.w);
            ys.push(bb.y, bb.y + bb.h / 2, bb.y + bb.h);
            ws.push(bb.w);
            hs.push(bb.h);
            rects.push(bb);
          }
          if (el.children.length > 0) walk(el.children);
        }
      };
      walk(ab.children);
    }
    this.snapTargets = { xs, ys, ws, hs, rects };
  }

  /**
   * 이웃과의 간격을 맞추는 스냅.
   *
   * 가장자리 스냅만으로는 "같은 간격으로 늘어놓기"를 손으로 맞춰야 한다.
   * 양옆에 이웃이 있으면 두 간격이 같아지는 자리에, 한쪽만 있으면 이미
   * 쓰이고 있는 간격과 같아지는 자리에 물린다.
   */
  private gapSnap(
    moving: Rect, axis: "h" | "v", threshold: number
  ): { adj: number; hints: GapHint[] } | null {
    const rects = this.snapTargets?.rects;
    if (!rects || rects.length === 0) return null;
    const lo = (r: Rect) => (axis === "h" ? r.x : r.y);
    const hi = (r: Rect) => (axis === "h" ? r.x + r.w : r.y + r.h);
    const clo = (r: Rect) => (axis === "h" ? r.y : r.x);
    const chi = (r: Rect) => (axis === "h" ? r.y + r.h : r.x + r.w);
    // 직교 방향으로 겹치는 것만 이웃으로 본다 — 멀리 떨어진 줄과 맞추면 혼란스럽다
    const band = rects.filter((r) => chi(r) > clo(moving) && clo(r) < chi(moving));
    if (band.length === 0) return null;

    let before: Rect | null = null;
    let after: Rect | null = null;
    for (const r of band) {
      if (hi(r) <= lo(moving) && (!before || hi(r) > hi(before))) before = r;
      if (lo(r) >= hi(moving) && (!after || lo(r) < lo(after))) after = r;
    }

    type Cand = { adj: number; before: Rect | null; after: Rect | null };
    const cands: Cand[] = [];
    if (before && after) {
      const free = lo(after) - hi(before) - (hi(moving) - lo(moving));
      if (free >= 0) cands.push({ adj: hi(before) + free / 2 - lo(moving), before, after });
    }
    for (const g of commonGaps(band, axis)) {
      if (before) cands.push({ adj: hi(before) + g - lo(moving), before, after: null });
      if (after) cands.push({ adj: lo(after) - g - hi(moving), before: null, after });
    }

    let best: Cand | null = null;
    for (const c of cands) {
      if (Math.abs(c.adj) <= threshold && (!best || Math.abs(c.adj) < Math.abs(best.adj))) best = c;
    }
    if (!best) return null;
    const moved: Rect = axis === "h"
      ? { ...moving, x: moving.x + best.adj }
      : { ...moving, y: moving.y + best.adj };
    const hints: GapHint[] = [];
    if (best.before) hints.push(gapHint(best.before, moved, axis));
    if (best.after) hints.push(gapHint(moved, best.after, axis));
    return { adj: best.adj, hints };
  }

  private applyMoveSnap(
    d: Extract<DragState, { mode: "move" }>, dx: number, dy: number, bypass: boolean
  ): { dx: number; dy: number } {
    this.snapLines = [];
    this.gapHints = [];
    if (bypass) return { dx, dy };
    const { snapGrid, snapElements, snapGaps, gridSize } = store.settings;
    const threshold = SNAP_SCREEN_PX / store.view.zoom;
    const ab = findArtboard(store.doc, d.artboardId);
    if (!ab) return { dx, dy };
    const abr = artboardWorldRect(ab);

    const moving = {
      x: d.initAABB.x + dx,
      y: d.initAABB.y + dy,
      w: d.initAABB.w,
      h: d.initAABB.h
    };
    const movingXs = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
    const movingYs = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

    // 스냅 대상은 드래그 중 움직이지 않으므로 시작할 때 한 번만 모은다.
    // 프레임마다 다시 모으면 요소 수의 제곱으로 비용이 늘어난다.
    const targetXs = this.snapTargets?.xs ?? [];
    const targetYs = this.snapTargets?.ys ?? [];

    let bestDx: { adj: number; line: number } | null = null;
    for (const mx of movingXs) {
      for (const tx of targetXs) {
        const diff = tx - mx;
        if (Math.abs(diff) <= threshold && (!bestDx || Math.abs(diff) < Math.abs(bestDx.adj))) {
          bestDx = { adj: diff, line: tx };
        }
      }
    }
    let bestDy: { adj: number; line: number } | null = null;
    for (const my of movingYs) {
      for (const ty of targetYs) {
        const diff = ty - my;
        if (Math.abs(diff) <= threshold && (!bestDy || Math.abs(diff) < Math.abs(bestDy.adj))) {
          bestDy = { adj: diff, line: ty };
        }
      }
    }

    let outDx = dx + (bestDx?.adj ?? 0);
    let outDy = dy + (bestDy?.adj ?? 0);
    if (bestDx) this.snapLines.push({ axis: "v", world: bestDx.line });
    if (bestDy) this.snapLines.push({ axis: "h", world: bestDy.line });

    // 간격 스냅 — 가장자리에 물리지 않은 축에서만 시도한다
    let gapX = false;
    let gapY = false;
    if (snapGaps && snapElements) {
      if (!bestDx) {
        const g = this.gapSnap(moving, "h", threshold);
        if (g) { outDx = dx + g.adj; this.gapHints.push(...g.hints); gapX = true; }
      }
      if (!bestDy) {
        const g = this.gapSnap(moving, "v", threshold);
        if (g) { outDy = dy + g.adj; this.gapHints.push(...g.hints); gapY = true; }
      }
    }

    // 격자 스냅 (다른 스냅이 없을 때)
    if (snapGrid) {
      if (!bestDx && !gapX) {
        const localX = d.initAABB.x + dx - abr.x;
        outDx = Math.round(localX / gridSize) * gridSize + abr.x - d.initAABB.x;
      }
      if (!bestDy && !gapY) {
        const localY = d.initAABB.y + dy - abr.y;
        outDy = Math.round(localY / gridSize) * gridSize + abr.y - d.initAABB.y;
      }
    }
    return { dx: outDx, dy: outDy };
  }

  /* ================= 크기 조절 ================= */

  private performResize(
    d: Extract<DragState, { mode: "resize" }>, world: Point, keepAspect: boolean, fromCenter: boolean
  ): void {
    const f = findElement(store.doc, d.id);
    if (!f) return;
    const { initInfo, handle } = d;
    const W0 = initInfo.w;
    const H0 = initInfo.h;
    const p = applyMat(d.invInit, world);

    let x0 = 0, y0 = 0, w = W0, hh = H0;
    const affectsW = handle.includes("e") || handle.includes("w");
    const affectsH = handle.includes("n") || handle.includes("s");

    if (handle.includes("e")) { w = p.x; }
    if (handle.includes("s")) { hh = p.y; }
    if (handle.includes("w")) { x0 = p.x; w = W0 - p.x; }
    if (handle.includes("n")) { y0 = p.y; hh = H0 - p.y; }

    if (keepAspect && W0 > 0 && H0 > 0 && affectsW && affectsH) {
      const ratio = W0 / H0;
      if (Math.abs(w / W0) > Math.abs(hh / H0)) {
        const newH = w / ratio;
        if (handle.includes("n")) y0 = H0 - newH;
        hh = newH;
      } else {
        const newW = hh * ratio;
        if (handle.includes("w")) x0 = W0 - newW;
        w = newW;
      }
    }

    if (fromCenter) {
      const cx = W0 / 2;
      const cy = H0 / 2;
      if (affectsW) {
        const half = Math.abs(p.x - cx);
        x0 = cx - half;
        w = half * 2;
      }
      if (affectsH) {
        const half = Math.abs(p.y - cy);
        y0 = cy - half;
        hh = half * 2;
      }
    }

    w = Math.max(1, w);
    hh = Math.max(1, hh);

    // 새 중심 (초기 요소 좌표계 → 월드)
    const centerLocal = { x: x0 + w / 2, y: y0 + hh / 2 };
    const centerWorld = applyMat(initInfo.matrix, centerLocal);
    // 부모 좌표계로 환산
    const centerParent = applyMat(matInvert(d.parentMat), centerWorld);
    let rect: Rect = { x: centerParent.x - w / 2, y: centerParent.y - hh / 2, w, h: hh };

    // 축 정렬 시 스냅
    this.snapLines = [];
    if (d.axisAligned && f.el.rotation === 0 && !keepAspect) {
      rect = this.applyResizeSnap(d, rect, handle);
    }

    writeLocalRect(f.el, initInfo.parentW, initInfo.parentH, rect);
  }

  private applyResizeSnap(
    d: Extract<DragState, { mode: "resize" }>, rect: Rect, handle: Handle
  ): Rect {
    const { snapGrid, snapElements, gridSize } = store.settings;
    const threshold = SNAP_SCREEN_PX / store.view.zoom;
    const ab = findArtboard(store.doc, d.artboardId);
    if (!ab) return rect;
    const abr = artboardWorldRect(ab);
    // 부모 → 월드 (축 정렬 가정)
    const off = { x: d.parentMat[4], y: d.parentMat[5] };
    const wRect = { x: rect.x + off.x, y: rect.y + off.y, w: rect.w, h: rect.h };

    // 이동과 마찬가지로 대상은 드래그 시작 시 모아 둔 것을 쓴다
    const prepared = this.snapTargets;
    const targetXs = [...(prepared?.xs ?? [])];
    const targetYs = [...(prepared?.ys ?? [])];
    // 다른 요소와 같은 크기가 되는 자리도 후보에 넣는다.
    // 반대편 가장자리를 고정한 채 폭·높이를 맞추는 것이므로 핸들마다 다르다.
    const sizeX = snapElements ? (prepared?.ws ?? []) : [];
    const sizeY = snapElements ? (prepared?.hs ?? []) : [];
    if (snapGrid) {
      const edgeX = handle.includes("w") ? wRect.x : wRect.x + wRect.w;
      const edgeY = handle.includes("n") ? wRect.y : wRect.y + wRect.h;
      targetXs.push(Math.round((edgeX - abr.x) / gridSize) * gridSize + abr.x);
      targetYs.push(Math.round((edgeY - abr.y) / gridSize) * gridSize + abr.y);
    }

    if (handle.includes("e")) {
      const edge = wRect.x + wRect.w;
      const best = nearest([...targetXs, ...sizeX.map((w) => wRect.x + w)], edge, threshold);
      if (best !== null) {
        wRect.w = Math.max(1, best - wRect.x);
        this.snapLines.push({ axis: "v", world: best });
      }
    }
    if (handle.includes("w")) {
      const right = wRect.x + wRect.w;
      const best = nearest([...targetXs, ...sizeX.map((w) => right - w)], wRect.x, threshold);
      if (best !== null) {
        wRect.w = Math.max(1, right - best);
        wRect.x = best;
        this.snapLines.push({ axis: "v", world: best });
      }
    }
    if (handle.includes("s")) {
      const edge = wRect.y + wRect.h;
      const best = nearest([...targetYs, ...sizeY.map((hh) => wRect.y + hh)], edge, threshold);
      if (best !== null) {
        wRect.h = Math.max(1, best - wRect.y);
        this.snapLines.push({ axis: "h", world: best });
      }
    }
    if (handle.includes("n")) {
      const bottom = wRect.y + wRect.h;
      const best = nearest([...targetYs, ...sizeY.map((hh) => bottom - hh)], wRect.y, threshold);
      if (best !== null) {
        wRect.h = Math.max(1, bottom - best);
        wRect.y = best;
        this.snapLines.push({ axis: "h", world: best });
      }
    }
    return { x: wRect.x - off.x, y: wRect.y - off.y, w: wRect.w, h: wRect.h };
  }

  /* ================= 마퀴 ================= */

  private updateMarquee(d: Extract<DragState, { mode: "marquee" }>): void {
    const cur = this.lastPointerWorld();
    const rect: Rect = {
      x: Math.min(d.startWorld.x, cur.x),
      y: Math.min(d.startWorld.y, cur.y),
      w: Math.abs(cur.x - d.startWorld.x),
      h: Math.abs(cur.y - d.startWorld.y)
    };
    const ids: string[] = [...d.base];
    const map = this.worldMap();
    for (const ab of store.doc.artboards) {
      for (const el of ab.children) {
        if (!el.visible || el.locked) continue;
        const info = map.get(el.id);
        if (!info) continue;
        if (rectsIntersect(rect, worldAABB(info)) && !ids.includes(el.id)) {
          ids.push(el.id);
        }
      }
    }
    store.selection = ids;
    store.emit("selection");
  }

  /* ================= 가이드 · 프레임 ================= */

  /**
   * 화면 중앙 위치에 가이드를 추가한다 (보기 메뉴에서 호출).
   * 이후 위치는 캔버스에서 드래그로 조정하고, 아트보드 밖으로 끌면 삭제된다.
   */
  addGuide(axis: "v" | "h"): void {
    const ab = store.activeArtboard();
    const r = this.viewport.getBoundingClientRect();
    const center = this.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    store.beginChange();
    const value = axis === "v"
      ? Math.min(ab.width, Math.max(0, Math.round(center.x - ab.position.x)))
      : Math.min(ab.height, Math.max(0, Math.round(center.y - ab.position.y)));
    (axis === "v" ? ab.guides.v : ab.guides.h).push(value);
    store.commit();
    if (!store.settings.showGuides) store.updateSettings({ showGuides: true });
  }

  /** 선택 항목(없으면 활성 아트보드)이 화면에 차도록 뷰를 맞춘다 */
  frameSelection(): void {
    const r = this.viewport.getBoundingClientRect();
    if (r.width < 10) return;
    const box = this.selectionWorldAABB() ?? artboardWorldRect(store.activeArtboard());
    const w = Math.max(box.w, 1);
    const hgt = Math.max(box.h, 1);
    const margin = 80;
    const zoom = Math.min(8, Math.max(MIN_ZOOM, Math.min(
      (r.width - margin * 2) / w,
      (r.height - margin * 2) / hgt
    )));
    store.setView({
      zoom,
      panX: (r.width - w * zoom) / 2 - box.x * zoom,
      panY: (r.height - hgt * zoom) / 2 - box.y * zoom
    });
  }

  /* ================= 상태 통지 ================= */

  private emitCursorStatus(world: Point): void {
    const ab = this.artboardAt(world) ?? store.activeArtboard();
    window.dispatchEvent(new CustomEvent("op:cursor", {
      detail: {
        x: Math.round(world.x - ab.position.x),
        y: Math.round(world.y - ab.position.y),
        artboard: ab.name
      }
    }));
  }

  private screenPoint(e: MouseEvent): Point {
    const r = this.viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onArtboardLabelDown(e: PointerEvent, id: string): void {
    e.preventDefault();
    e.stopPropagation();
    store.setActiveArtboard(id);
    store.clearSelection();
    const ab = findArtboard(store.doc, id);
    if (!ab) return;
    const world = this.screenToWorld(e.clientX, e.clientY);
    this.drag = {
      mode: "artboard",
      id,
      startWorld: world,
      initPos: { ...ab.position },
      mutated: false
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
}

/* ================= 헬퍼 ================= */

/** 배치 계산용 이름표 상자 (화면 좌표, 높이는 LABEL_LANE_PX 고정) */
interface LabelBox {
  x: number;
  y: number;
  w: number;
}

/** 이름표에 마지막으로 적은 값을 그대로 다시 쓰지 않도록 기억해 둔다 */
function hideLabel(rec: ElNode): void {
  if (rec.hidden) return;
  rec.label.style.display = "none";
  rec.hidden = true;
}

function showLabel(rec: ElNode, top: string): void {
  if (rec.hidden) {
    rec.label.style.display = "";
    rec.hidden = false;
  }
  if (rec.top !== top) {
    rec.label.style.top = top;
    rec.top = top;
  }
}

function labelsOverlap(p: LabelBox, x: number, y: number, w: number): boolean {
  return x < p.x + p.w && x + w > p.x &&
    y < p.y + LABEL_LANE_PX && y + LABEL_LANE_PX > p.y;
}

/**
 * 글자 폭 어림값.
 * 실제 측정은 요소마다 레이아웃을 강제해 프레임을 잡아먹으므로,
 * 한글·한자는 11px, 나머지는 6px로 계산한다.
 */
const textWidthCache = new Map<string, number>();

function textWidthPx(text: string): number {
  const hit = textWidthCache.get(text);
  if (hit !== undefined) return hit;
  let w = 8;
  for (const ch of text) w += ch.codePointAt(0)! > 0x2e80 ? 11 : 6;
  // 이름을 계속 고치는 동안 무한정 쌓이지 않게 한도를 둔다
  if (textWidthCache.size > 2000) textWidthCache.clear();
  textWidthCache.set(text, w);
  return w;
}

/** 두 점을 감싸는 사각형 (선의 화면 밖 판정용) */
function lineBounds(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(1, Math.abs(b.x - a.x)), h: Math.max(1, Math.abs(b.y - a.y)) };
}

/** 나란한 요소들 사이에 이미 쓰이고 있는 간격 값 (최대 8개) */
function commonGaps(band: Rect[], axis: "h" | "v"): number[] {
  const lo = (r: Rect) => (axis === "h" ? r.x : r.y);
  const hi = (r: Rect) => (axis === "h" ? r.x + r.w : r.y + r.h);
  const sorted = [...band].sort((a, b) => lo(a) - lo(b));
  const gaps = new Set<number>();
  for (let i = 1; i < sorted.length && gaps.size < 8; i++) {
    const g = Math.round((lo(sorted[i]) - hi(sorted[i - 1])) * 100) / 100;
    if (g > 0.5) gaps.add(g);
  }
  return [...gaps];
}

/** a가 b보다 앞선다고 가정하고 둘 사이 간격 표시를 만든다 */
function gapHint(a: Rect, b: Rect, axis: "h" | "v"): GapHint {
  if (axis === "h") {
    const y = (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2;
    return { axis, a: { x: a.x + a.w, y }, b: { x: b.x, y }, value: b.x - (a.x + a.w) };
  }
  const x = (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2;
  return { axis, a: { x, y: a.y + a.h }, b: { x, y: b.y }, value: b.y - (a.y + a.h) };
}

/** outer가 inner를 완전히 담고 있는지 */
function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h;
}

function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex + a;
  return hex;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 점에서 선분까지의 거리 — 치수선을 집는 데 쓴다 */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function nearest(candidates: number[], value: number, threshold: number): number | null {
  let best: number | null = null;
  for (const c of candidates) {
    if (Math.abs(c - value) <= threshold && (best === null || Math.abs(c - value) < Math.abs(best - value))) {
      best = c;
    }
  }
  return best;
}

function pointNearRect(p: Point, r: Rect, pad: number): boolean {
  return p.x >= r.x - pad && p.y >= r.y - pad && p.x <= r.x + r.w + pad && p.y <= r.y + r.h + pad;
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isEditableTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}
