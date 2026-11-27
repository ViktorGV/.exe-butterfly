import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCounters } from './counters.ts';
import { openDatabase } from './sqlite.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('counters', () => {
  it('counts within a window and resets at the boundary', () => {
    const c = createCounters(openDatabase(':memory:'));
    expect(c.peek('k', 60, 0)).toBe(0);
    expect(c.incr('k', 60, 1_000)).toBe(1);
    expect(c.incr('k', 60, 30_000)).toBe(2);
    expect(c.incr('k', 60, 60_999)).toBe(3); // window started at 1_000, ends at 61_000
    expect(c.peek('k', 60, 60_999)).toBe(3);
    expect(c.retryAfterSec('k', 60, 60_000)).toBe(1);
    expect(c.incr('k', 60, 61_000)).toBe(1); // new window
    expect(c.peek('k', 60, 130_000)).toBe(0); // expired
    expect(c.retryAfterSec('k', 60, 130_000)).toBe(0);
  });

  it('keeps keys separate', () => {
    const c = createCounters(openDatabase(':memory:'));
    c.incr('ip:1', 60, 0);
    c.incr('ip:1', 60, 0);
    expect(c.incr('ip:2', 60, 0)).toBe(1);
    expect(c.peek('ip:1', 60, 0)).toBe(2);
    expect(c.retryAfterSec('missing', 60, 0)).toBe(0);
  });

  it('survives closing and reopening the file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wobble-'));
    dirs.push(dir);
    const path = join(dir, 'wobble.db');
    const db = openDatabase(path);
    createCounters(db).incr('day', 86_400, 5_000);
    createCounters(db).incr('day', 86_400, 6_000);
    db.close();
    const c = createCounters(openDatabase(path));
    expect(c.peek('day', 86_400, 7_000)).toBe(2);
    expect(c.incr('day', 86_400, 8_000)).toBe(3);
    expect(c.incr('day', 86_400, 5_000 + 86_400_000)).toBe(1);
  });
});
