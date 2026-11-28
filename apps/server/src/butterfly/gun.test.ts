import { describe, expect, it } from 'bun:test';
import { BUTTERFLY, GUNS } from '@wobble/shared/constants';
import type { GunKind, ServerMessage, Vec3 } from '@wobble/shared/types';
import { createButterflyServer } from './index.ts';

function setup(opts: { racing?: (id: number) => boolean; kind?: GunKind; pos?: [number, Vec3][]; yaw?: number } = {}) {
  const pos = new Map<number, Vec3>(
    opts.pos ?? [
      [1, [0, 0, 0]],
      [2, [1, 0, 0]],
      [3, [GUNS.blaster.rangeM * 2, 0, 0]],
    ],
  );
  let t = 1_000;
  const sent: [number, ServerMessage][] = [];
  const published: ServerMessage[] = [];
  const server = createButterflyServer({
    session: () => ({
      getPosition: (id, out) => {
        const p = pos.get(id);
        if (!p) return false;
        out[0] = p[0];
        out[1] = p[1];
        out[2] = p[2];
        return true;
      },
      getYaw: () => opts.yaw ?? 0,
      approveSave: () => {},
    }),
    send: (id, msg) => sent.push([id, msg]),
    publish: (msg) => published.push(msg),
    now: () => t,
    isRacing: opts.racing,
    racers: () => pos.keys(),
    rollGun: () => opts.kind ?? 'blaster',
  });
  const arm = (id: number) => {
    // a helper pusher standing on the player (never a gun target: distance 0 and not ahead)
    const pusher = 99;
    pos.set(pusher, [...pos.get(id)!] as Vec3);
    for (let i = 0; i < BUTTERFLY.GUN_PUSHES; i++) {
      t += BUTTERFLY.GRAB_COOLDOWN_MS;
      server.grab(pusher, { t: 'grab', target: id, kind: 'push', dir: [-1, 0] });
    }
  };
  const shots = () => published.filter((m) => m.t === 'shot');
  return { server, sent, published, shots, arm, tick: (ms: number) => (t += ms) };
}

describe('gun on the server', () => {
  it('tells the room the kind and shots at the 5th push (others can see who is armed)', () => {
    const { server, published, arm } = setup({ kind: 'rocket' });
    arm(1);
    expect(published).toContainEqual({ t: 'gun', id: 1, kind: 'rocket', shots: GUNS.rocket.shots });
    expect(server.shots(1)).toBe(GUNS.rocket.shots);
    expect(server.gunKind(1)).toBe('rocket');
  });

  it('refuses without a gun, at yourself, and out of range', () => {
    const { server, arm } = setup();
    expect(server.shoot(1, 2)).toBe('no_gun');
    arm(1);
    expect(server.shoot(1, 1)).toBe('self');
    expect(server.shoot(1, 3)).toBe('out_of_range');
    expect(server.shots(1)).toBe(GUNS.blaster.shots);
  });

  it('a shot spends one round, tells the room what is left and who was shot', () => {
    const { server, published, arm } = setup();
    arm(1);
    expect(server.shoot(1, 2)).toBe('ok');
    expect(published).toContainEqual({ t: 'gun', id: 1, kind: 'blaster', shots: GUNS.blaster.shots - 1 });
    expect(published).toContainEqual({ t: 'shot', by: 1, kind: 'blaster', targets: [2] });
    expect(published).toContainEqual({ t: 'marked', id: 1, by: 2 });
    expect(server.isMarked(1)).toBe(true);
  });

  it('has a per-kind cooldown between shots', () => {
    const { server, arm, tick } = setup({
      kind: 'shotgun',
      pos: [
        [1, [0, 0, 0]],
        [2, [0, 0, -3]],
      ],
    });
    arm(1);
    expect(server.shoot(1)).toBe('ok');
    tick(GUNS.shotgun.cooldownMs - 1);
    expect(server.shoot(1)).toBe('cooldown');
    tick(1);
    expect(server.shoot(1)).toBe('ok');
  });

  it('cannot shoot someone who is no longer racing', () => {
    const { server, arm } = setup({ racing: (id) => id !== 2 });
    arm(1);
    expect(server.shoot(1, 2)).toBe('unknown_player');
  });
});

