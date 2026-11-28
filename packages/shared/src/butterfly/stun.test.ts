import { expect, test } from 'bun:test';
import { GUNS } from '../constants.ts';

test('blaster stuns 2 s, shotgun 4 s, rocket 4 s then back to the checkpoint', () => {
  expect(GUNS.blaster).toMatchObject({ stunMs: 2000, respawn: false });
  expect(GUNS.shotgun).toMatchObject({ stunMs: 4000, respawn: false });
  expect(GUNS.rocket).toMatchObject({ stunMs: 4000, respawn: true });
});
