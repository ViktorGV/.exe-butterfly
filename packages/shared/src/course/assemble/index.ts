// SEAM. Seeded by #2 with a stub; replaced by #15 (course assembler).
import { fixtureCourse } from '../../fixtures/index.ts';
import type { CourseDef, CourseRecipe } from '../../types.ts';

/**
 * Turn a recipe into a playable course. Deterministic for a given recipe.
 * STUB: ignores the recipe and returns a deep copy of the fixture course.
 */
export function assembleCourse(recipe: CourseRecipe): CourseDef {
  const course = structuredClone(fixtureCourse);
  if (recipe?.name) course.name = recipe.name;
  return course;
}
