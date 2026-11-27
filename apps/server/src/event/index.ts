// SEAM. Seeded by #54, implemented by #68: username matching, unique themed skins and the
// live fallback. The room code (#18) talks to event mode only through this module.
import {
  normalizeUsername,
  parseRandomSkinId,
  randomSkinId,
  randomThemedSkin,
  rosterKey,
  skinSignature,
  themeSlug,
} from '@wobble/shared/event/index';
import { resolveBuiltin } from '@wobble/shared/builtins';
import type {
  CostumeKit,
  EventDirector,
  EventIdentity,
  EventManifest,
  EventRoster,
  SkinDef,
} from '@wobble/shared/types';

export const DEFAULT_SKIN_ID = 'b:fixture-skin';
/** How long assignSkins waits for a pending live generation before falling back. */
export const LIVE_TIMEOUT_MS = 8000;

/** Live skin generation (#22 `POST /api/packs/generate`). Resolves to the new skin's id and data. */
export type GenerateSkin = (req: { prompt: string; themeId: string; clientId: string }) => Promise<{
  id: string;
  skin: SkinDef;
}>;

export interface EventDirectorOptions {
  manifest: EventManifest | null;
  roster: EventRoster | null;
  /** EVENT_ROSTER_SECRET */
  secret?: string;
  generateSkin?: GenerateSkin;
  /** themeId -> costume kit from that theme pack; needed for procedural `r:` skins. */
  costumes?: Record<string, CostumeKit>;
  /** skin id -> skin data for pool and roster skins, used for look-alike checks. */
  skins?: Record<string, SkinDef>;
  liveTimeoutMs?: number;
}

export interface ServerEventIdentity extends EventIdentity {
  /** 'duplicate': the username matched but is already in use, so this connection plays unmatched. */
  notice: 'duplicate' | null;
}

export interface ServerEventDirector extends EventDirector {
  /**
   * Match a username. `owner` identifies the connection (e.g. the reconnect token): a matched
   * username claimed by another live owner comes back unmatched with `notice: 'duplicate'`.
   */
  identify(name: string, owner?: string): Promise<ServerEventIdentity>;
  /** Call when a connection closes so its username can be matched again. */
  release(name: string, owner?: string): void;
}

