// Volume persistence (localStorage, guarded).
export interface Volumes {
  master: number;
  sfx: number;
  music: number;
}

export const DEFAULT_VOLUMES: Volumes = { master: 0.8, sfx: 1, music: 0.5 };
const KEY = 'wobble.audio.volumes';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const clamp01 = (v: unknown, d: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d;

export function normalizeVolumes(v: Partial<Volumes> | null | undefined, base: Volumes = DEFAULT_VOLUMES): Volumes {
  return {
    master: clamp01(v?.master, base.master),
    sfx: clamp01(v?.sfx, base.sfx),
    music: clamp01(v?.music, base.music),
  };
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadVolumes(s: StorageLike | null = defaultStorage()): Volumes {
  try {
    const raw = s?.getItem(KEY);
    return normalizeVolumes(raw ? (JSON.parse(raw) as Partial<Volumes>) : null);
  } catch {
    return { ...DEFAULT_VOLUMES };
  }
}

export function saveVolumes(v: Volumes, s: StorageLike | null = defaultStorage()): void {
  try {
    s?.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage blocked */
  }
}
