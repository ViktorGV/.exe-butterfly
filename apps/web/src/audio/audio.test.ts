import { describe, expect, test } from 'bun:test';
import { createAudio } from './index.ts';
import { PATCHES, SOUND_NAMES, patchLength } from './patches.ts';
import { SCALES, generatePattern, seedFor, type MusicDef } from './pattern.ts';
import { DEFAULT_VOLUMES, loadVolumes, normalizeVolumes, saveVolumes } from './prefs.ts';
import { HEAR_RADIUS_M, spatialize } from './spatial.ts';
import { MAX_VOICES, createVoicePool, type Voice } from './voices.ts';

function voice(name: string, start: number, gain: number, log: string[], len = 1): Voice {
  return { name, startSec: start, endSec: start + len, gain, stop: () => log.push(`${name}@${start}`) };
}

describe('voice pool', () => {
  test('never exceeds the cap; 300 players jumping stays at MAX_VOICES', () => {
    const pool = createVoicePool({ maxPerName: 100, minIntervalSec: () => 0 });
    const log: string[] = [];
    for (let i = 0; i < 300; i++) {
      const t = i * 0.001;
      if (pool.admit('jump', t, 0.5)) pool.add(voice('jump', t, 0.5, log));
      expect(pool.active.length).toBeLessThanOrEqual(MAX_VOICES);
    }
    expect(pool.active.length).toBe(MAX_VOICES);
  });

  test('steals the oldest-quietest voice first', () => {
    const pool = createVoicePool({ maxVoices: 3, maxPerName: 10, minIntervalSec: () => 0 });
    const log: string[] = [];
    pool.add(voice('a', 0, 1, log));
    pool.add(voice('b', 0, 0.2, log)); // oldest and quietest
    pool.add(voice('c', 0.5, 0.2, log));
    expect(pool.admit('d', 0.6, 1)).toBe(true);
    expect(log).toEqual(['b@0']);
    expect(pool.active.map((v) => v.name)).toEqual(['a', 'c']);
  });

  test('a very quiet sound does not steal from a full loud pool', () => {
    const pool = createVoicePool({ maxVoices: 2, minIntervalSec: () => 0 });
    const log: string[] = [];
    pool.add(voice('a', 0, 1, log));
    pool.add(voice('b', 0, 1, log));
    expect(pool.admit('c', 0.01, 0.05)).toBe(false);
    expect(log).toEqual([]);
  });

  test('rate limits repeats of the same sound', () => {
    const pool = createVoicePool({ minIntervalSec: () => 0.1 });
    expect(pool.admit('hit', 0, 1)).toBe(true);
    expect(pool.admit('hit', 0.05, 1)).toBe(false);
    expect(pool.admit('land', 0.05, 1)).toBe(true);
    expect(pool.admit('hit', 0.11, 1)).toBe(true);
  });

  test('caps voices per sound name by stealing its own oldest', () => {
    const pool = createVoicePool({ maxPerName: 2, minIntervalSec: () => 0 });
    const log: string[] = [];
    for (const t of [0, 0.1]) if (pool.admit('jump', t, 1)) pool.add(voice('jump', t, 1, log));
    expect(pool.admit('jump', 0.2, 1)).toBe(true);
    expect(log).toEqual(['jump@0']);
  });

  test('prunes finished voices', () => {
    const pool = createVoicePool();
    pool.add(voice('a', 0, 1, [], 0.2));
    pool.prune(0.3);
    expect(pool.active.length).toBe(0);
  });
});

