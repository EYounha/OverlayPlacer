import { store } from "../state/store";
import type { Artboard, OPElement, Point, Rect } from "../types";
import { typeInfo } from "../types";
import { findArtboard, findElement, createElement, genId } from "../model/doc";
import {
  applyMat, artboardWorldRect, localRectOf, matInvert, parentWorldMatrix,
  pointInElement, rectsIntersect, worldAABB, worldCorners, worldInfoOf, writeLocalRect,
  type Mat, type WorldInfo
} from "../model/geometry";
import { h, svgEl, clearChildren } from "./dom";
import { showMenu } from "./contextmenu";
import { buildElementContextMenu } from "./sharedMenus";
import { importText } from "../actions";
import { getImage, registerImage } from "../state/imageStore";

const RULER = 24;
const SNAP_SCREEN_PX = 6;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 32;

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

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
      isNew: boolean; mutated: boolean;
    };

interface SnapLine {
  axis: "v" | "h";
  world: number;
}

export class CanvasView {
  root: HTMLElement;
  private viewport: HTMLElement;
  private world: HTMLElement;
  private overlay: SVGSVGElement;
  private labelLayer: HTMLElement;
  private rulerH: HTMLCanvasElement;
  private rulerV: HTMLCanvasElement;
  private nodeMap = new Map<string, HTMLElement>();
  private abNodes = new Map<string, HTMLElement>();
  private drag: DragState | null = null;
  private hoverId: string | null = null;
  private spaceHeld = false;
  private snapLines: SnapLine[] = [];
  private lastPointer: Point = { x: 0, y: 0 };

  constructor() {
    this.rulerH = h("canvas", { class: "ruler ruler-h" });
    this.rulerV = h("canvas", { class: "ruler ruler-v" });
    this.world = h("div", { class: "world" });
    this.overlay = svgEl("svg", { class: "canvas-overlay" });
    this.labelLayer = h("div", { class: "ab-label-layer" });
    this.viewport = h("div", { class: "viewport", tabindex: "-1" }, this.world, this.labelLayer);
    this.viewport.append(this.overlay);
    this.root = h(
      "div",
      { class: "canvas-area" },
      h("div", { class: "ruler-corner" }),
      this.rulerH,
      this.rulerV,
      this.viewport
    );

    this.bindEvents();
    store.on("doc", () => { this.renderWorld(); this.renderOverlay(); this.renderRulers(); });
    store.on("transient", () => { this.refreshStyles(); this.renderOverlay(); });
    store.on("view", () => { this.applyViewTransform(); this.renderOverlay(); this.renderRulers(); this.renderLabels(); });
    store.on("selection", () => { this.renderOverlay(); this.renderLabels(); this.renderRulers(); });
    store.on("settings", () => { this.renderWorld(); this.renderOverlay(); this.renderRulers(); });
    store.on("tool", () => this.updateCursor());

    new ResizeObserver(() => { this.resizeCanvases(); }).observe(this.viewport);
  }

