import { describe, expect, it } from 'bun:test';
import { SIM_HZ } from '@wobble/shared/constants';
import type { Collider, CourseDef, InputState, PartDef } from '@wobble/shared/types';
import { createPlayerController } from '../player/index.ts';
import { createAutopilot } from './autopilot.ts';

const box = (size: [number, number, number]): PartDef => ({
  shape: 'box',
  size,
  surface: 'solid',
  slot: 'platformA',
  collide: true,
  visible: true,
});
const at = (part: PartDef, x: number, y: number, z: number): Collider => ({
  entityId: 1,
  part,
  pose: { pos: [x, y, z], quat: [0, 0, 0, 1] },
  prevPose: { pos: [x, y, z], quat: [0, 0, 0, 1] },
});

/** Two floor pieces with a jumpable gap and a low wall, so the pilot searches lanes, jumps and waits. */
const near: Collider[] = [
  at(box([6, 0.5, 20]), 0, -0.25, -8),
  at(box([6, 0.5, 30]), 2, -0.25, -36),
  at(box([2, 1.2, 0.5]), 0, 0.6, -12),
];
/** The same course plus 400 boxes far away (another part of a long course). */
const far: Collider[] = [...near];
for (let i = 0; i < 400; i++) far.push(at(box([4, 1, 4]), (i % 20) * 8 - 80, 0, -200 - Math.floor(i / 20) * 8));

const course = {
  checkpoints: [{ volume: { pos: [0, 1, -20], yaw: 0, half: [6, 3, 1] }, respawn: { pos: [0, 0, -20], yaw: 0 } }],
  finish: { pos: [2, 1, -45], yaw: 0, half: [6, 3, 1] },
  killY: -10,
} as unknown as CourseDef;

function run(colliders: Collider[], steps: number, each?: (input: Readonly<InputState>) => void) {
  const pilot = createAutopilot(course);
  const ctl = createPlayerController({ getColliders: () => colliders, course, spawn: { pos: [0, 0.05, 0], yaw: 0 } });
  for (let i = 0; i < steps; i++) {
    const input = pilot.drive(ctl.state, colliders);
    each?.(input);
    ctl.step(input, 0, 1 / SIM_HZ, i / SIM_HZ);
  }
  return { pilot, ctl };
}

describe('autopilot broadphase (#179)', () => {
  it('drives exactly the same with far-away colliders in the list', () => {
    const a: string[] = [];
    const b: string[] = [];
    const key = (i: Readonly<InputState>) => `${i.moveX},${i.moveY},${i.jump},${i.jumpPressed}`;
    run(near, 600, (i) => a.push(key(i)));
    run(far, 600, (i) => b.push(key(i)));
    expect(new Set(a).size).toBeGreaterThan(3); // it really steered and jumped
    expect(b).toEqual(a);
  });

  it('allocates (almost) nothing per drive once warmed up', () => {
    const { pilot, ctl } = run(far, 30);
    Bun.gc(true);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 5000; i++) pilot.drive(ctl.state, far);
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(500_000);
  });
});
