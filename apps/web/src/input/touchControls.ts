// On-screen touch controls: a floating joystick on the left half and Jump / Dive buttons on the
// right. Shown only on touch devices (coarse pointer, or after the first touch). Multi-touch safe:
// every control tracks its own pointer ids, so you can steer and jump at the same time.
import type { GrabKind } from '@wobble/shared/types';
import type { TouchButton, TouchSource } from './sources.ts';

const GRAB_ICON: Record<GrabKind | 'none', string> = { push: '👊', save: '✋', helpUp: '🤝', none: '✊' };
const GRAB_LABEL: Record<GrabKind | 'none', string> = {
  push: 'Push',
  save: 'Save',
  helpUp: 'Help up',
  none: 'Grab',
};

const STYLE_ID = 'wr-touch-style';
const CSS = `
.wr-touch { position: absolute; inset: 0; pointer-events: none; user-select: none; -webkit-user-select: none;
  -webkit-touch-callout: none; touch-action: none; }
.wr-touch[hidden] { display: none !important; }
.wr-touch-zone { position: absolute; left: 0; top: 0; bottom: 0; width: 50%; pointer-events: auto; touch-action: none; }
.wr-touch-base, .wr-touch-knob { position: absolute; border-radius: 50%; pointer-events: none; transform: translate(-50%, -50%); }
.wr-touch-base { width: 112px; height: 112px; background: rgb(29 27 47 / 0.14); border: 3px solid rgb(255 255 255 / 0.85);
  box-shadow: 0 0 0 2px rgb(29 27 47 / 0.3); }
.wr-touch-knob { width: 52px; height: 52px; background: rgb(255 255 255 / 0.95); box-shadow: 0 0 0 2px rgb(29 27 47 / 0.35), 0 3px 10px rgb(0 0 0 / 0.25); }
.wr-touch-base[hidden], .wr-touch-knob[hidden] { display: none; }
.wr-touch-hint { position: absolute; left: calc(24px + env(safe-area-inset-left, 0px)); bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  font: 600 13px system-ui, sans-serif; color: rgb(255 255 255 / 0.85); text-shadow: 0 1px 3px rgb(0 0 0 / 0.4); pointer-events: none; }
.wr-touch-btn { position: absolute; display: grid; place-items: center; border-radius: 50%; pointer-events: auto; touch-action: none;
  font: 800 15px system-ui, sans-serif; letter-spacing: 0.02em; color: #1d1b2f; border: 3px solid #fff;
  background: rgb(255 255 255 / 0.75); box-shadow: 0 4px 14px rgb(0 0 0 / 0.22); -webkit-tap-highlight-color: transparent; }
.wr-touch-btn[data-held='true'] { transform: scale(0.92); background: #ffd23f; }
.wr-touch-grab { width: 72px; height: 72px; right: calc(34px + env(safe-area-inset-right, 0px)); bottom: calc(128px + env(safe-area-inset-bottom, 0px)); font-size: 26px; }
.wr-touch-grab[data-kind='none'] { opacity: 0.35; filter: grayscale(1); }
.wr-touch-grab[data-kind='save'] { animation: wr-grab-pulse 0.5s ease-in-out infinite alternate; background: #ffd23f; }
@keyframes wr-grab-pulse { to { transform: scale(1.12); } }
@media (prefers-reduced-motion: reduce) { .wr-touch-grab[data-kind='save'] { animation: none; } }
.wr-touch-jump { width: 84px; height: 84px; right: calc(24px + env(safe-area-inset-right, 0px)); bottom: calc(28px + env(safe-area-inset-bottom, 0px)); }
.wr-touch-dive { width: 64px; height: 64px; right: calc(122px + env(safe-area-inset-right, 0px)); bottom: calc(22px + env(safe-area-inset-bottom, 0px)); }
@media (max-width: 380px) {
  .wr-touch-jump { width: 76px; height: 76px; }
  .wr-touch-dive { right: calc(110px + env(safe-area-inset-right, 0px)); }
}
`;

export interface TouchControls {
  readonly element: HTMLElement;
  readonly visible: boolean;
  setVisible(visible: boolean): void;
  /** Shows the Grab button (online races only) and what it would do now: ✋ save, 🤝 help up, 👊 push, greyed when nobody is near. */
  setGrab(kind: GrabKind | null | 'hidden'): void;
  dispose(): void;
}

