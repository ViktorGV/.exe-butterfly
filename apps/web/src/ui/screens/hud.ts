// Race HUD along the top edge: place, timer, pause button, then checkpoint and qualified chips,
// toasts and control hints. The bottom of the screen is left free for the touch controls.
// Updates write text nodes only, and only when the shown digits change.
import { h } from '../dom.ts';
import { createPairWriter, createTimeWriter, type PairWriter } from '../format.ts';
import { STRINGS } from '../strings.ts';
import type { Device, HudProps } from '../types.ts';
import type { Screen, ScreenContext } from './context.ts';

export interface HudApi {
  setTime(ms: number): void;
  setCheckpoint(i: number, n: number): void;
  setPlace(p: number, total: number): void;
  setQualified(q: number, max: number): void;
  toast(text: string): void;
  /** Brief white flash after a respawn. */
  flash(): void;
  /** Control hints for the device, shown for a few seconds. */
  showHints(device: Device): void;
}

const TOAST_MS = 1600;
const MAX_TOASTS = 3;
const HINT_MS = 6000;
const HINTS: Record<Device, string> = {
  touch: STRINGS.hintTouch,
  keyboard: STRINGS.hintKeyboard,
  gamepad: STRINGS.hintGamepad,
};

function pairChip(doc: Document, label: string, cls: string): { el: HTMLElement; writer: PairWriter } {
  const a = doc.createTextNode('0');
  const b = doc.createTextNode('0');
  const el = h(
    doc,
    'div',
    { class: `wr-chip ${cls}` },
    h(doc, 'span', { class: 'wr-chip-label' }, label),
    h(doc, 'span', { class: 'wr-chip-value wr-mono' }, a, h(doc, 'span', { class: 'wr-chip-sep' }, '/'), b),
  );
  return { el, writer: createPairWriter(a, b) };
}

export function createHud(ctx: ScreenContext): Screen<HudProps> & { api: HudApi } {
  const { doc } = ctx;
  const mm = doc.createTextNode('00');
  const ss = doc.createTextNode('00');
  const cc = doc.createTextNode('00');
  const time = createTimeWriter(mm, ss, cc);
  const timer = h(
    doc,
    'div',
    { class: 'wr-timer wr-mono', role: 'timer', 'aria-label': STRINGS.hudTime },
    mm,
    ':',
    ss,
    h(doc, 'span', { class: 'wr-timer-cc' }, '.', cc),
  );
  const place = pairChip(doc, STRINGS.hudPlace, 'wr-chip-place');
  const cp = pairChip(doc, STRINGS.hudCheckpoint, 'wr-chip-cp');
  const qual = pairChip(doc, STRINGS.hudQualified, 'wr-chip-qual');

  const pauseBtn = h(
    doc,
    'button',
    { type: 'button', class: 'wr-btn wr-pause-btn', 'aria-label': STRINGS.pause },
    h(doc, 'span', { class: 'wr-pause-icon', 'aria-hidden': 'true' }),
  );
  pauseBtn.addEventListener('click', () => ctx.open('pause'));

  const toasts = h(doc, 'div', { class: 'wr-toasts', 'aria-live': 'polite' });
  const hintText = doc.createTextNode('');
  const hint = h(doc, 'div', { class: 'wr-hint', hidden: true }, hintText);
  const flashEl = h(doc, 'div', { class: 'wr-flash', 'aria-hidden': 'true' });

  const el = h(
    doc,
    'section',
    { class: 'wr-hud', 'aria-label': STRINGS.hudTime },
    h(
      doc,
      'div',
      { class: 'wr-hud-top' },
      h(doc, 'div', { class: 'wr-hud-left' }, place.el),
      timer,
      h(doc, 'div', { class: 'wr-hud-right' }, pauseBtn),
    ),
    h(doc, 'div', { class: 'wr-hud-row' }, cp.el, qual.el),
    toasts,
    hint,
    flashEl,
  );

  let hintTimer = 0;
  const api: HudApi = {
    setTime: (ms) => time.set(ms),
    setCheckpoint: (i, n) => cp.writer.set(i, n),
    setPlace: (p, total) => place.writer.set(p, total),
    setQualified: (q, max) => qual.writer.set(q, max),
    toast(text) {
      while (toasts.childElementCount >= MAX_TOASTS) toasts.firstElementChild!.remove();
      const item = h(doc, 'div', { class: 'wr-toast' }, text);
      toasts.appendChild(item);
      window.setTimeout(() => item.remove(), TOAST_MS);
    },
    flash() {
      flashEl.dataset.tick = flashEl.dataset.tick === 'a' ? 'b' : 'a';
    },
    showHints(device) {
      hintText.nodeValue = HINTS[device];
      hint.hidden = false;
      clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => (hint.hidden = true), HINT_MS);
    },
  };

  return {
    el,
    api,
    show(props) {
      const solo = !!props?.solo;
      place.el.hidden = solo;
      qual.el.hidden = solo;
      if (props?.checkpoints) api.setCheckpoint(0, props.checkpoints);
      if (props?.totalPlayers) api.setPlace(props.totalPlayers, props.totalPlayers);
      if (props?.qualifyMax) api.setQualified(0, props.qualifyMax);
      api.setTime(0);
      if (props?.device) api.showHints(props.device);
    },
    hide() {
      clearTimeout(hintTimer);
      hint.hidden = true;
      toasts.replaceChildren();
    },
  };
}
