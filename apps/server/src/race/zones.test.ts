import { describe, expect, it } from 'bun:test';
import { POS_SCALE, SNAPSHOT_HZ, WIRE } from '@wobble/shared/constants';
import { fixtureCourse } from '@wobble/shared/fixtures/index';
import type { SnapshotSource } from './snapshot.ts';
import { createZoneSnapshots } from './zones.ts';
import type { ZoneBus, ZoneOptions } from './zones.ts';

const STEP_MS = 1000 / SNAPSHOT_HZ;
const START_Z = fixtureCourse.spawn.pos[2];
const END_Z = fixtureCourse.finish.pos[2];

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSource(count: number): SnapshotSource {
  return {
    count,
    ids: Uint16Array.from({ length: count }, (_, i) => 1000 + i),
    x: new Float64Array(count),
    y: new Float64Array(count),
    z: new Float64Array(count),
    yaw: new Float64Array(count),
    animFlags: new Uint8Array(count),
    visible: new Uint8Array(count).fill(1),
    receives: new Uint8Array(count).fill(1),
  };
}

/** 300 bots spread along the whole fixture course (z from just behind the start to past the finish). */
function spread(count: number, seed = 7): SnapshotSource {
  const src = makeSource(count);
  const rand = rng(seed);
  for (let i = 0; i < count; i++) {
    src.x[i] = (rand() - 0.5) * 20;
    src.y[i] = 0.5;
    src.z[i] = START_Z + 2 - rand() * (START_Z - END_Z + 6);
  }
  return src;
}

interface Published {
  topic: string;
  ids: number[];
  count: number;
  timeMs: number;
}

function decode(data: Uint8Array): { ids: number[]; timeMs: number; xs: number[] } {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  expect(dv.getUint8(0)).toBe(WIRE.MSG_SNAPSHOT);
  const count = dv.getUint16(5, true);
  expect(data.byteLength).toBe(WIRE.SNAPSHOT_HEADER_BYTES + count * WIRE.SNAPSHOT_RECORD_BYTES);
  const ids: number[] = [];
  const xs: number[] = [];
  for (let k = 0; k < count; k++) {
    const o = WIRE.SNAPSHOT_HEADER_BYTES + k * WIRE.SNAPSHOT_RECORD_BYTES;
    ids.push(dv.getUint16(o, true));
    xs.push(dv.getInt16(o + 2, true) / POS_SCALE);
  }
  return { ids, timeMs: dv.getUint32(1, true), xs };
}

/** A fake transport that records subscriptions and publishes, like ws.subscribe / server.publish. */
function fakeBus() {
  const subs = new Map<number, Set<string>>();
  const published: Published[] = [];
  const bus: ZoneBus = {
    publish(topic, data) {
      const d = decode(data);
      published.push({ topic, ids: d.ids, count: d.ids.length, timeMs: d.timeMs });
    },
    subscribe(index, topic) {
      let set = subs.get(index);
      if (!set) subs.set(index, (set = new Set()));
      expect(set.has(topic)).toBe(false); // never double-subscribe
      set.add(topic);
    },
    unsubscribe(index, topic) {
      expect(subs.get(index)?.delete(topic)).toBe(true); // only drop what was subscribed
    },
  };
  return { bus, subs, published, topicsOf: (i: number) => [...(subs.get(i) ?? [])].sort() };
}

const options = (over: Partial<ZoneOptions> = {}): ZoneOptions => ({
  roomId: 'r1',
  capacity: 300,
  startZ: START_Z,
  endZ: END_Z,
  zoneLength: 10,
  ...over,
});

