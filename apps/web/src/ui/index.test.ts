import { describe, expect, it } from 'bun:test';
import { BASE_SCREENS, isOverlay, OVERLAY_SCREENS } from './types.ts';

describe('ui module', () => {
  it('can be imported without a DOM (nothing runs at import time)', async () => {
    expect(typeof document).toBe('undefined');
    const mod = await import('./index.ts');
    expect(typeof mod.createUI).toBe('function');
    expect(mod.DEFAULT_SETTINGS.master).toBeGreaterThan(0);
  });

  it('splits screens into base screens and overlays', () => {
    expect(isOverlay('pause')).toBe(true);
    expect(isOverlay('countdown')).toBe(true);
    expect(isOverlay('hud')).toBe(false);
    expect(isOverlay('lobby')).toBe(false);
    const all = [...BASE_SCREENS, ...OVERLAY_SCREENS];
    expect(new Set(all).size).toBe(all.length);
  });
});
