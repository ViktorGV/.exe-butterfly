import { describe, expect, it } from 'bun:test';
import type { Pattern } from '../types.ts';
import { BUILTIN_SKIN_PACKS, BUILTIN_THEME_PACKS } from './builtin/index.ts';
import { drawPattern, PATTERN_MAX_PX } from './pattern.ts';
import { createMockCanvas } from './test-canvas.ts';

const SIZE = 64;

const PATTERNS: Record<Pattern['type'], Pattern> = {
  none: { type: 'none', colors: ['#ff0000'], scale: 1 },
  stripes: { type: 'stripes', colors: ['#ff0000', '#ffffff'], scale: 1 },
  dots: { type: 'dots', colors: ['#ff0000', '#ffffff', '#0000ff'], scale: 1 },
  checker: { type: 'checker', colors: ['#ff0000', '#ffffff'], scale: 1 },
  zigzag: { type: 'zigzag', colors: ['#ff0000', '#ffffff', '#00ff00'], scale: 1 },
  waves: { type: 'waves', colors: ['#ff0000', '#ffffff'], scale: 1 },
  custom: {
    type: 'custom',
    colors: ['#ff0000'],
    scale: 1,
    tile: [
      { kind: 'circle', fill: '#ffffff', x: 0.02, y: 0.5, r: 0.2 },
      { kind: 'rect', fill: '#00ff00', x: 0.5, y: 0.98, w: 0.4, h: 0.2, rot: 0.6 },
      {
        kind: 'poly',
        fill: '#0000ff',
        x: 0.99,
        y: 0.01,
        points: [
          [0, -0.2],
          [0.2, 0.15],
          [-0.2, 0.15],
        ],
      },
    ],
  },
};

function render(pattern: Pattern, mode: 'clip' | 'torus', size = SIZE) {
  const canvas = createMockCanvas(size, mode);
  drawPattern(canvas.ctx, pattern, size);
  return canvas;
}

function expectSeamless(pattern: Pattern, size = SIZE): void {
  const clip = render(pattern, 'clip', size);
  const torus = render(pattern, 'torus', size);
  const diff = clip.pixels.filter((p, i) => p !== torus.pixels[i]).length;
  expect(diff).toBe(0);
}

describe('drawPattern', () => {
  for (const [type, pattern] of Object.entries(PATTERNS)) {
    it(`${type}: draws the expected calls and colours (snapshot)`, () => {
      const canvas = render(pattern, 'clip');
      expect(canvas.calls[0]).toEqual(['fillStyle', pattern.colors[0]]);
      expect(canvas.calls[1]).toEqual(['fillRect', 0, 0, SIZE, SIZE]);
      const ops: Record<string, number> = {};
      for (const [op] of canvas.calls) ops[op as string] = (ops[op as string] ?? 0) + 1;
      const coverage = Object.fromEntries(
        Object.entries(canvas.coverage()).map(([k, v]) => [k, Math.round(v * 100) / 100]),
      );
      expect({ ops, coverage }).toMatchSnapshot();
      expect(canvas.pixels.every((p) => p !== null)).toBe(true);
    });

    it(`${type}: tiles seamlessly`, () => {
      expectSeamless(pattern);
      expectSeamless({ ...pattern, scale: 0.5 });
      expectSeamless({ ...pattern, scale: 3 }, 48);
    });
  }

  it('uses every motif colour', () => {
    for (const type of ['stripes', 'checker', 'zigzag', 'waves', 'dots'] as const) {
      const cov = render(PATTERNS[type], 'clip').coverage();
      for (const c of PATTERNS[type].colors) expect(cov[c] ?? 0).toBeGreaterThan(0.05);
    }
    expect(render(PATTERNS.none, 'clip').coverage()).toEqual({ '#ff0000': 1 });
    expect(render(PATTERNS.checker, 'clip').coverage()['#ffffff']).toBeCloseTo(0.5, 5);
  });

  it('the seam check catches a shape that is not wrapped', () => {
    const clip = createMockCanvas(SIZE, 'clip');
    const torus = createMockCanvas(SIZE, 'torus');
    for (const c of [clip, torus]) {
      c.ctx.fillStyle = '#ffffff';
      c.ctx.beginPath();
      c.ctx.arc(0, SIZE / 2, 10, 0, Math.PI * 2);
      c.ctx.fill();
    }
    expect(clip.pixels.filter((p, i) => p !== torus.pixels[i]).length).toBeGreaterThan(0);
  });

  it('every built-in pattern tiles seamlessly', () => {
    const patterns: Pattern[] = [];
    for (const pack of BUILTIN_SKIN_PACKS) if (pack.kind === 'skin') patterns.push(pack.data.body.pattern);
    for (const pack of BUILTIN_THEME_PACKS) {
      if (pack.kind === 'theme')
        for (const m of Object.values(pack.data.materials)) if (m.pattern) patterns.push(m.pattern);
    }
    expect(patterns.length).toBeGreaterThan(15);
    for (const p of patterns) expectSeamless(p, 48);
  });

  it('clamps the tile to 256 px and survives hostile input', () => {
    const canvas = createMockCanvas(8, 'clip');
    drawPattern(canvas.ctx, PATTERNS.stripes, 4096);
    expect(canvas.calls[1]).toEqual(['fillRect', 0, 0, PATTERN_MAX_PX, PATTERN_MAX_PX]);
    for (const bad of [null, 42, { type: 'custom', colors: ['nope'], scale: NaN, tile: [{}] }, { type: 'evil' }]) {
      const c = createMockCanvas(8, 'clip');
      expect(() => drawPattern(c.ctx, bad as unknown as Pattern, 8)).not.toThrow();
      expect(() => drawPattern(c.ctx, PATTERNS.dots, NaN)).not.toThrow();
    }
  });

  it('a context with only fillStyle/fillRect gets the flat base colour', () => {
    const calls: unknown[][] = [];
    const ctx = {
      set fillStyle(v: string) {
        calls.push(['fillStyle', v]);
      },
      fillRect: (...a: number[]) => calls.push(['fillRect', ...a]),
    };
    drawPattern(ctx as unknown as Parameters<typeof drawPattern>[0], PATTERNS.waves, 32);
    expect(calls).toEqual([
      ['fillStyle', '#ff0000'],
      ['fillRect', 0, 0, 32, 32],
    ]);
  });
});
