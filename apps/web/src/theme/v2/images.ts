// Progressive image loading and resource tracking for theme v2 (#64).
// Images decode off the main thread with createImageBitmap where supported; every texture,
// geometry and material a theme creates is tracked so dispose() leaks nothing.
import * as THREE from 'three';
import type { ImageRef } from '@wobble/shared/types';
import { pickImage, type ThemeQuality } from './quality.ts';

/** Resolves an image file of the theme folder; null when missing. `scale` < 1 asks for a smaller decode. */
export type ImageSource = (src: string, ref: ImageRef, scale: number) => Promise<TexImageSource | null>;

/** Loads `${baseUrl}${src}` with fetch + createImageBitmap (falls back to <img>). */
export function urlImageSource(baseUrl: string): ImageSource {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return async (src, ref, scale) => {
    if (typeof fetch !== 'function') return null;
    try {
      const res = await fetch(base + src);
      if (!res.ok) return null;
      const blob = await res.blob();
      if (typeof createImageBitmap === 'function') {
        const opts: ImageBitmapOptions = { imageOrientation: 'flipY' };
        if (scale < 1 && ref.w > 1 && ref.h > 1) {
          opts.resizeWidth = Math.max(1, Math.round(ref.w * scale));
          opts.resizeHeight = Math.max(1, Math.round(ref.h * scale));
          opts.resizeQuality = 'medium';
        }
        return await createImageBitmap(blob, opts);
      }
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      return null;
    }
  };
}

export interface ResourceTracker {
  track<T extends { dispose(): void }>(r: T): T;
  /** Disposes everything tracked (and closes decoded bitmaps). */
  disposeAll(): void;
  readonly size: number;
}

export function createTracker(): ResourceTracker {
  const set = new Set<{ dispose(): void }>();
  return {
    track(r) {
      set.add(r);
      return r;
    },
    disposeAll() {
      for (const r of set) {
        if (r instanceof THREE.Texture) closeBitmap(r.image);
        r.dispose();
      }
      set.clear();
    },
    get size() {
      return set.size;
    },
  };
}

/** Images smaller than this on either side are placeholders (the fixture ships 1x1 files) and count as missing. */
export const MIN_IMAGE_SIDE = 8;

function isPlaceholder(image: TexImageSource): boolean {
  const { width, height } = image as { width: number; height: number };
  return width < MIN_IMAGE_SIDE || height < MIN_IMAGE_SIDE;
}

function closeBitmap(image: unknown) {
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
}

export interface TextureLoaderV2 {
  /** Starts loading; calls `apply` with the texture once decoded (never after dispose). */
  load(ref: ImageRef | null, apply: (tex: THREE.Texture) => void, opts?: { repeat?: boolean; srgb?: boolean }): void;
  /** Resolves when every load started so far has settled. */
  settled(): Promise<void>;
  dispose(): void;
}

export function createTextureLoader(
  source: ImageSource,
  quality: ThemeQuality,
  renderer: THREE.WebGLRenderer | undefined,
  tracker: ResourceTracker,
): TextureLoaderV2 {
  const pending: Promise<void>[] = [];
  let disposed = false;
  const maxAniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  return {
    load(ref, apply, opts = {}) {
      if (!ref) return;
      const { src, scale } = pickImage(ref, quality);
      pending.push(
        source(src, ref, scale).then((image) => {
          if (!image) return;
          if (disposed || isPlaceholder(image)) return closeBitmap(image);
          const tex = tracker.track(new THREE.Texture(image));
          // Bitmaps were flipped at decode time (imageOrientation: 'flipY').
          tex.flipY = !(typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap);
          tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.anisotropy = Math.min(maxAniso, quality.anisotropy);
          if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.needsUpdate = true;
          apply(tex);
        }),
      );
    },
    async settled() {
      await Promise.allSettled(pending);
    },
    dispose() {
      disposed = true;
    },
  };
}
