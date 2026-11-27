// SEAM. Seeded by #54. `normalizeUsername` and `rosterKey` are real and frozen: the event
// pipeline (#63) and the game server (#68) must derive identical keys. `skinSignature` and
// `randomThemedSkin` are stubs that #68 replaces.
import { LIMITS } from '../constants.ts';
import { fixtureSkin } from '../fixtures/index.ts';
import type { CostumeKit, SkinDef } from '../types.ts';

/**
 * Canonical form of a username: Unicode NFKC, trimmed, inner whitespace collapsed to one space,
 * lower-case, one leading `@` removed, cut to LIMITS.nameMax characters.
 */
export function normalizeUsername(name: string): string {
  const s = name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase().replace(/^@/, '').trim();
  return Array.from(s).slice(0, LIMITS.nameMax).join('');
}

/**
 * Roster key for a username: the first 32 hex chars of HMAC-SHA256(secret, normalizeUsername(name)).
 * Uses Web Crypto, so it runs the same in Bun, the tools and browsers.
 */
export async function rosterKey(secret: string, name: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(normalizeUsername(name))));
  let hex = '';
  for (let i = 0; i < 16; i++) hex += sig[i]!.toString(16).padStart(2, '0');
  return hex;
}

/**
 * A short string that is equal for two skins that look the same.
 * STUB: FNV-1a of the JSON. #68 replaces it with a version that quantises colours.
 */
export function skinSignature(skin: SkinDef): string {
  const s = JSON.stringify(skin);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A deterministic random skin built from a theme's costume kit. Must give byte-identical
 * output for the same (costume, seed) in Bun and browsers (no Math.random).
 * STUB: returns fixtureSkin. #68 replaces it.
 */
export function randomThemedSkin(_costume: CostumeKit, _seed: number): SkinDef {
  return structuredClone(fixtureSkin);
}
