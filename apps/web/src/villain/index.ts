// The villain boss (#84), client side: the boss itself, a red circle on the floor where each throw will
// land, and the obstacle flying in from the boss. Drawn from `throw` messages; the server decides who is
// hit (only marked players) and tells the target with `hit`, so this module is purely visual.
//
//   const villain = createVillainView({ scene });
//   session.on('throw', (m) => { villain.setBoss(bossPos); villain.throwAt(m, floorY, session.serverNow()); });
//   engine.onRender((_a, dt) => villain.update(session.serverNow(), dt));
//   villain.reset(); // race over or left the room
//
// Pooled: a fixed number of circles and obstacles are built once; nothing is allocated per frame or per throw.
import * as THREE from 'three';
import { Anim, BUTTERFLY } from '@wobble/shared/constants';
import type { SkinDef } from '@wobble/shared/types';
import { createWobbler, type Wobbler } from '../character/index.ts';

/** Most throws that can be in flight at once (a volley of up to 4 per marked player, a round every 1-3 s). */
export const MAX_THROWS = 48;
const BOSS_SCALE = 3;
/** How high the obstacle arcs above a straight line from the boss to the impact, metres. */
const ARC_HEIGHT = 5;
/** The circle expands and fades for this long after the obstacle lands. */
const SPLASH_MS = 300;
const START_HEIGHT = 8;

export interface ThrowInfo {
  n: number;
  target: number;
  /** impact point on the floor (x, z) */
  pos: readonly [number, number];
  /** server clock, ms */
  landAt: number;
}

export interface VillainView {
  /** Show the boss standing at `feetPos` (idempotent). */
  setBoss(feetPos: readonly [number, number, number]): void;
  /** A `throw` arrived. `floorY` is the floor height at the impact, `nowServerMs` the synced server time. */
  throwAt(info: ThrowInfo, floorY: number, nowServerMs: number): void;
  update(nowServerMs: number, frameDt: number): void;
  /** Hide the boss and drop every throw in flight. */
  reset(): void;
  readonly bossVisible: boolean;
  /** Number of throws currently drawn (warning or splash). */
  readonly activeCount: number;
  dispose(): void;
}

/** A purple horned bully: the generic villain used when the theme does not bring its own. */
export const VILLAIN_SKIN: SkinDef = {
  version: 1,
  name: 'Grumble',
  body: {
    color: '#5b2a86',
    belly: '#c9a6f0',
    pattern: { type: 'dots', colors: ['#5b2a86', '#7a3fb0'], scale: 1 },
    height: 1.1,
    girth: 1.15,
  },
  face: { eyes: 'wide', eyeColor: '#ffeb3b', mouth: 'flat', cheeks: '#8e3ab5' },
  limbs: { color: '#43206a' },
  accessories: [
    {
      anchor: 'headTop',
      prims: [
        { shape: 'cone', pos: [-0.16, 0.2, 0], rot: [0, 0, 0.35], scale: [0.14, 0.4, 0.14], color: '#ffeb3b' },
        { shape: 'cone', pos: [0.16, 0.2, 0], rot: [0, 0, -0.35], scale: [0.14, 0.4, 0.14], color: '#ffeb3b' },
      ],
    },
  ],
};

/**
 * Where the obstacle is, `u` (0..1) of the way from `from` to `to`, on a parabola arcing `height` above the
 * straight line. Writes into `out` and returns it. Pure.
 */
export function arcPosition(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  u: number,
  height: number,
  out: [number, number, number],
): [number, number, number] {
  const k = u < 0 ? 0 : u > 1 ? 1 : u;
  out[0] = from[0] + (to[0] - from[0]) * k;
  out[1] = from[1] + (to[1] - from[1]) * k + 4 * height * k * (1 - k);
  out[2] = from[2] + (to[2] - from[2]) * k;
  return out;
}

interface Slot {
  active: boolean;
  startAt: number;
  landAt: number;
  from: [number, number, number];
  to: [number, number, number];
  ring: THREE.Mesh;
  ball: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
}

