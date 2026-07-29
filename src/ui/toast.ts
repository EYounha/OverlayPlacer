import { h } from "./dom";

let container: HTMLElement | null = null;

export function toast(message: string): void {
  if (!container) {
    container = h("div", { class: "toast-container" });
    document.body.append(container);
  }
  const item = h("div", { class: "toast" }, message);
  container.append(item);
  requestAnimationFrame(() => item.classList.add("show"));
  setTimeout(() => {
    item.classList.remove("show");
    setTimeout(() => item.remove(), 300);
  }, 2400);
}
