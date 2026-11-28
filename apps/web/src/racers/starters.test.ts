import { describe, expect, it } from 'bun:test';
import { STARTER_SKIN_IDS, pickStarterSkin } from '@wobble/shared/assets/index';
import { resolveBuiltin } from '@wobble/shared/builtins';
import { RACERS } from './index.ts';
import { racerForSkin } from './play.ts';

const racerIds = (skinIds: readonly string[]) => skinIds.map((id) => racerForSkin(resolveBuiltin(id)?.data).id);

describe('starting looks', () => {
  it('cover every racer, one starter skin each', () => {
    expect(racerIds(STARTER_SKIN_IDS).sort()).toEqual(RACERS.map((r) => r.id).sort());
  });

  it('gives newcomers different racers until all are taken, then stays even', () => {
    for (const random of [() => 0, () => 0.5, () => 0.999, Math.random]) {
      const worn: string[] = [];
      for (let i = 0; i < RACERS.length * 3; i++) {
        worn.push(pickStarterSkin(worn, random));
        if ((i + 1) % RACERS.length === 0) {
          expect(new Set(racerIds(worn.slice(-RACERS.length))).size).toBe(RACERS.length);
        }
      }
    }
  });

  it('can start a lone player as any racer, ignoring skins that are not starters', () => {
    const picks = STARTER_SKIN_IDS.map((_, i) =>
      pickStarterSkin(['b:cocoa-cub', ''], () => i / STARTER_SKIN_IDS.length),
    );
    expect(picks).toEqual([...STARTER_SKIN_IDS]);
  });
});
