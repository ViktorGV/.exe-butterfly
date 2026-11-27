// SEAM. Seeded by #2 with a stub; replaced by #15 (playability linter).
import type { CourseDef, LintResult } from '../types.ts';

/**
 * Check that a course is playable for a 300-player crowd.
 * STUB: always passes.
 */
export function lintCourse(_def: CourseDef): LintResult {
  return { ok: true, errors: [], warnings: [] };
}