describe('pattern generator', () => {
  const def: MusicDef = { tempo: 120, scale: 'minor', energy: 3, swing: 0.5 };

  test('is deterministic for a seed', () => {
    expect(generatePattern(def, 42)).toEqual(generatePattern(def, 42));
    expect(seedFor(def)).toBe(seedFor({ ...def }));
  });

  test('different seeds give different melodies', () => {
    const lead = (s: number) => generatePattern(def, s).events.filter((e) => e.part === 'lead');
    expect(lead(1)).not.toEqual(lead(2));
  });

  test('energy adds layers', () => {
    const parts = (energy: 1 | 2 | 3) => new Set(generatePattern({ ...def, energy }, 7).events.map((e) => e.part));
    expect([...parts(1)].sort()).toEqual(['bass', 'chord', 'kick']);
    expect(parts(2).has('lead') && parts(2).has('hat') && !parts(2).has('snare')).toBe(true);
    expect(parts(3).has('snare')).toBe(true);
  });

  test('pitched notes stay in the scale and steps in range', () => {
    for (const scale of Object.keys(SCALES) as MusicDef['scale'][]) {
      const p = generatePattern({ tempo: 100, scale, energy: 3 }, 3);
      for (const e of p.events) {
        expect(e.step).toBeGreaterThanOrEqual(0);
        expect(e.step).toBeLessThan(p.steps);
        if (e.midi) expect(SCALES[scale]).toContain(e.midi % 12);
      }
    }
  });

  test('tempo and swing set timing', () => {
    const p = generatePattern({ tempo: 120, scale: 'major', energy: 1 }, 1);
    expect(p.stepSec).toBeCloseTo(0.125);
    expect(p.swingSec).toBe(0);
    expect(generatePattern(def, 1).swingSec).toBeCloseTo(0.03125);
  });
});

describe('spatial', () => {
  const out = { gain: 0, pan: 0 };
  test('silent beyond the hearing radius', () => {
    expect(spatialize({ x: 0, y: 0, z: HEAR_RADIUS_M + 1 }, { x: 0, y: 0, z: 0 }, 0, out)).toBeNull();
  });
  test('louder when closer; pans to the right side', () => {
    const near = spatialize({ x: 2, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, out)!.gain;
    expect(out.pan).toBeCloseTo(1);
    const far = spatialize({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, out)!.gain;
    expect(near).toBeGreaterThan(far);
    // Turned to face +X (yaw -pi/2), a source at +X is straight ahead.
    spatialize({ x: 5, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, -Math.PI / 2, out);
    expect(Math.abs(out.pan)).toBeLessThan(1e-9);
  });
});

describe('prefs', () => {
  test('clamps and falls back', () => {
    expect(normalizeVolumes({ master: 2, sfx: -1, music: NaN })).toEqual({
      master: 1,
      sfx: 0,
      music: DEFAULT_VOLUMES.music,
    });
  });
  test('round-trips through storage and survives junk', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveVolumes({ master: 0.3, sfx: 0.4, music: 0.5 }, s);
    expect(loadVolumes(s)).toEqual({ master: 0.3, sfx: 0.4, music: 0.5 });
    m.set([...m.keys()][0], '{bad');
    expect(loadVolumes(s)).toEqual(DEFAULT_VOLUMES);
  });
});

describe('patches', () => {
  test('every sound has short, valid layers with an audible envelope', () => {
    for (const n of SOUND_NAMES) {
      const p = PATCHES[n];
      expect(p.layers.length).toBeGreaterThan(0);
      expect(patchLength(p)).toBeLessThan(1.5);
      for (const l of p.layers) {
        expect(l.f0).toBeGreaterThan(0);
        expect(l.f1).toBeGreaterThan(0);
        expect(l.gain).toBeLessThanOrEqual(1);
        expect(l.attack ?? 0.006).toBeGreaterThanOrEqual(0.002);
      }
    }
  });
  test('includes butterfly effect sounds', () => {
    for (const n of ['push', 'save', 'helpUp', 'butterfly', 'stormStep']) expect(SOUND_NAMES).toContain(n as never);
  });
});

describe('createAudio without a context', () => {
  test('is silent and safe before unlock, and unlock tolerates missing WebAudio', () => {
    const a = createAudio({
      autoUnlock: false,
      createContext: () => {
        throw new Error('nope');
      },
    });
    a.play('jump');
    a.setMusic({ tempo: 120, scale: 'major', energy: 2 });
    a.setCrowdDensity(0.5);
    a.unlock();
    a.unlock();
    expect(a.unlocked).toBe(false);
    expect(a.voiceCount).toBe(0);
    a.dispose();
  });
});
