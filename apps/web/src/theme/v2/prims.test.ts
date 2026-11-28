import { describe, expect, it } from 'bun:test';
import type { Prim } from '@wobble/shared/types';
import { primsGeometry, primsMaterial } from './prims.ts';

const prim = (emissive?: string): Prim => ({
  shape: 'box',
  pos: [0, 0, 0],
  rot: [0, 0, 0],
  scale: [1, 1, 1],
  color: '#336699',
  ...(emissive ? { emissive } : {}),
});

describe('prims glow (#64)', () => {
  it('writes the emissive colour into a glow attribute and leaves the base colour alone', () => {
    const g = primsGeometry([prim('#ff0000'), prim()]);
    const glow = g.getAttribute('glow');
    const color = g.getAttribute('color');
    expect(glow.count).toBe(color.count);
    expect(glow.getX(0)).toBeCloseTo(1);
    expect(glow.getX(glow.count - 1)).toBe(0);
    expect(color.getX(0)).toBeCloseTo(color.getX(color.count - 1));
  });

  it('exposes a pulse uniform on the material', () => {
    const m = primsMaterial();
    expect(m.userData.glow.value).toBe(1);
    m.userData.glow.value = 0.5;
    expect(m.userData.glow.value).toBe(0.5);
  });
});
