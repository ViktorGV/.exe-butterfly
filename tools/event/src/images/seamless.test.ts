import { describe, expect, test } from 'bun:test';
import { decode, encodeWebp, halve } from './raw.ts';
import type { Raw } from './raw.ts';
import { createRaw } from './raw.ts';
import { processImage } from './process.ts';
import { isSeamless, makeSeamless, seamScore, seamScoreAxis } from './seamless.ts';
import { fixSkybox } from './skybox.ts';

function draw(width: number, height: number, color: (x: number, y: number) => number): Raw {
  const raw = createRaw(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(color(x, y))));
      raw.data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return raw;
}

/** Ramps in both directions: the worst case, with a hard step wherever it wraps. */
const ramp = () => draw(128, 128, (x, y) => x + y);
/** Periodic over the image size, so it already tiles. */
const waves = () =>
  draw(128, 128, (x, y) => 128 + 60 * Math.sin((x / 128) * 4 * Math.PI) + 60 * Math.sin((y / 128) * 2 * Math.PI));

describe('seam metric', () => {
  test('is high for edges that do not match and about 1 for a periodic pattern', () => {
    expect(seamScore(ramp()).ratio).toBeGreaterThan(20);
    expect(seamScore(waves()).ratio).toBeLessThan(1.6);
    expect(isSeamless(ramp())).toBe(false);
    expect(isSeamless(waves())).toBe(true);
  });

  test('measures each direction on its own', () => {
    const horizontalRamp = draw(64, 64, (x) => x * 4);
    expect(seamScoreAxis(horizontalRamp, 'x').seam).toBeGreaterThan(200);
    expect(seamScoreAxis(horizontalRamp, 'y').seam).toBe(0);
  });
});

describe('makeSeamless', () => {
  test('removes the seam in both directions', () => {
    const fixed = makeSeamless(ramp());
    expect(isSeamless(fixed)).toBe(true);
    expect(seamScore(fixed).seam).toBeLessThan(6);
  });

  test('leaves an image that already tiles untouched', () => {
    const image = waves();
    expect(makeSeamless(image).data.equals(image.data)).toBe(true);
  });

  test('keeps the middle of the image as it was', () => {
    const image = ramp();
    const centre = (64 * 128 + 64) * 4;
    expect(makeSeamless(image).data[centre]).toBe(image.data[centre]);
  });

  test('stays seamless after the half-size variant and WebP', async () => {
    const fixed = makeSeamless(ramp());
    expect(isSeamless(halve(fixed))).toBe(true);
    expect(isSeamless(await decode(await encodeWebp(fixed, { quality: 80, alpha: false })))).toBe(true);
  });

  test('a processed texture tiles and has a half-size variant', async () => {
    const source = await encodeWebp(ramp(), { quality: 100, alpha: false });
    const result = await processImage(source, {
      base: 'tex',
      kind: 'texture',
      palette: [],
      chroma: 'magenta',
      scale: 1 / 8,
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.image.ref).toEqual({ src: 'tex.webp', w: 128, h: 128, alpha: false, lowSrc: 'tex@0.5x.webp' });
    for (const file of result.image.files) expect(isSeamless(await decode(file.bytes))).toBe(true);
  });
});

describe('fixSkybox', () => {
  test('joins the left and right edges and collapses each pole to one colour', () => {
    const sky = fixSkybox(draw(256, 128, (x, y) => x + (y % 7) * 5));
    expect(seamScoreAxis(sky, 'x').seam).toBeLessThan(8);
    for (const y of [0, 127]) {
      const row = new Set(Array.from({ length: 256 }, (_, x) => sky.data[(y * 256 + x) * 4]));
      expect(row.size).toBe(1);
    }
  });
});
