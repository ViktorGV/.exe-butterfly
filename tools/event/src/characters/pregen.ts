// Character pregeneration (#63): screen every submission, fuse each `ok` character with each theme,
// build a unique themed pool and the hero/villain per theme, and the hashed roster.
import { normalizeUsername, rosterKey, sanitizePack, skinSignature } from '@wobble/shared';
import type { EventRoster, Pack, SkinDef } from '@wobble/shared';
import type { EventAi } from '../lib/ai.ts';
import { BudgetExceededError } from '../lib/budget.ts';
import { mapLimit } from '../lib/concurrency.ts';
import { buildSkin, jitterSkin, poolTraits } from './build.ts';
import { castCharacter, fuseCharacter, poolBatch, screenCharacter, themeWord } from './model.ts';
import type { CastRole, Screen, ScreenStatus, ThemeInput } from './types.ts';

/** Model retries with a variation hint when a skin fails the sanitizer or repeats a signature. */
export const MAX_VARIATIONS = 2;
export const POOL_BATCH = 10;
export const DEFAULT_POOL_SIZE = 150;

export interface CharacterSubmission {
  username: string;
  characterPrompt: string;
}

export interface PregenOptions {
  ai: EventAi;
  eventId: string;
  secret: string;
  submissions: CharacterSubmission[];
  themes: ThemeInput[];
  poolSize?: number;
  concurrency?: number;
  /** ISO time stamped on every pack */
  now?: string;
  /** Regenerate just this person; everything else comes from `existing`. */
  onlyUser?: string;
  existing?: { roster: EventRoster; skins: Pack[] };
  log?: (line: string) => void;
}

export interface ScreenedSubmission {
  key: string;
  screen: Screen;
}

export interface PregenResult {
  packs: Pack[];
  /** themeId -> pool skin ids */
  pools: Record<string, string[]>;
  /** themeId -> hero and villain skin ids */
  cast: Record<string, Record<CastRole, string>>;
  roster: EventRoster;
  counts: Record<ScreenStatus, number> & { reinterpretedFromIP: number };
  /** skins that came from the local builder because the model kept failing */
  fallbacks: number;
  /** pack ids this run replaces (only with onlyUser) */
  replaced: string[];
}