describe('createZoneSnapshots', () => {
  it('maps z to zones with floor((startZ - z) / zoneLength), clamped to the course', () => {
    const zones = createZoneSnapshots(options({ zoneLength: 40 }));
    expect(zones.zoneCount).toBe(2); // 53 m of course
    expect(zones.zoneOf(START_Z)).toBe(0);
    expect(zones.zoneOf(START_Z - 39.9)).toBe(0);
    expect(zones.zoneOf(START_Z - 40)).toBe(1);
    expect(zones.zoneOf(START_Z + 8)).toBe(0); // behind the start line
    expect(zones.zoneOf(END_Z - 100)).toBe(1); // past the finish
    expect(createZoneSnapshots(options()).zoneLength).toBe(10);
    expect(createZoneSnapshots({ ...options(), zoneLength: undefined }).zoneLength).toBe(40);
  });

  it('encodes at most zones + 1 frames per tick for 300 bots', () => {
    const zones = createZoneSnapshots(options());
    const src = spread(300);
    const { bus, published } = fakeBus();
    for (let tick = 1; tick <= 30; tick++) {
      published.length = 0;
      zones.build(src, tick * STEP_MS, bus);
      expect(zones.stats().encodes).toBe(published.length);
      expect(zones.stats().encodes).toBeLessThanOrEqual(zones.zoneCount + 1);
    }
    expect(zones.zoneCount).toBe(6);
  });

  it('subscribes a player crossing a zone boundary to exactly the right topics', () => {
    const zones = createZoneSnapshots(options({ capacity: 1 }));
    const src = makeSource(1);
    const { bus, topicsOf } = fakeBus();
    const zone = (k: number) => zones.zoneTopic(k);
    const at = (k: number, off = 1) => START_Z - k * 10 - off;

    src.z[0] = at(0);
    zones.build(src, STEP_MS, bus);
    expect(topicsOf(0)).toEqual([zones.farTopic, zone(0), zone(1)].sort());

    src.z[0] = at(2); // jumps two zones in one tick
    zones.build(src, 2 * STEP_MS, bus);
    expect(topicsOf(0)).toEqual([zones.farTopic, zone(1), zone(2), zone(3)].sort());

    src.z[0] = at(3, 0); // exactly on the boundary belongs to the next zone
    zones.build(src, 3 * STEP_MS, bus);
    expect(topicsOf(0)).toEqual([zones.farTopic, zone(2), zone(3), zone(4)].sort());

    src.z[0] = at(5); // last zone: no zone ahead
    zones.build(src, 4 * STEP_MS, bus);
    expect(topicsOf(0)).toEqual([zones.farTopic, zone(4), zone(5)].sort());

    src.receives[0] = 0; // stops receiving: everything dropped
    zones.build(src, 5 * STEP_MS, bus);
    expect(topicsOf(0)).toEqual([]);
  });

  it('release() drops every subscription of a player that left', () => {
    const zones = createZoneSnapshots(options({ capacity: 2 }));
    const src = makeSource(2);
    const { bus, topicsOf } = fakeBus();
    zones.build(src, STEP_MS, bus);
    expect(topicsOf(1).length).toBeGreaterThan(0);
    zones.release(1, bus);
    expect(topicsOf(1)).toEqual([]);
    expect(topicsOf(0).length).toBeGreaterThan(0);
  });

  it('puts every player in a near snapshot that reaches each neighbour within one tick', () => {
    const zones = createZoneSnapshots(options());
    const src = spread(300);
    const { bus, subs, published } = fakeBus();
    zones.build(src, STEP_MS, bus);

    // who receives which player this tick: union of the near frames on topics the receiver follows
    const received = Array.from({ length: 300 }, () => new Set<number>());
    for (const p of published) {
      if (p.topic === zones.farTopic) continue;
      for (const [index, topics] of subs) if (topics.has(p.topic)) for (const id of p.ids) received[index].add(id);
    }
    for (let a = 0; a < 300; a++) {
      for (let b = 0; b < 300; b++) {
        if (a === b) continue;
        if (Math.abs(zones.zoneOf(src.z[a]) - zones.zoneOf(src.z[b])) <= 1) {
          expect(received[b].has(src.ids[a])).toBe(true);
        }
      }
    }
    // a zone frame holds exactly its own players, once each
    const seen = new Set<number>();
    for (const p of published) {
      if (p.topic === zones.farTopic) continue;
      for (const id of p.ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(300);
  });

  it('publishes one far frame with every visible player at farHz, to the shared topic', () => {
    const zones = createZoneSnapshots(options({ farHz: 4 }));
    const src = spread(300);
    src.visible[5] = 0; // hidden players are in no frame
    src.receives[5] = 0;
    const { bus, published } = fakeBus();
    let farFrames = 0;
    let firstFar: Published | undefined;
    const ticks = SNAPSHOT_HZ * 4; // 4 s
    for (let t = 1; t <= ticks; t++) {
      published.length = 0;
      zones.build(src, t * STEP_MS, bus);
      for (const p of published) {
        expect(p.ids).not.toContain(src.ids[5]);
        if (p.topic === zones.farTopic) {
          farFrames++;
          firstFar ??= p;
          expect(zones.stats().far).toBe(true);
        }
      }
    }
    // the first far frame goes out on the first tick, then one every 250 ms: 4 Hz over 4 s is 16 + 1
    expect(farFrames).toBe(17);
    expect(firstFar?.count).toBe(299);
    expect(new Set(firstFar?.ids).size).toBe(299);
  });

  it('writes the server time and quantised records the SNAPSHOT contract expects', () => {
    const zones = createZoneSnapshots(options({ capacity: 1 }));
    const src = makeSource(1);
    src.x[0] = 3.5;
    src.z[0] = START_Z - 1;
    const frames: { topic: string; ids: number[]; timeMs: number; xs: number[] }[] = [];
    const bus: ZoneBus = {
      publish: (topic, data) => frames.push({ topic, ...decode(data) }),
      subscribe: () => {},
      unsubscribe: () => {},
    };
    zones.build(src, 123456.9, bus);
    expect(frames.length).toBe(2); // near + far
    for (const f of frames) {
      expect(f.timeMs).toBe(123456);
      expect(f.ids).toEqual([1000]);
      expect(f.xs[0]).toBeCloseTo(3.5, 1);
    }
  });

  it('skips zones without players and publishes nothing for an empty room', () => {
    const zones = createZoneSnapshots(options());
    const src = makeSource(3);
    for (let i = 0; i < 3; i++) src.z[i] = START_Z - 1; // all in zone 0
    const { bus, published } = fakeBus();
    zones.build(src, STEP_MS, bus);
    expect(published.map((p) => p.topic).sort()).toEqual([zones.zoneTopic(0), zones.farTopic].sort());
    published.length = 0;
    src.visible.fill(0);
    zones.build(src, 2 * STEP_MS, bus);
    expect(published.length).toBe(0);
  });

  it('encodes a tick for 300 players in under 2 ms', () => {
    const zones = createZoneSnapshots(options({ zoneLength: 40 }));
    const src = spread(300);
    const bus: ZoneBus = { publish: () => {}, subscribe: () => {}, unsubscribe: () => {} };
    for (let t = 1; t <= 200; t++) zones.build(src, t * STEP_MS, bus); // warm-up + steady-state subscriptions
    const runs = 500;
    const times = new Float64Array(runs);
    for (let r = 0; r < runs; r++) {
      const t0 = Bun.nanoseconds();
      zones.build(src, (201 + r) * STEP_MS, bus);
      times[r] = (Bun.nanoseconds() - t0) / 1e6;
    }
    times.sort();
    const median = times[runs >> 1];
    const p99 = times[Math.floor(runs * 0.99)];
    console.log(`zone snapshots, 300 players: median ${median.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms`);
    expect(median).toBeLessThan(2);
  });

  it('rejects bad options', () => {
    expect(() => createZoneSnapshots(options({ zoneLength: 0 }))).toThrow(RangeError);
    expect(() => createZoneSnapshots(options({ farHz: 0 }))).toThrow(RangeError);
  });
});
