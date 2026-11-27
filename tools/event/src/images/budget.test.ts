import { describe, expect, test } from 'bun:test';
import { THEME_IMAGE_LIMITS } from '@wobble/shared';
import { budgetProblems, fitBudget, totalBytes } from './budget.ts';
import type { BudgetItem } from './budget.ts';
import { encodeImage, targetSize } from './process.ts';
import type { ImageKind } from './process.ts';
import { createRaw } from './raw.ts';

/** Noise does not compress, so its size reacts to quality. */
function noise(width: number, height: number) {
  const raw = createRaw(width, height);
  let seed = 12345;
  for (let i = 0; i < raw.data.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    raw.data[i] = i % 4 === 3 ? 255 : seed >>> 24;
  }
  return raw;
}

const item = async (id: string, priority: number, kind: ImageKind = 'texture', size = 64): Promise<BudgetItem> => ({
  id,
  kind,
  priority,
  image: await encodeImage(id, noise(size, size), false, Buffer.alloc(0)),
});

describe('image budget', () => {
  test('target sizes are the contract maxima', () => {
    expect(targetSize('skybox')).toEqual({ width: 4096, height: 2048 });
    expect(targetSize('texture')).toEqual({ width: 1024, height: 1024 });
    expect(targetSize('sprite')).toEqual({ width: 512, height: 512 });
    expect(targetSize('signage')).toEqual({ width: 1024, height: 512 });
    expect(targetSize('card')).toEqual({ width: 1024, height: 576 });
  });

  test('reports oversize images and too many bytes', async () => {
    const big = await item('big', 1, 'sprite', 600);
    const problems = budgetProblems([big], 1000);
    expect(problems[0]).toContain('600x600');
    expect(problems[1]).toContain('more than 1000');
    expect(budgetProblems([await item('ok', 1)], THEME_IMAGE_LIMITS.totalBytes)).toEqual([]);
  });

  test('leaves a set that fits alone', async () => {
    const items = [await item('a', 1), await item('b', 2)];
    const { kept, dropped } = await fitBudget(items);
    expect(dropped).toEqual([]);
    expect(totalBytes(kept)).toBe(totalBytes(items));
  });

  test('re-encodes at lower quality before dropping anything', async () => {
    const items = [await item('a', 1), await item('b', 2)];
    const limit = Math.floor(totalBytes(items) * 0.9);
    const { kept, dropped } = await fitBudget(items, limit);
    expect(dropped).toEqual([]);
    expect(totalBytes(kept)).toBeLessThanOrEqual(limit);
  });

  test('drops the least important images when quality is not enough', async () => {
    const items = [await item('vote-card', 0), await item('podium', 7), await item('sky', 1)];
    const smallest = await items[0].image.reencode(40);
    const limit = totalBytes([{ ...items[0], image: smallest }]) * 2 + 200;
    const { kept, dropped } = await fitBudget(items, limit);
    expect(dropped).toEqual(['podium']);
    expect(kept.map((k) => k.id)).toEqual(['vote-card', 'sky']);
    expect(totalBytes(kept)).toBeLessThanOrEqual(limit);
  });
});
