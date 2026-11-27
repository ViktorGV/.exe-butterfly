import { describe, expect, it } from 'bun:test';
import type { PartDef, Pose, Vec3 } from '@wobble/shared/types';
import {
  capsuleSpheres,
  createContact,
  gatherNearby,
  rotate,
  rotateInverse,
  setYawRoll,
  sphereVsPart,
  surfaceVelocity,
  yawDelta,
} from './index.ts';

const part = (shape: PartDef['shape'], size: Vec3): PartDef => ({
  shape,
  size,
  surface: 'solid',
  slot: 'platformA',
  collide: true,
  visible: true,
});
const at = (x: number, y: number, z: number, yaw = 0, roll = 0): Pose => {
  const pose: Pose = { pos: [x, y, z], quat: [0, 0, 0, 1] };
  setYawRoll(yaw, roll, pose.quat);
  return pose;
};

describe('quaternion helpers', () => {
  it('rotate and rotateInverse round-trip', () => {
    const q = at(0, 0, 0, 0.7, 0.3).quat;
    const v: Vec3 = [0, 0, 0];
    rotate(q, 1, 2, 3, v);
    rotateInverse(q, v[0], v[1], v[2], v);
    expect(v[0]).toBeCloseTo(1, 9);
    expect(v[1]).toBeCloseTo(2, 9);
    expect(v[2]).toBeCloseTo(3, 9);
  });

  it('positive yaw turns -Z toward -X (counter-clockwise from above)', () => {
    const v = rotate(at(0, 0, 0, Math.PI / 2).quat, 0, 0, -1, [0, 0, 0]);
    expect(v[0]).toBeCloseTo(-1, 9);
    expect(v[2]).toBeCloseTo(0, 9);
  });

  it('yawDelta extracts the rotation about Y', () => {
    expect(yawDelta(at(0, 0, 0, 0.2).quat, at(0, 0, 0, 0.5).quat)).toBeCloseTo(0.3, 9);
  });
});

describe('sphere vs part', () => {
  const c = createContact();

  it('box: resting on top gives an upward normal', () => {
    expect(sphereVsPart(0, 0.4, 0, 0.45, part('box', [2, 0.5, 2]), at(0, -0.5, 0), c)).toBe(true);
    expect(c.normal[1]).toBeCloseTo(1, 9);
    expect(c.depth).toBeCloseTo(0.05, 9);
  });

  it('box: no contact when apart, deep penetration exits through the nearest face', () => {
    expect(sphereVsPart(0, 1, 0, 0.45, part('box', [2, 0.5, 2]), at(0, -0.5, 0), c)).toBe(false);
    expect(sphereVsPart(1.9, -0.5, 0, 0.45, part('box', [2, 0.5, 2]), at(0, -0.5, 0), c)).toBe(true);
    expect(c.normal[0]).toBeCloseTo(1, 9);
    expect(c.depth).toBeCloseTo(0.55, 9);
  });

  it('box respects rotation', () => {
    // A 4 x 1 x 1 bar turned 90 degrees now spans Z, not X.
    const bar = part('box', [2, 0.5, 0.5]);
    expect(sphereVsPart(1.5, 0, 0, 0.3, bar, at(0, 0, 0, Math.PI / 2), c)).toBe(false);
    expect(sphereVsPart(0, 0, 1.5, 0.3, bar, at(0, 0, 0, Math.PI / 2), c)).toBe(true);
  });

  it('cylinder: side, cap and inside', () => {
    const cyl = part('cylinder', [1, 0.5, 0]);
    expect(sphereVsPart(1.3, 0, 0, 0.45, cyl, at(0, 0, 0), c)).toBe(true);
    expect(c.normal[0]).toBeCloseTo(1, 9);
    expect(c.depth).toBeCloseTo(0.15, 9);
    expect(sphereVsPart(0.2, 0.8, 0, 0.45, cyl, at(0, 0, 0), c)).toBe(true);
    expect(c.normal[1]).toBeCloseTo(1, 9);
    expect(sphereVsPart(0, 0.4, 0, 0.45, cyl, at(0, 0, 0), c)).toBe(true);
    expect(c.normal[1]).toBeCloseTo(1, 9);
  });

  it('sphere: normal points away from the centre', () => {
    expect(sphereVsPart(0, 0, -1.2, 0.45, part('sphere', [1, 0, 0]), at(0, 0, 0), c)).toBe(true);
    expect(c.normal[2]).toBeCloseTo(-1, 9);
    expect(c.depth).toBeCloseTo(0.25, 9);
  });
});

describe('world queries', () => {
  it('capsule spheres cover the capsule with overlap', () => {
    const h = capsuleSpheres({ radius: 0.45, height: 1.3 });
    expect(h[0]).toBeCloseTo(0.45, 9);
    expect(h[h.length - 1]).toBeCloseTo(0.85, 9);
    for (let i = 1; i < h.length; i++) expect(h[i] - h[i - 1]).toBeLessThanOrEqual(0.225 + 1e-9);
  });

  it('broadphase keeps only nearby colliders', () => {
    const near = { entityId: 1, part: part('box', [1, 1, 1]), pose: at(2, 0, 0), prevPose: at(2, 0, 0) };
    const far = { entityId: 2, part: part('box', [1, 1, 1]), pose: at(50, 0, 0), prevPose: at(50, 0, 0) };
    const hidden = { ...near, entityId: 3, part: { ...near.part, collide: false } };
    const out = gatherNearby([near, far, hidden], [0, 0, 0], { radius: 0.45, height: 1.3 }, 0.5, []);
    expect(out.map((c) => c.entityId)).toEqual([1]);
  });

  it('surface velocity of a spinning disc is tangential', () => {
    const disc = {
      entityId: 1,
      part: part('cylinder', [4, 0.25, 0]),
      prevPose: at(0, 0, 0, 0),
      pose: at(0, 0, 0, 0.1),
    };
    const v = surfaceVelocity(disc, 2, 0, 0, 0.1, [0, 0, 0]);
    // 1 rad/s at r = 2 -> 2 m/s, moving toward -Z for a counter-clockwise turn
    expect(Math.hypot(v[0], v[2])).toBeCloseTo(2, 1);
    expect(v[2]).toBeLessThan(0);
  });
});