describe('shotgun (cone)', () => {
  const pos: [number, Vec3][] = [
    [1, [0, 0, 0]],
    [2, [0, 0, -5]], // in front
    [3, [1, 0, -8]], // in front, slightly off-axis
    [4, [6, 0, -2]], // too far off to the side
    [5, [0, 0, 5]], // behind
    [6, [0, 0, -(GUNS.shotgun.rangeM + 2)]], // too far
  ];
  it('hits every racer in the cone, never the shooter, nobody outside', () => {
    const { server, shots, arm } = setup({ kind: 'shotgun', pos });
    arm(1);
    expect(server.shoot(1)).toBe('ok');
    expect(shots()).toEqual([{ t: 'shot', by: 1, kind: 'shotgun', targets: [2, 3] }]);
  });
  it('uses the shooter facing', () => {
    const { server, shots, arm } = setup({ kind: 'shotgun', pos, yaw: Math.PI });
    arm(1);
    expect(server.shoot(1)).toBe('ok');
    expect(shots()).toEqual([{ t: 'shot', by: 1, kind: 'shotgun', targets: [5] }]);
  });
  it('keeps the shell when nobody is in the cone', () => {
    const { server, arm } = setup({ kind: 'shotgun', pos, yaw: Math.PI / 2 });
    arm(1);
    expect(server.shoot(1)).toBe('no_target');
    expect(server.shots(1)).toBe(GUNS.shotgun.shots);
  });
});

describe('rocket launcher (homing)', () => {
  const pos: [number, Vec3][] = [
    [1, [0, 0, 0]],
    [2, [0, 0, -30]],
    [3, [2, 0, -10]], // nearest ahead
    [4, [0, 0, 3]], // nearer, but behind
    [5, [0, 0, -5]], // finished
  ];
  it('picks the nearest racer ahead, ignoring racers behind or out', () => {
    const { server, shots, arm } = setup({ kind: 'rocket', pos, racing: (id) => id !== 5 });
    arm(1);
    expect(server.shoot(1)).toBe('ok');
    expect(shots()).toEqual([{ t: 'shot', by: 1, kind: 'rocket', targets: [3] }]);
  });
  it('does nothing and keeps the rocket for the race leader', () => {
    const { server, arm } = setup({
      kind: 'rocket',
      pos: [
        [1, [0, 0, -50]],
        [2, [0, 0, 0]],
      ],
    });
    arm(1);
    expect(server.shoot(1)).toBe('no_target');
    expect(server.shots(1)).toBe(GUNS.rocket.shots);
  });
  it('explodes: racers near the impact are hit too, the shooter never', () => {
    const { server, shots, arm } = setup({
      kind: 'rocket',
      pos: [
        [1, [0, 0, 0]],
        [2, [0, 0, -20]], // target
        [3, [3, 0, -21]], // in the blast
        [4, [GUNS.rocket.blastM + 3, 0, -20]], // outside it
      ],
    });
    arm(1);
    expect(server.shoot(1)).toBe('ok');
    expect(shots()).toEqual([{ t: 'shot', by: 1, kind: 'rocket', targets: [2, 3] }]);
  });
});

describe('getting shot fills your gun meter', () => {
  it('a racer shot GUN_PUSHES times earns a gun', () => {
    const { server, published, arm, tick } = setup();
    arm(1);
    for (let i = 0; i < BUTTERFLY.GUN_PUSHES; i++) {
      tick(GUNS.blaster.cooldownMs);
      expect(server.shoot(1, 2)).toBe('ok');
    }
    expect(published).toContainEqual({ t: 'gun', id: 2, kind: 'blaster', shots: GUNS.blaster.shots });
    expect(server.shots(2)).toBe(GUNS.blaster.shots);
  });
});
