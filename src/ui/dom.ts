import { ICONS, ICON_VIEWBOX, type IconName } from "./icons";

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") {
      el.className = String(value);
    } else if (key === "style" && typeof value === "object") {
      Object.assign(el.style, value);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "dataset" && typeof value === "object") {
      Object.assign(el.dataset, value);
    } else if (key === "value" && (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) {
      el.value = String(value);
    } else if (key === "checked" && el instanceof HTMLInputElement) {
      el.checked = Boolean(value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return el;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}

export function clearChildren(el: HTMLElement | SVGElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Material Symbols 아이콘 (currentColor로 칠해진다) */
export function icon(name: IconName, size = 18): SVGSVGElement {
  const svg = svgEl("svg", {
    viewBox: ICON_VIEWBOX,
    width: size,
    height: size,
    fill: "currentColor",
    class: "icon",
    "aria-hidden": "true"
  });
  svg.append(svgEl("path", { d: ICONS[name] }));
  return svg;
}
