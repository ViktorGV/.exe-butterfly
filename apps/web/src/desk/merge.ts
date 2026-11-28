// Static-mesh merging for the desk course. Every static desk piece is its own Mesh, one draw call (two with
// shadows) each. mergeStaticMeshes() bakes the world transform of every mesh under `holders` into its geometry and
// merges the ones that share a material into chunks of CHUNK_SIZE metres, so far chunks are still frustum-culled.
// Moving pieces are never passed in.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const CHUNK_SIZE = 40;

export function mergeStaticMeshes(root: THREE.Object3D, holders: THREE.Object3D[]): void {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[] }>();
  const merged = new Set<THREE.Mesh>();
  const pos = new THREE.Vector3();

  for (const holder of holders) {
    holder.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material)) return;
      const geo = mesh.geometry;
      if (geo.morphAttributes.position) return;
      const attrs = Object.keys(geo.attributes).sort().join(',');
      pos.setFromMatrixPosition(mesh.matrixWorld);
      const cell = `${Math.floor(pos.x / CHUNK_SIZE)}|${Math.floor(pos.z / CHUNK_SIZE)}`;
      const key = `${mesh.material.uuid}|${attrs}|${geo.index ? 'i' : 'n'}|${cell}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = { material: mesh.material, geos: [] }));
      const baked = geo.clone();
      baked.applyMatrix4(mesh.matrixWorld);
      bucket.geos.push(baked);
      merged.add(mesh);
    });
  }

  for (const mesh of merged) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
  for (const { material, geos } of buckets.values()) {
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (geos.length > 1) for (const g of geos) g.dispose();
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
  }
}
