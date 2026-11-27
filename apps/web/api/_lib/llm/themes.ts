// Theme lookup for theme-adapted skins. Owned by #22.
// b: ids come from resolveBuiltin; e: ids from the event packs in apps/web/public/event/packs/theme/ (#54).
import { resolveBuiltin } from '@wobble/shared/builtins';
import { fixtureThemeV2Pack } from '@wobble/shared/fixtures/index';
import { PackSchema } from '@wobble/shared/schemas/packs';
import type { ThemeDef } from '@wobble/shared/types';

const EVENT_THEME_DIR = new URL('../../../public/event/packs/theme/', import.meta.url);
const cache = new Map<string, ThemeDef>();

/** The theme for a pack id, or null if it is unknown or not a theme. */
export async function resolveTheme(id: string): Promise<ThemeDef | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  let theme: ThemeDef | null = null;
  if (id.startsWith('b:')) {
    const pack = resolveBuiltin(id);
    if (pack?.kind === 'theme') theme = pack.data;
  } else if (id.startsWith('e:')) {
    theme = await readEventTheme(id.slice(2));
    if (!theme && id === fixtureThemeV2Pack.id && fixtureThemeV2Pack.kind === 'theme') theme = fixtureThemeV2Pack.data;
  }
  // Only hits are cached: ids come from the network, so misses must not grow memory.
  if (theme) cache.set(id, theme);
  return theme;
}

async function readEventTheme(slug: string): Promise<ThemeDef | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) return null;
  const file = Bun.file(new URL(`${slug}.json`, EVENT_THEME_DIR));
  if (!(await file.exists())) return null;
  const parsed = PackSchema.safeParse(await file.json().catch(() => null));
  return parsed.success && parsed.data.kind === 'theme' ? parsed.data.data : null;
}
