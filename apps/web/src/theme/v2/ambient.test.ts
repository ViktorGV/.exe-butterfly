import { describe, expect, it } from 'bun:test';
import { assembleCourse, fixtureThemeV2, resolveBuiltin } from '@wobble/shared';
import { DEFAULT_COURSE_ID } from '@wobble/shared/course/recipes/index';
import type { CourseRecipe } from '@wobble/shared/types';
import { createThemeAmbient } from './ambient.ts';

const course = assembleCourse(resolveBuiltin(DEFAULT_COURSE_ID)!.data as CourseRecipe);

describe('theme ambient life on the desk map', () => {
  it('builds squadrons, a capital ship, bolts, drones, searchlights and a pulsing conduit, and animates them', () => {
    const a = createThemeAmbient({ theme: fixtureThemeV2, course, groundY: course.killY - 2 });
    expect(a.group.children.length).toBeGreaterThanOrEqual(8);
    expect(() => {
      for (let t = 0; t < 30; t += 0.5) a.update(t);
    }).not.toThrow();
    a.dispose();
  });
});
