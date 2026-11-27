import { describe, expect, it } from 'bun:test';
import { POS_SCALE, WIRE } from '@wobble/shared/constants';
import { uniqueName } from '../room/names.ts';
import { backpressure, createIpCounter, originAllowed } from './guards.ts';
import { createStateDecoder } from './stateFrame.ts';

describe('guards', () => {
  it('checks origins against the allow-list or same host', () => {
    expect(originAllowed(null, 'a.com', ['https://b.com'])).toBe(true);
    expect(originAllowed('https://b.com', 'a.com', ['https://b.com'])).toBe(true);
    expect(originAllowed('https://a.com', 'a.com', ['https://b.com'])).toBe(true);
    expect(originAllowed('https://evil.com', 'a.com', ['https://b.com'])).toBe(false);
    expect(originAllowed('https://evil.com', 'a.com', [])).toBe(true);
  });
  it('caps connections per IP', () => {
    const ips = createIpCounter(2);
    expect([ips.acquire('x'), ips.acquire('x'), ips.acquire('x')]).toEqual([true, true, false]);
    ips.release('x');
    expect(ips.acquire('x')).toBe(true);
  });
  it('drops above 256 KB and kicks above 1 MB', () => {
    expect(backpressure(0)).toBe('send');
    expect(backpressure(300 * 1024)).toBe('drop');
    expect(backpressure(2 * 1024 * 1024)).toBe('kick');
  });
});

describe('names', () => {
  it('sanitises and de-duplicates', () => {
    expect(uniqueName('  <b>Ann</b> ', [])).toBe('Ann');
    expect(uniqueName('', [])).toBe('Wobbler');
    expect(uniqueName('ann', ['Ann', 'ann 2'])).toBe('ann 3');
    expect(uniqueName('ABCDEFGHIJKLMNOP', ['ABCDEFGHIJKLMNOP']).length).toBeLessThanOrEqual(16);
  });
});

describe('state decoder', () => {
  it('decodes a STATE frame and rejects bad sizes', () => {
    const buf = new Uint8Array(WIRE.STATE_BYTES);
    const dv = new DataView(buf.buffer);
    dv.setUint8(0, WIRE.MSG_STATE);
    dv.setUint16(1, 7, true);
    dv.setUint32(3, 1234, true);
    dv.setInt16(7, 1 * POS_SCALE, true);
    dv.setInt16(11, -2 * POS_SCALE, true);
    dv.setUint8(14, 1 | WIRE.FLAG_GROUNDED);
    const decode = createStateDecoder();
    const s = decode(buf)!;
    expect(s).toMatchObject({ seq: 7, raceTimeMs: 1234, pos: [1, 0, -2], anim: 1, grounded: true, finished: false });
    expect(decode(buf.subarray(0, 5))).toBeNull();
  });
});
