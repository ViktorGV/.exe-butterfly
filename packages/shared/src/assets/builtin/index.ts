// Built-in skin and theme packs, read by resolveBuiltin() in ../../builtins.ts.
// Seeded by #2 with the fixtures; #16 adds 12 skins and 4 themes.
import { fixtureSkinPack, fixtureThemePack } from '../../fixtures/index.ts';
import type { Pack } from '../../types.ts';

export const BUILTIN_SKIN_PACKS: Pack[] = [fixtureSkinPack];
export const BUILTIN_THEME_PACKS: Pack[] = [fixtureThemePack];
