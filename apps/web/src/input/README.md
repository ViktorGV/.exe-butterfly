# input

Owned by #4. Turns keyboard, gamepad and touch into the shared `InputState` contract.

```ts
import { createInput } from '../input/index.ts';

const input = createInput({ target: window, touchRoot: document.getElementById('ui-root') });
engine.onFixedUpdate(() => {
  const s = input.sample(); // the same object every call
  // s.moveX / s.moveY: -1..1, camera-relative, right / forward positive
  // s.jump / s.dive: held; s.jumpPressed / s.divePressed: true for exactly one sample per press
});
input.onDeviceChange((device) => ui.showHints(device)); // 'keyboard' | 'gamepad' | 'touch'
```

| Device                               | Move                                       | Jump         | Dive         |
| ------------------------------------ | ------------------------------------------ | ------------ | ------------ |
| Keyboard (`event.code`, any layout)  | WASD or arrows                             | Space        | Shift        |
| Gamepad (standard mapping, hot-plug) | left stick (radial dead zone 0.2) or d-pad | A            | B or X       |
| Touch (shown on touch devices)       | floating joystick, left half               | right button | right button |

- **Sample once per simulation step.** Presses are latched between samples: a tap that starts and ends between two samples is reported once, never lost and never twice. Gamepads are polled inside `sample()`.
- **Mixing:** buttons are combined across devices. Movement comes from the most recently used device that is currently deflected, so pressing a pad button while walking on the keyboard keeps walking. `activeDevice` is the most recently used device overall.
- **No stuck keys:** window blur, hiding the tab and unplugging a pad release everything. A pad button still held after refocus does not fire a new press.
- **Page behaviour:** Space and the arrow keys don't scroll the page while playing; typing in a text field and shortcuts with Ctrl, Cmd or Alt are ignored.
- **Touch:** multi-touch safe (steer and press buttons at the same time; a second finger in the stick zone is ignored). The zone and buttons respect safe-area insets and fit a 360 px screen. Touch drags elsewhere on screen pass through for the camera (#6).
- The device logic (`sources.ts`, `mixer.ts`, `vector.ts`) is pure and unit-tested; `index.ts` and `touchControls.ts` wire it to the DOM.

Demo: `/demos/input.html` (`bun run dev`).
