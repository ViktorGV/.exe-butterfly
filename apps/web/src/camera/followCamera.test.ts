import { describe, expect, it } from 'bun:test';
import type { Vec3 } from '@wobble/shared/types';
import { createFollowCamera, FOLLOW_DEFAULTS, type CameraLike, type FollowCameraOptions } from './followCamera.ts';

interface FakeCamera extends CameraLike {
  pos: Vec3;
  look: Vec3;
  projections: number;
}

function fakeCamera(aspect = 16 / 9): FakeCamera {
  const cam: FakeCamera = {
    pos: [0, 0, 0],
    look: [0, 0, 0],
    projections: 0,
    fov: 50,
    aspect,
    position: {
      set(x: number, y: number, z: number) {
        cam.pos[0] = x;
        cam.pos[1] = y;
        cam.pos[2] = z;
      },
    },
    lookAt(x: number, y: number, z: number) {
      cam.look[0] = x;
      cam.look[1] = y;
      cam.look[2] = z;
    },
    updateProjectionMatrix() {
      cam.projections++;
    },
  };
  return cam;
}

function setup(options: FollowCameraOptions = {}, aspect?: number) {
  const camera = fakeCamera(aspect);
  const rig = createFollowCamera(camera, { orbitTarget: null, reducedMotion: false, ...options });
  return { camera, rig };
}

const dist = (a: Readonly<Vec3>, b: Readonly<Vec3>) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const ZERO: Vec3 = [0, 0, 0];

/** Scripted target: runs down the course weaving left and right, jumping every second. */
function script(t: number, pos: Vec3, vel: Vec3) {
  pos[0] = 3 * Math.sin(0.9 * t);
  vel[0] = 2.7 * Math.cos(0.9 * t);
  pos[2] = -6 * t;
  vel[2] = -6;
  const ph = t % 1;
  pos[1] = 4 * ph * (1 - ph) * 1.2;
  vel[1] = 4 * (1 - 2 * ph) * 1.2;
}

