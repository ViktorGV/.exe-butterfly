// Built-in skin and theme packs, read by resolveBuiltin() in ../../builtins.ts.
// #16: 12 original skins and 4 original themes; the fixture packs stay registered too.
import { fixtureSkinPack, fixtureThemePack } from '../../fixtures/index.ts';
import type { Pack } from '../../types.ts';
import { BUILTIN_SKINS, SUNNY_BEAN } from './skins.ts';
import { BUILTIN_THEMES, CANDY_WORKSHOP } from './themes.ts';

export const DEFAULT_SKIN_ID = SUNNY_BEAN.id;
export const DEFAULT_THEME_ID = CANDY_WORKSHOP.id;

export const BUILTIN_SKIN_PACKS: Pack[] = [...BUILTIN_SKINS, fixtureSkinPack];
export const BUILTIN_THEME_PACKS: Pack[] = [...BUILTIN_THEMES, fixtureThemePack];
