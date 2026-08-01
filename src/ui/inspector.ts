import { store } from "../state/store";
import type { Anchor, OPElement, Unit } from "../types";
import { ANCHORS, ELEMENT_TYPES } from "../types";
import { findArtboard, findElement } from "../model/doc";
import { localRectOf, worldInfoOf, writeLocalRect } from "../model/geometry";
import {
  align, clearBackgroundImage, distribute, loadBackgroundImage, spaceEvenly,
  type AlignTo
} from "../actions";
import { hasImage } from "../state/imageStore";
import { h, clearChildren, icon } from "./dom";
import type { IconName } from "./icons";

export class InspectorPanel {
  root: HTMLElement;
  private body: HTMLElement;
  private pendingRender = false;
  /** 정렬 기준·간격은 선택이 바뀌어도 유지한다 (연속 작업을 끊지 않도록) */
  private alignTo: AlignTo = "selection";
  private gap = 16;

  constructor() {
    this.body = h("div", { class: "inspector-body" });
    this.root = h(
      "div",
      { class: "panel panel-right" },
      h("div", { class: "panel-header tab-strip" }, h("div", { class: "tab active" }, "인스펙터")),
      this.body
    );
    store.on("doc", () => this.safeRender());
    store.on("selection", () => this.render());
    store.on("transient", () => this.updateLiveFields());
    this.root.addEventListener("focusout", () => {
      if (this.pendingRender) {
        setTimeout(() => {
          if (!this.root.contains(document.activeElement)) {
            this.pendingRender = false;
            this.render();
          }
        }, 0);
      }
    });
    this.render();
  }

  private safeRender(): void {
    const active = document.activeElement;
    if (active && this.root.contains(active) &&
      (active.tagName === "INPUT" || active.tagName === "SELECT")) {
      this.pendingRender = true;
      return;
    }
    this.render();
  }

  private render(): void {
    clearChildren(this.body);
    const sel = store.selectedElements();
    if (sel.length === 0) {
      this.renderArtboard();
    } else if (sel.length === 1) {
      this.renderElement(sel[0]);
    } else {
      this.renderMulti(sel.length);
    }
  }

  /* ---------- 다중 선택 ---------- */

  private renderMulti(count: number): void {
    this.body.append(
      h("div", { class: "insp-section-title" }, `${count}개 요소 선택됨`),
      h(
        "div",
        { class: "insp-section" },
        this.alignModePicker(),
        this.alignGrid(() => this.alignTo),
        this.gapRow()
      )
    );
  }

  /** 정렬 기준 선택 — 유니티·피그마의 "무엇에 맞출지" 선택과 같다 */
  private alignModePicker(): HTMLElement {
    const modes: { to: AlignTo; label: string; title: string }[] = [
      { to: "selection", label: "선택 영역", title: "선택 묶음의 바깥 경계에 맞춘다" },
      { to: "parent", label: "부모", title: "부모 또는 아트보드 영역에 맞춘다" },
      { to: "key", label: "기준 개체", title: "마지막으로 고른 요소에 맞춘다" }
    ];
    const row = h("div", { class: "segmented" });
    for (const m of modes) {
      const btn = h("button", {
        class: `seg-btn${this.alignTo === m.to ? " active" : ""}`,
        title: m.title,
        onclick: () => {
          this.alignTo = m.to;
          for (const other of row.children) other.classList.remove("active");
          btn.classList.add("active");
        }
      }, m.label);
      row.append(btn);
    }
    return row;
  }

  private alignGrid(to: () => AlignTo): HTMLElement {
    const btn = (name: IconName, title: string, action: () => void) =>
      h("button", { class: "align-btn", title, onclick: action }, icon(name, 16));
    return h(
      "div",
      { class: "align-grid" },
      btn("alignLeft", "왼쪽 정렬", () => align("left", to())),
      btn("alignCenterH", "가로 가운데 정렬", () => align("center-h", to())),
      btn("alignRight", "오른쪽 정렬", () => align("right", to())),
      btn("distributeH", "가로 등간격 분배", () => distribute("h")),
      btn("alignTop", "위쪽 정렬", () => align("top", to())),
      btn("alignCenterV", "세로 가운데 정렬", () => align("center-v", to())),
      btn("alignBottom", "아래쪽 정렬", () => align("bottom", to())),
      btn("distributeV", "세로 등간격 분배", () => distribute("v"))
    );
  }

