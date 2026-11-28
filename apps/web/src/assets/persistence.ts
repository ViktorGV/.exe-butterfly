// Disk cache (IndexedDB) and the anonymous client id (localStorage) for the asset store (#24).
import type { Pack } from '@wobble/shared';
import type { ClientIdStorage, PackPersistence } from './types.ts';

const DB_NAME = 'wobble-packs';
const STORE = 'packs';
const TRIM_EVERY = 25;

function wrap<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/**
 * IndexedDB-backed pack cache with a size cap (oldest entries go first).
 * Returns null when IndexedDB does not exist (some private modes), so the store uses memory only.
 */
export function createIdbPersistence(
  factory: IDBFactory | null | undefined = typeof indexedDB === 'undefined' ? null : indexedDB,
  maxEntries = 600,
): PackPersistence | null {
  if (!factory) return null;
  let opened: Promise<IDBDatabase> | null = null;
  let puts = 0;

  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('at', 'at');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return opened;
  };

  async function trim(db: IDBDatabase): Promise<void> {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let extra = (await wrap(store.count())) - maxEntries;
    if (extra <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const cursor = store.index('at').openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c || extra <= 0) return resolve();
        c.delete();
        extra--;
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }

  return {
    async get(id) {
      const db = await open();
      const entry = (await wrap(db.transaction(STORE).objectStore(STORE).get(id))) as { pack: Pack } | undefined;
      return entry?.pack ?? null;
    },
    async put(pack) {
      const db = await open();
      await wrap(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ id: pack.id, pack, at: Date.now() }));
      if (++puts % TRIM_EVERY === 0) await trim(db);
    },
  };
}

const CLIENT_ID_KEY = 'wobble.clientId';
let memoryClientId: string | null = null;

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  let out = '';
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

function defaultStorage(): ClientIdStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The anonymous client id: a UUID kept in localStorage, or in memory when storage is not available. */
export function loadClientId(storage: ClientIdStorage | null | undefined = defaultStorage()): string {
  try {
    const saved = storage?.getItem(CLIENT_ID_KEY);
    if (saved && saved.length >= 8) return saved;
  } catch {
    // fall through to a fresh id
  }
  const id = storage ? newId() : (memoryClientId ??= newId());
  try {
    storage?.setItem(CLIENT_ID_KEY, id);
  } catch {
    memoryClientId = id;
  }
  return id;
}
