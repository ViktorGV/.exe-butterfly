// Test support for the protocol tests. Not exported from index.ts and not used at runtime.
//
// The reference codec below is written a second time, on purpose, with DataView and straight
// from the byte tables in docs/CONTRACTS.md §6, so the tests compare two independent
// implementations instead of the codec with itself.
import { Anim, POS_SCALE } from '../constants.ts';
import type { AnimValue } from '../types.ts';
import type { WireState } from './state.ts';

/** Deterministic PRNG (mulberry32), so a failing fuzz or property case can be replayed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const ANIMS = Object.values(Anim);

/** A random state inside the representable range (±`range` metres, any yaw within ±4 turns). */
export function randomState(rand: () => number, range = 650): WireState {
  return {
    pos: [(rand() * 2 - 1) * range, (rand() * 2 - 1) * range, (rand() * 2 - 1) * range],
    yaw: (rand() * 2 - 1) * Math.PI * 8,
    anim: ANIMS[Math.floor(rand() * ANIMS.length)],
    grounded: rand() < 0.5,
    finished: rand() < 0.2,
    respawned: rand() < 0.2,
  };
}

/** Smallest absolute difference between two angles, in radians. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

function refInt16(metres: number): number {
  return Math.max(-32768, Math.min(32767, Math.round(metres * POS_SCALE)));
}
function refYaw(yaw: number): number {
  return Math.round((yaw / (2 * Math.PI)) * 256) & 255;
}
function refAnimFlags(s: WireState): number {
  return s.anim | (Number(s.grounded) << 4) | (Number(s.finished) << 5) | (Number(s.respawned === true) << 6);
}

export function refEncodeState(s: WireState, seq: number, raceTimeMs: number): Uint8Array {
  const dv = new DataView(new ArrayBuffer(15));
  dv.setUint8(0, 0x01);
  dv.setUint16(1, seq, true);
  dv.setUint32(3, raceTimeMs, true);
  dv.setInt16(7, refInt16(s.pos[0]), true);
  dv.setInt16(9, refInt16(s.pos[1]), true);
  dv.setInt16(11, refInt16(s.pos[2]), true);
  dv.setUint8(13, refYaw(s.yaw));
  dv.setUint8(14, refAnimFlags(s));
  return new Uint8Array(dv.buffer);
}

export interface RefPlayer {
  id: number;
  state: WireState;
}

export function refEncodeSnapshot(serverTimeMs: number, players: RefPlayer[]): Uint8Array {
  const dv = new DataView(new ArrayBuffer(7 + 10 * players.length));
  dv.setUint8(0, 0x02);
  dv.setUint32(1, serverTimeMs, true);
  dv.setUint16(5, players.length, true);
  players.forEach(({ id, state }, n) => {
    const o = 7 + 10 * n;
    dv.setUint16(o, id, true);
    dv.setInt16(o + 2, refInt16(state.pos[0]), true);
    dv.setInt16(o + 4, refInt16(state.pos[1]), true);
    dv.setInt16(o + 6, refInt16(state.pos[2]), true);
    dv.setUint8(o + 8, refYaw(state.yaw));
    dv.setUint8(o + 9, refAnimFlags(state));
  });
  return new Uint8Array(dv.buffer);
}

function refAnimFlagsOk(animFlags: number): boolean {
  return (animFlags & 0x80) === 0 && (animFlags & 0x0f) <= 7;
}
function refYawRad(byte: number): number {
  return ((byte < 128 ? byte : byte - 256) / 256) * 2 * Math.PI;
}

export interface RefState {
  seq: number;
  raceTimeMs: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  animFlags: number;
}

/** Reference STATE decoder: `null` for anything that is not exactly one valid frame. */
export function refDecodeState(bytes: Uint8Array): RefState | null {
  if (bytes.length !== 15) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint8(0) !== 0x01 || !refAnimFlagsOk(dv.getUint8(14))) return null;
  return {
    seq: dv.getUint16(1, true),
    raceTimeMs: dv.getUint32(3, true),
    x: dv.getInt16(7, true) / POS_SCALE,
    y: dv.getInt16(9, true) / POS_SCALE,
    z: dv.getInt16(11, true) / POS_SCALE,
    yaw: refYawRad(dv.getUint8(13)),
    animFlags: dv.getUint8(14),
  };
}

export interface RefRecord {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  anim: AnimValue;
  flags: number;
}

/** Reference SNAPSHOT decoder: `null` for anything that is not exactly one valid frame. */
export function refDecodeSnapshot(bytes: Uint8Array): { serverTimeMs: number; records: RefRecord[] } | null {
  if (bytes.length < 7) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint8(0) !== 0x02) return null;
  const count = dv.getUint16(5, true);
  if (bytes.length !== 7 + 10 * count) return null;
  const records: RefRecord[] = [];
  for (let n = 0; n < count; n++) {
    const o = 7 + 10 * n;
    const animFlags = dv.getUint8(o + 9);
    if (!refAnimFlagsOk(animFlags)) return null;
    records.push({
      id: dv.getUint16(o, true),
      x: dv.getInt16(o + 2, true) / POS_SCALE,
      y: dv.getInt16(o + 4, true) / POS_SCALE,
      z: dv.getInt16(o + 6, true) / POS_SCALE,
      yaw: refYawRad(dv.getUint8(o + 8)),
      anim: (animFlags & 0x0f) as AnimValue,
      flags: animFlags & 0x70,
    });
  }
  return { serverTimeMs: dv.getUint32(1, true), records };
}

/**
 * A Uint8Array stand-in that counts every read outside `0..length-1`. One proxy is reused for
 * all inputs: `use(bytes)` swaps what it reads from. It still passes `instanceof Uint8Array`.
 */
export function createReadGuard(): { view: Uint8Array; use(bytes: Uint8Array): void; readonly outOfBounds: number } {
  let current: Uint8Array = new Uint8Array(0);
  let outOfBounds = 0;
  const view = new Proxy(new Uint8Array(0), {
    get(_target, key) {
      if (typeof key === 'string' && !(key in current)) outOfBounds++; // an index that is not in the array
      return Reflect.get(current, key, current);
    },
  });
  return {
    view,
    use(bytes) {
      current = bytes;
    },
    get outOfBounds() {
      return outOfBounds;
    },
  };
}
