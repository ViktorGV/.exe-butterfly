// Host handoff prefers humans: load-test bots (clientId "bot-...") never press start, so a bot host
// would leave the room stuck in the lobby (#125). Real createGameServer({ port: 0 }) + WebSocket clients.
import { afterEach, describe, expect, it } from 'bun:test';
import { PROTOCOL_VERSION } from '@wobble/shared/constants';
import { fixtureCourse } from '@wobble/shared';
import type { RoomState, ServerMessage } from '@wobble/shared/types';
import { createGameServer } from '../index.ts';
import type { GameServer } from '../index.ts';

type Msg = ServerMessage;
type Of<T extends Msg['t']> = Extract<Msg, { t: T }>;

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  private opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('ws error'));
    });
    this.ws.onmessage = (e) => {
      if (typeof e.data === 'string') this.msgs.push(JSON.parse(e.data));
    };
  }
  async open() {
    await this.opened;
    return this;
  }
  hello(room: string, name: string, clientId: string, token?: string) {
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, clientId, room, token }));
  }
  async until<T>(pred: () => T | undefined | null | false, ms = 3000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = pred();
      if (v) return v;
      if (Date.now() > deadline) throw new Error('timeout');
      await Bun.sleep(20);
    }
  }
  welcome(): Promise<Of<'welcome'>> {
    return this.until(() => this.msgs.findLast((m) => m.t === 'welcome') as Of<'welcome'> | undefined);
  }
  /** RoomState after applying every patch received so far. */
  room(): RoomState {
    const w = this.msgs.findLast((m) => m.t === 'welcome') as Of<'welcome'>;
    const s: RoomState = structuredClone(w.room);
    for (const m of this.msgs.slice(this.msgs.lastIndexOf(w) + 1)) {
      if (m.t !== 'roomPatch') continue;
      if (m.hostId !== undefined) s.hostId = m.hostId;
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
}

let game: GameServer;
let url = '';
const clients: Client[] = [];

async function boot() {
  game = createGameServer({
    port: 0,
    hostname: '127.0.0.1',
    timings: { reconnectMs: 5000, autoStartMs: 60_000 },
    resolveCourse: async () => structuredClone(fixtureCourse),
  });
  url = `ws://127.0.0.1:${game.listen()}`;
}
async function join(room: string, name: string, clientId: string, token?: string) {
  const c = await new Client(url).open();
  clients.push(c);
  c.hello(room, name, clientId, token);
  return { c, w: await c.welcome() };
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await game?.close();
});

describe('host handoff', () => {
  it('passes host to a human, not to a bot that joined earlier', async () => {
    await boot();
    const a = await join('new', 'Ann', 'human-0000-aaaa');
    await join(a.w.room.code, 'bot0-1', 'bot-bot0-1-abcdefgh');
    const c = await join(a.w.room.code, 'Cat', 'human-0000-cccc');
    a.c.ws.close();
    await c.c.until(() => c.c.room().hostId === c.w.playerId);
  });

  it('a human joining a room hosted by a bot becomes host', async () => {
    await boot();
    const bot = await join('new', 'bot0-0', 'bot-bot0-0-abcdefgh');
    expect(bot.w.room.hostId).toBe(bot.w.playerId);
    const h = await join(bot.w.room.code, 'Hal', 'human-0000-hhhh');
    await h.c.until(() => h.c.room().hostId === h.w.playerId);
  });

  it('a bot holds host only while no human is connected, and hands it back', async () => {
    await boot();
    const a = await join('new', 'Ann', 'human-0000-aaaa');
    const b = await join(a.w.room.code, 'bot0-1', 'bot-bot0-1-abcdefgh');
    a.c.ws.close();
    await b.c.until(() => b.c.room().hostId === b.w.playerId);
    const again = await join('quick', 'Ann', 'human-0000-aaaa', a.w.token);
    expect(again.w.playerId).toBe(a.w.playerId);
    await b.c.until(() => b.c.room().hostId === a.w.playerId);
  });
});
