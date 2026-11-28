import { describe, expect, it } from 'bun:test';
import { ordinal, STRINGS, t } from './strings.ts';

describe('strings', () => {
  it('has a non-empty value for every key', () => {
    for (const [key, value] of Object.entries(STRINGS)) {
      expect(typeof value, key).toBe('string');
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('carries the required screen labels', () => {
    expect(STRINGS.quickPlay).toBe('Quick play');
    expect(STRINGS.finishQualified).toBe('Qualified!');
    expect(STRINGS.finishFinished).toBe('Finished');
    expect(STRINGS.finishTimeUp).toBe("Time's up");
    expect(STRINGS.nameLabelEvent).toBe('Your username');
  });

  it('t() fills placeholders and leaves unknown ones alone', () => {
    expect(t('personalBest', { time: '01:02.03' })).toBe('Personal best 01:02.03');
    expect(t('resultsYouPlaced', { place: '3rd' })).toBe('You placed 3rd');
    expect(t('resultsYouPlaced')).toBe('You placed {place}');
    expect(t('resultsYouPlaced', { other: 1 })).toBe('You placed {place}');
    expect(t('quickPlay', { x: 1 })).toBe('Quick play');
  });

  it('ordinal() handles the teens and 1/2/3 endings', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112, 300].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
      '112th',
      '300th',
    ]);
  });
});
