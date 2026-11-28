import { describe, expect, it } from 'bun:test';
import { DEFAULT_THEME_ID } from '@wobble/shared/assets/index';
import { eventPackUrl, loadThemeChoice, saveThemeChoice, THEME_CHOICES, THEME_SLOTS } from './themes.ts';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('theme choices', () => {
  it('defaults to Classic and remembers a known choice', () => {
    const store = memory();
    expect(loadThemeChoice(store)).toBe(DEFAULT_THEME_ID);
    saveThemeChoice(store, 'e:theme-fallen-galaxy');
    expect(loadThemeChoice(store)).toBe('e:theme-fallen-galaxy');
  });

  it('ignores an unknown or removed theme', () => {
    const store = memory();
    saveThemeChoice(store, 'e:theme-gone');
    expect(loadThemeChoice(store)).toBe(DEFAULT_THEME_ID);
    expect(loadThemeChoice(null)).toBe(DEFAULT_THEME_ID);
  });

  it('lists Classic first and fits the slots', () => {
    expect(THEME_CHOICES[0].id).toBe(DEFAULT_THEME_ID);
    expect(THEME_CHOICES.length).toBeLessThanOrEqual(THEME_SLOTS);
    expect(eventPackUrl('e:theme-fallen-galaxy')).toBe('/event/packs/theme/fallen-galaxy.json');
    expect(eventPackUrl(DEFAULT_THEME_ID)).toBeNull();
  });
});
