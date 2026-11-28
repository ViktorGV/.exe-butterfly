// The villain over a real room (#84): two real WebSocket clients on createGameServer({ port: 0 }).
// A pusher who made someone fall twice is marked; once any player reaches the last checkpoint the
// villain throws at the marked player only, and only the marked player is ever hit.
import { afterEach, describe, expect, it } from 'bun:test';
import { fixtureCourse } from '@wobble/shared';
import { Anim, BUTTERFLY, PROTOCOL_VERSION } from '@wobble/shared/constants';
import { encodeState } from '@wobble/shared/protocol/index';
import type { ServerMessage, Vec3 } from '@wobble/shared/types';
import { createGameServer } from '../index.ts';
import type { GameServer } from '../index.ts';
import { gridPoint } from '../race/geometry.ts';

type Msg = ServerMessage;
type Of<T extends Msg['t']> = Extract<Msg, { t: T }>;

class Client {
  ws: WebSocket;
  msgs: Msg[] = [];
  seq = 0;
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
      for (const w of this.waiters.splice(0)) w();
    };
  }
  async open() {
    await this.opened;
    return this;
  }
  send(msg: object) {
    this.ws.send(JSON.stringify(msg));
  }
  hello(room: string, name: string) {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name, clientId: `client-${name}-0001`, room });
  }
  /** One STATE frame at `pos`, `raceMs` into the race. */
  state(pos: Vec3, raceMs: number, respawned = false) {
    const buf = encodeState(
      { pos, yaw: 0, anim: Anim.IDLE, grounded: true, finished: false, respawned },
      this.seq++,
      raceMs,
    );
    this.ws.send(buf);
  }
  async until<T>(pred: () => T | undefined | null | false, ms = 4000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = pred();
      if (v) return v;
      if (Date.now() > deadline) throw new Error(`timeout; got ${JSON.stringify(this.msgs.map((m) => m.t))}`);
      await new Promise<void>((res) => {
        this.waiters.push(res);
        setTimeout(res, 25);
      });
    }
  }
  next<T extends Msg['t']>(t: T, pred: (m: Of<T>) => boolean = () => true, ms?: number): Promise<Of<T>> {
    return this.until(() => this.msgs.find((m) => m.t === t && pred(m as Of<T>)) as Of<T> | undefined, ms);
  }
  count(t: Msg['t']) {
    return this.msgs.filter((m) => m.t === t).length;
  }
}

const TIMINGS = {
  loadingMaxMs: 2000,
  countdownMs: 150,
  resultsMs: 200,
  autoStartMs: 60_000,
  timeLimitMs: 30_000,
  reconnectMs: 1500,
  lobbyReconnectMs: 600,
};

let game: GameServer;
const clients: Client[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.close();
  await game?.close();
});

/** Two players in a started race, past the countdown. `a` has slot 0 and `b` slot 1 (1 m apart). */
async function startRace() {
  game = createGameServer({
    port: 0,
    hostname: '127.0.0.1',
    timings: TIMINGS,
    resolveCourse: async () => structuredClone(fixtureCourse),
  });
  const url = `ws://127.0.0.1:${game.listen()}`;
  const a = await new Client(url).open();
  const b = await new Client(url).open();
  clients.push(a, b);
  a.hello('new', 'A');
  const wa = await a.next('welcome');
  b.hello(wa.room.code, 'B');
  const wb = await b.next('welcome');
  a.send({ t: 'start' });
  await a.next('matchConfig');
  await b.next('matchConfig');
  a.send({ t: 'loaded' });
  b.send({ t: 'loaded' });
  const { startAt } = await a.next('countdown');
  while (Date.now() < startAt + 20) await sleep(10);
  // Grabs are only accepted once the room itself is in the race phase.
  await a.until(() => a.msgs.some((m) => m.t === 'roomPatch' && m.phase === 'race'));
  await b.until(() => b.msgs.some((m) => m.t === 'roomPatch' && m.phase === 'race'));
  const slotPos = (slot: number) => gridPoint(fixtureCourse.spawn, slot, [0, 0, 0]);
  return { a, b, idA: wa.playerId, idB: wb.playerId, startAt, posA: slotPos(0), posB: slotPos(1) };
}

