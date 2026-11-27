// Loads event mode from the environment and disk (#68). See docs/EVENT_MODE.md.
import { resolve } from 'node:path';
import { resolveBuiltin } from '@wobble/shared/builtins';
import { EventManifestSchema, EventRosterSchema } from '@wobble/shared/schemas/event';
import { GenerateResponseSchema } from '@wobble/shared/schemas/api';
import { PackSchema } from '@wobble/shared/schemas/packs';
import type { CostumeKit, EventManifest, EventRoster, Pack, SkinDef } from '@wobble/shared/types';
import { createEventDirector, type GenerateSkin, type ServerEventDirector } from './index.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
export const DEFAULT_ROSTER_PATH = resolve(ROOT, 'apps/server/event/roster.json');
export const DEFAULT_PUBLIC_DIR = resolve(ROOT, 'apps/web/public');

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** `POST /api/packs/generate` with the server token (#22). */
export function createHttpGenerateSkin({
  baseUrl,
  token,
  fetch: f = fetch,
}: {
  baseUrl: string;
  token: string;
  fetch?: Fetch;
}): GenerateSkin {
  return async ({ prompt, themeId, clientId }) => {
    const res = await f(new URL('/api/packs/generate', baseUrl).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: 'skin', prompt, themeId, clientId }),
    });
    if (!res.ok) throw new Error(`generate failed: HTTP ${res.status}`);
    const body = GenerateResponseSchema.parse(await res.json());
    if (body.pack.kind !== 'skin') throw new Error('generate returned a non-skin pack');
    return { id: body.id, skin: body.pack.data };
  };
}

export interface LoadOptions {
  env?: Record<string, string | undefined>;
  rosterPath?: string;
  publicDir?: string;
  fetch?: Fetch;
  log?: (msg: string) => void;
}

export interface LoadResult {
  director: ServerEventDirector;
  /** why event mode is off, null when on */
  reason: string | null;
}

const off = (reason: string): LoadResult => ({
  director: createEventDirector({ manifest: null, roster: null }),
  reason,
});

/**
 * Event mode is on when WOBBLE_EVENT_ID is set, EVENT_ROSTER_SECRET is set, and the roster, manifest
 * and theme packs load, validate and carry that event id. Otherwise returns a disabled director.
 */
export async function loadEventDirector(opts: LoadOptions = {}): Promise<LoadResult> {
  const env = opts.env ?? process.env;
  const f = opts.fetch ?? fetch;
  const log = opts.log ?? ((m: string) => console.warn(`[event] ${m}`));
  const eventId = env.WOBBLE_EVENT_ID;
  if (!eventId) return off('WOBBLE_EVENT_ID not set');
  const fail = (reason: string) => (log(`event mode off: ${reason}`), off(reason));
  const secret = env.EVENT_ROSTER_SECRET;
  if (!secret) return fail('EVENT_ROSTER_SECRET is required in event mode');

  const base = env.PACKS_BASE_URL;
  const publicDir = opts.publicDir ?? DEFAULT_PUBLIC_DIR;
  const readPublic = async (path: string): Promise<unknown> => {
    if (base) {
      const res = await f(new URL(path, base).toString());
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return res.json();
    }
    return Bun.file(resolve(publicDir, '.' + path)).json();
  };
  const readEventPack = async (kind: 'skin' | 'theme', id: string): Promise<Pack> => {
    const builtin = resolveBuiltin(id);
    if (builtin) return builtin;
    if (!id.startsWith('e:')) throw new Error(`unsupported pack id ${id}`);
    return PackSchema.parse(await readPublic(`/event/packs/${kind}/${id.slice(2)}.json`));
  };

  let roster: EventRoster;
  let manifest: EventManifest;
  try {
    roster = EventRosterSchema.parse(await Bun.file(opts.rosterPath ?? DEFAULT_ROSTER_PATH).json());
    manifest = EventManifestSchema.parse(await readPublic('/event/manifest.json'));
  } catch (err) {
    return fail(`roster or manifest invalid: ${(err as Error).message}`);
  }
  if (roster.eventId !== eventId || manifest.eventId !== eventId)
    return fail(`event id mismatch (env ${eventId}, roster ${roster.eventId}, manifest ${manifest.eventId})`);

  const costumes: Record<string, CostumeKit> = {};
  const skins: Record<string, SkinDef> = {};
  try {
    for (const t of manifest.themes) {
      const pack = await readEventPack('theme', t.id);
      if (pack.kind !== 'theme' || pack.data.version !== 2) throw new Error(`${t.id} is not a v2 theme`);
      costumes[t.id] = pack.data.costume;
    }
  } catch (err) {
    return fail(`theme pack invalid: ${(err as Error).message}`);
  }
  // Skin data is only for look-alike checks: a missing skin pack is logged, not fatal.
  const skinIds = new Set([
    ...Object.values(manifest.pools).flat(),
    ...Object.values(roster.entries).flatMap((e) => Object.values(e.skins)),
  ]);
  await Promise.all(
    [...skinIds].map(async (id) => {
      try {
        const pack = await readEventPack('skin', id);
        if (pack.kind === 'skin') skins[id] = pack.data;
      } catch (err) {
        log(`skin ${id} not loaded: ${(err as Error).message}`);
      }
    }),
  );

  const token = env.WOBBLE_SERVER_TOKEN;
  const apiBase = env.WOBBLE_API_URL ?? base;
  const generateSkin = token && apiBase ? createHttpGenerateSkin({ baseUrl: apiBase, token, fetch: f }) : undefined;
  if (!generateSkin) log('live fallback off (needs WOBBLE_SERVER_TOKEN and WOBBLE_API_URL or PACKS_BASE_URL)');

  const director = createEventDirector({ manifest, roster, secret, generateSkin, costumes, skins });
  if (!director.enabled) return fail('a theme slug is too long for r: ids');
  return { director, reason: null };
}