describe('follow camera', () => {
  it('uses the shared yaw convention: yaw 0 sits behind the player on +Z, looking toward -Z', () => {
    const { camera, rig } = setup();
    rig.snapTo([0, 0, 0], 0);
    expect(rig.yaw).toBe(0);
    expect(camera.pos[2]).toBeGreaterThan(4);
    expect(Math.abs(camera.pos[0])).toBeLessThan(1e-9);
    expect(camera.pos[1]).toBeGreaterThan(1);
    expect(camera.look[2]).toBeLessThan(0);
    rig.snapTo([0, 0, 0], Math.PI / 2); // forward = (-1, 0, 0): camera sits on +X
    expect(camera.pos[0]).toBeGreaterThan(4);
    expect(camera.look[0]).toBeLessThan(0);
  });

  it('converges on a moved target, critically damped, with no overshoot beyond 2%', () => {
    for (const hz of [30, 60, 144]) {
      const { rig } = setup();
      rig.snapTo([0, 0, 0], 0);
      const target: Vec3 = [3, 0, 0];
      let maxX = 0;
      for (let i = 0; i < hz * 2; i++) {
        rig.update(target, ZERO, 1 / hz);
        maxX = Math.max(maxX, rig.focus[0]);
      }
      expect(maxX).toBeLessThanOrEqual(3 * 1.02);
      expect(Math.abs(rig.focus[0] - 3)).toBeLessThan(0.01);
    }
  });

  it('is frame-rate independent: within 1 cm after 5 s at 30, 60 and 144 Hz', () => {
    const finals = [30, 60, 144].map((hz) => {
      const { camera, rig } = setup();
      const pos: Vec3 = [0, 0, 0];
      const vel: Vec3 = [0, 0, 0];
      script(0, pos, vel);
      rig.snapTo(pos, 0.4);
      const steps = hz * 5;
      for (let i = 1; i <= steps; i++) {
        script(i / hz, pos, vel);
        rig.update(pos, vel, 1 / hz);
      }
      return { pos: [...camera.pos] as Vec3, look: [...camera.look] as Vec3, yaw: rig.yaw };
    });
    for (const f of finals) {
      expect(dist(f.pos, finals[1].pos)).toBeLessThan(0.01);
      expect(dist(f.look, finals[1].look)).toBeLessThan(0.01);
    }
  });

  it('snapTo cuts to the new pose with no swoosh and stays put', () => {
    const { camera, rig } = setup();
    rig.snapTo([0, 0, 0], 0);
    for (let i = 0; i < 60; i++) rig.update([0, 0, -i * 0.1], [0, 0, -6], 1 / 60);
    rig.snapTo([50, 2, -80], 1);
    const snapped = [...camera.pos] as Vec3;
    expect(rig.yaw).toBe(1);
    expect(dist(rig.focus, [50, 2 + FOLLOW_DEFAULTS.focusHeight, -80])).toBeLessThan(1e-9);
    rig.update([50, 2, -80], ZERO, 1 / 60);
    expect(dist(camera.pos, snapped)).toBeLessThan(1e-6);
  });

  it('does not turn or shift the view when the player strafes (the defaults)', () => {
    const { rig } = setup();
    rig.snapTo([0, 0, 0], 0);
    const pos: Vec3 = [0, 0, 0];
    for (let i = 0; i < 60 * 3; i++) {
      pos[0] += 0.1; // running sideways at 6 m/s
      rig.update(pos, [6, 0, 0], 1 / 60);
    }
    expect(rig.yaw).toBe(0);
    // Centred on the player, not ahead of them.
    expect(Math.abs(rig.focus[0] - pos[0])).toBeLessThan(1.5);
  });

  it('auto-rotates toward the direction of travel when enabled, but not while the player is orbiting', () => {
    const { rig } = setup({ autoRotateRate: 1.4 });
    rig.snapTo([0, 0, 0], 0);
    const pos: Vec3 = [0, 0, 0];
    const vel: Vec3 = [6, 0, 0]; // heading +X is yaw -PI/2
    for (let i = 0; i < 60 * 4; i++) {
      pos[0] += 0.1;
      rig.update(pos, vel, 1 / 60);
    }
    expect(rig.yaw).toBeCloseTo(-Math.PI / 2, 1);

    rig.orbit(1, 0);
    const held = rig.yaw;
    for (let i = 0; i < 60; i++) {
      pos[0] += 0.1;
      rig.update(pos, vel, 1 / 60);
    }
    expect(rig.yaw).toBe(held);
    for (let i = 0; i < 60 * 5; i++) {
      pos[0] += 0.1;
      rig.update(pos, vel, 1 / 60);
    }
    expect(rig.yaw).toBeCloseTo(-Math.PI / 2, 1);
  });

  it('does not spin around when the player runs back toward the camera', () => {
    const { rig } = setup();
    rig.snapTo([0, 0, 0], 0);
    const pos: Vec3 = [0, 0, 0];
    for (let i = 0; i < 120; i++) {
      pos[2] += 0.1;
      rig.update(pos, [0, 0, 6], 1 / 60);
    }
    expect(Math.abs(rig.yaw)).toBeLessThan(1e-9);
  });

  it('clamps pitch on drag-to-orbit and right-stick look', () => {
    const { rig } = setup();
    rig.snapTo([0, 0, 0], 0);
    rig.orbit(0, 10);
    expect(rig.pitch).toBe(FOLLOW_DEFAULTS.pitchMax);
    rig.orbit(0, -10);
    expect(rig.pitch).toBe(FOLLOW_DEFAULTS.pitchMin);
    rig.setLookAxis(0, -1); // stick down looks down: camera rises
    for (let i = 0; i < 120; i++) rig.update(ZERO, ZERO, 1 / 60);
    expect(rig.pitch).toBe(FOLLOW_DEFAULTS.pitchMax);
    rig.setLookAxis(1, 0); // stick right turns right: yaw decreases
    const y0 = rig.yaw;
    rig.update(ZERO, ZERO, 0.1);
    expect(rig.yaw).toBeCloseTo(y0 - FOLLOW_DEFAULTS.lookSpeed * 0.1, 9);
  });

  it('spectates a provider with a smooth hand-over and hands back', () => {
    const { camera, rig } = setup({ lookAheadTime: 0.3 });
    rig.snapTo([0, 0, 0], 0);
    const other = { pos: [20, 0, -30] as Vec3 };
    rig.follow(other);
    expect(rig.spectating).toBe(true);
    let prev = [...camera.pos] as Vec3;
    let maxStep = 0;
    for (let i = 0; i < 60 * 2.5; i++) {
      rig.update([0, 0, 0], ZERO, 1 / 60);
      const step = dist(camera.pos, prev);
      if (i === 0) expect(step).toBeLessThan(0.05); // eases out of the old pose
      maxStep = Math.max(maxStep, step);
      prev = [...camera.pos] as Vec3;
    }
    // ~36 m over a 0.9 s ease: never a cut.
    expect(maxStep).toBeLessThan(1.5);
    expect(dist(rig.focus, [20, FOLLOW_DEFAULTS.focusHeight, -30])).toBeLessThan(0.01);

    // A moving spectated target with no velocity is still followed, with look-ahead estimated.
    for (let i = 0; i < 120; i++) {
      other.pos[2] -= 0.1;
      rig.update(ZERO, ZERO, 1 / 60);
    }
    expect(rig.focus[2]).toBeLessThan(other.pos[2]);

    rig.follow(null);
    expect(rig.spectating).toBe(false);
    for (let i = 0; i < 60 * 3; i++) rig.update([1, 0, 1], ZERO, 1 / 60);
    expect(dist(rig.focus, [1, FOLLOW_DEFAULTS.focusHeight, 1])).toBeLessThan(0.01);
  });

  it('holds position while a function provider has no target', () => {
    const { rig } = setup();
    rig.snapTo([0, 0, 0], 0);
    let present = true;
    rig.follow((out) => {
      if (!present) return false;
      out[0] = 5;
      out[1] = 0;
      out[2] = 0;
      return true;
    });
    for (let i = 0; i < 180; i++) rig.update(ZERO, ZERO, 1 / 60);
    present = false;
    for (let i = 0; i < 60; i++) rig.update(ZERO, ZERO, 1 / 60);
    expect(rig.focus[0]).toBeCloseTo(5, 2);
  });

  it('plays an intro along the path that ends exactly at the follow pose', async () => {
    const { camera, rig } = setup();
    const ref = setup();
    const spawn: Vec3 = [0, 0, 0];
    rig.snapTo(spawn, 0);
    ref.rig.snapTo(spawn, 0);
    const points: Vec3[] = [
      [0, 30, -120],
      [25, 20, -60],
      [10, 10, -10],
    ];
    let done = false;
    const intro = rig.playIntro(points, 2000).then(() => {
      done = true;
    });
    expect(rig.introPlaying).toBe(true);
    rig.update(spawn, ZERO, 1 / 60);
    ref.rig.update(spawn, ZERO, 1 / 60);
    expect(dist(camera.pos, points[0])).toBeLessThan(0.1);
    let prev = [...camera.pos] as Vec3;
    let landingStep = -1;
    for (let i = 1; i < 125; i++) {
      const was = rig.introPlaying;
      rig.update(spawn, ZERO, 1 / 60);
      ref.rig.update(spawn, ZERO, 1 / 60);
      if (was && !rig.introPlaying) landingStep = dist(camera.pos, prev);
      prev = [...camera.pos] as Vec3;
    }
    await intro;
    expect(done).toBe(true);
    expect(rig.introPlaying).toBe(false);
    expect(dist(camera.pos, ref.camera.pos)).toBeLessThan(1e-9);
    expect(dist(camera.look, ref.camera.look)).toBeLessThan(1e-9);
    expect(landingStep).toBeGreaterThanOrEqual(0);
    expect(landingStep).toBeLessThan(0.01); // eased in: no pop on landing
  });

  it('cancelIntro resolves the intro and returns to the follow pose', async () => {
    const { camera, rig } = setup();
    rig.snapTo(ZERO, 0);
    const follow = [...camera.pos];
    const p = rig.playIntro([[0, 50, -50]], 5000);
    rig.update(ZERO, ZERO, 1 / 60);
    rig.cancelIntro();
    await p;
    rig.update(ZERO, ZERO, 1 / 60);
    expect(dist(camera.pos, follow as Vec3)).toBeLessThan(1e-6);
    await rig.playIntro([], 1000); // nothing to fly: resolves at once
  });

  it('pulls back and widens in portrait compared with landscape', () => {
    const land = setup({}, 16 / 9);
    const port = setup({}, 9 / 19.5);
    land.rig.snapTo(ZERO, 0);
    port.rig.snapTo(ZERO, 0);
    expect(dist(port.camera.pos, port.rig.focus)).toBeGreaterThan(dist(land.camera.pos, land.rig.focus) * 1.25);
    expect(port.camera.pos[1]).toBeGreaterThan(land.camera.pos[1]);
    expect(port.camera.fov).toBeGreaterThan(land.camera.fov);
    // Rotating the phone eases into the new framing instead of popping.
    land.camera.aspect = 9 / 19.5;
    const before = dist(land.camera.pos, land.rig.focus);
    land.rig.update(ZERO, ZERO, 1 / 60);
    const after = dist(land.camera.pos, land.rig.focus);
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeLessThan(0.2);
  });

  it('kicks the FOV on dive and dips on landing, except under reduced motion', () => {
    const { camera, rig } = setup();
    rig.snapTo(ZERO, 0);
    const fov0 = camera.fov;
    const y0 = camera.pos[1];
    rig.kick('dive');
    rig.kick('land');
    let maxFov = 0;
    let minY = Infinity;
    for (let i = 0; i < 30; i++) {
      rig.update(ZERO, ZERO, 1 / 60);
      maxFov = Math.max(maxFov, camera.fov);
      minY = Math.min(minY, camera.pos[1]);
    }
    expect(maxFov - fov0).toBeGreaterThan(FOLLOW_DEFAULTS.diveFovKick * 0.9);
    expect(y0 - minY).toBeGreaterThan(FOLLOW_DEFAULTS.landDip * 0.9);
    for (let i = 0; i < 120; i++) rig.update(ZERO, ZERO, 1 / 60);
    expect(camera.fov).toBeCloseTo(fov0, 2);

    const calm = setup({ reducedMotion: true });
    calm.rig.snapTo(ZERO, 0);
    const f = calm.camera.fov;
    const y = calm.camera.pos[1];
    calm.rig.kick('dive');
    calm.rig.kick('land');
    for (let i = 0; i < 30; i++) {
      calm.rig.update(ZERO, ZERO, 1 / 60);
      expect(calm.camera.fov).toBe(f);
      expect(calm.camera.pos[1]).toBeCloseTo(y, 9);
    }
  });

  it('only updates the projection matrix when the FOV changes', () => {
    const { camera, rig } = setup();
    rig.snapTo(ZERO, 0);
    const n = camera.projections;
    for (let i = 0; i < 60; i++) rig.update(ZERO, ZERO, 1 / 60);
    expect(camera.projections).toBe(n);
  });

  it('snaps on the first update instead of flying in from the origin', () => {
    const { rig } = setup();
    rig.update([100, 0, -100], ZERO, 1 / 60);
    expect(dist(rig.focus, [100, FOLLOW_DEFAULTS.focusHeight, -100])).toBeLessThan(1e-9);
  });
});
