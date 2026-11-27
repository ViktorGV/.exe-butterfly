// Input (#4): keyboard, gamepad and touch -> the shared InputState contract.
//
//   const input = createInput({ target: window, touchRoot: document.getElementById('ui-root') });
//   engine.onFixedUpdate(() => {
//     const s = input.sample(); // same object every call; *Pressed is true for exactly one sample
//   });
//
// Keyboard uses physical key positions (event.code): WASD / arrows move, Space jumps, Shift dives.
// Gamepad (standard mapping): left stick or d-pad moves, A jumps, B or X dives. Hot-plug works.
// Touch: floating joystick on the left half, Jump and Dive buttons on the right.
// Losing focus, hiding the tab or unplugging a pad releases everything (no stuck keys).
import type { InputState } from '@wobble/shared/types';
import { createInputMixer } from './mixer.ts';
import {
  SCROLL_KEYS,
  createClock,
  createGamepadSource,
  createKeyboardSource,
  createTouchSource,
  type GamepadLike,
  type InputDevice,
} from './sources.ts';
import { mountTouchControls, redrawTouchControls, type TouchControls } from './touchControls.ts';

export type { InputDevice } from './sources.ts';
export { KEY_BINDINGS, GAMEPAD, TOUCH } from './sources.ts';

export interface Input {
  /** Poll devices and return the shared, reused InputState. Call once per simulation step. */
  sample(): InputState;
  /** The most recently used device, for showing the right control hints. */
  readonly activeDevice: InputDevice;
  /** Called when activeDevice changes (checked on every sample). Returns an unsubscribe function. */
  onDeviceChange(fn: (device: InputDevice) => void): () => void;
  /** Number of connected gamepads at the last sample. */
  readonly gamepads: number;
  /** Release every held key, button and touch. */
  reset(): void;
  readonly touchControls: TouchControls | null;
  dispose(): void;
}

export interface InputOptions {
  /** Receives keyboard events. Default window. */
  target?: EventTarget;
  /** Element the touch controls are drawn into. Omit to have no touch controls. */
  touchRoot?: HTMLElement | null;
  /** Suppress page scrolling from Space and the arrow keys. Default true. */
  preventScroll?: boolean;
  /** Source of gamepads. Default navigator.getGamepads. */
  getGamepads?: () => ArrayLike<GamepadLike | null> | null;
  /** Receives blur and gamepad events. Default window (if present). */
  windowTarget?: EventTarget | null;
  /** Receives visibilitychange. Default document (if present). */
  documentTarget?: (EventTarget & { hidden?: boolean }) | null;
}

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};

export function createInput(options: InputOptions = {}): Input {
  const g = globalThis as {
    window?: EventTarget;
    document?: EventTarget & { hidden?: boolean };
    navigator?: Navigator;
  };
  const target = options.target ?? g.window;
  if (!target) throw new Error('createInput: no event target (pass options.target)');
  const win = options.windowTarget === undefined ? (g.window ?? null) : options.windowTarget;
  const doc = options.documentTarget === undefined ? (g.document ?? null) : options.documentTarget;
  const preventScroll = options.preventScroll ?? true;
  const getGamepads =
    options.getGamepads ??
    (() => (g.navigator?.getGamepads ? (g.navigator.getGamepads() as ArrayLike<GamepadLike | null>) : null));

  const clock = createClock();
  const keyboard = createKeyboardSource(clock);
  const gamepad = createGamepadSource(clock);
  const touch = createTouchSource(clock);
  const mixer = createInputMixer([keyboard, gamepad, touch]);
  const touchControls = options.touchRoot ? mountTouchControls(options.touchRoot, touch) : null;

  const deviceListeners = new Set<(d: InputDevice) => void>();
  let lastDevice: InputDevice = mixer.activeDevice;

  const onKeyDown = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.ctrlKey || k.metaKey || k.altKey || isEditable(k.target)) return;
    const bound = keyboard.keyDown(k.code, k.repeat);
    if (bound && preventScroll && SCROLL_KEYS.has(k.code)) k.preventDefault();
  };
  const onKeyUp = (e: Event) => {
    keyboard.keyUp((e as KeyboardEvent).code);
  };
  const resetAll = () => {
    mixer.reset();
    redrawTouchControls(touchControls);
  };
  const onVisibility = () => {
    if (doc?.hidden) resetAll();
  };
  const onPadDisconnected = (e: Event) => {
    const pad = (e as GamepadEvent).gamepad;
    if (pad) gamepad.disconnect(pad.index);
    gamepad.reset();
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  win?.addEventListener('blur', resetAll);
  win?.addEventListener('gamepaddisconnected', onPadDisconnected);
  doc?.addEventListener('visibilitychange', onVisibility);

  return {
    sample() {
      gamepad.poll(getGamepads());
      const state = mixer.sample();
      const device = mixer.activeDevice;
      if (device !== lastDevice) {
        lastDevice = device;
        for (const fn of deviceListeners) fn(device);
      }
      return state;
    },
    get activeDevice() {
      return mixer.activeDevice;
    },
    onDeviceChange(fn) {
      deviceListeners.add(fn);
      return () => deviceListeners.delete(fn);
    },
    get gamepads() {
      return gamepad.connectedCount;
    },
    reset: resetAll,
    touchControls,
    dispose() {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      win?.removeEventListener('blur', resetAll);
      win?.removeEventListener('gamepaddisconnected', onPadDisconnected);
      doc?.removeEventListener('visibilitychange', onVisibility);
      touchControls?.dispose();
      deviceListeners.clear();
      mixer.reset();
    },
  };
}
