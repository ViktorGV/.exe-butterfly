// Match preload (#27): the room's theme and every player's skin through the asset store, before `loaded` is sent.
import type { MatchConfig, Pack } from '@wobble/shared/types';
import type { AssetStore } from '../assets/index.ts';

export interface MatchPacks {
  /** The room's theme (the default theme when it could not be loaded). */
  theme: Pack | null;
  /** Skin pack per player id; missing skins fall back to the default skin. */
  skins: Map<number, Pack>;
  fallbacks: number;
  timedOut: boolean;
}

/** Waits for the blocking part (course, theme, own skin), then whatever of the background part is already done. */
export async function preloadMatch(
  store: Pick<AssetStore, 'preloadMatch'>,
  cfg: MatchConfig,
  localPlayerId: number,
): Promise<MatchPacks> {
  const pre = store.preloadMatch(cfg, { localPlayerId });
  let packs: Record<string, Pack> = {};
  let fallbacks = 0;
  let timedOut = false;
  try {
    const r = await pre.blocking;
    packs = { ...r.packs };
    fallbacks = r.fallbacks.length;
    timedOut = r.timedOut;
  } catch {
    // never fatal: the race goes on with the defaults
  }
  // The other players' skins usually arrive within a moment; do not hold the race for them.
  const bg = await Promise.race([pre.background, new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
  if (bg) {
    Object.assign(packs, bg.packs);
    fallbacks += bg.fallbacks.length;
  }
  const skins = new Map<number, Pack>();
  for (const p of cfg.players) {
    const pack = packs[p.skinId];
    if (pack) skins.set(p.id, pack);
  }
  return { theme: packs[cfg.themeId] ?? null, skins, fallbacks, timedOut };
}
