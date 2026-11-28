// The hero's bridge (#84): players who saved others and never pushed get a glowing bridge across the final
// snow-blower field, where the fans' wind does not push them. It is drawn only on their own screen (the server
// sends `hero` to that player alone), so for everyone else the final section is unchanged.
//
//   const bridge = createHeroBridge({ scene });
//   session.on('hero', () => { const span = bridgeSpan(course); if (span) bridge.open(span, nowMs); });
//   engine.onRender(() => bridge.update(nowMs));
//   bridge.close(); // race over or left the room
//
// Static meshes built once; nothing is allocated per frame.
import * as THREE from 'three';
import type { CourseDef } from '@wobble/shared/types';

/** Half the width of the bridge lane, metres: wide enough to walk without hugging the middle. */
export const BRIDGE_HALF_WIDTH = 2.2;
/** The bridge unrolls from the start of the field over this long, ms. */
const UNROLL_MS = 700;

export interface BridgeSpan {
  /** Where the bridge starts (nearest the player coming from the start) and ends, world z. */
  z0: number;
  z1: number;
  /** Floor height, metres. */
  y: number;
}

/**
 * The stretch of floor the bridge covers: the whole snow-blower field, found from the fans. `null` when
 * the course has no fans (the hero then has nothing to shelter you from).
 */
export function bridgeSpan(course: Pick<CourseDef, 'entities'>): BridgeSpan | null {
  let z0 = Number.NEGATIVE_INFINITY;
  let z1 = Number.POSITIVE_INFINITY;
  let y = 0;
  let found = false;
  for (const e of course.entities ?? []) {
    if (e.kind !== 'snowBlower') continue;
    const w = typeof e.params.width === 'number' ? e.params.width : 6;
    z0 = Math.max(z0, e.pos[2] + w / 2);
    z1 = Math.min(z1, e.pos[2] - w / 2);
    y = e.pos[1];
    found = true;
  }
  return found ? { z0, z1, y } : null;
}

export interface HeroBridge {
  /** Unroll the bridge over `span`, starting at `nowMs`. */
  open(span: BridgeSpan, nowMs: number): void;
  /** Hide it again. */
  close(): void;
  update(nowMs: number): void;
  readonly isOpen: boolean;
  /** 0..1: how much of the bridge has unrolled. */
  readonly unrolled: number;
  dispose(): void;
}

export function createHeroBridge(opts: { scene: THREE.Object3D }): HeroBridge {
  const { scene } = opts;
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const deckGeo = new THREE.BoxGeometry(BRIDGE_HALF_WIDTH * 2, 0.08, 1);
  const railGeo = new THREE.BoxGeometry(0.16, 0.22, 1);
  const deckMat = new THREE.MeshBasicMaterial({
    color: 0xffd23f,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    toneMapped: false, // stays a vivid gold under any lighting
  });
  const railMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  const railL = new THREE.Mesh(railGeo, railMat);
  const railR = new THREE.Mesh(railGeo, railMat);
  railL.position.x = -BRIDGE_HALF_WIDTH;
  railR.position.x = BRIDGE_HALF_WIDTH;
  // children share the group's z scale (the unroll); x and y are untouched
  group.add(deck, railL, railR);

  let open = false;
  let span: BridgeSpan = { z0: 0, z1: 0, y: 0 };
  let startedAt = 0;
  let unrolled = 0;

  return {
    open(s, nowMs) {
      span = { z0: s.z0, z1: s.z1, y: s.y };
      startedAt = nowMs;
      unrolled = 0;
      open = true;
      group.visible = true;
      group.position.set(0, s.y + 0.05, s.z0);
      group.scale.set(1, 1, 0.001);
    },
    close() {
      open = false;
      unrolled = 0;
      group.visible = false;
    },
    update(nowMs) {
      if (!open) return;
      const length = Math.max(0.001, span.z0 - span.z1);
      const p = Math.min(1, Math.max(0, (nowMs - startedAt) / UNROLL_MS));
      unrolled = p;
      const e = 1 - (1 - p) * (1 - p); // ease out
      // The group sits at the start of the field and grows toward the end (-Z): scale about its own origin,
      // with the meshes offset by half a unit so the near end stays put.
      group.scale.z = Math.max(0.001, length * e);
      deck.position.z = -0.5;
      railL.position.z = -0.5;
      railR.position.z = -0.5;
      deckMat.opacity = 0.8 + 0.1 * Math.sin(nowMs * 0.006);
    },
    get isOpen() {
      return open;
    },
    get unrolled() {
      return unrolled;
    },
    dispose() {
      scene.remove(group);
      deckGeo.dispose();
      railGeo.dispose();
      deckMat.dispose();
      railMat.dispose();
    },
  };
}
