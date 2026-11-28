// Butterfly effect rules (#84). Pure and allocation-light: the server runs them for counters, marks and
// the storm; the client uses `grabKindFor` for the Grab icon and `throwIntervalMs` for the villain.
import { BUTTERFLY } from '../constants.ts';
import type { GrabKind } from '../types.ts';

/** What a nearby player is doing, from the grabber's point of view. */
export type TargetSituation = 'standing' | 'falling' | 'knockedDown';

/**
 * What one Grab button does for a target in reach. Save beats help up beats push,
 * so the button never pushes someone who needs help.
 */
export function grabKindFor(situation: TargetSituation): GrabKind {
  if (situation === 'falling') return 'save';
  if (situation === 'knockedDown') return 'helpUp';
  return 'push';
}

/** Priority when several targets are in reach: the kind that wins, in order. */
export const GRAB_PRIORITY: readonly GrabKind[] = Object.freeze(['save', 'helpUp', 'push']);

/** The kind to show when several targets are around (`null` when none is in reach). */
export function bestGrabKind(kinds: Iterable<GrabKind>): GrabKind | null {
  let best = -1;
  for (const k of kinds) {
    const rank = GRAB_PRIORITY.indexOf(k);
    if (best === -1 || rank < best) best = rank;
  }
  return best === -1 ? null : GRAB_PRIORITY[best];
}

/** True when a falling player can still be saved, `fallingForMs` after leaving the edge. */
export const canSave = (fallingForMs: number): boolean => fallingForMs >= 0 && fallingForMs <= BUTTERFLY.SAVE_WINDOW_MS;

/** Is a grab from `from` to `to` (xz metres) inside reach? */
export function inReach(fromX: number, fromZ: number, toX: number, toZ: number): boolean {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  return dx * dx + dz * dz <= BUTTERFLY.GRAB_REACH_M * BUTTERFLY.GRAB_REACH_M;
}

/** Villain throw interval for a storm level: 6 s when calm down to 2 s when full. */
export function throwIntervalMs(level: number): number {
  const f = Math.min(1, Math.max(0, level / BUTTERFLY.STORM_MAX));
  return BUTTERFLY.THROW_EVERY_CALM_MS + (BUTTERFLY.THROW_EVERY_FULL_MS - BUTTERFLY.THROW_EVERY_CALM_MS) * f;
}

export interface PlayerTally {
  pushes: number;
  /** pushes that were counted (the target fell within the window) */
  pushFalls: number;
  saves: number;
  marked: boolean;
}

export type ButterflyEvent =
  | { type: 'storm'; level: number }
  | { type: 'marked'; id: number; by: number }
  | { type: 'pushFall'; id: number; by: number };

export interface Butterfly {
  /**
   * A grab was accepted: `by` pushed `target` at `atMs`. A newer push on the same target replaces the older one.
   * A player is marked at their BUTTERFLY.MARK_PUSHES-th push, whether or not anyone falls; the `marked` event
   * (`id` is the pusher, `by` the player they just pushed) is returned for broadcast (empty otherwise).
   */
  push(by: number, target: number, atMs: number, out: ButterflyEvent[]): ButterflyEvent[];
  /** A save or a help-up by `by` counted. */
  save(by: number): void;
  /**
   * `id` fell at `atMs`. A fall within the window of a push counts for the pusher and raises the storm (marking
   * is by pushes, see push());
   * a fall on its own counts for nobody. Returns the events to broadcast (empty most of the time).
   */
  fell(id: number, atMs: number, out: ButterflyEvent[]): ButterflyEvent[];
  readonly storm: number;
  tally(id: number): Readonly<PlayerTally>;
  isMarked(id: number): boolean;
  /** Everyone who has a tally, for the results screen. */
  tallies(): ReadonlyMap<number, Readonly<PlayerTally>>;
}

export function createButterfly(): Butterfly {
  const tallies = new Map<number, PlayerTally>();
  /** target -> last push on them */
  const pushed = new Map<number, { by: number; at: number }>();
  let storm = 0;

  const get = (id: number): PlayerTally => {
    let t = tallies.get(id);
    if (!t) tallies.set(id, (t = { pushes: 0, pushFalls: 0, saves: 0, marked: false }));
    return t;
  };

  return {
    push(by, target, atMs, out) {
      out.length = 0;
      const pusher = get(by);
      pusher.pushes++;
      pushed.set(target, { by, at: atMs });
      if (!pusher.marked && pusher.pushes >= BUTTERFLY.MARK_PUSHES) {
        pusher.marked = true;
        out.push({ type: 'marked', id: by, by: target });
      }
      return out;
    },
    save(by) {
      get(by).saves++;
    },
    fell(id, atMs, out) {
      out.length = 0;
      const p = pushed.get(id);
      if (!p) return out;
      pushed.delete(id);
      if (atMs - p.at > BUTTERFLY.PUSH_FALL_WINDOW_MS || atMs < p.at) return out;
      const pusher = get(p.by);
      pusher.pushFalls++;
      out.push({ type: 'pushFall', id, by: p.by });
      if (storm < BUTTERFLY.STORM_MAX) {
        storm++;
        out.push({ type: 'storm', level: storm });
      }
      return out;
    },
    get storm() {
      return storm;
    },
    tally: (id) => get(id),
    isMarked: (id) => tallies.get(id)?.marked === true,
    tallies: () => tallies,
  };
}

/** Helpers for the final-section hero rule: saves and no pushes earns the hero's bridge. */
export const getsHeroHelp = (t: Readonly<PlayerTally>): boolean => t.saves >= 1 && t.pushes === 0;
