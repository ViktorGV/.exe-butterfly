// Assembles the final ThemeDef v2 from the checked look and the images that survived QA (#59).
import { LIMITS, sanitizePack, ThemeDefV2Schema } from '@wobble/shared';
import type { ImageRef, ThemeDefV2 } from '@wobble/shared';
import { shrinkToFit } from './clamp.ts';
import type { ThemeLook } from './clamp.ts';
import { text } from './clamp.ts';
import type { Slot } from './slots.ts';

const MAX_DECOR = 8;

export interface SlotImage {
  slot: Slot;
  ref: ImageRef;
}

/** What sanitizePack (#16) answers for any v2 theme while it only knows v1. */
export const SANITIZER_V1_ONLY = 'version: expected 1';

/**
 * Run the theme through sanitizePack and require a valid v2 theme. Until the sanitizer learns v2, its
 * version rejection is tolerated (clamp.ts and legibility.ts have already done the checks); any other
 * rejection is an error.
 */
export function sanitizeV2(theme: ThemeDefV2, sanitize: typeof sanitizePack = sanitizePack): ThemeDefV2 {
  const result = sanitize('theme', theme);
  if (result.ok) return ThemeDefV2Schema.parse(result.data);
  if (result.issues.join() !== SANITIZER_V1_ONLY) {
    throw new Error(`sanitizePack rejected the theme: ${result.issues.join('; ')}`);
  }
  return ThemeDefV2Schema.parse(theme);
}

export function composeTheme(look: ThemeLook, images: SlotImage[], credit: string | null): ThemeDefV2 {
  const materials = Object.fromEntries(
    Object.entries(look.materials).map(([name, m]) => [name, { ...m, texture: null as ImageRef | null }]),
  ) as ThemeDefV2['materials'];
  let skyImage: ImageRef | null = null;
  const sprites: ThemeDefV2['decor'] = [];
  const signage: ThemeDefV2['signage'] = [];
  const art: ThemeDefV2['art'] = { voteCard: null, reveal: null, podium: null };

  for (const { slot, ref } of images) {
    const target = slot.target;
    if (target.type === 'skybox') skyImage = ref;
    else if (target.type === 'texture') for (const m of target.materials) materials[m].texture = ref;
    else if (target.type === 'signage') signage.push({ slot: target.sign, image: ref });
    else if (target.type === 'art') art[target.key] = ref;
    else {
      const minScale = Math.min(4, Math.max(0.2, target.minScale || 1));
      sprites.push({
        type: 'sprite',
        name: text(target.name, 24, 'Sprite'),
        prims: [],
        image: ref,
        density: Math.min(1, Math.max(0, target.density || 0.2)),
        minScale,
        maxScale: Math.min(6, Math.max(minScale, target.maxScale || minScale)),
      });
    }
  }

  const solid: ThemeDefV2['decor'] = look.decor.map((d) => ({ type: 'prims', image: null, ...d }));
  const theme: ThemeDefV2 = {
    ...look,
    version: 2,
    credit: credit?.trim() ? text(credit, 24) : null,
    sky: { ...look.sky, image: skyImage },
    materials,
    decor: [...sprites.slice(0, MAX_DECOR), ...solid].slice(0, MAX_DECOR),
    signage: signage.slice(0, 6),
    art,
  };

  const fitted = shrinkToFit(theme, LIMITS.themePackMaxBytes);
  const checked = sanitizeV2(fitted);
  const bytes = Buffer.byteLength(JSON.stringify(checked));
  if (bytes > LIMITS.themePackMaxBytes) {
    throw new Error(`theme JSON is ${bytes} bytes, more than ${LIMITS.themePackMaxBytes}`);
  }
  return checked;
}
