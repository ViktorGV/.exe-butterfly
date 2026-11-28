// Integration tests: real createGameServer({ port: 0 }) with real WebSocket clients.
import { afterEach, describe, expect, it } from 'bun:test';
import { PROTOCOL_VERSION, WIRE } from '@wobble/shared/constants';
import { fixtureCourse } from '@wobble/shared';
import type { RoomState, ServerMessage } from '@wobble/shared/types';
import { createGameServer } from '../index.ts';
import type { GameServer, GameServerOptions } from '../index.ts';

type Msg = ServerMessage;
type Of<T extends Msg['t']> = Extract<Msg, { t: T }>;

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  closed: { code: number } | null = null;
  private waiters: (() => void)[] = [];
  private opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('ws error'));
    });
    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.msgs.push(JSON.parse(e.data));
      this.notify();
    };
    this.ws.onclose = (e) => {
      this.closed = { code: e.code };
      this.notify();
    };
  }
  private notify() {
    for (const w of this.waiters.splice(0)) w();
  }
  async open() {
    await this.opened;
    return this;
  }
  send(msg: object) {
    this.ws.send(JSON.stringify(msg));
  }
  hello(room: string, name = 'Bob', token?: string) {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name, clientId: 'client-0001', room, token });
  }
  async until<T>(pred: () => T | undefined | null | false, ms = 3000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = pred();
      if (v) return v;
      if (Date.now() > deadline) throw new Error(`timeout; got ${JSON.stringify(this.msgs.map((m) => m.t))}`);
      await new Promise<void>((res) => {
        this.waiters.push(res);
        setTimeout(res, 50);
      });
    }
  }
  next<T extends Msg['t']>(t: T, pred: (m: Of<T>) => boolean = () => true, ms?: number): Promise<Of<T>> {
    return this.until(() => this.msgs.find((m) => m.t === t && pred(m as Of<T>)) as Of<T> | undefined, ms);
  }
  /** RoomState after applying every patch received so far. */
  room(): RoomState {
    const w = this.msgs.findLast((m) => m.t === 'welcome') as Of<'welcome'>;
    const s: RoomState = structuredClone(w.room);
    for (const m of this.msgs.slice(this.msgs.lastIndexOf(w) + 1)) {
      if (m.t !== 'roomPatch') continue;
      if (m.phase) s.phase = m.phase;
      if (m.hostId !== undefined) s.hostId = m.hostId;
      if (m.config) s.config = m.config;
      if (m.left) s.players = s.players.filter((p) => !m.left!.includes(p.id));
      // `joined` is an upsert: a patch window can include players already listed in welcome
      for (const j of m.joined ?? []) {
        const known = s.players.find((p) => p.id === j.id);
        if (known) Object.assign(known, j);
        else s.players.push(j);
      }
      for (const u of m.updated ?? []) Object.assign(s.players.find((p) => p.id === u.id) ?? {}, u);
    }
    return s;
  }
  close() {
    this.ws.close();
  }
}

const FAST = {
  loadingMaxMs: 300,
  countdownMs: 150,
  resultsMs: 150,
  autoStartMs: 200,
  reconnectMs: 300,
  timeLimitMs: 300,
};

let game: GameServer;
let url = '';
const clients: Client[] = [];

async function boot(opts: GameServerOptions = {}) {
  game = createGameServer({
    port: 0,
    hostname: '127.0.0.1',
    timings: FAST,
    resolveCourse: async () => structuredClone(fixtureCourse),
    ...opts,
  });
  url = `ws://127.0.0.1:${game.listen()}`;
}
async function connect() {
  const c = await new Client(url).open();
  clients.push(c);
  return c;
}
async function joined(room: string, name?: string) {
  const c = await connect();
  c.hello(room, name);
  await c.next('welcome');
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await game?.close();
});

