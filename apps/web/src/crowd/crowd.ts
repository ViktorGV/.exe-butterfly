// Crowd renderer (#9): remote players as a few pooled full-detail Wobblers near the camera plus one
// InstancedMesh for everyone else, with instanced blob shadows and pooled name tags.
import * as THREE from 'three';
import type { RemoteState } from '@wobble/shared';
import { MAX_PLAYERS_PER_ROOM, WIRE } from '@wobble/shared/constants';
import { createWobbler, getLodGeometry, skinToInstance, type InstanceColors } from '../character/index.ts';
import { createBlobMaterial, createFarMaterial, FAR_ATTR } from './farMaterial.ts';
import { createSlotPool } from './pool.ts';
import { assignTiers, createTierScratch, sortRange } from './tiers.ts';

export interface CrowdPose {
  pos: ArrayLike<number>;
  yaw: number;
  anim: number;
  speed: number;
}

/** What `wobblerFactory` must return (the `createWobbler` contract). */
export interface CrowdWobbler {
  readonly object3d: THREE.Object3D;
  setPose(pose: CrowdPose, dt: number): void;
  dispose(): void;
}

export interface CrowdPlayer {
  id: number;
  name: string;
  skin?: unknown;
}

export interface CrowdOptions {
  scene: THREE.Object3D;
  /** Most remote players drawn at once. */
  max?: number;
  wobblerFactory?: (skin: unknown) => CrowdWobbler;
  /** Full-detail Wobblers (3 draw calls each); the phone default keeps 300 players under 30 calls. */
  nearMax?: number;
  /** Pooled name tags for the nearest players (1 draw call each). */
  nameTags?: number;
  /** New full-detail Wobblers built per frame at most, so mass tier crossings never hitch. */
  maxPromotePerFrame?: number;
}

export interface CrowdStats {
  players: number;
  near: number;
  far: number;
  hidden: number;
  tags: number;
}

export interface Crowd {
  setPlayers(list: readonly CrowdPlayer[]): void;
  setSkin(id: number, skin: unknown): void;
  update(
    remoteStates: ReadonlyMap<number, RemoteState>,
    cameraPos: { x: number; y: number; z: number },
    dt: number,
  ): void;
  /** Counts from the last update (reads only). */
  stats(): CrowdStats;
  /** The far-tier and shadow meshes, exposed for tests and debugging. */
  readonly farMesh: THREE.InstancedMesh;
  readonly shadowMesh: THREE.InstancedMesh;
  dispose(): void;
}

export const CROWD_DEFAULTS = Object.freeze({ nearMax: 6, nameTags: 6, maxPromotePerFrame: 3 });
const SHADOW_SIZE = 0.9;
const TAG_HEIGHT = 1.45;

