// Event course obstacles (#110): bouncePad, slidingWall, snowBlower and its wind zones.
import { describe, expect, it } from 'bun:test';
import type { EntityDef, Pose, Quat, Vec3 } from '../../types.ts';
import { getObstacleKind } from './index.ts';
import { compileWindZones, inWindZone, windAt, windPhase, WIND_OFF, WIND_ON, WIND_WARN } from './wind.ts';

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

/** World direction of the part's local +Y. */
function upAxis([x, y, z, w]: Quat): Vec3 {
  return [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)];
}

describe('bouncePad', () => {
  it('is a bouncy pad part that does not stumble', () => {
    const [part] = getObstacleKind('bouncePad')!.parts(entity('bouncePad', { bounce: 15 }));
    expect(part).toMatchObject({ shape: 'box', surface: 'bouncy', bounce: 15, pad: true, slot: 'bouncy' });
  });

  it('has its top surface centre at pos', () => {
    for (const tilt of [0, 0.3]) {
      const def = entity('bouncePad', { size: [3, 0.4, 2], tilt }, [1, 2, -5]);
      const [pose] = posesAt(def, 0);
      const up = upAxis(pose.quat);
      // Centre + half height along the up axis lands on pos.
      for (let k = 0; k < 3; k++) expect(pose.pos[k] + up[k] * 0.2).toBeCloseTo(def.pos[k], 9);
    }
  });

  it('a flat pad faces straight up; tilt tips its face forward (-Z)', () => {
    expect(upAxis(posesAt(entity('bouncePad', { tilt: 0 }), 0)[0].quat)).toEqual([0, 1, 0]);
    const up = upAxis(posesAt(entity('bouncePad', { tilt: 0.2 }), 0)[0].quat);
    expect(up[1]).toBeCloseTo(Math.cos(0.2), 9);
    expect(up[2]).toBeCloseTo(-Math.sin(0.2), 9);
    expect(up[0]).toBeCloseTo(0, 9);
  });
});

describe('slidingWall', () => {
  const def = entity('slidingWall', { width: 15, panels: 3, periodSec: 4 }, [2, 1, -30], 0);
  const kind = getObstacleKind('slidingWall')!;
  const parts = kind.parts(def);

  it('has two pillars and the requested panels', () => {
    expect(parts.length).toBe(2 + 3);
  });

  it('panels move only sideways', () => {
    const a = posesAt(def, 0);
    for (const t of [0.7, 1.9, 3.1]) {
      const b = posesAt(def, t);
      for (let i = 2; i < parts.length; i++) {
        expect(b[i].pos[1]).toBeCloseTo(a[i].pos[1], 9);
        expect(b[i].pos[2]).toBeCloseTo(a[i].pos[2], 9);
      }
    }
    expect(posesAt(def, 2)[2].pos[0]).not.toBeCloseTo(a[2].pos[0], 3);
  });

  it('always leaves a gap of at least 1.5 m between the pillars, and panels never overlap', () => {
    for (const panels of [1, 2, 3, 5]) {
      for (const width of [6, 15, 30]) {
        const d = entity('slidingWall', { width, panels, periodSec: 3, phase: 0.2 });
        const ps = getObstacleKind('slidingWall')!.parts(d);
        for (let t = -3; t < 6; t += 0.05) {
          const poses = posesAt(d, t);
          const spans = poses
            .slice(2)
            .map((p, i) => [p.pos[0] - ps[i + 2].size[0], p.pos[0] + ps[i + 2].size[0]])
            .sort((x, y) => x[0] - y[0]);
          let edge = -width / 2;
          let widest = 0;
          for (const [lo, hi] of spans) {
            expect(lo).toBeGreaterThanOrEqual(edge - 1e-9);
            widest = Math.max(widest, lo - edge);
            edge = hi;
          }
          widest = Math.max(widest, width / 2 - edge);
          expect(widest).toBeGreaterThanOrEqual(1.5);
        }
      }
    }
  });

  it('is a pure function of race time (same on every screen)', () => {
    const copy = structuredClone(def);
    expect(posesAt(copy, 12.345)).toEqual(posesAt(def, 12.345));
  });
});

