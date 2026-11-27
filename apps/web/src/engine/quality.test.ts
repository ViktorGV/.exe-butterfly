import { describe, expect, it } from 'bun:test';
import { QUALITY_PRESETS, isQualityPreset, pixelRatioFor } from './quality.ts';

describe('quality presets', () => {
  it('scale up from low to high', () => {
    const { low, medium, high } = QUALITY_PRESETS;
    expect(low.dprCap).toBeLessThan(medium.dprCap);
    expect(medium.dprCap).toBeLessThan(high.dprCap);
    expect(low.shadows).toBe(false);
    expect(high.shadowMapSize).toBeGreaterThan(medium.shadowMapSize);
    expect(low.far).toBeLessThan(high.far);
    expect(Object.isFrozen(QUALITY_PRESETS.high)).toBe(true);
  });

  it('clamps the device pixel ratio', () => {
    expect(pixelRatioFor('low', 3)).toBe(1);
    expect(pixelRatioFor('medium', 3)).toBe(1.5);
    expect(pixelRatioFor('high', 3)).toBe(2);
    expect(pixelRatioFor('high', 1)).toBe(1);
    expect(pixelRatioFor('high', NaN)).toBe(1);
  });

  it('recognises preset names', () => {
    expect(isQualityPreset('medium')).toBe(true);
    expect(isQualityPreset('ultra')).toBe(false);
  });
});
