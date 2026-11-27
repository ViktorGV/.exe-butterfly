// Little-endian integer access on a plain Uint8Array.
//
// Byte arithmetic instead of a DataView: it needs no extra object per buffer, so the codec can
// read a frame a socket just handed over (a Bun Buffer, a view at any byteOffset) and write
// into any caller-owned array without allocating. Callers bounds-check before using these.

export function writeU16(b: Uint8Array, o: number, v: number): void {
  b[o] = v;
  b[o + 1] = v >>> 8;
}

export function writeU32(b: Uint8Array, o: number, v: number): void {
  b[o] = v;
  b[o + 1] = v >>> 8;
  b[o + 2] = v >>> 16;
  b[o + 3] = v >>> 24;
}

export function readU16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}

export function readI16(b: Uint8Array, o: number): number {
  return ((b[o] | (b[o + 1] << 8)) << 16) >> 16;
}

export function readU32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/**
 * Views socket data as bytes without copying. Browsers deliver binary frames as `ArrayBuffer`
 * (with `binaryType = 'arraybuffer'`), Bun as a `Buffer`, which already is a `Uint8Array`.
 * Wrapping an `ArrayBuffer` creates one small view object; nothing else in the codec allocates.
 */
export function asBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
