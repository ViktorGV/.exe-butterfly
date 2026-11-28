// Final podium after the race: the top three finishers stand on blocks (1st centre and highest, 2nd left,
// 3rd right) in the race scene, seen by the game camera, briefly before the results screen.
// Everything is built once and reused; nothing is allocated per frame.
import * as THREE from 'three';
import { formatTime } from '../ui/format.ts';

export interface PodiumResult {
  id: number;
  place: number;
  timeMs: number | null;
}

export interface PodiumSpot {
  id: number;
  /** Shown place (1..3); tied players share it. */
  place: number;
  /** 0 = centre, 1 = left, 2 = right. */
  spot: number;
  /** Finish time shown under the name; null when unknown. */
  timeMs: number | null;
}

/** Block heights (m) by shown place. */
export const PODIUM_HEIGHTS: readonly number[] = [1.6, 1.1, 0.7];
/** Spot x offsets (m): centre, left, right (left is −X with the camera looking toward −Z). */
export const PODIUM_X: readonly number[] = [0, -2.2, 2.2];

/**
 * Who stands where: finishers only (a null time is a DNF), best place first, ties broken by time then id.
 * Tied players share a shown place, so they stand on blocks of the same height.
 */
export function podiumPlacement(results: readonly PodiumResult[], out: PodiumSpot[] = []): PodiumSpot[] {
  out.length = 0;
  const finishers = results
    .filter((r) => r.timeMs !== null && r.place > 0)
    .sort((a, b) => a.place - b.place || a.timeMs! - b.timeMs! || a.id - b.id);
  let shown = 0;
  for (let i = 0; i < finishers.length && i < 3; i++) {
    const r = finishers[i]!;
    const prev = finishers[i - 1];
    if (!prev || prev.place !== r.place) shown = i + 1;
    out.push({ id: r.id, place: shown, spot: i, timeMs: r.timeMs });
  }
  return out;
}

export interface PodiumFigure {
  readonly object3d: THREE.Object3D;
  setPose(pose: { pos: ArrayLike<number>; yaw: number; anim: number; speed: number }, dt: number): void;
  dispose(): void;
}

export interface PodiumOptions {
  scene: THREE.Object3D;
  camera: THREE.PerspectiveCamera;
  /** Builds a character for a skin; podium figures are pooled per key from `keyOf`. */
  figure: (skin: unknown) => PodiumFigure;
  keyOf: (skin: unknown) => string;
  /** Idle animation id for the figures. */
  idleAnim: number;
  /** Where the name strip goes (absolute, bottom of the screen); omitted in tests. */
  labelRoot?: HTMLElement;
}

export interface Podium {
  /** Put the podium at `base` (feet level, centre) with these finishers on it. */
  show(
    base: ArrayLike<number>,
    spots: readonly PodiumSpot[],
    skinOf: (id: number) => unknown,
    nameOf: (id: number) => string,
  ): void;
  hide(): void;
  readonly active: boolean;
  /** Pose figures and aim the camera; call after the follow camera each frame while active. */
  update(dt: number): void;
  dispose(): void;
}

const COLORS = [0xf2c14e, 0xb8c4d6, 0xd08a52];

