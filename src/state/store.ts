import type { OPElement, ProjectDoc, Tool, ElementType } from "../types";
import { cloneDoc, createProject, findArtboard, findElement, parseProject, serializeProject } from "../model/doc";

export type StoreEvent = "doc" | "selection" | "view" | "tool" | "settings" | "transient";

export interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface EditorSettings {
  showGrid: boolean;
  showRulers: boolean;
  showGuides: boolean;
  snapGrid: boolean;
  snapElements: boolean;
  snapGuides: boolean;
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
    showRulers: true,
    showGuides: true,
    snapGrid: false,
    snapElements: true,
    snapGuides: true,
    gridSize: 8
  };
  dirty = false;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Map<StoreEvent, Set<Listener>>();
  private autosaveTimer: number | null = null;

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
    this.redoStack = [];
  }

  /** 변경 완료 — 갱신 통지 + 자동 저장 */
  commit(): void {
    this.dirty = true;
    this.emit("doc", "selection");
    this.scheduleAutosave();
  }

  /** beginChange 없이 시작한 변경 취소용 보조: 최근 스냅샷 폐기 */
  cancelChange(): void {
    const entry = this.undoStack.pop();
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
    const set = new Set(this.selection);
    return this.selection.filter((id) => {
      const found = findElement(this.doc, id);
      let p = found?.parent;
      while (p) {
        if (set.has(p.id)) return false;
        p = findElement(this.doc, p.id)?.parent ?? null;
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
      try {
        localStorage.setItem(AUTOSAVE_KEY, serializeProject(this.doc));
      } catch { /* 용량 초과 등 무시 */ }
    }, 400);
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
}

export const store = new Store();

export function docClone(): ProjectDoc {
  return cloneDoc(store.doc);
}
