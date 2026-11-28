import { describe, expect, it } from 'bun:test';
import { createFollowCamera, FOLLOW_DEFAULTS, type CameraLike } from './followCamera.ts';
import { ORBIT_DEFAULTS, attachOrbitControls, dragDelta, isOnControl } from './orbitControls.ts';

/** An EventTarget that answers `closest()` like a DOM element inside (or outside) a control. */
class FakeEl extends EventTarget {
  constructor(private readonly control = false) {
    super();
  }
  captured = -1;
  closest(_sel: string) {
    return this.control ? this : null;
  }
  setPointerCapture(id: number) {
    this.captured = id;
  }
}

interface P {
  id?: number;
  type?: 'touch' | 'mouse' | 'pen';
  x: number;
  y: number;
  button?: number;
}

function fire(target: EventTarget, kind: string, p: P) {
  const e = new Event(kind, { cancelable: true });
  Object.defineProperties(e, {
    pointerId: { value: p.id ?? 1 },
    pointerType: { value: p.type ?? 'touch' },
    clientX: { value: p.x },
    clientY: { value: p.y },
    button: { value: p.button ?? 0 },
  });
  target.dispatchEvent(e);
  return e;
}

const WIDTH = 400;

function setup() {
  const calls: [number, number][] = [];
  const drags: boolean[] = [];
  const el = new FakeEl();
  const controls = attachOrbitControls({
    target: el,
    getWidth: () => WIDTH,
    onOrbit: (a, b) => calls.push([a, b]),
    onDragChange: (d) => drags.push(d),
  });
  return { el, calls, drags, controls };
}

describe('drag to orbit', () => {
  it('maps drag right to turning right and drag up to looking up', () => {
    const out: [number, number] = [0, 0];
    dragDelta(10, 0, 0.01, out);
    expect(out[0]).toBeCloseTo(-0.1, 12); // positive yaw turns left
    dragDelta(0, -10, 0.01, out);
    expect(out[1]).toBeCloseTo(-0.1, 12); // camera drops = looking up
  });

  it('orbits with one finger that starts on the right half', () => {
    const { el, calls, drags, controls } = setup();
    fire(el, 'pointerdown', { x: 300, y: 200 });
    expect(controls.dragging).toBe(true);
    expect(el.captured).toBe(1);
    fire(el, 'pointermove', { x: 320, y: 190 });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBeCloseTo(-20 * ORBIT_DEFAULTS.touchSensitivity, 12);
    expect(calls[0][1]).toBeCloseTo(-10 * ORBIT_DEFAULTS.touchSensitivity, 12);
    fire(el, 'pointerup', { x: 320, y: 190 });
    expect(controls.dragging).toBe(false);
    fire(el, 'pointermove', { x: 340, y: 190 });
    expect(calls).toHaveLength(1);
    expect(drags).toEqual([true, false]);
  });

  it('leaves the left half to the joystick and ignores the Jump / Dive buttons', () => {
    const { el, calls, controls } = setup();
    fire(el, 'pointerdown', { x: 100, y: 200 });
    fire(el, 'pointermove', { x: 150, y: 200 });
    expect(controls.dragging).toBe(false);
    expect(calls).toHaveLength(0);

    const button = new FakeEl(true);
    const c2: number[] = [];
    attachOrbitControls({ target: button, getWidth: () => WIDTH, onOrbit: (a) => c2.push(a) });
    fire(button, 'pointerdown', { x: 380, y: 380 });
    fire(button, 'pointermove', { x: 390, y: 380 });
    expect(c2).toHaveLength(0);
    expect(isOnControl({ target: button, pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 0, button: 0 })).toBe(
      true,
    );
  });

  it('keeps following the first finger while a second one is down (joystick + orbit)', () => {
    const { el, calls } = setup();
    fire(el, 'pointerdown', { id: 1, x: 300, y: 200 });
    fire(el, 'pointerdown', { id: 2, x: 350, y: 200 });
    fire(el, 'pointermove', { id: 2, x: 390, y: 200 });
    expect(calls).toHaveLength(0);
    fire(el, 'pointercancel', { id: 2, x: 390, y: 200 });
    fire(el, 'pointermove', { id: 1, x: 310, y: 200 });
    expect(calls).toHaveLength(1);
  });

  it('orbits with a mouse drag anywhere, and suppresses the context menu for right-drag', () => {
    const { el, calls } = setup();
    fire(el, 'pointerdown', { type: 'mouse', x: 10, y: 10, button: 2 });
    fire(el, 'pointermove', { type: 'mouse', x: 20, y: 10 });
    expect(calls[0][0]).toBeCloseTo(-10 * ORBIT_DEFAULTS.mouseSensitivity, 12);
    const menu = new Event('contextmenu', { cancelable: true });
    el.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('stops listening after dispose', () => {
    const { el, calls, controls } = setup();
    controls.dispose();
    fire(el, 'pointerdown', { x: 300, y: 200 });
    fire(el, 'pointermove', { x: 320, y: 200 });
    expect(calls).toHaveLength(0);
  });

  it('drives the follow camera, clamps pitch and pauses auto-rotation while dragging', () => {
    const el = new FakeEl();
    const camera: CameraLike = {
      position: { set() {} },
      lookAt() {},
      fov: 60,
      aspect: 9 / 19.5,
      updateProjectionMatrix() {},
    };
    const rig = createFollowCamera(camera, {
      orbitTarget: el,
      orbit: { getWidth: () => WIDTH },
      reducedMotion: true,
      autoRotateRate: 1.4,
    });
    rig.snapTo([0, 0, 0], 0);
    fire(el, 'pointerdown', { x: 300, y: 200 });
    fire(el, 'pointermove', { x: 250, y: 2000 }); // drag left, far down
    expect(rig.yaw).toBeCloseTo(50 * ORBIT_DEFAULTS.touchSensitivity, 9);
    expect(rig.pitch).toBe(FOLLOW_DEFAULTS.pitchMax);
    const held = rig.yaw;
    // Finger held still for a long time while running sideways: no auto-rotation fight.
    for (let i = 0; i < 300; i++) rig.update([i * 0.1, 0, 0], [6, 0, 0], 1 / 60);
    expect(rig.yaw).toBe(held);
    fire(el, 'pointerup', { x: 250, y: 2000 });
    for (let i = 0; i < 400; i++) rig.update([30 + i * 0.1, 0, 0], [6, 0, 0], 1 / 60);
    expect(rig.yaw).toBeCloseTo(-Math.PI / 2, 1);
    rig.dispose();
  });
});
