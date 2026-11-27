// Default course resolver for rooms: `b:` ids from the built-ins, `g:` ids from the pack API.
// Any failure falls back to the default course so a match always starts.
import { assembleCourse, fixtureCourse, lintCourse, resolveBuiltin, sanitizePack } from '@wobble/shared';
import type { CourseDef, CourseRecipe } from '@wobble/shared/types';

export type ResolveCourse = (courseId: string) => Promise<CourseDef>;

export const DEFAULT_COURSE_ID = 'b:fixture-course';
const CACHE_MAX = 32;

export function createCourseResolver({
  packsBaseUrl = process.env.PACKS_BASE_URL ?? '',
  fetchImpl = fetch,
  timeoutMs = 5000,
}: { packsBaseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): ResolveCourse {
  const cache = new Map<string, CourseDef>(); // insertion order = LRU order

  const fallback = (): CourseDef => {
    const pack = resolveBuiltin(DEFAULT_COURSE_ID);
    return pack?.kind === 'course' ? assembleCourse(pack.data) : structuredClone(fixtureCourse);
  };

  const build = (data: unknown): CourseDef | null => {
    const clean = sanitizePack('course', data);
    if (!clean.ok) return null;
    const course = assembleCourse(clean.data as CourseRecipe);
    return lintCourse(course).ok ? course : null;
  };

  async function load(id: string): Promise<CourseDef | null> {
    if (id.startsWith('b:')) {
      const pack = resolveBuiltin(id);
      return pack?.kind === 'course' ? build(pack.data) : null;
    }
    if (!id.startsWith('g:') || !packsBaseUrl) return null;
    const res = await fetchImpl(`${packsBaseUrl.replace(/\/$/, '')}/api/packs/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const pack = (await res.json()) as { kind?: unknown; data?: unknown };
    return pack?.kind === 'course' ? build(pack.data) : null;
  }

  return async (courseId) => {
    const hit = cache.get(courseId);
    if (hit) {
      cache.delete(courseId);
      cache.set(courseId, hit);
      return hit;
    }
    let course: CourseDef | null;
    try {
      course = await load(courseId);
    } catch {
      course = null;
    }
    if (!course) return fallback(); // failures are not cached so a later retry can succeed
    cache.set(courseId, course);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return course;
  };
}
