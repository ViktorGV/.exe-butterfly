import { describe, expect, it } from 'bun:test';
import type { EntityDef } from '@wobble/shared';
import { clockFaceRadius } from './pieces.ts';

const sweeper = (id: number, x: number, z: number): EntityDef =>
  ({ id, kind: 'sweeper', pos: [x, 0, z], yaw: 0, params: { armLength: 7.5 } }) as unknown as EntityDef;

const faceRadius = clockFaceRadius;

describe('clock faces under sweepers', () => {
  it('keeps the full size when rows are far enough apart', () => {
    const all = [sweeper(1, 0, 0), sweeper(2, 0, -16)];
    expect(faceRadius(all[0]!, all)).toBeCloseTo(7.9, 5);
  });

  it('shrinks so neighbouring faces never overlap when rows are close', () => {
    const all = [sweeper(1, 0, 0), sweeper(2, 0, -12), sweeper(3, 16, 0)];
    for (const a of all) {
      for (const b of all) {
        if (a === b) continue;
        const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]);
        expect(faceRadius(a, all) + faceRadius(b, all)).toBeLessThanOrEqual(d);
      }
    }
  });
});
