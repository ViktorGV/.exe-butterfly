// Zone-based snapshots (#55, MP-1): encode once per zone, not once per player.
// The course runs toward -Z, so it is cut into slices ("zones"). Every tick each zone that has
// listeners gets ONE near SNAPSHOT holding the players inside it, published to its topic. A player
// subscribes to its own zone plus the previous and next one, so it receives everyone within about
// one zone length. A far SNAPSHOT of all players goes to a shared topic at a lower rate.
// Socket-free: the transport passes a ZoneBus (server.publish / ws.subscribe / ws.unsubscribe).
// Allocation-free in steady state: topic strings, buffers and frame views are created up front.
import { SNAPSHOT_HZ, WIRE } from '@wobble/shared/constants';
import { writeRecord } from './snapshot.ts';
import type { SnapshotSource } from './snapshot.ts';

export const DEFAULT_ZONE_LENGTH_M = 40;
export const DEFAULT_FAR_HZ = 4;

/** What the transport provides. `index` is the player's index in the SnapshotSource. */
export interface ZoneBus {
  /** Sends `data` to every subscriber of `topic`. The bytes are reused after the call returns. */
  publish(topic: string, data: Uint8Array): void;
  subscribe(index: number, topic: string): void;
  unsubscribe(index: number, topic: string): void;
}

export interface ZoneOptions {
  roomId: string | number;
  /** Players in the source (the largest `count` that will be passed to `build`). */
  capacity: number;
  /** Z of the start line; zone 0 begins here and zones follow toward -Z. */
  startZ: number;
  /** Z of the finish; the last zone covers it. */
  endZ: number;
  /** Zone length in metres (default 40). */
  zoneLength?: number;
  /** Far snapshot rate in Hz (default 4, never above SNAPSHOT_HZ). */
  farHz?: number;
}

export interface ZoneStats {
  /** Frames encoded by the last build() (near zones + far). */
  encodes: number;
  /** Whether the last build() published the far frame. */
  far: boolean;
}

export interface ZoneSnapshots {
  readonly zoneCount: number;
  readonly zoneLength: number;
  readonly farTopic: string;
  zoneTopic(zone: number): string;
  /** Zone index of a Z coordinate, clamped to 0..zoneCount-1. */
  zoneOf(z: number): number;
  /** Encodes and publishes this tick's frames and updates subscriptions. Call once per tick. */
  build(src: SnapshotSource, serverTimeMs: number, bus: ZoneBus): void;
  /** Drops every subscription of a player right away (it left the room). */
  release(index: number, bus: ZoneBus): void;
  stats(): ZoneStats;
}

