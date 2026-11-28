import { describe, expect, it } from 'bun:test';
import { LIMITS } from '../constants.ts';
import { fixtureRecipe, fixtureSkin, fixtureTheme } from '../fixtures/index.ts';
import type { CourseRecipe, SkinDef, ThemeDef } from '../types.ts';
import { colorDistance } from './color.ts';
import { cleanName, PACK_RULES, packBytes, sanitizePack, SURFACE_SLOTS } from './sanitize.ts';

const clone = <T>(v: T): T => structuredClone(v);

function skinOf(data: unknown): SkinDef {
  const res = sanitizePack('skin', data);
  if (!res.ok) throw new Error(res.issues.join('; '));
  return res.data as SkinDef;
}
function themeOf(data: unknown): ThemeDef {
  const res = sanitizePack('theme', data);
  if (!res.ok) throw new Error(res.issues.join('; '));
  return res.data as ThemeDef;
}

const reach = (p: { pos: number[]; scale: number[] }): number =>
  Math.hypot(p.pos[0], p.pos[1], p.pos[2]) + Math.hypot(p.scale[0], p.scale[1], p.scale[2]) / 2;

describe('sanitizePack basics', () => {
  it('passes valid fixtures through unchanged with no issues', () => {
    expect(sanitizePack('skin', fixtureSkin)).toEqual({ ok: true, data: fixtureSkin, issues: [] });
    expect(sanitizePack('theme', fixtureTheme)).toEqual({ ok: true, data: fixtureTheme, issues: [] });
    expect(sanitizePack('course', fixtureRecipe)).toEqual({ ok: true, data: fixtureRecipe, issues: [] });
  });

  it('is unrecoverable only for non-objects, a wrong version or an unknown kind', () => {
    for (const bad of [null, 1, 'x', [], {}, { version: 2 }]) expect(sanitizePack('skin', bad).ok).toBe(false);
    expect(sanitizePack('nope' as 'skin', { version: 1 }).ok).toBe(false);
    expect(sanitizePack('toString' as 'skin', { version: 1 }).ok).toBe(false);
    expect(sanitizePack('skin', { version: 1 }).ok).toBe(true);
    expect(sanitizePack('theme', { version: 1 }).ok).toBe(true);
    expect(sanitizePack('course', { version: 1 }).ok).toBe(true);
  });

  it('clamps numbers to their documented ranges', () => {
    const s = clone(fixtureSkin) as SkinDef;
    s.body.height = 9;
    s.body.girth = -3;
    s.body.pattern.scale = 1e9;
    const out = skinOf(s);
    expect(out.body.height).toBe(1.15);
    expect(out.body.girth).toBe(0.85);
    expect(out.body.pattern.scale).toBe(4);

    const t = clone(fixtureTheme) as ThemeDef;
    t.materials.platformA.roughness = 7;
    t.materials.platformA.metalness = -1;
    t.music.tempo = 999;
    t.music.energy = 7 as 3;
    t.decor[0].density = 4;
    t.decor[0].minScale = 3;
    t.decor[0].maxScale = 1;
    const th = themeOf(t);
    expect(th.materials.platformA).toMatchObject({ roughness: 1, metalness: 0 });
    expect(th.music).toMatchObject({ tempo: 180, energy: 3 });
    expect(th.decor[0]).toMatchObject({ density: 1, minScale: 3, maxScale: 3 });
  });

  it('normalises colours to lower-case #rrggbb and falls back on junk', () => {
    const s = clone(fixtureSkin) as SkinDef;
    s.body.color = '#ABC';
    s.body.belly = 'FFEEDD';
    s.limbs.color = 'red; background:url(x)';
    s.face.cheeks = 'nope';
    const out = skinOf(s);
    expect(out.body.color).toBe('#aabbcc');
    expect(out.body.belly).toBe('#ffeedd');
    expect(out.limbs.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(out.face.cheeks).toBeNull();
  });

  it('caps counts: 5 accessories, 40 prims, 6 decor, 24 tile shapes, 12 segments', () => {
    const prim = fixtureSkin.accessories[0].prims[0];
    const s = clone(fixtureSkin) as SkinDef;
    s.accessories = Array.from({ length: 5 }, () => ({ anchor: 'back' as const, prims: Array(10).fill(prim) }));
    s.body.pattern = {
      type: 'custom',
      colors: ['#ffffff'],
      scale: 1,
      tile: Array(40).fill({ kind: 'circle', fill: '#000000', x: 0.5, y: 0.5, r: 0.1 }),
    };
    const out = skinOf(s);
    expect(out.accessories.length).toBe(4);
    expect(out.accessories.reduce((n, a) => n + a.prims.length, 0)).toBe(40);
    expect(out.body.pattern.tile?.length).toBe(24);

    const t = clone(fixtureTheme) as ThemeDef;
    t.decor = Array(10).fill(fixtureTheme.decor[0]);
    expect(themeOf(t).decor.length).toBe(6);

    const r = clone(fixtureRecipe) as CourseRecipe;
    r.segments = Array(20).fill(fixtureRecipe.segments[0]);
    const course = sanitizePack('course', r);
    expect(course.ok && (course.data as CourseRecipe).segments.length).toBe(12);
  });

  it('trims names to 24 characters and strips control characters and markup', () => {
    expect(cleanName('<b>Bold</b> <script>alert(1)</script>Pip', 24, 'x')).toBe('Bold alert(1) Pip');
    expect(cleanName('a\u0000b‮c​d\n\te', 24, 'x')).toBe('abcd e');
    expect(cleanName('<<<>>>', 24, 'Fallback')).toBe('Fallback');
    expect(cleanName('😀'.repeat(30), 24, 'x')).toBe('😀'.repeat(24));
    const out = skinOf({ ...fixtureSkin, name: 'A very long name that keeps going and going' });
    expect(out.name.length).toBeLessThanOrEqual(24);
    expect(out.name).toBe('A very long name that ke');
  });

  it('is idempotent', () => {
    const messy = {
      ...clone(fixtureTheme),
      name: ' <i>Messy</i>\u0007 ',
      fog: { color: '#ABC', near: 500, far: 1 },
    };
    const once = sanitizePack('theme', messy);
    expect(once.ok).toBe(true);
    const twice = sanitizePack('theme', once.data);
    expect(twice).toEqual({ ok: true, data: once.data as ThemeDef, issues: [] });
  });

  it('keeps every pack under LIMITS.packMaxBytes by dropping tile shapes, decor, then prims', () => {
    const fat = clone(fixtureTheme) as ThemeDef;
    const poly = {
      kind: 'poly' as const,
      fill: '#123456',
      x: 0.123,
      y: 0.456,
      rot: 1.234,
      points: Array.from({ length: 16 }, (_, i) => [0.111 + i / 100, -0.222] as [number, number]),
    };
    for (const slot of Object.keys(fat.materials) as (keyof ThemeDef['materials'])[]) {
      fat.materials[slot].pattern = {
        type: 'custom',
        colors: [fat.materials[slot].color],
        scale: 1,
        tile: Array(24).fill(poly),
      };
    }
    fat.decor = Array(6).fill({ ...fixtureTheme.decor[0], prims: Array(12).fill(fixtureTheme.decor[0].prims[0]) });
    expect(packBytes(fat)).toBeGreaterThan(LIMITS.packMaxBytes);
    const res = sanitizePack('theme', fat);
    expect(res.ok).toBe(true);
    expect(packBytes(res.data)).toBeLessThanOrEqual(LIMITS.packMaxBytes);
    expect(res.issues.some((i) => i.startsWith('pack:'))).toBe(true);
    expect((res.data as ThemeDef).decor.length).toBe(6); // tile shapes go first
  });

  it('sanitizes course recipes: drops unknown segments, pads to 4, clamps intensity and seed', () => {
    const res = sanitizePack('course', {
      version: 1,
      name: '<h1>Hi</h1>',
      seed: -12.7,
      segments: [
        { type: 'lava', length: 'short', intensity: 2 },
        { type: 'gateDash', length: 'huge', intensity: 99 },
      ],
    });
    expect(res.ok).toBe(true);
    const r = res.data as CourseRecipe;
    expect(r.name).toBe('Hi');
    expect(r.seed).toBe(13);
    expect(r.segments[0]).toEqual({ type: 'gateDash', length: 'medium', intensity: 5 });
    expect(r.segments.length).toBe(4);
  });
});

describe('fairness rules', () => {
  it('accessories stay inside a 1.2 m sphere around their anchor (far-away prim pulled in)', () => {
    const s = clone(fixtureSkin) as SkinDef;
    s.accessories[0].prims[0].pos = [50, 50, 50];
    const out = skinOf(s);
    for (const p of out.accessories[0].prims) expect(reach(p)).toBeLessThanOrEqual(PACK_RULES.accessoryRadius);
  });

  it('a wall-sized prim is shrunk to fit the sphere (no walls, no cloaks)', () => {
    const s = clone(fixtureSkin) as SkinDef;
    s.accessories[0].prims[0].scale = [40, 40, 0.1];
    s.accessories[0].prims[0].pos = [0, 0.5, 0];
    const out = skinOf(s);
    const p = out.accessories[0].prims[0];
    expect(reach(p)).toBeLessThanOrEqual(PACK_RULES.accessoryRadius);
    expect(Math.max(...p.scale)).toBeLessThan(2.4);
  });

  it('height and girth stay cosmetic (0.85..1.15)', () => {
    const out = skinOf({ ...fixtureSkin, body: { ...fixtureSkin.body, height: 100, girth: 0 } });
    expect(out.body.height).toBe(1.15);
    expect(out.body.girth).toBe(0.85);
  });
});

describe('legibility rules', () => {
  const minToSurfaces = (t: ThemeDef, hex: string) =>
    Math.min(...SURFACE_SLOTS.map((s) => colorDistance(hex, t.materials[s].color)));

  it('a hazard that matches a platform is recoloured', () => {
    const t = clone(fixtureTheme) as ThemeDef;
    t.materials.hazard.color = t.materials.platformA.color;
    const out = themeOf(t);
    expect(out.materials.hazard.color).not.toBe(t.materials.platformA.color);
    expect(minToSurfaces(out, out.materials.hazard.color)).toBeGreaterThanOrEqual(PACK_RULES.minSlotDistance);
    expect(out.materials.hazard.pattern?.colors[0]).toBe(out.materials.hazard.color);
  });

  it('a bouncy pad that matches a platform or the hazard is recoloured', () => {
    const t = clone(fixtureTheme) as ThemeDef;
    t.materials.bouncy.color = '#7bd8ff'; // nearly platformA
    let out = themeOf(t);
    expect(minToSurfaces(out, out.materials.bouncy.color)).toBeGreaterThanOrEqual(PACK_RULES.minSlotDistance);
    t.materials.bouncy.color = t.materials.hazard.color;
    out = themeOf(t);
    expect(colorDistance(out.materials.bouncy.color, out.materials.hazard.color)).toBeGreaterThanOrEqual(
      PACK_RULES.minSlotDistance,
    );
  });

  it('an all-grey theme still ends up with distinct hazard and bouncy slots', () => {
    const grey = { color: '#808080', roughness: 0.5, metalness: 0 };
    const t = {
      ...clone(fixtureTheme),
      materials: Object.fromEntries(Object.keys(fixtureTheme.materials).map((k) => [k, grey])),
    };
    const out = themeOf(t);
    expect(minToSurfaces(out, out.materials.hazard.color)).toBeGreaterThanOrEqual(PACK_RULES.minSlotDistance);
    expect(minToSurfaces(out, out.materials.bouncy.color)).toBeGreaterThanOrEqual(PACK_RULES.minSlotDistance);
    expect(colorDistance(out.materials.bouncy.color, out.materials.hazard.color)).toBeGreaterThanOrEqual(
      PACK_RULES.minSlotDistance,
    );
  });

  it('fog never hides the course', () => {
    const out = themeOf({ ...fixtureTheme, fog: { color: '#ffffff', near: 0, far: 1 } });
    expect(out.fog.near).toBeGreaterThanOrEqual(PACK_RULES.fogNear[0]);
    expect(out.fog.far).toBeGreaterThanOrEqual(out.fog.near + PACK_RULES.fogMinSpan);
    expect(out.fog.far).toBeGreaterThanOrEqual(PACK_RULES.fogFar[0]);
  });

  it('sun and ambient intensity stay sane and the sun shines from above', () => {
    const out = themeOf({
      ...fixtureTheme,
      light: { ...fixtureTheme.light, sunIntensity: 1000, ambientIntensity: 0, sunDir: [0, 5, 0] },
    });
    expect(out.light.sunIntensity).toBe(4);
    expect(out.light.ambientIntensity).toBe(0.2);
    expect(out.light.sunDir[1]).toBe(-0.2);
    expect(themeOf({ ...fixtureTheme, light: { ...fixtureTheme.light, sunIntensity: 0 } }).light.sunIntensity).toBe(
      0.5,
    );
  });

  it('eyes always contrast with the body', () => {
    const out = skinOf({ ...fixtureSkin, face: { ...fixtureSkin.face, eyeColor: fixtureSkin.body.color } });
    expect(colorDistance(out.face.eyeColor, out.body.color)).toBeGreaterThanOrEqual(PACK_RULES.minEyeDistance);
    const dark = skinOf({
      ...fixtureSkin,
      body: { ...fixtureSkin.body, color: '#101010' },
      face: { ...fixtureSkin.face, eyeColor: '#111111' },
    });
    expect(dark.face.eyeColor).toBe('#ffffff');
  });
});
