// What every screen gets from createUI.
import type { Emitter } from '../emitter.ts';
import type { KeyValueStore, UISettings } from '../settings.ts';
import type { UIEvents } from '../types.ts';

export interface ScreenContext {
  doc: Document;
  events: Emitter<UIEvents>;
  store: KeyValueStore | null;
  getSettings(): UISettings;
  updateSettings(patch: Partial<UISettings>): void;
  /** Opens an overlay or base screen by name (used by screen buttons). */
  open(screen: 'settings' | 'pause'): void;
  /** Closes an overlay. */
  close(screen: 'settings' | 'pause' | 'error'): void;
}

export interface Screen<P> {
  readonly el: HTMLElement;
  show(props: P): void;
  hide?(): void;
}

/** Moves focus to the element without scrolling, for keyboard and gamepad players. Skipped on touch screens,
 *  where a focus ring on a button nobody pressed only looks like a bug. */
export function focusSoon(el: HTMLElement | null): void {
  if (!el || matchMedia('(pointer: coarse)').matches) return;
  requestAnimationFrame(() => el.focus({ preventScroll: true }));
}
