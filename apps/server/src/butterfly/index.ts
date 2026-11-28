// Server side of the butterfly effect (#84): grab checks and cooldown, counters, marks and the storm.
// The race session already exposes `getPosition` and `approveSave`; this module decides what a grab does
// and what the room is told. Positions stay owned by each client, so a grab only relays the effect.
import { BUTTERFLY, GUNS } from '@wobble/shared/constants';
import { createButterfly, getsHeroHelp, inReach } from '@wobble/shared/butterfly/index';
import type { ButterflyEvent } from '@wobble/shared/butterfly/index';
import { dist2, inCone, isAhead } from '@wobble/shared/butterfly/guns';
import type { ClientMessage, GunKind, RaceResult, ServerMessage, Vec3 } from '@wobble/shared/types';

export type Grab = Extract<ClientMessage, { t: 'grab' }>;

/** The part of the race session a grab needs. */
export interface GrabSession {
  getPosition(playerId: number, out: Vec3): boolean;
  approveSave(playerId: number, pos: Vec3, nowMs: number): void;
  /** Facing of a player (0 faces −Z); used by cone guns. Missing or NaN means facing down the course. */
  getYaw?(playerId: number): number;
}

export interface ButterflyServerOptions {
  session(): GrabSession | null;
  /** To one player. */
  send(id: number, msg: ServerMessage): void;
  /** To the whole room. */
  publish(msg: ServerMessage): void;
  now?: () => number;
  /** Still racing (connected, in the match, not finished): only these can be shot. Defaults to everyone. */
  isRacing?: (id: number) => boolean;
  /** Everyone in the race, for guns where the server picks the targets (cone, homing). */
  racers?: () => Iterable<number>;
  /** Which gun a pickup gives. Default: random. */
  gunAt?: (hits: number) => GunKind | null;
}

export type ShootVerdict = 'ok' | 'no_gun' | 'cooldown' | 'self' | 'unknown_player' | 'out_of_range' | 'no_target';

/** Range slack for latency between the two positions (like grabs). */
const RANGE_SLACK = 1.25;

export type GrabVerdict = 'ok' | 'cooldown' | 'self' | 'unknown_player' | 'out_of_reach';

