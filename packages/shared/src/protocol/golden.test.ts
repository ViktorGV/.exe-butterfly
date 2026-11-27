// Golden vectors: committed bytes that pin the wire format. If one of these fails, the format
// changed and old clients can no longer talk to new servers. Do not regenerate the files to
// make the test pass unless PROTOCOL_VERSION changes with them.
import { describe, expect, it } from 'bun:test';
import { createSnapshotWriter, decodeSnapshot, decodeState, encodePlayerRecord, encodeState } from './index.ts';
import type { WireState } from './index.ts';
import malformed from './golden/malformed.json';
import snapshots from './golden/snapshot.json';
import states from './golden/state.json';
import { fromHex, toHex } from './testkit.ts';

describe('golden vectors', () => {
  it('has vectors', () => {
    expect(states.length).toBeGreaterThanOrEqual(5);
    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    expect(malformed.length).toBeGreaterThanOrEqual(10);
  });

  it.each(states.map((v) => [v.name, v] as const))('STATE: %s', (_name, v) => {
    const { seq, raceTimeMs, ...state } = v.input;
    expect(toHex(encodeState(state as WireState, seq, raceTimeMs))).toBe(v.hex);
    expect<unknown>(decodeState(fromHex(v.hex))).toEqual(v.decoded);
  });

  it.each(snapshots.map((v) => [v.name, v] as const))('SNAPSHOT: %s', (_name, v) => {
    const players = v.input.players as (WireState & { id: number })[];
    const records = new Uint8Array(players.length * 10);
    players.forEach((p, i) => encodePlayerRecord(p.id, p, records, i * 10));
    const writer = createSnapshotWriter();
    writer.begin(v.input.serverTimeMs);
    players.forEach((_, i) => writer.copyRecord(records, i));
    expect(toHex(writer.finish())).toBe(v.hex);

    const decoded: unknown[] = [];
    const serverTimeMs = decodeSnapshot(fromHex(v.hex), (id, x, y, z, yaw, anim, flags) => {
      decoded.push({ id, x, y, z, yaw, anim, flags });
    });
    expect({ serverTimeMs, records: decoded }).toEqual(v.decoded);
  });

  it.each(malformed.map((v) => [v.name, v.hex] as const))('malformed: %s', (_name, hex) => {
    let calls = 0;
    expect(decodeState(fromHex(hex))).toBeNull();
    expect(decodeSnapshot(fromHex(hex), () => calls++)).toBeNull();
    expect(calls).toBe(0);
  });
});
