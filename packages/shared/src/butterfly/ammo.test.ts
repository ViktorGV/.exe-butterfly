import { expect, test } from 'bun:test';
import { GUN_LADDER } from '../constants.ts';
import { createButterfly } from './index.ts';

test('getting hit while armed keeps your gun and never lowers your ammo until the next ladder step', () => {
  const b = createButterfly();
  const out: Parameters<typeof b.push>[3] = [];
  const first = GUN_LADDER[0]!;
  const second = GUN_LADDER[1]!;
  for (let i = 0; i < first.hits; i++) b.push(2, 1, i * 10_000, out);
  expect(b.gunKind(1)).toBe(first.kind);
  b.shoot(1, 2, []);
  const left = b.shots(1);
  // hits between ladder steps leave the gun and its ammo alone
  for (let i = first.hits; i < second.hits - 1; i++) b.push(2, 1, i * 10_000, out);
  expect(b.gunKind(1)).toBe(first.kind);
  expect(b.shots(1)).toBe(left);
});
