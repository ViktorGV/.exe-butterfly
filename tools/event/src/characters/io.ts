// Reading inputs and writing outputs of `event:characters` (#63).
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EventManifestSchema,
  EventRosterSchema,
  SkinPackSchema,
  ThemePackSchema,
  fixtureManifest,
  fixtureThemeV2,
} from '@wobble/shared';

import type { EventManifest, EventRoster, Pack } from '@wobble/shared';
import { writeJson } from '../lib/files.ts';
import { SubmissionsFileSchema } from '../intake/intake.ts';
import { stripInjection } from '../select/injection.ts';
import type { CharacterSubmission } from './pregen.ts';
import { themeSlug } from './pregen.ts';
import { sampleSubmissions } from './sample.ts';
import type { CastRole, ThemeInput } from './types.ts';

const REPO = join(import.meta.dir, '..', '..', '..', '..');
export const DEFAULT_PATHS = Object.freeze({
  submissions: join(REPO, 'tools', 'event', 'out', 'submissions.json'),
  publicEvent: join(REPO, 'apps', 'web', 'public', 'event'),
  roster: join(REPO, 'apps', 'server', 'event', 'roster.json'),
  contactSheet: join(REPO, 'tools', 'event', 'out', 'characters.html'),
});

export async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await Bun.file(file).text());
}

/** submissions.json from #56 -> what this step needs. The character prompt is untrusted, so injection is stripped. */
export async function loadSubmissions(file: string): Promise<CharacterSubmission[]> {
  if (file === 'sample') return sampleSubmissions(100);
  const parsed = SubmissionsFileSchema.parse(await readJson(file));
  return parsed.submissions.map((s) => ({
    username: s.username,
    characterPrompt: stripInjection(s.characterPrompt).clean,
  }));
}

/** The manifest and its 5 theme packs (packs/theme/<slug>.json from #59). */
export async function loadThemes(publicEvent: string): Promise<{ manifest: EventManifest; themes: ThemeInput[] }> {
  const manifest = EventManifestSchema.parse(await readJson(join(publicEvent, 'manifest.json')));
  const themes: ThemeInput[] = [];
  for (const t of manifest.themes) {
    const pack = ThemePackSchema.parse(await readJson(join(publicEvent, 'packs', 'theme', `${t.id.slice(2)}.json`)));
    if (pack.data.version !== 2) throw new Error(`${t.id} is not a ThemeDef v2; run event:themes first`);
    themes.push({ id: t.id, slug: themeSlug(t.id), def: pack.data });
  }
  return { manifest, themes };
}

/** --fixture: the 5 fixture themes, so the step runs before #59 has produced anything. */
export function fixtureThemes(): { manifest: EventManifest; themes: ThemeInput[] } {
  const manifest = structuredClone(fixtureManifest);
  return { manifest, themes: manifest.themes.map((t) => ({ id: t.id, slug: themeSlug(t.id), def: fixtureThemeV2 })) };
}

/** Every skin pack on disk, for --only-user (keeps signatures unique against the rest). */
export async function loadSkinPacks(publicEvent: string): Promise<Pack[]> {
  const dir = join(publicEvent, 'packs', 'skin');
  const files = await readdir(dir).catch(() => [] as string[]);
  const packs: Pack[] = [];
  for (const f of files) if (f.endsWith('.json')) packs.push(SkinPackSchema.parse(await readJson(join(dir, f))));
  return packs;
}

export async function loadRoster(file: string): Promise<EventRoster> {
  return EventRosterSchema.parse(await readJson(file));
}

const packFile = (publicEvent: string, id: string) => join(publicEvent, 'packs', 'skin', `${id.slice(2)}.json`);

/** Writes the skin packs. A full run first removes the skins of an earlier run. */
export async function writeSkinPacks(publicEvent: string, packs: Pack[], opts: { clean: boolean; remove?: string[] }) {
  const dir = join(publicEvent, 'packs', 'skin');
  if (opts.clean) {
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      if (/^(skin|pool|hero|villain)-.*\.json$/.test(f)) await rm(join(dir, f));
    }
  }
  for (const id of opts.remove ?? []) await rm(packFile(publicEvent, id), { force: true });
  for (const p of packs) await writeJson(packFile(publicEvent, p.id), SkinPackSchema.parse(p));
}

/** Replaces only `pools` in manifest.json; themes stay as #59 wrote them. */
export async function writePools(publicEvent: string, manifest: EventManifest, pools: Record<string, string[]>) {
  const next = EventManifestSchema.parse({ ...manifest, pools });
  await writeJson(join(publicEvent, 'manifest.json'), next);
  return next;
}

export async function writeRoster(file: string, roster: EventRoster) {
  await writeJson(file, EventRosterSchema.parse(roster));
}

/** Where hero and villain skins live: fixed ids, `e:hero-<theme>` and `e:villain-<theme>`. */
export type CastIds = Record<string, Record<CastRole, string>>;
