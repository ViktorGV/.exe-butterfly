// Debug overlay (toggle with the backquote key). Text is refreshed a few times per second,
// not every frame, so it costs nothing measurable while visible.

export type StatGetter = () => string | number;

export interface DebugOverlay {
  readonly element: HTMLElement;
  readonly visible: boolean;
  setVisible(visible: boolean): void;
  toggle(): void;
  /** Add a named line. Returns a function that removes it. */
  addStat(name: string, getter: StatGetter): () => void;
  /** Rewrite the text if visible. Built-in lines are passed in; custom stats are read here. */
  render(lines: readonly (readonly [string, string | number])[]): void;
  dispose(): void;
}

const fmt = (v: string | number) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v);

export function createDebugOverlay(parent: HTMLElement): DebugOverlay {
  const el = document.createElement('pre');
  el.className = 'wobble-debug-overlay';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed',
    top: 'calc(8px + env(safe-area-inset-top, 0px))',
    left: 'calc(8px + env(safe-area-inset-left, 0px))',
    margin: '0',
    padding: '8px 10px',
    font: '12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    color: '#e8fff4',
    background: 'rgba(20, 16, 40, 0.78)',
    borderRadius: '8px',
    pointerEvents: 'none',
    zIndex: '1000',
    whiteSpace: 'pre',
    fontVariantNumeric: 'tabular-nums',
  } satisfies Partial<CSSStyleDeclaration>);
  el.hidden = true;
  parent.appendChild(el);

  const custom = new Map<string, StatGetter>();

  const overlay: DebugOverlay = {
    element: el,
    get visible() {
      return !el.hidden;
    },
    setVisible(visible) {
      el.hidden = !visible;
    },
    toggle() {
      el.hidden = !el.hidden;
    },
    addStat(name, getter) {
      custom.set(name, getter);
      return () => {
        if (custom.get(name) === getter) custom.delete(name);
      };
    },
    render(lines) {
      if (el.hidden) return;
      let text = '';
      for (const [k, v] of lines) text += `${k.padEnd(12)} ${fmt(v)}\n`;
      for (const [k, get] of custom) {
        let v: string | number;
        try {
          v = get();
        } catch {
          v = 'error';
        }
        text += `${k.padEnd(12)} ${fmt(v)}\n`;
      }
      el.textContent = text.trimEnd();
    },
    dispose() {
      custom.clear();
      el.remove();
    },
  };
  return overlay;
}
