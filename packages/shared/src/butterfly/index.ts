// Butterfly effect rules (#84). Pure and allocation-light: the server runs them for counters, marks and
// the storm; the client uses `grabKindFor` for the Grab icon and `throwIntervalMs` for the villain.
import { BUTTERFLY, GUNS } from '../constants.ts';
import type { GrabKind, GunKind } from '../types.ts';
import { gunForHits } from './guns.ts';

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
  | { type: 'pushFall'; id: number; by: number }
  /** `id` has just earned a gun (on the GUN_LADDER): its kind and the shots it holds. */
  | { type: 'gun'; id: number; kind: GunKind; shots: number };

export interface Butterfly {
  /**
   * A grab was accepted: `by` pushed `target` at `atMs`. A newer push on the same target replaces the older one.
   * A player is marked at their BUTTERFLY.MARK_PUSHES-th push, whether or not anyone falls; the `marked` event
   * (`id` is the pusher, `by` the player they just pushed) is returned for broadcast (empty otherwise).
   * The pushed player's received-push count goes up; on the GUN_LADDER steps they earn a gun (a
   * `gun` event, the gun filled to GUNS[kind].shots).
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
  /**
   * A deed moves the storm: a push raises it by one, a save or help-up calms it by one, kept within
   * 0..STORM_MAX. Returns the `storm` event to broadcast, or nothing when the level did not change.
   */
  deed(kind: 'bad' | 'good', out: ButterflyEvent[]): ButterflyEvent[];
  readonly storm: number;
  tally(id: number): Readonly<PlayerTally>;
  isMarked(id: number): boolean;
  /** Shots left in `id`'s gun (0 when they have none). */
  shots(id: number): number;
  /** The kind of `id`'s gun (the last one they earned), or null if they never had one. */
  gunKind(id: number): GunKind | null;
  /**
   * Fire one shot for `id` at `target`. False (and nothing changes) when the gun is empty. A shot is a bad deed:
   * the shooter is marked at once (the `marked` event, the villain then comes for them) and the storm goes up.
   */
  shoot(id: number, target: number, out: ButterflyEvent[]): boolean;
  /**
   * `target` was hit by a shot. It counts toward their gun like a push received: the
   * GUN_LADDER steps earn a gun (a `gun` event appended to `out`).
   */
  gotShot(target: number, out: ButterflyEvent[]): ButterflyEvent[];
  /** Everyone who has a tally, for the results screen. */
  tallies(): ReadonlyMap<number, Readonly<PlayerTally>>;
}

export interface ButterflyOptions {
  /** Which gun a pickup gives. Default: a random kind. */
  /** Which gun (if any) the n-th hit received earns. Default: GUN_LADDER. */
  gunAt?: (hits: number) => GunKind | null;
}

export function createButterfly(opts: ButterflyOptions = {}): Butterfly {
  const gunAt = opts.gunAt ?? gunForHits;
  const tallies = new Map<number, PlayerTally>();
  /** target -> last push on them */
  const pushed = new Map<number, { by: number; at: number }>();
  /** player -> pushes they have received, and the shots in their gun */
  const received = new Map<number, number>();
  const gun = new Map<number, number>();
  const kinds = new Map<number, GunKind>();
  let storm = 0;

  /** One more push or shot received by `id`: GUN_LADDER steps earn a gun (appended to `out`). */
  const countHit = (id: number, out: ButterflyEvent[]) => {
    const n = (received.get(id) ?? 0) + 1;
    received.set(id, n);
    const kind = gunAt(n);
    if (kind) {
      kinds.set(id, kind);
      gun.set(id, GUNS[kind].shots);
      out.push({ type: 'gun', id, kind, shots: GUNS[kind].shots });
    }
  };

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
      countHit(target, out);
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
    deed(kind, out) {
      out.length = 0;
      const next = Math.max(0, Math.min(BUTTERFLY.STORM_MAX, storm + (kind === 'bad' ? 1 : -1)));
      if (next !== storm) {
        storm = next;
        out.push({ type: 'storm', level: storm });
      }
      return out;
    },
    get storm() {
      return storm;
    },
    tally: (id) => get(id),
    isMarked: (id) => tallies.get(id)?.marked === true,
    shots: (id) => gun.get(id) ?? 0,
    gunKind: (id) => kinds.get(id) ?? null,
    shoot(id, target, out) {
      out.length = 0;
      const left = gun.get(id) ?? 0;
      if (left <= 0) return false;
      gun.set(id, left - 1);
      const shooter = get(id);
      if (!shooter.marked) {
        shooter.marked = true;
        out.push({ type: 'marked', id, by: target });
      }
      const next = Math.min(BUTTERFLY.STORM_MAX, storm + GUNS[kinds.get(id) ?? 'blaster'].storm);
      if (next !== storm) {
        storm = next;
        out.push({ type: 'storm', level: storm });
      }
      return true;
    },
    gotShot(target, out) {
      countHit(target, out);
      return out;
    },
    tallies: () => tallies,
  };
}

/** Helpers for the final-section hero rule: saves and no pushes earns the hero's bridge. */
export const getsHeroHelp = (t: Readonly<PlayerTally>): boolean => t.saves >= 1 && t.pushes === 0;
