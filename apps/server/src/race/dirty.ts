// Dirty tracking for SNAPSHOTs (#60, MP-3): leave players out of a snapshot when nothing a client
// could see has changed since the last time they were sent. A player is still sent at least once
// per keyframe interval (default 1 s) so late joiners and dropped packets recover. Changes are
// detected on the quantised wire values (docs/CONTRACTS.md §6), so sub-2 cm jitter is "unchanged".
// The result is a 0/1 mask meant to replace `visible` in a SnapshotSource: no wire-format change.
// Finish and respawn change animFlags (FLAG_FINISHED / FLAG_RESPAWNED), so they are always sent
// in the tick they happen. Allocation-free after construction.
import { POS_SCALE, SNAPSHOT_HZ } from '@wobble/shared/constants';
import type { SnapshotSource } from './snapshot.ts';

export const DEFAULT_KEYFRAME_MS = 1000;

/** Float slack (ms) so a keyframe due "exactly" now is not pushed to the next tick by rounding. */
const DUE_EPSILON_MS = 0.001;

export interface DirtyOptions {
  /** A player is re-sent at least this often even when unchanged (default 1000). */
  keyframeMs?: number;
}

export interface DirtyTracker {
  /**
   * Fills `out[0..count)` with 1 for players that should be in this tick's snapshot (visible and
   * changed, never sent yet, or due a keyframe) and 0 otherwise. Returns how many are included.
   * Call once per snapshot tick, right before building it, with the same `src`.
   */
  filter(src: SnapshotSource, nowMs: number, out: Uint8Array): number;
  /** Forgets what was sent for a player (it rejoined): its next visible tick is always included. */
  reset(index: number): void;
}

const clampI16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

export function createDirtyTracker(capacity: number, opts: DirtyOptions = {}): DirtyTracker {
  const keyframeMs = opts.keyframeMs ?? DEFAULT_KEYFRAME_MS;
  if (!(keyframeMs > 0)) throw new RangeError('createDirtyTracker: keyframeMs must be > 0');
  const cap = Math.max(1, capacity);
  const qx = new Int16Array(cap);
  const qy = new Int16Array(cap);
  const qz = new Int16Array(cap);
  const qyaw = new Uint8Array(cap);
  const qanim = new Uint8Array(cap);
  const sentAt = new Float64Array(cap);
  /** 0 = nothing sent yet (or reset): include on the next visible tick */
  const sent = new Uint8Array(cap);

  return {
    filter(src, nowMs, out) {
      const n = Math.min(src.count, cap);
      let included = 0;
      for (let i = 0; i < n; i++) {
        if (!src.visible[i]) {
          sent[i] = 0; // hidden (disconnected / kicked): when it is shown again, send it at once
          out[i] = 0;
          continue;
        }
        const x = clampI16(Math.round(src.x[i] * POS_SCALE));
        const y = clampI16(Math.round(src.y[i] * POS_SCALE));
        const z = clampI16(Math.round(src.z[i] * POS_SCALE));
        const yaw = Math.round((src.yaw[i] / (Math.PI * 2)) * 256) & 255;
        const anim = src.animFlags[i] & 255;
        const first = sent[i] === 0;
        const changed = x !== qx[i] || y !== qy[i] || z !== qz[i] || yaw !== qyaw[i] || anim !== qanim[i];
        if (first || changed || nowMs - sentAt[i] >= keyframeMs - DUE_EPSILON_MS) {
          qx[i] = x;
          qy[i] = y;
          qz[i] = z;
          qyaw[i] = yaw;
          qanim[i] = anim;
          // Spread the first keyframes of players that stand still together over one second
          // (15 buckets) so they do not all come due in the same tick.
          sentAt[i] = first ? nowMs - ((i % SNAPSHOT_HZ) / SNAPSHOT_HZ) * keyframeMs : nowMs;
          sent[i] = 1;
          out[i] = 1;
          included++;
        } else {
          out[i] = 0;
        }
      }
      return included;
    },
    reset(index) {
      if (index >= 0 && index < cap) sent[index] = 0;
    },
  };
}
