// Turn one generated image into the files and ImageRef a theme ships, per slot kind (#59).
import { THEME_IMAGE_LIMITS } from '@wobble/shared';
import type { ImageRef } from '@wobble/shared';
import type { ChromaName } from './chroma.ts';
import { cutout } from './chroma.ts';
import { shiftToPalette } from './color.ts';
import type { Raw, Rgb, Size } from './raw.ts';
import { decode, encodeWebp, fitInside, halve, previewJpeg, tile2x2 } from './raw.ts';
import { isSeamless, makeSeamless } from './seamless.ts';
import { fixSkybox } from './skybox.ts';

export type ImageKind = keyof Omit<typeof THEME_IMAGE_LIMITS, 'totalBytes'>;

export const WEBP_QUALITY = 80;

export interface ImageFile {
  name: string;
  bytes: Buffer;
}

export interface ProcessedImage {
  ref: ImageRef;
  /** Full size first, then the @0.5x variant. */
  files: ImageFile[];
  /** What the vision model looks at (textures are shown tiled 2 x 2). */
  preview: Buffer;
  /** Encode again at another quality, to fit the theme's byte budget. */
  reencode(quality: number): Promise<ProcessedImage>;
}

export interface ProcessOptions {
  /** File name without extension, e.g. "sky" or "sprite-1". */
  base: string;
  kind: ImageKind;
  palette: Rgb[];
  /** Background colour a sprite was generated on. */
  chroma: ChromaName;
  /** Output size multiplier; tests use a small one. */
  scale?: number;
}

export type ProcessResult = { ok: true; image: ProcessedImage } | { ok: false; reason: string };

export function targetSize(kind: ImageKind, scale = 1): Size {
  const [w, h] = THEME_IMAGE_LIMITS[kind];
  return { width: Math.max(8, Math.round(w * scale)), height: Math.max(8, Math.round(h * scale)) };
}

/** Encode `raw` and its half-size variant. */
export async function encodeImage(
  base: string,
  raw: Raw,
  alpha: boolean,
  preview: Buffer,
  quality = WEBP_QUALITY,
): Promise<ProcessedImage> {
  const full = `${base}.webp`;
  const low = `${base}@0.5x.webp`;
  const [fullBytes, lowBytes] = await Promise.all([
    encodeWebp(raw, { quality, alpha }),
    encodeWebp(halve(raw), { quality, alpha }),
  ]);
  return {
    ref: { src: full, w: raw.width, h: raw.height, alpha, lowSrc: low },
    files: [
      { name: full, bytes: fullBytes },
      { name: low, bytes: lowBytes },
    ],
    preview,
    reencode: (q) => encodeImage(base, raw, alpha, preview, q),
  };
}

/** Post-process one image. `ok: false` is a mechanical QA failure: generate it again. */
export async function processImage(bytes: Uint8Array, opts: ProcessOptions): Promise<ProcessResult> {
  const size = targetSize(opts.kind, opts.scale);
  let raw: Raw;
  if (opts.kind === 'sprite') {
    const keyed = cutout(await decode(bytes), opts.chroma);
    if (!keyed.ok) return keyed;
    raw = shiftToPalette(await fitInside(keyed.image, size), opts.palette);
    return { ok: true, image: await encodeImage(opts.base, raw, true, await previewJpeg(raw)) };
  }
  raw = shiftToPalette(await decode(bytes, size), opts.palette);
  if (opts.kind === 'texture') {
    raw = makeSeamless(raw);
    if (!isSeamless(raw)) return { ok: false, reason: 'the texture does not tile: its edges do not match' };
    return { ok: true, image: await encodeImage(opts.base, raw, false, await previewJpeg(tile2x2(raw))) };
  }
  if (opts.kind === 'skybox') raw = fixSkybox(raw);
  return { ok: true, image: await encodeImage(opts.base, raw, false, await previewJpeg(raw)) };
}
