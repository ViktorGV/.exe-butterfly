// Minimal DOM helpers. Only called from factories that receive a root element, never at import time.

type AttrValue = string | number | boolean | null | undefined;
export type Child = Node | string | null | undefined | false;

/** Creates an element. `class` sets className; `false`/`null`/`undefined` attributes are skipped. */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs?: Readonly<Record<string, AttrValue>> | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (attrs) {
    for (const key in attrs) {
      const v = attrs[key];
      if (v === false || v == null) continue;
      if (key === 'class') el.className = String(v);
      else el.setAttribute(key, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: readonly Child[]): void {
  for (const c of children) {
    if (c === false || c == null) continue;
    el.appendChild(typeof c === 'string' ? el.ownerDocument!.createTextNode(c) : c);
  }
}

/** A button that runs `fn` on click (keyboard Enter/Space included, as native buttons do). */
export function button(doc: Document, label: string, cls: string, fn: () => void): HTMLButtonElement {
  const b = h(doc, 'button', { type: 'button', class: `wr-btn ${cls}` }, label);
  b.addEventListener('click', fn);
  return b;
}

export function setVisible(el: HTMLElement, visible: boolean): void {
  el.hidden = !visible;
}
