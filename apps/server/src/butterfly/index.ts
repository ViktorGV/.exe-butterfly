// Server side of the butterfly effect (#84): grab checks and cooldown, counters, marks and the storm.
// The race session already exposes `getPosition` and `approveSave`; this module decides what a grab does
// and what the room is told. Positions stay owned by each client, so a grab only relays the effect.
import { BUTTERFLY } from '@wobble/shared/constants';
import { createButterfly, getsHeroHelp, inReach } from '@wobble/shared/butterfly/index';
import type { ButterflyEvent } from '@wobble/shared/butterfly/index';
import type { ClientMessage, RaceResult, ServerMessage, Vec3 } from '@wobble/shared/types';

export type Grab = Extract<ClientMessage, { t: 'grab' }>;

/** The part of the race session a grab needs. */
export interface GrabSession {
  getPosition(playerId: number, out: Vec3): boolean;
  approveSave(playerId: number, pos: Vec3, nowMs: number): void;
}

export interface ButterflyServerOptions {
  session(): GrabSession | null;
  /** To one player. */
  send(id: number, msg: ServerMessage): void;
  /** To the whole room. */
  publish(msg: ServerMessage): void;
  now?: () => number;
}

export type GrabVerdict = 'ok' | 'cooldown' | 'self' | 'unknown_player' | 'out_of_reach';

export function createButterflyServer(opts: ButterflyServerOptions) {
  const now = opts.now ?? Date.now;
  const rules = createButterfly();
  const lastGrab = new Map<number, number>();
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [0, 0, 0];
  const events: ButterflyEvent[] = [];

  function announce(list: readonly ButterflyEvent[]) {
    for (const e of list) {
      if (e.type === 'storm') opts.publish({ t: 'storm', level: e.level, max: BUTTERFLY.STORM_MAX });
      else if (e.type === 'marked') opts.publish({ t: 'marked', id: e.id, by: e.by });
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
      return 'ok';
    },
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
