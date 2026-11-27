import { describe, expect, it } from 'bun:test';
import { fixtureManifest, fixtureRoster } from '@wobble/shared';
import { DEFAULT_SKIN_ID, createEventDirector } from './index.ts';

describe('event director seam (stub until #68)', () => {
  const director = createEventDirector({ manifest: fixtureManifest, roster: fixtureRoster, secret: 'test' });

  it('is off and matches nobody', async () => {
    expect(director.enabled).toBe(false);
    expect(await director.identify('pip')).toEqual({ matched: false, previewSkins: null });
  });

  it('offers the manifest themes as vote options', () => {
    expect(director.voteOptions()).toEqual(fixtureManifest.themes.map((t) => t.id));
  });

  it('gives everyone the default skin', async () => {
    const skins = await director.assignSkins(
      [
        { id: 1, name: 'a', matched: false },
        { id: 2, name: 'b', matched: false },
      ],
      fixtureManifest.themes[0]!.id,
    );
    expect([...skins.values()]).toEqual([DEFAULT_SKIN_ID, DEFAULT_SKIN_ID]);
  });

  it('has no vote options without a manifest', () => {
    expect(createEventDirector({ manifest: null, roster: null }).voteOptions()).toEqual([]);
  });
});
