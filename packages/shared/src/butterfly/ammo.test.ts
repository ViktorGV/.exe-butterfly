import { expect, test } from 'bun:test';
import { BUTTERFLY } from '../constants.ts';
import { createButterfly } from './index.ts';

test('getting hit while armed keeps your gun and never lowers your ammo', () => {
  let next: 'blaster' | 'rocket' = 'blaster';
  const b = createButterfly({ rollGun: () => next });
  const out: Parameters<typeof b.push>[3] = [];
  for (let i = 0; i < BUTTERFLY.GUN_PUSHES; i++) b.push(2, 1, i, out);
  b.shoot(1, 2, []);
  const left = b.shots(1);
  next = 'rocket'; // the old code swapped in a 1-shot rocket here
  for (let i = 0; i < BUTTERFLY.GUN_PUSHES; i++) b.push(2, 1, i, out);
  expect(b.gunKind(1)).toBe('blaster');
  expect(b.shots(1)).toBeGreaterThanOrEqual(left);
});
