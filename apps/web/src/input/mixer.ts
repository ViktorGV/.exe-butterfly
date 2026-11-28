// Combines device sources into the shared InputState contract.
//
// - Buttons are OR'd across devices, and presses are latched per sample: a tap between two
//   samples is reported exactly once, never lost and never twice.
// - Movement comes from the most recently used device that is currently deflected, so pressing
//   a gamepad button while walking with the keyboard does not stop the walk.
// - activeDevice is the most recently used device overall (for control hints).
import type { InputState } from '@wobble/shared/types';
import type { InputDevice, InputSource } from './sources.ts';

export interface InputMixer {
  /** Fill and return the shared, reused InputState. Consumes pending presses. */
  sample(): InputState;
  readonly activeDevice: InputDevice;
  /** Release everything on every source. */
  reset(): void;
}

export function createInputMixer(sources: readonly InputSource[], initialDevice: InputDevice = 'keyboard'): InputMixer {
  const state: InputState = {
    moveX: 0,
    moveY: 0,
    jump: false,
    jumpPressed: false,
    dive: false,
    divePressed: false,
    grab: false,
    grabPressed: false,
  };
  let active: InputDevice = initialDevice;
  let activeSeq = 0;

  return {
    get activeDevice() {
      for (const s of sources) {
        if (s.lastActive > activeSeq) {
          activeSeq = s.lastActive;
          active = s.device;
        }
      }
      return active;
    },
    sample() {
      let moveSeq = -1;
      let mx = 0;
      let my = 0;
      let jump = false;
      let dive = false;
      let jumpPressed = false;
      let divePressed = false;
      let grab = false;
      let grabPressed = false;

      for (const s of sources) {
        if ((s.moveX !== 0 || s.moveY !== 0) && s.lastActive > moveSeq) {
          moveSeq = s.lastActive;
          mx = s.moveX;
          my = s.moveY;
        }
        jump ||= s.jump;
        dive ||= s.dive;
        grab ||= s.grab;
        if (s.jumpPresses > 0) jumpPressed = true;
        if (s.divePresses > 0) divePressed = true;
        if (s.grabPresses > 0) grabPressed = true;
        s.jumpPresses = 0;
        s.divePresses = 0;
        s.grabPresses = 0;
        if (s.lastActive > activeSeq) {
          activeSeq = s.lastActive;
          active = s.device;
        }
      }

      state.moveX = mx;
      state.moveY = my;
      state.jump = jump;
      state.dive = dive;
      state.jumpPressed = jumpPressed;
      state.divePressed = divePressed;
      state.grab = grab;
      state.grabPressed = grabPressed;
      return state;
    },
    reset() {
      for (const s of sources) s.reset();
    },
  };
}
