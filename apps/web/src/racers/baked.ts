// Pre-built racer meshes. Sculpting a racer (racers/mesher.ts) costs about 0.3-1 s of CPU each, several seconds
// on a phone. The web build sculpts every racer once (dev/racersPlugin.ts), packs each body mesh with
// encodeRacerGeometry and ships it gzipped; the game fetches them before it starts (loadBakedRacers) and
// buildRacer uses the baked mesh instead of sculpting. Anything missing is sculpted in the browser as before.
//
// Format (little-endian): magic 'WRB1', u32 vertexCount, u32 indexCount, f32 min[3], f32 max[3], then
//   position u16×3 (in the min..max box), normal i16×3, color u8×3, aFinish u8×4 (0..2), aAO u8,
//   skinIndex u8×4, skinWeight u8×4 per vertex, then the index as zigzag varint deltas.
import * as THREE from 'three';

const MAGIC = 0x31425257; // 'WRB1'
const FINISH_MAX = 2;

/** Pack a racer body geometry (the mesher's attributes) into bytes. */
export function encodeRacerGeometry(geo: THREE.BufferGeometry): Uint8Array {
  const pos = geo.getAttribute('position').array as ArrayLike<number>;
  const nrm = geo.getAttribute('normal').array as ArrayLike<number>;
  const col = geo.getAttribute('color').array as ArrayLike<number>;
  const fin = geo.getAttribute('aFinish').array as ArrayLike<number>;
  const ao = geo.getAttribute('aAO').array as ArrayLike<number>;
  const si = geo.getAttribute('skinIndex').array as ArrayLike<number>;
  const sw = geo.getAttribute('skinWeight').array as ArrayLike<number>;
  const index = geo.getIndex()!.array as ArrayLike<number>;
  const n = pos.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++)
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], pos[v * 3 + c]);
      max[c] = Math.max(max[c], pos[v * 3 + c]);
    }
  const head = 4 * 3 + 4 * 6;
  const vbytes = n * (6 + 6 + 3 + 4 + 1 + 4 + 4);
  const out = new Uint8Array(head + vbytes + index.length * 5);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, n, true);
  dv.setUint32(8, index.length, true);
  for (let c = 0; c < 3; c++) {
    dv.setFloat32(12 + c * 4, min[c], true);
    dv.setFloat32(24 + c * 4, max[c], true);
  }
  let o = head;
  const u8 = (x: number, scale = 1) => {
    out[o++] = Math.round(Math.min(1, Math.max(0, x / scale)) * 255);
  };
  for (let v = 0; v < n; v++) {
    for (let c = 0; c < 3; c++) {
      const span = max[c] - min[c] || 1;
      dv.setUint16(o, Math.round(((pos[v * 3 + c] - min[c]) / span) * 65535), true);
      o += 2;
    }
    for (let c = 0; c < 3; c++) {
      dv.setInt16(o, Math.round(Math.min(1, Math.max(-1, nrm[v * 3 + c])) * 32767), true);
      o += 2;
    }
    for (let c = 0; c < 3; c++) u8(col[v * 3 + c]);
    for (let c = 0; c < 4; c++) u8(fin[v * 4 + c], FINISH_MAX);
    u8(ao[v]);
    for (let c = 0; c < 4; c++) out[o++] = si[v * 4 + c];
    for (let c = 0; c < 4; c++) u8(sw[v * 4 + c]);
  }
  let prev = 0;
  for (let i = 0; i < index.length; i++) {
    const d = index[i] - prev;
    prev = index[i];
    let z = d >= 0 ? d * 2 : -d * 2 - 1;
    while (z >= 0x80) {
      out[o++] = (z & 0x7f) | 0x80;
      z = Math.floor(z / 128);
    }
    out[o++] = z;
  }
  return out.slice(0, o);
}

/** Unpack bytes from encodeRacerGeometry into a geometry with the mesher's attributes. */
export function decodeRacerGeometry(bytes: Uint8Array): THREE.BufferGeometry {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('baked racer: bad magic');
  const n = dv.getUint32(4, true);
  const ni = dv.getUint32(8, true);
  const min = [0, 1, 2].map((c) => dv.getFloat32(12 + c * 4, true));
  const max = [0, 1, 2].map((c) => dv.getFloat32(24 + c * 4, true));
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const fin = new Float32Array(n * 4);
  const ao = new Float32Array(n);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  let o = 36;
  for (let v = 0; v < n; v++) {
    for (let c = 0; c < 3; c++, o += 2) pos[v * 3 + c] = min[c] + (dv.getUint16(o, true) / 65535) * (max[c] - min[c]);
    for (let c = 0; c < 3; c++, o += 2) nrm[v * 3 + c] = dv.getInt16(o, true) / 32767;
    for (let c = 0; c < 3; c++) col[v * 3 + c] = bytes[o++] / 255;
    for (let c = 0; c < 4; c++) fin[v * 4 + c] = (bytes[o++] / 255) * FINISH_MAX;
    ao[v] = bytes[o++] / 255;
    for (let c = 0; c < 4; c++) si[v * 4 + c] = bytes[o++];
    for (let c = 0; c < 4; c++) sw[v * 4 + c] = bytes[o++] / 255;
  }
  const index = n > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let prev = 0;
  for (let i = 0; i < ni; i++) {
    let z = 0;
    let mul = 1;
    let b: number;
    do {
      b = bytes[o++];
      z += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    prev += z % 2 === 0 ? z / 2 : -(z + 1) / 2;
    index[i] = prev;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aFinish', new THREE.BufferAttribute(fin, 4));
  geo.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

/** Manifest key for one racer at one mesh grid size. */
export const bakedKey = (id: string, step: number) => `${id}@${step}`;

const baked = new Map<string, THREE.BufferGeometry>();

/** The baked body mesh for a racer at a grid size, if it was loaded. */
export function bakedGeometry(id: string, step: number): THREE.BufferGeometry | null {
  return baked.get(bakedKey(id, step)) ?? null;
}

async function gunzip(res: Response): Promise<Uint8Array> {
  if (!res.body) throw new Error('no body');
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let pending: Promise<number> | null = null;

/** Resolves once loadBakedRacers has finished (at once if it was never called). */
export function bakedReady(): Promise<unknown> {
  return pending ?? Promise.resolve(0);
}

/**
 * Fetch the baked racers listed in /racers.json (key -> URL of a gzipped encodeRacerGeometry file). Never throws:
 * whatever fails to load is sculpted in the browser instead.
 */
export function loadBakedRacers(manifestUrl = '/racers.json'): Promise<number> {
  pending ??= fetchBaked(manifestUrl);
  return pending;
}

async function fetchBaked(manifestUrl: string): Promise<number> {
  if (typeof DecompressionStream !== 'function') return 0;
  try {
    const res = await fetch(manifestUrl);
    if (!res.ok) return 0;
    const files = (await res.json()) as Record<string, string>;
    await Promise.all(
      Object.entries(files).map(async ([key, url]) => {
        try {
          const r = await fetch(url);
          if (r.ok) baked.set(key, decodeRacerGeometry(await gunzip(r)));
        } catch {
          // this one is sculpted on demand
        }
      }),
    );
  } catch {
    // no manifest (e.g. a test page): sculpt everything
  }
  return baked.size;
}
