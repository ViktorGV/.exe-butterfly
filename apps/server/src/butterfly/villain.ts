// The villain boss (#84), server side. Once a player reaches the last checkpoint the villain appears and
// throws obstacles at MARKED players only (the ones whose pushes made others fall, see ./index.ts).
// Everyone else is never a target and never gets a `hit`, so a player who did not push is safe.
//
// A throw is announced to the room (`throw`: red circle at the target's position, landing THROW_WARN_MS
// later). When it lands, the target is hit only if it is still inside the circle (`hit`, to it alone), so
// a quick player can walk out of it. Positions stay owned by each client; this only relays the effect.
import { BUTTERFLY } from '@wobble/shared/constants';
import { throwIntervalMs } from '@wobble/shared/butterfly/index';
import type { ServerMessage, Vec3 } from '@wobble/shared/types';

export interface VillainOptions {
  /** Ids of the players in the match. */
  playerIds(): readonly number[];
  /** Latest known position of a player; false when unknown. */
  getPosition(id: number, out: Vec3): boolean;
  /** Is this player marked (see createButterfly)? */
  isMarked(id: number): boolean;
  /** Current storm level, 0..STORM_MAX: the higher, the faster the throws. */
  storm(): number;
  /** A player that is connected and still racing (not finished). Only these are thrown at. */
  isTargetable(id: number): boolean;
  /** To one player. */
  send(id: number, msg: ServerMessage): void;
  /** To the whole room. */
  publish(msg: ServerMessage): void;
}

interface Pending {
  n: number;
  target: number;
  x: number;
  z: number;
  landAt: number;
}

export function createVillain(opts: VillainOptions) {
  let active = false;
  let nextThrowAt = 0;
  let counter = 0;
  const pending: Pending[] = [];
  const p: Vec3 = [0, 0, 0];

  function throwAt(target: number, now: number) {
    if (!opts.getPosition(target, p)) return;
    const item: Pending = { n: counter++, target, x: p[0], z: p[2], landAt: now + BUTTERFLY.THROW_WARN_MS };
    pending.push(item);
    opts.publish({ t: 'throw', n: item.n, target, pos: [item.x, item.z], landAt: item.landAt });
  }

  function land(item: Pending) {
    // Still a legitimate target when it lands: finishing or leaving in the meantime saves the player.
    if (!opts.isTargetable(item.target) || !opts.isMarked(item.target)) return;
    if (!opts.getPosition(item.target, p)) return;
    const dx = p[0] - item.x;
    const dz = p[2] - item.z;
    const dist = Math.hypot(dx, dz);
    if (dist > BUTTERFLY.THROW_RADIUS_M) return; // walked out of the circle
    // Knock back away from the impact; dead centre falls back to straight ahead (-Z).
    const dir: [number, number] = dist > 1e-6 ? [dx / dist, dz / dist] : [0, -1];
    opts.send(item.target, { t: 'hit', n: item.n, dir });
  }

  return {
    /** The villain appears: the first player reached the last checkpoint. Idempotent. */
    activate(now: number) {
      if (active) return;
      active = true;
      nextThrowAt = now + BUTTERFLY.THROW_WARN_MS; // a short beat after the villain shows up
    },
    /** Call every server tick during the race. */
    tick(now: number) {
      for (let i = pending.length - 1; i >= 0; i--) {
        if (now >= pending[i]!.landAt) {
          land(pending[i]!);
          pending.splice(i, 1);
        }
      }
      if (!active || now < nextThrowAt) return;
      for (const id of opts.playerIds()) {
        if (opts.isMarked(id) && opts.isTargetable(id)) throwAt(id, now);
      }
      nextThrowAt = now + throwIntervalMs(opts.storm());
    },
    get active() {
      return active;
    },
    get pendingCount() {
      return pending.length;
    },
  };
}

export type Villain = ReturnType<typeof createVillain>;
