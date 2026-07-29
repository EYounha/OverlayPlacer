import { h } from "./dom";

export interface MenuItem {
  label?: string;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
  checked?: boolean;
  action?: () => void;
  children?: MenuItem[];
}

let openRoot: HTMLElement | null = null;

export function closeMenus(): void {
  openRoot?.remove();
  openRoot = null;
}

export function showMenu(items: MenuItem[], x: number, y: number): void {
  closeMenus();
  const root = h("div", { class: "menu-layer" });
  openRoot = root;
  root.addEventListener("pointerdown", (e) => {
    if (e.target === root) closeMenus();
  });
  root.addEventListener("contextmenu", (e) => e.preventDefault());
  document.body.append(root);
  buildMenu(root, items, x, y);
}

function buildMenu(layer: HTMLElement, items: MenuItem[], x: number, y: number): HTMLElement {
  const menu = h("div", { class: "menu-popup" });
  for (const item of items) {
    if (item.separator) {
      menu.append(h("div", { class: "menu-sep" }));
      continue;
    }
    const row = h(
      "div",
      { class: `menu-item${item.disabled ? " disabled" : ""}` },
      h("span", { class: "menu-check" }, item.checked ? "✓" : ""),
      h("span", { class: "menu-label" }, item.label ?? ""),
      item.children
        ? h("span", { class: "menu-arrow" }, "▸")
        : h("span", { class: "menu-shortcut" }, item.shortcut ?? "")
    );
    if (!item.disabled) {
      if (item.children) {
        let sub: HTMLElement | null = null;
        row.addEventListener("pointerenter", () => {
          menu.querySelectorAll(".menu-popup").forEach((m) => m.remove());
          const r = row.getBoundingClientRect();
          sub = buildMenu(layer, item.children!, r.right - 2, r.top - 4);
          row.append(sub);
        });
      } else {
        row.addEventListener("pointerenter", () => {
          menu.querySelectorAll(".menu-popup").forEach((m) => m.remove());
        });
        row.addEventListener("click", () => {
          closeMenus();
          item.action?.();
        });
      }
    }
    menu.append(row);
  }
  layer.append(menu);
  // 화면 밖 보정
  const rect = menu.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - rect.width - 8);
  const py = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(4, px)}px`;
  menu.style.top = `${Math.max(4, py)}px`;
  return menu;
}