export function createCrowd(opts: CrowdOptions): Crowd {
  const { scene } = opts;
  const max = Math.max(1, opts.max ?? MAX_PLAYERS_PER_ROOM - 1);
  const factory = opts.wobblerFactory ?? createWobbler;
  const nearMax = opts.nearMax ?? CROWD_DEFAULTS.nearMax;
  const tagMax = typeof document === 'undefined' ? 0 : (opts.nameTags ?? CROWD_DEFAULTS.nameTags);
  const maxPromote = opts.maxPromotePerFrame ?? CROWD_DEFAULTS.maxPromotePerFrame;

  const pool = createSlotPool(max);
  const px = new Float32Array(max);
  const py = new Float32Array(max);
  const pz = new Float32Array(max);
  const yaw = new Float32Array(max);
  const anim = new Uint8Array(max);
  const grounded = new Uint8Array(max);
  const speed = new Float32Array(max);
  const phase = new Float32Array(max);
  const hasPrev = new Uint8Array(max);
  const dist2 = new Float32Array(max);
  const wasNear = new Uint8Array(max);
  const near = new Uint8Array(max);
  const seen = new Uint32Array(max);
  const colors = new Float32Array(max * 9);
  const skins: unknown[] = new Array<unknown>(max).fill(undefined);
  const names: string[] = new Array<string>(max).fill('');
  const wobblers: (CrowdWobbler | null)[] = new Array<CrowdWobbler | null>(max).fill(null);
  const scratch = createTierScratch(max);
  const tagIdx = new Int32Array(max);
  const tmpColors: InstanceColors = { primary: new THREE.Color(), belly: new THREE.Color(), limbs: new THREE.Color() };
  const pose: CrowdPose = { pos: new Float32Array(3), yaw: 0, anim: 0, speed: 0 };
  const posBuf = pose.pos as Float32Array;
  let gen = 0;
  const stat: CrowdStats = { players: 0, near: 0, far: 0, hidden: 0, tags: 0 };

  // ---- far tier: one InstancedMesh with per-instance colours and anim ----
  const far = createFarMaterial();
  const farGeo = new THREE.InstancedBufferGeometry();
  const lod = getLodGeometry();
  for (const name of Object.keys(lod.attributes)) farGeo.setAttribute(name, lod.getAttribute(name));
  farGeo.setIndex(lod.getIndex());
  const iPrimary = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const iBelly = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const iLimbs = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const iAnim = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  for (const a of [iPrimary, iBelly, iLimbs, iAnim]) a.setUsage(THREE.DynamicDrawUsage);
  farGeo.setAttribute(FAR_ATTR.primary, iPrimary);
  farGeo.setAttribute(FAR_ATTR.belly, iBelly);
  farGeo.setAttribute(FAR_ATTR.limbs, iLimbs);
  farGeo.setAttribute(FAR_ATTR.anim, iAnim);
  const farMesh = new THREE.InstancedMesh(farGeo, far.material, max);
  farMesh.name = 'crowd:far';
  farMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  farMesh.frustumCulled = false;
  farMesh.count = 0;
  scene.add(farMesh);
  const farM = farMesh.instanceMatrix.array as Float32Array;
  const aP = iPrimary.array as Float32Array;
  const aB = iBelly.array as Float32Array;
  const aL = iLimbs.array as Float32Array;
  const aA = iAnim.array as Float32Array;

  // ---- blob shadows for every visible player ----
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowMat = createBlobMaterial();
  const shadowMesh = new THREE.InstancedMesh(shadowGeo, shadowMat, max);
  shadowMesh.name = 'crowd:shadows';
  shadowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shadowMesh.frustumCulled = false;
  shadowMesh.renderOrder = -1;
  shadowMesh.count = 0;
  scene.add(shadowMesh);
  const shM = shadowMesh.instanceMatrix.array as Float32Array;

  // ---- name tags (browser only) ----
  const tags: {
    sprite: THREE.Sprite;
    ctx: CanvasRenderingContext2D;
    tex: THREE.CanvasTexture;
    owner: number;
    text: string;
  }[] = [];
  for (let i = 0; i < tagMax; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    sprite.scale.set(1.2, 0.3, 1);
    sprite.visible = false;
    sprite.name = 'crowd:tag';
    scene.add(sprite);
    tags.push({ sprite, ctx, tex, owner: -1, text: '' });
  }

  function drawTag(t: (typeof tags)[number], text: string): void {
    if (t.text === text) return;
    t.text = text;
    const { ctx } = t;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, 128, 32, 248);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 128, 32, 248);
    t.tex.needsUpdate = true;
  }

  function writeColors(slot: number, skin: unknown): void {
    skinToInstance(skin, tmpColors);
    const o = slot * 9;
    colors[o] = tmpColors.primary.r;
    colors[o + 1] = tmpColors.primary.g;
    colors[o + 2] = tmpColors.primary.b;
    colors[o + 3] = tmpColors.belly.r;
    colors[o + 4] = tmpColors.belly.g;
    colors[o + 5] = tmpColors.belly.b;
    colors[o + 6] = tmpColors.limbs.r;
    colors[o + 7] = tmpColors.limbs.g;
    colors[o + 8] = tmpColors.limbs.b;
  }

  function dropWobbler(slot: number): void {
    const w = wobblers[slot];
    if (!w) return;
    w.object3d.removeFromParent();
    w.dispose();
    wobblers[slot] = null;
  }

  function removeSlot(slot: number, id: number): void {
    dropWobbler(slot);
    skins[slot] = undefined;
    names[slot] = '';
    wasNear[slot] = near[slot] = hasPrev[slot] = 0;
    pool.release(id);
  }

  function setPlayers(list: readonly CrowdPlayer[]): void {
    gen = (gen + 1) >>> 0 || 1;
    for (const p of list) {
      const isNew = pool.slotOf(p.id) < 0;
      const slot = pool.acquire(p.id);
      if (slot < 0) continue; // over capacity: not drawn
      seen[slot] = gen;
      names[slot] = p.name;
      if (isNew) {
        skins[slot] = p.skin;
        writeColors(slot, p.skin);
        phase[slot] = (((p.id * 2654435761) >>> 0) / 4294967296) * 100;
        speed[slot] = 0;
        hasPrev[slot] = 0;
      } else if (p.skin !== undefined && p.skin !== skins[slot]) {
        setSkin(p.id, p.skin);
      }
    }
    const span = pool.span;
    for (let s = 0; s < span; s++) {
      const id = pool.idAt(s);
      if (id >= 0 && seen[s] !== gen) removeSlot(s, id);
    }
  }

  function setSkin(id: number, skin: unknown): void {
    const slot = pool.slotOf(id);
    if (slot < 0) return;
    skins[slot] = skin;
    writeColors(slot, skin);
    if (wobblers[slot]) {
      // Swap in place: the next update rebuilds it at the same pose.
      dropWobbler(slot);
      wasNear[slot] = 0;
    }
  }

  function writeTRS(m: Float32Array, o: number, x: number, y: number, z: number, ry: number, s: number): void {
    const c = Math.cos(ry) * s;
    const n = Math.sin(ry) * s;
    m[o] = c;
    m[o + 1] = 0;
    m[o + 2] = -n;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = s;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = n;
    m[o + 9] = 0;
    m[o + 10] = c;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
  }

  function update(
    remoteStates: ReadonlyMap<number, RemoteState>,
    cameraPos: { x: number; y: number; z: number },
    dt: number,
  ): void {
    far.time.value += dt;
    const span = pool.span;
    const k = dt > 0 ? Math.min(1, dt * 8) : 0;
    let hidden = 0;
    for (let s = 0; s < span; s++) {
      const id = pool.idAt(s);
      const st = id >= 0 ? remoteStates.get(id) : undefined;
      if (!st) {
        dist2[s] = Infinity;
        hasPrev[s] = 0;
        if (id >= 0) hidden++;
        continue;
      }
      const x = st.pos[0];
      const y = st.pos[1];
      const z = st.pos[2];
      if (hasPrev[s] && dt > 0) {
        const dx = x - px[s]!;
        const dz = z - pz[s]!;
        speed[s] = speed[s]! + (Math.sqrt(dx * dx + dz * dz) / dt - speed[s]!) * k;
      }
      hasPrev[s] = 1;
      px[s] = x;
      py[s] = y;
      pz[s] = z;
      yaw[s] = st.yaw;
      anim[s] = st.anim & WIRE.ANIM_MASK;
      grounded[s] = st.flags & WIRE.FLAG_GROUNDED ? 1 : 0;
      const cx = x - cameraPos.x;
      const cy = y - cameraPos.y;
      const cz = z - cameraPos.z;
      dist2[s] = cx * cx + cy * cy + cz * cz;
    }

    const nearCount = assignTiers(span, dist2, wasNear, near, nearMax, maxPromote, scratch);
    let f = 0;
    let sh = 0;
    let t = 0;
    for (let s = 0; s < span; s++) {
      if (!near[s] && wobblers[s]) dropWobbler(s);
      if (dist2[s] === Infinity) continue;
      if (near[s]) {
        let w = wobblers[s];
        if (!w) {
          w = wobblers[s] = factory(skins[s]);
          scene.add(w.object3d);
        }
        posBuf[0] = px[s]!;
        posBuf[1] = py[s]!;
        posBuf[2] = pz[s]!;
        pose.yaw = yaw[s]!;
        pose.anim = anim[s]!;
        pose.speed = speed[s]!;
        w.setPose(pose, dt);
        tagIdx[t++] = s;
      } else {
        writeTRS(farM, f * 16, px[s]!, py[s]!, pz[s]!, yaw[s]!, 1);
        const c = s * 9;
        const o = f * 3;
        aP[o] = colors[c]!;
        aP[o + 1] = colors[c + 1]!;
        aP[o + 2] = colors[c + 2]!;
        aB[o] = colors[c + 3]!;
        aB[o + 1] = colors[c + 4]!;
        aB[o + 2] = colors[c + 5]!;
        aL[o] = colors[c + 6]!;
        aL[o + 1] = colors[c + 7]!;
        aL[o + 2] = colors[c + 8]!;
        aA[o] = anim[s]!;
        aA[o + 1] = phase[s]!;
        aA[o + 2] = speed[s]!;
        f++;
      }
      // Airborne players cast a smaller shadow; without ground queries it stays at the feet.
      writeTRS(shM, sh * 16, px[s]!, py[s]! + 0.02, pz[s]!, 0, grounded[s] ? SHADOW_SIZE : SHADOW_SIZE * 0.7);
      sh++;
    }
    wasNear.set(near);

    farMesh.count = f;
    shadowMesh.count = sh;
    if (f > 0) {
      farMesh.instanceMatrix.needsUpdate = true;
      iPrimary.needsUpdate = iBelly.needsUpdate = iLimbs.needsUpdate = iAnim.needsUpdate = true;
    }
    if (sh > 0) shadowMesh.instanceMatrix.needsUpdate = true;

    // Name tags for the nearest near-tier players.
    if (t > 1) sortRange(tagIdx, dist2, 0, t - 1);
    const shown = Math.min(t, tags.length);
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i]!;
      if (i >= shown) {
        tag.sprite.visible = false;
        tag.owner = -1;
        continue;
      }
      const s = tagIdx[i]!;
      tag.owner = s;
      drawTag(tag, names[s]!);
      tag.sprite.position.set(px[s]!, py[s]! + TAG_HEIGHT, pz[s]!);
      tag.sprite.visible = true;
    }

    stat.players = pool.size;
    stat.near = nearCount;
    stat.far = f;
    stat.hidden = hidden;
    stat.tags = shown;
  }

  function dispose(): void {
    for (let s = 0; s < max; s++) dropWobbler(s);
    farMesh.removeFromParent();
    shadowMesh.removeFromParent();
    farMesh.dispose();
    shadowMesh.dispose();
    farGeo.dispose(); // shared LOD attributes simply re-upload if the LOD mesh is drawn again
    far.material.dispose();
    shadowGeo.dispose();
    shadowMat.alphaMap?.dispose();
    shadowMat.dispose();
    for (const tag of tags) {
      tag.sprite.removeFromParent();
      tag.tex.dispose();
      tag.sprite.material.dispose();
    }
    tags.length = 0;
  }

  return {
    setPlayers,
    setSkin,
    update,
    stats: () => stat,
    farMesh,
    shadowMesh,
    dispose,
  };
}
