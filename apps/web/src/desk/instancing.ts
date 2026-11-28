// Instancing for moving desk obstacles. Every moving part is a holder Group posed each frame; its meshes cost one draw
// call each (two with shadows). Parts with identical geometry and material (keycaps of one colour, record discs,
// pencils, ...) become one InstancedMesh per CHUNK_SIZE cell, and update() copies each holder's pose into its
// instance. Allocation-free per frame.
import * as THREE from 'three';

const CHUNK_SIZE = 60;

interface Bucket {
  mesh: THREE.InstancedMesh;
  holders: THREE.Object3D[];
  locals: THREE.Matrix4[];
}

export interface MoverInstancing {
  /** Call after the holders are posed. */
  update(): void;
}

/** A content hash of a geometry, so identical shapes built separately share one instanced mesh. */
function geometryKey(geo: THREE.BufferGeometry): string {
  let h = 0x811c9dc5;
  const mix = (arr: ArrayLike<number>) => {
    for (let i = 0; i < arr.length; i++) {
      h ^= Math.round(arr[i] * 1e4) | 0;
      h = Math.imul(h, 0x01000193);
    }
  };
  const names = Object.keys(geo.attributes).sort();
  for (const n of names) mix(geo.attributes[n].array as ArrayLike<number>);
  if (geo.index) mix(geo.index.array);
  return `${names.join(',')}:${geo.attributes.position.count}:${geo.index?.count ?? -1}:${h >>> 0}`;
}

export function instanceMovers(root: THREE.Object3D, holders: THREE.Object3D[]): MoverInstancing {
  root.updateMatrixWorld(true);
  const groups = new Map<string, { meshes: THREE.Mesh[]; holders: THREE.Object3D[]; locals: THREE.Matrix4[] }>();
  const inv = new THREE.Matrix4();
  const geoKeys = new Map<THREE.BufferGeometry, string>();

  for (const holder of holders) {
    inv.copy(holder.matrixWorld).invert();
    const cell = `${Math.floor(holder.position.x / CHUNK_SIZE)}|${Math.floor(holder.position.z / CHUNK_SIZE)}`;
    holder.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || Array.isArray(mesh.material)) return;
      if (mesh.geometry.morphAttributes.position) return;
      let gk = geoKeys.get(mesh.geometry);
      if (!gk) geoKeys.set(mesh.geometry, (gk = geometryKey(mesh.geometry)));
      const key = `${mesh.material.uuid}|${gk}|${mesh.name}|${cell}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { meshes: [], holders: [], locals: [] }));
      g.meshes.push(mesh);
      g.holders.push(holder);
      g.locals.push(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    });
  }

  const buckets: Bucket[] = [];
  for (const g of groups.values()) {
    if (g.meshes.length < 2) continue;
    const first = g.meshes[0];
    const mesh = new THREE.InstancedMesh(first.geometry, first.material, g.meshes.length);
    mesh.name = first.name;
    for (const m of g.meshes) {
      m.removeFromParent();
      if (m.geometry !== first.geometry) m.geometry.dispose();
    }
    root.add(mesh);
    buckets.push({ mesh, holders: g.holders, locals: g.locals });
  }

  const m4 = new THREE.Matrix4();
  const update = () => {
    for (const b of buckets) {
      for (let i = 0; i < b.holders.length; i++) {
        const h = b.holders[i];
        h.updateMatrix();
        b.mesh.setMatrixAt(i, m4.multiplyMatrices(h.matrix, b.locals[i]));
      }
      b.mesh.instanceMatrix.needsUpdate = true;
      b.mesh.computeBoundingSphere();
    }
  };
  update();
  return { update };
}
