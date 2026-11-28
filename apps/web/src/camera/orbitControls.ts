// Drag-to-orbit wiring (thin DOM layer). Phone first: a one-finger drag that starts on the right
// part of the screen orbits the camera; the left half is the movement joystick (#4's
// `.wr-touch-zone`) and drags that start on the Jump / Dive buttons or any other control are
// ignored. On desktop a mouse drag (left or right button) anywhere that is not a control orbits.
// Only one pointer orbits at a time, so the joystick finger and a button finger never fight it.

export const ORBIT_BLOCK_SELECTOR =
  '.wr-touch-btn, .wr-touch-zone, button, a, input, select, textarea, label, [contenteditable], [data-no-orbit]';

export interface OrbitPointerEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly target: EventTarget | null;
}

export interface OrbitControlsOptions {
  /** Receives pointer events (the canvas or window). */
  target: EventTarget;
  /** Called with yaw / pitch deltas in radians. */
  onOrbit(dYaw: number, dPitch: number): void;
  /** Called when a drag starts and ends. */
  onDragChange?(dragging: boolean): void;
  /** Radians per CSS pixel for touch / pen. */
  touchSensitivity?: number;
  /** Radians per CSS pixel for mouse. */
  mouseSensitivity?: number;
  /** Viewport width in CSS pixels. Default innerWidth. */
  getWidth?: () => number;
  /** A touch must start at clientX >= width * this. Default 0.5 (right half). */
  touchMinX?: number;
  /** Return true to ignore a drag that starts on this event. Default: on a control (ORBIT_BLOCK_SELECTOR). */
  isBlocked?: (e: OrbitPointerEvent) => boolean;
}

export interface OrbitControls {
  readonly dragging: boolean;
  dispose(): void;
}

export const ORBIT_DEFAULTS = {
  touchSensitivity: 0.0035,
  mouseSensitivity: 0.0025,
  touchMinX: 0.5,
} as const;

type Closest = { closest?: (sel: string) => unknown };

export function isOnControl(e: OrbitPointerEvent) {
  const t = e.target as Closest | null;
  return !!t && typeof t.closest === 'function' && !!t.closest(ORBIT_BLOCK_SELECTOR);
}

/**
 * Map a pointer movement to orbit deltas. Drag right turns the view right (yaw decreases, as
 * positive yaw turns left); drag up looks up (the camera drops, so pitch decreases).
 */
export function dragDelta(dx: number, dy: number, sensitivity: number, out: [number, number]) {
  out[0] = -dx * sensitivity;
  out[1] = dy * sensitivity;
  return out;
}

export function attachOrbitControls(options: OrbitControlsOptions): OrbitControls {
  const { target, onOrbit, onDragChange } = options;
  const touchSens = options.touchSensitivity ?? ORBIT_DEFAULTS.touchSensitivity;
  const mouseSens = options.mouseSensitivity ?? ORBIT_DEFAULTS.mouseSensitivity;
  const touchMinX = options.touchMinX ?? ORBIT_DEFAULTS.touchMinX;
  const isBlocked = options.isBlocked ?? isOnControl;
  const getWidth =
    options.getWidth ?? (() => (globalThis as { innerWidth?: number }).innerWidth ?? Number.POSITIVE_INFINITY);

  let active = -1;
  let sens = 0;
  let lastX = 0;
  let lastY = 0;
  const delta: [number, number] = [0, 0];

  const end = () => {
    if (active < 0) return;
    active = -1;
    onDragChange?.(false);
  };

  const onDown = (ev: Event) => {
    const e = ev as unknown as OrbitPointerEvent;
    if (active >= 0) return;
    const touchLike = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (touchLike) {
      if (e.clientX < getWidth() * touchMinX) return;
    } else if (e.button !== 0 && e.button !== 2) return;
    if (isBlocked(e)) return;
    active = e.pointerId;
    sens = touchLike ? touchSens : mouseSens;
    lastX = e.clientX;
    lastY = e.clientY;
    const el = e.target as { setPointerCapture?: (id: number) => void } | null;
    try {
      el?.setPointerCapture?.(e.pointerId);
    } catch {
      // Capture is a nicety; window-level listeners still see the moves.
    }
    onDragChange?.(true);
  };

  const onMove = (ev: Event) => {
    const e = ev as unknown as OrbitPointerEvent;
    if (e.pointerId !== active) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dx === 0 && dy === 0) return;
    dragDelta(dx, dy, sens, delta);
    onOrbit(delta[0], delta[1]);
  };

  const onUp = (ev: Event) => {
    if ((ev as unknown as OrbitPointerEvent).pointerId === active) end();
  };

  // Right-button drag on desktop should not open the context menu over the game.
  const onContextMenu = (ev: Event) => {
    if (!isBlocked(ev as unknown as OrbitPointerEvent)) ev.preventDefault();
  };

  target.addEventListener('pointerdown', onDown);
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
  target.addEventListener('contextmenu', onContextMenu);

  return {
    get dragging() {
      return active >= 0;
    },
    dispose() {
      end();
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      target.removeEventListener('contextmenu', onContextMenu);
    },
  };
}
