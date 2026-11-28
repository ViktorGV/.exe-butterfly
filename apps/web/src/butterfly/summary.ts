// Results screen lines for the butterfly effect (#84): your own story, what the lobby did together, and
// three titles. Pure: text from the server's per-player numbers (raceEnd.results[]) and a few counters the
// client kept during the race.
import { t } from '../ui/strings.ts';
import type { ButterflySummary } from '../ui/types.ts';

export interface ButterflyRow {
  id: number;
  name: string;
  timeMs: number | null;
  pushes?: number;
  /** pushes that made someone fall within the window (they raise the storm and earn Biggest butterfly) */
  pushFalls?: number;
  saves?: number;
  marked?: boolean;
}

export interface ButterflyContext {
  /** Storm level at the end of the race and its maximum. */
  storm: number;
  stormMax: number;
  /** Villain throws aimed at you, and how many of them hit you. */
  throwsAtMe: number;
  hitsOnMe: number;
  /** The hero opened a bridge for you (you helped others and never pushed). */
  heroBridge?: boolean;
}

const ARROW = ' → ';

/** "you saved 1 and pushed 2 → you were marked" -> "You saved 1 and pushed 2 → you were marked." */
const sentence = (parts: readonly string[]): string => {
  const s = parts.join(ARROW);
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
};

function powerText(storm: number, max: number): string {
  const f = max > 0 ? storm / max : 0;
  if (f <= 0) return t('bfPowerNone');
  if (f < 0.35) return t('bfPowerLow');
  if (f < 0.7) return t('bfPowerMid');
  if (f < 1) return t('bfPowerHigh');
  return t('bfPowerFull');
}

/** First row with the highest `score` above zero (rows are sorted by place, so ties go to the faster player). */
function best(rows: readonly ButterflyRow[], score: (r: ButterflyRow) => number): ButterflyRow | null {
  let top: ButterflyRow | null = null;
  let topScore = 0;
  for (const r of rows) {
    const s = score(r);
    if (s > topScore) {
      top = r;
      topScore = s;
    }
  }
  return top;
}

export function summarize(
  rows: readonly ButterflyRow[],
  localId: number | undefined,
  ctx: ButterflyContext,
): ButterflySummary {
  // your own line
  let own: string | null = null;
  const me = rows.find((r) => r.id === localId);
  if (me) {
    const saves = me.saves ?? 0;
    const pushed = me.pushes ?? 0;
    const did: string[] = [];
    if (saves > 0) did.push(t('bfOwnSaved', { n: saves }));
    if (pushed > 0) did.push(t(saves > 0 ? 'bfOwnPushedToo' : 'bfOwnPushed', { n: pushed }));
    const parts: string[] = [];
    if (did.length > 0) parts.push(did.join(' and '));
    if (ctx.heroBridge) parts.push(t('bfOwnHero'));
    if (me.marked) {
      parts.push(t('bfOwnMarked'));
      if (ctx.hitsOnMe === 1) parts.push(t('bfOwnHit'));
      else if (ctx.hitsOnMe > 1) parts.push(t('bfOwnHitMany', { n: ctx.hitsOnMe }));
      else if (ctx.throwsAtMe > 0) parts.push(t('bfOwnDodged'));
    }
    if (parts.length > 0) own = sentence(parts);
  }

  // the lobby line
  let pushes = 0;
  let saves = 0;
  let falls = 0;
  for (const r of rows) {
    pushes += r.pushes ?? 0;
    saves += r.saves ?? 0;
    falls += r.pushFalls ?? 0;
  }
  let lobby: string | null = null;
  if (pushes > 0 || saves > 0 || ctx.storm > 0) {
    lobby = sentence([
      t('bfLobbyTotals', { pushes, saves }),
      t('bfLobbyFalls', { n: falls }),
      t('bfLobbyStorm', { level: ctx.storm, max: ctx.stormMax, power: powerText(ctx.storm, ctx.stormMax) }),
    ]);
  }

  // titles
  const titles: { label: string; name: string }[] = [];
  const fastest = best(rows, (r) => (r.timeMs == null ? 0 : 1e9 - r.timeMs));
  if (fastest) titles.push({ label: t('bfTitleFastest'), name: fastest.name });
  const kindest = best(rows, (r) => r.saves ?? 0);
  if (kindest) titles.push({ label: t('bfTitleKindest'), name: kindest.name });
  const biggest = best(rows, (r) => r.pushFalls ?? 0);
  if (biggest) titles.push({ label: t('bfTitleBiggest'), name: biggest.name });

  return { own, lobby, titles };
}