function isTouchLike(e: PointerEvent) {
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

export function mountTouchControls(root: HTMLElement, touch: TouchSource): TouchControls {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const el = document.createElement('div');
  el.className = 'wr-touch';
  el.innerHTML = `
    <div class="wr-touch-zone" aria-hidden="true">
      <div class="wr-touch-base" hidden></div>
      <div class="wr-touch-knob" hidden></div>
      <div class="wr-touch-hint">Drag to move</div>
    </div>
    <button type="button" class="wr-touch-btn wr-touch-grab" data-button="grab" data-kind="none" aria-label="Grab" hidden>✊</button>
    <button type="button" class="wr-touch-btn wr-touch-dive" data-button="dive" aria-label="Dive">DIVE</button>
    <button type="button" class="wr-touch-btn wr-touch-jump" data-button="jump" aria-label="Jump">JUMP</button>`;
  root.appendChild(el);

  const zone = el.querySelector<HTMLElement>('.wr-touch-zone')!;
  const base = el.querySelector<HTMLElement>('.wr-touch-base')!;
  const knob = el.querySelector<HTMLElement>('.wr-touch-knob')!;
  const hint = el.querySelector<HTMLElement>('.wr-touch-hint')!;
  const buttons = [...el.querySelectorAll<HTMLElement>('.wr-touch-btn')];

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  el.hidden = !coarse;

  const draw = () => {
    const s = touch.stick;
    base.hidden = knob.hidden = !s;
    hint.hidden = !!s;
    if (!s) return;
    const r = zone.getBoundingClientRect();
    base.style.left = `${s.originX - r.left}px`;
    base.style.top = `${s.originY - r.top}px`;
    knob.style.left = `${s.originX - r.left + s.knobX}px`;
    knob.style.top = `${s.originY - r.top + s.knobY}px`;
  };

  const onZoneDown = (e: PointerEvent) => {
    if (!isTouchLike(e)) return;
    e.preventDefault();
    zone.setPointerCapture?.(e.pointerId);
    touch.stickStart(e.pointerId, e.clientX, e.clientY);
    draw();
  };
  const onZoneMove = (e: PointerEvent) => {
    if (!isTouchLike(e)) return;
    touch.stickMove(e.pointerId, e.clientX, e.clientY);
    draw();
  };
  const onZoneUp = (e: PointerEvent) => {
    touch.stickEnd(e.pointerId);
    draw();
  };
  zone.addEventListener('pointerdown', onZoneDown);
  zone.addEventListener('pointermove', onZoneMove);
  zone.addEventListener('pointerup', onZoneUp);
  zone.addEventListener('pointercancel', onZoneUp);

  const buttonHandlers = buttons.map((btn) => {
    const name = btn.dataset.button as TouchButton;
    const down = (e: PointerEvent) => {
      e.preventDefault();
      btn.setPointerCapture?.(e.pointerId);
      touch.buttonDown(name, e.pointerId);
      btn.dataset.held = String(touch[name]);
    };
    const up = (e: PointerEvent) => {
      touch.buttonUp(name, e.pointerId);
      btn.dataset.held = String(touch[name]);
    };
    // Keep the click from reaching the page (and from focusing / scrolling).
    const block = (e: Event) => e.preventDefault();
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('contextmenu', block);
    return () => {
      btn.removeEventListener('pointerdown', down);
      btn.removeEventListener('pointerup', up);
      btn.removeEventListener('pointercancel', up);
      btn.removeEventListener('contextmenu', block);
    };
  });

  // Reveal the controls the first time someone touches the screen (e.g. a touch laptop).
  const onAnyTouch = (e: PointerEvent) => {
    if (e.pointerType === 'touch') el.hidden = false;
  };
  window.addEventListener('pointerdown', onAnyTouch, { capture: true });

  return {
    element: el,
    get visible() {
      return !el.hidden;
    },
    setVisible(visible) {
      el.hidden = !visible;
    },
    setGrab(kind) {
      const btn = el.querySelector<HTMLElement>('.wr-touch-grab')!;
      const hide = kind === 'hidden';
      if (btn.hidden !== hide) btn.hidden = hide;
      if (hide) return;
      const k = kind ?? 'none';
      if (btn.dataset.kind === k) return;
      btn.dataset.kind = k;
      btn.textContent = GRAB_ICON[k];
      btn.setAttribute('aria-label', GRAB_LABEL[k]);
    },
    dispose() {
      window.removeEventListener('pointerdown', onAnyTouch, { capture: true });
      zone.removeEventListener('pointerdown', onZoneDown);
      zone.removeEventListener('pointermove', onZoneMove);
      zone.removeEventListener('pointerup', onZoneUp);
      zone.removeEventListener('pointercancel', onZoneUp);
      for (const off of buttonHandlers) off();
      el.remove();
    },
  };
}

/** Clear the drawn joystick and held buttons after a reset (blur, tab hidden). */
export function redrawTouchControls(controls: TouchControls | null) {
  if (!controls) return;
  const el = controls.element;
  for (const node of el.querySelectorAll<HTMLElement>('.wr-touch-base, .wr-touch-knob')) node.hidden = true;
  const hint = el.querySelector<HTMLElement>('.wr-touch-hint');
  if (hint) hint.hidden = false;
  for (const btn of el.querySelectorAll<HTMLElement>('.wr-touch-btn')) btn.dataset.held = 'false';
}