const SALT = 0x9e3779b9;
/** FNV-1a of a string, used to seed pool picks and procedural skins from the username. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      () => (clearTimeout(t), resolve(null)),
    );
  });
}

export function createEventDirector(opts: EventDirectorOptions): ServerEventDirector {
  const { manifest, roster, secret, generateSkin, costumes = {}, skins = {} } = opts;
  const liveTimeoutMs = opts.liveTimeoutMs ?? LIVE_TIMEOUT_MS;
  const themeIds = manifest ? manifest.themes.map((t) => t.id) : [];
  const enabled = !!(manifest && roster && secret && themeIds.every((id) => costumes[id] && themeSlug(id)));

  const claims = new Map<string, string>(); // roster key -> owner
  const live = new Map<string, Map<string, Promise<{ id: string; skin: SkinDef } | null>>>(); // key -> theme -> gen
  const liveDone = new Map<string, { id: string; skin: SkinDef }>(); // `${key} ${themeId}`
  const slugToTheme = new Map(themeIds.map((id) => [themeSlug(id) ?? id, id]));

  const keyOf = (name: string) => rosterKey(secret!, name);

  function startLive(key: string): void {
    const entry = roster!.entries[key];
    if (!entry?.characterPrompt || !generateSkin) return;
    let perTheme = live.get(key);
    if (!perTheme) live.set(key, (perTheme = new Map()));
    for (const themeId of themeIds) {
      if (entry.skins[themeId] || perTheme.has(themeId)) continue;
      const p = generateSkin({ prompt: entry.characterPrompt, themeId, clientId: `srv-${key}` }).then(
        (r) => (liveDone.set(`${key} ${themeId}`, r), r),
        () => (perTheme.delete(themeId), null), // a later join may retry
      );
      perTheme.set(themeId, p);
    }
  }

  function skinOf(id: string): SkinDef | null {
    if (skins[id]) return skins[id]!;
    const b = resolveBuiltin(id);
    if (b?.kind === 'skin') return b.data;
    const r = parseRandomSkinId(id);
    const t = r && slugToTheme.get(r.slug);
    return r && t && costumes[t] ? randomThemedSkin(costumes[t]!, r.seed) : null;
  }
  const sigOf = (id: string, known?: SkinDef) => {
    const s = known ?? skinOf(id);
    return s ? skinSignature(s) : `id:${id}`;
  };

  return {
    enabled,

    async identify(name, owner = '') {
      const none: ServerEventIdentity = { matched: false, previewSkins: null, notice: null };
      if (!enabled) return none;
      const key = await keyOf(name);
      const entry = roster!.entries[key];
      if (!entry) return none;
      const holder = claims.get(key);
      if (holder !== undefined && holder !== owner) return { ...none, notice: 'duplicate' };
      claims.set(key, owner);
      startLive(key);
      const previewSkins: Record<string, string> = {};
      for (const t of themeIds) {
        const id = entry.skins[t] ?? liveDone.get(`${key} ${t}`)?.id;
        if (id) previewSkins[t] = id;
      }
      return { matched: true, previewSkins, notice: null };
    },

    release(name, owner = '') {
      if (!enabled) return;
      void keyOf(name).then((key) => {
        if (claims.get(key) === owner) claims.delete(key);
      });
    },

    voteOptions: () => [...themeIds],

    async assignSkins(players, themeId) {
      const out = new Map<number, string>();
      if (!enabled || !themeIds.includes(themeId)) {
        for (const p of players) out.set(p.id, DEFAULT_SKIN_ID);
        return out;
      }
      const used = new Set<string>();
      const take = (pid: number, id: string, skin?: SkinDef) => {
        const sig = sigOf(id, skin);
        if (used.has(sig)) return false;
        used.add(sig);
        out.set(pid, id);
        return true;
      };
      const sorted = [...players].sort((a, b) => a.id - b.id);

      // 1-2. Personal skins: pregenerated, else a live generation (waited for up to liveTimeoutMs).
      const waits: Promise<void>[] = [];
      for (const p of sorted) {
        if (!p.matched) continue;
        const key = await keyOf(p.name);
        const entry = roster!.entries[key];
        if (!entry) continue;
        const pre = entry.skins[themeId];
        if (pre) {
          take(p.id, pre);
          continue;
        }
        const done = liveDone.get(`${key} ${themeId}`);
        if (done) {
          take(p.id, done.id, done.skin);
          continue;
        }
        startLive(key);
        const pending = live.get(key)?.get(themeId);
        if (pending)
          waits.push(
            withTimeout(pending, liveTimeoutMs).then((r) => {
              if (r) take(p.id, r.id, r.skin);
            }),
          );
      }
      await Promise.all(waits);

      // 3-4. Everyone else: the pool (seeded by the username), then procedural skins.
      const pool = manifest!.pools[themeId] ?? [];
      const poolUsed = new Set<number>();
      const slug = themeSlug(themeId)!;
      const costume = costumes[themeId]!;
      for (const p of sorted) {
        if (out.has(p.id)) continue;
        const h = hash(normalizeUsername(p.name) + ' ' + themeId);
        let placed = false;
        for (let i = 0; i < pool.length && !placed; i++) {
          const idx = (h + i) % pool.length;
          if (poolUsed.has(idx)) continue;
          poolUsed.add(idx);
          placed = take(p.id, pool[idx]!);
        }
        for (let a = 0, seed = h; !placed; a++, seed = (seed + SALT) >>> 0) {
          const id = randomSkinId(slug, seed);
          placed = take(p.id, id, randomThemedSkin(costume, seed)) || a > 10_000;
          if (placed && !out.has(p.id)) out.set(p.id, id);
        }
      }
      return out;
    },
  };
}
