// Elimination show (#35): pure rules, then a real createGameServer({ port: 0 }) running a show to one winner.
import { afterEach, describe, expect, it } from 'bun:test';
import { PROTOCOL_VERSION } from '@wobble/shared/constants';
import { fixtureCourse } from '@wobble/shared';
import type { ServerMessage } from '@wobble/shared/types';
import { createGameServer } from '../index.ts';
import type { GameServer } from '../index.ts';
import { createShow, qualifiers, showQualifyCount, themeOrder } from './index.ts';

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

describe('show rules', () => {
  it('orders themes with the vote winner first and no repeats', () => {
    expect(themeOrder('b', ['a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });

  it('keeps ~60% per round and one in the final', () => {
    const s = createShow('a', ['a', 'b', 'c', 'd', 'e'], []);
    expect(showQualifyCount(s, 150)).toBe(90);
    expect(showQualifyCount(s, 3)).toBe(2);
    expect(showQualifyCount(s, 2)).toBe(1);
    s.round = 4; // last theme
    expect(showQualifyCount(s, 50)).toBe(1);
  });

  it('takes the top places', () => {
    const r = [3, 1, 2].map((place, i) => ({ id: i + 10, place, timeMs: null, checkpoint: 0 }));
    expect(qualifiers(r, 2)).toEqual([11, 12]);
  });
});

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
    c.send({ t: 'hello', v: PROTOCOL_VERSION, name: `P${i}`, clientId: `show-test-${i}-abcdefgh`, room: code });
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

describe('show in a real room', () => {
  it('runs rounds 5 -> 3 -> 2 on distinct themes to one winner, then back to the lobby', async () => {
    const host = await room(5);
    host.send({ t: 'startVote' });
    // three rounds: the third matchConfig is the final (one qualifier)
    await host.until(() => clients.some((c) => c.all('matchConfig').some((m) => m.qualifyCount === 1)));
    await host.until(() => host.all('raceEnd').length === 3 && phaseOf(host) === 'lobby');

    const configs = new Map<number, Of<'matchConfig'>>();
    for (const c of clients) for (const m of c.all('matchConfig')) configs.set(m.players.length, m);
    expect([...configs.keys()].sort()).toEqual([2, 3, 5]);
    expect(configs.get(5)!.qualifyCount).toBe(3);
    expect(configs.get(3)!.qualifyCount).toBe(2);
    expect(configs.get(2)!.qualifyCount).toBe(1);
    const themes = [5, 3, 2].map((n) => configs.get(n)!.themeId);
    expect(themes[1]).not.toBe(themes[0]);

    // the next round's players are exactly the previous round's top places
    const ends = host.all('raceEnd');
    const top = (i: number, k: number) =>
      [...ends[i]!.results]
        .sort((a, b) => a.place - b.place)
        .slice(0, k)
        .map((r) => r.id)
        .sort();
    expect(
      configs
        .get(3)!
        .players.map((p) => p.id)
        .sort(),
    ).toEqual(top(0, 3));
    expect(
      configs
        .get(2)!
        .players.map((p) => p.id)
        .sort(),
    ).toEqual(top(1, 2));

    // eliminated players stayed in the room and got every round's results
    const out = clients.find((c) => c.all('matchConfig').length === 1)!;
    expect(out.ws.readyState).toBe(WebSocket.OPEN);
    expect(out.all('raceEnd').length).toBe(3);
  }, 20_000);

  it('a plain start stays a single race', async () => {
    const host = await room(3);
    host.send({ t: 'start' });
    await host.until(() => host.all('raceEnd').length === 1 && phaseOf(host) === 'lobby');
    await Bun.sleep(200);
    expect(host.all('matchConfig').length).toBe(1);
    expect(host.all('matchConfig')[0]!.qualifyCount).toBe(2);
  }, 10_000);
});
