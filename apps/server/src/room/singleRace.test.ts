// One stage per match: a vote-started room runs exactly one race, then goes back to the lobby; nobody is eliminated.
import { afterEach, describe, expect, it } from 'bun:test';
import { PROTOCOL_VERSION } from '@wobble/shared/constants';
import { fixtureCourse } from '@wobble/shared';
import type { ServerMessage } from '@wobble/shared/types';
import { createGameServer } from '../index.ts';
import type { GameServer } from '../index.ts';

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

class Client {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
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
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  all<T extends ServerMessage['t']>(t: T): Of<T>[] {
    return this.msgs.filter((m) => m.t === t) as Of<T>[];
  }
  async until<T>(pred: () => T | undefined | null | false, ms = 8000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = pred();
      if (v) return v;
      if (Date.now() > deadline) throw new Error('timeout');
      await Bun.sleep(20);
    }
  }
}

let game: GameServer;
const clients: Client[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await game?.close();
});

async function room(n: number) {
  game = createGameServer({
    port: 0,
    hostname: '127.0.0.1',
    timings: {
      autoStartMs: 0,
      voteMs: 100,
      loadingMaxMs: 50,
      countdownMs: 50,
      timeLimitMs: 150,
      resultsMs: 50,
    },
    resolveCourse: async () => structuredClone(fixtureCourse),
  });
  const url = `ws://127.0.0.1:${game.listen()}`;
  let code = 'new';
  for (let i = 0; i < n; i++) {
    const c = await new Client(url).open();
    clients.push(c);
    c.send({ t: 'hello', v: PROTOCOL_VERSION, name: `P${i}`, clientId: `single-race-${i}-abcdefgh`, room: code });
    const w = await c.until(() => c.all('welcome')[0]);
    code = w.room.code;
  }
  return clients[0]!;
}

const phaseOf = (c: Client) => {
  let p = '';
  for (const m of c.msgs) if (m.t === 'roomPatch' && m.phase) p = m.phase;
  return p;
};

describe('a match is one race', () => {
  it('a vote-started room runs exactly one race with everyone, then back to the lobby', async () => {
    const host = await room(5);
    host.send({ t: 'startVote' });
    await host.until(() => host.all('raceEnd').length === 1 && phaseOf(host) === 'lobby');
    await Bun.sleep(300);
    for (const c of clients) {
      expect(c.all('voteResult').length).toBe(1);
      expect(c.all('matchConfig').length).toBe(1);
      expect(c.all('raceEnd').length).toBe(1);
      expect(c.all('matchConfig')[0]!.players.length).toBe(5);
      expect(c.ws.readyState).toBe(WebSocket.OPEN);
    }
    expect(phaseOf(host)).toBe('lobby');
  }, 10_000);

  it('a plain start is a single race too', async () => {
    const host = await room(3);
    host.send({ t: 'start' });
    await host.until(() => host.all('raceEnd').length === 1 && phaseOf(host) === 'lobby');
    await Bun.sleep(200);
    expect(host.all('matchConfig').length).toBe(1);
  }, 10_000);
});