  mounted(): void {
    this.resizeCanvases();
    this.renderWorld();
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

  private applyViewTransform(): void {
    const { zoom, panX, panY } = store.view;
    this.world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  private renderWorld(): void {
    clearChildren(this.world);
    this.nodeMap.clear();
    this.abNodes.clear();
    for (const ab of store.doc.artboards) {
      const node = this.buildArtboardNode(ab);
      this.abNodes.set(ab.id, node);
      this.world.append(node);
    }
    this.applyViewTransform();
    this.renderLabels();
  }

  private buildArtboardNode(ab: Artboard): HTMLElement {
    const node = h("div", { class: "artboard", dataset: { id: ab.id } });
    node.style.left = `${ab.position.x}px`;
    node.style.top = `${ab.position.y}px`;
    node.style.width = `${ab.width}px`;
    node.style.height = `${ab.height}px`;
    node.style.background = ab.background.color;

    const bgUrl = getImage(ab.background.image);
    if (bgUrl) {
      const img = h("div", { class: "artboard-bg" });
      img.style.backgroundImage = `url(${bgUrl})`;
      img.style.opacity = String(ab.background.imageOpacity);
      node.append(img);
    }

    if (store.settings.showGrid) {
      const g = store.settings.gridSize;
      const grid = h("div", { class: "artboard-grid" });
      grid.style.backgroundSize = `${g}px ${g}px`;
      node.append(grid);
    }

    for (const el of ab.children) {
      const child = this.buildElementNode(el, ab.width, ab.height);
      if (child) node.append(child);
    }

    if (store.settings.showGuides) {
      for (let i = 0; i < ab.guides.v.length; i++) {
        const gl = h("div", { class: "guide guide-v" });
        gl.style.left = `${ab.guides.v[i]}px`;
        node.append(gl);
      }
      for (let i = 0; i < ab.guides.h.length; i++) {
        const gl = h("div", { class: "guide guide-h" });
        gl.style.top = `${ab.guides.h[i]}px`;
        node.append(gl);
      }
    }
    return node;
  }

  private buildElementNode(el: OPElement, pw: number, ph: number): HTMLElement | null {
    const node = h("div", { class: "op-el", dataset: { id: el.id } });
    this.applyElementStyle(node, el, pw, ph);
    const info = typeInfo(el.type);
    node.append(h("div", { class: "el-label" }, el.name || info.label));
    const r = localRectOf(el, pw, ph);
    for (const child of el.children) {
      const c = this.buildElementNode(child, r.w, r.h);
      if (c) node.append(c);
    }
    this.nodeMap.set(el.id, node);
    return node;
  }

  private applyElementStyle(node: HTMLElement, el: OPElement, pw: number, ph: number): void {
    const r = localRectOf(el, pw, ph);
    node.style.left = `${r.x}px`;
    node.style.top = `${r.y}px`;
    node.style.width = `${r.w}px`;
    node.style.height = `${r.h}px`;
    node.style.transform = el.rotation ? `rotate(${el.rotation}deg)` : "";
    node.style.opacity = String(el.opacity);
    node.style.display = el.visible ? "" : "none";
    node.style.borderColor = el.color;
    node.style.background = hexWithAlpha(el.color, 0.14);
    const label = node.querySelector(":scope > .el-label") as HTMLElement | null;
    if (label) {
      label.textContent = el.name || typeInfo(el.type).label;
      label.style.color = el.color;
    }
  }

  /** 드래그 프레임: DOM 구조 유지, 스타일만 갱신 */
  private refreshStyles(): void {
    for (const ab of store.doc.artboards) {
      const abNode = this.abNodes.get(ab.id);
      if (abNode) {
        abNode.style.left = `${ab.position.x}px`;
        abNode.style.top = `${ab.position.y}px`;
      }
      const walk = (els: OPElement[], pw: number, ph: number) => {
        for (const el of els) {
          const node = this.nodeMap.get(el.id);
          if (node) this.applyElementStyle(node, el, pw, ph);
          const r = localRectOf(el, pw, ph);
          walk(el.children, r.w, r.h);
        }
      };
      walk(ab.children, ab.width, ab.height);
    }
    this.renderLabels();
  }

  private renderLabels(): void {
    clearChildren(this.labelLayer);
    for (const ab of store.doc.artboards) {
      const s = this.worldToScreen({ x: ab.position.x, y: ab.position.y });
      const label = h(
        "div",
        {
          class: `ab-label${ab.id === store.activeArtboardId ? " active" : ""}`,
          dataset: { id: ab.id }
        },
        `${ab.name}`,
        h("span", { class: "ab-label-size" }, ` ${ab.width}×${ab.height}`)
      );
      label.style.left = `${s.x}px`;
      label.style.top = `${s.y - 22}px`;
      label.addEventListener("pointerdown", (e) => this.onArtboardLabelDown(e, ab.id));
      this.labelLayer.append(label);
    }
  }

  /* ================= 오버레이 ================= */

  private renderOverlay(): void {
    clearChildren(this.overlay);
    const frag = document.createDocumentFragment();

    // 호버 표시
    if (this.hoverId && !store.selection.includes(this.hoverId) && !this.drag) {
      const info = worldInfoOf(store.doc, this.hoverId);
      if (info) {
        frag.append(this.outlinePolygon(info, "op-hover-outline"));
      }
    }

    // 선택 표시
    const single = store.selection.length === 1;
    for (const id of store.selection) {
      const info = worldInfoOf(store.doc, id);
      if (!info) continue;
      frag.append(this.outlinePolygon(info, "op-sel-outline"));
      if (single && store.tool === "select") {
        this.appendHandles(frag, info);
        this.appendSizeBadge(frag, info);
      }
    }

    // 다중 선택 묶음 외곽
    if (store.selection.length > 1) {
      const aabb = this.selectionWorldAABB();
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

    this.overlay.append(frag);
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

  private selectionWorldAABB(): Rect | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of store.selection) {
      const info = worldInfoOf(store.doc, id);
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

  /* ================= 눈금자 ================= */

  private resizeCanvases(): void {
    const r = this.viewport.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.rulerH.width = Math.max(1, r.width * dpr);
    this.rulerH.height = RULER * dpr;
    this.rulerV.width = RULER * dpr;
    this.rulerV.height = Math.max(1, r.height * dpr);
    this.renderRulers();
    this.renderOverlay();
  }

  private renderRulers(): void {
    if (!store.settings.showRulers) {
      this.root.classList.add("no-rulers");
      return;
    }
    this.root.classList.remove("no-rulers");
    const ab = store.activeArtboard();
    const { zoom, panX, panY } = store.view;
    const dpr = window.devicePixelRatio || 1;
    drawRuler(this.rulerH, dpr, zoom, panX + ab.position.x * zoom, true);
    drawRuler(this.rulerV, dpr, zoom, panY + ab.position.y * zoom, false);
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

    this.rulerH.addEventListener("pointerdown", (e) => this.startGuideFromRuler(e, "h"));
    this.rulerV.addEventListener("pointerdown", (e) => this.startGuideFromRuler(e, "v"));

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

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = this.viewport.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0015);
      this.setZoom(store.view.zoom * factor, { x: e.clientX - r.left, y: e.clientY - r.top });
    } else if (e.shiftKey) {
      store.setView({ panX: store.view.panX - e.deltaY });
    } else {
      store.setView({ panX: store.view.panX - e.deltaX, panY: store.view.panY - e.deltaY });
    }
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.button !== 1) return;
    this.viewport.focus();
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
            this.viewport.setPointerCapture(e.pointerId);
            return;
          }
        }
      }
    }

    // 가이드 잡기
    const guideHit = this.hitGuide(world);
    if (guideHit && store.settings.showGuides) {
      this.drag = { ...guideHit, mode: "guide", isNew: false, mutated: false };
      this.viewport.setPointerCapture(e.pointerId);
      return;
    }

    // 요소 히트 테스트
    const hit = this.hitElement(world);
    if (hit) {
      store.setActiveArtboard(hit.artboardId);
      if (e.shiftKey) {
        store.toggleSelect(hit.id);
        return;
      }
      if (!store.selection.includes(hit.id)) {
        store.select([hit.id]);
      }
      this.beginMoveDrag(world, e.pointerId);
      return;
    }

    // 아트보드 배경 → 활성 전환 + 마퀴
    const ab = this.artboardAt(world);
    if (ab) store.setActiveArtboard(ab.id);
    this.drag = {
      mode: "marquee",
      startWorld: world,
      additive: e.shiftKey,
      base: e.shiftKey ? [...store.selection] : []
    };
    if (!e.shiftKey) store.clearSelection();
    this.viewport.setPointerCapture(e.pointerId);
  }

  private beginMoveDrag(world: Point, pointerId: number): void {
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
      mutated: false
    };
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
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !d.mutated) return;
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
        this.renderRulers();
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

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.snapLines = [];
    this.updateCursor();

    switch (d.mode) {
      case "pan":
        break;
      case "move":
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
          if (val < 0 || val > max) arr.splice(d.index, 1);
          store.commit();
        } else if (ab && d.isNew) {
          const arr = d.axis === "v" ? ab.guides.v : ab.guides.h;
          arr.splice(d.index, 1);
          store.cancelChange();
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
    for (let i = store.doc.artboards.length - 1; i >= 0; i--) {
      const ab = store.doc.artboards[i];
      const hit = this.hitIn(ab.children, world);
      if (hit) return { id: hit, artboardId: ab.id };
    }
    return null;
  }

  private hitIn(els: OPElement[], world: Point): string | null {
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      if (!el.visible || el.locked) {
        // 잠긴 요소는 통과하되 자식도 제외
        continue;
      }
      const deep = this.hitIn(el.children, world);
      if (deep) return deep;
      const info = worldInfoOf(store.doc, el.id);
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

  private applyMoveSnap(
    d: Extract<DragState, { mode: "move" }>, dx: number, dy: number, bypass: boolean
  ): { dx: number; dy: number } {
    this.snapLines = [];
    if (bypass) return { dx, dy };
    const { snapGrid, snapElements, snapGuides, gridSize } = store.settings;
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

    const targetXs: number[] = [];
    const targetYs: number[] = [];
    // 아트보드 경계·중앙
    targetXs.push(abr.x, abr.x + abr.w / 2, abr.x + abr.w);
    targetYs.push(abr.y, abr.y + abr.h / 2, abr.y + abr.h);
    // 가이드
    if (snapGuides && store.settings.showGuides) {
      for (const v of ab.guides.v) targetXs.push(abr.x + v);
      for (const gh of ab.guides.h) targetYs.push(abr.y + gh);
    }
    // 다른 요소
    if (snapElements) {
      const excluded = new Set(d.items.map((i) => i.id));
      for (const el of ab.children) {
        if (excluded.has(el.id) || !el.visible) continue;
        const info = worldInfoOf(store.doc, el.id);
        if (!info) continue;
        const bb = worldAABB(info);
        targetXs.push(bb.x, bb.x + bb.w / 2, bb.x + bb.w);
        targetYs.push(bb.y, bb.y + bb.h / 2, bb.y + bb.h);
      }
    }

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

    // 격자 스냅 (다른 스냅이 없을 때)
    if (snapGrid) {
      if (!bestDx) {
        const localX = d.initAABB.x + dx - abr.x;
        outDx = Math.round(localX / gridSize) * gridSize + abr.x - d.initAABB.x;
      }
      if (!bestDy) {
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
    const { snapGrid, snapElements, snapGuides, gridSize } = store.settings;
    const threshold = SNAP_SCREEN_PX / store.view.zoom;
    const ab = findArtboard(store.doc, d.artboardId);
    if (!ab) return rect;
    const abr = artboardWorldRect(ab);
    // 부모 → 월드 (축 정렬 가정)
    const off = { x: d.parentMat[4], y: d.parentMat[5] };
    const wRect = { x: rect.x + off.x, y: rect.y + off.y, w: rect.w, h: rect.h };

    const targetXs: number[] = [abr.x, abr.x + abr.w / 2, abr.x + abr.w];
    const targetYs: number[] = [abr.y, abr.y + abr.h / 2, abr.y + abr.h];
    if (snapGuides && store.settings.showGuides) {
      for (const v of ab.guides.v) targetXs.push(abr.x + v);
      for (const gh of ab.guides.h) targetYs.push(abr.y + gh);
    }
    if (snapElements) {
      for (const el of ab.children) {
        if (el.id === d.id || !el.visible) continue;
        const info = worldInfoOf(store.doc, el.id);
        if (!info) continue;
        const bb = worldAABB(info);
        targetXs.push(bb.x, bb.x + bb.w, bb.x + bb.w / 2);
        targetYs.push(bb.y, bb.y + bb.h, bb.y + bb.h / 2);
      }
    }
    if (snapGrid) {
      const edgeX = handle.includes("w") ? wRect.x : wRect.x + wRect.w;
      const edgeY = handle.includes("n") ? wRect.y : wRect.y + wRect.h;
      targetXs.push(Math.round((edgeX - abr.x) / gridSize) * gridSize + abr.x);
      targetYs.push(Math.round((edgeY - abr.y) / gridSize) * gridSize + abr.y);
    }

    if (handle.includes("e")) {
      const edge = wRect.x + wRect.w;
      const best = nearest(targetXs, edge, threshold);
      if (best !== null) {
        wRect.w = Math.max(1, best - wRect.x);
        this.snapLines.push({ axis: "v", world: best });
      }
    }
    if (handle.includes("w")) {
      const best = nearest(targetXs, wRect.x, threshold);
      if (best !== null) {
        wRect.w = Math.max(1, wRect.x + wRect.w - best);
        wRect.x = best;
        this.snapLines.push({ axis: "v", world: best });
      }
    }
    if (handle.includes("s")) {
      const edge = wRect.y + wRect.h;
      const best = nearest(targetYs, edge, threshold);
      if (best !== null) {
        wRect.h = Math.max(1, best - wRect.y);
        this.snapLines.push({ axis: "h", world: best });
      }
    }
    if (handle.includes("n")) {
      const best = nearest(targetYs, wRect.y, threshold);
      if (best !== null) {
        wRect.h = Math.max(1, wRect.y + wRect.h - best);
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
    for (const ab of store.doc.artboards) {
      for (const el of ab.children) {
        if (!el.visible || el.locked) continue;
        const info = worldInfoOf(store.doc, el.id);
        if (!info) continue;
        if (rectsIntersect(rect, worldAABB(info)) && !ids.includes(el.id)) {
          ids.push(el.id);
        }
      }
    }
    store.selection = ids;
    store.emit("selection");
  }

  /* ================= 가이드 생성 ================= */

  private startGuideFromRuler(e: PointerEvent, axis: "v" | "h"): void {
    if (!store.settings.showGuides) return;
    e.preventDefault();
    const ab = store.activeArtboard();
    store.beginChange();
    const world = this.screenToWorld(e.clientX, e.clientY);
    const value = axis === "v"
      ? Math.round(world.x - ab.position.x)
      : Math.round(world.y - ab.position.y);
    const arr = axis === "v" ? ab.guides.v : ab.guides.h;
    arr.push(value);
    store.emit("doc");
    this.drag = {
      mode: "guide",
      artboardId: ab.id,
      axis,
      index: arr.length - 1,
      isNew: true,
      mutated: true
    };
    this.viewport.setPointerCapture(e.pointerId);
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

function drawRuler(canvas: HTMLCanvasElement, dpr: number, zoom: number, originScreen: number, horizontal: boolean): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const length = horizontal ? canvas.width / dpr : canvas.height / dpr;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, horizontal ? length : RULER, horizontal ? RULER : length);
  ctx.fillStyle = "#1B1B20";
  ctx.fillRect(0, 0, horizontal ? length : RULER, horizontal ? RULER : length);
  ctx.strokeStyle = "#2E2E36";
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(0, RULER - 0.5);
    ctx.lineTo(length, RULER - 0.5);
  } else {
    ctx.moveTo(RULER - 0.5, 0);
    ctx.lineTo(RULER - 0.5, length);
  }
  ctx.stroke();

  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  let step = steps[steps.length - 1];
  for (const s of steps) {
    if (s * zoom >= 56) { step = s; break; }
  }
  const minor = step / 4;

  ctx.fillStyle = "#7A7A85";
  ctx.strokeStyle = "#41414B";
  ctx.font = "9px 'Segoe UI', sans-serif";
  ctx.textBaseline = "top";

  const start = Math.floor((0 - originScreen) / zoom / minor) * minor;
  const end = (length - originScreen) / zoom;
  ctx.beginPath();
  for (let v = start; v <= end; v += minor) {
    const s = originScreen + v * zoom;
    const isMajor = Math.abs(v % step) < 1e-9 || Math.abs((v % step) - step) < 1e-9;
    const tick = isMajor ? 10 : 5;
    if (horizontal) {
      ctx.moveTo(s + 0.5, RULER - tick);
      ctx.lineTo(s + 0.5, RULER);
    } else {
      ctx.moveTo(RULER - tick, s + 0.5);
      ctx.lineTo(RULER, s + 0.5);
    }
    if (isMajor) {
      const label = String(Math.round(v));
      if (horizontal) {
        ctx.fillText(label, s + 3, 3);
      } else {
        ctx.save();
        ctx.translate(3, s + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "right";
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex + a;
  return hex;
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
