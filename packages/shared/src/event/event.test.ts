import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { fixtureSkin, fixtureThemeV2 } from '../fixtures/index.ts';
import { RosterKeySchema, SkinDefSchema } from '../schemas/index.ts';
import { sanitizePack } from '../assets/index.ts';
import {
  normalizeUsername,
  parseRandomSkinId,
  randomSkinId,
  randomThemedSkin,
  rosterKey,
  skinSignature,
  themeSlug,
} from './index.ts';

describe('normalizeUsername', () => {
  it('lower-cases and trims', () => expect(normalizeUsername('  Pip  ')).toBe('pip'));
  it('collapses inner whitespace', () => expect(normalizeUsername('big   \t wobbler')).toBe('big wobbler'));
  it('strips one leading @', () => {
    expect(normalizeUsername('@Pip')).toBe('pip');
    expect(normalizeUsername('@@pip')).toBe('@pip');
  });
  it('folds Unicode look-alikes with NFKC', () => {
    expect(normalizeUsername('ＰＩＰ')).toBe('pip'); // fullwidth letters
    expect(normalizeUsername('ﬁsh')).toBe('fish'); // ligature
  });
  it('cuts to 16 characters', () => expect(normalizeUsername('a'.repeat(40))).toHaveLength(16));
  it('counts code points, not UTF-16 units', () =>
    expect(Array.from(normalizeUsername('🦋'.repeat(20)))).toHaveLength(16));
});

describe('rosterKey', () => {
  it('is a 32-char hex key', async () => {
    expect(RosterKeySchema.safeParse(await rosterKey('secret', 'Pip')).success).toBe(true);
  });
  it('is equal for equivalent usernames and differs by secret', async () => {
    expect(await rosterKey('s', ' @PIP ')).toBe(await rosterKey('s', 'pip'));
    expect(await rosterKey('s1', 'pip')).not.toBe(await rosterKey('s2', 'pip'));
  });
  it('matches HMAC-SHA256 from node:crypto (first 16 bytes)', async () => {
    const expected = createHmac('sha256', 'key').update('pip').digest('hex').slice(0, 32);
    expect(await rosterKey('key', 'PIP')).toBe(expected);
  });
});

const kit = fixtureThemeV2.costume;
const richKit = {
  palette: ['#e63946', '#f1faee', '#a8dadc', '#457b9d', '#1d3557', '#ffb703'],
  accessories: [
    ...kit.accessories,
    { name: 'Bow', anchor: 'face' as const, prims: [{ ...kit.accessories[0]!.prims[0]!, shape: 'torus' as const }] },
    { name: 'Cape', anchor: 'back' as const, prims: [{ ...kit.accessories[0]!.prims[0]!, shape: 'box' as const }] },
    {
      name: 'Belt',
      anchor: 'waist' as const,
      prims: [{ ...kit.accessories[0]!.prims[0]!, shape: 'cylinder' as const }],
    },
  ],
  eyes: ['dot' as const, 'star' as const, 'wide' as const],
  mouths: ['smile' as const, 'o' as const],
};

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

describe('skinSignature', () => {
  it('is stable across clones', () =>
    expect(skinSignature(fixtureSkin)).toBe(skinSignature(structuredClone(fixtureSkin))));
  it('ignores invisible shade differences and the name', () => {
    const b = structuredClone(fixtureSkin);
    b.body.color = '#ff8b3e';
    b.name = 'Other';
    expect(skinSignature(b)).toBe(skinSignature(fixtureSkin));
  });
  it('sees visible colour, face and accessory shape changes', () => {
    const sig = skinSignature(fixtureSkin);
    const c = structuredClone(fixtureSkin);
    c.body.color = '#3d8aff';
    const e = structuredClone(fixtureSkin);
    e.face.eyes = 'star';
    const a = structuredClone(fixtureSkin);
    a.accessories[0]!.prims[0]!.shape = 'box';
    for (const s of [c, e, a]) expect(skinSignature(s)).not.toBe(sig);
  });
});

describe('randomThemedSkin', () => {
  it('is deterministic for (costume, seed) and never uses Math.random', () => {
    const orig = Math.random;
    Math.random = () => {
      throw new Error('Math.random used');
    };
    try {
      for (const seed of [0, 1, 42, 4294967295])
        expect(JSON.stringify(randomThemedSkin(kit, seed))).toBe(
          JSON.stringify(randomThemedSkin(structuredClone(kit), seed)),
        );
    } finally {
      Math.random = orig;
    }
  });
  it('matches a pinned golden digest (guards byte-identical output across engines)', () => {
    let all = '';
    for (let s = 0; s < 200; s++) all += JSON.stringify(randomThemedSkin(richKit, s));
    expect(fnv(all)).toBe('3b09bd36');
  });
  it('always passes the schema and the sanitizer', () => {
    for (let s = 0; s < 2000; s++) {
      for (const k of [kit, richKit]) {
        const skin = randomThemedSkin(k, s * 7919);
        expect(SkinDefSchema.safeParse(skin).success).toBe(true);
        expect(sanitizePack('skin', skin).ok).toBe(true);
        expect(skin.accessories.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('10,000 seeds give at least 9,900 distinct signatures (even with the minimal fixture kit)', () => {
    for (const k of [kit, richKit]) {
      const sigs = new Set<string>();
      for (let s = 0; s < 10_000; s++) sigs.add(skinSignature(randomThemedSkin(k, s)));
      expect(sigs.size).toBeGreaterThanOrEqual(9_900);
    }
  });
});

describe('random skin ids', () => {
  it('round-trips r:<slug>:<seed>', () => {
    const slug = themeSlug('e:theme-fixture-1')!;
    expect(slug).toBe('theme-fixture-1');
    expect(parseRandomSkinId(randomSkinId(slug, 123))).toEqual({ slug, seed: 123 });
    expect(parseRandomSkinId('e:nope')).toBeNull();
    expect(themeSlug('e:' + 'a'.repeat(60))).toBeNull();
  });
});
