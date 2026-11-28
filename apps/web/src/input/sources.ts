// Device state machines. Pure: no DOM access, so every edge case is unit-testable.
// Each source exposes the same shape; the mixer in mixer.ts combines them.

import { applyRadialDeadzone, clampToUnitCircle } from './vector.ts';

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

export interface InputSource {
  readonly device: InputDevice;
  /** -1..1, right positive */
  moveX: number;
  /** -1..1, forward positive */
  moveY: number;
  jump: boolean;
  dive: boolean;
  /** Rising edges since the last sample (latched so a quick tap is never lost). */
  jumpPresses: number;
  divePresses: number;
  /** Butterfly effect (#84): the Grab button. */
  grab: boolean;
  grabPresses: number;
  /** Sequence number of the last user action on this device (higher = more recent). */
  lastActive: number;
  /** Release everything (blur, tab hidden, device lost). Pending presses are discarded too. */
  reset(): void;
}

/** Monotonic action counter shared by the sources of one input instance. */
export type Clock = () => number;

export function createClock(): Clock {
  let n = 0;
  return () => ++n;
}

function baseSource(device: InputDevice) {
  return {
    device,
    moveX: 0,
    moveY: 0,
    jump: false,
    dive: false,
    grab: false,
    jumpPresses: 0,
    divePresses: 0,
    grabPresses: 0,
    lastActive: 0,
  };
}

// ---- keyboard ---------------------------------------------------------------

type KeyAction = 'up' | 'down' | 'left' | 'right' | 'jump' | 'dive' | 'grab';

/** Physical key positions (event.code), so AZERTY, Dvorak etc. all play the same. */
export const KEY_BINDINGS: Readonly<Record<string, KeyAction>> = Object.freeze({
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'jump',
  ShiftLeft: 'dive',
  ShiftRight: 'dive',
  KeyE: 'grab',
});

/** Keys whose browser default (page scroll) is suppressed while playing. */
export const SCROLL_KEYS: ReadonlySet<string> = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export interface KeyboardSource extends InputSource {
  /** Returns true if the key is bound to a game action. */
  keyDown(code: string, repeat: boolean): boolean;
  keyUp(code: string): boolean;
}

export function createKeyboardSource(clock: Clock): KeyboardSource {
  const held = new Set<string>();
  const count = { up: 0, down: 0, left: 0, right: 0, jump: 0, dive: 0, grab: 0 };
  const v: [number, number] = [0, 0];

  const refresh = (s: KeyboardSource) => {
    clampToUnitCircle(
      (count.right > 0 ? 1 : 0) - (count.left > 0 ? 1 : 0),
      (count.up > 0 ? 1 : 0) - (count.down > 0 ? 1 : 0),
      v,
    );
    s.moveX = v[0];
    s.moveY = v[1];
    s.jump = count.jump > 0;
    s.dive = count.dive > 0;
    s.grab = count.grab > 0;
  };

  const src: KeyboardSource = {
    ...baseSource('keyboard'),
    keyDown(code, repeat) {
      const action = KEY_BINDINGS[code];
      if (!action) return false;
      if (repeat || held.has(code)) return true; // auto-repeat or missed keyup: not a new press
      held.add(code);
      const wasHeld = count[action] > 0;
      count[action]++;
      if (!wasHeld && action === 'jump') src.jumpPresses++;
      if (!wasHeld && action === 'dive') src.divePresses++;
      if (!wasHeld && action === 'grab') src.grabPresses++;
      src.lastActive = clock();
      refresh(src);
      return true;
    },
    keyUp(code) {
      const action = KEY_BINDINGS[code];
      if (!action) return false;
      if (!held.delete(code)) return true;
      count[action] = Math.max(0, count[action] - 1);
      src.lastActive = clock();
      refresh(src);
      return true;
    },
    reset() {
      held.clear();
      for (const k of Object.keys(count) as KeyAction[]) count[k] = 0;
      src.jumpPresses = 0;
      src.divePresses = 0;
      src.grabPresses = 0;
      refresh(src);
    },
  };
  return src;
}

