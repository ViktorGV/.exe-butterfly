// SEAM. Memory store for tests and local dev; SQLite on a volume when DATA_DIR is set (#87).
import { LIMITS } from '@wobble/shared/constants';
import { PackSchema } from '@wobble/shared/schemas/packs';
import type { Pack, PackKind } from '@wobble/shared/types';
import { createSqlitePackStore, getDatabase, REPORTS_TO_HIDE } from './sqlite.ts';
import type { ApiPackStore } from './types.ts';

export interface MemoryPackStore extends ApiPackStore {
  /** Test/dev helper (not part of the PackStore contract). */
  indexPromptHash(kind: PackKind, hash: string, id: string): Promise<void>;
}

export function createMemoryPackStore(): MemoryPackStore {
  const packs = new Map<string, Pack>();
  const byHash = new Map<string, string>();
  const flagged = new Set<string>();
  const reports = new Map<string, Set<string>>();

  const get = async (id: string) => {
    const p = packs.get(id);
    return p ? structuredClone(p) : null;
  };

  return {
    async put(pack) {
      if (!PackSchema.safeParse(pack).success) throw new Error('invalid pack');
      if (Buffer.byteLength(JSON.stringify(pack)) > LIMITS.packMaxBytes) throw new Error('pack too large');
      packs.set(pack.id, structuredClone(pack));
    },
    get,
    async list({ kind, cursor = null, limit = 24 }) {
      const all = [...packs.values()]
        .filter((p) => p.kind === kind && !flagged.has(p.id))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      const start = cursor ? Number(cursor) : 0;
      const items = all.slice(start, start + limit).map((p) => structuredClone(p));
      return { items, nextCursor: start + limit < all.length ? String(start + limit) : null };
    },
    async findByPromptHash(kind, hash) {
      const id = byHash.get(`${kind}:${hash}`);
      return id ? get(id) : null;
    },
    async flag(id) {
      flagged.add(id);
    },
    async indexPromptHash(kind, hash, id) {
      byHash.set(`${kind}:${hash}`, id);
    },
    async report(id, clientId) {
      const by = reports.get(id) ?? new Set<string>();
      by.add(clientId);
      reports.set(id, by);
      const hidden = by.size >= REPORTS_TO_HIDE;
      if (hidden) flagged.add(id);
      return { count: by.size, hidden };
    },
    async getMany(ids) {
      const found: Pack[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const p = await get(id);
        if (p) found.push(p);
        else missing.push(id);
      }
      return { packs: found, missing };
    },
    async unflag(id) {
      flagged.delete(id);
      reports.delete(id);
    },
    async remove(id) {
      flagged.delete(id);
      reports.delete(id);
      return packs.delete(id);
    },
  };
}

let store: ApiPackStore | null = null;

/** The process-wide pack store: SQLite when DATA_DIR is set (production), memory otherwise. */
export function getPackStore(): ApiPackStore {
  store ??= process.env.DATA_DIR ? createSqlitePackStore(getDatabase()) : createMemoryPackStore();
  return store;
}
