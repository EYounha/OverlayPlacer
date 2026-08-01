/**
 * Material Symbols(Outlined 400) SVG에서 필요한 아이콘만 골라
 * src/ui/icons.ts를 생성한다.
 *
 * 폰트를 링크하지 않고 path만 내장하는 이유:
 *  - 데스크톱 빌드의 CSP가 외부 요청을 막는다
 *  - 쓰지 않는 7000여 개 아이콘을 번들에 넣지 않는다
 *
 * 사용법: node scripts/gen-icons.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "node_modules/@material-symbols/svg-400/outlined");

/** 코드에서 쓰는 이름 -> Material Symbols 파일명 */
const ICONS = {
  hand: "pan_tool",
  cursor: "arrow_selector_tool",
  rect: "rectangle",
  measure: "straighten",
  undo: "undo",
  redo: "redo",
  grid: "grid_4x4",
  snap: "join_inner",
  add: "add",
  close: "close",
  visible: "visibility",
  hidden: "visibility_off",
  locked: "lock",
  unlocked: "lock_open",
  chevronDown: "keyboard_arrow_down",
  chevronRight: "chevron_right",
  artboard: "dashboard",
  zoomIn: "zoom_in",
  zoomOut: "zoom_out",
  fitScreen: "fit_screen",
  frame: "center_focus_strong",
  alignLeft: "align_horizontal_left",
  alignCenterH: "align_horizontal_center",
  alignRight: "align_horizontal_right",
  alignTop: "align_vertical_top",
  alignCenterV: "align_vertical_center",
  alignBottom: "align_vertical_bottom",
  distributeH: "horizontal_distribute",
  distributeV: "vertical_distribute",
  bringFront: "flip_to_front",
  sendBack: "flip_to_back",
  delete: "delete",
  // 요소 타입 아이콘
  typePanel: "widgets",
  typeText: "text_fields",
  typeImage: "image",
  typeButton: "input",
  typeInput: "input",
  typeIcon: "emoji_symbols",
  typeList: "list",
  typeVideo: "movie",
  typeProgress: "donut_large",
  typeCustom: "more_horiz"
};

/** SVG 파일에서 path의 d 속성만 뽑는다 (viewBox는 전부 0 -960 960 960) */
function extractPath(name) {
  const svg = readFileSync(join(srcDir, `${name}.svg`), "utf8");
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (viewBox !== "0 -960 960 960") {
    throw new Error(`${name}: 예상과 다른 viewBox (${viewBox})`);
  }
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (paths.length === 0) throw new Error(`${name}: path를 찾지 못함`);
  return paths.join(" ");
}

const entries = Object.entries(ICONS).map(([key, file]) => {
  return `  ${key}: ${JSON.stringify(extractPath(file))}`;
});

const out = `/**
 * Material Symbols (Outlined, weight 400) 아이콘 경로.
 *
 * scripts/gen-icons.mjs가 생성한다 — 직접 고치지 말 것.
 * 모든 경로는 viewBox "0 -960 960 960" 기준이다.
 * Apache License 2.0 (Google Material Design Icons)
 */

export const ICON_VIEWBOX = "0 -960 960 960";

export const ICONS = {
${entries.join(",\n")}
} as const;

export type IconName = keyof typeof ICONS;
`;

writeFileSync(join(root, "src/ui/icons.ts"), out);
console.log(`src/ui/icons.ts 생성 — 아이콘 ${entries.length}개`);
