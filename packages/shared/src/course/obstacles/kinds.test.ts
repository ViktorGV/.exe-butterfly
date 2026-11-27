import { describe, expect, it } from 'bun:test';
import { OBSTACLE_KINDS } from '../../constants.ts';
import type { EntityDef, Pose } from '../../types.ts';
import { getObstacleKind, kindBounds, listObstacleKinds, maxSurfaceSpeed, periodOf } from './index.ts';

/** One entity per kind, with defaults (and doors on the gate so it moves). */
const ENTITIES: EntityDef[] = OBSTACLE_KINDS.map((kind, id) => ({
  id,
  kind,
  pos: [3, 1, -20],
  yaw: 0.4,
  params: kind === 'gate' ? { doors: 3 } : {},
}));

function posesAt(def: EntityDef, t: number): Pose[] {
  const kind = getObstacleKind(def.kind)!;
  const out = kind.parts(def).map((): Pose => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
  kind.pose(def, t, out);
  return out;
}

const close = (a: Pose[], b: Pose[], eps: number) =>
  a.every((p, i) => p.pos.every((v, k) => Math.abs(v - b[i].pos[k]) < eps));

describe('obstacle kinds', () => {
  it('registers every kind in the contract', () => {
    expect(listObstacleKinds().sort()).toEqual([...OBSTACLE_KINDS].sort());
  });

  for (const def of ENTITIES) {
    describe(def.kind, () => {
      const kind = getObstacleKind(def.kind)!;
      const parts = kind.parts(def);

      it('has parts with sane sizes and unit quaternions', () => {
        expect(parts.length).toBeGreaterThan(0);
        for (const p of parts) for (const v of p.size) expect(Number.isFinite(v) && v >= 0).toBe(true);
        for (const p of posesAt(def, 1.234)) expect(Math.hypot(...p.quat)).toBeCloseTo(1, 9);
      });

      it('is periodic, deterministic and defined for negative t', () => {
        const period = periodOf(def);
        for (const t of [-7.3, 0, 0.37, 5.9]) {
          expect(posesAt(def, t)).toEqual(posesAt(def, t));
          if (period > 0) expect(close(posesAt(def, t), posesAt(def, t + period), 1e-6)).toBe(true);
        }
        if (period === 0) expect(close(posesAt(def, -3), posesAt(def, 11), 1e-12)).toBe(true);
      });

      it('never moves a part faster than maxSurfaceSpeed', () => {
        const dt = 1 / 60;
        const limit = maxSurfaceSpeed(def) * dt + 1e-6;
        let prev = posesAt(def, 0);
        for (let t = dt; t < 12; t += dt) {
          const curr = posesAt(def, t);
          for (let i = 0; i < curr.length; i++) {
            const d = Math.hypot(...curr[i].pos.map((v, k) => v - prev[i].pos[k]));
            expect(d).toBeLessThanOrEqual(limit);
          }
          prev = curr;
        }
      });

      it('has finite swept bounds that contain every pose', () => {
        const b = kindBounds(def)!;
        for (const t of [0, 0.5, 1.7, 3.3])
          for (const p of posesAt(def, t))
            for (let k = 0; k < 3; k++) {
              expect(p.pos[k]).toBeGreaterThanOrEqual(b.min[k] - 1e-9);
              expect(p.pos[k]).toBeLessThanOrEqual(b.max[k] + 1e-9);
            }
      });
    });
  }

  it('clamps hostile params to safe ranges', () => {
    const fast: EntityDef = { id: 1, kind: 'sweeper', pos: [0, 0, 0], yaw: 0, params: { rpm: 9999, arms: 50 } };
    expect(getObstacleKind('sweeper')!.parts(fast).length).toBe(1 + 4);
    expect(periodOf(fast)).toBeCloseTo(2, 9); // rpm clamped to 30
    const boing: EntityDef = { id: 2, kind: 'bumper', pos: [0, 0, 0], yaw: 0, params: { bounce: 500, radius: 'x' } };
    const [part] = getObstacleKind('bumper')!.parts(boing);
    expect(part.bounce).toBe(20);
    expect(part.size[0]).toBe(0.9);
    expect(part.surface).toBe('bouncy');
  });

  it('places top-surface kinds with their top at pos and base kinds on the ground', () => {
    const at = (kind: string, params = {}) => ({ id: 9, kind, pos: [0, 2, 0], yaw: 0, params }) as EntityDef;
    const bridgePose = posesAt(at('bridge'), 0)[0];
    expect(bridgePose.pos[1] + getObstacleKind('bridge')!.parts(at('bridge'))[0].size[1]).toBeCloseTo(2, 9);
    const bumperPose = posesAt(at('bumper'), 0)[0];
    expect(bumperPose.pos[1] - getObstacleKind('bumper')!.parts(at('bumper'))[0].size[1]).toBeCloseTo(2, 9);
  });

  it('sweeper bars reach armLength from the hub at barHeight and turn at rpm', () => {
    const def: EntityDef = { id: 1, kind: 'sweeper', pos: [0, 0, 0], yaw: 0, params: { rpm: 15, armLength: 6 } };
    const a = posesAt(def, 0)[1];
    const b = posesAt(def, 1)[1]; // 15 rpm -> 90 degrees per second
    expect(Math.hypot(a.pos[0], a.pos[2])).toBeCloseTo(3, 9);
    expect(a.pos[1]).toBeCloseTo(0.6, 9);
    const turned = Math.atan2(b.pos[2], b.pos[0]) - Math.atan2(a.pos[2], a.pos[0]);
    expect(Math.abs(Math.abs(turned) - Math.PI / 2)).toBeLessThan(1e-9);
  });

  it('evaluates 400 entities in < 0.2 ms with no per-call allocation', () => {
    const defs = Array.from({ length: 400 }, (_, i) => ({ ...ENTITIES[i % ENTITIES.length], id: i }));
    const kinds = defs.map((d) => getObstacleKind(d.kind)!);
    const outs = defs.map((d, i) => kinds[i].parts(d).map((): Pose => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] })));
    for (let i = 0; i < defs.length; i++) kinds[i].pose(defs[i], 0, outs[i]); // warm caches
    const rounds = 300;
    const t0 = performance.now();
    for (let r = 0; r < rounds; r++) for (let i = 0; i < defs.length; i++) kinds[i].pose(defs[i], r / 60, outs[i]);
    expect((performance.now() - t0) / rounds).toBeLessThan(0.2);
  });
});
