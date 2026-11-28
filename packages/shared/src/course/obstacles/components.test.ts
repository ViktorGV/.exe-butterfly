// More course components: the carousel (four pads on a rotating cross) and the arrow tile.
import { describe, expect, it } from 'bun:test';
import type { EntityDef, Pose, Quat, Vec3 } from '../../types.ts';
import { getObstacleKind, maxSurfaceSpeed, periodOf } from './index.ts';

const entity = (kind: string, params: Record<string, unknown> = {}, pos: Vec3 = [0, 0, 0], yaw = 0): EntityDef => ({
  id: 1,
  kind,
  pos,
  yaw,
  params,
});

function posesAt(def: EntityDef, t: number): Pose[] {
  const kind = getObstacleKind(def.kind)!;
  const out = kind.parts(def).map((): Pose => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
  kind.pose(def, t, out);
  return out;
}

/** Angle of a pad around the axis: 0 along +X, positive toward -Z. */
const angleOf = (p: Pose, axis: Vec3) => Math.atan2(-(p.pos[2] - axis[2]), p.pos[0] - axis[0]);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** World direction of the local +X axis, from a quaternion. */
const xAxis = ([x, y, z, w]: Quat): Vec3 => [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)];

describe('carousel', () => {
  const axis: Vec3 = [3, 1, -40];
  const def = entity('carousel', { radius: 4.2, pad: 3.4, rpm: 6 }, axis);
  const kind = getObstacleKind('carousel')!;
  const parts = kind.parts(def);

  it('has four separate pads, all solid and walkable', () => {
    expect(parts).toHaveLength(4);
    for (const p of parts) {
      expect(p.collide).toBe(true);
      expect(p.surface).toBe('solid');
      expect(p.size[0]).toBeCloseTo(1.7, 9); // half of the 3.4 m side
      expect(p.size[2]).toBeCloseTo(1.7, 9);
    }
  });

  it('keeps every pad on a circle of `radius` around the axis, a quarter turn apart', () => {
    for (const t of [0, 0.37, 1.9, 7.3]) {
      const poses = posesAt(def, t);
      const angles = poses.map((p) => angleOf(p, axis));
      for (const p of poses) expect(Math.hypot(p.pos[0] - axis[0], p.pos[2] - axis[2])).toBeCloseTo(4.2, 9);
      for (let i = 0; i < 4; i++) expect(wrap(angles[(i + 1) % 4]! - angles[i]!)).toBeCloseTo(Math.PI / 2, 9);
    }
  });

  it('turns as one rigid cross: each pad turns with the cross, so its top stays level at the axis height', () => {
    const a = posesAt(def, 0);
    const b = posesAt(def, 1.1);
    const turn = wrap(angleOf(b[0]!, axis) - angleOf(a[0]!, axis));
    expect(Math.abs(turn)).toBeGreaterThan(0.1);
    for (let i = 0; i < 4; i++) {
      // a pad's own heading turns by the same angle as its position
      const ha = Math.atan2(-xAxis(a[i]!.quat)[2], xAxis(a[i]!.quat)[0]);
      const hb = Math.atan2(-xAxis(b[i]!.quat)[2], xAxis(b[i]!.quat)[0]);
      expect(wrap(hb - ha)).toBeCloseTo(turn, 6);
      expect(b[i]!.pos[1] + parts[i]!.size[1]).toBeCloseTo(axis[1], 9); // top surface at pos.y
    }
  });

  it('turns at rpm, and the other way with dir -1', () => {
    const quarter = 60 / 6 / 4; // seconds for a quarter turn at 6 rpm
    const fwd = wrap(angleOf(posesAt(def, quarter)[0]!, axis) - angleOf(posesAt(def, 0)[0]!, axis));
    expect(Math.abs(fwd)).toBeCloseTo(Math.PI / 2, 6);
    const rev = entity('carousel', { radius: 4.2, pad: 3.4, rpm: 6, dir: -1 }, axis);
    const back = wrap(angleOf(posesAt(rev, quarter)[0]!, axis) - angleOf(posesAt(rev, 0)[0]!, axis));
    expect(back).toBeCloseTo(-fwd, 6);
  });

  it('repeats every 60 / rpm seconds, and its fastest point is the far corner of a pad', () => {
    expect(periodOf(def)).toBeCloseTo(10, 9);
    const w = (6 * Math.PI * 2) / 60;
    expect(maxSurfaceSpeed(def)).toBeCloseTo(w * (4.2 + 3.4 * Math.SQRT1_2), 9);
  });

  it('clamps nonsense parameters instead of breaking', () => {
    const bad = entity('carousel', { radius: -5, pad: 1e9, rpm: NaN, dir: 'x' });
    const ps = getObstacleKind('carousel')!.parts(bad);
    expect(ps).toHaveLength(4);
    for (const p of posesAt(bad, 3)) expect(p.pos.every(Number.isFinite)).toBe(true);
  });
});

