// Runs N bots over R rooms against one server and returns the summary.
import { BOT_SPEED, TICK_MS, createBot } from './bot.ts';
import type { Bot } from './bot.ts';
import { checkThresholds, createCounters, createHistogram, summarize } from './metrics.ts';
import type { Summary, Thresholds } from './metrics.ts';

export interface SwarmOptions {
  url: string;
  bots: number;
  rooms: number;
  /** hard stop for the whole run, seconds */
  durationSec: number;
  /** new connections per second */
  rampPerSec: number;
  thresholds?: Thresholds;
  log?(line: string): void;
  /**
   * Join this existing room code instead of creating rooms. The bots never press start (the room's host
   * does), they stay for every match until `durationSec` runs out, and no thresholds are checked.
   */
  room?: string;
}

export interface SwarmResult {
  summary: Summary;
  violations: string[];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runSwarm(o: SwarmOptions): Promise<SwarmResult> {
  const log = o.log ?? (() => {});
  const counters = createCounters();
  const gaps = createHistogram();
  const bots: Bot[] = [];
  const hosts: Bot[] = [];
  const roomBots = new Map<number, Bot[]>();
  let raceStart = 0;
  let remaining = o.bots;
  const allDone = Promise.withResolvers<void>();
  const onDone = () => {
    if (--remaining <= 0) allDone.resolve();
  };

  const make = (room: number, code: string, index: number, onWelcome: (code: string) => void): Bot => {
    const bot = createBot({
      persist: !!o.room,
      url: o.url,
      name: `bot${room}-${index}`,
      room: code,
      speed: BOT_SPEED,
      counters,
      gaps,
      onWelcome: (c) => onWelcome(c),
      onCountdown: () => (raceStart ||= performance.now()),
      onDone,
    });
    bots.push(bot);
    (roomBots.get(room) ?? roomBots.set(room, []).get(room)!).push(bot);
    return bot;
  };

  const sendTimer = setInterval(() => {
    const now = Date.now();
    for (const b of bots) b.tick(now);
  }, TICK_MS);

  const deadline = setTimeout(() => allDone.resolve(), o.durationSec * 1000);
  const gapMs = 1000 / Math.max(1, o.rampPerSec);

  async function fillRoom(room: number, count: number) {
    const codeP = Promise.withResolvers<string>();
    const host = make(room, 'new', 0, (code) => codeP.resolve(code));
    hosts.push(host);
    const code = await Promise.race([codeP.promise, sleep(10_000).then(() => '')]);
    if (!code) {
      // the host never joined: count the rest of the room as failed
      counters.failed += count - 1;
      for (let i = 1; i < count; i++) onDone();
      return;
    }
    for (let i = 1; i < count; i++) {
      make(room, code, i, () => {});
      await sleep(gapMs);
    }
  }

  if (o.room) {
    // keep a developer company: join their room and race whenever they start
    for (let i = 0; i < o.bots; i++) {
      make(0, o.room, i, () => {});
      await sleep(gapMs);
    }
    log(`${o.bots} bots joining room ${o.room}; start the race from your browser. Ctrl+C to stop.`);
    await allDone.promise;
    clearTimeout(deadline);
    clearInterval(sendTimer);
    for (const b of bots) b.close();
    return { summary: summarize(counters, gaps, o.bots, o.durationSec), violations: [] };
  }

  const per = Math.floor(o.bots / o.rooms);
  const fills: Promise<void>[] = [];
  for (let r = 0; r < o.rooms; r++) fills.push(fillRoom(r, r === o.rooms - 1 ? o.bots - per * r : per));
  await Promise.all(fills);

  // everyone connected: wait for the welcomes, then each host starts its room
  const joinDeadline = Date.now() + 15_000;
  while (Date.now() < joinDeadline && bots.some((b) => !b.welcomed && !b.done)) await sleep(100);
  log(`${bots.filter((b) => b.welcomed).length}/${o.bots} bots joined, starting ${hosts.length} room(s)`);
  for (const h of hosts) h.start();

  await allDone.promise;
  clearTimeout(deadline);
  clearInterval(sendTimer);
  for (const b of bots) b.close();

  const sec = raceStart ? (performance.now() - raceStart) / 1000 : o.durationSec;
  const summary = summarize(counters, gaps, o.bots, sec);
  const violations = o.thresholds ? checkThresholds(summary, o.thresholds) : [];
  return { summary, violations };
}
