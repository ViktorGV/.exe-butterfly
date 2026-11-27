// Allocation-free remote player state (#67 / MP-7).
//
// SNAPSHOT frames are decoded straight into preallocated typed arrays: every player gets a
// slot, and every slot keeps a ring of the last RING_SIZE samples. sampleRemote() interpolates
// all live players at serverNow() - interpDelayMs and writes the result into one pooled
// RemoteState per slot, held in a single Map that is returned on every call.
//
// Near and far snapshot streams are merged by time: a sample is only accepted if it is newer
// than the newest sample already stored for that player, whichever stream it came from.
//
// The SNAPSHOT codec (#17, packages/shared/src/protocol/) is not on main yet, so the frame is
// read here with a DataView using the layout in docs/CONTRACTS.md §6 and WIRE in constants.ts.
// Swap this for the shared decoder once it lands, as long as it decodes without allocating.
import { INTERP_DELAY_MS, MAX_PLAYERS_PER_ROOM, POS_SCALE, WIRE } from '@wobble/shared/constants';
import type { AnimValue, RemoteState } from '@wobble/shared/types';

/** Samples kept per player. */
export const RING_SIZE = 8;

const TWO_PI = Math.PI * 2;
const YAW_TO_RAD = TWO_PI / 256;
const INV_POS_SCALE = 1 / POS_SCALE;
const FLAG_MASK = 0xff & ~WIRE.ANIM_MASK;
const ID_SPACE = 65536; // playerId is u16

export interface RemoteBufferOptions {
  /** Maximum players tracked at once. Records for new players beyond this are dropped. */
  maxPlayers?: number;
  /** Current server time in ms, on the same clock as SNAPSHOT serverTimeMs. */
  serverNow: () => number;
  interpDelayMs?: number;
  /** Players whose newest sample is older than this (ms) are removed. */
  staleMs?: number;
}

export interface RemoteBuffer {
  /**
   * Decodes one SNAPSHOT frame. Returns the number of records accepted (new and newer than
   * what was stored). Frames that are not a well-formed SNAPSHOT are ignored (returns 0).
   * Pass a DataView to stay fully allocation-free; a bare ArrayBuffer needs a new view unless
   * it is the same buffer as the previous call.
   */
  ingest(frame: ArrayBuffer | DataView): number;
  /** Interpolated state of every live player. Same Map and same value objects every call. */
  sampleRemote(): Map<number, RemoteState>;
  /** Number of live players. */
  readonly size: number;
  /** Forgets every player. */
  clear(): void;
}

/** Wraps an angle to [-π, π). */
function wrapAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
}

