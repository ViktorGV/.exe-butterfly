// Step 3's slot table: which images a theme gets, their shapes and their order of importance (#59).
import { MATERIAL_SLOTS } from '@wobble/shared';
import type { MaterialSlot, ThemeDefV2 } from '@wobble/shared';
import type { ImageKind } from '../images/process.ts';
import type { ImagePlan } from './draft.ts';

type SignSlot = ThemeDefV2['signage'][number]['slot'];

export interface ImageCounts {
  textures: number;
  sprites: number;
  signage: number;
}

export type ArtKey = 'voteCard' | 'reveal' | 'podium';

/** "lean" keeps a real run within a few dollars; "full" fills every slot the issue lists. */
export const PRESETS = Object.freeze({
  lean: { textures: 4, sprites: 3, signage: 2, art: ['voteCard', 'reveal', 'podium'] },
  full: { textures: 7, sprites: 8, signage: 6, art: ['voteCard', 'reveal', 'podium'] },
} satisfies Record<string, ImageCounts & { art: ArtKey[] }>);
export type PresetName = keyof typeof PRESETS;

export type SlotTarget =
  | { type: 'skybox' }
  | { type: 'texture'; materials: MaterialSlot[] }
  | { type: 'sprite'; name: string; density: number; minScale: number; maxScale: number }
  | { type: 'signage'; sign: SignSlot }
  | { type: 'art'; key: ArtKey };

export interface Slot {
  /** Name used by --slot and --fail-slot, e.g. "texture-hazard" or "sprite-2". */
  id: string;
  kind: ImageKind;
  /** Lower is generated first and dropped last. */
  priority: number;
  /** File name without extension. */
  base: string;
  /** The subject, from the image plan. */
  subject: string;
  aspectRatio: string;
  target: SlotTarget;
}

export const kebab = (value: string) => value.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The first `count` entries of `plan`, topped up from `fallback`. */
function take<T>(plan: T[], fallback: T[], count: number, usable: (item: T, chosen: T[]) => T | null): T[] {
  const chosen: T[] = [];
  for (const item of [...plan, ...fallback]) {
    if (chosen.length >= count) break;
    const ok = usable(item, chosen);
    if (ok) chosen.push(ok);
  }
  return chosen;
}

export function planSlots(plan: ImagePlan, fallback: ImagePlan, preset: PresetName): Slot[] {
  const counts = PRESETS[preset];
  const subject = (own: string, other: string) => own.trim() || other;

  const textures = take(plan.textures, fallback.textures, counts.textures, (t, chosen) => {
    const used = new Set(chosen.flatMap((c) => c.slots));
    const slots = MATERIAL_SLOTS.filter((s) => t.slots.includes(s) && !used.has(s));
    return slots.length && t.prompt.trim() ? { ...t, slots } : null;
  });
  const sprites = take(plan.sprites, fallback.sprites, counts.sprites, (s) => (s.prompt.trim() ? s : null));
  const signage = take(plan.signage, fallback.signage, counts.signage, (s, chosen) =>
    // Only side banners may repeat; every other sign has one place on the course.
    s.prompt.trim() && (s.slot === 'sideBanner' || !chosen.some((c) => c.slot === s.slot)) ? s : null,
  );

  const slots: Slot[] = [
    {
      id: 'skybox',
      kind: 'skybox',
      priority: 1,
      base: 'sky',
      subject: subject(plan.skybox, fallback.skybox),
      aspectRatio: '16:9',
      target: { type: 'skybox' },
    },
  ];
  for (const t of textures) {
    const material = kebab(t.slots[0]);
    slots.push({
      id: `texture-${material}`,
      kind: 'texture',
      priority: t.slots.includes('platformA') ? 2 : 3,
      base: `tex-${material}`,
      subject: t.prompt,
      aspectRatio: '1:1',
      target: { type: 'texture', materials: t.slots },
    });
  }
  sprites.forEach((s, i) => {
    slots.push({
      id: `sprite-${i + 1}`,
      kind: 'sprite',
      priority: 4,
      base: `sprite-${i + 1}`,
      subject: s.prompt,
      aspectRatio: '1:1',
      target: { type: 'sprite', ...s },
    });
  });
  signage.forEach((s, i) => {
    const earlier = signage.slice(0, i).filter((x) => x.slot === s.slot).length;
    const suffix = earlier ? `-${earlier + 1}` : '';
    slots.push({
      id: `signage-${kebab(s.slot)}${suffix}`,
      kind: 'signage',
      priority: 5,
      base: `sign-${kebab(s.slot)}${suffix}`,
      subject: s.prompt,
      aspectRatio: '16:9',
      target: { type: 'signage', sign: s.slot },
    });
  });
  const priorities: Record<ArtKey, number> = { voteCard: 0, reveal: 6, podium: 7 };
  for (const key of counts.art as ArtKey[]) {
    slots.push({
      id: kebab(key),
      kind: 'card',
      priority: priorities[key],
      base: kebab(key),
      subject: subject(plan[key], fallback[key]),
      aspectRatio: '16:9',
      target: { type: 'art', key },
    });
  }
  return slots;
}

/** Does `--slot sprite` or `--slot sprite-2` select this slot? */
export const matchesSlot = (id: string, wanted: string): boolean => id === wanted || id.startsWith(`${wanted}-`);
