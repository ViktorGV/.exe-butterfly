import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { assembleCourse, resolveBuiltin } from '@wobble/shared';
import { DEFAULT_COURSE_ID } from '@wobble/shared/course/recipes/index';
import type { CourseRecipe, EntityDef } from '@wobble/shared/types';
import { BRIDGE_HALF_WIDTH, bridgeSpan, createHeroBridge } from './index.ts';

const fan = (id: number, z: number, width: number, y = 2): EntityDef => ({
  id,
  kind: 'snowBlower',
  pos: [-30, y, z],
  yaw: 0,
  params: { reach: 60, width, windSpeed: 5 },
});

describe('bridgeSpan', () => {
  it('covers the whole stretch of the snow-blower field', () => {
    const span = bridgeSpan({ entities: [fan(1, -100, 10), fan(2, -110, 10), fan(3, -120, 10)] });
    expect(span).toEqual({ z0: -95, z1: -125, y: 2 });
  });

  it('is null for a course without fans: the hero has nothing to shelter you from', () => {
    expect(bridgeSpan({ entities: [] })).toBeNull();
    expect(bridgeSpan({ entities: undefined as unknown as EntityDef[] })).toBeNull();
  });

  it('uses the default fan depth when none is given', () => {
    const e: EntityDef = { id: 1, kind: 'snowBlower', pos: [0, 0, -10], yaw: 0, params: {} };
    expect(bridgeSpan({ entities: [e] })).toEqual({ z0: -7, z1: -13, y: 0 });
  });

  it('finds the field on the default course, at its far end after the other obstacles', () => {
    const course = assembleCourse(resolveBuiltin(DEFAULT_COURSE_ID)!.data as CourseRecipe);
    const span = bridgeSpan(course)!;
    expect(span).not.toBeNull();
    expect(span.z0).toBeGreaterThan(span.z1); // runs toward -Z
    expect(span.z0 - span.z1).toBeGreaterThan(10);
    // it sits near the end of the course: before the finish, after every checkpoint but the last
    expect(span.z1).toBeGreaterThan(course.finish.pos[2]);
    expect(span.z0).toBeLessThan(course.checkpoints[0]!.volume.pos[2]);
  });
});

describe('hero bridge view', () => {
  it('is hidden until opened, unrolls over the field, and hides again when closed', () => {
    const scene = new THREE.Scene();
    const bridge = createHeroBridge({ scene });
    const group = scene.children[0]!;
    expect(bridge.isOpen).toBe(false);
    expect(group.visible).toBe(false);

    bridge.open({ z0: -100, z1: -130, y: 2 }, 1000);
    expect(bridge.isOpen).toBe(true);
    expect(group.visible).toBe(true);
    expect(group.position.z).toBe(-100); // starts at the near end of the field
    expect(group.position.y).toBeGreaterThan(2); // just above the floor

    bridge.update(1000 + 350);
    expect(bridge.unrolled).toBeGreaterThan(0.3);
    expect(bridge.unrolled).toBeLessThan(1);
    expect(group.scale.z).toBeLessThan(30);

    bridge.update(1000 + 2000);
    expect(bridge.unrolled).toBe(1);
    expect(group.scale.z).toBeCloseTo(30, 6); // covers the whole 30 m field

    bridge.close();
    expect(bridge.isOpen).toBe(false);
    expect(group.visible).toBe(false);
    bridge.dispose();
  });

  it('is as wide as the lane that shelters the player from the wind', () => {
    const scene = new THREE.Scene();
    const bridge = createHeroBridge({ scene });
    bridge.open({ z0: 0, z1: -10, y: 0 }, 0);
    bridge.update(5000);
    const box = new THREE.Box3().setFromObject(scene);
    expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(BRIDGE_HALF_WIDTH * 2);
    expect(box.max.x - box.min.x).toBeLessThan(BRIDGE_HALF_WIDTH * 2 + 0.5);
    bridge.dispose();
  });

  it('update does nothing while closed', () => {
    const scene = new THREE.Scene();
    const bridge = createHeroBridge({ scene });
    bridge.update(123);
    expect(bridge.unrolled).toBe(0);
    bridge.dispose();
  });
});
