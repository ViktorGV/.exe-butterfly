import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { alphaCoverage, cutout, pickChroma, trim } from './chroma.ts';
import { hexToRgb, shiftToPalette, averageColor, distance } from './color.ts';
import { processImage } from './process.ts';
import { createRaw, decode } from './raw.ts';

/** A 200 x 200 picture: `background` with one shape on it. */
const picture = (background: string, shape: string) =>
  sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">` +
        `<rect width="200" height="200" fill="${background}"/>${shape}</svg>`,
    ),
  )
    .png()
    .toBuffer();

const disc = '<circle cx="100" cy="100" r="50" fill="#f5c542"/>';

describe('chroma key', () => {
  for (const [key, hex] of [
    ['magenta', '#ff00ff'],
    ['green', '#00ff00'],
  ] as const) {
    test(`keys out ${key}, trims to the subject and leaves no fringe`, async () => {
      const result = cutout(await decode(await picture(hex, disc)), key);
      if (!result.ok) throw new Error(result.reason);
      const { image } = result;
      expect(image.width).toBeGreaterThanOrEqual(99);
      expect(image.width).toBeLessThanOrEqual(102);
      expect(image.data[3]).toBe(0); // corner of the trimmed box is outside the disc
      const centre = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
      expect([...image.data.subarray(centre, centre + 4)]).toEqual([245, 197, 66, 255]);
      for (let i = 0; i < image.data.length; i += 4) {
        const [r, g, b, a] = image.data.subarray(i, i + 4);
        if (a === 0) continue;
        if (key === 'magenta') expect(Math.min(r, b) - g).toBeLessThanOrEqual(40);
        else expect(g - Math.max(r, b)).toBeLessThanOrEqual(0);
      }
    });
  }

  test('accepts a background that is only close to the key', async () => {
    const result = cutout(await decode(await picture('#e81ee0', disc)), 'magenta');
    expect(result.ok).toBe(true);
  });

  test('fails on a background that is not the key', async () => {
    const result = cutout(await decode(await picture('#336699', disc)), 'magenta');
    expect(result).toEqual({ ok: false, reason: 'the background is not flat magenta' });
  });

  test('fails when the subject is missing', async () => {
    const result = cutout(await decode(await picture('#ff00ff', '')), 'magenta');
    expect(result.ok).toBe(false);
  });

  test('coverage and trim handle an empty image', () => {
    const empty = createRaw(10, 10);
    expect(alphaCoverage(empty)).toBe(0);
    expect(trim(empty)).toBeNull();
  });

  test('picks the key farthest from the theme colours', () => {
    expect(pickChroma([hexToRgb('#f020f0')])).toBe('green');
    expect(pickChroma([hexToRgb('#20e040')])).toBe('magenta');
  });

  test('a processed sprite has alpha and fits the sprite budget', async () => {
    const result = await processImage(await picture('#ff00ff', disc), {
      base: 'sprite-1',
      kind: 'sprite',
      palette: [],
      chroma: 'magenta',
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.image.ref.alpha).toBe(true);
    expect(result.image.ref.w).toBeLessThanOrEqual(512);
    const decoded = await decode(result.image.files[0].bytes);
    expect(decoded.data[3]).toBe(0);
  });
});

describe('palette shift', () => {
  const solid = (hex: string) => {
    const raw = createRaw(8, 8);
    for (let i = 0; i < raw.data.length; i += 4) raw.data.set([...hexToRgb(hex), 255], i);
    return raw;
  };

  test('moves a far-off image towards the palette', () => {
    const target = hexToRgb('#2060e0');
    const before = solid('#e0a020');
    const after = shiftToPalette(before, [target]);
    expect(distance(averageColor(after), target)).toBeLessThan(distance(averageColor(before), target));
  });

  test('leaves an image near the palette untouched', () => {
    const image = solid('#2864d8');
    expect(shiftToPalette(image, [hexToRgb('#2060e0')])).toBe(image);
  });
});