describe('arrowTile', () => {
  const kind = getObstacleKind('arrowTile')!;
  const forward = entity('arrowTile', { dir: 1 }, [4, 2, -30]);
  const backward = entity('arrowTile', { dir: -1 }, [4, 2, -30]);

  it('is a thin plate you can stand on plus four arrow arms that do not collide', () => {
    const parts = kind.parts(forward);
    expect(parts).toHaveLength(5);
    expect(parts[0]!.collide).toBe(true);
    expect(parts.slice(1).every((p) => !p.collide && p.visible)).toBe(true);
  });

  it('puts its top surface at pos.y, and the arms just above it', () => {
    const parts = kind.parts(forward);
    const poses = posesAt(forward, 0);
    expect(poses[0]!.pos[1] + parts[0]!.size[1]).toBeCloseTo(2, 9);
    for (let i = 1; i < 5; i++) expect(poses[i]!.pos[1]).toBeGreaterThan(2);
  });

  it('is green for forward and red for back, so the direction reads at a glance', () => {
    expect(kind.parts(forward)[0]!.slot).toBe('accent');
    expect(kind.parts(backward)[0]!.slot).toBe('hazard');
  });

  it('is static', () => {
    expect(periodOf(forward)).toBe(0);
    expect(maxSurfaceSpeed(forward)).toBe(0);
    expect(posesAt(forward, 0)).toEqual(posesAt(forward, 123.4));
  });

  it('draws two chevrons pointing toward the finish (-Z) for forward and back (+Z) for backward', () => {
    // each chevron is two arms leaning back from a tip: the arms of a chevron lie on the far side of its tip
    const armsZ = (def: EntityDef) =>
      posesAt(def, 0)
        .slice(1)
        .map((p) => p.pos[2] - def.pos[2]);
    const f = armsZ(forward);
    const b = armsZ(backward);
    // mirrored along z
    for (let i = 0; i < 4; i++) expect(b[i]!).toBeCloseTo(-f[i]!, 9);
    // the two arms of one chevron are at the same z, on opposite sides in x
    const fp = posesAt(forward, 0);
    expect(fp[1]!.pos[2]).toBeCloseTo(fp[2]!.pos[2], 9);
    expect(fp[1]!.pos[0] - forward.pos[0]).toBeCloseTo(-(fp[2]!.pos[0] - forward.pos[0]), 9);
  });

  it('turns with the entity: yaw swings the arrows round with it', () => {
    const turned = entity('arrowTile', { dir: 1 }, [4, 2, -30], Math.PI);
    const a = posesAt(forward, 0).slice(1);
    const b = posesAt(turned, 0).slice(1);
    for (let i = 0; i < 4; i++) {
      expect(b[i]!.pos[0] - 4).toBeCloseTo(-(a[i]!.pos[0] - 4), 9);
      expect(b[i]!.pos[2] + 30).toBeCloseTo(-(a[i]!.pos[2] + 30), 9);
    }
  });

  it('clamps nonsense parameters', () => {
    const bad = entity('arrowTile', { size: [1e9, -1, NaN], dir: 0, boost: 'fast' });
    expect(kind.parts(bad)).toHaveLength(5);
    for (const p of posesAt(bad, 1)) expect(p.pos.every(Number.isFinite)).toBe(true);
  });
});
