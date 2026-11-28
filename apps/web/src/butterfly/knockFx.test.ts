import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { Anim } from '@wobble/shared/constants';
import type { RemoteState, Vec3 } from '@wobble/shared/types';
import { createKnockFx, MAX_DOWNED, POW_SEC } from './knockFx.ts';
import { PUSH_FEEL } from './pushFeel.ts';

const remote = (anim: number, x = 0): RemoteState => ({
  pos: [x, 0, 0],
  yaw: 0,
  anim: anim as RemoteState['anim'],
  flags: 0,
});
const feet: Vec3 = [0, 0, 0];

function visiblePows(scene: THREE.Scene): number {
  let n = 0;
  scene.traverse((o) => {
    if (o instanceof THREE.Sprite && o.visible && o.renderOrder === 11) n++;
  });
  return n;
}

describe('knock-down effects', () => {
  it('pops a POW once when a player goes down, and shows stars while they stay down', () => {
    const scene = new THREE.Scene();
    const fx = createKnockFx({ scene });
    const map = new Map([[3, remote(Anim.RUN)]]);
    expect(fx.update(0, map, feet, Anim.RUN)).toBe(0);
    map.set(3, remote(Anim.KNOCKED));
    expect(fx.update(0.1, map, feet, Anim.RUN)).toBe(1);
    expect(visiblePows(scene)).toBe(1);
    fx.update(0.1 + POW_SEC + 0.01, map, feet, Anim.RUN);
    expect(visiblePows(scene)).toBe(0); // the POW is gone, the stars stay
    expect(fx.update(0.2 + POW_SEC, map, feet, Anim.RUN)).toBe(1);
    map.set(3, remote(Anim.GETUP));
    expect(fx.update(1, map, feet, Anim.RUN)).toBe(0);
    fx.dispose();
  });

  it('covers the local player too, and caps the number of starred players', () => {
    const scene = new THREE.Scene();
    const fx = createKnockFx({ scene });
    const map = new Map<number, RemoteState>();
    for (let i = 0; i < MAX_DOWNED + 5; i++) map.set(i, remote(Anim.KNOCKED, i));
    expect(fx.update(0, map, feet, Anim.KNOCKED)).toBe(MAX_DOWNED);
    fx.dispose();
  });
});

describe('push feel', () => {
  it('keeps a pushed player down long enough for a friend to come and help', () => {
    expect(PUSH_FEEL.downMs).toBeGreaterThanOrEqual(3000);
    expect(PUSH_FEEL.soloDownMs).toBeLessThan(PUSH_FEEL.downMs);
  });
});
