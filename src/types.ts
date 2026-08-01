/** OverlayPlacer 문서 모델 타입 정의 */

export type Unit = "px" | "%";

export type Anchor =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "middle-center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export const ANCHORS: Anchor[] = [
  "top-left", "top-center", "top-right",
  "middle-left", "middle-center", "middle-right",
  "bottom-left", "bottom-center", "bottom-right"
];

/** 앵커 → (가로 비율, 세로 비율) */
export function anchorFractions(a: Anchor): { ax: number; ay: number } {
  const [v, h] = a.split("-");
  const ay = v === "top" ? 0 : v === "middle" ? 0.5 : 1;
  const ax = h === "left" ? 0 : h === "center" ? 0.5 : 1;
  return { ax, ay };
}

export type ElementType =
  | "panel" | "text" | "image" | "button" | "input"
  | "icon" | "list" | "video" | "progress" | "custom";

export interface ElementTypeInfo {
  type: ElementType;
  label: string;
  color: string;
}

export const ELEMENT_TYPES: ElementTypeInfo[] = [
  { type: "panel",    label: "패널",     color: "#5B6478" },
  { type: "text",     label: "텍스트",   color: "#4F8EF7" },
  { type: "image",    label: "이미지",   color: "#9C6ADE" },
  { type: "button",   label: "버튼",     color: "#2FB980" },
  { type: "input",    label: "입력 필드", color: "#E8A33D" },
  { type: "icon",     label: "아이콘",   color: "#38B8C4" },
  { type: "list",     label: "리스트",   color: "#7A8AF0" },
  { type: "video",    label: "비디오",   color: "#E06AA8" },
  { type: "progress", label: "프로그레스", color: "#C9D34B" },
  { type: "custom",   label: "사용자 정의", color: "#8E8E99" }
];

export function typeInfo(t: ElementType): ElementTypeInfo {
  return ELEMENT_TYPES.find((e) => e.type === t) ?? ELEMENT_TYPES[ELEMENT_TYPES.length - 1];
}

export interface UnitSpec {
  x: Unit;
  y: Unit;
  width: Unit;
  height: Unit;
}

export interface OPElement {
  id: string;
  name: string;
  type: ElementType;
  /** 앵커 기준 오프셋. units에 따라 px 또는 % (부모 크기 대비) */
  x: number;
  y: number;
  width: number;
  height: number;
  units: UnitSpec;
  anchor: Anchor;
  /** 도(deg), 시계 방향, 요소 중심 기준 */
  rotation: number;
  opacity: number;
  color: string;
  visible: boolean;
  locked: boolean;
  /** AI 전달용 자유 메타데이터 */
  meta: Record<string, string>;
  children: OPElement[];
}

export interface ArtboardBackground {
  color: string;
  /**
   * imageStore의 이미지 키. 실제 dataURL은 문서 밖에 보관한다 —
   * 히스토리 스냅샷과 자동저장이 수 MB 데이터를 복제하지 않도록.
   * 프로젝트 파일로 저장할 때만 dataURL로 펼쳐진다. AI 내보내기 시 제외.
   */
  image: string | null;
  imageOpacity: number;
}

/**
 * 두 요소(또는 요소와 아트보드 가장자리) 사이의 간격을 표시하는 치수선.
 * 숫자를 고치면 그 순간 대상이 이동한다 — 지속적인 구속은 없다.
 */
export interface Measure {
  id: string;
  /** 기준이 되는 요소 */
  fromId: string;
  /** 대상 요소. null이면 아트보드 가장자리를 기준으로 잰다 */
  toId: string | null;
  /** toId가 null일 때 어느 가장자리까지 잴지 (min = 왼쪽·위, max = 오른쪽·아래) */
  edge: "min" | "max";
  axis: "h" | "v";
  /** 편집 시 어느 쪽을 움직일지 (가장자리 기준일 때는 항상 from) */
  moves: "to" | "from";
  /**
   * 잴 때 쓸 각 요소의 변 (min = 왼쪽·위, max = 오른쪽·아래).
   * 없으면 마주 보는 변을 자동으로 골라 사이 간격을 잰다.
   * 지정하면 왼쪽끼리·오른쪽끼리 같은 변을 잴 수도 있다.
   */
  fromSide?: "min" | "max";
  toSide?: "min" | "max";
}

export interface Artboard {
  id: string;
  name: string;
  width: number;
  height: number;
  background: ArtboardBackground;
  /** 편집기 전용: 무한 캔버스 상 위치 (AI 내보내기 시 제외) */
  position: { x: number; y: number };
  guides: { v: number[]; h: number[] };
  /** 치수선 (AI 내보내기 시 제외 — 편집 보조용) */
  measures: Measure[];
  children: OPElement[];
}

export interface ProjectMeta {
  name: string;
  description: string;
}

export interface ProjectDoc {
  format: "overlayplacer";
  version: 1;
  meta: ProjectMeta;
  artboards: Artboard[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Tool = "select" | "hand" | "draw" | "measure";
