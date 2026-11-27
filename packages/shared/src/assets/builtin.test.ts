import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { resolveBuiltin } from '../builtins.ts';
import { BUILTIN_COURSE_PACKS, DEFAULT_COURSE_ID } from '../course/recipes/index.ts';
import { fixtureSkinPack, fixtureThemePack } from '../fixtures/index.ts';
import { PackSchema } from '../schemas/packs.ts';
import type { SkinDef, ThemeDef } from '../types.ts';
import { BUILTIN_SKIN_PACKS, BUILTIN_THEME_PACKS, DEFAULT_SKIN_ID, DEFAULT_THEME_ID } from './builtin/index.ts';
import { courseLLMSchema, skinLLMSchema, themeLLMSchema } from './llm.ts';
import { sanitizePack } from './sanitize.ts';
import { skinSwatch, themeSwatch } from './swatch.ts';

const skins = BUILTIN_SKIN_PACKS.filter((p) => p.id !== fixtureSkinPack.id).map((p) => p.data as SkinDef);
const themes = BUILTIN_THEME_PACKS.filter((p) => p.id !== fixtureThemePack.id).map((p) => p.data as ThemeDef);

describe('built-in packs', () => {
  it('has 12 original skins and 4 themes, plus the fixtures', () => {
    expect(skins.length).toBe(12);
    expect(themes.length).toBe(4);
    expect(BUILTIN_SKIN_PACKS).toContain(fixtureSkinPack);
    expect(BUILTIN_THEME_PACKS).toContain(fixtureThemePack);
    for (const id of ['b:candy-workshop', 'b:bathtub-bay', 'b:moonlit-arcade', 'b:garden-party']) {
      expect(resolveBuiltin(id)?.kind).toBe('theme');
    }
  });

  it('every built-in pack is a valid Pack, survives sanitizePack unchanged and resolves', () => {
    for (const pack of [...BUILTIN_SKIN_PACKS, ...BUILTIN_THEME_PACKS, ...BUILTIN_COURSE_PACKS]) {
      expect(PackSchema.safeParse(pack).success).toBe(true);
      const res = sanitizePack(pack.kind, pack.data);
      expect({ id: pack.id, ...res }).toEqual({ id: pack.id, ok: true, data: pack.data, issues: [] });
      expect(resolveBuiltin(pack.id)).toBe(pack);
      expect(pack.name).toBe(pack.data.name);
    }
    const ids = [...BUILTIN_SKIN_PACKS, ...BUILTIN_THEME_PACKS].map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skins cover every face option, pattern type and anchor', () => {
    const shape = skinLLMSchema.shape;
    expect(new Set(skins.map((s) => s.face.eyes))).toEqual(new Set(shape.face.shape.eyes.options));
    expect(new Set(skins.map((s) => s.face.mouth))).toEqual(new Set(shape.face.shape.mouth.options));
    expect(new Set(skins.map((s) => s.face.cheeks === null))).toEqual(new Set([true, false]));
    expect(new Set(skins.map((s) => s.body.pattern.type))).toEqual(
      new Set(['none', 'stripes', 'dots', 'checker', 'zigzag', 'waves', 'custom']),
    );
    expect(new Set(skins.flatMap((s) => s.accessories.map((a) => a.anchor)))).toEqual(
      new Set(['headTop', 'face', 'back', 'waist']),
    );
  });

  it('defaults resolve', () => {
    expect(resolveBuiltin(DEFAULT_SKIN_ID)?.kind).toBe('skin');
    expect(resolveBuiltin(DEFAULT_THEME_ID)?.kind).toBe('theme');
    expect(resolveBuiltin(DEFAULT_COURSE_ID)?.kind).toBe('course');
  });

  it('swatches summarise packs for gallery cards', () => {
    const sw = skinSwatch(skins[0]);
    expect(sw.name).toBe(skins[0].name);
    expect(sw.colors.slice(0, 3)).toEqual([skins[0].body.color, skins[0].body.belly, skins[0].limbs.color]);
    const tw = themeSwatch(themes[0]);
    expect(tw.sky).toEqual([themes[0].sky.top, themes[0].sky.horizon, themes[0].sky.bottom]);
    expect(tw.colors).toHaveLength(5);
  });
});

describe('LLM-facing schemas', () => {
  const schemas = { skin: skinLLMSchema, theme: themeLLMSchema, course: courseLLMSchema };

  for (const [kind, schema] of Object.entries(schemas)) {
    it(`${kind}: non-recursive, every key required, every field described`, () => {
      const json = z.toJSONSchema(schema) as Record<string, unknown>;
      const text = JSON.stringify(json);
      expect(text).not.toContain('$ref');
      expect(text).not.toContain('"version"');
      const walk = (node: unknown, path: string): void => {
        if (!node || typeof node !== 'object') return;
        const n = node as Record<string, unknown>;
        if (n.type === 'object' && n.properties) {
          const props = n.properties as Record<string, unknown>;
          expect({ path, required: n.required }).toEqual({ path, required: Object.keys(props) });
          for (const [k, v] of Object.entries(props)) {
            const d = v as Record<string, unknown>;
            const described = d.description ?? (d.anyOf as Record<string, unknown>[] | undefined)?.[0]?.description;
            expect({ field: `${path}.${k}`, described: typeof described === 'string' }).toEqual({
              field: `${path}.${k}`,
              described: true,
            });
            walk(v, `${path}.${k}`);
          }
        }
        if (n.items) walk(n.items, `${path}[]`);
        if (Array.isArray(n.anyOf)) n.anyOf.forEach((a) => walk(a, path));
      };
      walk(json, kind);
    });
  }

  it('an LLM-shaped answer (nulls for optional fields) sanitizes into a valid pack', () => {
    const skin = {
      name: 'Bolt',
      body: {
        color: '#ff0000',
        belly: '#ffffff',
        pattern: { type: 'dots', colors: ['#ff0000', '#ffffff'], scale: 1, tile: null },
        height: 1,
        girth: 1,
      },
      face: { eyes: 'dot', eyeColor: '#000000', mouth: 'smile', cheeks: null },
      limbs: { color: '#cc0000' },
      accessories: [
        {
          anchor: 'headTop',
          prims: [
            {
              shape: 'cone',
              pos: [0, 0.2, 0],
              rot: [0, 0, 0],
              scale: [0.3, 0.3, 0.3],
              color: '#00ff00',
              emissive: null,
            },
          ],
        },
      ],
    };
    expect(skinLLMSchema.safeParse(skin).success).toBe(true);
    const res = sanitizePack('skin', { version: 1, ...skin });
    expect(res.ok).toBe(true);
    expect((res.data as SkinDef).accessories[0].prims[0]).not.toHaveProperty('emissive');
    expect((res.data as SkinDef).body.pattern).not.toHaveProperty('tile');
  });
});
