import { describe, expect, it } from 'bun:test';
import { QUALITY, pixelRatioFor } from './quality.ts';

describe('quality', () => {
  it('is one frozen setting with shadows on', () => {
    expect(Object.isFrozen(QUALITY)).toBe(true);
    expect(QUALITY.shadows).toBe(true);
    expect(QUALITY.shadowMapSize).toBe(1024);
  });

  it('clamps the device pixel ratio', () => {
    expect(pixelRatioFor(3)).toBe(QUALITY.dprCap);
    expect(pixelRatioFor(1)).toBe(1);
    expect(pixelRatioFor(Number.NaN)).toBe(1);
    expect(pixelRatioFor(-2)).toBe(1);
  });
});
