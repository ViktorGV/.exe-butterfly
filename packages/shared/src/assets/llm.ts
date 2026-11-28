// LLM-facing schemas (#16) for the generation endpoint (#22). Same shapes as the pack data schemas,
// minus server-set fields (`version`), non-recursive, every key required (optional values are
// `.nullable()`, as strict JSON-schema modes require) and every field described with units, ranges
// and style guidance. Numeric ranges are hints only: sanitizePack clamps whatever comes back.
import { z } from 'zod';
import { MATERIAL_SLOTS, SEGMENT_TYPES } from '../constants.ts';
import type { MaterialSlot } from '../types.ts';

const hex = (what: string) =>
  z.string().describe(`${what}. A colour as #rrggbb. Bright, saturated, toy-like colours read best on a phone screen.`);
const unit = (what: string) => z.number().describe(`${what}. Range 0..1.`);

const vec3 = (what: string, range: string) =>
  z.array(z.number()).describe(`${what}: exactly three numbers [x, y, z]. ${range}`);

const tileShape = z
  .object({
    kind: z.enum(['circle', 'rect', 'poly']).describe('Shape kind.'),
    fill: hex('Fill colour of the shape'),
    x: unit('Centre x in the unit tile (0 = left, 1 = right); shapes crossing an edge wrap around'),
    y: unit('Centre y in the unit tile (0 = top, 1 = bottom)'),
    r: z.number().nullable().describe('circle only: radius in tile units, 0.01..0.5. null for other kinds.'),
    w: z.number().nullable().describe('rect only: width in tile units, 0.01..1. null for other kinds.'),
    h: z.number().nullable().describe('rect only: height in tile units, 0.01..1. null for other kinds.'),
    rot: z.number().nullable().describe('rect/poly: rotation in radians, -3.14..3.14. null for none.'),
    points: z
      .array(z.array(z.number()).describe('[x, y] offset from the centre, each -0.5..0.5'))
      .nullable()
      .describe('poly only: 3 to 16 points, in order around the outline. null for other kinds.'),
  })
  .describe('One flat shape of a custom pattern tile.');

const pattern = z
  .object({
    type: z
      .enum(['none', 'stripes', 'dots', 'checker', 'zigzag', 'waves', 'custom'])
      .describe('Pattern kind. Every kind tiles seamlessly.'),
    colors: z
      .array(hex('Pattern colour'))
      .describe('1 to 4 colours. colors[0] is the background; the others are the motif. Use strong contrast.'),
    scale: z
      .number()
      .describe('Motif size, 0.25 (tiny, busy) .. 4 (huge). 1 = four repeats per tile. Prefer 0.75..1.5.'),
    tile: z
      .array(tileShape)
      .nullable()
      .describe('custom only: up to 24 shapes drawn over colors[0] in a unit square. null for other kinds.'),
  })
  .describe('A flat, tileable 2D pattern.');

const prim = (where: string, extent: string) =>
  z
    .object({
      shape: z
        .enum(['sphere', 'box', 'cylinder', 'cone', 'torus', 'capsule'])
        .describe('Primitive shape, unit size (fits a 1 m cube before scaling).'),
      pos: vec3('Offset in metres', `${where} Each component ${extent}.`),
      rot: vec3('Rotation in radians (Euler XYZ)', 'Each component -3.14..3.14.'),
      scale: vec3('Size in metres along x, y, z', 'Each component 0.01 or more.'),
      color: hex('Colour'),
      emissive: z.string().nullable().describe('Glow colour as #rrggbb, or null for no glow. Use sparingly.'),
    })
    .describe('One coloured primitive.');

export const skinLLMSchema = z
  .object({
    name: z.string().describe('Character name, 1..24 characters, plain text, no markup. Friendly and original.'),
    body: z
      .object({
        color: hex('Main body colour'),
        belly: hex('Belly patch colour; a lighter tint of the body colour works well'),
        pattern: pattern.describe('Pattern printed on the body.'),
        height: z.number().describe('Cosmetic height multiplier, 0.85..1.15. Never changes the hitbox.'),
        girth: z.number().describe('Cosmetic girth multiplier, 0.85..1.15. Never changes the hitbox.'),
      })
      .describe('The round jelly-bean body.'),
    face: z
      .object({
        eyes: z.enum(['dot', 'oval', 'sleepy', 'star', 'wide']).describe('Eye style.'),
        eyeColor: hex('Eye colour; must contrast with the body colour'),
        mouth: z.enum(['smile', 'o', 'flat', 'grin', 'none']).describe('Mouth style.'),
        cheeks: z.string().nullable().describe('Blush colour as #rrggbb, or null for no blush.'),
      })
      .describe('Face drawn on the front of the body.'),
    limbs: z.object({ color: hex('Arm and leg colour') }).describe('Arms and legs.'),
    accessories: z
      .array(
        z
          .object({
            anchor: z.enum(['headTop', 'face', 'back', 'waist']).describe('Where the accessory attaches.'),
            prims: z
              .array(prim('Relative to the anchor.', '-1.2..1.2 m'))
              .describe('1..24 primitives. Everything must fit within 1.2 m of the anchor.'),
          })
          .describe('A hat, mask, backpack, belt or similar.'),
      )
      .describe(
        '0..5 accessories, at most 40 primitives in total. Readable costume pieces (hat, helmet, armour, small cape, gear on the back), never a wall.',
      ),
  })
  .describe('A Wobbler character skin. Original designs only.');

