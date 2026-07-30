import "./styles.css";
import { h } from "./ui/dom";
import { CanvasView } from "./ui/canvasView";
import { MenuBar } from "./ui/menubar";
import { Toolbar } from "./ui/toolbar";
import { LayersPanel } from "./ui/layers";
import { InspectorPanel } from "./ui/inspector";
import { StatusBar } from "./ui/statusbar";
import { initShortcuts } from "./shortcuts";
import { store } from "./state/store";
import { hydrateImages } from "./state/imageStore";

const app = document.getElementById("app")!;

const canvas = new CanvasView();
const menubar = new MenuBar(canvas);
const toolbar = new Toolbar();
const layers = new LayersPanel();
const inspector = new InspectorPanel();
const statusbar = new StatusBar(canvas);

app.append(
  menubar.root,
  toolbar.root,
  h("div", { class: "main-row" }, layers.root, canvas.root, inspector.root),
  statusbar.root
);

initShortcuts(canvas);
requestAnimationFrame(() => canvas.mounted());

// 배경 참조 이미지는 문서 밖 IndexedDB에 있으므로 복원 후 다시 그린다.
void hydrateImages().then((count) => {
  store.pruneStaleImages();
  if (count > 0) store.emit("doc");
});