export function createPodium(opts: PodiumOptions): Podium {
  const root = new THREE.Group();
  root.name = 'podium';
  root.visible = false;
  opts.scene.add(root);
  const geo = new THREE.BoxGeometry(1.9, 1, 1.9);
  const mats = COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
  const blocks = [0, 1, 2].map((i) => {
    const m = new THREE.Mesh(geo, mats[i]!);
    m.castShadow = m.receiveShadow = true;
    root.add(m);
    return m;
  });
  /** Characters by skin key, reused across races. */
  const pool = new Map<string, PodiumFigure[]>();
  const used: (PodiumFigure | null)[] = [null, null, null];
  const usedKey: string[] = ['', '', ''];
  const feet: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const pose = { pos: [0, 0, 0] as number[], yaw: 0, anim: opts.idleAnim, speed: 0 };
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  let active = false;
  // Name strip in podium order (left 2nd, centre 1st, right 3rd); fits a 360 px screen.
  const strip = opts.labelRoot?.ownerDocument.createElement('div') ?? null;
  const labels: HTMLElement[] = [];
  if (strip && opts.labelRoot) {
    strip.className = 'wr-podium';
    strip.style.cssText =
      'position:absolute;left:0;right:0;bottom:16px;display:none;justify-content:center;gap:8px;' +
      'padding:0 16px;pointer-events:none;font:700 15px/1.2 system-ui,sans-serif;color:#fff;' +
      'text-shadow:0 2px 4px rgba(0,0,0,.6);text-align:center;z-index:5';
    for (const order of [1, 0, 2]) {
      const el = strip.ownerDocument.createElement('div');
      el.style.cssText = `flex:1 1 0;min-width:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;order:${order === 0 ? 1 : order === 1 ? 0 : 2}`;
      labels[order] = el;
      strip.appendChild(el);
    }
    opts.labelRoot.appendChild(strip);
  }

  function release(i: number) {
    const f = used[i];
    if (!f) return;
    root.remove(f.object3d);
    let list = pool.get(usedKey[i]!);
    if (!list) pool.set(usedKey[i]!, (list = []));
    list.push(f);
    used[i] = null;
  }

  function hide() {
    active = false;
    root.visible = false;
    if (strip) strip.style.display = 'none';
    for (let i = 0; i < 3; i++) release(i);
  }

  return {
    get active() {
      return active;
    },
    show(base, spots, skinOf, nameOf) {
      hide();
      root.position.set(base[0]!, base[1]!, base[2]!);
      for (let i = 0; i < 3; i++) {
        blocks[i]!.visible = false;
        if (labels[i]) labels[i]!.textContent = '';
      }
      for (const s of spots) {
        const h = PODIUM_HEIGHTS[s.place - 1] ?? PODIUM_HEIGHTS[2]!;
        const b = blocks[s.spot]!;
        b.visible = true;
        b.scale.y = h;
        b.position.set(PODIUM_X[s.spot]!, h / 2, 0);
        const skin = skinOf(s.id);
        const key = opts.keyOf(skin);
        const f = pool.get(key)?.pop() ?? opts.figure(skin);
        used[s.spot] = f;
        usedKey[s.spot] = key;
        root.add(f.object3d);
        const p = feet[s.spot]!;
        p[0] = PODIUM_X[s.spot]!;
        p[1] = h;
        p[2] = 0;
        if (labels[s.spot])
          labels[s.spot]!.textContent =
            `${s.place}. ${nameOf(s.id)}${s.timeMs == null ? '' : ` · ${formatTime(s.timeMs)}`}`;
      }
      active = spots.length > 0;
      root.visible = active;
      if (strip) strip.style.display = active ? 'flex' : 'none';
    },
    hide,
    update(dt) {
      if (!active) return;
      for (let i = 0; i < 3; i++) {
        const f = used[i];
        if (!f) continue;
        const p = feet[i]!;
        pose.pos[0] = p[0]!;
        pose.pos[1] = p[1]!;
        pose.pos[2] = p[2]!;
        pose.yaw = Math.PI; // face +Z, toward the camera
        f.setPose(pose, dt);
      }
      // Figures are posed in podium space; the root carries the world offset.
      const o = root.position;
      // Far enough back that all three fit a narrow (360 px) portrait screen.
      const aspect = opts.camera.aspect || 1;
      const back = aspect < 1 ? 7 + 5 * (1 - aspect) : 7;
      eye.set(o.x, o.y + 2.6, o.z + back);
      look.set(o.x, o.y + 1.6, o.z);
      opts.camera.position.copy(eye);
      opts.camera.lookAt(look);
    },
    dispose() {
      hide();
      opts.scene.remove(root);
      strip?.remove();
      for (const list of pool.values()) for (const f of list) f.dispose();
      pool.clear();
      geo.dispose();
      for (const m of mats) m.dispose();
    },
  };
}