const material = (slot: MaterialSlot, guide: string) =>
  z
    .object({
      color: hex(`Base colour of ${slot}`),
      roughness: unit('Roughness (0 glossy, 1 matte)'),
      metalness: unit('Metalness; keep near 0 for a toy look'),
      emissive: z.string().nullable().describe('Glow colour as #rrggbb, or null.'),
      pattern: pattern.nullable().describe('Optional surface pattern, or null. colors[0] should equal color.'),
    })
    .describe(guide);

const SLOT_GUIDE: Record<MaterialSlot, string> = {
  platformA: 'Main floor. Calm, light colour.',
  platformB: 'Alternate floor. Close in brightness to platformA but a different hue.',
  hazard: 'Things that knock players off (sweepers, pendulums). Hot, saturated, clearly different from every floor.',
  bouncy: 'Bounce pads. Bright and playful, clearly different from floors and hazards.',
  accent: 'Checkpoint pads and highlights.',
  rail: 'Edges and rails.',
  finish: 'Finish pad. A checker pattern reads well.',
};

export const themeLLMSchema = z
  .object({
    name: z.string().describe('Theme name, 1..24 characters, plain text.'),
    sky: z
      .object({
        top: hex('Sky colour overhead'),
        horizon: hex('Sky colour at the horizon'),
        bottom: hex('Colour below the horizon'),
      })
      .describe('Sky gradient.'),
    fog: z
      .object({
        color: hex('Fog colour; usually close to the horizon colour'),
        near: z.number().describe('Distance where fog starts, metres, 10..300.'),
        far: z.number().describe('Distance of full fog, metres, 80..1200, at least near + 60. Never hide the course.'),
      })
      .describe('Distance fog.'),
    light: z
      .object({
        ambient: hex('Ambient light colour'),
        ambientIntensity: z.number().describe('Ambient intensity, 0.2..2.'),
        sun: hex('Sun colour'),
        sunIntensity: z.number().describe('Sun intensity, 0.5..4.'),
        sunDir: vec3('Direction the sunlight travels', 'Each component -1..1; y between -1 and -0.2 (from above).'),
      })
      .describe('Lighting.'),
    materials: z
      .object(Object.fromEntries(MATERIAL_SLOTS.map((slot) => [slot, material(slot, SLOT_GUIDE[slot])])))
      .describe('One material per course slot.'),
    decor: z
      .array(
        z
          .object({
            name: z.string().describe('Prop name, 1..24 characters.'),
            prims: z.array(prim('Relative to the prop origin.', '-10..10 m')).describe('1..12 primitives.'),
            density: unit('How many to scatter off-course'),
            minScale: z.number().describe('Smallest random scale, 0.25..4.'),
            maxScale: z.number().describe('Largest random scale, minScale..4.'),
          })
          .describe('A scenery prop scattered beside the course, never on it.'),
      )
      .describe('0..6 decor props.'),
    music: z
      .object({
        tempo: z.number().describe('Beats per minute, 70..180.'),
        scale: z.enum(['major', 'minor', 'pentatonic', 'lydian']).describe('Musical scale.'),
        energy: z.number().describe('Energy level: 1, 2 or 3.'),
      })
      .describe('Procedural music settings.'),
  })
  .describe('A course theme: sky, light, materials, decor and music. Original designs only.');

export const courseLLMSchema = z
  .object({
    name: z.string().describe('Course name, 1..48 characters, plain text.'),
    seed: z.number().describe('Random seed, an integer 0..2147483647.'),
    segments: z
      .array(
        z
          .object({
            type: z.enum(SEGMENT_TYPES).describe('Segment kind.'),
            length: z.enum(['short', 'medium', 'long']).describe('Segment length.'),
            intensity: z.number().describe('Difficulty, an integer 1..5.'),
          })
          .describe('One course segment.'),
      )
      .describe('4..12 segments in running order. Start gentle, build up.'),
  })
  .describe('A course recipe; the assembler turns it into a playable course.');
