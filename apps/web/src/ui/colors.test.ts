import { describe, expect, it } from 'bun:test';
import { accentVars, hudFontStack, HUD_FONTS, INK_DARK, INK_LIGHT, inkOn, parseHex, shade, toHex } from './colors.ts';

describe('accent colours', () => {
  it('parses #rgb and #rrggbb and rejects junk', () => {
    expect(parseHex('#ff6bd5')).toEqual({ r: 255, g: 107, b: 213 });
    expect(parseHex('0af')).toEqual({ r: 0, g: 170, b: 255 });
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
    expect(parseHex('url(x)')).toBeNull();
  });

  it('shades toward black or white and round-trips through hex', () => {
    const c = parseHex('#808080')!;
    expect(toHex(shade(c, -1))).toBe('#000000');
    expect(toHex(shade(c, 1))).toBe('#ffffff');
    expect(toHex(shade(c, 0))).toBe('#808080');
  });

  it('picks readable ink', () => {
    expect(inkOn(parseHex('#ffd23f')!)).toBe(INK_DARK);
    expect(inkOn(parseHex('#1a237e')!)).toBe(INK_LIGHT);
  });

  it('builds the CSS variables setAccent applies, or null for invalid input', () => {
    const v = accentVars('#3EE6A8')!;
    expect(v['--accent']).toBe('#3ee6a8');
    expect(v['--accent-dark']).toMatch(/^#[0-9a-f]{6}$/);
    expect(v['--accent-light']).toMatch(/^#[0-9a-f]{6}$/);
    expect(v['--accent-ink']).toBe(INK_DARK);
    expect(accentVars('javascript:alert(1)')).toBeNull();
  });
});

describe('HUD fonts', () => {
  it('supports the five bundled styles and nothing else', () => {
    expect(Object.keys(HUD_FONTS).sort()).toEqual(['blocky', 'handwritten', 'pixel', 'rounded', 'serif']);
    expect(hudFontStack('pixel')).toContain('monospace');
    expect(hudFontStack('comic')).toBeNull();
    expect(hudFontStack('toString')).toBeNull();
  });
});
