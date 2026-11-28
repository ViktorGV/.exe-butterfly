import { expect, test } from 'bun:test';
import { GUNS } from '../constants.ts';
import { createButterfly } from './index.ts';

test('getting hit replaces your gun but keeps the shots you had left', () => {
  const b = createButterfly({ gunAt: (n) => (n === 1 ? 'blaster' : n === 2 ? 'rocket' : null) });
  b.push(2, 1, 0, []);
  b.shoot(1, 2, []);
  const left = b.shots(1);
  expect(left).toBe(GUNS.blaster.shots - 1);
  b.push(2, 1, 1, []);
  expect(b.gunKind(1)).toBe('rocket');
  expect(b.shots(1)).toBe(left + GUNS.rocket.shots);
});
