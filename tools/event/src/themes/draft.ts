// The schemas the art-direction model answers with (#59). They are deliberately plain: no lengths, ranges,
// tuples or nullable fields, because strict structured outputs reject several of those. clamp.ts turns an
// answer into contract-shaped data and enforces every limit there.
import {
  ACCESSORY_ANCHORS,
  GROUND_KINDS,
  HUD_FONTS,
  LANDMARK_ANCHORS,
  MATERIAL_SLOTS,
  MUSIC_INSTRUMENTS,
  OBSTACLE_KINDS,
  PARTICLE_KINDS,
  SIGNAGE_SLOTS,
  SKIN_EYES,
  SKIN_MOUTHS,
} from '@wobble/shared';
import { z } from 'zod';

const color = z.string().describe('#rrggbb');
const glow = z.string().describe('#rrggbb glow colour, or an empty string for none');
const xyz = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const PRIM_SHAPES = ['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule'] as const;
export const PATTERNS = ['none', 'stripes', 'dots', 'checker', 'zigzag', 'waves'] as const;

const DraftPrim = z.object({
  shape: z.enum(PRIM_SHAPES),
  pos: xyz,
  rot: xyz,
  scale: xyz,
  color,
  emissive: glow,
});

const member = z.object({ name: z.string(), description: z.string() });

export const ImagePlanSchema = z.object({
  skybox: z.string(),
  textures: z.array(z.object({ slots: z.array(z.enum(MATERIAL_SLOTS)), prompt: z.string() })),
  sprites: z.array(
    z.object({
      name: z.string(),
      prompt: z.string(),
      density: z.number(),
      minScale: z.number(),
      maxScale: z.number(),
    }),
  ),
  signage: z.array(z.object({ slot: z.enum(SIGNAGE_SLOTS), prompt: z.string() })),
  voteCard: z.string(),
  reveal: z.string(),
  podium: z.string(),
});
export type ImagePlan = z.infer<typeof ImagePlanSchema>;

/** Call 1: colours, light, ground, effects, music, cast and the image prompts. */
export const LookDraftSchema = z.object({
  name: z.string().describe('theme name, at most 24 characters'),
  title: z.string().describe('vote card title, at most 32 characters'),
  tagline: z.string().describe('one line, at most 80 characters'),
  sky: z.object({ top: color, horizon: color, bottom: color }),
  fog: z.object({ color, near: z.number(), far: z.number() }),
  light: z.object({
    ambient: color,
    ambientIntensity: z.number(),
    sun: color,
    sunIntensity: z.number(),
    sunDir: xyz,
  }),
  materials: z
    .array(
      z.object({
        slot: z.enum(MATERIAL_SLOTS),
        color,
        roughness: z.number(),
        metalness: z.number(),
        emissive: glow,
        pattern: z.enum(PATTERNS),
        patternColors: z.array(color),
        patternScale: z.number(),
      }),
    )
    .describe('exactly one entry per material slot'),
  ground: z.object({ kind: z.enum(GROUND_KINDS), color, emissive: glow, motion: z.number() }),
  particles: z.array(z.object({ kind: z.enum(PARTICLE_KINDS), color, density: z.number(), speed: z.number() })),
  fx: z.object({ confetti: z.array(color), checkpoint: color, hit: color }),
  hud: z.object({ accent: color, font: z.enum(HUD_FONTS) }),
  music: z.object({
    tempo: z.number(),
    scale: z.enum(['major', 'minor', 'pentatonic', 'lydian']),
    energy: z.number().describe('1, 2 or 3'),
    instrument: z.enum(MUSIC_INSTRUMENTS),
    swing: z.number(),
  }),
  cast: z.object({ hero: member, villain: member }),
  images: ImagePlanSchema,
});
export type LookDraft = z.infer<typeof LookDraftSchema>;

/** Call 2: everything built from 3D primitives. */
export const PropsDraftSchema = z.object({
  dressing: z.array(
    z.object({
      kind: z.enum(OBSTACLE_KINDS),
      part: z.number(),
      hideBase: z.boolean(),
      slot: z.enum([...MATERIAL_SLOTS, 'none']),
      prims: z.array(DraftPrim),
    }),
  ),
  landmarks: z.array(
    z.object({ anchor: z.enum(LANDMARK_ANCHORS), name: z.string(), prims: z.array(DraftPrim), scale: z.number() }),
  ),
  decor: z.array(
    z.object({
      name: z.string(),
      prims: z.array(DraftPrim),
      density: z.number(),
      minScale: z.number(),
      maxScale: z.number(),
    }),
  ),
  costume: z.object({
    palette: z.array(color),
    accessories: z.array(z.object({ name: z.string(), anchor: z.enum(ACCESSORY_ANCHORS), prims: z.array(DraftPrim) })),
    eyes: z.array(z.enum(SKIN_EYES)),
    mouths: z.array(z.enum(SKIN_MOUTHS)),
  }),
});
export type PropsDraft = z.infer<typeof PropsDraftSchema>;

export interface Draft {
  look: LookDraft;
  props: PropsDraft;
}
