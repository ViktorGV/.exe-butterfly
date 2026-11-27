// Locally drawn images: stand-ins in mock mode, and the procedural vote card when a real one fails (#59).
import sharp from 'sharp';
import { createRng } from '../lib/hash.ts';
import type { ChromaName } from './chroma.ts';
import { CHROMA_KEYS } from './chroma.ts';
import { distance, hexToRgb, mixHex, rgbToHex } from './color.ts';
import type { ImageKind } from './process.ts';

export interface PlaceholderOptions {
  kind: ImageKind;
  /** Hex colours; at least one. */
  palette: string[];
  seed: number;
  chroma?: ChromaName;
}

const SIZES: Record<ImageKind, [number, number]> = {
  skybox: [1024, 512],
  texture: [512, 512],
  sprite: [512, 512],
  signage: [768, 384],
  card: [768, 432],
};

/** A deterministic PNG with no text, drawn from the palette. */
export async function placeholderImage(opts: PlaceholderOptions): Promise<Buffer> {
  const [width, height] = SIZES[opts.kind];
  const rng = createRng(opts.seed);
  const palette = opts.palette.length ? opts.palette : ['#7ad7ff'];
  const color = (i: number) => palette[i % palette.length];
  const n = (v: number) => v.toFixed(1);
  const circle = (fill: string, r: number, opacity = 1) =>
    `<circle cx="${n(rng() * width)}" cy="${n(rng() * height)}" r="${n(r)}" fill="${fill}" fill-opacity="${opacity}"/>`;
  let body: string;
  if (opts.kind === 'sprite') {
    const key = CHROMA_KEYS[opts.chroma ?? 'magenta'];
    const subject = palette.find((c) => distance(hexToRgb(c), key) > 220) ?? '#f5c542';
    body =
      `<rect width="${width}" height="${height}" fill="${rgbToHex(key)}"/>` +
      `<path d="M256 ${n(70 + rng() * 60)} L${n(390 + rng() * 40)} 400 L${n(82 + rng() * 40)} 400 Z" fill="${subject}"/>` +
      `<circle cx="256" cy="${n(180 + rng() * 40)}" r="${n(60 + rng() * 40)}" fill="${subject}"/>`;
  } else if (opts.kind === 'texture') {
    body = `<rect width="${width}" height="${height}" fill="${color(0)}"/>`;
    const shades = [mixHex(color(0), '#ffffff', 0.4), mixHex(color(0), '#000000', 0.25)];
    for (let i = 0; i < 24; i++) body += circle(shades[i % 2], 12 + rng() * 40, 0.4);
  } else {
    body =
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color(0)}"/>` +
      `<stop offset="1" stop-color="${color(1)}"/></linearGradient></defs>` +
      `<rect width="${width}" height="${height}" fill="url(#g)"/>`;
    for (let i = 0; i < 14; i++) body += circle(color(2 + (i % 3)), 14 + rng() * height * 0.14, 0.55);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
