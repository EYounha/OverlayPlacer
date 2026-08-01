import type { OPElement, ProjectDoc, Tool, ElementType } from "../types";
import {
  buildElementIndex, collectImageKeys, createProject, findArtboard,
  findElement, parseProject, serializeAutosave
} from "../model/doc";
import { imagePersistFailed, pruneImages } from "./imageStore";

export type StoreEvent =
  | "doc" | "selection" | "view" | "tool" | "settings" | "transient" | "persist";

/** 자동저장 상태 — 상태바에 표시된다 */
export type PersistState =
  | { kind: "idle" }
  | { kind: "saved" }
  | { kind: "failed"; reason: string };

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface EditorSettings {
  showGrid: boolean;
  showGuides: boolean;
  showMeasures: boolean;
  showLabels: boolean;
  snapGrid: boolean;
  snapElements: boolean;
  snapGuides: boolean;
  /** 이웃과 같은 간격·중앙 간격에 맞물리는 스냅 */
  snapGaps: boolean;
  gridSize: number;
}

const AUTOSAVE_KEY = "overlayplacer.autosave.v1";
const SETTINGS_KEY = "overlayplacer.settings.v1";
const HISTORY_LIMIT = 200;

interface HistoryEntry {
  json: string;
  selection: string[];
  activeArtboardId: string;
}

type Listener = () => void;

export class Store {
  doc: ProjectDoc;
  selection: string[] = [];
  activeArtboardId: string;
  view: ViewState = { zoom: 1, panX: 0, panY: 0 };
  tool: Tool = "select";
  drawType: ElementType = "panel";
  settings: EditorSettings = {
    showGrid: false,
    showGuides: true,
    showMeasures: true,
    showLabels: true,
    snapGrid: false,
    snapElements: true,
    snapGuides: true,
    snapGaps: true,
    gridSize: 8
  };
  dirty = false;
  persistState: PersistState = { kind: "idle" };

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Map<StoreEvent, Set<Listener>>();
  private autosaveTimer: number | null = null;
  /** cancelChange가 되돌릴 수 있도록 beginChange가 비운 redo 스택을 보관 */
  private redoBeforeChange: HistoryEntry[] = [];
  /** beginChange와 commit/cancelChange의 짝을 검사하기 위한 표식 */
  private changeOpen = false;

  constructor() {
    this.doc = this.restoreAutosave() ?? createProject();
    this.activeArtboardId = this.doc.artboards[0].id;
    this.restoreSettings();
  }

  /* ---------- 이벤트 ---------- */

  on(ev: StoreEvent, fn: Listener): void {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(fn);
  }

  emit(...evs: StoreEvent[]): void {
    for (const ev of evs) {
      this.listeners.get(ev)?.forEach((fn) => fn());
    }
  }

  /* ---------- 히스토리 ---------- */

  private snapshot(): HistoryEntry {
    return {
      json: JSON.stringify(this.doc),
      selection: [...this.selection],
      activeArtboardId: this.activeArtboardId
    };
  }

  /** 문서 변경 직전에 호출 — 현재 상태를 undo 스택에 적재 */
  beginChange(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoBeforeChange = this.redoStack;
    this.redoStack = [];
    this.changeOpen = true;
  }

  /** 변경 완료 — 갱신 통지 + 자동 저장 */
  commit(): void {
    this.changeOpen = false;
    this.dirty = true;
    this.emit("doc", "selection");
    this.scheduleAutosave();
  }

