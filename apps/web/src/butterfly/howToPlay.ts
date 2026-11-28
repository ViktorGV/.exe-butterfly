// Controls card (#84): the important controls for the device in use. It sits in the middle of the screen during
// the countdown, then moves to the bottom right for the rest of the race (styles in ui.css). Controls ONLY: the
// butterfly effect is a surprise players discover during the race and on the results screen, so none of it is
// mentioned here.
import type { Device } from '../ui/types.ts';

export interface ControlLine {
  /** The keys or buttons to press, one cap each. */
  keys: readonly string[];
  action: string;
}

const lines = (move: readonly string[], jump: string, dive: string, grab: string): readonly ControlLine[] =>
  Object.freeze([
    { keys: move, action: 'Move' },
    { keys: [jump], action: 'Jump' },
    { keys: [dive], action: 'Dive' },
    { keys: [grab], action: 'Help up / push' },
  ]);

export const CONTROLS: Readonly<Record<Device, readonly ControlLine[]>> = Object.freeze({
  keyboard: lines(['W', 'A', 'S', 'D'], 'Space', 'Shift', 'E'),
  gamepad: lines(['Left stick'], 'A', 'B', 'Y'),
  touch: lines(['Drag left side'], 'JUMP', 'DIVE', '🤝'),
});

export interface ControlsCard {
  readonly el: HTMLElement;
  setDevice(device: Device): void;
}

/** Builds the card. The DOM changes only when the device does. */
export function createControlsCard(doc: Document): ControlsCard {
  const el = doc.createElement('aside');
  el.className = 'wr-controls';
  el.setAttribute('aria-label', 'Controls');
  const list = doc.createElement('ul');
  el.append(list);
  const make = (tag: string, text: string) => {
    const node = doc.createElement(tag);
    node.textContent = text;
    return node;
  };
  let shown: Device | null = null;
  const setDevice = (device: Device) => {
    if (device === shown) return;
    shown = device;
    el.dataset.device = device;
    list.replaceChildren(
      ...CONTROLS[device].map((line) => {
        const keys = doc.createElement('span');
        keys.className = 'wr-controls-keys';
        keys.append(...line.keys.map((k) => make('kbd', k)));
        const li = doc.createElement('li');
        li.append(keys, make('span', line.action));
        return li;
      }),
    );
  };
  setDevice('keyboard');
  return { el, setDevice };
}
