import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { assembleCourse, resolveBuiltin } from '@wobble/shared';
import { DEFAULT_COURSE_ID } from '@wobble/shared/course/recipes/index';
import type { CourseRecipe } from '@wobble/shared/types';
import { createThemeSupports, supportBlocks } from './supports.ts';

const course = assembleCourse(resolveBuiltin(DEFAULT_COURSE_ID)!.data as CourseRecipe);
const groundY = course.killY - 4;

describe('themed supports (desk-map structure for event themes)', () => {
  it('stacks blocks from the ground up to under each floor, the same every time', () => {
    const blocks = supportBlocks(course, groundY);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.y >= groundY - 1e-6 && b.h > 0)).toBe(true);
    expect(supportBlocks(course, groundY)).toEqual(blocks);
  });

  it('draws them with the theme slot materials', () => {
    const rail = new THREE.MeshStandardMaterial();
    const accent = new THREE.MeshStandardMaterial();
    const s = createThemeSupports({ course, groundY, getMaterial: (slot) => (slot === 'rail' ? rail : accent) });
    const [body, trim] = s.group.children as THREE.InstancedMesh[];
    expect(body.material).toBe(rail);
    expect(trim.material).toBe(accent);
    expect(body.count).toBe(supportBlocks(course, groundY).length);
    s.dispose();
  });
});
