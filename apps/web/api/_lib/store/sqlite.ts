// Pack store on SQLite (bun:sqlite). Owned by FLY-2 (#87). Replaces Vercel Blob + Upstash.
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LIMITS } from '@wobble/shared/constants';
import { PackSchema } from '@wobble/shared/schemas/packs';
import type { Pack, PackKind } from '@wobble/shared/types';
import type { ApiPackStore } from './types.ts';

export const REPORTS_TO_HIDE = 3;
export const DEFAULT_DATA_DIR = './data';

export interface SqlitePackStore extends ApiPackStore {
  /** Not part of the PackStore contract: link a prompt hash to a stored pack (like the memory store). */
  indexPromptHash(kind: PackKind, hash: string, id: string): Promise<void>;
}

/** Opens (and creates) the database. `path` may be ':memory:'. Schema is created on open. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA synchronous = NORMAL');
  db.run(`CREATE TABLE IF NOT EXISTS packs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    prompt_hash TEXT,
    created_at TEXT NOT NULL,
    flagged INTEGER NOT NULL DEFAULT 0,
    json TEXT NOT NULL
  )`);
  db.run('CREATE INDEX IF NOT EXISTS packs_kind_created ON packs (kind, created_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS packs_kind_hash ON packs (kind, prompt_hash)');
  db.run(`CREATE TABLE IF NOT EXISTS reports (
    pack_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    UNIQUE (pack_id, client_id)
  )`);
  return db;
}

export function dbPath(dataDir: string = process.env.DATA_DIR ?? DEFAULT_DATA_DIR): string {
  return join(dataDir, 'wobble.db');
}

let shared: Database | null = null;

/** The process-wide database at ${DATA_DIR}/wobble.db. */
export function getDatabase(): Database {
  shared ??= openDatabase(dbPath());
  return shared;
}

const encodeCursor = (createdAt: string, id: string) => `${createdAt}|${id}`;

export function createSqlitePackStore(db: Database): SqlitePackStore {
  const insert = db.query('INSERT OR IGNORE INTO packs (id, kind, name, created_at, json) VALUES (?, ?, ?, ?, ?)');
  const selectOne = db.query<{ json: string }, [string]>('SELECT json FROM packs WHERE id = ?');
  const listFirst = db.query<{ json: string; created_at: string; id: string }, [string, number]>(
    'SELECT json, created_at, id FROM packs WHERE kind = ? AND flagged = 0 ORDER BY created_at DESC, id ASC LIMIT ?',
  );
  const listAfter = db.query<
    { json: string; created_at: string; id: string },
    [string, string, string, string, number]
  >(
    `SELECT json, created_at, id FROM packs WHERE kind = ? AND flagged = 0
       AND (created_at < ? OR (created_at = ? AND id > ?))
       ORDER BY created_at DESC, id ASC LIMIT ?`,
  );
  const byHash = db.query<{ json: string }, [string, string]>(
    'SELECT json FROM packs WHERE kind = ? AND prompt_hash = ? ORDER BY created_at DESC LIMIT 1',
  );
  const setHash = db.query('UPDATE packs SET prompt_hash = ? WHERE id = ? AND kind = ?');
  const setFlag = db.query('UPDATE packs SET flagged = 1 WHERE id = ?');
  const clearFlag = db.query('UPDATE packs SET flagged = 0 WHERE id = ?');
  const deletePack = db.query('DELETE FROM packs WHERE id = ?');
  const addReport = db.query('INSERT OR IGNORE INTO reports (pack_id, client_id) VALUES (?, ?)');
  const countReports = db.query<{ n: number }, [string]>('SELECT COUNT(*) AS n FROM reports WHERE pack_id = ?');
  const clearReports = db.query('DELETE FROM reports WHERE pack_id = ?');

  const parse = (row: { json: string } | null): Pack | null => (row ? (JSON.parse(row.json) as Pack) : null);

  const get = async (id: string) => parse(selectOne.get(id));

  return {
    async put(pack) {
      const parsed = PackSchema.safeParse(pack);
      if (!parsed.success) throw new Error('invalid pack');
      const json = JSON.stringify(parsed.data);
      if (Buffer.byteLength(json) > LIMITS.packMaxBytes) throw new Error('pack too large');
      insert.run(parsed.data.id, parsed.data.kind, parsed.data.name, parsed.data.createdAt, json); // immutable: no overwrite
    },
    get,
    async list({ kind, cursor = null, limit = 24 }) {
      const n = Math.max(1, Math.min(limit, 100));
      let rows;
      const sep = cursor ? cursor.lastIndexOf('|') : -1;
      if (cursor && sep > 0) {
        const at = cursor.slice(0, sep);
        rows = listAfter.all(kind, at, at, cursor.slice(sep + 1), n + 1);
      } else {
        rows = listFirst.all(kind, n + 1);
      }
      const page = rows.slice(0, n);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => JSON.parse(r.json) as Pack),
        nextCursor: rows.length > n && last ? encodeCursor(last.created_at, last.id) : null,
      };
    },
    async findByPromptHash(kind, hash) {
      return parse(byHash.get(kind, hash));
    },
    async flag(id) {
      setFlag.run(id);
    },
    async indexPromptHash(kind, hash, id) {
      setHash.run(hash, id, kind);
    },
    async report(id, clientId) {
      addReport.run(id, clientId);
      const count = countReports.get(id)?.n ?? 0;
      const hidden = count >= REPORTS_TO_HIDE;
      if (hidden) setFlag.run(id);
      return { count, hidden };
    },
    async getMany(ids) {
      const packs: Pack[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const p = parse(selectOne.get(id));
        if (p) packs.push(p);
        else missing.push(id);
      }
      return { packs, missing };
    },
    async unflag(id) {
      clearFlag.run(id);
      clearReports.run(id);
    },
    async remove(id) {
      clearReports.run(id);
      return deletePack.run(id).changes > 0;
    },
  };
}
