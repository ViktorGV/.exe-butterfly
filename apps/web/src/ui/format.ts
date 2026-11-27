// Time and number formatting plus allocation-free text writers. Pure: no DOM globals, safe to import anywhere.

/** "00".."99", so writers can update text without building new strings. */
export const PAD2: readonly string[] = Object.freeze(
  Array.from({ length: 100 }, (_, i) => (i < 10 ? `0${i}` : `${i}`)),
);

/** Largest time shown: 99:59.99. */
export const MAX_TIME_MS = 99 * 60_000 + 59_990;

export interface TimeParts {
  m: number;
  s: number;
  c: number;
}

/** Split ms into minutes, seconds and centiseconds (floored), writing into `out`. No allocation. */
export function splitTime(ms: number, out: TimeParts): TimeParts {
  // Negative and NaN read as zero; Infinity and anything too long read as the cap.
  const v = ms > 0 ? (ms > MAX_TIME_MS ? MAX_TIME_MS : ms) : 0;
  const cs = Math.floor(v / 10);
  out.m = Math.floor(cs / 6000);
  out.s = Math.floor(cs / 100) % 60;
  out.c = cs % 100;
  return out;
}

const scratch: TimeParts = { m: 0, s: 0, c: 0 };

/** `mm:ss.cc`, e.g. 83456 -> "01:23.45". Negative and NaN read as zero; capped at 99:59.99. */
export function formatTime(ms: number): string {
  splitTime(ms, scratch);
  return `${PAD2[scratch.m]}:${PAD2[scratch.s]}.${PAD2[scratch.c]}`;
}

/** Like formatTime, but `null` (did not finish) gives the fallback. */
export function formatTimeOrDash(ms: number | null | undefined, fallback = '--:--.--'): string {
  return ms == null ? fallback : formatTime(ms);
}

const NUM_CACHE_SIZE = 1000;
const numCache: string[] = [];

/** String(n) with a cache for 0..999, so repeated HUD updates do not allocate. */
export function numStr(n: number): string {
  if (Number.isInteger(n) && n >= 0 && n < NUM_CACHE_SIZE) {
    return (numCache[n] ??= String(n));
  }
  return String(n);
}

/** Countdown digit for the time left: 3, 2, 1, then 0 meaning GO. */
export function countdownValue(msLeft: number): number {
  if (!(msLeft > 0)) return 0;
  return Math.ceil(msLeft / 1000);
}

/** Anything with a writable nodeValue: a DOM Text node, or a plain object in tests. */
export interface TextSink {
  nodeValue: string | null;
}

export interface TimeWriter {
  set(ms: number): void;
}

/** Writes `mm`, `ss`, `cc` into three text nodes, touching a node only when its digits change. */
export function createTimeWriter(mm: TextSink, ss: TextSink, cc: TextSink): TimeWriter {
  const parts: TimeParts = { m: -1, s: -1, c: -1 };
  let m = -1;
  let s = -1;
  let c = -1;
  return {
    set(ms) {
      splitTime(ms, parts);
      if (parts.m !== m) mm.nodeValue = PAD2[(m = parts.m)];
      if (parts.s !== s) ss.nodeValue = PAD2[(s = parts.s)];
      if (parts.c !== c) cc.nodeValue = PAD2[(c = parts.c)];
    },
  };
}

export interface PairWriter {
  set(a: number, b: number): void;
}

/** Writes "a" and "b" of an "a / b" readout into two text nodes, only on change. */
export function createPairWriter(aNode: TextSink, bNode: TextSink): PairWriter {
  let a = NaN;
  let b = NaN;
  return {
    set(na, nb) {
      if (na !== a) aNode.nodeValue = numStr((a = na));
      if (nb !== b) bNode.nodeValue = numStr((b = nb));
    },
  };
}