  /**
   * 시작한 변경을 되돌린다. beginChange가 비운 redo 스택까지 복구하므로
   * 취소된 작업 때문에 다시 실행 이력이 사라지지 않는다.
   * beginChange 없이 불리면 무관한 undo 항목을 되돌리게 되므로 무시한다.
   */
  cancelChange(): void {
    if (!this.changeOpen) return;
    this.changeOpen = false;
    const entry = this.undoStack.pop();
    this.redoStack = this.redoBeforeChange;
    this.redoBeforeChange = [];
    if (entry) {
      this.doc = JSON.parse(entry.json);
      this.selection = entry.selection;
      this.activeArtboardId = entry.activeArtboardId;
      this.emit("doc", "selection");
    }
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  undo(): void {
    const entry = this.undoStack.pop();
    if (!entry) return;
    this.redoStack.push(this.snapshot());
    this.applyEntry(entry);
  }

  redo(): void {
    const entry = this.redoStack.pop();
    if (!entry) return;
    this.undoStack.push(this.snapshot());
    this.applyEntry(entry);
  }

  private applyEntry(entry: HistoryEntry): void {
    this.doc = JSON.parse(entry.json);
    this.selection = entry.selection.filter((id) => findElement(this.doc, id));
    this.activeArtboardId = findArtboard(this.doc, entry.activeArtboardId)
      ? entry.activeArtboardId
      : this.doc.artboards[0].id;
    this.dirty = true;
    this.emit("doc", "selection");
    this.scheduleAutosave();
  }

  /* ---------- 선택 ---------- */

  select(ids: string[]): void {
    this.selection = ids.filter((id) => findElement(this.doc, id));
    if (this.selection.length > 0) {
      const ab = findElement(this.doc, this.selection[0])?.artboard;
      if (ab) this.activeArtboardId = ab.id;
    }
    this.emit("selection");
  }

  toggleSelect(id: string): void {
    if (this.selection.includes(id)) {
      this.selection = this.selection.filter((s) => s !== id);
    } else {
      this.selection = [...this.selection, id];
    }
    this.emit("selection");
  }

  clearSelection(): void {
    if (this.selection.length === 0) return;
    this.selection = [];
    this.emit("selection");
  }

  selectedElements(): OPElement[] {
    return this.selection
      .map((id) => findElement(this.doc, id)?.el)
      .filter((el): el is OPElement => !!el);
  }

  /** 선택 중 조상이 이미 선택된 요소를 제외한 최상위 집합 */
  topLevelSelection(): string[] {
    return this.filteredSelection(() => true);
  }

  /**
   * 실제로 변경할 수 있는 선택 집합. 잠긴 요소를 제외한다.
   * 이동·삭제·정렬·순서 변경 등 요소를 바꾸는 동작은 모두 이것을 써야 한다.
   */
  editableSelection(): string[] {
    return this.filteredSelection((el) => !el.locked);
  }

  private filteredSelection(keep: (el: OPElement) => boolean): string[] {
    if (this.selection.length === 0) return [];
    const set = new Set(this.selection);
    // 색인을 한 번만 만든다. 요소마다 트리를 걷으면 선택이 커질수록
    // 제곱으로 느려진다.
    const index = buildElementIndex(this.doc);
    return this.selection.filter((id) => {
      const entry = index.get(id);
      if (!entry || !keep(entry.el)) return false;
      let p = entry.parentId;
      while (p) {
        if (set.has(p)) return false;
        p = index.get(p)?.parentId ?? null;
      }
      return true;
    });
  }

  activeArtboard() {
    return findArtboard(this.doc, this.activeArtboardId) ?? this.doc.artboards[0];
  }

  setActiveArtboard(id: string): void {
    if (this.activeArtboardId === id) return;
    if (!findArtboard(this.doc, id)) return;
    this.activeArtboardId = id;
    this.emit("selection");
  }

  /* ---------- 도구 · 뷰 ---------- */

  setTool(tool: Tool): void {
    if (this.tool === tool) return;
    this.tool = tool;
    this.emit("tool");
  }

  setView(view: Partial<ViewState>): void {
    Object.assign(this.view, view);
    this.emit("view");
  }

  updateSettings(patch: Partial<EditorSettings>): void {
    Object.assign(this.settings, patch);
    this.emit("settings");
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch { /* 저장 불가 환경 무시 */ }
  }

  /* ---------- 문서 교체 ---------- */

  replaceDoc(doc: ProjectDoc): void {
    this.beginChange();
    this.doc = doc;
    this.selection = [];
    this.activeArtboardId = doc.artboards[0].id;
    this.commit();
  }

  newProject(): void {
    this.replaceDoc(createProject());
    this.dirty = false;
  }

  /* ---------- 자동 저장 ---------- */

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = null;
      this.writeAutosave();
    }, 400);
  }

  /** 대기 중인 자동저장을 즉시 기록한다 (창을 닫기 직전 등) */
  flushAutosave(): void {
    if (this.autosaveTimer === null) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
    this.writeAutosave();
  }

  private writeAutosave(): void {
    // 여기서 미참조 이미지를 정리하면 되돌리기로 복구할 이미지가 사라진다.
    // 히스토리가 비어 있는 시작 시점(pruneStaleImages)에만 정리한다.
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeAutosave(this.doc));
      if (imagePersistFailed()) {
        this.setPersistState({ kind: "failed", reason: "이미지 저장 실패" });
      } else {
        this.setPersistState({ kind: "saved" });
      }
    } catch (e) {
      const quota = e instanceof DOMException &&
        (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
      this.setPersistState({
        kind: "failed",
        reason: quota ? "저장 공간 부족" : "자동 저장 실패"
      });
    }
  }

  private setPersistState(state: PersistState): void {
    const changed = this.persistState.kind !== state.kind ||
      (state.kind === "failed" && this.persistState.kind === "failed" &&
        this.persistState.reason !== state.reason);
    this.persistState = state;
    if (changed) this.emit("persist");
  }

  private restoreAutosave(): ProjectDoc | null {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      if (!text) return null;
      return parseProject(text);
    } catch {
      return null;
    }
  }

  private restoreSettings(): void {
    try {
      const text = localStorage.getItem(SETTINGS_KEY);
      if (!text) return;
      const parsed = JSON.parse(text) as Partial<EditorSettings>;
      Object.assign(this.settings, parsed);
    } catch { /* 무시 */ }
  }

  /** 편집 중 임시 갱신 (드래그 프레임) — 히스토리 없이 통지만 */
  notifyTransient(): void {
    this.emit("transient");
  }

  /**
   * 지난 세션에서 남은 미참조 이미지를 정리한다.
   * 히스토리가 비어 있는 시작 직후에만 안전하다.
   */
  pruneStaleImages(): void {
    if (this.undoStack.length > 0 || this.redoStack.length > 0) return;
    pruneImages(collectImageKeys(this.doc));
  }
}

export const store = new Store();

