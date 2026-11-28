// The client's single door to asset packs (#24): resolve, validate, cache and preload.
// Never trust the network: every pack goes through the shared schema and sanitizePack.
import { PackSchema, listBuiltins, resolveBuiltin, sanitizePack } from '@wobble/shared';
import type { MatchConfig, Pack, PackKind } from '@wobble/shared';
import { createIdbPersistence, loadClientId } from './persistence.ts';
import { AssetError } from './types.ts';
import type {
  AssetStore,
  AssetStoreOptions,
  Fallback,
  FallbackReason,
  PackPage,
  PackPersistence,
  Preload,
  PreloadOptions,
  PreloadReport,
} from './types.ts';

const BATCH_MAX = 50;

class Fail extends Error {
  readonly reason: FallbackReason;
  constructor(reason: FallbackReason) {
    super(reason);
    this.reason = reason;
  }
}

interface Resolved {
  pack: Pack;
  real: boolean;
  reason?: FallbackReason;
}

interface Http {
  status: number;
  retryAfterSec: number | null;
  body: unknown;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Runs at most `max` tasks at once. */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  const next = () => {
    const run = waiting.shift();
    if (run) run();
  };
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      next();
    }
  };
}

export function createAssetStore(opts: AssetStoreOptions = {}): AssetStore {
  const apiBase = (opts.apiBase ?? '').replace(/\/+$/, '');
  const eventBase = (opts.eventBase ?? '/event').replace(/\/+$/, '');
  const fetchImpl = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const requestTimeoutMs = opts.requestTimeoutMs ?? 8000;
  const blockingTimeoutMs = opts.blockingTimeoutMs ?? 10_000;
  const batchSize = Math.max(1, Math.min(BATCH_MAX, opts.batchSize ?? BATCH_MAX));
  const concurrency = Math.max(1, opts.concurrency ?? 6);
  const memoryEntries = Math.max(1, opts.memoryEntries ?? 400);
  const disk: PackPersistence | null = opts.persistence === undefined ? createIdbPersistence() : opts.persistence;

  const memory = new Map<string, Pack>();
  const inflight = new Map<string, Promise<Resolved>>();
  const listeners = new Set<(id: string, pack: Pack) => void>();
  let myClientId: string | null = null;

  const clientId = () => (myClientId ??= loadClientId(opts.storage));

  // ---- memory LRU -----------------------------------------------------------
  function memGet(id: string): Pack | null {
    const hit = memory.get(id);
    if (!hit) return null;
    memory.delete(id);
    memory.set(id, hit);
    return hit;
  }

  function memSet(pack: Pack): void {
    memory.delete(pack.id);
    memory.set(pack.id, pack);
    while (memory.size > memoryEntries) {
      const oldest = memory.keys().next();
      if (oldest.done) break;
      memory.delete(oldest.value);
    }
  }

  function remember(pack: Pack, fromNetwork: boolean): void {
    memSet(pack);
    if (fromNetwork && disk) disk.put(pack).catch(() => undefined);
    for (const fn of listeners) {
      try {
        fn(pack.id, pack);
      } catch {
        // a bad listener must not break loading
      }
    }
  }

  async function readDisk(id: string): Promise<Pack | null> {
    if (!disk) return null;
    try {
      const pack = await disk.get(id);
      if (!pack) return null;
      return validate(pack, id, pack.kind);
    } catch {
      return null;
    }
  }

  // ---- defaults and validation ---------------------------------------------
  function defaultPack(kind: PackKind): Pack {
    const found = listBuiltins(kind)[0] ?? listBuiltins()[0];
    if (!found) throw new Error('no built-in packs are registered');
    return found;
  }

  function fallback(kind: PackKind, reason: FallbackReason): Resolved {
    return { pack: defaultPack(kind), real: false, reason };
  }

  /** Schema check, then sanitize. Throws Fail('invalid') when the pack cannot be used. */
  function validate(raw: unknown, id: string | null, kind: PackKind): Pack {
    const parsed = PackSchema.safeParse(raw);
    if (!parsed.success) throw new Fail('invalid');
    const pack = parsed.data;
    if ((id !== null && pack.id !== id) || pack.kind !== kind) throw new Fail('invalid');
    const clean = sanitizePack(pack.kind, pack.data);
    if (!clean.ok) throw new Fail('invalid');
    return { ...pack, data: clean.data } as Pack;
  }

  // ---- HTTP -----------------------------------------------------------------
  async function http(url: string, init?: RequestInit): Promise<Http> {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Rejects when the timeout fires, even for a fetch that ignores the abort signal.
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new Error('timeout'));
      }, requestTimeoutMs);
    });
    try {
      const { res, text } = await Promise.race([
        (async () => {
          const r = await fetchImpl(url, { ...init, signal: ctl.signal });
          return { res: r, text: await r.text() };
        })(),
        expired,
      ]);
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      const retry = Number(res.headers.get('retry-after'));
      return { status: res.status, retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : null, body };
    } catch {
      throw new Fail(ctl.signal.aborted ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }

  function reasonOfStatus(status: number): FallbackReason {
    return status === 404 ? 'not_found' : 'unavailable';
  }

  async function fetchOne(id: string, kind: PackKind): Promise<Pack> {
    let url: string;
    if (id.startsWith('g:')) url = `${apiBase}/api/packs/${encodeURIComponent(id)}?id=${encodeURIComponent(id)}`;
    else if (id.startsWith('e:')) url = `${eventBase}/packs/${kind}/${encodeURIComponent(id.slice(2))}.json`;
    else throw new Fail('unsupported');
    const res = await http(url);
    if (res.status !== 200) throw new Fail(reasonOfStatus(res.status));
    return validate(res.body, id, kind);
  }

  // ---- single pack ----------------------------------------------------------
  async function load(id: string, kind: PackKind): Promise<Resolved> {
    try {
      if (id.startsWith('b:')) {
        const builtin = resolveBuiltin(id);
        return builtin ? { pack: builtin, real: true } : fallback(kind, 'not_found');
      }
      const cached = await readDisk(id);
      if (cached) {
        memSet(cached);
        return { pack: cached, real: true };
      }
      const pack = await fetchOne(id, kind);
      remember(pack, true);
      return { pack, real: true };
    } catch (e) {
      return fallback(kind, e instanceof Fail ? e.reason : 'network');
    }
  }

  function resolve(id: string, kind: PackKind): Promise<Resolved> {
    const hit = memGet(id);
    if (hit) return Promise.resolve({ pack: hit, real: true });
    const pending = inflight.get(id);
    if (pending) return pending;
    const p = load(id, kind).finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  // ---- batches (background preload) ----------------------------------------
  async function fetchBatch(ids: string[], kind: PackKind): Promise<Map<string, Resolved>> {
    const out = new Map<string, Resolved>();
    const misses: string[] = [];
    await Promise.all(
      ids.map(async (id) => {
        const cached = await readDisk(id);
        if (cached) {
          memSet(cached);
          out.set(id, { pack: cached, real: true });
        } else misses.push(id);
      }),
    );
    if (misses.length === 0) return out;
    try {
      const res = await http(`${apiBase}/api/packs/batch?ids=${misses.map(encodeURIComponent).join(',')}`);
      if (res.status !== 200) throw new Fail(reasonOfStatus(res.status));
      const packs = (res.body as { packs?: unknown } | null)?.packs;
      if (!Array.isArray(packs)) throw new Fail('invalid');
      for (const raw of packs) {
        const id = (raw as { id?: unknown } | null)?.id;
        if (typeof id !== 'string' || !misses.includes(id) || out.has(id)) continue;
        try {
          const pack = validate(raw, id, kind);
          remember(pack, true);
          out.set(id, { pack, real: true });
        } catch {
          out.set(id, fallback(kind, 'invalid'));
        }
      }
      for (const id of misses) if (!out.has(id)) out.set(id, fallback(kind, 'not_found'));
    } catch (e) {
      const reason = e instanceof Fail ? e.reason : 'network';
      for (const id of misses) if (!out.has(id)) out.set(id, fallback(kind, reason));
    }
    return out;
  }

  /** Loads many g: skins through the batch endpoint, sharing in-flight work with getPack. */
  function loadMany(
    ids: string[],
    kind: PackKind,
    run: <T>(task: () => Promise<T>) => Promise<T>,
  ): Promise<Resolved>[] {
    const results: Promise<Resolved>[] = [];
    const fresh: string[] = [];
    const waiting = new Map<string, Deferred<Resolved>>();
    for (const id of ids) {
      const hit = memGet(id);
      if (hit) {
        results.push(Promise.resolve({ pack: hit, real: true }));
        continue;
      }
      const pending = inflight.get(id);
      if (pending) {
        results.push(pending);
        continue;
      }
      const d = defer<Resolved>();
      waiting.set(id, d);
      inflight.set(id, d.promise);
      results.push(d.promise);
      fresh.push(id);
    }
    for (let i = 0; i < fresh.length; i += batchSize) {
      const chunk = fresh.slice(i, i + batchSize);
      void run(() => fetchBatch(chunk, kind)).then(
        (got) => {
          for (const id of chunk) {
            waiting.get(id)?.resolve(got.get(id) ?? fallback(kind, 'not_found'));
            inflight.delete(id);
          }
        },
        () => {
          for (const id of chunk) {
            waiting.get(id)?.resolve(fallback(kind, 'network'));
            inflight.delete(id);
          }
        },
      );
    }
    return results;
  }

  // ---- reports --------------------------------------------------------------
  function report(ids: string[], resolved: Resolved[], timedOut = false): PreloadReport {
    const packs: Record<string, Pack> = {};
    const fallbacks: Fallback[] = [];
    let loaded = 0;
    ids.forEach((id, i) => {
      const r = resolved[i];
      if (!r) return;
      packs[id] = r.pack;
      if (r.real) loaded++;
      else fallbacks.push({ id, reason: r.reason ?? 'network' });
    });
    return { requested: ids.length, loaded, fallbacks, timedOut, packs };
  }

  // ---- preloadMatch ---------------------------------------------------------
  function preloadMatch(cfg: MatchConfig, popts: PreloadOptions = {}): Preload {
    const players = [...cfg.players].sort((a, b) => a.slot - b.slot);
    const local = players.find((p) => p.id === popts.localPlayerId);

    const blockingWants: { id: string; kind: PackKind }[] = [
      { id: cfg.courseId, kind: 'course' },
      { id: cfg.themeId, kind: 'theme' },
    ];
    if (local) blockingWants.push({ id: local.skinId, kind: 'skin' });
    const blockingIds = [...new Set(blockingWants.map((w) => w.id))];

    const blockingTasks = blockingWants.map((w) => resolve(w.id, w.kind));
    const slots = new Map<string, Resolved>();
    blockingWants.forEach((w, i) => {
      void blockingTasks[i]?.then((r) => slots.set(w.id, r));
    });

    const blocking = (async (): Promise<PreloadReport> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((r) => {
        timer = setTimeout(() => r('timeout'), blockingTimeoutMs);
      });
      const won = await Promise.race([Promise.all(blockingTasks).then(() => 'done' as const), timeout]);
      clearTimeout(timer);
      const timedOut = won === 'timeout';
      const resolved = blockingIds.map((id) => {
        const kind = blockingWants.find((w) => w.id === id)?.kind ?? 'skin';
        return slots.get(id) ?? fallback(kind, 'timeout');
      });
      return report(blockingIds, resolved, timedOut);
    })();

    const background = (async (): Promise<PreloadReport> => {
      const localSlot = local?.slot ?? 0;
      const ordered = players
        .filter((p) => p.id !== local?.id)
        .sort((a, b) => Math.abs(a.slot - localSlot) - Math.abs(b.slot - localSlot));
      const ids = [...new Set(ordered.map((p) => p.skinId))].filter((id) => !blockingIds.includes(id));
      const run = limiter(concurrency);
      const batchable = ids.filter((id) => id.startsWith('g:'));
      const others = ids.filter((id) => !id.startsWith('g:'));
      const tasks = new Map<string, Promise<Resolved>>();
      loadMany(batchable, 'skin', run).forEach((p, i) => {
        const id = batchable[i];
        if (id !== undefined) tasks.set(id, p);
      });
      for (const id of others)
        tasks.set(
          id,
          run(() => resolve(id, 'skin')),
        );
      const resolved = await Promise.all(ids.map((id) => tasks.get(id) as Promise<Resolved>));
      return report(ids, resolved);
    })().catch(() => report([], []));

    return { blocking, background };
  }

  // ---- generate, list, report -----------------------------------------------
  function typedError(res: Http, what: string): AssetError {
    const msg = (res.body as { error?: unknown } | null)?.error;
    const text = typeof msg === 'string' ? msg : `${what} failed (${res.status})`;
    if (res.status === 429) {
      const body = (res.body as { retryAfterSec?: unknown } | null)?.retryAfterSec;
      const retry = res.retryAfterSec ?? (typeof body === 'number' ? body : null);
      return new AssetError('rate_limited', text, retry);
    }
    if (res.status === 422 || res.status === 400 || res.status === 404) return new AssetError('invalid', text);
    return new AssetError('unavailable', text);
  }

  async function call(url: string, init?: RequestInit): Promise<Http> {
    try {
      return await http(url, init);
    } catch (e) {
      const reason = e instanceof Fail ? e.reason : 'network';
      throw new AssetError(reason === 'timeout' ? 'unavailable' : 'network', `request failed (${reason})`);
    }
  }

  async function list(kind: PackKind, cursor?: string | null): Promise<PackPage> {
    const q = new URLSearchParams({ kind });
    if (cursor) q.set('cursor', cursor);
    const res = await call(`${apiBase}/api/packs?${q.toString()}`);
    if (res.status !== 200) throw typedError(res, 'list');
    const body = res.body as { items?: unknown; nextCursor?: unknown } | null;
    if (!body || !Array.isArray(body.items)) throw new AssetError('unavailable', 'list returned an unexpected answer');
    return {
      items: body.items as PackPage['items'],
      nextCursor: typeof body.nextCursor === 'string' ? body.nextCursor : null,
    };
  }

  async function generate(kind: PackKind, prompt: string, gopts: { themeId?: string } = {}): Promise<Pack> {
    const payload: Record<string, unknown> = { kind, prompt, clientId: clientId() };
    if (gopts.themeId) payload.themeId = gopts.themeId;
    const res = await call(`${apiBase}/api/packs/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status !== 200) throw typedError(res, 'generate');
    const body = res.body as { id?: unknown; pack?: unknown } | null;
    try {
      const pack = validate(body?.pack, typeof body?.id === 'string' ? body.id : null, kind);
      remember(pack, true);
      return pack;
    } catch {
      throw new AssetError('invalid', 'the server sent a pack that did not validate');
    }
  }

  async function reportPack(id: string): Promise<void> {
    const res = await call(`${apiBase}/api/packs/${encodeURIComponent(id)}/report?id=${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: clientId() }),
    });
    if (res.status !== 204 && res.status !== 200) throw typedError(res, 'report');
  }

  return {
    async getPack(id, kind = 'skin') {
      return (await resolve(id, kind)).pack;
    },
    preloadMatch,
    list,
    generate,
    report: reportPack,
    clientId,
    on(_evt, fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
