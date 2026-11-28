import { describe, expect, it } from 'bun:test';
import { assembleCourse, fixtureThemeV2, resolveBuiltin } from '@wobble/shared';
import { DEFAULT_COURSE_ID } from '@wobble/shared/course/recipes/index';
import type { CourseRecipe } from '@wobble/shared/types';
import type * as THREE from 'three';
import { createThemeProps } from './props.ts';

const course = assembleCourse(resolveBuiltin(DEFAULT_COURSE_ID)!.data as CourseRecipe);

describe('themed set dressing on the desk map', () => {
  it('places the theme landmarks down both sides, outside the course', () => {
    const props = createThemeProps({ theme: fixtureThemeV2, course, groundY: course.killY - 2 });
    const meshes = props.group.children as THREE.InstancedMesh[];
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.reduce((n, m) => n + m.count, 0)).toBeGreaterThan(4);
    props.dispose();
  });
});
