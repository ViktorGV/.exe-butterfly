// Bot swarm CLI (#21). Without --url it starts a game server in this process on a free port.
import { readFileSync, writeFileSync } from 'node:fs';
import { markdown } from './metrics.ts';
import type { Thresholds } from './metrics.ts';
import { runSwarm } from './swarm.ts';

export interface Args {
  url?: string;
  bots: number;
  rooms: number;
  duration: number;
  ramp: number;
  out?: string;
  thresholds: string;
  scenario: string;
  room?: string;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = {
    bots: 300,
    rooms: 1,
    duration: 120,
    ramp: 50,
    thresholds: new URL('../thresholds.json', import.meta.url).pathname,
    scenario: 'race',
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const v = argv[++i];
    if (v === undefined) throw new Error(`${k} needs a value`);
    const num = () => {
      const n = Number.parseFloat(v);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`${k} must be a positive number`);
      return n;
    };
    switch (k) {
      case '--url':
        a.url = v;
        break;
      case '--bots':
        a.bots = Math.floor(num());
        break;
      case '--rooms':
        a.rooms = Math.floor(num());
        break;
      case '--duration':
        a.duration = num();
        break;
      case '--ramp':
        a.ramp = num();
        break;
      case '--out':
        a.out = v;
        break;
      case '--thresholds':
        a.thresholds = v;
        break;
      case '--scenario':
        a.scenario = v;
        break;
      case '--room':
        a.room = v.toUpperCase();
        break;
      default:
        throw new Error(`unknown option ${k}`);
    }
  }
  if (a.room && !/^[A-Z]{5}$/.test(a.room)) throw new Error('--room must be a 5-letter room code');
  if (a.scenario !== 'race') throw new Error(`scenario "${a.scenario}" is not implemented yet (only "race")`);
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2).filter((x) => x !== '--'));
  const thresholds = JSON.parse(readFileSync(args.thresholds, 'utf8')) as Thresholds;
  let url = args.url;
  let close: (() => Promise<void>) | null = null;
  if (!url && args.room) throw new Error('--room needs --url (the server your room is on)');
  if (!url) {
    const { createGameServer } = await import('../../../apps/server/src/index.ts');
    const game = createGameServer({
      port: 0,
      maxPlayers: Math.ceil(args.bots / args.rooms),
      timings: { countdownMs: 3000, loadingMaxMs: 5000 },
    });
    url = `ws://localhost:${game.listen()}`;
    close = () => game.close();
    console.log(`started an in-process game server at ${url}`);
  }
  const { summary, violations } = await runSwarm({
    url,
    bots: args.bots,
    rooms: args.rooms,
    durationSec: args.duration,
    rampPerSec: args.ramp,
    thresholds: args.room ? undefined : thresholds,
    room: args.room,
    log: (l) => console.log(l),
  });
  const md = markdown(summary, violations);
  console.log(md);
  if (args.out) {
    writeFileSync(args.out, JSON.stringify({ summary, violations }, null, 2));
    writeFileSync(args.out.replace(/\.json$/, '') + '.md', md);
  }
  await close?.();
  process.exit(violations.length ? 1 : 0);
}

if (import.meta.main) await main();
