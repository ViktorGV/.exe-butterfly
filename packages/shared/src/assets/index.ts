// SEAM (#16): sanitizer, pattern rasteriser, LLM-facing schemas, swatches and built-in packs.
// Rules and ranges are documented in docs/ASSET_PACKS.md.
export { sanitizePack, sanitizePattern, cleanName, packBytes, PACK_RULES, SURFACE_SLOTS } from './sanitize.ts';
export { drawPattern, patternRepeats, customRepeats, PATTERN_MAX_PX } from './pattern.ts';
export type { PatternContext } from './pattern.ts';
export { colorDistance, normalizeHex } from './color.ts';
export { skinLLMSchema, themeLLMSchema, courseLLMSchema } from './llm.ts';
export { skinSwatch, themeSwatch } from './swatch.ts';
export type { SkinSwatch, ThemeSwatch } from './swatch.ts';
export { BUILTIN_SKIN_PACKS, BUILTIN_THEME_PACKS, DEFAULT_SKIN_ID, DEFAULT_THEME_ID } from './builtin/index.ts';
export { STARTER_SKIN_IDS, pickStarterSkin } from './builtin/starters.ts';
export { BALLOT_THEME_IDS, CHALGA_THEME_ID, VOTE_THEME_IDS } from './voteThemes.ts';