export function createRemoteBuffer(opts: RemoteBufferOptions): RemoteBuffer {
  const maxPlayers = opts.maxPlayers ?? MAX_PLAYERS_PER_ROOM;
  const serverNow = opts.serverNow;
  const interpDelayMs = opts.interpDelayMs ?? INTERP_DELAY_MS;
  const staleMs = opts.staleMs ?? 3000;

  // id <-> slot
  const slotOfId = new Int32Array(ID_SPACE).fill(-1);
  const idOfSlot = new Int32Array(maxPlayers).fill(-1);
  const freeSlots = new Int32Array(maxPlayers);
  let freeCount = maxPlayers;
  for (let i = 0; i < maxPlayers; i++) freeSlots[i] = maxPlayers - 1 - i; // pop gives slot 0 first

  // dense list of live slots for iteration
  const liveSlots = new Int32Array(maxPlayers);
  const liveIndex = new Int32Array(maxPlayers).fill(-1);
  let liveCount = 0;

  // per-slot ring of samples, index = slot * RING_SIZE + i
  const ringLen = maxPlayers * RING_SIZE;
  const sTime = new Float64Array(ringLen);
  const sX = new Float32Array(ringLen);
  const sY = new Float32Array(ringLen);
  const sZ = new Float32Array(ringLen);
  const sYaw = new Float32Array(ringLen);
  const sAnimFlags = new Uint8Array(ringLen);
  const head = new Int32Array(maxPlayers); // ring index of the newest sample (0..RING_SIZE-1)
  const count = new Int32Array(maxPlayers); // samples stored (0..RING_SIZE)
  const newestTime = new Float64Array(maxPlayers);
  const inMap = new Uint8Array(maxPlayers);

  // pooled output
  const states: RemoteState[] = new Array<RemoteState>(maxPlayers);
  for (let i = 0; i < maxPlayers; i++) {
    states[i] = { pos: [0, 0, 0], yaw: 0, anim: 0, flags: 0 };
  }
  const out = new Map<number, RemoteState>();

  let lastBuffer: ArrayBuffer | null = null;
  let lastView: DataView | null = null;

  function allocSlot(id: number): number {
    if (freeCount === 0) return -1;
    const slot = freeSlots[--freeCount]!;
    slotOfId[id] = slot;
    idOfSlot[slot] = id;
    head[slot] = RING_SIZE - 1;
    count[slot] = 0;
    newestTime[slot] = -Infinity;
    inMap[slot] = 0;
    liveIndex[slot] = liveCount;
    liveSlots[liveCount++] = slot;
    return slot;
  }

  function freeSlot(slot: number): void {
    const id = idOfSlot[slot]!;
    if (inMap[slot]) out.delete(id);
    inMap[slot] = 0;
    slotOfId[id] = -1;
    idOfSlot[slot] = -1;
    count[slot] = 0;
    const li = liveIndex[slot]!;
    const lastSlot = liveSlots[--liveCount]!;
    liveSlots[li] = lastSlot;
    liveIndex[lastSlot] = li;
    liveIndex[slot] = -1;
    freeSlots[freeCount++] = slot;
  }

  function viewOf(frame: ArrayBuffer | DataView): DataView {
    if (frame instanceof DataView) return frame;
    if (frame !== lastBuffer || lastView === null) {
      lastBuffer = frame;
      lastView = new DataView(frame);
    }
    return lastView;
  }

  function ingest(frame: ArrayBuffer | DataView): number {
    const dv = viewOf(frame);
    if (dv.byteLength < WIRE.SNAPSHOT_HEADER_BYTES) return 0;
    if (dv.getUint8(0) !== WIRE.MSG_SNAPSHOT) return 0;
    const t = dv.getUint32(1, true);
    const n = dv.getUint16(5, true);
    if (dv.byteLength < WIRE.SNAPSHOT_HEADER_BYTES + n * WIRE.SNAPSHOT_RECORD_BYTES) return 0;

    let accepted = 0;
    let off = WIRE.SNAPSHOT_HEADER_BYTES;
    for (let r = 0; r < n; r++, off += WIRE.SNAPSHOT_RECORD_BYTES) {
      const id = dv.getUint16(off, true);
      let slot = slotOfId[id]!;
      if (slot < 0) {
        slot = allocSlot(id);
        if (slot < 0) continue; // full
      } else if (t <= newestTime[slot]!) {
        continue; // older or duplicate: the newer stream already won
      }
      const h = (head[slot]! + 1) % RING_SIZE;
      head[slot] = h;
      if (count[slot]! < RING_SIZE) count[slot]!++;
      newestTime[slot] = t;
      const k = slot * RING_SIZE + h;
      sTime[k] = t;
      sX[k] = dv.getInt16(off + 2, true) * INV_POS_SCALE;
      sY[k] = dv.getInt16(off + 4, true) * INV_POS_SCALE;
      sZ[k] = dv.getInt16(off + 6, true) * INV_POS_SCALE;
      sYaw[k] = wrapAngle(dv.getUint8(off + 8) * YAW_TO_RAD);
      sAnimFlags[k] = dv.getUint8(off + 9);
      accepted++;
    }
    return accepted;
  }

  function writeSample(st: RemoteState, k: number): void {
    const p = st.pos;
    p[0] = sX[k]!;
    p[1] = sY[k]!;
    p[2] = sZ[k]!;
    st.yaw = sYaw[k]!;
    const af = sAnimFlags[k]!;
    st.anim = (af & WIRE.ANIM_MASK) as AnimValue;
    st.flags = af & FLAG_MASK;
  }

  function sampleSlot(slot: number, renderTime: number): void {
    const st = states[slot]!;
    const base = slot * RING_SIZE;
    const h = head[slot]!;
    const c = count[slot]!;
    const newestK = base + h;

    // hold the newest sample once renderTime has passed it (no extrapolation)
    if (renderTime >= sTime[newestK]!) {
      writeSample(st, newestK);
      return;
    }
    // walk back from newest to find the newest sample at or before renderTime
    let newerK = newestK;
    for (let i = 1; i < c; i++) {
      const k = base + ((h - i + RING_SIZE) % RING_SIZE);
      const t0 = sTime[k]!;
      if (t0 <= renderTime) {
        const t1 = sTime[newerK]!;
        const a = (renderTime - t0) / (t1 - t0);
        const p = st.pos;
        p[0] = sX[k]! + (sX[newerK]! - sX[k]!) * a;
        p[1] = sY[k]! + (sY[newerK]! - sY[k]!) * a;
        p[2] = sZ[k]! + (sZ[newerK]! - sZ[k]!) * a;
        const y0 = sYaw[k]!;
        st.yaw = wrapAngle(y0 + wrapAngle(sYaw[newerK]! - y0) * a);
        const af = sAnimFlags[k]!;
        st.anim = (af & WIRE.ANIM_MASK) as AnimValue;
        st.flags = af & FLAG_MASK;
        return;
      }
      newerK = k;
    }
    // renderTime is before the oldest sample: use the oldest
    writeSample(st, newerK);
  }

  function sampleRemote(): Map<number, RemoteState> {
    const now = serverNow();
    const renderTime = now - interpDelayMs;
    const staleBefore = now - staleMs;
    let i = 0;
    while (i < liveCount) {
      const slot = liveSlots[i]!;
      if (newestTime[slot]! < staleBefore) {
        freeSlot(slot); // swaps the last live slot into index i
        continue;
      }
      sampleSlot(slot, renderTime);
      if (!inMap[slot]) {
        out.set(idOfSlot[slot]!, states[slot]!);
        inMap[slot] = 1;
      }
      i++;
    }
    return out;
  }

  function clear(): void {
    while (liveCount > 0) freeSlot(liveSlots[liveCount - 1]!);
    out.clear();
  }

  return {
    ingest,
    sampleRemote,
    get size() {
      return liveCount;
    },
    clear,
  };
}
