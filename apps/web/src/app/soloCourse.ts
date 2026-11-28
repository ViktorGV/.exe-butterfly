// Solo practice plays a random one of the three built-in courses. The page builds its course once at load, so
// a different pick reloads the page on that course (`?course=<id>&solo=1`) and starts solo straight away.
// Online races always use the room's course, so leaving a random solo course reloads back to a clean URL.
import { FIRST_WOBBLE, GUMDROP_GAUNTLET, SPIN_CYCLE } from '@wobble/shared/course/recipes/index';

export const SOLO_COURSE_IDS: readonly string[] = [GUMDROP_GAUNTLET.id, FIRST_WOBBLE.id, SPIN_CYCLE.id];

/** A random solo course id. */
export function pickSoloCourse(random: () => number = Math.random): string {
  const i = Math.min(SOLO_COURSE_IDS.length - 1, Math.floor(random() * SOLO_COURSE_IDS.length));
  return SOLO_COURSE_IDS[i]!;
}

/** The URL that loads `courseId` and starts solo practice on it, keeping the other parameters. */
export function soloCourseUrl(href: string, courseId: string): string {
  const u = new URL(href);
  u.searchParams.set('course', courseId);
  u.searchParams.set('solo', '1');
  u.searchParams.delete('room');
  return u.toString();
}

/** The same page without the random solo course: back on the default course for the title and online play. */
export function clearSoloCourseUrl(href: string): string {
  const u = new URL(href);
  u.searchParams.delete('course');
  u.searchParams.delete('solo');
  return u.toString();
}
