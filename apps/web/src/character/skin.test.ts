import { describe, expect, it } from 'bun:test';
import { fixtureSkin } from '@wobble/shared';
import type { SkinDef } from '@wobble/shared/types';
import { DEFAULT_PARAMS, SKIN_LIMITS, bodyKey, detailKey, normalizeSkin } from './skin.ts';

const clone = (): SkinDef => structuredClone(fixtureSkin);

describe('normalizeSkin: SkinDef to parameters', () => {
  it('keeps every valid fixture field', () => {
    const p = normalizeSkin(fixtureSkin);
    expect(p.name).toBe('Pip');
    expect(p.body).toEqual({
      color: '#ff8a3d',
      belly: '#ffe4b8',
      pattern: { type: 'dots', colors: ['#ff8a3d', '#ffd166'], scale: 1 },
      height: 1,
      girth: 1,
    });
    expect(p.face).toEqual({ eyes: 'oval', eyeColor: '#1d1b2f', mouth: 'smile', cheeks: '#ff6b8b' });
    expect(p.limbs.color).toBe('#e8702b');
    expect(p.accessories).toHaveLength(1);
    expect(p.accessories[0].anchor).toBe('headTop');
    expect(p.accessories[0].prims[0]).toEqual({
      shape: 'cone',
      pos: [0, 0.18, 0],
      rot: [0, 0, 0],
      scale: [0.28, 0.36, 0.28],
      color: '#4cc9f0',
      emissive: null,
    });
  });

  it('lower-cases colours and clamps height and girth to the cosmetic range', () => {
    const s = clone();
    s.body.color = '#AABBCC';
    s.body.height = 3;
    s.body.girth = 0.1;
    const p = normalizeSkin(s);
    expect(p.body.color).toBe('#aabbcc');
    expect(p.body.height).toBe(SKIN_LIMITS.maxScale);
    expect(p.body.girth).toBe(SKIN_LIMITS.minScale);
  });

  it('passes every face variant through', () => {
    for (const eyes of ['dot', 'oval', 'sleepy', 'star', 'wide'] as const) {
      for (const mouth of ['smile', 'o', 'flat', 'grin', 'none'] as const) {
        const s = clone();
        s.face = { eyes, mouth, eyeColor: '#123456', cheeks: null };
        expect(normalizeSkin(s).face).toEqual({ eyes, mouth, eyeColor: '#123456', cheeks: null });
      }
    }
  });

  it('keeps at most 3 accessories and 24 prims in total', () => {
    const prim = fixtureSkin.accessories[0].prims[0];
    const s = clone();
    s.accessories = [0, 1, 2, 3, 4].map(() => ({ anchor: 'back' as const, prims: Array(10).fill(prim) }));
    const p = normalizeSkin(s);
    expect(p.accessories.length).toBeLessThanOrEqual(SKIN_LIMITS.maxAccessories);
    expect(p.accessories.reduce((n, a) => n + a.prims.length, 0)).toBe(SKIN_LIMITS.maxPrims);
  });

  it('keeps emissive prims and drops black emissive', () => {
    const s = clone();
    s.accessories[0].prims[0].emissive = '#FF0000';
    s.accessories[0].prims[1].emissive = '#000000';
    const p = normalizeSkin(s);
    expect(p.accessories[0].prims[0].emissive).toBe('#ff0000');
    expect(p.accessories[0].prims[1].emissive).toBeNull();
  });
});

describe('normalizeSkin: broken skins fall back to defaults', () => {
  it('never throws, whatever it is given', () => {
    for (const bad of [null, undefined, 42, 'skin', [], {}, { body: null, face: 7, limbs: [], accessories: {} }]) {
      expect(() => normalizeSkin(bad)).not.toThrow();
      const p = normalizeSkin(bad);
      expect(p.body.color).toBe(DEFAULT_PARAMS.body.color);
      expect(p.face.eyes).toBe(DEFAULT_PARAMS.face.eyes);
      expect(p.accessories).toEqual([]);
    }
  });

  it('replaces each invalid field on its own', () => {
    const p = normalizeSkin({
      name: '',
      body: { color: 'red', belly: '#12345', pattern: { type: 'plaid', colors: ['nope'], scale: NaN }, height: NaN },
      face: { eyes: 'laser', eyeColor: 5, mouth: 'fangs', cheeks: 'pink' },
      limbs: { color: '#00ff00' },
      accessories: [
        { anchor: 'tail', prims: [{ shape: 'box', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], color: '#fff' }] },
        { anchor: 'waist', prims: [{ shape: 'teapot' }, { shape: 'box', pos: [9, NaN], scale: [-1, 50, 0.3] }] },
      ],
    });
    expect(p.name).toBe(DEFAULT_PARAMS.name);
    expect(p.body.color).toBe(DEFAULT_PARAMS.body.color);
    expect(p.body.belly).toBe(DEFAULT_PARAMS.body.belly);
    expect(p.body.pattern).toEqual({ type: 'none', colors: [DEFAULT_PARAMS.body.color], scale: 1 });
    expect(p.body.height).toBe(1);
    expect(p.body.girth).toBe(1);
    expect(p.face).toEqual({ ...DEFAULT_PARAMS.face, cheeks: null });
    expect(p.limbs.color).toBe('#00ff00');
    expect(p.accessories).toHaveLength(1);
    expect(p.accessories[0].anchor).toBe('waist');
    expect(p.accessories[0].prims).toEqual([
      {
        shape: 'box',
        pos: [SKIN_LIMITS.maxPrimOffset, 0, 0],
        rot: [0, 0, 0],
        scale: [SKIN_LIMITS.minPrimScale, SKIN_LIMITS.maxPrimScale, 0.3],
        color: '#ffffff',
        emissive: null,
      },
    ]);
  });
});

describe('cache keys', () => {
  it('match for equal skins and differ when a field that changes the look differs', () => {
    const a = normalizeSkin(fixtureSkin);
    const b = normalizeSkin(clone());
    expect(bodyKey(a)).toBe(bodyKey(b));
    expect(detailKey(a)).toBe(detailKey(b));
    const s = clone();
    s.face.mouth = 'grin';
    s.limbs.color = '#000000';
    const c = normalizeSkin(s);
    expect(bodyKey(c)).toBe(bodyKey(a));
    expect(detailKey(c)).not.toBe(detailKey(a));
  });
});
