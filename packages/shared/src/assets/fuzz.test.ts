import { describe, expect, it } from 'bun:test';
import { LIMITS } from '../constants.ts';
import { fixtureRecipe, fixtureSkin, fixtureTheme } from '../fixtures/index.ts';
import { PACK_DATA_SCHEMAS } from '../schemas/packs.ts';
import type { PackKind } from '../types.ts';
import { packBytes, sanitizePack } from './sanitize.ts';

// Deterministic PRNG (mulberry32) so failures reproduce.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BIG = 'x'.repeat(1 << 20);
const NASTY_STRINGS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  'javascript:alert(1)',
  '‮evil\u0000\u0007​',
  '#GGGGGG',
  '#fff',
  'FF00AA',
  '',
  '   ',
  '__proto__',
  '😀'.repeat(40),
  BIG,
];
const NASTY_NUMBERS = [NaN, Infinity, -Infinity, 1e308, -1e308, -0, 0, 1, -1, 0.5, 3, 7, 1e9, 2 ** 53, 0.1234567];

function deep(depth: number): unknown {
  let v: unknown = { leaf: true };
  for (let i = 0; i < depth; i++) v = i % 2 ? [v] : { a: v, prims: [v] };
  return v;
}

function randomValue(r: () => number, depth: number): unknown {
  const pick = <T>(list: T[]): T => list[Math.floor(r() * list.length)];
  const k = r();
  if (depth > 4 || k < 0.25) return pick(NASTY_NUMBERS);
  if (k < 0.4) return pick(NASTY_STRINGS);
  if (k < 0.45) return pick([null, undefined, true, false]);
  if (k < 0.5) return deep(50 + Math.floor(r() * 500));
  if (k < 0.75) {
    const n = r() < 0.05 ? 5000 : Math.floor(r() * 6);
    return Array.from({ length: n }, () => (n > 100 ? 1 : randomValue(r, depth + 1)));
  }
  const o: Record<string, unknown> = {};
  const keys = ['type', 'colors', 'x', 'kind', 'pos', 'scale', 'prims', 'anchor', 'name', 'version', 'constructor'];
  for (let i = 0; i < Math.floor(r() * 5); i++) o[pick(keys)] = randomValue(r, depth + 1);
  if (r() < 0.1) Object.defineProperty(o, '__proto__', { value: { polluted: true }, enumerable: true, writable: true });
  return o;
}

/** Replace a few random leaves (or branches) of a valid pack with random junk. */
function mutate(r: () => number, base: unknown): unknown {
  const copy = structuredClone(base) as Record<string, unknown>;
  const edits = 1 + Math.floor(r() * 6);
  for (let e = 0; e < edits; e++) {
    let node: Record<string, unknown> | unknown[] = copy;
    for (let d = 0; d < 6; d++) {
      const keys = Object.keys(node);
      if (keys.length === 0) break;
      const key = keys[Math.floor(r() * keys.length)];
      const child = (node as Record<string, unknown>)[key];
      if (key === 'version' && r() < 0.9) break;
      if (child && typeof child === 'object' && r() < 0.7) {
        node = child as Record<string, unknown>;
        continue;
      }
      (node as Record<string, unknown>)[key] = randomValue(r, 2);
      break;
    }
  }
  return copy;
}

const withVersion = (v: unknown): unknown =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...v, version: 1 } : { version: 1, body: v, sky: v, segments: v };

const BASES: Record<PackKind, unknown> = { skin: fixtureSkin, theme: fixtureTheme, course: fixtureRecipe };
const KINDS: PackKind[] = ['skin', 'theme', 'course'];

describe('sanitizePack fuzz', () => {
  it('10,000 random and hostile inputs: never throws, every ok result is strict-valid, small and idempotent', () => {
    const r = rng(16);
    let ok = 0;
    for (let i = 0; i < 10_000; i++) {
      const kind = KINDS[i % 3];
      const roll = r();
      const input =
        roll < 0.7 ? mutate(r, BASES[kind]) : roll < 0.85 ? withVersion(randomValue(r, 0)) : randomValue(r, 0);
      let result: ReturnType<typeof sanitizePack> | undefined;
      expect(() => (result = sanitizePack(kind, input))).not.toThrow();
      if (!result?.ok) continue;
      ok++;
      expect(PACK_DATA_SCHEMAS[kind].safeParse(result.data).success).toBe(true);
      expect(packBytes(result.data)).toBeLessThanOrEqual(LIMITS.packMaxBytes);
      const again = sanitizePack(kind, result.data);
      expect(again.data).toEqual(result.data);
      expect(again.issues).toEqual([]);
    }
    expect(ok).toBeGreaterThan(5000);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('survives throwing getters, proxies and cyclic data', () => {
    const throwing = {
      version: 1,
      get body() {
        throw new Error('boom');
      },
    };
    const proxy = new Proxy(
      { version: 1 },
      {
        get: () => {
          throw new Error('trap');
        },
      },
    );
    const cyclic: Record<string, unknown> = { version: 1, name: 'Loop' };
    cyclic.body = cyclic;
    cyclic.accessories = [cyclic];
    for (const kind of KINDS) {
      for (const input of [throwing, proxy, cyclic]) {
        expect(() => sanitizePack(kind, input)).not.toThrow();
      }
    }
    expect(sanitizePack('skin', throwing).ok).toBe(false);
    const fromCycle = sanitizePack('skin', cyclic);
    expect(fromCycle.ok).toBe(true);
    if (fromCycle.ok) expect(PACK_DATA_SCHEMAS.skin.safeParse(fromCycle.data).success).toBe(true);
  });

  it('a 1 MB payload is cut down to a valid pack under the size limit', () => {
    const huge = {
      ...fixtureSkin,
      name: BIG,
      accessories: Array.from({ length: 1000 }, () => ({
        anchor: 'back',
        prims: Array(1000).fill(fixtureSkin.accessories[0].prims[0]),
      })),
    };
    const res = sanitizePack('skin', huge);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(packBytes(res.data)).toBeLessThanOrEqual(LIMITS.packMaxBytes);
      expect(res.data.name.length).toBeLessThanOrEqual(24);
    }
  });
});
