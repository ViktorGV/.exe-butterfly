// SEAM. Seeded by #54. `normalizeUsername` and `rosterKey` are real and frozen: the event
// pipeline (#63) and the game server (#68) must derive identical keys. `skinSignature` and
// `randomThemedSkin` are implemented by #68 (integer maths only: byte-identical in Bun and browsers).
import { LIMITS } from '../constants.ts';
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

// ---- skin signatures ------------------------------------------------------------------------

/** Quantise `#rrggbb` to 4 bits per channel, so invisible shade differences look the same. */
function q(hex: string | null | undefined): string {
  if (!hex) return '-';
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 20) & 15).toString(16) + ((n >> 12) & 15).toString(16) + ((n >> 4) & 15).toString(16);
}

/**
 * A short string that is equal for two skins that look the same: quantised colours, pattern
 * type, face and accessory shapes. Names, exact sizes and positions are ignored.
 */
export function skinSignature(skin: SkinDef): string {
  const b = skin.body;
  const f = skin.face;
  const acc = skin.accessories
    .map((a) => a.anchor + ':' + a.prims.map((p) => p.shape.slice(0, 2) + q(p.color)).join(','))
    .sort()
    .join('|');
  return [
    q(b.color),
    q(b.belly),
    b.pattern.type + b.pattern.colors.map(q).join(''),
    q(skin.limbs.color),
    f.eyes,
    q(f.eyeColor),
    f.mouth,
    q(f.cheeks),
    acc,
  ].join('/');
}

// ---- procedural themed skins ----------------------------------------------------------------

/** mulberry32: integer-only PRNG, identical in every JS engine. Returns an int in [0, n). */
function prng(seed: number): (n: number) => number {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
}

/** Shade a colour with integer maths: k 0 = base, 1..2 lighter, 3..4 darker. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  let out = '#';
  for (const sh of [16, 8, 0]) {
    const c = (n >> sh) & 255;
    const v = k === 0 ? c : k <= 2 ? c + (((255 - c) * k) >> 2) : c - ((c * (k - 2)) >> 2);
    out += v.toString(16).padStart(2, '0');
  }
  return out;
}

const PATTERNS = ['none', 'stripes', 'dots', 'checker', 'zigzag', 'waves'] as const;
const SIZES = [0.9, 0.95, 1, 1.05, 1.1] as const;
const PATTERN_SCALES = [0.75, 1, 1.25, 1.5] as const;
const EYE_COLORS = ['#1d1b2f', '#2b2340', '#10243a', '#3a1f1a', '#ffffff'] as const;
const NAME_A = ['Bo', 'Zi', 'Pu', 'Ka', 'Lo', 'Mi', 'Fen', 'Ru', 'Tak', 'Nim', 'Wo', 'Sa'] as const;
const NAME_B = ['bble', 'zo', 'mp', 'ki', 'lly', 'po', 'ndo', 'rk', 'sh', 'ty', 'gle', 'mo'] as const;

/**
 * A deterministic random skin built from a theme's costume kit: palette shades for body, belly,
 * limbs and pattern, the kit's eyes and mouths, and 1 to 3 kit accessories (distinct anchors,
 * at most 24 prims) recoloured. Same (costume, seed) gives byte-identical JSON everywhere.
 */
export function randomThemedSkin(costume: CostumeKit, seed: number): SkinDef {
  const r = prng(seed);
  const pal = costume.palette;
  const col = () => shade(pal[r(pal.length)]!, r(5));
  const body = col();
  const accent = col();
  const want = 1 + r(3);
  const order = costume.accessories.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = r(i + 1);
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  const accessories: SkinDef['accessories'] = [];
  const anchors = new Set<string>();
  let prims = 0;
  for (const i of order) {
    if (accessories.length >= want) break;
    const a = costume.accessories[i]!;
    if (anchors.has(a.anchor) || prims + a.prims.length > 24) continue;
    anchors.add(a.anchor);
    prims += a.prims.length;
    const c = pal[r(pal.length)]!;
    const k = r(5);
    accessories.push({
      anchor: a.anchor,
      prims: a.prims.map((p, pi) => ({
        shape: p.shape,
        pos: [p.pos[0], p.pos[1], p.pos[2]],
        rot: [p.rot[0], p.rot[1], p.rot[2]],
        scale: [p.scale[0], p.scale[1], p.scale[2]],
        color: shade(c, (k + pi) % 5),
        ...(p.emissive ? { emissive: p.emissive } : {}),
      })),
    });
  }
  const belly = shade(pal[r(pal.length)]!, 1 + r(2));
  const type = PATTERNS[r(PATTERNS.length)]!;
  const scale = PATTERN_SCALES[r(PATTERN_SCALES.length)]!;
  const height = SIZES[r(SIZES.length)]!;
  const girth = SIZES[r(SIZES.length)]!;
  const eyes = costume.eyes[r(costume.eyes.length)]!;
  const eyeColor = EYE_COLORS[r(EYE_COLORS.length)]!;
  const mouth = costume.mouths[r(costume.mouths.length)]!;
  const cheekPick = r(pal.length + 1);
  const limbs = shade(body, 3 + r(2));
  const name = NAME_A[r(NAME_A.length)]! + NAME_B[r(NAME_B.length)]! + ' ' + ((seed >>> 0) % 1000);
  return {
    version: 1,
    name,
    body: { color: body, belly, pattern: { type, colors: [body, accent], scale }, height, girth },
    face: { eyes, eyeColor, mouth, cheeks: cheekPick === pal.length ? null : shade(pal[cheekPick]!, 1) },
    limbs: { color: limbs },
    accessories,
  };
}

// ---- procedural skin ids --------------------------------------------------------------------

/** Theme id (`e:<slug>`) -> the slug used in `r:` ids, or null if it doesn't fit (48 chars max). */
export function themeSlug(themeId: string): string | null {
  const slug = themeId.replace(/^[a-z]:/, '');
  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(slug) ? slug : null;
}

/** `r:<themeSlug>:<seed>` */
export function randomSkinId(slug: string, seed: number): string {
  return `r:${slug}:${seed >>> 0}`;
}

/** Parse `r:<themeSlug>:<seed>`; null if `id` isn't one. */
export function parseRandomSkinId(id: string): { slug: string; seed: number } | null {
  const m = /^r:([a-z0-9][a-z0-9-]{0,47}):([0-9]{1,10})$/.exec(id);
  return m ? { slug: m[1]!, seed: Number(m[2]) >>> 0 } : null;
}
