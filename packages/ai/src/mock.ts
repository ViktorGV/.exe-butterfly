// Deterministic offline outputs for WOBBLE_AI_MOCK=1. Owned by #22.
// Same input -> same output, always valid for the JSON Schema, no network.
import { deflateSync } from 'node:zlib';
import type { JsonSchema } from './jsonSchema.ts';

/** 32-bit FNV-1a over a string, as 8 hex chars. */
export function hashString(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** mulberry32: small seeded PRNG returning floats in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLLABLES = ['wob', 'bly', 'zip', 'pom', 'fiz', 'lu', 'ka', 'mo', 'ri', 'bo', 'tan', 'gle', 'pip', 'sun'];
const HEX_PATTERN = /#\[0-9a-fA-F\]\{6\}|#\[0-9a-f\]\{6\}|#\[0-9A-F\]\{6\}/;

const isObject = (v: unknown): v is JsonSchema => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A value that satisfies `schema` (objects, arrays, enums, const, hex colours, bounded strings and numbers). */
export function mockValue(schema: JsonSchema, rng: () => number): unknown {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)];

  const gen = (s: unknown, depth: number): unknown => {
    if (!isObject(s)) return null;
    if ('const' in s) return s.const;
    if (Array.isArray(s.enum)) return pick(s.enum);
    const branches = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
    if (Array.isArray(branches)) {
      const nonNull = branches.filter((b) => !(isObject(b) && b.type === 'null'));
      return gen(pick(nonNull.length ? nonNull : branches), depth);
    }
    const type = Array.isArray(s.type) ? (s.type.find((t) => t !== 'null') ?? 'null') : s.type;
    switch (type) {
      case 'object':
        return genObject(s, depth);
      case 'array':
        return genArray(s, depth);
      case 'string':
        return genString(s);
      case 'integer':
        return Math.round(genNumber(s));
      case 'number':
        return genNumber(s);
      case 'boolean':
        return rng() < 0.5;
      case 'null':
        return null;
      default:
        return isObject(s.properties) ? genObject(s, depth) : null;
    }
  };

  const genObject = (s: JsonSchema, depth: number) => {
    const out: Record<string, unknown> = {};
    const props = isObject(s.properties) ? s.properties : {};
    const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
    for (const [name, prop] of Object.entries(props)) {
      if (!required.has(name) && rng() < 0.5) continue;
      out[name] = gen(prop, depth + 1);
    }
    return out;
  };

  const genArray = (s: JsonSchema, depth: number) => {
    if (Array.isArray(s.prefixItems)) return (s.prefixItems as unknown[]).map((p) => gen(p, depth + 1));
    const min = typeof s.minItems === 'number' ? s.minItems : 0;
    const max = typeof s.maxItems === 'number' ? s.maxItems : Infinity;
    // Keep mock arrays short so nested totals (e.g. "at most 24 prims") stay small.
    const lo = Math.min(Math.max(min, depth > 3 ? 0 : 1), max);
    const hi = Math.min(max, Math.max(lo, 2));
    const n = lo + Math.floor(rng() * (hi - lo + 1));
    return Array.from({ length: n }, () => gen(s.items, depth + 1));
  };

  const genString = (s: JsonSchema) => {
    if (typeof s.pattern === 'string' && HEX_PATTERN.test(s.pattern)) {
      return (
        '#' +
        Math.floor(rng() * 0xffffff)
          .toString(16)
          .padStart(6, '0')
      );
    }
    const min = typeof s.minLength === 'number' ? s.minLength : 1;
    const max = typeof s.maxLength === 'number' ? s.maxLength : 24;
    let word = '';
    const parts = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < parts; i++) word += pick(SYLLABLES);
    word = word[0].toUpperCase() + word.slice(1);
    while (word.length < min) word += pick(SYLLABLES);
    return word.slice(0, Math.max(min, max));
  };

  const genNumber = (s: JsonSchema) => {
    const min =
      typeof s.minimum === 'number' ? s.minimum : typeof s.exclusiveMinimum === 'number' ? s.exclusiveMinimum : null;
    const max =
      typeof s.maximum === 'number' ? s.maximum : typeof s.exclusiveMaximum === 'number' ? s.exclusiveMaximum : null;
    const lo = min ?? (max !== null ? Math.min(0.5, max - 1) : 0.5);
    const hi = max ?? Math.max(1.5, lo + 1);
    const value = Math.round((lo + rng() * (hi - lo)) * 100) / 100;
    // Rounding can land on an exclusive bound; nudge back inside.
    if (typeof s.exclusiveMinimum === 'number' && value <= s.exclusiveMinimum) return (lo + hi) / 2;
    if (typeof s.exclusiveMaximum === 'number' && value >= s.exclusiveMaximum) return (lo + hi) / 2;
    return value;
  };

  return gen(schema, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// Placeholder images: a seeded two-colour diagonal gradient, encoded as a real PNG.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Pixel size for an aspect ratio like "16:9", longest side `longSide`. */
export function mockImageSize(aspectRatio = '1:1', longSide = 256): { width: number; height: number } {
  const [w, h] = aspectRatio.split(':').map(Number);
  if (!(w > 0) || !(h > 0)) return { width: longSide, height: longSide };
  return w >= h
    ? { width: longSide, height: Math.max(1, Math.round((longSide * h) / w)) }
    : { width: Math.max(1, Math.round((longSide * w) / h)), height: longSide };
}

/** A deterministic RGB gradient PNG for `seed`. */
export function gradientPng(seed: number, width: number, height: number): Uint8Array {
  const rng = createRng(seed);
  const a = [rng(), rng(), rng()].map((v) => 40 + Math.floor(v * 200));
  const b = [rng(), rng(), rng()].map((v) => 40 + Math.floor(v * 200));
  const stride = width * 3 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const t = (x / Math.max(1, width - 1) + y / Math.max(1, height - 1)) / 2;
      const o = y * stride + 1 + x * 3;
      for (let c = 0; c < 3; c++) raw[o + c] = Math.round(a[c] + (b[c] - a[c]) * t);
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, deflate, no filter, no interlace
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
