// Materials for the Chain Reaction Desk: glossy toy plastic, matte paper, chrome, brass, rubber and wood.
// Cached by name, so every piece of the same stuff shares one material.
import * as THREE from 'three';

const cache = new Map<string, THREE.Material>();

/**
 * Theme repaint (event themes on the desk map): every desk colour is mapped onto the theme's palette and each
 * kind of stuff takes one of the theme's generated textures, sampled in world space. Set it before building the
 * desk; null is the plain school desk.
 */
export interface DeskPaint {
  /** Theme colours to map desk colours onto (materials, fx, costume palette). */
  palette: readonly string[];
  /** The theme's textured slot material for a desk stuff kind, or null for flat colour. */
  texture(kind: Kind): THREE.Material | null;
  /** Patch a material so its map is sampled in world space (theme textures tile at a fixed density). */
  worldMapping(material: THREE.MeshStandardMaterial): void;
}

let paint: DeskPaint | null = null;
/** Materials that take a theme texture once it has loaded: [desk material, theme slot material]. */
const painted: [THREE.MeshStandardMaterial, THREE.Material][] = [];

/** True while a theme repaint is active (pieces with a school shape swap to a neutral one). */
export function deskPainted(): boolean {
  return paint !== null;
}

export function setDeskPaint(p: DeskPaint | null): void {
  paint = p;
}

/** Copy late-loading theme textures onto the desk materials; cheap, call every frame. */
export function syncDeskPaint(): void {
  for (const [m, source] of painted) {
    const map = (source as THREE.MeshStandardMaterial).map ?? null;
    if (m.map !== map) {
      m.map = map;
      m.needsUpdate = true;
    }
  }
}

const hsl = { h: 0, s: 0, l: 0 };
const tmp = new THREE.Color();
/** A desk colour in the theme: hue and saturation from a palette colour picked by the desk colour, lightness kept
 * between the two so light paper stays light and dark plastic stays dark. */
function repaint(color: THREE.ColorRepresentation, palette: readonly string[]): THREE.Color {
  const c = new THREE.Color(color);
  const key = Math.round((c.r * 7 + c.g * 13 + c.b * 29) * 255);
  tmp.set(palette[key % palette.length] ?? '#888888').getHSL(hsl);
  const pal = { ...hsl };
  c.getHSL(hsl);
  return new THREE.Color().setHSL(pal.h, pal.s, hsl.l * 0.55 + pal.l * 0.45);
}

type Kind = 'plastic' | 'paper' | 'chrome' | 'brass' | 'rubber' | 'wood' | 'glass' | 'glow';

export function mat(kind: Kind, color: THREE.ColorRepresentation, map?: THREE.Texture | null): THREE.Material {
  if (paint) return paintedMat(kind, color);
  const key = `${kind}:${new THREE.Color(color).getHexString()}:${map?.uuid ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let m: THREE.Material;
  switch (kind) {
    case 'plastic':
      m = new THREE.MeshPhysicalMaterial({ color, map, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.15 });
      break;
    case 'paper':
      m = new THREE.MeshStandardMaterial({ color, map, roughness: 0.92 });
      break;
    case 'chrome':
      m = new THREE.MeshStandardMaterial({ color, map, roughness: 0.12, metalness: 1 });
      break;
    case 'brass':
      m = new THREE.MeshStandardMaterial({ color, map, roughness: 0.3, metalness: 1 });
      break;
    case 'rubber':
      m = new THREE.MeshStandardMaterial({ color, map, roughness: 0.75 });
      break;
    case 'wood':
      m = new THREE.MeshStandardMaterial({ color, map, roughness: 0.6 });
      break;
    case 'glass':
      m = new THREE.MeshPhysicalMaterial({
        color,
        map,
        roughness: 0.05,
        transmission: 0.6,
        thickness: 0.5,
        clearcoat: 1,
      });
      break;
    case 'glow':
      m = new THREE.MeshBasicMaterial({ color, map });
      break;
  }
  cache.set(key, m);
  return m;
}

/** A desk material in the theme: repainted colour, the theme texture for this kind of stuff, school decals dropped. */
function paintedMat(kind: Kind, color: THREE.ColorRepresentation, inFront = false): THREE.Material {
  const p = paint!;
  const c = kind === 'glow' ? new THREE.Color(color) : repaint(color, p.palette);
  const key = `paint:${kind}:${c.getHexString()}:${inFront}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let m: THREE.Material;
  if (kind === 'glow') {
    m = new THREE.MeshBasicMaterial({ color: repaint(color, p.palette).offsetHSL(0, 0, 0.2) });
  } else {
    const metal = kind === 'chrome' || kind === 'brass';
    const std = new THREE.MeshStandardMaterial({
      color: c.clone().lerp(new THREE.Color('#ffffff'), 0.35),
      roughness: metal ? 0.3 : kind === 'plastic' ? 0.4 : 0.8,
      metalness: metal ? 0.8 : 0.1,
    });
    const source = kind === 'glass' ? null : p.texture(kind);
    if (source) {
      p.worldMapping(std);
      painted.push([std, source]);
    }
    m = std;
  }
  if (inFront) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -4;
  }
  cache.set(key, m);
  return m;
}

/** Material for a flat decal with a texture (no lighting tricks, slightly glossy paper). */
export function decalMat(map: THREE.Texture, kind: Kind = 'paper', transparent = false): THREE.Material {
  // School decals (keycap letters, notebook lines, record labels, clock faces) are dropped in a theme.
  // A decal floats a few millimetres above its surface; repainted it becomes a plain surface that would fight with
  // the one under it (flicker on the dominoes and floors), so it is drawn a hair in front.
  if (paint) return paintedMat(kind === 'glow' ? 'paper' : kind, '#e8e8e8', true);
  const key = `decal:${kind}:${map.uuid}:${transparent}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const m =
    kind === 'plastic'
      ? new THREE.MeshPhysicalMaterial({ map, roughness: 0.35, clearcoat: 0.6, transparent })
      : new THREE.MeshStandardMaterial({ map, roughness: kind === 'glow' ? 1 : 0.85, transparent });
  if (transparent) {
    m.alphaTest = 0.5;
    m.side = THREE.DoubleSide;
  }
  cache.set(key, m);
  return m;
}

/** Disposes every cached material (textures are shared and kept). */
export function disposeMaterials(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
  painted.length = 0;
}
