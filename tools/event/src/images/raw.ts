// Raw pixel buffers and the sharp calls shared by the image post-processors (#59).
import sharp from 'sharp';
import type { Sharp } from 'sharp';

/** 8-bit RGBA pixels, row-major. */
export interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

export type Rgb = [number, number, number];

export interface Size {
  width: number;
  height: number;
}

export function createRaw(width: number, height: number): Raw {
  return { data: Buffer.alloc(width * height * 4), width, height };
}

/** Decode any supported image to RGBA. With `size`, it is resized (cover: centre crop, no distortion). */
export async function decode(bytes: Uint8Array, size?: Size): Promise<Raw> {
  let img = sharp(bytes).rotate();
  if (size) img = img.resize(size.width, size.height, { fit: 'cover', position: 'centre' });
  return toRaw(img);
}

async function toRaw(img: Sharp): Promise<Raw> {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const fromRaw = (raw: Raw) => sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } });

/** Shrink to fit inside `size`, keeping the aspect ratio. Never enlarges. */
export async function fitInside(raw: Raw, size: Size): Promise<Raw> {
  return toRaw(fromRaw(raw).resize(size.width, size.height, { fit: 'inside', withoutEnlargement: true }));
}

/** WebP without metadata. Opaque images drop the alpha channel. */
export async function encodeWebp(raw: Raw, opts: { quality: number; alpha: boolean }): Promise<Buffer> {
  const img = fromRaw(raw);
  if (!opts.alpha) img.removeAlpha();
  return img.webp({ quality: opts.quality, alphaQuality: 90, effort: 4 }).toBuffer();
}

/** A small JPEG for the vision model. Transparent pixels are put on mid grey. */
export async function previewJpeg(raw: Raw, longSide = 512): Promise<Buffer> {
  const small = await fitInside(raw, { width: longSide, height: longSide });
  return fromRaw(small).flatten({ background: '#808080' }).jpeg({ quality: 80 }).toBuffer();
}

export async function encodePng(raw: Raw): Promise<Buffer> {
  return fromRaw(raw).png().toBuffer();
}

/** The image repeated 2 x 2, to show whether it tiles. */
export function tile2x2(raw: Raw): Raw {
  const out = createRaw(raw.width * 2, raw.height * 2);
  for (let y = 0; y < out.height; y++) {
    const from = (y % raw.height) * raw.width * 4;
    const row = raw.data.subarray(from, from + raw.width * 4);
    row.copy(out.data, y * out.width * 4);
    row.copy(out.data, (y * out.width + raw.width) * 4);
  }
  return out;
}

/** Half-size by averaging 2x2 blocks (alpha-weighted). Never reads across edges, so tiling stays seamless. */
export function halve(raw: Raw): Raw {
  const out = createRaw(Math.max(1, raw.width >> 1), Math.max(1, raw.height >> 1));
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = 0; k < 4; k++) {
        const sx = Math.min(raw.width - 1, x * 2 + (k & 1));
        const sy = Math.min(raw.height - 1, y * 2 + (k >> 1));
        const i = (sy * raw.width + sx) * 4;
        const alpha = raw.data[i + 3];
        r += raw.data[i] * alpha;
        g += raw.data[i + 1] * alpha;
        b += raw.data[i + 2] * alpha;
        a += alpha;
      }
      const o = (y * out.width + x) * 4;
      out.data[o] = a ? Math.round(r / a) : 0;
      out.data[o + 1] = a ? Math.round(g / a) : 0;
      out.data[o + 2] = a ? Math.round(b / a) : 0;
      out.data[o + 3] = Math.round(a / 4);
    }
  }
  return out;
}
