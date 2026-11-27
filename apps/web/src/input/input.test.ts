import { describe, expect, it } from 'bun:test';
import { createInput } from './index.ts';
import { createInputMixer } from './mixer.ts';
import {
  createClock,
  createGamepadSource,
  createKeyboardSource,
  createTouchSource,
  TOUCH,
  type GamepadLike,
} from './sources.ts';
import { applyRadialDeadzone, clampToUnitCircle, joystickVector } from './vector.ts';

function setup() {
  const clock = createClock();
  const keyboard = createKeyboardSource(clock);
  const gamepad = createGamepadSource(clock);
  const touch = createTouchSource(clock);
  const mixer = createInputMixer([keyboard, gamepad, touch]);
  return { keyboard, gamepad, touch, mixer };
}

function pad(over: Partial<{ axes: number[]; pressed: number[]; index: number }> = {}): GamepadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: (over.pressed ?? []).includes(i), value: 0 }));
  return { index: over.index ?? 0, connected: true, mapping: 'standard', axes: over.axes ?? [0, 0, 0, 0], buttons };
}

describe('vector helpers', () => {
  it('clamps diagonals to the unit circle', () => {
    const out: [number, number] = [0, 0];
    clampToUnitCircle(1, 1, out);
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(1, 9);
    clampToUnitCircle(0.3, 0.4, out);
    expect(out).toEqual([0.3, 0.4]);
  });

  it('applies a rescaled radial dead zone', () => {
    const out: [number, number] = [0, 0];
    expect(applyRadialDeadzone(0.15, 0.1, 0.2, out)).toEqual([0, 0]);
    applyRadialDeadzone(0.6, 0, 0.2, out);
    expect(out[0]).toBeCloseTo(0.5, 9);
    applyRadialDeadzone(1, 1, 0.2, out);
    expect(Math.hypot(out[0], out[1])).toBeCloseTo(1, 9);
  });

  it('turns a screen-space drag into forward-positive movement', () => {
    const out: [number, number] = [0, 0];
    joystickVector(0, -100, 100, 0, out); // drag up
    expect(out[0]).toBeCloseTo(0, 9);
    expect(out[1]).toBeCloseTo(1, 9);
  });
});

