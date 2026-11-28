// Step 7: writes a theme's images and pack, and the themes part of the event manifest (#59).
// Layout from docs/CONTRACTS.md section 9, relative to `eventDir` (apps/web/public/event).
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventManifestSchema, ThemePackSchema, VOTE } from '@wobble/shared';
import type { EventManifest, ThemeDefV2 } from '@wobble/shared';
import { format } from 'prettier';
import type { ImageFile } from '../images/process.ts';
import { writeText } from '../lib/files.ts';

export const COURSE_ID = 'b:gumdrop-gauntlet';
export const DEFAULT_EVENT_ID = 'wobble-event';
export const FALLBACK_VOTE_CARD = 'vote-card-fallback';

export const packId = (slug: string) => `e:theme-${slug}`;

export const themeDir = (eventDir: string, slug: string) => join(eventDir, 'themes', slug);
/** docs/CONTRACTS.md: pack e:<id> lives at /event/packs/<kind>/<id>.json, so e:theme-<slug> is theme-<slug>.json. */
export const packFile = (eventDir: string, slug: string) => join(eventDir, 'packs', 'theme', `theme-${slug}.json`);

/** JSON the way `prettier --check` wants it, since these files are committed. */
export const prettyJson = (value: unknown): Promise<string> =>
  format(JSON.stringify(value, null, 2), { parser: 'json', printWidth: 120 });

export interface ThemePackFile {
  id: string;
  kind: 'theme';
  name: string;
  prompt?: string;
  createdAt: string;
  data: ThemeDefV2;
}

export async function readPack(eventDir: string, slug: string): Promise<ThemePackFile | null> {
  const file = Bun.file(packFile(eventDir, slug));
  if (!(await file.exists())) return null;
  const parsed = ThemePackSchema.safeParse(await file.json().catch(() => null));
  return parsed.success && parsed.data.data.version === 2 ? (parsed.data as ThemePackFile) : null;
}

/** Every image a theme refers to, as file names in its folder. */
export function imageNames(theme: ThemeDefV2): string[] {
  const refs = [
    theme.sky.image,
    ...Object.values(theme.materials).map((m) => m.texture),
    ...theme.decor.map((d) => d.image),
    ...theme.signage.map((s) => s.image),
    ...Object.values(theme.art),
  ];
  return [...new Set(refs.flatMap((r) => (r ? [r.src, ...(r.lowSrc ? [r.lowSrc] : [])] : [])))];
}

export async function writeTheme(
  eventDir: string,
  slug: string,
  pack: ThemePackFile,
  files: ImageFile[],
): Promise<string> {
  ThemePackSchema.parse(pack);
  const dir = themeDir(eventDir, slug);
  await mkdir(dir, { recursive: true });
  await Promise.all(files.map((f) => writeFile(join(dir, f.name), f.bytes)));
  // Images left from an earlier run of this theme would count against nothing but still ship.
  const wanted = new Set(files.map((f) => f.name));
  for (const name of await readdir(dir)) {
    if (name.endsWith('.webp') && !wanted.has(name)) await rm(join(dir, name));
  }
  const file = packFile(eventDir, slug);
  await writeText(file, await prettyJson(pack));
  return file;
}

export async function manifestEntry(
  eventDir: string,
  slug: string,
  theme: ThemeDefV2,
): Promise<EventManifest['themes'][number]> {
  const fallback = `${FALLBACK_VOTE_CARD}.webp`;
  const voteCard = theme.art.voteCard?.src ?? fallback;
  if (!(await Bun.file(join(themeDir(eventDir, slug), voteCard)).exists())) {
    throw new Error(`${slug}: the vote card ${voteCard} is missing`);
  }
  const { sky, materials, hud, ground } = theme;
  return {
    id: packId(slug),
    title: theme.title,
    tagline: theme.tagline,
    credit: theme.credit,
    voteCard: `/event/themes/${slug}/${voteCard}`,
    swatch: [sky.top, sky.horizon, materials.platformA.color, materials.hazard.color, hud.accent, ground.color],
  };
}

/** Replace the themes of manifest.json. Pools (#63) survive for themes that are still there. */
export async function writeManifest(
  eventDir: string,
  themes: EventManifest['themes'],
  eventId?: string,
): Promise<EventManifest> {
  if (themes.length !== VOTE.options) {
    throw new Error(`the manifest needs ${VOTE.options} themes, only ${themes.length} are ready`);
  }
  const file = join(eventDir, 'manifest.json');
  const previous = (await Bun.file(file)
    .json()
    .catch(() => null)) as Partial<EventManifest> | null;
  const ids = new Set(themes.map((t) => t.id));
  const manifest = EventManifestSchema.parse({
    ...previous,
    version: 1,
    eventId: eventId ?? previous?.eventId ?? DEFAULT_EVENT_ID,
    courseId: previous?.courseId ?? COURSE_ID,
    themes,
    pools: Object.fromEntries(Object.entries(previous?.pools ?? {}).filter(([id]) => ids.has(id))),
  });
  await writeText(file, await prettyJson(manifest));
  return manifest;
}
