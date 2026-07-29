import "./styles.css";
import { h } from "./ui/dom";
import { CanvasView } from "./ui/canvasView";
import { MenuBar } from "./ui/menubar";
import { Toolbar } from "./ui/toolbar";
import { LayersPanel } from "./ui/layers";
import { InspectorPanel } from "./ui/inspector";
import { StatusBar } from "./ui/statusbar";
import { initShortcuts } from "./shortcuts";

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
