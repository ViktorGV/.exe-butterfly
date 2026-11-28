import { describe, expect, test } from 'bun:test';
import { decodeRacerGeometry, encodeRacerGeometry } from './baked.ts';
import { RACERS, buildRacer } from './index.ts';
import { NEAR_STEP } from './play.ts';

describe('baked racers', () => {
  const geo = buildRacer(RACERS[0], NEAR_STEP).mesh.geometry;
  const back = decodeRacerGeometry(encodeRacerGeometry(geo));

  test('index survives exactly', () => {
    expect(Array.from(back.getIndex()!.array)).toEqual(Array.from(geo.getIndex()!.array));
  });

  test('attributes survive within quantisation error', () => {
    const tol: Record<string, number> = {
      position: 1e-4,
      normal: 1e-4,
      color: 0.003,
      aFinish: 0.005,
      aAO: 0.003,
      skinIndex: 0,
      skinWeight: 0.003,
    };
    for (const [name, eps] of Object.entries(tol)) {
      const a = geo.getAttribute(name).array as ArrayLike<number>;
      const b = back.getAttribute(name).array as ArrayLike<number>;
      expect(b.length).toBe(a.length);
      let worst = 0;
      for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
      expect(worst).toBeLessThanOrEqual(eps);
    }
  });

  test('a racer built from the baked mesh skips the sculpting', () => {
    const fresh = buildRacer(RACERS[0], NEAR_STEP);
    const fast = buildRacer(RACERS[0], NEAR_STEP, back);
    expect(fast.triangles).toBe(fresh.triangles);
    expect(fast.ms).toBeLessThan(fresh.ms / 3);
  });
});