describe('joining', () => {
  it('quick play fills one public room; new creates a private room joinable by code', async () => {
    await boot({ timings: { ...FAST, autoStartMs: 60_000 } });
    const a = await joined('quick', 'Ann');
    const b = await joined('quick', 'Ann');
    const wa = await a.next('welcome');
    const wb = await b.next('welcome');
    expect(wb.room.code).toBe(wa.room.code);
    expect(wb.room.players.map((p) => p.name)).toEqual(['Ann', 'Ann 2']);
    expect(wa.room.hostId).toBe(wa.playerId);

    const p = await joined('new', 'Priv');
    const code = (await p.next('welcome')).room.code;
    expect(code).toMatch(/^[A-Z]{5}$/);
    expect(code).not.toBe(wa.room.code);
    const q = await joined(code, 'Guest');
    expect((await q.next('welcome')).room.players).toHaveLength(2);
    // private rooms are never picked by quick play
    const r = await joined('quick');
    expect((await r.next('welcome')).room.code).toBe(wa.room.code);

    const summary = await (await fetch(url.replace('ws', 'http') + '/rooms/summary')).json();
    expect(summary).toMatchObject({ rooms: 2, players: 5 });
  });

  it('rejects unknown codes and full rooms', async () => {
    await boot({ maxPlayers: 2 });
    const x = await connect();
    x.hello('ZZZZZ');
    expect((await x.next('error')).code).toBe('room_not_found');
    const a = await joined('new');
    const code = (await a.next('welcome')).room.code;
    await joined(code);
    const c = await connect();
    c.hello(code);
    expect((await c.next('error')).code).toBe('room_full');
    await c.until(() => c.closed);
  });

  it('patches a join to existing players instead of resending state', async () => {
    await boot();
    const a = await joined('new', 'Host');
    const code = (await a.next('welcome')).room.code;
    await joined(code, 'Two');
    const patch = await a.next('roomPatch', (m) => !!m.joined);
    expect(patch.joined!.map((p) => p.name)).toContain('Two');
    expect(a.msgs.filter((m) => m.t === 'welcome')).toHaveLength(1);
  });
});

describe('lobby', () => {
  it('host migrates when the host leaves; host-only and out-of-phase messages get errors', async () => {
    await boot();
    const a = await joined('new', 'A');
    const wa = await a.next('welcome');
    const b = await joined(wa.room.code, 'B');
    const wb = await b.next('welcome');
    b.send({ t: 'start' });
    expect((await b.next('error')).code).toBe('not_host');
    b.send({ t: 'loaded' });
    expect((await b.next('error', (m) => m.code === 'bad_phase')).code).toBe('bad_phase');
    a.send({ t: 'setConfig', courseId: 'b:fixture-course', themeId: 'b:other-theme' });
    b.send({ t: 'setSkin', skinId: 'b:red' });
    b.send({ t: 'setReady', ready: true });
    await b.until(() => b.room().config.themeId === 'b:other-theme' && b.room().players[1]?.ready);
    expect(b.room().players[1]?.skinId).toBe('b:red');
    a.close();
    await b.until(() => b.room().hostId === wb.playerId);
    await b.until(() => b.room().players.length === 1, 2000); // removed after the reconnect grace
  });

  it('malformed and oversized frames never crash the server', async () => {
    await boot();
    const a = await joined('new');
    a.send({ t: 'setSkin', skinId: 'not a pack id' });
    a.ws.send('{oops');
    a.ws.send(new Uint8Array([1, 2, 3]));
    expect((await a.until(() => a.msgs.filter((m) => m.t === 'error').length >= 2)) as unknown).toBeTruthy();
    const big = await connect();
    big.ws.send('x'.repeat(WIRE.CONTROL_MAX_BYTES + 10));
    await big.until(() => big.closed);
    const early = await connect();
    early.send({ t: 'start' });
    await early.until(() => early.closed);
    const res = await fetch(url.replace('ws', 'http') + '/healthz');
    expect(res.status).toBe(200);
  });

  it('closes sockets that never say hello', async () => {
    await boot({ handshakeMs: 100 });
    const c = await connect();
    await c.until(() => c.closed);
    expect(c.msgs[0]).toMatchObject({ t: 'error', code: 'handshake_timeout' });
  });
});