describe('snowBlower', () => {
  const def = entity('snowBlower', { onSec: 3, offSec: 2, warnSec: 0.5 });

  it('runs on for 3 s, off for 2 s, and warns in the last 0.5 s before the push', () => {
    const at = (t: number) => windPhase(def, t);
    expect([at(0), at(1.5), at(2.99)]).toEqual([WIND_ON, WIND_ON, WIND_ON]);
    expect([at(3), at(4.49)]).toEqual([WIND_OFF, WIND_OFF]);
    expect([at(4.5), at(4.99)]).toEqual([WIND_WARN, WIND_WARN]);
    expect([at(5), at(-0.2), at(-1.5), at(-2.5), at(-5)]).toEqual([WIND_ON, WIND_WARN, WIND_OFF, WIND_ON, WIND_ON]);
  });

  it('phase shifts the cycle in seconds', () => {
    const later = entity('snowBlower', { phase: 2.5 });
    expect(windPhase(later, 0)).toBe(WIND_ON); // 2.5 s into the cycle
    expect(windPhase(later, 0.5)).toBe(WIND_OFF);
  });

  it('keeps its housing still; the rotor spins only while on and never collides', () => {
    const parts = getObstacleKind('snowBlower')!.parts(def);
    expect(parts[0].collide).toBe(true);
    expect(parts[1].collide).toBe(false);
    expect(posesAt(def, 0.2)[0]).toEqual(posesAt(def, 4)[0]);
    expect(posesAt(def, 0.2)[1].quat).not.toEqual(posesAt(def, 0.3)[1].quat);
    expect(posesAt(def, 3.5)[1].quat).toEqual(posesAt(def, 4.5)[1].quat);
  });
});

describe('wind zones', () => {
  const left = { ...entity('snowBlower', { reach: 20, width: 6, windSpeed: 3 }, [-10, 0, -50], 0), id: 7 };
  const right = {
    ...entity('snowBlower', { reach: 20, width: 6, windSpeed: 4, phase: 2.5 }, [10, 0, -60], Math.PI),
    id: 8,
  };
  const zones = compileWindZones([entity('platform'), left, right]);
  const out: Vec3 = [0, 0, 0];

  it('compiles only snow blowers', () => {
    expect(zones.map((z) => z.entityId)).toEqual([7, 8]);
  });

  it('blows away from the fan, across its reach and depth', () => {
    expect(inWindZone(zones[0], -9, 0, -50)).toBe(true);
    expect(inWindZone(zones[0], 9.5, 1, -52.9)).toBe(true);
    expect(inWindZone(zones[0], -10.5, 0, -50)).toBe(false); // behind the fan
    expect(inWindZone(zones[0], 0, 0, -53.5)).toBe(false); // past the zone's depth
    expect(inWindZone(zones[0], 0, 6, -50)).toBe(false); // high above it
    expect(inWindZone(zones[1], 9, 0, -60)).toBe(true); // turned round: blows toward -X
    expect(inWindZone(zones[1], 10.5, 0, -60)).toBe(false);
  });

  it('pushes sideways only while on', () => {
    expect(windAt(zones, [0, 0, -50], 1, out)).toBe(1);
    expect(out[0]).toBeCloseTo(3, 9);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeCloseTo(0, 9);
    expect(windAt(zones, [0, 0, -50], 4, out)).toBe(0);
    expect(out).toEqual([0, 0, 0]);
    // The right fan is shifted 2.5 s and blows toward -X.
    expect(windAt(zones, [0, 0, -60], 0, out)).toBe(1);
    expect(out[0]).toBeCloseTo(-4, 9);
    expect(windAt(zones, [0, 0, -40], 1, out)).toBe(0);
  });
});
