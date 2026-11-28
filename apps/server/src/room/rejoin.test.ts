// Pressing Play again right after cancelling must not leave the old seat behind: the first connection's
// member lingers during the reconnect grace, and without this the second join becomes "Ann 2", then "Ann 3".
// Real createGameServer({ port: 0 }) + WebSocket clients.
import { afterEach, describe, expect, it } from 'bun:test';
import { PROTOCOL_VERSION } from '@wobble/shared/constants';
import { fixtureCourse } from '@wobble/shared';
import type { ServerMessage } from '@wobble/shared/types';
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
  hello(room: string, name: string, clientId: string) {
    this.ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, clientId, room }));
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
}

let game: GameServer;
let url = '';
const clients: Client[] = [];

async function boot() {
  game = createGameServer({
    port: 0,
    hostname: '127.0.0.1',
    // A long grace: the old seat would stay for 5 s, far longer than these tests run.
    timings: { reconnectMs: 5000, autoStartMs: 60_000 },
    resolveCourse: async () => structuredClone(fixtureCourse),
  });
  url = `ws://127.0.0.1:${game.listen()}`;
}
async function join(room: string, name: string, clientId: string) {
  const c = await new Client(url).open();
  clients.push(c);
  c.hello(room, name, clientId);
  return { c, w: await c.welcome() };
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await game?.close();
});

describe('rejoin after cancel', () => {
  it('tapping Play again keeps the name and leaves no ghost seat', async () => {
    await boot();
    const first = await join('new', 'Ann', 'human-0000-aaaa');
    first.c.ws.close();
    await Bun.sleep(150); // the server has seen the close; the old seat is in its reconnect grace

    const again = await join(first.w.room.code, 'Ann', 'human-0000-aaaa');
    expect(again.w.room.players.map((p) => p.name)).toEqual(['Ann']);
  });

  it('stays at one seat after several cancel and Play cycles', async () => {
    await boot();
    let w = (await join('new', 'Ann', 'human-0000-aaaa')).w;
    const code = w.room.code;
    for (let i = 0; i < 3; i++) {
      clients[clients.length - 1]!.ws.close();
      await Bun.sleep(150);
      w = (await join(code, 'Ann', 'human-0000-aaaa')).w;
    }
    expect(w.room.players.map((p) => p.name)).toEqual(['Ann']);
  });

  it('a different browser with the same name still gets a distinct name', async () => {
    await boot();
    const a = await join('new', 'Ann', 'human-0000-aaaa');
    const b = await join(a.w.room.code, 'Ann', 'human-0000-bbbb');
    expect(b.w.room.players).toHaveLength(2);
    expect(new Set(b.w.room.players.map((p) => p.name)).size).toBe(2);
  });

  it('a second tab of the same browser does not kick the connected first tab', async () => {
    await boot();
    const a = await join('new', 'Ann', 'human-0000-aaaa');
    const b = await join(a.w.room.code, 'Ann', 'human-0000-aaaa');
    expect(b.w.room.players.filter((p) => p.connected)).toHaveLength(2);
  });
});