describe('villain over a real room', () => {
  it('marks a repeat pusher, then throws at and hits only that player', async () => {
    const { a, b, idA, startAt, posA, posB } = await startRace();
    const raceMs = () => Date.now() - startAt;

    // A pushes B twice and B falls (respawns) within the window each time: A is marked.
    for (let k = 1; k <= BUTTERFLY.MARK_PUSHES; k++) {
      a.send({ t: 'grab', target: wbId(b), kind: 'push', dir: [1, 0] });
      await b.until(() => b.count('grabbed') >= k);
      b.state(posB, raceMs(), true); // B fell and respawned
      if (k < BUTTERFLY.MARK_PUSHES) await sleep(BUTTERFLY.GRAB_COOLDOWN_MS + 100);
    }
    const marked = await a.next('marked');
    expect(marked.id).toBe(idA);
    expect((await b.next('marked')).id).toBe(idA); // the whole room sees the mark

    // Nobody is thrown at before the villain appears (the last checkpoint is not reached yet).
    expect(a.count('throw')).toBe(0);

    // A runs to the last checkpoint (the fixture course has one, at z -44..-28).
    const pos: Vec3 = [posA[0], 0, posA[2]];
    while (pos[2] > -30 && a.count('checkpoint') === 0) {
      pos[2] -= 0.3;
      a.state(pos, raceMs());
      await sleep(50);
    }
    await a.next('checkpoint');

    // The villain throws at A, and only at A. B is told about the throw (a red circle) but never hit.
    const thrown = await a.next('throw', () => true, 4000);
    expect(thrown.target).toBe(idA);
    expect(thrown.landAt - Date.now()).toBeLessThanOrEqual(BUTTERFLY.THROW_WARN_MS + 50);
    await b.next('throw');
    // A stands still in the circle (no more STATE frames), so the throw lands on A.
    const hit = await a.next('hit', (m) => m.n === thrown.n, 4000);
    expect(Math.hypot(hit.dir[0], hit.dir[1])).toBeCloseTo(1, 5);
    await sleep(BUTTERFLY.THROW_WARN_MS + 400);
    expect(b.count('hit')).toBe(0);
    for (const m of b.msgs) if (m.t === 'throw') expect(m.target).toBe(idA);
  }, 30_000);

  it('marks a player at their second push even when nobody falls, and the villain then targets them', async () => {
    const { a, b, idA, startAt, posA } = await startRace();
    // A pushes B twice. B never falls (no respawn), so there is no push fall and the storm stays at 0.
    for (let k = 1; k <= BUTTERFLY.MARK_PUSHES; k++) {
      a.send({ t: 'grab', target: wbId(b), kind: 'push', dir: [1, 0] });
      await b.until(() => b.count('grabbed') >= k);
      if (k < BUTTERFLY.MARK_PUSHES) await sleep(BUTTERFLY.GRAB_COOLDOWN_MS + 100);
    }
    const marked = await a.next('marked');
    expect(marked.id).toBe(idA);
    expect(marked.by).toBe(wbId(b));
    expect((await b.next('marked')).id).toBe(idA);
    expect(a.count('storm')).toBe(0); // only falls raise the storm

    // A reaches the last checkpoint: the villain appears and throws at A
    const pos: Vec3 = [posA[0], 0, posA[2]];
    while (pos[2] > -30 && a.count('checkpoint') === 0) {
      pos[2] -= 0.3;
      a.state(pos, Date.now() - startAt);
      await sleep(50);
    }
    await a.next('checkpoint');
    const thrown = await a.next('throw', () => true, 4000);
    expect(thrown.target).toBe(idA);
  }, 30_000);

  it("sends the hero's bridge to a helper who never pushed when they reach the last checkpoint, and to nobody else", async () => {
    const { a, b, startAt, posA, posB } = await startRace();
    // A helps B up (counts as a save); B never helps anyone.
    a.send({ t: 'grab', target: wbId(b), kind: 'helpUp', dir: [1, 0] });
    await b.until(() => b.count('grabbed') >= 1);
    expect(a.count('hero')).toBe(0); // nothing until the last checkpoint

    const run = async (c: Client, from: Vec3) => {
      const pos: Vec3 = [from[0], 0, from[2]];
      while (pos[2] > -30 && c.count('checkpoint') === 0) {
        pos[2] -= 0.3;
        c.state(pos, Date.now() - startAt);
        await sleep(50);
      }
      await c.next('checkpoint');
    };
    await run(a, posA);
    const hero = await a.next('hero', () => true, 3000);
    expect(hero.saves).toBe(1);

    // B reaches the last checkpoint too but never saved anyone: no bridge
    await run(b, posB);
    await sleep(300);
    expect(b.count('hero')).toBe(0);
  }, 30_000);

  it('gives no bridge to a helper who also pushed, and is sent once', async () => {
    const { a, b, startAt, posA } = await startRace();
    a.send({ t: 'grab', target: wbId(b), kind: 'helpUp', dir: [1, 0] }); // a save
    await b.until(() => b.count('grabbed') >= 1);
    await sleep(BUTTERFLY.GRAB_COOLDOWN_MS + 100);
    a.send({ t: 'grab', target: wbId(b), kind: 'push', dir: [1, 0] }); // and a push
    await b.until(() => b.count('grabbed') >= 2);
    const pos: Vec3 = [posA[0], 0, posA[2]];
    while (pos[2] > -30 && a.count('checkpoint') === 0) {
      pos[2] -= 0.3;
      a.state(pos, Date.now() - startAt);
      await sleep(50);
    }
    await a.next('checkpoint');
    await sleep(400);
    expect(a.count('hero')).toBe(0);
  }, 30_000);

  it('never throws when nobody is marked, even after the last checkpoint', async () => {
    const { a, startAt, posA } = await startRace();
    const pos: Vec3 = [posA[0], 0, posA[2]];
    while (pos[2] > -30 && a.count('checkpoint') === 0) {
      pos[2] -= 0.3;
      a.state(pos, Date.now() - startAt);
      await sleep(50);
    }
    await a.next('checkpoint');
    await sleep(2 * BUTTERFLY.THROW_WARN_MS + 500);
    expect(a.count('throw')).toBe(0);
    expect(a.count('hit')).toBe(0);
  }, 30_000);
});

/** B's player id, from its welcome message. */
function wbId(b: Client): number {
  return (b.msgs.find((m) => m.t === 'welcome') as Of<'welcome'>).playerId;
}
