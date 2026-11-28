import { describe, expect, it } from 'bun:test';
import { Anim, SIM_HZ } from '@wobble/shared/constants';
import type { Collider, CourseDef, PartDef } from '@wobble/shared/types';
import { createPlayerController, type SpawnPoint } from '../player/index.ts';
import { createCrowdCollision } from '../player/crowdCollision.ts';
import { BOT_ID_BASE, BOTS, createBots } from './bots.ts';

/** A long flat floor (top at y = 0) with one checkpoint and the finish 40 m ahead. */
const floorPart: PartDef = {
  shape: 'box',
  size: [40, 0.5, 120],
  surface: 'solid',
  slot: 'platformA',
  collide: true,
  visible: true,
};
const colliders: Collider[] = [
  {
    entityId: 1,
    part: floorPart,
    pose: { pos: [0, -0.5, -50], quat: [0, 0, 0, 1] },
    prevPose: { pos: [0, -0.5, -50], quat: [0, 0, 0, 1] },
  },
];
const course = {
  checkpoints: [{ volume: { pos: [0, 1, -15], yaw: 0, half: [20, 3, 1] }, respawn: { pos: [0, 0, -15], yaw: 0 } }],
  finish: { pos: [0, 1, -40], yaw: 0, half: [20, 3, 1] },
  killY: -10,
} as unknown as CourseDef;

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spawn(slot: number, out: SpawnPoint): SpawnPoint {
  out.pos[0] = (slot - 6) * 1.5;
  out.pos[1] = 0.05;
  out.pos[2] = 0;
  out.yaw = 0;
  return out;
}

function setup(random = seeded(1)) {
  const slots = Array.from({ length: BOTS.count }, (_, i) => (i < 6 ? i : i + 1));
  const bots = createBots({
    course,
    getColliders: () => colliders,
    slots,
    spawnPoint: spawn,
    respawnPoint: (_cp, sl, out) => spawn(sl, out),
    random,
  });
  const player = createPlayerController({
    getColliders: () => colliders,
    course,
    spawn: { pos: [0, 0.05, 0], yaw: 0 },
  });
  return { bots, player };
}

const dt = 1 / SIM_HZ;

describe('solo bots', () => {
  it('puts 11 bots on the grid, exposed as remote states for the crowd', () => {
    const { bots } = setup();
    expect(bots.ids.length).toBe(11);
    expect(bots.remote.size).toBe(11);
  });

  it('stand still while not racing, then run the course and finish in order', () => {
    const { bots, player } = setup();
    for (let i = 0; i < SIM_HZ; i++) bots.step(dt, i * dt, player.state, false);
    for (const r of bots.remote.values()) expect(Math.abs(r.pos[2])).toBeLessThan(0.1);
    const places: number[] = [];
    bots.onFinish((_id, place) => places.push(place));
    let t = 0;
    for (let i = 0; i < 60 * SIM_HZ && bots.finishedCount < bots.ids.length; i++) {
      t += dt;
      bots.step(dt, t, player.state, true);
    }
    expect(bots.finishedCount).toBe(11);
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    // the player, still on the start line, is last; finishing now places them 12th
    expect(bots.placeOf(player.state)).toBe(12);
    expect(bots.finishPlayer()).toBe(12);
    expect(bots.finishPlayer()).toBe(12);
  });

  it('places the player by progress and resets', () => {
    const { bots, player } = setup();
    player.state.pos[2] = -10;
    expect(bots.placeOf(player.state)).toBe(1);
    expect(bots.finishPlayer()).toBe(1);
    bots.reset();
    player.state.pos[2] = 5;
    expect(bots.placeOf(player.state)).toBe(12);
    expect(bots.finishedCount).toBe(0);
  });

  it('collide with the player through the crowd collision', () => {
    const { bots, player } = setup();
    const bot = bots.remote.get(BOT_ID_BASE)!;
    player.state.pos[0] = bot.pos[0] + 0.1;
    player.state.pos[2] = bot.pos[2];
    const n = createCrowdCollision().apply(player.state, bots.remote, dt);
    expect(n).toBeGreaterThan(0);
    expect(player.state.pos[0]).toBeGreaterThan(bot.pos[0] + 0.1);
  });

  it('can be pushed, saved and helped up by the player', () => {
    const { bots, player } = setup();
    const id = BOT_ID_BASE + 2;
    const ctl = bots.controller(id)!;
    expect(bots.grabbed(999, 'push', [1, 0], player.state)).toBe(false);
    expect(bots.grabbed(id, 'push', [1, 0], player.state)).toBe(true);
    expect(ctl.state.vel[0]).toBeGreaterThan(5);
    bots.grabbed(id, 'save', [0, -1], player.state);
    expect(ctl.state.pos[2]).toBeCloseTo(player.state.pos[2] - 0.8, 5);
    for (let i = 0; i < 2 * SIM_HZ; i++) bots.step(dt, 0, player.state, false);
    ctl.knockDown();
    bots.step(dt, 0, player.state, false);
    expect(ctl.state.anim).toBe(Anim.KNOCKED);
    bots.grabbed(id, 'helpUp', [0, -1], player.state);
    bots.step(dt, dt, player.state, false);
    expect(bots.remote.get(id)!.anim).not.toBe(Anim.KNOCKED);
  });

  it('sometimes push a player in reach, with a cooldown', () => {
    const { bots, player } = setup(() => 0); // always willing, shortest cooldowns
    const pushes: number[] = [];
    bots.onPush((e) => {
      expect(Math.hypot(e.dir[0], e.dir[1])).toBeCloseTo(1, 5);
      pushes.push(e.by);
    });
    let t = 0;
    const p = player.state;
    for (let i = 0; i < 12 * SIM_HZ; i++) {
      t += dt;
      // keep the player right beside the first bot
      const b = bots.remote.get(BOT_ID_BASE)!;
      p.pos[0] = b.pos[0] + 0.9;
      p.pos[1] = b.pos[1];
      p.pos[2] = b.pos[2];
      bots.step(dt, t, p, true);
    }
    expect(pushes.length).toBeGreaterThan(0);
    expect(pushes.length).toBeLessThanOrEqual(Math.ceil(12 / BOTS.pushGlobalCooldown));
  });

  it('allocate (almost) nothing per step once warmed up', () => {
    const { bots, player } = setup();
    let t = 0;
    for (let i = 0; i < 30; i++) bots.step(dt, (t += dt), player.state, true);
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) bots.step(dt, (t += dt), player.state, true);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(2_000_000);
  });
});
