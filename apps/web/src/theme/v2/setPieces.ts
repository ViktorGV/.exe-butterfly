// Landmarks (all merged into one mesh) and signage decals (one instanced quad per slot) for #64.
import * as THREE from 'three';
import type { Landmark, Pose, Signage } from '@wobble/shared/types';
import type { ResourceTracker, TextureLoaderV2 } from './images.ts';
import { landmarkPose, signagePoses, type ThemeAnchors, type ThemeCourse } from './layout.ts';
import { primsGeometry, primsMaterial } from './prims.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const m = new THREE.Matrix4();
const p = new THREE.Vector3();
const q = new THREE.Quaternion();
const s = new THREE.Vector3();

function poseMatrix(pose: Pose, scale = 1): THREE.Matrix4 {
  return m.compose(
    p.set(pose.pos[0], pose.pos[1], pose.pos[2]),
    q.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]),
    s.set(scale, scale, scale),
  );
}

/** Every landmark merged into one mesh at its anchor, outside the playable bounds. */
export function createLandmarks(landmarks: readonly Landmark[], course: ThemeCourse, tracker: ResourceTracker) {
  if (landmarks.length === 0) return null;
  const parts = landmarks.map((l) => {
    const g = primsGeometry(l.prims, Math.max(0.1, l.scale));
    g.applyMatrix4(poseMatrix(landmarkPose(l.anchor, course)));
    return g;
  });
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (merged !== parts[0]) for (const g of parts) g.dispose();
  if (!merged) return null;
  merged.computeBoundingSphere();
  const mesh = new THREE.Mesh(tracker.track(merged), tracker.track(primsMaterial()));
  mesh.name = 'theme:landmarks';
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Signage width in metres per slot (height follows the image aspect). */
export const SIGNAGE_WIDTH = { startArch: 10, checkpoint: 7, finishGate: 12, sideBanner: 4 } as const;

export function createSignage(
  signage: readonly Signage[],
  anchors: ThemeAnchors,
  loader: TextureLoaderV2,
  tracker: ResourceTracker,
) {
  const group = new THREE.Group();
  group.name = 'theme:signage';
  for (const sign of signage) {
    const poses = signagePoses(sign.slot, anchors);
    if (poses.length === 0) continue;
    const width = SIGNAGE_WIDTH[sign.slot];
    const aspect = Math.min(4, Math.max(0.5, sign.image.w / sign.image.h));
    const geometry = tracker.track(new THREE.PlaneGeometry(width, width / aspect));
    const material = tracker.track(
      new THREE.MeshBasicMaterial({
        transparent: sign.image.alpha,
        alphaTest: sign.image.alpha ? 0.5 : 0,
        side: THREE.DoubleSide,
      }),
    );
    const mesh = new THREE.InstancedMesh(geometry, material, poses.length);
    mesh.name = `signage:${sign.slot}`;
    poses.forEach((pose, i) => mesh.setMatrixAt(i, poseMatrix(pose)));
    mesh.computeBoundingSphere();
    mesh.visible = false; // shown once the image is decoded: a missing image simply leaves no sign
    loader.load(sign.image, (tex) => {
      material.map = tex;
      material.needsUpdate = true;
      mesh.visible = true;
    });
    group.add(mesh);
  }
  return group;
}