  /** 간격을 숫자로 지정해 늘어놓기 */
  private gapRow(): HTMLElement {
    const input = h("input", {
      class: "field-input num", type: "number", step: "1", value: String(this.gap)
    }) as HTMLInputElement;
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) this.gap = v;
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      e.stopPropagation();
    });
    return h(
      "div",
      { class: "field" },
      h("label", { class: "field-label" }, "간격"),
      h(
        "div",
        { class: "field-row" },
        input,
        h("button", {
          class: "align-btn", title: "가로로 이 간격만큼 띄우기",
          onclick: () => spaceEvenly("h", this.gap)
        }, icon("distributeH", 16)),
        h("button", {
          class: "align-btn", title: "세로로 이 간격만큼 띄우기",
          onclick: () => spaceEvenly("v", this.gap)
        }, icon("distributeV", 16))
      )
    );
  }

  /* ---------- 단일 요소 ---------- */

  private renderElement(el: OPElement): void {
    const found = findElement(store.doc, el.id);
    if (!found) return;

    // 이름 · 타입
    this.body.append(
      h(
        "div",
        { class: "insp-section" },
        this.textField("이름", el.name, (v) => this.mutate(el.id, (e) => { e.name = v; })),
        this.selectField(
          "타입",
          ELEMENT_TYPES.map((t) => ({ value: t.type, label: t.label })),
          el.type,
          (v) => this.mutate(el.id, (e) => {
            e.type = v as OPElement["type"];
          })
        )
      )
    );

    // 위치 · 크기
    const dims = h(
      "div",
      { class: "insp-section" },
      h("div", { class: "insp-section-title" }, "위치 · 크기"),
      h(
        "div",
        { class: "dim-grid" },
        this.dimField(el.id, "x", "X"),
        this.dimField(el.id, "y", "Y"),
        this.dimField(el.id, "width", "W"),
        this.dimField(el.id, "height", "H")
      ),
      this.numField("회전", el.rotation, 1, (v) => this.mutate(el.id, (e) => {
        e.rotation = ((v % 360) + 360) % 360 > 180 ? ((v % 360) + 360) % 360 - 360 : ((v % 360) + 360) % 360;
      }), "°")
    );
    this.body.append(dims);

    // 앵커
    this.body.append(
      h(
        "div",
        { class: "insp-section" },
        h("div", { class: "insp-section-title" }, "앵커"),
        this.anchorPicker(el)
      )
    );

    // 표시
    this.body.append(
      h(
        "div",
        { class: "insp-section" },
        h("div", { class: "insp-section-title" }, "표시"),
        this.colorField("색상", el.color, (v) => this.mutate(el.id, (e) => { e.color = v; })),
        this.sliderField("불투명도", el.opacity, 0, 1, 0.01, (v) =>
          this.mutate(el.id, (e) => { e.opacity = v; })
        )
      )
    );

    // 정렬 (단일 선택은 부모 영역 기준)
    this.body.append(
      h("div", { class: "insp-section" },
        h("div", { class: "insp-section-title" }, "정렬 · 부모 기준"),
        this.alignGrid(() => "parent")
      )
    );

    // 메타데이터
    this.body.append(this.metaEditor(el));
  }

  private dimField(id: string, key: "x" | "y" | "width" | "height", label: string): HTMLElement {
    const found = findElement(store.doc, id);
    if (!found) return h("div");
    const el = found.el;
    const unit = el.units[key];
    const input = h("input", {
      class: "field-input num dim-input",
      type: "number",
      step: "1",
      value: String(el[key]),
      dataset: { dim: key, elId: id }
    }) as HTMLInputElement;
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) return;
      this.mutate(id, (e) => {
        e[key] = key === "width" || key === "height" ? Math.max(unit === "%" ? 0.01 : 1, v) : v;
      });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      e.stopPropagation();
    });
    const unitBtn = h("button", {
      class: "unit-btn",
      title: "단위 전환",
      onclick: () => this.toggleUnit(id, key)
    }, unit);
    return h(
      "div",
      { class: "dim-cell" },
      h("span", { class: "dim-label" }, label),
      input,
      unitBtn
    );
  }

  private toggleUnit(id: string, key: "x" | "y" | "width" | "height"): void {
    store.beginChange();
    const found = findElement(store.doc, id);
    if (!found) { store.cancelChange(); return; }
    const el = found.el;
    const info = worldInfoOf(store.doc, id);
    if (!info) { store.cancelChange(); return; }
    const rect = localRectOf(el, info.parentW, info.parentH);
    el.units[key] = (el.units[key] === "px" ? "%" : "px") as Unit;
    writeLocalRect(el, info.parentW, info.parentH, rect);
    store.commit();
  }

  private anchorPicker(el: OPElement): HTMLElement {
    const grid = h("div", { class: "anchor-grid" });
    for (const a of ANCHORS) {
      const btn = h("button", {
        class: `anchor-cell${el.anchor === a ? " active" : ""}`,
        title: a,
        onclick: () => {
          store.beginChange();
          const found = findElement(store.doc, el.id);
          const info = worldInfoOf(store.doc, el.id);
          if (!found || !info) { store.cancelChange(); return; }
          const rect = localRectOf(found.el, info.parentW, info.parentH);
          found.el.anchor = a as Anchor;
          writeLocalRect(found.el, info.parentW, info.parentH, rect);
          store.commit();
        }
      });
      grid.append(btn);
    }
    return grid;
  }

  private metaEditor(el: OPElement): HTMLElement {
    const section = h("div", { class: "insp-section" },
      h("div", { class: "insp-section-title" }, "메타데이터")
    );
    const table = h("div", { class: "meta-table" });
    for (const [key, value] of Object.entries(el.meta)) {
      table.append(this.metaRow(el.id, key, value));
    }
    section.append(
      table,
      h("button", {
        class: "btn btn-small",
        onclick: () => {
          this.mutate(el.id, (e) => {
            let n = 1;
            while (Object.hasOwn(e.meta, `key${n}`)) n++;
            e.meta[`key${n}`] = "";
          });
        }
      }, "+ 항목 추가")
    );
    return section;
  }

  private metaRow(elId: string, key: string, value: string): HTMLElement {
    const keyInput = h("input", { class: "field-input meta-key", value: key, spellcheck: "false" }) as HTMLInputElement;
    const valInput = h("input", { class: "field-input meta-val", value: value, spellcheck: "false" }) as HTMLInputElement;
    keyInput.addEventListener("change", () => {
      const newKey = keyInput.value.trim();
      if (!newKey || newKey === key) { keyInput.value = key; return; }
      if (newKey === "__proto__" || newKey === "constructor" || newKey === "prototype") {
        keyInput.value = key;
        return;
      }
      this.mutate(elId, (e) => {
        if (Object.hasOwn(e.meta, newKey)) return;
        const val = e.meta[key];
        delete e.meta[key];
        e.meta[newKey] = val;
      });
    });
    valInput.addEventListener("change", () => {
      this.mutate(elId, (e) => { e.meta[key] = valInput.value; });
    });
    for (const inp of [keyInput, valInput]) {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") inp.blur();
        e.stopPropagation();
      });
    }
    return h(
      "div",
      { class: "meta-row" },
      keyInput,
      valInput,
      h("button", {
        class: "row-action",
        title: "삭제",
        onclick: () => this.mutate(elId, (e) => { delete e.meta[key]; })
      }, icon("close", 13))
    );
  }

  /* ---------- 아트보드 ---------- */

  private renderArtboard(): void {
    const ab = store.activeArtboard();
    this.body.append(
      h("div", { class: "insp-section-title" }, "아트보드"),
      h(
        "div",
        { class: "insp-section" },
        this.textField("이름", ab.name, (v) => this.mutateArtboard(ab.id, (a) => { a.name = v; })),
        h(
          "div",
          { class: "dim-grid" },
          this.abDim(ab.id, "width", "W"),
          this.abDim(ab.id, "height", "H")
        )
      ),
      h(
        "div",
        { class: "insp-section" },
        h("div", { class: "insp-section-title" }, "배경"),
        this.colorField("색상", ab.background.color, (v) =>
          this.mutateArtboard(ab.id, (a) => { a.background.color = v; })
        ),
        h(
          "div",
          { class: "field-row" },
          h("button", { class: "btn btn-small", onclick: () => loadBackgroundImage(ab) }, "참조 이미지 불러오기"),
          hasImage(ab.background.image)
            ? h("button", { class: "btn btn-small", onclick: () => clearBackgroundImage(ab) }, "제거")
            : null
        ),
        hasImage(ab.background.image)
          ? this.sliderField("이미지 불투명도", ab.background.imageOpacity, 0, 1, 0.01, (v) =>
              this.mutateArtboard(ab.id, (a) => { a.background.imageOpacity = v; })
            )
          : null
      ),
      h(
        "div",
        { class: "insp-section" },
        h("div", { class: "insp-section-title" }, "프로젝트"),
        this.textField("이름", store.doc.meta.name, (v) => {
          store.beginChange();
          store.doc.meta.name = v;
          store.commit();
        }),
        this.textField("설명", store.doc.meta.description, (v) => {
          store.beginChange();
          store.doc.meta.description = v;
          store.commit();
        })
      )
    );
  }

  private abDim(id: string, key: "width" | "height", label: string): HTMLElement {
    const ab = findArtboard(store.doc, id);
    if (!ab) return h("div");
    const input = h("input", {
      class: "field-input num dim-input",
      type: "number",
      min: "1",
      value: String(ab[key])
    }) as HTMLInputElement;
    input.addEventListener("change", () => {
      const v = Math.max(1, Number(input.value) || ab[key]);
      this.mutateArtboard(id, (a) => { a[key] = v; });
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      e.stopPropagation();
    });
    return h("div", { class: "dim-cell" }, h("span", { class: "dim-label" }, label), input);
  }

  /* ---------- 공용 필드 ---------- */

  private textField(label: string, value: string, apply: (v: string) => void): HTMLElement {
    const input = h("input", { class: "field-input", value, spellcheck: "false" }) as HTMLInputElement;
    input.addEventListener("change", () => apply(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      e.stopPropagation();
    });
    return h("div", { class: "field" }, h("label", { class: "field-label" }, label), input);
  }

  private numField(
    label: string, value: number, step: number, apply: (v: number) => void, suffix = ""
  ): HTMLElement {
    const input = h("input", {
      class: "field-input num", type: "number", step: String(step), value: String(value)
    }) as HTMLInputElement;
    input.addEventListener("change", () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) apply(v);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      e.stopPropagation();
    });
    return h(
      "div",
      { class: "field" },
      h("label", { class: "field-label" }, label),
      h("div", { class: "field-row" }, input, suffix ? h("span", { class: "field-suffix" }, suffix) : null)
    );
  }

  private selectField(
    label: string, options: { value: string; label: string }[], value: string, apply: (v: string) => void
  ): HTMLElement {
    const select = h("select", { class: "field-input" }) as HTMLSelectElement;
    for (const opt of options) {
      select.append(h("option", { value: opt.value, selected: opt.value === value ? true : undefined }, opt.label));
    }
    select.value = value;
    select.addEventListener("change", () => apply(select.value));
    return h("div", { class: "field" }, h("label", { class: "field-label" }, label), select);
  }

  private colorField(label: string, value: string, apply: (v: string) => void): HTMLElement {
    const input = h("input", { class: "color-input", type: "color", value: toHex6(value) }) as HTMLInputElement;
    input.addEventListener("change", () => apply(input.value.toUpperCase()));
    return h(
      "div",
      { class: "field" },
      h("label", { class: "field-label" }, label),
      h("div", { class: "field-row" }, input, h("span", { class: "color-hex" }, toHex6(value).toUpperCase()))
    );
  }

  private sliderField(
    label: string, value: number, min: number, max: number, step: number, apply: (v: number) => void
  ): HTMLElement {
    const input = h("input", {
      class: "slider", type: "range",
      min: String(min), max: String(max), step: String(step), value: String(value)
    }) as HTMLInputElement;
    const readout = h("span", { class: "slider-readout" }, `${Math.round(value * 100)}%`);
    input.addEventListener("input", () => {
      readout.textContent = `${Math.round(Number(input.value) * 100)}%`;
    });
    input.addEventListener("change", () => apply(Number(input.value)));
    return h(
      "div",
      { class: "field" },
      h("label", { class: "field-label" }, label),
      h("div", { class: "field-row" }, input, readout)
    );
  }

  /* ---------- 변경 헬퍼 ---------- */

  private mutate(id: string, fn: (el: OPElement) => void): void {
    store.beginChange();
    const found = findElement(store.doc, id);
    if (!found) { store.cancelChange(); return; }
    fn(found.el);
    store.commit();
  }

  private mutateArtboard(id: string, fn: (ab: NonNullable<ReturnType<typeof findArtboard>>) => void): void {
    store.beginChange();
    const ab = findArtboard(store.doc, id);
    if (!ab) { store.cancelChange(); return; }
    fn(ab);
    store.commit();
  }

  /** 드래그 중 X/Y/W/H 실시간 반영 */
  private updateLiveFields(): void {
    const inputs = this.body.querySelectorAll<HTMLInputElement>(".dim-input[data-dim]");
    inputs.forEach((input) => {
      if (document.activeElement === input) return;
      const id = input.dataset.elId;
      const key = input.dataset.dim as "x" | "y" | "width" | "height";
      if (!id) return;
      const found = findElement(store.doc, id);
      if (found) input.value = String(found.el[key]);
    });
  }
}

function toHex6(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  if (/^#[0-9a-fA-F]{8}$/.test(color)) return color.slice(0, 7);
  return "#5B6478";
}
