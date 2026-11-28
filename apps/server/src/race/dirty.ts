// Dirty tracking for snapshots (#60): players whose record did not change are left out of the
// candidate set, except for a keyframe once per second and a short tail after each change.
// Allocation-free after construction. Works on the encoded 10-byte records, so "changed" means
// exactly what a receiver could see: quantised position, yaw and animFlags (finished/respawned).
import { SNAPSHOT_HZ, WIRE } from '@wobble/shared/constants';

/** Ticks a player stays included after its last change, so every far-refresh group sees the final state. */
export const QUIET_AFTER_TICKS = 4;

const EVENT_FLAGS = WIRE.FLAG_FINISHED | WIRE.FLAG_RESPAWNED;

export interface DirtyTracker {
  /** 1 when the player belongs in this tick's snapshots. Valid after `update`, reused every call. */
  readonly active: Uint8Array;
  /** 1 when the player's once-per-second keyframe falls on this tick; such a record goes to every receiver. */
  readonly keyframe: Uint8Array;
  /** 1 when the finished or respawned flag turned on this tick; such a record goes to every receiver at once. */
  readonly event: Uint8Array;
  /**
   * Compares `records` (10 bytes per player, as written for this tick) with the previous tick and
   * refreshes `active`. Invisible players are never active.
   */
  update(records: Uint8Array, visible: Uint8Array, count: number, tick: number): void;
}

export function createDirtyTracker(capacity: number, keyframeTicks: number = SNAPSHOT_HZ): DirtyTracker {
  const R = WIRE.SNAPSHOT_RECORD_BYTES;
  const prev = new Uint8Array(capacity * R);
  /** ticks since the record last changed; starts high so a player is only sent once it is new or changes */
  const since = new Uint16Array(capacity);
  /** 1 once the player has been seen, so the first tick counts as a change */
  const seen = new Uint8Array(capacity);
  const active = new Uint8Array(capacity);
  const keyframe = new Uint8Array(capacity);
  const event = new Uint8Array(capacity);

  return {
    active,
    keyframe,
    event,
    update(records, visible, count, tick) {
      for (let i = 0; i < count; i++) {
        if (!visible[i]) {
          active[i] = 0;
          keyframe[i] = 0;
          event[i] = 0;
          seen[i] = 0;
          continue;
        }
        const o = i * R;
        let changed = seen[i] === 0;
        if (!changed) {
          for (let b = 0; b < R; b++) {
            if (records[o + b] !== prev[o + b]) {
              changed = true;
              break;
            }
          }
        }
        // a finished/respawned flag that just turned on must not wait for the near-set cut or a far group
        event[i] = !seen[i] ? 0 : (records[o + 9] & ~prev[o + 9] & EVENT_FLAGS) !== 0 ? 1 : 0;
        if (changed) {
          for (let b = 0; b < R; b++) prev[o + b] = records[o + b];
          seen[i] = 1;
          since[i] = 0;
        } else if (since[i] < 0xffff) since[i]++;
        // staggered keyframe: every player is due once per `keyframeTicks`, not all on the same tick
        const due = (tick + i) % keyframeTicks === 0;
        keyframe[i] = due ? 1 : 0;
        active[i] = since[i] <= QUIET_AFTER_TICKS || due ? 1 : 0;
      }
    },
  };
}
