// SNAPSHOT encoding and interest management (docs/CONTRACTS.md §6). Allocation-free after construction.
// Local record writer until the codec (#17) lands: swap `writeRecord` for the shared one then.
import { NEAR_SET_SIZE, POS_SCALE, WIRE } from '@wobble/shared/constants';

/** Far players are split into this many groups, one refreshed per tick (15 Hz / 4 = 3.75 Hz). */
export const FAR_GROUPS = 4;

const clampI16 = (v: number) => (v > 32767 ? 32767 : v < -32768 ? -32768 : v);

/** Writes one 10-byte SNAPSHOT record at `off`. */
export function writeRecord(
  dv: DataView,
  off: number,
  id: number,
  x: number,
  y: number,
  z: number,
  yaw: number,
  animFlags: number,
): void {
  dv.setUint16(off, id, true);
  dv.setInt16(off + 2, clampI16(Math.round(x * POS_SCALE)), true);
  dv.setInt16(off + 4, clampI16(Math.round(y * POS_SCALE)), true);
  dv.setInt16(off + 6, clampI16(Math.round(z * POS_SCALE)), true);
  dv.setUint8(off + 8, Math.round((yaw / (Math.PI * 2)) * 256) & 255);
  dv.setUint8(off + 9, animFlags & 255);
}

export interface SnapshotSource {
  count: number;
  ids: Uint16Array;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  yaw: Float64Array;
  animFlags: Uint8Array;
  /** 1 when the player is shown in snapshots */
  visible: Uint8Array;
  /** 1 when the player receives snapshots */
  receives: Uint8Array;
}

export function createSnapshotBuilder(capacity: number) {
  const R = WIRE.SNAPSHOT_RECORD_BYTES;
  const H = WIRE.SNAPSHOT_HEADER_BYTES;
  const records = new Uint8Array(capacity * R);
  const recDv = new DataView(records.buffer);
  const out = new Uint8Array(H + capacity * R);
  const outDv = new DataView(out.buffer);
  /** cached subarray views by byte length, so steady state allocates nothing */
  const views: (Uint8Array | undefined)[] = [];
  const cand = new Int32Array(capacity);
  const dist = new Float64Array(capacity);
  const stamp = new Uint32Array(capacity);
  let stampNo = 0;
  let tickNo = 0;

  const view = (len: number) => (views[len] ??= out.subarray(0, len));

  /** Hoare quickselect: puts the k smallest dist entries of cand[0..n) first. */
  function select(n: number, k: number) {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const pivot = dist[cand[(lo + hi) >> 1]];
      let i = lo;
      let j = hi;
      while (i <= j) {
        while (dist[cand[i]] < pivot) i++;
        while (dist[cand[j]] > pivot) j--;
        if (i <= j) {
          const t = cand[i];
          cand[i] = cand[j];
          cand[j] = t;
          i++;
          j--;
        }
      }
      if (k - 1 <= j) hi = j;
      else if (k - 1 >= i) lo = i;
      else return;
    }
  }

  function copyRecord(src: number, dst: number) {
    const s = src * R;
    for (let b = 0; b < R; b++) out[dst + b] = records[s + b];
  }

  /** Builds and sends one snapshot per receiving player. Bytes passed to `send` are reused next call. */
  function build(src: SnapshotSource, serverTimeMs: number, send: (index: number, data: Uint8Array) => void): void {
    const n = src.count;
    for (let i = 0; i < n; i++) {
      if (src.visible[i])
        writeRecord(recDv, i * R, src.ids[i], src.x[i], src.y[i], src.z[i], src.yaw[i], src.animFlags[i]);
    }
    const group = tickNo++ % FAR_GROUPS;
    outDv.setUint8(0, WIRE.MSG_SNAPSHOT);
    outDv.setUint32(1, Math.floor(serverTimeMs) >>> 0, true);
    for (let r = 0; r < n; r++) {
      if (!src.receives[r]) continue;
      const rx = src.x[r];
      const ry = src.y[r];
      const rz = src.z[r];
      let m = 0;
      for (let i = 0; i < n; i++) {
        if (i === r || !src.visible[i]) continue;
        const dx = src.x[i] - rx;
        const dy = src.y[i] - ry;
        const dz = src.z[i] - rz;
        dist[i] = dx * dx + dy * dy + dz * dz;
        cand[m++] = i;
      }
      const near = m < NEAR_SET_SIZE ? m : NEAR_SET_SIZE;
      if (m > near) select(m, near);
      stampNo = (stampNo + 1) >>> 0 || 1;
      let off = H;
      for (let c = 0; c < near; c++) {
        stamp[cand[c]] = stampNo;
        copyRecord(cand[c], off);
        off += R;
      }
      let count = near;
      for (let c = near; c < m; c++) {
        const i = cand[c];
        if (i % FAR_GROUPS !== group || stamp[i] === stampNo) continue;
        copyRecord(i, off);
        off += R;
        count++;
      }
      outDv.setUint16(5, count, true);
      send(r, view(off));
    }
  }

  return { build };
}
