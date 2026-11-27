// Test helper (not shipped to players): a recording Canvas 2D mock with a tiny software rasteriser.
// 'clip' mode drops paint outside the tile like a real canvas; 'torus' mode wraps it around.
// A tile is seamless when both modes produce the same pixels.
import type { PatternContext } from './pattern.ts';

type Pt = [number, number];
type M = [number, number, number, number, number, number];

export interface MockCanvas {
  ctx: PatternContext;
  calls: unknown[][];
  pixels: (string | null)[];
  at(x: number, y: number): string | null;
  /** fraction of pixels per colour */
  coverage(): Record<string, number>;
}

export function createMockCanvas(size: number, mode: 'clip' | 'torus' = 'clip'): MockCanvas {
  const pixels: (string | null)[] = new Array(size * size).fill(null);
  const calls: unknown[][] = [];
  let fill = '#000000';
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  let paths: Pt[][] = [];
  let current: Pt[] | null = null;

  const tx = (x: number, y: number): Pt => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const add = (p: Pt): void => {
    if (!current) {
      current = [];
      paths.push(current);
    }
    current.push(p);
  };

  function paint(polys: Pt[][]): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const poly of polys) {
      for (const [x, y] of poly) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
    if (mode === 'clip') {
      x0 = Math.max(x0, 0);
      y0 = Math.max(y0, 0);
      x1 = Math.min(x1, size);
      y1 = Math.min(y1, size);
    }
    for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
      for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
        const cx = px + 0.5;
        const cy = py + 0.5;
        let wind = 0;
        for (const poly of polys) {
          for (let i = 0; i < poly.length; i++) {
            const [ax, ay] = poly[i];
            const [bx, by] = poly[(i + 1) % poly.length];
            const cross = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
            if (ay <= cy && by > cy && cross > 0) wind++;
            else if (ay > cy && by <= cy && cross < 0) wind--;
          }
        }
        if (wind === 0) continue;
        const wx = ((px % size) + size) % size;
        const wy = ((py % size) + size) % size;
        pixels[wy * size + wx] = fill;
      }
    }
  }

  const ctx = {
    get fillStyle() {
      return fill;
    },
    set fillStyle(v: string) {
      calls.push(['fillStyle', v]);
      fill = v;
    },
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push(['fillRect', x, y, w, h]);
      paint([[tx(x, y), tx(x + w, y), tx(x + w, y + h), tx(x, y + h)]]);
    },
    beginPath() {
      calls.push(['beginPath']);
      paths = [];
      current = null;
    },
    moveTo(x: number, y: number) {
      calls.push(['moveTo', x, y]);
      current = null;
      add(tx(x, y));
    },
    lineTo(x: number, y: number) {
      calls.push(['lineTo', x, y]);
      add(tx(x, y));
    },
    closePath() {
      calls.push(['closePath']);
      current = null;
    },
    rect(x: number, y: number, w: number, h: number) {
      calls.push(['rect', x, y, w, h]);
      paths.push([tx(x, y), tx(x + w, y), tx(x + w, y + h), tx(x, y + h)]);
      current = null;
    },
    arc(x: number, y: number, r: number, a0: number, a1: number) {
      calls.push(['arc', x, y, r, a0, a1]);
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const a = a0 + ((a1 - a0) * i) / steps;
        add(tx(x + Math.cos(a) * r, y + Math.sin(a) * r));
      }
    },
    fill() {
      calls.push(['fill']);
      paint(paths.filter((p) => p.length >= 3));
    },
    save() {
      calls.push(['save']);
      stack.push([...m]);
    },
    restore() {
      calls.push(['restore']);
      m = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    },
    translate(x: number, y: number) {
      calls.push(['translate', x, y]);
      m = [m[0], m[1], m[2], m[3], m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    },
    rotate(a: number) {
      calls.push(['rotate', a]);
      const c = Math.cos(a);
      const s = Math.sin(a);
      m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, m[2] * c - m[0] * s, m[3] * c - m[1] * s, m[4], m[5]];
    },
  };

  return {
    ctx: ctx as unknown as PatternContext,
    calls,
    pixels,
    at: (x, y) => pixels[y * size + x],
    coverage() {
      const out: Record<string, number> = {};
      for (const p of pixels) if (p) out[p] = (out[p] ?? 0) + 1 / pixels.length;
      return out;
    },
  };
}
