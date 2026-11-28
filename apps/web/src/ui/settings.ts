// Settings model (volumes only: quality, effects and camera feel are the same for everyone), name and room-code sanitising, and remembered values. Pure (storage is passed in).
import { LIMITS } from '@wobble/shared/constants';
import { STRINGS } from './strings.ts';

export interface UISettings {
  /** Volumes 0..1. */
  master: number;
  music: number;
  sfx: number;
}

export const DEFAULT_SETTINGS: Readonly<UISettings> = Object.freeze({
  master: 0.8,
  music: 0.6,
  sfx: 0.8,
});

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Turns anything (e.g. parsed JSON) into valid settings, falling back to defaults field by field. */
export function normalizeSettings(raw: unknown): UISettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    master: clampNum(r.master, 0, 1, d.master),
    music: clampNum(r.music, 0, 1, d.music),
    sfx: clampNum(r.sfx, 0, 1, d.sfx),
  };
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g;

/** Trim, drop control/bidi characters, collapse spaces and cut to LIMITS.nameMax code points. */
export function sanitizeName(raw: string, fallback: string = STRINGS.defaultName): string {
  const cleaned = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  const cut = Array.from(cleaned).slice(0, LIMITS.nameMax).join('').trim();
  return cut || fallback;
}

export const ROOM_CODE_LENGTH = 5;

/** Uppercase letters only, at most 5. */
export function sanitizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z]{5}$/.test(code);
}

export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const SETTINGS_KEY = 'wr.settings';
const NAME_KEY = 'wr.name';

/** Storage can be missing or throw (private mode, blocked cookies); every access is guarded. */
export function loadSettings(store: KeyValueStore | null | undefined): UISettings {
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSettings(store: KeyValueStore | null | undefined, s: UISettings): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // not remembered; harmless
  }
}

export function loadName(store: KeyValueStore | null | undefined): string {
  try {
    const raw = store?.getItem(NAME_KEY);
    return raw ? sanitizeName(raw, '') : '';
  } catch {
    return '';
  }
}

export function saveName(store: KeyValueStore | null | undefined, name: string): void {
  try {
    store?.setItem(NAME_KEY, name);
  } catch {
    // not remembered; harmless
  }
}
