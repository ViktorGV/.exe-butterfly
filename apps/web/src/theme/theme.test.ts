import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { MATERIAL_SLOTS } from '@wobble/shared/constants';
import { fixtureTheme } from '@wobble/shared/fixtures/index';
import { applyTheme } from './index.ts';

describe('applyTheme seam (stub seeded by #2)', () => {
  it('provides a material per slot and cleans up', () => {
    const scene = new THREE.Scene();
    const theme = applyTheme(fixtureTheme, { scene });
    for (const slot of MATERIAL_SLOTS) expect(theme.getMaterial(slot)).toBeInstanceOf(THREE.Material);
    expect(scene.children.length).toBe(2);
    theme.dispose();
    expect(scene.children.length).toBe(0);
    expect(scene.background).toBeNull();
  });
});
