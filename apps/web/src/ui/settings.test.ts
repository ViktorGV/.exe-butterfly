import { describe, expect, it } from 'bun:test';
import { LIMITS } from '@wobble/shared/constants';
import {
  DEFAULT_SETTINGS,
  isValidRoomCode,
  loadName,
  loadSettings,
  normalizeSettings,
  sanitizeName,
  sanitizeRoomCode,
  saveName,
  saveSettings,
  type KeyValueStore,
} from './settings.ts';

function memStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const throwingStore: KeyValueStore = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
};

describe('settings', () => {
  it('holds volumes only, and drops old quality and sensitivity values', () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(['master', 'music', 'sfx']);
    expect(normalizeSettings(undefined)).toEqual({ ...DEFAULT_SETTINGS });
    expect(normalizeSettings({ quality: 'low', sensitivity: 2 })).toEqual({ ...DEFAULT_SETTINGS });
  });

  it('clamps and validates field by field', () => {
    expect(normalizeSettings({ master: 2, music: -1, sfx: 'x' })).toEqual({
      master: 1,
      music: 0,
      sfx: DEFAULT_SETTINGS.sfx,
    });
  });

  it('round-trips through storage and survives broken or blocked storage', () => {
    const store = memStore();
    const s = { ...DEFAULT_SETTINGS, master: 0.3 };
    saveSettings(store, s);
    expect(loadSettings(store)).toEqual(s);
    store.data.set('wr.settings', '{not json');
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS });
    expect(loadSettings(throwingStore)).toEqual({ ...DEFAULT_SETTINGS });
    expect(() => saveSettings(throwingStore, s)).not.toThrow();
    expect(loadSettings(null)).toEqual({ ...DEFAULT_SETTINGS });
  });
});

describe('sanitizeName', () => {
  it(`trims, collapses spaces and cuts to ${LIMITS.nameMax} characters`, () => {
    expect(sanitizeName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    expect(sanitizeName('x'.repeat(40))).toBe('x'.repeat(LIMITS.nameMax));
    expect(sanitizeName('abcdefghijklmno pqr')).toBe('abcdefghijklmno'); // trailing space after the cut is trimmed
  });

  it('drops control and bidi characters and counts emoji as one character', () => {
    expect(sanitizeName('Bo\u0000b\u202e\u200b')).toBe('Bob');
    expect(sanitizeName('🐸'.repeat(20))).toBe('🐸'.repeat(LIMITS.nameMax));
  });

  it('falls back when nothing is left', () => {
    expect(sanitizeName('   ')).toBe('Wobbler');
    expect(sanitizeName('', '')).toBe('');
  });

  it('remembers the name', () => {
    const store = memStore();
    saveName(store, 'Pip');
    expect(loadName(store)).toBe('Pip');
    expect(loadName(throwingStore)).toBe('');
  });
});

describe('room codes', () => {
  it('uppercases, strips non-letters and keeps 5 letters', () => {
    expect(sanitizeRoomCode('ab-c d1e9fg')).toBe('ABCDE');
    expect(sanitizeRoomCode('xy')).toBe('XY');
  });

  it('validates exactly 5 capital letters', () => {
    expect(isValidRoomCode('ABCDE')).toBe(true);
    expect(isValidRoomCode('ABCD')).toBe(false);
    expect(isValidRoomCode('abcde')).toBe(false);
    expect(isValidRoomCode('ABCD1')).toBe(false);
  });
});
