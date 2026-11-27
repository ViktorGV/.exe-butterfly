import { describe, expect, it } from 'bun:test';
import type { ClientMessage, ServerMessage } from '../types.ts';
import {
  ClientMessageSchema,
  CourseDefSchema,
  CourseRecipeSchema,
  GenerateRequestSchema,
  PackSchema,
  ServerMessageSchema,
  SkinDefSchema,
  ThemeDefSchema,
} from './index.ts';
import {
  fixtureCourse,
  fixtureCoursePack,
  fixtureRecipe,
  fixtureSkin,
  fixtureSkinPack,
  fixtureTheme,
  fixtureThemePack,
} from '../fixtures/index.ts';

describe('fixtures satisfy the schemas', () => {
  it.each([
    ['skin', SkinDefSchema, fixtureSkin],
    ['theme', ThemeDefSchema, fixtureTheme],
    ['recipe', CourseRecipeSchema, fixtureRecipe],
    ['course', CourseDefSchema, fixtureCourse],
  ])('%s', (_name, schema, data) => {
    expect(schema.parse(data)).toEqual(data);
  });

  it('packs', () => {
    for (const pack of [fixtureSkinPack, fixtureThemePack, fixtureCoursePack])
      expect(PackSchema.parse(pack)).toEqual(pack);
  });
});

describe('pack schemas reject bad data', () => {
  it('rejects a bad colour', () => {
    expect(SkinDefSchema.safeParse({ ...fixtureSkin, limbs: { color: 'red' } }).success).toBe(false);
  });
  it('rejects too many accessory prims', () => {
    const prim = fixtureSkin.accessories[0].prims[0];
    const accessories = [0, 1, 2].map(() => ({ anchor: 'back', prims: Array(9).fill(prim) }));
    expect(SkinDefSchema.safeParse({ ...fixtureSkin, accessories }).success).toBe(false);
  });
  it('rejects a recipe with too few segments', () => {
    expect(
      CourseRecipeSchema.safeParse({ ...fixtureRecipe, segments: fixtureRecipe.segments.slice(0, 3) }).success,
    ).toBe(false);
  });
  it('rejects a pack whose data does not match its kind', () => {
    expect(PackSchema.safeParse({ ...fixtureSkinPack, data: fixtureTheme }).success).toBe(false);
  });
});

describe('control messages', () => {
  it('parses every client message', () => {
    const msgs: ClientMessage[] = [
      { t: 'hello', v: 1, name: 'Pip', clientId: 'client-12345', room: 'quick' },
      { t: 'hello', v: 1, name: 'Pip', clientId: 'client-12345', token: 'abc', room: 'ABCDE' },
      { t: 'setSkin', skinId: 'g:abc123' },
      { t: 'setReady', ready: true },
      { t: 'setConfig', courseId: 'b:fixture-course', themeId: 'b:fixture-theme' },
      { t: 'start' },
      { t: 'loaded' },
      { t: 'ping', c: 123.4 },
    ];
    for (const m of msgs) expect(ClientMessageSchema.parse(m)).toEqual(m);
  });

  it('rejects unknown types, bad room codes and long names', () => {
    expect(ClientMessageSchema.safeParse({ t: 'teleport' }).success).toBe(false);
    expect(
      ClientMessageSchema.safeParse({ t: 'hello', v: 1, name: 'Pip', clientId: 'client-1234', room: 'abc' }).success,
    ).toBe(false);
    expect(
      ClientMessageSchema.safeParse({ t: 'hello', v: 1, name: 'x'.repeat(17), clientId: 'client-1234', room: 'quick' })
        .success,
    ).toBe(false);
  });

  it('strips unexpected fields', () => {
    expect(ClientMessageSchema.parse({ t: 'start', evil: true })).toEqual({ t: 'start' });
  });

  it('parses every server message', () => {
    const player = { id: 1, name: 'Pip', skinId: 'b:fixture-skin', ready: false, connected: true };
    const room: Extract<ServerMessage, { t: 'welcome' }>['room'] = {
      id: 'r1',
      code: 'ABCDE',
      phase: 'lobby',
      hostId: 1,
      config: { courseId: 'b:fixture-course', themeId: 'b:fixture-theme' },
      players: [player],
    };
    const msgs: ServerMessage[] = [
      { t: 'welcome', playerId: 1, token: 'tok', room },
      { t: 'roomPatch', joined: [player], left: [2], updated: [{ id: 1, ready: true }], phase: 'loading' },
      {
        t: 'matchConfig',
        courseId: 'b:fixture-course',
        themeId: 'b:fixture-theme',
        qualifyCount: 1,
        players: [{ id: 1, slot: 0, skinId: 'b:fixture-skin', name: 'Pip' }],
      },
      { t: 'countdown', startAt: 1000 },
      { t: 'pong', c: 1, s: 2 },
      { t: 'checkpoint', index: 0 },
      { t: 'correct', pos: [0, 0, 0], checkpoint: -1 },
      { t: 'finished', id: 1, place: 1, timeMs: 12345 },
      { t: 'raceEnd', results: [{ id: 1, place: 1, timeMs: null, checkpoint: 0 }] },
      { t: 'error', code: 'full', msg: 'Room is full' },
    ];
    for (const m of msgs) expect(ServerMessageSchema.parse(m)).toEqual(m);
  });
});

describe('API schemas', () => {
  it('validates generate requests', () => {
    expect(
      GenerateRequestSchema.parse({ kind: 'skin', prompt: '  a sleepy astronaut ', clientId: 'client-1234' }).prompt,
    ).toBe('a sleepy astronaut');
    expect(
      GenerateRequestSchema.safeParse({ kind: 'skin', prompt: 'x'.repeat(201), clientId: 'client-1234' }).success,
    ).toBe(false);
    expect(GenerateRequestSchema.safeParse({ kind: 'music', prompt: 'hello', clientId: 'client-1234' }).success).toBe(
      false,
    );
  });
});
