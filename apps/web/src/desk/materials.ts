// Materials for the Chain Reaction Desk: glossy toy plastic, matte paper, chrome, brass, rubber and wood.
// Cached by name, so every piece of the same stuff shares one material.
import * as THREE from 'three';

const cache = new Map<string, THREE.Material>();

type Kind = 'plastic' | 'paper' | 'chrome' | 'brass' | 'rubber' | 'wood' | 'glass' | 'glow';

export function mat(kind: Kind, color: THREE.ColorRepresentation, map?: THREE.Texture | null): THREE.Material {
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

/** Material for a flat decal with a texture (no lighting tricks, slightly glossy paper). */
export function decalMat(map: THREE.Texture, kind: Kind = 'paper', transparent = false): THREE.Material {
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
}
