// Knock-down effects (#84): makes a push obvious to everyone in the race. When any player (you or a remote)
// goes down, a "POW!" pops over their head, and spinning dizzy stars circle them while they lie there,
// which invites friends to help them up. Driven only by the KNOCKED animation in snapshots, so no new
// messages. Sprites are pooled and textures drawn once; nothing is allocated per frame.
import * as THREE from 'three';
import { Anim } from '@wobble/shared/constants';
import type { RemoteState, Vec3 } from '@wobble/shared/types';

export const MAX_DOWNED = 24;
export const MAX_POWS = 8;
export const POW_SEC = 0.6;
const STARS = 3;
const STAR_RADIUS_M = 0.55;
const STAR_HEIGHT_M = 1.0;
const POW_HEIGHT_M = 1.9;
/** id used for the local player (remote ids are >= 0) */
export const SELF_ID = -1;

function canvasTexture(draw: (g: CanvasRenderingContext2D, size: number) => void, size = 128): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture(); // tests and headless runs: nothing to draw on
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number, points: number) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  g.closePath();
}

function drawPow(g: CanvasRenderingContext2D, s: number) {
  starPath(g, s / 2, s / 2, s * 0.48, s * 0.3, 12);
  g.fillStyle = '#ffd23f';
  g.fill();
  g.lineWidth = s * 0.04;
  g.strokeStyle = '#1d1b2f';
  g.stroke();
  g.font = `900 ${Math.round(s * 0.26)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = s * 0.05;
  g.strokeStyle = '#1d1b2f';
  g.strokeText('POW!', s / 2, s / 2 + s * 0.02);
  g.fillStyle = '#ff4d6d';
  g.fillText('POW!', s / 2, s / 2 + s * 0.02);
}

function drawStar(g: CanvasRenderingContext2D, s: number) {
  starPath(g, s / 2, s / 2, s * 0.46, s * 0.2, 5);
  g.fillStyle = '#fff3a0';
  g.fill();
  g.lineWidth = s * 0.06;
  g.strokeStyle = '#e0a800';
  g.stroke();
}

export interface KnockFx {
  /**
   * Call once per frame. `remote` are the other players, `self` the local player's drawn feet and animation.
   * Returns how many players are down (for tests and debugging).
   */
  update(
    tSec: number,
    remote: ReadonlyMap<number, RemoteState> | null,
    selfFeet: Readonly<Vec3>,
    selfAnim: number,
  ): number;
  reset(): void;
  dispose(): void;
}

export function createKnockFx({ scene }: { scene: THREE.Object3D }): KnockFx {
  const powTex = canvasTexture(drawPow);
  const starTex = canvasTexture(drawStar, 64);
  const powMat = new THREE.SpriteMaterial({ map: powTex, depthTest: false, transparent: true });
  const starMat = new THREE.SpriteMaterial({ map: starTex, depthTest: false, transparent: true });

  const root = new THREE.Group();
  root.name = 'knockFx';
  scene.add(root);

  // dizzy stars: STARS sprites per downed player
  const starGroups: THREE.Group[] = [];
  for (let i = 0; i < MAX_DOWNED; i++) {
    const grp = new THREE.Group();
    for (let k = 0; k < STARS; k++) {
      const sp = new THREE.Sprite(starMat);
      sp.scale.setScalar(0.32);
      sp.renderOrder = 10;
      grp.add(sp);
    }
    grp.visible = false;
    root.add(grp);
    starGroups.push(grp);
  }
  // POW bursts: each needs its own material for its own fade
  const pows: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; born: number; id: number }[] = [];
  for (let i = 0; i < MAX_POWS; i++) {
    const mat = powMat.clone();
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.renderOrder = 11;
    root.add(sprite);
    pows.push({ sprite, mat, born: -Infinity, id: 0 });
  }
  let nextPow = 0;

  /** last seen "down" state per player id */
  const wasDown = new Map<number, boolean>();
  /** where each live POW should follow */
  const feetOf = new Map<number, Readonly<Vec3>>();

  function pop(id: number, t: number) {
    const p = pows[nextPow]!;
    nextPow = (nextPow + 1) % MAX_POWS;
    p.born = t;
    p.id = id;
    p.sprite.visible = true;
  }

  function track(id: number, feet: Readonly<Vec3>, anim: number, t: number, slot: number): number {
    const down = anim === Anim.KNOCKED;
    const before = wasDown.get(id) === true;
    if (down !== before) wasDown.set(id, down);
    if (down && !before) pop(id, t);
    if (down) feetOf.set(id, feet);
    if (!down || slot >= MAX_DOWNED) return slot;
    const grp = starGroups[slot]!;
    grp.visible = true;
    grp.position.set(feet[0], feet[1] + STAR_HEIGHT_M, feet[2]);
    const spin = t * 5 + id;
    for (let k = 0; k < STARS; k++) {
      const a = spin + (k / STARS) * Math.PI * 2;
      grp.children[k]!.position.set(
        Math.cos(a) * STAR_RADIUS_M,
        Math.sin(t * 6 + k) * 0.08,
        Math.sin(a) * STAR_RADIUS_M,
      );
    }
    return slot + 1;
  }

  return {
    update(t, remote, selfFeet, selfAnim) {
      let slot = track(SELF_ID, selfFeet, selfAnim, t, 0);
      if (remote) for (const [id, r] of remote) slot = track(id, r.pos, r.anim, t, slot);
      const downed = slot;
      for (; slot < MAX_DOWNED; slot++) starGroups[slot]!.visible = false;
      for (const p of pows) {
        if (!p.sprite.visible) continue;
        const u = (t - p.born) / POW_SEC;
        const feet = feetOf.get(p.id);
        if (u >= 1 || u < 0 || !feet) {
          p.sprite.visible = false;
          continue;
        }
        // pop in big, settle, then fade and drift up
        const grow = u < 0.25 ? 0.6 + (u / 0.25) * 0.9 : 1.5 - (u - 0.25) * 0.4;
        p.sprite.scale.setScalar(grow);
        p.sprite.position.set(feet[0], feet[1] + POW_HEIGHT_M + u * 0.4, feet[2]);
        p.mat.opacity = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
      }
      return downed;
    },
    reset() {
      wasDown.clear();
      feetOf.clear();
      for (const g of starGroups) g.visible = false;
      for (const p of pows) p.sprite.visible = false;
    },
    dispose() {
      scene.remove(root);
      powTex.dispose();
      starTex.dispose();
      powMat.dispose();
      starMat.dispose();
      for (const p of pows) p.mat.dispose();
    },
  };
}
