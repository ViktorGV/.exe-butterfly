import { describe, expect, it } from 'bun:test';
import { createHmac } from 'node:crypto';
import { fixtureSkin, fixtureThemeV2 } from '../fixtures/index.ts';
import { RosterKeySchema, SkinDefSchema } from '../schemas/index.ts';
import { normalizeUsername, randomThemedSkin, rosterKey, skinSignature } from './index.ts';

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

describe('skin seams (stubs until #68)', () => {
  it('skinSignature is stable', () =>
    expect(skinSignature(fixtureSkin)).toBe(skinSignature(structuredClone(fixtureSkin))));
  it('randomThemedSkin returns a valid skin', () => {
    expect(SkinDefSchema.safeParse(randomThemedSkin(fixtureThemeV2.costume, 1)).success).toBe(true);
  });
});
