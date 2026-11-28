// Reconnect grace (#66, MP-6): policy unit tests, the race session keeping progress, and real
// createGameServer({ port: 0 }) integration tests with real WebSocket clients.
import { afterEach, describe, expect, it } from 'bun:test';
import { PROTOCOL_VERSION } from '@wobble/shared/constants';
import { fixtureCourse } from '@wobble/shared';
import type { RoomState, ServerMessage } from '@wobble/shared/types';
import { createGameServer } from '../index.ts';
import type { GameServer, GameServerOptions } from '../index.ts';
import { createHarness } from '../race/harness.ts';
import { DEFAULT_LOBBY_GRACE_MS, graceMs } from './reconnect.ts';

type Msg = ServerMessage;
type Of<T extends Msg['t']> = Extract<Msg, { t: T }>;

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
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
    this.ws.onclose = () => this.notify();
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

const TIMINGS = {
  loadingMaxMs: 100,
  countdownMs: 100,
  resultsMs: 100,
  autoStartMs: 60_000,
  timeLimitMs: 20_000,
  reconnectMs: 1500,
  lobbyReconnectMs: 150,
};

let game: GameServer;
let url = '';
const clients: Client[] = [];

async function boot(opts: GameServerOptions = {}) {
  game = createGameServer({
    port: 0,
    hostname: '127.0.0.1',
    timings: TIMINGS,
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
const hasPlayer = (c: Client, id: number) => c.room().players.some((p) => p.id === id);

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await game?.close();
});

describe('graceMs', () => {
  it('uses the long grace outside the lobby and the short one in the lobby', () => {
    const t = { reconnectMs: 15_000 };
    expect(DEFAULT_LOBBY_GRACE_MS).toBe(5000);
    expect(graceMs('lobby', t)).toBe(5000);
    for (const phase of ['loading', 'countdown', 'race']) expect(graceMs(phase, t)).toBe(15_000);
  });

  it('is configurable and never longer in the lobby than in a race', () => {
    expect(graceMs('lobby', { reconnectMs: 15_000, lobbyReconnectMs: 2000 })).toBe(2000);
    expect(graceMs('race', { reconnectMs: 15_000, lobbyReconnectMs: 2000 })).toBe(15_000);
    expect(graceMs('lobby', { reconnectMs: 3000 })).toBe(3000);
    expect(graceMs('lobby', { reconnectMs: 3000, lobbyReconnectMs: 9000 })).toBe(3000);
  });
});

describe('race session progress', () => {
  it("keeps a player's checkpoint across a disconnect and reconnect", () => {
    const h = createHarness({ count: 3 });
    let id = 0;
    let checkpoint = -1;
    for (let i = 0; i < 600 && checkpoint < 0; i++) {
      h.step();
      const r = h.session.results().find((x) => x.checkpoint >= 0);
      if (r) {
        id = r.id;
        checkpoint = r.checkpoint;
      }
    }
    expect(checkpoint).toBeGreaterThanOrEqual(0);

    h.session.setConnected(id, false);
    for (let i = 0; i < 5; i++) h.step(new Set([id])); // the bot sends nothing while it is away
    h.session.setConnected(id, true);
    h.step();
    expect(h.session.results().find((x) => x.id === id)?.checkpoint).toBeGreaterThanOrEqual(checkpoint);
  });
});

describe('reconnect grace in a room', () => {
  it('gives up a lobby seat after the short lobby grace, not the long one', async () => {
    await boot({ timings: { ...TIMINGS, reconnectMs: 5000, lobbyReconnectMs: 150 } });
    const a = await joined('new', 'A');
    const wa = await a.next('welcome');
    const b = await joined(wa.room.code, 'B');
    a.close();
    await b.until(() => b.room().players.find((p) => p.id === wa.playerId)?.connected === false);
    await b.until(() => !hasPlayer(b, wa.playerId), 2000); // far sooner than reconnectMs
  });

  it('a lobby player who comes back after the grace gets a new id', async () => {
    await boot({ timings: { ...TIMINGS, reconnectMs: 5000, lobbyReconnectMs: 100 } });
    const a = await joined('new', 'A');
    const wa = await a.next('welcome');
    const b = await joined(wa.room.code, 'B');
    a.close();
    await b.until(() => !hasPlayer(b, wa.playerId), 2000);
    const again = await connect();
    again.hello(wa.room.code, 'A', wa.token);
    const w2 = await again.next('welcome');
    expect(w2.playerId).not.toBe(wa.playerId);
    expect(w2.token).not.toBe(wa.token);
  });

  it('keeps a race seat past the lobby grace and re-attaches the same player', async () => {
    await boot();
    const a = await joined('new', 'A');
    const wa = await a.next('welcome');
    const b = await joined(wa.room.code, 'B');
    a.send({ t: 'start' });
    await b.next('matchConfig');
    await b.until(() => b.room().phase === 'race', 4000);

    a.close();
    await b.until(() => b.room().players.find((p) => p.id === wa.playerId)?.connected === false);
    await Bun.sleep(500); // longer than the lobby grace (150 ms), shorter than the race grace (1500 ms)
    expect(hasPlayer(b, wa.playerId)).toBe(true);

    const again = await connect();
    again.hello('quick', 'A', wa.token);
    const w2 = await again.next('welcome');
    expect(w2.playerId).toBe(wa.playerId);
    expect(w2.room.phase).toBe('race');
    await b.until(() => b.room().players.find((p) => p.id === wa.playerId)?.connected === true);
  });

  it('removes a race player who stays away longer than the race grace', async () => {
    await boot({ timings: { ...TIMINGS, reconnectMs: 400 } });
    const a = await joined('new', 'A');
    const wa = await a.next('welcome');
    const b = await joined(wa.room.code, 'B');
    a.send({ t: 'start' });
    await b.next('matchConfig');
    await b.until(() => b.room().phase === 'race', 4000);
    a.close();
    await b.until(() => !hasPlayer(b, wa.playerId), 3000);
  });

  it('a wrong token cannot take over another player', async () => {
    await boot();
    const a = await joined('new', 'A');
    const wa = await a.next('welcome');
    const b = await joined(wa.room.code, 'B');

    const mallory = await connect();
    mallory.hello(wa.room.code, 'Mallory', '00000000-0000-4000-8000-000000000000');
    const wm = await mallory.next('welcome');
    expect(wm.playerId).not.toBe(wa.playerId);
    expect(wm.playerId).not.toBe(b.room().players.find((p) => p.name === 'B')?.id);

    await b.until(() => b.room().players.some((p) => p.id === wm.playerId));
    expect(b.room().players.find((p) => p.id === wa.playerId)?.connected).toBe(true); // A was not displaced
  });
});
