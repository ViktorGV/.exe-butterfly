import { describe, expect, it } from 'bun:test';
import { BUTTERFLY } from '@wobble/shared/constants';
import type { ServerMessage, Vec3 } from '@wobble/shared/types';
import { createButterflyServer } from './index.ts';

function setup(opts: { racing?: (id: number) => boolean } = {}) {
  const pos = new Map<number, Vec3>([
    [1, [0, 0, 0]],
    [2, [1, 0, 0]],
    [3, [BUTTERFLY.GUN_RANGE_M * 2, 0, 0]],
  ]);
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
      approveSave: () => {},
    }),
    send: (id, msg) => sent.push([id, msg]),
    publish: (msg) => published.push(msg),
    now: () => t,
    isRacing: opts.racing,
  });
  const arm = (id: number) => {
    for (let i = 0; i < BUTTERFLY.GUN_PUSHES; i++) {
      t += BUTTERFLY.GRAB_COOLDOWN_MS;
      expect(server.grab(2, { t: 'grab', target: id, kind: 'push', dir: [-1, 0] })).toBe('ok');
    }
  };
  return { server, sent, published, arm, tick: (ms: number) => (t += ms) };
}

describe('gun on the server', () => {
  it('sends the gun to the pushed player at the 5th push', () => {
    const { server, sent, arm } = setup();
    arm(1);
    expect(sent).toContainEqual([1, { t: 'gun', shots: BUTTERFLY.GUN_SHOTS }]);
    expect(server.shots(1)).toBe(BUTTERFLY.GUN_SHOTS);
  });

  it('refuses without a gun, at yourself, and out of range', () => {
    const { server, arm } = setup();
    expect(server.shoot(1, 2)).toBe('no_gun');
    arm(1);
    expect(server.shoot(1, 1)).toBe('self');
    expect(server.shoot(1, 3)).toBe('out_of_range');
    expect(server.shots(1)).toBe(BUTTERFLY.GUN_SHOTS);
  });

  it('a shot spends one round, tells the shooter what is left and the room who was shot', () => {
    const { server, sent, published, arm } = setup();
    arm(1);
    expect(server.shoot(1, 2)).toBe('ok');
    expect(sent.at(-1)).toEqual([1, { t: 'gun', shots: BUTTERFLY.GUN_SHOTS - 1 }]);
    expect(published).toContainEqual({ t: 'shot', by: 1, target: 2 });
    expect(published).toContainEqual({ t: 'marked', id: 1, by: 2 });
    expect(server.isMarked(1)).toBe(true);
  });

  it('has a cooldown between shots', () => {
    const { server, arm, tick } = setup();
    arm(1);
    expect(server.shoot(1, 2)).toBe('ok');
    expect(server.shoot(1, 2)).toBe('cooldown');
    tick(BUTTERFLY.GUN_COOLDOWN_MS);
    expect(server.shoot(1, 2)).toBe('ok');
  });

  it('cannot shoot someone who is no longer racing', () => {
    const { server, arm } = setup({ racing: (id) => id !== 2 });
    arm(1);
    expect(server.shoot(1, 2)).toBe('unknown_player');
  });
});