export function createVillainView(opts: { scene: THREE.Object3D; skin?: SkinDef }): VillainView {
  const { scene } = opts;
  const group = new THREE.Group();
  group.visible = true;
  scene.add(group);

  const ringGeo = new THREE.RingGeometry(BUTTERFLY.THROW_RADIUS_M * 0.62, BUTTERFLY.THROW_RADIUS_M, 40);
  ringGeo.rotateX(-Math.PI / 2); // lie flat on the floor
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xff2a2a,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    toneMapped: false, // stay a vivid warning red under any lighting
    side: THREE.DoubleSide,
  });
  const ballGeo = new THREE.SphereGeometry(1, 16, 12);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.5 });

  const slots: Slot[] = [];
  for (let i = 0; i < MAX_THROWS; i++) {
    const mat = ringMat.clone(); // own opacity per circle: a landing one fades without dimming the others
    const ring = new THREE.Mesh(ringGeo, mat);
    const ball = new THREE.Mesh(ballGeo, ballMat);
    ball.scale.setScalar(0.9);
    ring.visible = false;
    ball.visible = false;
    group.add(ring, ball);
    slots.push({ active: false, startAt: 0, landAt: 0, from: [0, 0, 0], to: [0, 0, 0], ring, ball, mat });
  }

  let boss: Wobbler | null = null;
  let bossShown = false;
  const bossPos: [number, number, number] = [0, 0, 0];
  const bossPose = { pos: bossPos, yaw: Math.PI, anim: Anim.IDLE as number, speed: 0 };
  const tmp: [number, number, number] = [0, 0, 0];
  let nextSlot = 0;
  let active = 0;

  function hide(s: Slot) {
    if (!s.active) return;
    s.active = false;
    s.ring.visible = false;
    s.ball.visible = false;
    active--;
  }

  return {
    setBoss(feetPos) {
      bossPos[0] = feetPos[0];
      bossPos[1] = feetPos[1];
      bossPos[2] = feetPos[2];
      if (!boss) {
        boss = createWobbler(opts.skin ?? VILLAIN_SKIN);
        boss.object3d.scale.setScalar(BOSS_SCALE);
        group.add(boss.object3d);
      }
      boss.object3d.visible = true;
      bossShown = true;
    },
    throwAt(info, floorY, nowServerMs) {
      // Reuse the oldest slot when the pool is full: a stale throw is long gone from the screen anyway.
      let s: Slot | undefined;
      for (let k = 0; k < MAX_THROWS; k++) {
        const c = slots[(nextSlot + k) % MAX_THROWS]!;
        if (!c.active) {
          s = c;
          nextSlot = (nextSlot + k + 1) % MAX_THROWS;
          break;
        }
      }
      if (!s) {
        s = slots[nextSlot]!;
        nextSlot = (nextSlot + 1) % MAX_THROWS;
        hide(s);
      }
      s.active = true;
      active++;
      s.startAt = nowServerMs;
      s.landAt = Math.max(info.landAt, nowServerMs + 1);
      // Flies in from the boss when there is one, otherwise from straight above.
      if (bossShown) {
        s.from[0] = bossPos[0];
        s.from[1] = bossPos[1] + 2.5 * BOSS_SCALE;
        s.from[2] = bossPos[2];
      } else {
        s.from[0] = info.pos[0];
        s.from[1] = floorY + START_HEIGHT;
        s.from[2] = info.pos[1];
      }
      s.to[0] = info.pos[0];
      s.to[1] = floorY + 0.9;
      s.to[2] = info.pos[1];
      s.ring.position.set(info.pos[0], floorY + 0.06, info.pos[1]);
      s.ring.scale.setScalar(1);
      s.ring.visible = true;
      s.ball.visible = true;
    },
    update(nowServerMs, frameDt) {
      const pulse = 0.7 + 0.3 * Math.sin(nowServerMs * 0.012);
      for (let i = 0; i < MAX_THROWS; i++) {
        const s = slots[i]!;
        if (!s.active) continue;
        const span = Math.max(1, s.landAt - s.startAt);
        const u = (nowServerMs - s.startAt) / span;
        if (u < 1) {
          arcPosition(s.from, s.to, u, ARC_HEIGHT, tmp);
          s.ball.position.set(tmp[0], tmp[1], tmp[2]);
          s.ball.rotation.x += frameDt * 6;
          s.mat.opacity = pulse;
          continue;
        }
        // Landed: the obstacle is gone, the circle bursts outward and fades.
        const splash = (nowServerMs - s.landAt) / SPLASH_MS;
        if (splash >= 1) {
          hide(s);
          continue;
        }
        s.ball.visible = false;
        s.ring.scale.setScalar(1 + splash * 0.6);
        s.mat.opacity = 0.8 * (1 - splash);
      }
      if (boss && bossShown) boss.setPose(bossPose, frameDt);
    },
    reset() {
      for (const s of slots) hide(s);
      active = 0;
      bossShown = false;
      if (boss) boss.object3d.visible = false;
    },
    get bossVisible() {
      return bossShown;
    },
    get activeCount() {
      return active;
    },
    dispose() {
      scene.remove(group);
      boss?.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      for (const s of slots) s.mat.dispose();
      ballGeo.dispose();
      ballMat.dispose();
    },
  };
}
