// SEAM. Seeded by #2 with a flat-colour stub; replaced by #10 (theme renderer).
import * as THREE from 'three';
import { MATERIAL_SLOTS } from '@wobble/shared/constants';
import type { MaterialSlot, ThemeDef } from '@wobble/shared/types';

export interface AppliedTheme {
  getMaterial(slot: MaterialSlot): THREE.Material;
  dispose(): void;
}

/**
 * Apply a theme to the scene.
 * STUB: one flat MeshStandardMaterial per slot, a plain sky colour, hemisphere + sun lights.
 */
export function applyTheme(
  themeDef: ThemeDef,
  { scene }: { scene: THREE.Scene; renderer?: THREE.WebGLRenderer },
): AppliedTheme {
  const materials = new Map<MaterialSlot, THREE.MeshStandardMaterial>();
  for (const slot of MATERIAL_SLOTS) {
    const def = themeDef.materials?.[slot];
    materials.set(
      slot,
      new THREE.MeshStandardMaterial({
        color: def?.color ?? '#cccccc',
        roughness: def?.roughness ?? 0.6,
        metalness: def?.metalness ?? 0,
        emissive: def?.emissive ?? '#000000',
      }),
    );
  }

  const previousBackground = scene.background;
  scene.background = new THREE.Color(themeDef.sky?.horizon ?? '#a0d8ff');

  const hemi = new THREE.HemisphereLight(
    themeDef.sky?.top ?? '#ffffff',
    themeDef.sky?.bottom ?? '#888888',
    themeDef.light?.ambientIntensity ?? 1,
  );
  const sun = new THREE.DirectionalLight(themeDef.light?.sun ?? '#ffffff', themeDef.light?.sunIntensity ?? 2);
  const dir = themeDef.light?.sunDir ?? [-0.4, -1, -0.3];
  sun.position.set(-dir[0], -dir[1], -dir[2]).normalize().multiplyScalar(30);
  sun.castShadow = true;
  scene.add(hemi, sun);

  return {
    getMaterial(slot) {
      return materials.get(slot) ?? (materials.get('platformA') as THREE.Material);
    },
    dispose() {
      scene.remove(hemi, sun);
      scene.background = previousBackground;
      for (const m of materials.values()) m.dispose();
      materials.clear();
    },
  };
}
