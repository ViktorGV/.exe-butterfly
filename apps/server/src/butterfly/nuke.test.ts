import { describe, expect, it } from 'bun:test';
import { BUTTERFLY, NUKE } from '@wobble/shared/constants';
import type { ServerMessage, Vec3 } from '@wobble/shared/types';
import { createButterflyServer } from './index.ts';

function setup(finished: Set<number> = new Set()) {
  let t = 1_000;
  const published: ServerMessage[] = [];
  const setBack: number[] = [];
  const server = createButterflyServer({
    session: () => ({
      getPosition: (_id, out: Vec3) => {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        return true;
      },
      approveSave: () => {},
      setBackCheckpoint: (id) => (setBack.push(id), true),
    }),
    send: () => {},
    publish: (msg) => published.push(msg),
    now: () => t,
    isRacing: (id) => !finished.has(id),
    racers: () => [1, 2, 3, 4],
    gunAt: () => null,
  });
  const push = (by: number, target: number) => {
    t += BUTTERFLY.GRAB_COOLDOWN_MS;
    server.grab(by, { t: 'grab', target, kind: 'push', dir: [1, 0] });
  };
  const nukes = () => published.filter((m) => m.t === 'nuke');
  return { server, push, nukes, setBack };
}

describe('atom bomb', () => {
  it('drops once at NUKE.THRESHOLD and hits only racers who pushed or shot', () => {
    const finished = new Set([3]);
    const { server, push, nukes, setBack } = setup(finished);
    for (let i = 0; i < NUKE.THRESHOLD - 1; i++) push(i % 2 === 0 ? 1 : 3, 2);
    expect(nukes()).toHaveLength(0);
    expect(server.violence).toBe(NUKE.THRESHOLD - 1);
    push(1, 4);
    // 1 pushed and is racing; 3 pushed but finished; 2 and 4 never pushed anyone
    expect(nukes()).toEqual([{ t: 'nuke', targets: [1] }]);
    expect(setBack).toEqual([1]);
    for (let i = 0; i < 10; i++) push(4, 2);
    expect(nukes()).toHaveLength(1);
  });
});
