// SEAM. Seeded by #54 with a stub; replaced by #68 (username matching, unique themed skins,
// live fallback). The room code (#18) talks to event mode only through this factory.
import type { EventDirector, EventManifest, EventRoster } from '@wobble/shared/types';

export const DEFAULT_SKIN_ID = 'b:fixture-skin';

export interface EventDirectorOptions {
  manifest: EventManifest | null;
  roster: EventRoster | null;
  /** EVENT_ROSTER_SECRET */
  secret?: string;
}

/**
 * STUB: event mode stays off (`enabled: false`), nobody matches, and everyone gets the default skin.
 * The vote options still come from the manifest so the vote flow can be built against it.
 */
export function createEventDirector({ manifest }: EventDirectorOptions): EventDirector {
  return {
    enabled: false,
    identify: async () => ({ matched: false, previewSkins: null }),
    voteOptions: () => (manifest ? manifest.themes.map((t) => t.id) : []),
    assignSkins: async (players) => new Map(players.map((p) => [p.id, DEFAULT_SKIN_ID])),
  };
}