// ---- gamepad ----------------------------------------------------------------

/** The subset of the Gamepad API this module reads (standard mapping). */
export interface GamepadLike {
  index: number;
  connected: boolean;
  mapping?: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value?: number }[];
}

export const GAMEPAD = Object.freeze({
  deadzone: 0.2,
  /** Standard mapping button indices. */
  jump: [0] as readonly number[], // A / Cross
  dive: [1, 2] as readonly number[], // B / Circle, X / Square
  grab: [3] as readonly number[], // Y / Triangle
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
  /** Stick change (after dead zone) that counts as the player using the pad. */
  activityThreshold: 0.15,
});

export interface GamepadSource extends InputSource {
  /** Read the current pads (call once per sample). */
  poll(pads: ArrayLike<GamepadLike | null> | null | undefined): void;
  /** Forget a pad that was unplugged. */
  disconnect(index: number): void;
  readonly connectedCount: number;
}

export function createGamepadSource(clock: Clock): GamepadSource {
  /** Previous pressed state per pad: [jump, dive, grab] */
  const prev = new Map<number, [boolean, boolean, boolean]>();
  const lastMove = new Map<number, [number, number]>();
  const v: [number, number] = [0, 0];
  let connected = 0;

  const anyPressed = (pad: GamepadLike, idx: readonly number[]) => {
    for (const i of idx) if (pad.buttons[i]?.pressed) return true;
    return false;
  };

  const src: GamepadSource = {
    ...baseSource('gamepad'),
    get connectedCount() {
      return connected;
    },
    poll(pads) {
      let bestX = 0;
      let bestY = 0;
      let bestMag = 0;
      let jump = false;
      let dive = false;
      let grab = false;
      connected = 0;
      const seen = new Set<number>();

      for (let i = 0; pads && i < pads.length; i++) {
        const pad = pads[i];
        if (!pad || !pad.connected) continue;
        connected++;
        seen.add(pad.index);

        const b = pad.buttons;
        const dx = (b[GAMEPAD.dpadRight]?.pressed ? 1 : 0) - (b[GAMEPAD.dpadLeft]?.pressed ? 1 : 0);
        const dy = (b[GAMEPAD.dpadUp]?.pressed ? 1 : 0) - (b[GAMEPAD.dpadDown]?.pressed ? 1 : 0);
        if (dx !== 0 || dy !== 0) clampToUnitCircle(dx, dy, v);
        else applyRadialDeadzone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), GAMEPAD.deadzone, v);

        const mag = Math.hypot(v[0], v[1]);
        if (mag > bestMag) {
          bestMag = mag;
          bestX = v[0];
          bestY = v[1];
        }

        let last = lastMove.get(pad.index);
        if (!last) lastMove.set(pad.index, (last = [0, 0]));
        if (Math.hypot(v[0] - last[0], v[1] - last[1]) > GAMEPAD.activityThreshold) {
          last[0] = v[0];
          last[1] = v[1];
          src.lastActive = clock();
        }

        const j = anyPressed(pad, GAMEPAD.jump);
        const d = anyPressed(pad, GAMEPAD.dive);
        const g = anyPressed(pad, GAMEPAD.grab);
        let p = prev.get(pad.index);
        if (!p) prev.set(pad.index, (p = [false, false, false]));
        if (j && !p[0]) src.jumpPresses++;
        if (d && !p[1]) src.divePresses++;
        if (g && !p[2]) src.grabPresses++;
        if (j !== p[0] || d !== p[1] || g !== p[2]) src.lastActive = clock();
        p[0] = j;
        p[1] = d;
        p[2] = g;
        jump ||= j;
        dive ||= d;
        grab ||= g;
      }

      for (const index of prev.keys()) if (!seen.has(index)) src.disconnect(index);

      src.moveX = bestX;
      src.moveY = bestY;
      src.jump = jump;
      src.dive = dive;
      src.grab = grab;
    },
    disconnect(index) {
      prev.delete(index);
      lastMove.delete(index);
    },
    reset() {
      // Keep `prev` so a button still physically held after refocus does not fire a new press.
      src.moveX = 0;
      src.moveY = 0;
      src.jump = false;
      src.dive = false;
      src.grab = false;
      src.jumpPresses = 0;
      src.divePresses = 0;
      src.grabPresses = 0;
    },
  };
  return src;
}

