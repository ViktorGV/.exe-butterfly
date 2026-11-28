import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import type { Dressing } from '@wobble/shared/types';
import { createDressingTemplates } from './dressing.ts';
import { createTracker } from './images.ts';

const entry = (slot: Dressing['slot']): Dressing => ({
  kind: 'platform',
  part: 0,
  hideBase: false,
  slot,
  prims: [{ shape: 'box', pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], color: '#ffffff' }],
});

describe('dressing slot textures (#64)', () => {
  it('draws slot dressing with the slot texture once it loads, flat dressing without', () => {
    const slotMat = new THREE.MeshStandardMaterial();
    const textured = createDressingTemplates([entry('hazard')], createTracker(), () => slotMat);
    const flat = createDressingTemplates([entry(null)], createTracker(), () => slotMat);
    const t = textured.get('platform', 0)!.material as THREE.MeshStandardMaterial;
    expect(t.map).toBeNull();
    slotMat.map = new THREE.Texture();
    textured.sync();
    expect(t.map).toBe(slotMat.map);
    flat.sync();
    expect((flat.get('platform', 0)!.material as THREE.MeshStandardMaterial).map).toBeNull();
  });
});
