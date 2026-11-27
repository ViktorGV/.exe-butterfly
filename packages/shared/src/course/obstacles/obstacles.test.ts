import { describe, expect, it } from 'bun:test';
import { getObstacleKind, listObstacleKinds } from './index.ts';
import type { EntityDef, ObstacleKind, Pose } from '../../types.ts';

const platformKind = getObstacleKind('platform') as ObstacleKind;
import { fixtureCourse } from '../../fixtures/index.ts';

describe('obstacle registry', () => {
  it('has platform and returns null for unknown kinds', () => {
    expect(listObstacleKinds()).toContain('platform');
    expect(getObstacleKind('does-not-exist')).toBeNull();
  });

  it('every fixture entity has a known kind', () => {
    for (const e of fixtureCourse.entities) expect(getObstacleKind(e.kind)).not.toBeNull();
  });

  it('platform parts and pose follow the top-surface convention', () => {
    const def: EntityDef = {
      id: 1,
      kind: 'platform',
      pos: [2, 3, -10],
      yaw: Math.PI / 2,
      params: { size: [8, 1, 4], slot: 'platformB' },
    };
    const kind = platformKind;
    const [part] = kind.parts(def);
    expect(part).toMatchObject({ shape: 'box', size: [4, 0.5, 2], slot: 'platformB', collide: true, surface: 'solid' });
    const out: Pose[] = [{ pos: [0, 0, 0], quat: [0, 0, 0, 1] }];
    kind.pose(def, 5, out);
    expect(out[0].pos).toEqual([2, 2.5, -10]);
    expect(out[0].quat[1]).toBeCloseTo(Math.SQRT1_2);
    expect(out[0].quat[3]).toBeCloseTo(Math.SQRT1_2);
  });

  it('platform params get defaults and clamps', () => {
    const kind = platformKind;
    const [part] = kind.parts({
      id: 1,
      kind: 'platform',
      pos: [0, 0, 0],
      yaw: 0,
      params: { size: [999, 1, 0.01], slot: 'nope' },
    });
    expect(part.size).toEqual([30, 0.5, 0.25]);
    expect(part.slot).toBe('platformA');
  });
});
