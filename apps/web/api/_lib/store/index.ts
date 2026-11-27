// SEAM. Seeded by #2 with an in-memory store; replaced by #23 (Blob + Redis store).
import type { Pack, PackKind, PackStore } from '@wobble/shared/types';

export interface MemoryPackStore extends PackStore {
  /** Test/dev helper (not part of the PackStore contract). */
  indexPromptHash(kind: PackKind, hash: string, id: string): Promise<void>;
}

export function createMemoryPackStore(): MemoryPackStore {
  const packs = new Map<string, Pack>();
  const byHash = new Map<string, string>();
  const flagged = new Set<string>();

  const get = async (id: string) => {
    const p = packs.get(id);
    return p ? structuredClone(p) : null;
  };

  return {
    async put(pack) {
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
  };
}

let store: PackStore | null = null;

/** The process-wide pack store. */
export function getPackStore(): PackStore {
  store ??= createMemoryPackStore();
  return store;
}