// ---- touch ------------------------------------------------------------------

export const TOUCH = Object.freeze({
  /** Drag distance in CSS px for full deflection. */
  radius: 56,
  deadzone: 0.12,
});

export type TouchButton = 'jump' | 'dive' | 'grab';

export interface TouchSource extends InputSource {
  stickStart(pointerId: number, x: number, y: number): void;
  stickMove(pointerId: number, x: number, y: number): void;
  stickEnd(pointerId: number): void;
  buttonDown(button: TouchButton, pointerId: number): void;
  buttonUp(button: TouchButton, pointerId: number): void;
  /** Current joystick origin and knob offset in px (for drawing), or null when idle. */
  readonly stick: { originX: number; originY: number; knobX: number; knobY: number } | null;
}

export function createTouchSource(clock: Clock): TouchSource {
  let stickId: number | null = null;
  let originX = 0;
  let originY = 0;
  const stickView = { originX: 0, originY: 0, knobX: 0, knobY: 0 };
  const pointers: Record<TouchButton, Set<number>> = { jump: new Set(), dive: new Set(), grab: new Set() };
  const v: [number, number] = [0, 0];

  const src: TouchSource = {
    ...baseSource('touch'),
    get stick() {
      return stickId === null ? null : stickView;
    },
    stickStart(id, x, y) {
      if (stickId !== null) return; // first finger owns the stick; others are ignored
      stickId = id;
      originX = stickView.originX = x;
      originY = stickView.originY = y;
      stickView.knobX = 0;
      stickView.knobY = 0;
      src.moveX = 0;
      src.moveY = 0;
      src.lastActive = clock();
    },
    stickMove(id, x, y) {
      if (id !== stickId) return;
      let dx = x - originX;
      let dy = y - originY;
      const d = Math.hypot(dx, dy);
      if (d > TOUCH.radius) {
        dx = (dx / d) * TOUCH.radius;
        dy = (dy / d) * TOUCH.radius;
      }
      stickView.knobX = dx;
      stickView.knobY = dy;
      applyRadialDeadzone(dx / TOUCH.radius, -dy / TOUCH.radius, TOUCH.deadzone, v);
      src.moveX = v[0];
      src.moveY = v[1];
      src.lastActive = clock();
    },
    stickEnd(id) {
      if (id !== stickId) return;
      stickId = null;
      src.moveX = 0;
      src.moveY = 0;
      src.lastActive = clock();
    },
    buttonDown(button, id) {
      const set = pointers[button];
      if (set.has(id)) return;
      const wasHeld = set.size > 0;
      set.add(id);
      if (!wasHeld) {
        if (button === 'jump') src.jumpPresses++;
        else if (button === 'dive') src.divePresses++;
        else src.grabPresses++;
      }
      src[button] = true;
      src.lastActive = clock();
    },
    buttonUp(button, id) {
      const set = pointers[button];
      if (!set.delete(id)) return;
      src[button] = set.size > 0;
      src.lastActive = clock();
    },
    reset() {
      stickId = null;
      pointers.jump.clear();
      pointers.dive.clear();
      pointers.grab.clear();
      src.moveX = 0;
      src.moveY = 0;
      src.jump = false;
      src.dive = false;
      src.grab = false;
      src.jumpPresses = 0;
      src.divePresses = 0;
      src.grabPresses = 0;
    },
  };
  return src;
}
