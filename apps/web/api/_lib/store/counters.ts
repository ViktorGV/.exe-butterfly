// Fixed-window counters on SQLite so limits survive restarts. Owned by FLY-2 (#87).
import type { Database } from 'bun:sqlite';
import { getDatabase } from './sqlite.ts';

export interface Counters {
  /** Adds 1 to `key` in the current window (a new window starts when the old one is over) and returns the count. */
  incr(key: string, windowSec: number, now?: number): number;
  /** Current count without changing it; 0 if the window is over. */
  peek(key: string, windowSec: number, now?: number): number;
  /** Seconds until the key's window ends (0 if there is none). */
  retryAfterSec(key: string, windowSec: number, now?: number): number;
}

/** `now` is in milliseconds (Date.now()); inject it in tests. */
export function createCounters(db: Database): Counters {
  db.run(
    'CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)',
  );
  const upsert = db.query<{ count: number }, [string, number, number]>(
    `INSERT INTO counters (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END
     RETURNING count`,
  );
  const select = db.query<{ window_start: number; count: number }, [string]>(
    'SELECT window_start, count FROM counters WHERE key = ?',
  );

  return {
    incr(key, windowSec, now = Date.now()) {
      return upsert.get(key, now, windowSec * 1000)?.count ?? 1;
    },
    peek(key, windowSec, now = Date.now()) {
      const row = select.get(key);
      return row && now - row.window_start < windowSec * 1000 ? row.count : 0;
    },
    retryAfterSec(key, windowSec, now = Date.now()) {
      const row = select.get(key);
      if (!row) return 0;
      return Math.max(0, Math.ceil((row.window_start + windowSec * 1000 - now) / 1000));
    },
  };
}

let shared: Counters | null = null;

/** The process-wide counters, in the same database as the packs. */
export function getCounters(): Counters {
  shared ??= createCounters(getDatabase());
  return shared;
}