export function createZoneSnapshots(opts: ZoneOptions): ZoneSnapshots {
  const zoneLength = opts.zoneLength ?? DEFAULT_ZONE_LENGTH_M;
  if (!(zoneLength > 0)) throw new RangeError('createZoneSnapshots: zoneLength must be > 0');
  const farHz = Math.min(opts.farHz ?? DEFAULT_FAR_HZ, SNAPSHOT_HZ);
  if (!(farHz > 0)) throw new RangeError('createZoneSnapshots: farHz must be > 0');
  const capacity = Math.max(1, opts.capacity);
  const { startZ } = opts;
  const zoneCount = Math.max(1, Math.ceil((startZ - opts.endZ) / zoneLength));
  const farPeriodMs = 1000 / farHz;
  const R = WIRE.SNAPSHOT_RECORD_BYTES;
  const H = WIRE.SNAPSHOT_HEADER_BYTES;

  const prefix = `room:${opts.roomId}:`;
  const farTopic = `${prefix}far`;
  const topics: string[] = [];
  for (let k = 0; k < zoneCount; k++) topics.push(`${prefix}zone:${k}`);

  const records = new Uint8Array(capacity * R);
  const recDv = new DataView(records.buffer);
  const out = new Uint8Array(H + capacity * R);
  const outDv = new DataView(out.buffer);
  const views: (Uint8Array | undefined)[] = [];
  const view = (len: number) => (views[len] ??= out.subarray(0, len));

  const zoneOfPlayer = new Int32Array(capacity);
  const order = new Int32Array(capacity);
  const counts = new Int32Array(zoneCount);
  const starts = new Int32Array(zoneCount + 1);
  const fill = new Int32Array(zoneCount);
  /** receivers currently subscribed to each zone topic */
  const listeners = new Int32Array(zoneCount);
  let farListeners = 0;
  // current subscription of each player: zones subLo..subHi (subLo > subHi = none)
  const subLo = new Int32Array(capacity).fill(0);
  const subHi = new Int32Array(capacity).fill(-1);
  const farSub = new Uint8Array(capacity);
  let nextFarAt = 0;
  let encodes = 0;
  let farSent = false;

  function zoneOf(z: number): number {
    const k = Math.floor((startZ - z) / zoneLength);
    return k < 0 ? 0 : k >= zoneCount ? zoneCount - 1 : k;
  }

  /** Moves player `i` from its current zone window to lo..hi (lo > hi = none). */
  function retarget(i: number, lo: number, hi: number, bus: ZoneBus) {
    const ol = subLo[i];
    const oh = subHi[i];
    for (let k = ol; k <= oh; k++) {
      if (k >= lo && k <= hi) continue;
      bus.unsubscribe(i, topics[k]);
      listeners[k]--;
    }
    for (let k = lo; k <= hi; k++) {
      if (k >= ol && k <= oh) continue;
      bus.subscribe(i, topics[k]);
      listeners[k]++;
    }
    subLo[i] = lo;
    subHi[i] = hi;
  }

  function setFar(i: number, on: boolean, bus: ZoneBus) {
    if (farSub[i] === (on ? 1 : 0)) return;
    farSub[i] = on ? 1 : 0;
    if (on) {
      bus.subscribe(i, farTopic);
      farListeners++;
    } else {
      bus.unsubscribe(i, farTopic);
      farListeners--;
    }
  }

  function begin(serverTimeMs: number) {
    outDv.setUint8(0, WIRE.MSG_SNAPSHOT);
    outDv.setUint32(1, Math.floor(serverTimeMs) >>> 0, true);
  }

  function copyRecord(src: number, dst: number) {
    const s = src * R;
    for (let b = 0; b < R; b++) out[dst + b] = records[s + b];
  }

  function build(src: SnapshotSource, serverTimeMs: number, bus: ZoneBus) {
    const n = Math.min(src.count, capacity);
    encodes = 0;
    farSent = false;

    // 1. per-player record + zone, bucketed by zone (counting sort)
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      zoneOfPlayer[i] = zoneOf(src.z[i]);
      if (!src.visible[i]) continue;
      writeRecord(recDv, i * R, src.ids[i], src.x[i], src.y[i], src.z[i], src.yaw[i], src.animFlags[i]);
      counts[zoneOfPlayer[i]]++;
    }
    let sum = 0;
    for (let k = 0; k < zoneCount; k++) {
      starts[k] = sum;
      fill[k] = sum;
      sum += counts[k];
    }
    starts[zoneCount] = sum;
    for (let i = 0; i < n; i++) if (src.visible[i]) order[fill[zoneOfPlayer[i]]++] = i;

    // 2. subscriptions follow each receiver's zone
    for (let i = 0; i < n; i++) {
      if (src.receives[i]) {
        const z = zoneOfPlayer[i];
        const lo = z > 0 ? z - 1 : 0;
        const hi = z < zoneCount - 1 ? z + 1 : zoneCount - 1;
        if (lo !== subLo[i] || hi !== subHi[i]) retarget(i, lo, hi, bus);
        setFar(i, true, bus);
      } else if (subLo[i] <= subHi[i] || farSub[i]) {
        retarget(i, 0, -1, bus);
        setFar(i, false, bus);
      }
    }

    // 3. one near frame per zone that has players and listeners
    begin(serverTimeMs);
    for (let k = 0; k < zoneCount; k++) {
      const count = counts[k];
      if (count === 0 || listeners[k] === 0) continue;
      let off = H;
      for (let c = starts[k]; c < starts[k + 1]; c++, off += R) copyRecord(order[c], off);
      outDv.setUint16(5, count, true);
      bus.publish(topics[k], view(off));
      encodes++;
    }

    // 4. far frame (everyone) at the lower rate
    if (farListeners > 0 && sum > 0 && serverTimeMs >= nextFarAt) {
      nextFarAt = serverTimeMs - nextFarAt > farPeriodMs ? serverTimeMs + farPeriodMs : nextFarAt + farPeriodMs;
      let off = H;
      for (let c = 0; c < sum; c++, off += R) copyRecord(order[c], off);
      outDv.setUint16(5, sum, true);
      bus.publish(farTopic, view(off));
      encodes++;
      farSent = true;
    }
  }

  return {
    zoneCount,
    zoneLength,
    farTopic,
    zoneTopic: (zone) => topics[zone],
    zoneOf,
    build,
    release(index, bus) {
      if (index < 0 || index >= capacity) return;
      retarget(index, 0, -1, bus);
      setFar(index, false, bus);
    },
    stats: () => ({ encodes, far: farSent }),
  };
}