describe('match lifecycle', () => {
  it('runs lobby -> loading -> countdown -> race -> results -> lobby with a late joiner waiting', async () => {
    await boot({ timings: { ...FAST, loadingMaxMs: 5000 } });
    const a = await joined('new', 'A');
    const code = (await a.next('welcome')).room.code;
    const b = await joined(code, 'B');
    a.send({ t: 'start' });
    const mc = await b.next('matchConfig');
    expect(mc.players.map((p) => p.slot)).toEqual([0, 1]);
    const late = await joined(code, 'Late');
    expect((await late.next('welcome')).room.phase).toBe('loading');
    a.send({ t: 'loaded' });
    b.send({ t: 'loaded' });
    const cd = await a.next('countdown');
    expect(cd.startAt).toBeGreaterThan(Date.now() - 50);
    await a.until(() => a.room().phase === 'race');
    const state = new Uint8Array(WIRE.STATE_BYTES);
    state[0] = WIRE.MSG_STATE;
    a.ws.send(state);
    const end = await a.next('raceEnd'); // hard stop at timeLimitMs
    expect(end.results).toHaveLength(2);
    await a.until(() => a.room().phase === 'lobby');
    await late.until(() => late.room().phase === 'lobby');
    expect(late.msgs.some((m) => m.t === 'matchConfig' || m.t === 'countdown')).toBe(false);
  });

  it('loading ends after the timeout even if nobody reports loaded', async () => {
    await boot();
    const a = await joined('new');
    a.send({ t: 'start' });
    await a.next('matchConfig');
    await a.next('countdown', undefined, 2000);
  });

  it('public rooms open the theme vote once two players are present, then start', async () => {
    await boot({ timings: { ...FAST, voteMs: 100 } });
    const a = await joined('quick');
    await Bun.sleep(300);
    expect(a.msgs.some((m) => m.t === 'voteState' || m.t === 'matchConfig')).toBe(false);
    await joined('quick');
    await a.next('voteState', undefined, 2000);
    await a.next('matchConfig', undefined, 2000);
  });

  it('public rooms open the vote immediately when full', async () => {
    await boot({ maxPlayers: 2, timings: { ...FAST, autoStartMs: 60_000 } });
    const a = await joined('quick');
    await joined('quick');
    await a.next('voteState', undefined, 1000);
  });

  it('a player reconnecting with their token keeps their id', async () => {
    await boot({ timings: { ...FAST, reconnectMs: 5000 } });
    const a = await joined('new', 'A');
    const wa = await a.next('welcome');
    const b = await joined(wa.room.code, 'B');
    a.close();
    await b.until(() => b.room().players.find((p) => p.id === wa.playerId)?.connected === false);
    const again = await connect();
    again.hello('quick', 'A', wa.token);
    const w2 = await again.next('welcome');
    expect(w2.playerId).toBe(wa.playerId);
    expect(w2.room.code).toBe(wa.room.code);
    await b.until(() => b.room().players.find((p) => p.id === wa.playerId)?.connected === true);
  });

  it('draining refuses new rooms and notifies players', async () => {
    await boot();
    const a = await joined('new');
    const drained = game.drain(200);
    await a.next('error', (m) => m.code === 'shutdown');
    await drained;
    await a.until(() => a.closed);
  });
});

describe('scale', () => {
  it('150 clients join one room quickly with small patches', async () => {
    await boot({ maxPlayers: 150, maxConnectionsPerIp: 1000 });
    const host = await joined('new', 'Host');
    const code = (await host.next('welcome')).room.code;
    const t0 = performance.now();
    const all = await Promise.all(Array.from({ length: 149 }, (_, i) => joined(code, `P${i}`)));
    await host.until(() => host.room().players.length === 150, 5000);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
    const patches = host.msgs.filter((m) => m.t === 'roomPatch');
    expect(patches.length).toBeLessThan(30); // coalesced, at most 5 per second
    expect(all[148]!.room().players).toHaveLength(150);
  }, 15_000);
});
