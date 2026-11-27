import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { VOTE } from '../constants.ts';
import type { ServerMessage } from '../types.ts';
import {
  fixtureManifest,
  fixtureRoster,
  fixtureSkinPack,
  fixtureTheme,
  fixtureThemeV2,
  fixtureThemeV2Pack,
} from '../fixtures/index.ts';
import {
  ClientMessageSchema,
  EventManifestSchema,
  EventRosterSchema,
  GenerateRequestSchema,
  ImageRefSchema,
  PackIdSchema,
  PackSchema,
  ServerMessageSchema,
  SkinDefSchema,
  ThemeDefSchema,
  ThemeDefV2Schema,
  CourseRecipeSchema,
} from './index.ts';

describe('ThemeDef v2 (#54)', () => {
  it('the v2 fixture parses unchanged', () => expect(ThemeDefV2Schema.parse(fixtureThemeV2)).toEqual(fixtureThemeV2));
  it('the theme union accepts v1 and v2', () => {
    expect(ThemeDefSchema.parse(fixtureTheme)).toEqual(fixtureTheme);
    expect(ThemeDefSchema.parse(fixtureThemeV2)).toEqual(fixtureThemeV2);
  });
  it('an e: theme pack parses', () => expect(PackSchema.parse(fixtureThemeV2Pack)).toEqual(fixtureThemeV2Pack));
  it('cast is optional (null)', () => {
    expect(ThemeDefV2Schema.safeParse({ ...fixtureThemeV2, cast: null }).success).toBe(true);
  });
  it('rejects image paths that are URLs or escape the folder', () => {
    for (const src of ['https://x.y/a.webp', '../a.webp', 'a.png', 'A.webp', 'dir/a.webp'])
      expect(ImageRefSchema.safeParse({ src, w: 1, h: 1, alpha: false, lowSrc: null }).success).toBe(false);
  });
  it('rejects more than 2 particle systems', () => {
    const p = fixtureThemeV2.particles[0]!;
    expect(ThemeDefV2Schema.safeParse({ ...fixtureThemeV2, particles: [p, p, p] }).success).toBe(false);
  });
});

describe('pack ids', () => {
  it.each(['b:fixture-skin', 'g:abc123', 'e:theme-candy', 'e:skin-candy-x9k2', 'r:candy:42'])('accepts %s', (id) =>
    expect(PackIdSchema.safeParse(id).success).toBe(true),
  );
  it.each(['x:foo', 'r:candy', 'r:candy:-1', 'e:', 'e:Theme', 'r:candy:12345678901'])('rejects %s', (id) =>
    expect(PackIdSchema.safeParse(id).success).toBe(false),
  );
  it('existing packs still parse', () => expect(PackSchema.parse(fixtureSkinPack)).toEqual(fixtureSkinPack));
});

describe('event manifest and roster', () => {
  it('fixtures parse', () => {
    expect(EventManifestSchema.parse(fixtureManifest)).toEqual(fixtureManifest);
    expect(EventRosterSchema.parse(fixtureRoster)).toEqual(fixtureRoster);
  });
  it('the manifest needs exactly VOTE.options themes', () => {
    expect(EventManifestSchema.safeParse({ ...fixtureManifest, themes: fixtureManifest.themes.slice(1) }).success).toBe(
      false,
    );
  });
  it('roster keys must be 32 hex chars', () => {
    const bad = { ...fixtureRoster, entries: { pip: { characterPrompt: null, skins: {} } } };
    expect(EventRosterSchema.safeParse(bad).success).toBe(false);
  });
});

describe('vote protocol', () => {
  const options = fixtureManifest.themes.map((t) => t.id);
  it('client messages', () => {
    expect(ClientMessageSchema.parse({ t: 'startVote' })).toEqual({ t: 'startVote' });
    expect(ClientMessageSchema.parse({ t: 'vote', themeId: options[0] })).toEqual({ t: 'vote', themeId: options[0] });
  });
  it('server messages', () => {
    const tallies: number[] = Array(VOTE.options).fill(0);
    const msgs: ServerMessage[] = [
      { t: 'voteState', options, tallies, endsAt: 123 },
      { t: 'voteResult', themeId: options[2]!, tallies },
    ];
    for (const msg of msgs) expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });
  it('welcome carries the event identity', () => {
    const room = {
      id: 'r1',
      code: 'ABCDE',
      phase: 'voting' as const,
      hostId: 1,
      config: { courseId: 'b:fixture-course', themeId: options[0]! },
      players: [],
    };
    const msg: ServerMessage = {
      t: 'welcome',
      playerId: 1,
      token: 'tok',
      room,
      event: { matched: true, previewSkins: { [options[0]!]: 'e:skin-x' } },
    };
    expect(ServerMessageSchema.parse(msg)).toEqual(msg);
  });
});

describe('generate request is skins only', () => {
  const base = { kind: 'skin', prompt: 'a pink princess', clientId: 'client-12345' };
  it('accepts a skin with an optional theme', () => {
    expect(GenerateRequestSchema.safeParse(base).success).toBe(true);
    expect(GenerateRequestSchema.safeParse({ ...base, themeId: 'e:theme-candy' }).success).toBe(true);
  });
  it('rejects themes and courses', () => {
    expect(GenerateRequestSchema.safeParse({ ...base, kind: 'theme' }).success).toBe(false);
    expect(GenerateRequestSchema.safeParse({ ...base, kind: 'course' }).success).toBe(false);
  });
});

describe('LLM-facing schemas export to JSON Schema without $ref cycles', () => {
  const hasRef = (n: unknown): boolean =>
    !!n && typeof n === 'object' && ('$ref' in n || Object.values(n).some(hasRef));
  it.each([
    ['theme v2', ThemeDefV2Schema],
    ['skin', SkinDefSchema],
    ['course recipe', CourseRecipeSchema],
  ])('%s', (_name, schema) => {
    const js = z.toJSONSchema(schema, { io: 'output' });
    expect(hasRef(js)).toBe(false);
  });
});