export function createButterflyServer(opts: ButterflyServerOptions) {
  const now = opts.now ?? Date.now;
  const rules = createButterfly({ gunAt: opts.gunAt });
  const hits: number[] = [];
  const lastGrab = new Map<number, number>();
  const lastShot = new Map<number, number>();
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [0, 0, 0];
  const c: Vec3 = [0, 0, 0];
  const events: ButterflyEvent[] = [];

  function announce(list: readonly ButterflyEvent[]) {
    for (const e of list) {
      if (e.type === 'storm') opts.publish({ t: 'storm', level: e.level, max: BUTTERFLY.STORM_MAX });
      else if (e.type === 'marked') opts.publish({ t: 'marked', id: e.id, by: e.by });
      else if (e.type === 'gun') opts.publish({ t: 'gun', id: e.id, kind: e.kind, shots: e.shots });
    }
  }

  return {
    /** A client asked to grab `msg.target`. Returns why it was refused, or 'ok' after relaying it. */
    grab(by: number, msg: Grab): GrabVerdict {
      const session = opts.session();
      if (!session) return 'unknown_player';
      if (msg.target === by) return 'self';
      const t = now();
      const last = lastGrab.get(by);
      if (last !== undefined && t - last < BUTTERFLY.GRAB_COOLDOWN_MS) return 'cooldown';
      if (!session.getPosition(by, a) || !session.getPosition(msg.target, b)) return 'unknown_player';
      // a little slack over the client's reach for latency between the two positions
      if (!inReach(a[0], a[2], b[0], b[2]) && Math.hypot(a[0] - b[0], a[2] - b[2]) > BUTTERFLY.GRAB_REACH_M * 1.5) {
        return 'out_of_reach';
      }
      lastGrab.set(by, t);
      let standAt: Vec3 = [a[0], a[1], a[2]];
      let marks: readonly ButterflyEvent[] = [];
      if (msg.kind === 'push') marks = rules.push(by, msg.target, t, events);
      else {
        rules.save(by);
        // pull the target up next to the grabber, on the side it came from
        standAt = [a[0] - msg.dir[0] * 0.8, a[1], a[2] - msg.dir[1] * 0.8];
        if (msg.kind === 'save') session.approveSave(msg.target, standAt, t);
      }
      opts.send(msg.target, { t: 'grabbed', by, kind: msg.kind, dir: msg.dir, pos: standAt });
      announce(marks); // the 2nd push marks the pusher at once, whether or not the target falls
      // every deed moves the storm bar: a push raises it, a save or help-up calms it
      announce(rules.deed(msg.kind === 'push' ? 'bad' : 'good', events));
      return 'ok';
    },
    /**
     * `by` fired their gun. For 'nearest' guns `target` is their client's aim pick; for 'cone' / 'homing'
     * guns the server picks (target ignored). Checks the gun, cooldown, range, cone / ahead rules and that targets
     * are still racing; then spends a shot, tells the room what `by` holds now and who was hit.
     */
    shoot(by: number, target?: number): ShootVerdict {
      const session = opts.session();
      if (!session) return 'unknown_player';
      const kind = rules.gunKind(by);
      if (!kind || rules.shots(by) <= 0) return 'no_gun';
      const g = GUNS[kind];
      if (target === by) return 'self';
      const t = now();
      const last = lastShot.get(by);
      if (last !== undefined && t - last < g.cooldownMs) return 'cooldown';
      if (!session.getPosition(by, a)) return 'unknown_player';
      const racing = (id: number) => id !== by && (!opts.isRacing || opts.isRacing(id));
      const range = g.rangeM * RANGE_SLACK;
      hits.length = 0;
      if (g.aim === 'nearest') {
        if (target === undefined || !racing(target) || !session.getPosition(target, b)) return 'unknown_player';
        if (dist2(a[0], a[2], b[0], b[2]) > range * range) return 'out_of_range';
        hits.push(target);
      } else {
        const yaw = session.getYaw?.(by) ?? 0;
        let best = -1;
        let bestD2 = g.rangeM * g.rangeM;
        for (const id of opts.racers?.() ?? []) {
          if (!racing(id) || !session.getPosition(id, b)) continue;
          if (g.aim === 'cone') {
            if (inCone(a[0], a[2], Number.isFinite(yaw) ? yaw : 0, b[0], b[2], g.rangeM, g.coneDeg)) hits.push(id);
          } else if (isAhead(a[2], b[2])) {
            const d = dist2(a[0], a[2], b[0], b[2]);
            if (d <= bestD2) {
              bestD2 = d;
              best = id;
            }
          }
        }
        if (best >= 0) {
          hits.push(best);
          // the rocket explodes: everyone within the blast of the impact goes down too
          session.getPosition(best, c);
          const r2 = g.blastM * g.blastM;
          for (const id of opts.racers?.() ?? []) {
            if (id === best || !racing(id) || !session.getPosition(id, b)) continue;
            if (dist2(c[0], c[2], b[0], b[2]) <= r2) hits.push(id);
          }
        }
        // nobody to hit: the shot is kept (the race leader cannot waste a rocket)
        if (hits.length === 0) return 'no_target';
      }
      lastShot.set(by, t);
      rules.shoot(by, hits[0]!, events);
      opts.publish({ t: 'gun', id: by, kind, shots: rules.shots(by) });
      opts.publish({ t: 'shot', by, kind, targets: hits.slice() });
      announce(events); // a shot is a bad deed: the shooter is marked (the villain comes for them), the storm rises
      // getting shot fills your gun meter like getting pushed
      events.length = 0;
      for (const id of hits) rules.gotShot(id, events);
      announce(events);
      return 'ok';
    },
    gunKind: (id: number) => rules.gunKind(id),
    shots: (id: number) => rules.shots(id),
    /** The race session reported a respawn. A fall (not a save) can complete a push. */
    respawned(id: number, save: boolean) {
      if (save) return;
      announce(rules.fell(id, now(), events));
    },
    /** Results with the butterfly numbers added. */
    withStats(results: RaceResult[]) {
      return results.map((r) => {
        const tally = rules.tallies().get(r.id);
        return tally
          ? { ...r, pushes: tally.pushes, pushFalls: tally.pushFalls, saves: tally.saves, marked: tally.marked }
          : r;
      });
    },
    /** How many players `id` has helped if the hero helps them (at least 1 save and 0 pushes), else 0. */
    heroHelp(id: number): number {
      const t = rules.tally(id);
      return getsHeroHelp(t) ? t.saves : 0;
    },
    get storm() {
      return rules.storm;
    },
    isMarked: (id: number) => rules.isMarked(id),
  };
}

export type ButterflyServer = ReturnType<typeof createButterflyServer>;
