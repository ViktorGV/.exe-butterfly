// Voice bookkeeping: concurrency cap, per-sound rate limiting and voice stealing.
// Pure logic (no WebAudio) so it is unit tested directly.

export const MAX_VOICES = 16;

export interface Voice {
  name: string;
  startSec: number;
  endSec: number;
  gain: number;
  /** Called when this voice is stolen; must fade out the underlying nodes. */
  stop: () => void;
}

export interface VoicePoolOptions {
  maxVoices?: number;
  /** Minimum seconds between two starts of the same sound name. */
  minIntervalSec?: (name: string) => number;
  /** Max simultaneous voices of one sound name. */
  maxPerName?: number;
}

export interface VoicePool {
  /** Returns false when the request is dropped. May steal a voice to make room. */
  admit(name: string, nowSec: number, gain: number): boolean;
  add(voice: Voice): void;
  /** Drops voices that have finished by `nowSec`. */
  prune(nowSec: number): void;
  readonly active: readonly Voice[];
  clear(): void;
}

/** Oldest-quietest scores lowest: gain discounted by age. */
const score = (v: Voice, now: number): number => v.gain / (1 + Math.max(0, now - v.startSec));

export function createVoicePool(opts: VoicePoolOptions = {}): VoicePool {
  const max = opts.maxVoices ?? MAX_VOICES;
  const maxPerName = opts.maxPerName ?? 4;
  const minInterval = opts.minIntervalSec ?? (() => 0.04);
  const voices: Voice[] = [];
  const lastStart = new Map<string, number>();

  function prune(now: number): void {
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].endSec <= now) voices.splice(i, 1);
  }

  function steal(now: number, name: string | null): void {
    let idx = -1;
    let best = Infinity;
    for (let i = 0; i < voices.length; i++) {
      if (name !== null && voices[i].name !== name) continue;
      const s = score(voices[i], now);
      if (s < best) {
        best = s;
        idx = i;
      }
    }
    if (idx < 0) return;
    const [v] = voices.splice(idx, 1);
    v.stop();
  }

  return {
    admit(name, now, gain) {
      prune(now);
      const last = lastStart.get(name);
      if (last !== undefined && now - last < minInterval(name)) return false;
      let same = 0;
      for (const v of voices) if (v.name === name) same++;
      if (same >= maxPerName) steal(now, name);
      else if (voices.length >= max) {
        let quietest = Infinity;
        for (const v of voices) quietest = Math.min(quietest, score(v, now));
        // Do not steal a louder voice for one that would be lost in the mix anyway.
        if (gain < quietest * 0.5) return false;
        steal(now, null);
      }
      lastStart.set(name, now);
      return true;
    },
    add(voice) {
      voices.push(voice);
    },
    prune,
    get active() {
      return voices;
    },
    clear() {
      for (const v of voices) v.stop();
      voices.length = 0;
      lastStart.clear();
    },
  };
}
