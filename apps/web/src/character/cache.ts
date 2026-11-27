// Shared resources (#8). Geometry, textures and materials are shared by every Wobbler with the same skin
// fields and freed when the last one using them is disposed. Skin-independent meshes live for the page.
import * as THREE from 'three';
import { drawPattern } from '@wobble/shared';
import { createBodyGeometry, createLimbGeometry, triangles } from './geometry.ts';
import {
  BODY_ROWS,
  BODY_SEGMENTS,
  BUDGET,
  LIMB_CAP_SEGMENTS,
  LIMB_COUNT,
  LIMB_RADIAL_SEGMENTS,
  buildDetailGeometry,
  type DetailGeometry,
} from './parts.ts';
import { bodyKey, detailKey, type WobblerParams } from './skin.ts';

/** A canvas the pattern can be drawn into (HTMLCanvasElement or OffscreenCanvas). */
export type PatternCanvas = {
  width: number;
  height: number;
  getContext(kind: '2d'): unknown;
};
export type PatternCanvasFactory = (sizePx: number) => PatternCanvas | null;

function defaultCanvasFactory(sizePx: number): PatternCanvas | null {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = sizePx;
    c.height = sizePx;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(sizePx, sizePx);
  return null;
}

let canvasFactory: PatternCanvasFactory = defaultCanvasFactory;

/** Override how pattern canvases are made (tests, workers). `null` restores the default. */
export function setPatternCanvasFactory(factory: PatternCanvasFactory | null): void {
  canvasFactory = factory ?? defaultCanvasFactory;
}

// ---------------------------------------------------------------------------------------------------------

interface Entry<T> {
  value: T;
  refs: number;
}

class RefCache<T> {
  private readonly map = new Map<string, Entry<T>>();
  constructor(
    private readonly build: (key: string, params: WobblerParams) => T,
    private readonly free: (value: T) => void,
  ) {}

  acquire(key: string, params: WobblerParams): T {
    let e = this.map.get(key);
    if (!e) {
      e = { value: this.build(key, params), refs: 0 };
      this.map.set(key, e);
    }
    e.refs++;
    return e.value;
  }

  release(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    if (--e.refs > 0) return;
    this.map.delete(key);
    this.free(e.value);
  }

  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Skin-independent shared meshes and materials (never disposed).

let bodyGeometry: THREE.BufferGeometry | null = null;
let limbGeometry: THREE.BufferGeometry | null = null;
let detailMaterial: THREE.Material | null = null;
let glowMaterial: THREE.Material | null = null;

export function sharedBodyGeometry(): THREE.BufferGeometry {
  return (bodyGeometry ??= createBodyGeometry(BODY_SEGMENTS, BODY_ROWS));
}

export function sharedLimbGeometry(): THREE.BufferGeometry {
  return (limbGeometry ??= createLimbGeometry(LIMB_CAP_SEGMENTS, LIMB_RADIAL_SEGMENTS));
}

/** Triangles drawn by the body and the four limbs, before face and accessories. */
export function baseTriangles(): number {
  return triangles(sharedBodyGeometry()) + LIMB_COUNT * triangles(sharedLimbGeometry());
}

export function sharedDetailMaterial(): THREE.Material {
  return (detailMaterial ??= new THREE.MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }));
}

export function sharedGlowMaterial(): THREE.Material {
  return (glowMaterial ??= new THREE.MeshBasicMaterial({ vertexColors: true }));
}

// ---------------------------------------------------------------------------------------------------------
// Per-skin resources.

function buildPatternTexture(p: WobblerParams): THREE.Texture | null {
  const px = BUDGET.patternPx;
  const canvas = canvasFactory(px);
  const ctx = canvas?.getContext('2d') as Parameters<typeof drawPattern>[0] | null | undefined;
  if (!canvas || !ctx) return null;
  ctx.fillStyle = p.body.color;
  ctx.fillRect(0, 0, px, px);
  drawPattern(ctx, p.body.pattern, px);
  const tex = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // u runs around the body (~2.3 m), v bottom to top (~1 m): keep tiles roughly square and seamless.
  const s = p.body.pattern.scale;
  tex.repeat.set(Math.max(1, Math.round(3 * s)), 1.5 * s);
  return tex;
}

const bodyMaterials = new RefCache<THREE.MeshLambertMaterial>(
  (_key, p) => {
    const map = p.body.pattern.type === 'none' ? null : buildPatternTexture(p);
    return new THREE.MeshLambertMaterial({ color: map ? '#ffffff' : p.body.color, map });
  },
  (m) => {
    m.map?.dispose();
    m.dispose();
  },
);

const limbMaterials = new RefCache<THREE.MeshLambertMaterial>(
  (_key, p) => new THREE.MeshLambertMaterial({ color: p.limbs.color }),
  (m) => m.dispose(),
);

const details = new RefCache<DetailGeometry>(
  (_key, p) => buildDetailGeometry(p, baseTriangles()),
  (d) => {
    d.detail.dispose();
    d.glow?.dispose();
  },
);

export interface SkinResources {
  bodyMaterial: THREE.MeshLambertMaterial;
  limbMaterial: THREE.MeshLambertMaterial;
  detail: DetailGeometry;
  release(): void;
}

/** Take a reference on every shared resource a skin needs. Call `release()` exactly once. */
export function acquireSkin(p: WobblerParams): SkinResources {
  const bKey = bodyKey(p);
  const dKey = detailKey(p);
  const lKey = p.limbs.color;
  let released = false;
  return {
    bodyMaterial: bodyMaterials.acquire(bKey, p),
    limbMaterial: limbMaterials.acquire(lKey, p),
    detail: details.acquire(dKey, p),
    release() {
      if (released) return;
      released = true;
      bodyMaterials.release(bKey);
      limbMaterials.release(lKey);
      details.release(dKey);
    },
  };
}

/** Live cache sizes, for tests and the debug overlay. */
export function cacheStats(): { bodyMaterials: number; limbMaterials: number; details: number } {
  return { bodyMaterials: bodyMaterials.size, limbMaterials: limbMaterials.size, details: details.size };
}