/** `e:theme-sherbet-sky` -> `sherbet-sky` */
export function themeSlug(themeId: string): string {
  return (
    themeId
      .replace(/^e:/, '')
      .replace(/^theme-/, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'theme'
  );
}

async function hmacHex(secret: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `e:skin-<theme>-<10 hex>`. Derived from HMAC(secret, rosterKey + theme): stable across reruns,
 * and without the secret it cannot be linked back to a username.
 */
export async function personalSkinId(secret: string, key: string, theme: ThemeInput): Promise<string> {
  return `e:skin-${theme.slug}-${(await hmacHex(secret, `skin|${key}|${theme.id}`)).slice(0, 10)}`;
}

/** Signature registry per theme: personal, pool and cast skins must all look different. */
class ThemeSet {
  readonly sigs = new Set<string>();
  readonly names: string[] = [];
  has(skin: SkinDef) {
    return this.sigs.has(skinSignature(skin));
  }
  add(skin: SkinDef) {
    this.sigs.add(skinSignature(skin));
    this.names.push(skin.name);
  }
}

function sanitizeSkin(data: unknown): SkinDef | null {
  const res = sanitizePack('skin', data);
  return res.ok ? (res.data as SkinDef) : null;
}

/** Calls that fail for reasons other than the budget count as "no skin", so we can retry or fall back. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    return null;
  }
}

export async function pregenerateCharacters(opts: PregenOptions): Promise<PregenResult> {
  const { ai, themes, secret } = opts;
  const log = opts.log ?? (() => {});
  const poolSize = opts.poolSize ?? DEFAULT_POOL_SIZE;
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const now = opts.now ?? new Date().toISOString();
  let fallbacks = 0;

  const sets = new Map(themes.map((t) => [t.id, new ThemeSet()]));
  const packs: Pack[] = [];
  const replaced: string[] = [];
  const toPack = (id: string, data: SkinDef): Pack => ({ id, kind: 'skin', name: data.name, createdAt: now, data });

  /** Accept the first candidate that is sane and unique in its theme; otherwise fall back and jitter. */
  async function place(
    theme: ThemeInput,
    first: SkinDef | null,
    regen: (variation: number) => Promise<SkinDef | null>,
    fallback: () => SkinDef,
  ): Promise<SkinDef> {
    const set = sets.get(theme.id)!;
    let candidate = first;
    for (let v = 0; v <= MAX_VARIATIONS; v++) {
      if (v > 0) candidate = await regen(v);
      const skin = candidate ? sanitizeSkin(candidate) : null;
      if (skin && !set.has(skin)) {
        set.add(skin);
        return skin;
      }
    }
    fallbacks++;
    let skin = sanitizeSkin(fallback())!;
    for (let i = 0; set.has(skin); i++) skin = jitterSkin(skin, `${theme.id}|jitter|${i}|${skin.name}`);
    set.add(skin);
    return skin;
  }

  // Existing state for --only-user.
  const only = opts.onlyUser !== undefined ? normalizeUsername(opts.onlyUser) : null;
  const entries: EventRoster['entries'] = only ? structuredClone(opts.existing?.roster.entries ?? {}) : {};
  const onlyKey = only !== null ? await rosterKey(secret, only) : null;
  if (only !== null) {
    const old = new Set(Object.values(entries[onlyKey!]?.skins ?? {}));
    replaced.push(...old);
    for (const p of opts.existing?.skins ?? []) {
      if (p.kind !== 'skin' || old.has(p.id)) continue;
      const themeId = themes.find((t) => p.id.includes(`-${t.slug}-`) || p.id.endsWith(`-${t.slug}`))?.id;
      if (themeId) sets.get(themeId)!.add(p.data as SkinDef);
    }
  }

  // 1. Screen.
  const subs =
    only !== null ? opts.submissions.filter((s) => normalizeUsername(s.username) === only) : opts.submissions;
  if (only !== null && subs.length === 0) throw new Error('--only-user: no submission with that username');
  const screened: ScreenedSubmission[] = await mapLimit(subs, concurrency, async (s) => ({
    key: await rosterKey(secret, s.username),
    screen: (await attempt(() => screenCharacter(ai, s.characterPrompt))) ?? {
      status: 'tooVague' as const,
      traits: { colors: [], motifs: [], vibe: '', silhouette: '' },
      reinterpretedFromIP: false,
      description: '',
    },
  }));
  const counts = { ok: 0, tooVague: 0, unsafe: 0, empty: 0, reinterpretedFromIP: 0 };
  for (const s of screened) {
    counts[s.screen.status]++;
    if (s.screen.reinterpretedFromIP) counts.reinterpretedFromIP++;
    entries[s.key] = { characterPrompt: s.screen.status === 'ok' ? s.screen.description || null : null, skins: {} };
  }
  log(`screened ${screened.length}: ${JSON.stringify(counts)}`);
  const ok = screened.filter((s) => s.screen.status === 'ok');

  // 2-3. Personal skins, one theme at a time per worker, accepted in submission order.
  const pools: Record<string, string[]> = {};
  const cast: Record<string, Record<CastRole, string>> = {};
  await Promise.all(
    themes.map(async (theme) => {
      const word = themeWord(theme);
      const fuse = (s: ScreenedSubmission, variation: number) =>
        attempt(() =>
          fuseCharacter(ai, {
            theme,
            description: s.screen.description,
            traits: s.screen.traits,
            variation,
            avoidNames: sets.get(theme.id)!.names,
          }),
        );
      // Themes run side by side, so split the concurrency between them.
      const perTheme = Math.max(1, Math.ceil(concurrency / themes.length));
      const firsts = await mapLimit(ok, perTheme, (s) => fuse(s, 0));
      for (let i = 0; i < ok.length; i++) {
        const s = ok[i]!;
        const skin = await place(
          theme,
          firsts[i]!,
          (v) => fuse(s, v),
          () =>
            buildSkin({
              seed: `${s.key}|${theme.id}`,
              traits: s.screen.traits,
              costume: theme.def.costume,
              themeWord: word,
            }),
        );
        const id = await personalSkinId(secret, s.key, theme);
        entries[s.key]!.skins[theme.id] = id;
        packs.push(toPack(id, skin));
      }
      if (only !== null) return;

      // 4. Hero and villain from the theme's cast (#84), generic when it is null.
      cast[theme.id] = { hero: '', villain: '' };
      for (const role of ['hero', 'villain'] as const) {
        const member = theme.def.cast?.[role] ?? {
          name: role === 'hero' ? `${word} Hero` : `${word} Villain`.slice(0, 24),
          description: role === 'hero' ? 'A friendly helper of the theme' : 'A mischievous trickster of the theme',
        };
        const gen = (variation: number) =>
          attempt(() =>
            castCharacter(ai, {
              theme,
              role,
              name: member.name.slice(0, 24),
              description: member.description,
              variation,
            }),
          );
        const skin = await place(theme, await gen(0), gen, () =>
          buildSkin({
            seed: `${theme.id}|${role}`,
            traits: poolTraits(`${theme.id}|${role}`, theme.def.costume),
            costume: theme.def.costume,
            themeWord: word,
            name: member.name.slice(0, 24),
          }),
        );
        const id = `e:${role}-${theme.slug}`;
        cast[theme.id]![role] = id;
        packs.push(toPack(id, skin));
      }

      // 5. Pool: batches of 10 with "make these differ", same uniqueness check.
      const ids: string[] = [];
      const maxBatches = Math.ceil(poolSize / POOL_BATCH) * 2;
      for (let batch = 0; ids.length < poolSize && batch < maxBatches; batch++) {
        const count = Math.min(POOL_BATCH, poolSize - ids.length);
        const set = sets.get(theme.id)!;
        const got =
          (await attempt(() => poolBatch(ai, { theme, batch, count, variation: 0, avoidNames: set.names }))) ?? [];
        for (const raw of got) {
          if (ids.length >= poolSize) break;
          const skin = sanitizeSkin(raw);
          if (!skin || set.has(skin)) continue;
          set.add(skin);
          const id = `e:pool-${theme.slug}-${String(ids.length + 1).padStart(3, '0')}`;
          ids.push(id);
          packs.push(toPack(id, skin));
        }
      }
      while (ids.length < poolSize) {
        const seed = `${theme.id}|poolfill|${ids.length}`;
        const skin = await place(
          theme,
          null,
          async () => null,
          () =>
            buildSkin({
              seed,
              traits: poolTraits(seed, theme.def.costume),
              costume: theme.def.costume,
              themeWord: word,
            }),
        );
        const id = `e:pool-${theme.slug}-${String(ids.length + 1).padStart(3, '0')}`;
        ids.push(id);
        packs.push(toPack(id, skin));
      }
      pools[theme.id] = ids;
      log(`theme ${theme.id}: ${ok.length} personal, ${ids.length} pool, hero + villain`);
    }),
  );

  return {
    packs,
    pools,
    cast,
    roster: { version: 1, eventId: opts.eventId, entries },
    counts,
    fallbacks,
    replaced: replaced.filter((id) => !packs.some((p) => p.id === id)),
  };
}
