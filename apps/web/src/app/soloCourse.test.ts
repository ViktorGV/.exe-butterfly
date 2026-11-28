import { describe, expect, test } from 'bun:test';
import { resolveBuiltin } from '@wobble/shared';
import { clearSoloCourseUrl, pickSoloCourse, SOLO_COURSE_IDS, soloCourseUrl } from './soloCourse.ts';

describe('solo course', () => {
  test('the three built-in courses, all resolvable', () => {
    expect(SOLO_COURSE_IDS).toEqual(['b:gumdrop-gauntlet', 'b:first-wobble', 'b:spin-cycle']);
    for (const id of SOLO_COURSE_IDS) expect(resolveBuiltin(id)?.kind).toBe('course');
  });

  test('every course can be picked, and the pick stays in range', () => {
    expect(pickSoloCourse(() => 0)).toBe('b:gumdrop-gauntlet');
    expect(pickSoloCourse(() => 0.5)).toBe('b:first-wobble');
    expect(pickSoloCourse(() => 0.99)).toBe('b:spin-cycle');
    expect(pickSoloCourse(() => 1)).toBe('b:spin-cycle');
  });

  test('urls keep other parameters', () => {
    const solo = new URL(soloCourseUrl('https://x.test/?theme=t:a&room=ABCDE', 'b:spin-cycle'));
    expect(solo.searchParams.get('course')).toBe('b:spin-cycle');
    expect(solo.searchParams.get('solo')).toBe('1');
    expect(solo.searchParams.get('theme')).toBe('t:a');
    expect(solo.searchParams.has('room')).toBe(false);
    const back = new URL(clearSoloCourseUrl(solo.toString()));
    expect(back.searchParams.has('course')).toBe(false);
    expect(back.searchParams.has('solo')).toBe(false);
    expect(back.searchParams.get('theme')).toBe('t:a');
  });
});
