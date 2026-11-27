import { describe, expect, it } from 'bun:test';
import {
  countdownValue,
  createPairWriter,
  createTimeWriter,
  formatTime,
  formatTimeOrDash,
  MAX_TIME_MS,
  numStr,
  PAD2,
  splitTime,
  type TextSink,
} from './format.ts';

/** A text node stand-in that counts writes. */
function sink(): TextSink & { writes: number } {
  let v: string | null = null;
  return {
    writes: 0,
    get nodeValue() {
      return v;
    },
    set nodeValue(x) {
      this.writes++;
      v = x;
    },
  };
}

describe('formatTime (mm:ss.cc)', () => {
  it('formats minutes, seconds and centiseconds with zero padding', () => {
    expect(formatTime(0)).toBe('00:00.00');
    expect(formatTime(9)).toBe('00:00.00');
    expect(formatTime(10)).toBe('00:00.01');
    expect(formatTime(1234)).toBe('00:01.23');
    expect(formatTime(59_999)).toBe('00:59.99');
    expect(formatTime(60_000)).toBe('01:00.00');
    expect(formatTime(83_456)).toBe('01:23.45');
    expect(formatTime(10 * 60_000 + 5_070)).toBe('10:05.07');
  });

  it('floors, never rounds up into the next centisecond', () => {
    expect(formatTime(999.9)).toBe('00:00.99');
    expect(formatTime(59_999.99)).toBe('00:59.99');
  });

  it('treats negative, NaN and -Infinity as zero and caps at 99:59.99', () => {
    expect(formatTime(-5)).toBe('00:00.00');
    expect(formatTime(NaN)).toBe('00:00.00');
    expect(formatTime(-Infinity)).toBe('00:00.00');
    expect(formatTime(Infinity)).toBe('99:59.99');
    expect(formatTime(MAX_TIME_MS + 123_456)).toBe('99:59.99');
  });

  it('formatTimeOrDash shows a dash for a missing time', () => {
    expect(formatTimeOrDash(null)).toBe('--:--.--');
    expect(formatTimeOrDash(undefined, 'DNF')).toBe('DNF');
    expect(formatTimeOrDash(61_000)).toBe('01:01.00');
  });

  it('splitTime writes into the given object and returns it', () => {
    const out = { m: 0, s: 0, c: 0 };
    expect(splitTime(125_670, out)).toBe(out);
    expect(out).toEqual({ m: 2, s: 5, c: 67 });
  });

  it('PAD2 covers 00..99', () => {
    expect(PAD2.length).toBe(100);
    expect(PAD2[0]).toBe('00');
    expect(PAD2[7]).toBe('07');
    expect(PAD2[99]).toBe('99');
  });
});

describe('numStr', () => {
  it('returns the same cached string instance for small integers', () => {
    expect(numStr(37)).toBe('37');
    expect(numStr(37)).toBe(numStr(37));
    expect(numStr(1234)).toBe('1234');
    expect(numStr(-1)).toBe('-1');
    expect(numStr(1.5)).toBe('1.5');
  });
});

describe('countdownValue', () => {
  it('counts 3, 2, 1, then 0 for GO', () => {
    expect(countdownValue(3000)).toBe(3);
    expect(countdownValue(2001)).toBe(3);
    expect(countdownValue(2000)).toBe(2);
    expect(countdownValue(1)).toBe(1);
    expect(countdownValue(0)).toBe(0);
    expect(countdownValue(-50)).toBe(0);
    expect(countdownValue(NaN)).toBe(0);
  });
});

describe('createTimeWriter', () => {
  it('writes the three parts and touches a node only when its digits change', () => {
    const mm = sink();
    const ss = sink();
    const cc = sink();
    const w = createTimeWriter(mm, ss, cc);
    w.set(83_456);
    expect([mm.nodeValue, ss.nodeValue, cc.nodeValue]).toEqual(['01', '23', '45']);
    expect([mm.writes, ss.writes, cc.writes]).toEqual([1, 1, 1]);
    w.set(83_459); // same centisecond
    expect([mm.writes, ss.writes, cc.writes]).toEqual([1, 1, 1]);
    w.set(83_460); // centiseconds only
    expect([mm.writes, ss.writes, cc.writes]).toEqual([1, 1, 2]);
    expect(cc.nodeValue).toBe('46');
    w.set(84_000); // seconds and centiseconds
    expect([mm.writes, ss.writes, cc.writes]).toEqual([1, 2, 3]);
  });

  it('only ever writes strings from the shared PAD2 table (no new strings per call)', () => {
    const mm = sink();
    const ss = sink();
    const cc = sink();
    const w = createTimeWriter(mm, ss, cc);
    for (let ms = 0; ms < 5000; ms += 7) {
      w.set(ms);
      expect(cc.nodeValue).toBe(PAD2[Math.floor(ms / 10) % 100]);
    }
  });

  it('is well under 0.2 ms per call', () => {
    const w = createTimeWriter(sink(), sink(), sink());
    const n = 200_000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) w.set(i * 16.67);
    const perCall = (performance.now() - t0) / n;
    expect(perCall).toBeLessThan(0.2);
  });
});

describe('createPairWriter', () => {
  it('writes "a / b" parts only on change', () => {
    const a = sink();
    const b = sink();
    const w = createPairWriter(a, b);
    w.set(2, 5);
    expect([a.nodeValue, b.nodeValue]).toEqual(['2', '5']);
    w.set(2, 5);
    expect([a.writes, b.writes]).toEqual([1, 1]);
    w.set(3, 5);
    expect([a.writes, b.writes]).toEqual([2, 1]);
    expect(a.nodeValue).toBe('3');
  });
});