describe('keyboard', () => {
  it('normalises diagonals so they are not faster', () => {
    const { keyboard, mixer } = setup();
    keyboard.keyDown('KeyW', false);
    keyboard.keyDown('KeyD', false);
    const s = mixer.sample();
    expect(s.moveX).toBeCloseTo(Math.SQRT1_2, 9);
    expect(s.moveY).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('cancels opposite keys and treats WASD and arrows as one action', () => {
    const { keyboard, mixer } = setup();
    keyboard.keyDown('KeyA', false);
    keyboard.keyDown('ArrowRight', false);
    expect(mixer.sample().moveX).toBe(0);
    keyboard.keyDown('ArrowUp', false);
    keyboard.keyDown('KeyW', false);
    keyboard.keyUp('ArrowUp');
    expect(mixer.sample().moveY).toBe(1); // still held by W
  });

  it('latches a tap that starts and ends between two samples, and reports it once', () => {
    const { keyboard, mixer } = setup();
    keyboard.keyDown('Space', false);
    keyboard.keyUp('Space');
    let s = mixer.sample();
    expect(s.jumpPressed).toBe(true);
    expect(s.jump).toBe(false);
    s = mixer.sample();
    expect(s.jumpPressed).toBe(false);
  });

  it('reports a held key as pressed once, ignoring auto-repeat and missed key-ups', () => {
    const { keyboard, mixer } = setup();
    keyboard.keyDown('ShiftLeft', false);
    expect(mixer.sample()).toMatchObject({ dive: true, divePressed: true });
    keyboard.keyDown('ShiftLeft', true);
    keyboard.keyDown('ShiftLeft', false);
    expect(mixer.sample()).toMatchObject({ dive: true, divePressed: false });
    keyboard.keyDown('ShiftRight', false); // second key for the same action while held
    expect(mixer.sample().divePressed).toBe(false);
  });

  it('ignores unbound keys', () => {
    const { keyboard, mixer } = setup();
    expect(keyboard.keyDown('KeyQ', false)).toBe(false);
    expect(mixer.sample()).toMatchObject({ moveX: 0, moveY: 0, jump: false, jumpPressed: false });
  });

  it('returns the same object from every sample', () => {
    const { mixer } = setup();
    expect(mixer.sample()).toBe(mixer.sample());
  });
});

describe('gamepad', () => {
  it('reads the left stick with a dead zone and forward-positive Y', () => {
    const { gamepad, mixer } = setup();
    gamepad.poll([pad({ axes: [0.1, -0.1] })]);
    expect(mixer.sample()).toMatchObject({ moveX: 0, moveY: 0 });
    gamepad.poll([pad({ axes: [0, -1] })]);
    expect(mixer.sample().moveY).toBeCloseTo(1, 9);
  });

  it('uses the d-pad as digital movement', () => {
    const { gamepad, mixer } = setup();
    gamepad.poll([pad({ pressed: [12, 15] })]); // up + right
    const s = mixer.sample();
    expect(s.moveX).toBeCloseTo(Math.SQRT1_2, 9);
    expect(s.moveY).toBeCloseTo(Math.SQRT1_2, 9);
  });

  it('maps A to jump and B or X to dive, with one press per rising edge', () => {
    const { gamepad, mixer } = setup();
    gamepad.poll([pad({ pressed: [0] })]);
    expect(mixer.sample()).toMatchObject({ jump: true, jumpPressed: true });
    gamepad.poll([pad({ pressed: [0] })]);
    expect(mixer.sample()).toMatchObject({ jump: true, jumpPressed: false });
    gamepad.poll([pad({ pressed: [2] })]);
    expect(mixer.sample()).toMatchObject({ jump: false, dive: true, divePressed: true });
    gamepad.poll([pad({ pressed: [1, 2] })]);
    expect(mixer.sample().divePressed).toBe(false);
  });

  it('handles hot-plug: a pad that disappears is forgotten and releases its buttons', () => {
    const { gamepad, mixer } = setup();
    gamepad.poll([pad({ pressed: [0], axes: [1, 0] })]);
    mixer.sample();
    gamepad.poll([null]);
    expect(mixer.sample()).toMatchObject({ jump: false, moveX: 0 });
    expect(gamepad.connectedCount).toBe(0);
    gamepad.poll([pad({ pressed: [0] })]); // plugged back in with A held: counts as a new press
    expect(mixer.sample().jumpPressed).toBe(true);
  });

  it('does not fire a new press for a button still held after a focus reset', () => {
    const { gamepad, mixer } = setup();
    gamepad.poll([pad({ pressed: [0] })]);
    mixer.sample();
    mixer.reset();
    gamepad.poll([pad({ pressed: [0] })]);
    expect(mixer.sample()).toMatchObject({ jump: true, jumpPressed: false });
  });
});

describe('touch', () => {
  it('drives movement from the joystick and clamps to the radius', () => {
    const { touch, mixer } = setup();
    touch.stickStart(1, 100, 300);
    touch.stickMove(1, 100, 300 - TOUCH.radius * 3); // far above
    const s = mixer.sample();
    expect(s.moveX).toBeCloseTo(0, 9);
    expect(s.moveY).toBeCloseTo(1, 9);
    expect(touch.stick?.knobY).toBeCloseTo(-TOUCH.radius, 9);
    touch.stickEnd(1);
    expect(mixer.sample()).toMatchObject({ moveX: 0, moveY: 0 });
  });

  it('is multi-touch safe: steer and jump at once, second stick finger ignored', () => {
    const { touch, mixer } = setup();
    touch.stickStart(1, 0, 0);
    touch.stickMove(1, TOUCH.radius, 0);
    touch.stickStart(2, 500, 500); // another finger in the zone
    touch.stickMove(2, 0, 0);
    touch.buttonDown('jump', 3);
    let s = mixer.sample();
    expect(s.moveX).toBeCloseTo(1, 9);
    expect(s).toMatchObject({ jump: true, jumpPressed: true });
    touch.buttonDown('jump', 4); // second finger on the same button: not a new press
    touch.buttonUp('jump', 3);
    s = mixer.sample();
    expect(s).toMatchObject({ jump: true, jumpPressed: false });
    touch.buttonUp('jump', 4);
    expect(mixer.sample().jump).toBe(false);
  });
});

describe('mixing devices', () => {
  it('keyboard and gamepad together: buttons OR, movement from the latest deflected device', () => {
    const { keyboard, gamepad, mixer } = setup();
    keyboard.keyDown('KeyW', false);
    gamepad.poll([pad({ pressed: [0] })]); // press A while walking with W
    let s = mixer.sample();
    expect(s.moveY).toBe(1); // still walking: the pad stick is centred
    expect(s).toMatchObject({ jump: true, jumpPressed: true });
    expect(mixer.activeDevice).toBe('gamepad');

    gamepad.poll([pad({ pressed: [0], axes: [-1, 0] })]); // now steer with the stick
    s = mixer.sample();
    expect(s.moveX).toBeCloseTo(-1, 9);
    expect(s.moveY).toBeCloseTo(0, 9);

    keyboard.keyDown('KeyD', false); // keyboard used last again
    s = mixer.sample();
    expect(s.moveX).toBeCloseTo(Math.SQRT1_2, 9);
    expect(mixer.activeDevice).toBe('keyboard');
  });

  it('reset releases everything on every device', () => {
    const { keyboard, touch, mixer } = setup();
    keyboard.keyDown('KeyW', false);
    keyboard.keyDown('Space', false);
    touch.buttonDown('dive', 7);
    mixer.reset();
    expect(mixer.sample()).toEqual({
      moveX: 0,
      moveY: 0,
      jump: false,
      jumpPressed: false,
      dive: false,
      divePressed: false,
    });
    keyboard.keyUp('KeyW'); // the stale key-up after refocus is harmless
    keyboard.keyDown('KeyW', false); // and the key works again
    expect(mixer.sample().moveY).toBe(1);
  });
});

describe('createInput wiring (synthetic DOM events)', () => {
  function key(type: 'keydown' | 'keyup', code: string, extra: Record<string, unknown> = {}) {
    return Object.assign(new Event(type, { cancelable: true }), { code, repeat: false, ...extra });
  }

  function harness(pads: (GamepadLike | null)[] = []) {
    const target = new EventTarget();
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { hidden: false });
    const input = createInput({ target, windowTarget: win, documentTarget: doc, getGamepads: () => pads });
    return { target, win, doc, input, pads };
  }

  it('maps key events and prevents page scrolling for Space and arrows only', () => {
    const { target, input } = harness();
    const space = key('keydown', 'Space');
    const w = key('keydown', 'KeyW');
    target.dispatchEvent(space);
    target.dispatchEvent(w);
    expect(space.defaultPrevented).toBe(true);
    expect(w.defaultPrevented).toBe(false);
    expect(input.sample()).toMatchObject({ moveY: 1, jump: true, jumpPressed: true });
    target.dispatchEvent(key('keyup', 'KeyW'));
    expect(input.sample()).toMatchObject({ moveY: 0, jumpPressed: false });
  });

  it('ignores shortcuts with modifiers', () => {
    const { target, input } = harness();
    target.dispatchEvent(key('keydown', 'KeyW', { ctrlKey: true }));
    expect(input.sample().moveY).toBe(0);
  });

  it('window blur releases held keys (no stuck keys)', () => {
    const { target, win, input } = harness();
    target.dispatchEvent(key('keydown', 'KeyD'));
    target.dispatchEvent(key('keydown', 'ShiftLeft'));
    win.dispatchEvent(new Event('blur'));
    expect(input.sample()).toMatchObject({ moveX: 0, dive: false, divePressed: false });
  });

  it('hiding the tab releases held keys', () => {
    const { target, doc, input } = harness();
    target.dispatchEvent(key('keydown', 'KeyA'));
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(input.sample().moveX).toBe(0);
  });

  it('polls gamepads on sample and reports device changes', () => {
    const { target, input, pads } = harness();
    const seen: string[] = [];
    input.onDeviceChange((d) => seen.push(d));
    pads.push(pad({ pressed: [0] }));
    expect(input.sample().jumpPressed).toBe(true);
    expect(input.gamepads).toBe(1);
    target.dispatchEvent(key('keydown', 'KeyW'));
    input.sample();
    expect(seen).toEqual(['gamepad', 'keyboard']);
  });

  it('gamepaddisconnected releases that pad', () => {
    const { win, input, pads } = harness();
    pads.push(pad({ axes: [1, 0] }));
    expect(input.sample().moveX).toBeCloseTo(1, 9);
    pads.length = 0;
    win.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: 0 } }));
    expect(input.sample().moveX).toBe(0);
  });

  it('dispose removes every listener', () => {
    const { target, input } = harness();
    input.dispose();
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.sample().moveY).toBe(0);
  });
});
