import { describe, expect, it } from 'bun:test';
import { resolveColumns } from './columns.ts';
import { parseCsv } from './csv.ts';
import { intakeCsv, parseYesNo, SubmissionsFileSchema } from './intake.ts';

const HEADER = 'username,game_prompt,character_prompt,credit_ok';

describe('parseCsv', () => {
  it('handles quotes, commas, newlines, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""","line1\nline2"\r\n\r\nz,\n')).toEqual([
      ['a', 'b'],
      ['x, "y"', 'line1\nline2'],
      ['z', ''],
    ]);
  });
});

describe('parseCsv errors', () => {
  it('rejects an unclosed quote instead of merging rows', () => {
    expect(() => parseCsv('a,b\n"x,y\nz,w\n')).toThrow('unclosed quote');
  });
});

describe('resolveColumns', () => {
  it('matches form headers by alias and prefix', () => {
    const cols = resolveColumns([
      'Timestamp',
      'Your username',
      'Describe your game (max 500 characters)',
      'Describe your character!',
      'May we credit you?',
    ]);
    expect(cols).toEqual({
      submitted_at: 'Timestamp',
      username: 'Your username',
      game_prompt: 'Describe your game (max 500 characters)',
      character_prompt: 'Describe your character!',
      credit_ok: 'May we credit you?',
    });
  });
  it('lets a config name any header', () => {
    const cols = resolveColumns(['Wie ben je?', 'Spel', 'Figuur'], {
      username: 'Wie ben je?',
      game_prompt: 'Spel',
      character_prompt: 'Figuur',
    });
    expect(cols.game_prompt).toBe('Spel');
  });
  it('fails loudly on a missing or misspelt column', () => {
    expect(() => resolveColumns(['username', 'game_prompt'])).toThrow('character_prompt');
    expect(() => resolveColumns(['username'], { username: 'nope' })).toThrow('nope');
  });
});

describe('intakeCsv', () => {
  it('keeps the latest row per normalised username and lists the others', () => {
    const file = intakeCsv(`${HEADER}\nPip,old,c,yes\nbo,two,c,\n  @PIP ,new,c,no\n`);
    expect(file.submissions.map((s) => [s.usernameKey, s.gamePrompt, s.creditOk])).toEqual([
      ['bo', 'two', null],
      ['pip', 'new', false],
    ]);
    expect(file.dropped).toEqual([
      { row: 1, username: 'Pip', status: 'duplicate', reason: 'duplicate username "pip": kept the later row 3' },
    ]);
    expect(SubmissionsFileSchema.parse(file)).toEqual(file);
  });
  it('uses the submission time when every copy has one', () => {
    const file = intakeCsv(
      `${HEADER},submitted_at\npip,newest,c,,2026-11-02T10:00:00Z\npip,older,c,,2026-11-01T10:00:00Z\n`,
    );
    expect(file.submissions[0].gamePrompt).toBe('newest');
  });
  it('treats names that differ only after 16 characters as one player, as the server will', () => {
    const file = intakeCsv(`${HEADER}\nabcdefghijklmnopQ,a,c,\nabcdefghijklmnopZ,b,c,\n`);
    expect(file.submissions).toHaveLength(1);
    expect(Array.from(file.submissions[0].usernameKey)).toHaveLength(16);
  });
  it('cuts long prompts, strips invisible characters and drops empty rows', () => {
    const file = intakeCsv(
      `${HEADER}\na,${'x'.repeat(600)},${'y'.repeat(400)},yes\nb,he\u200bllo\u202e,,\n,g,c,\nc,,,\n`,
    );
    expect(file.submissions[0].gamePrompt).toHaveLength(500);
    expect(file.submissions[0].characterPrompt).toHaveLength(300);
    expect(file.submissions[0].flags).toEqual(['gamePromptTruncated', 'characterPromptTruncated']);
    expect(file.submissions[1].gamePrompt).toBe('hello');
    expect(file.dropped.map((d) => d.status)).toEqual(['invalid', 'invalid']);
  });
  it('reads yes/no answers', () => {
    expect([parseYesNo('Yes'), parseYesNo(' n '), parseYesNo(''), parseYesNo('maybe')]).toEqual([
      true,
      false,
      null,
      null,
    ]);
  });
});
