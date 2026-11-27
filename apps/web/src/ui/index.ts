// UI shell (#11): every screen outside the lobby, as plain HTML/CSS over the canvas.
// Nothing touches the DOM at import time; createUI(root) builds everything inside `root`.
import { accentVars, hudFontStack } from './colors.ts';
import { createEmitter, type Listener } from './emitter.ts';
import { h } from './dom.ts';
import type { Screen, ScreenContext } from './screens/context.ts';
import { createHud, type HudApi } from './screens/hud.ts';
import {
  createCountdownScreen,
  createErrorScreen,
  createFinishScreen,
  createLoadingScreen,
} from './screens/overlays.ts';
import { createResultsScreen } from './screens/results.ts';
import { createSettingsPanel } from './screens/settings.ts';
import { createTitleScreen } from './screens/title.ts';
import { loadSettings, normalizeSettings, saveSettings, type KeyValueStore, type UISettings } from './settings.ts';
import {
  BASE_SCREENS,
  isOverlay,
  OVERLAY_SCREENS,
  type BaseScreen,
  type OverlayScreen,
  type ScreenName,
  type ScreenProps,
  type UIEvents,
} from './types.ts';

export type * from './types.ts';
export type { HudApi } from './screens/hud.ts';
export type { UISettings } from './settings.ts';
export { DEFAULT_SETTINGS } from './settings.ts';
export { formatTime } from './format.ts';
export { STRINGS } from './strings.ts';

export interface UI {
  /** Shows a screen. Base screens (title, lobby, loading, hud, results, none) replace each other and close
   *  every overlay; overlays (countdown, pause, settings, finish, error) stack on the current base. */
  show<S extends ScreenName>(screen: S, props?: ScreenProps[S]): void;
  /** Closes an overlay. */
  hide(screen: OverlayScreen): void;
  /** Named containers other modules fill. 'lobby' is the lobby screen (#12). */
  getSlot(name: 'lobby'): HTMLElement;
  readonly hud: HudApi;
  on<K extends keyof UIEvents>(evt: K, fn: Listener<UIEvents[K]>): () => void;
  readonly settings: Readonly<UISettings>;
  readonly current: BaseScreen;
  /** Tints the UI from the active theme. Invalid colours are ignored (returns false). */
  setAccent(hex: string): boolean;
  /** One of the bundled HUD fonts: rounded, blocky, handwritten, pixel, serif. */
  setHudFont(name: string): boolean;
  dispose(): void;
}

export interface CreateUIOptions {
  /** Where name and settings are remembered. Defaults to localStorage when available. */
  store?: KeyValueStore | null;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function createUI(root: HTMLElement, options: CreateUIOptions = {}): UI {
  const doc = root.ownerDocument;
  const docEl = doc.documentElement;
  const store = options.store === undefined ? defaultStore() : options.store;
  const events = createEmitter<UIEvents>();
  let settings = loadSettings(store);

  const layer = h(doc, 'div', { class: 'wr-ui' });
  root.appendChild(layer);

  const ctx: ScreenContext = {
    doc,
    events,
    store,
    getSettings: () => settings,
    updateSettings(patch) {
      settings = normalizeSettings({ ...settings, ...patch });
      saveSettings(store, settings);
      events.emit('settings:change', settings);
    },
    open(screen) {
      if (screen === 'pause') {
        if (current !== 'hud' || overlays.has('pause')) return;
        ui.show('pause', { solo: hudSolo });
        events.emit('pause', undefined);
      } else ui.show('settings');
    },
    close: (screen) => ui.hide(screen),
  };

  const lobby = h(doc, 'section', { class: 'wr-screen wr-lobby' });
  const hud = createHud(ctx);
  const screens: { [K in Exclude<ScreenName, 'none' | 'lobby'>]: Screen<ScreenProps[K]> } = {
    title: createTitleScreen(ctx),
    loading: createLoadingScreen(ctx),
    hud,
    results: createResultsScreen(ctx),
    countdown: createCountdownScreen(ctx, () => ui.hide('countdown')),
    pause: createSettingsPanel(ctx, 'pause'),
    settings: createSettingsPanel(ctx, 'settings'),
    finish: createFinishScreen(ctx),
    error: createErrorScreen(ctx),
  };
  const screenOf = (name: ScreenName): Screen<unknown> | null =>
    name === 'none' || name === 'lobby' ? null : (screens[name] as Screen<unknown>);
  const elementOf = (name: ScreenName): HTMLElement | null => (name === 'lobby' ? lobby : (screenOf(name)?.el ?? null));

  for (const name of [...BASE_SCREENS, ...OVERLAY_SCREENS]) {
    if (name === 'none') continue;
    const el = elementOf(name)!;
    el.hidden = true;
    el.dataset.screen = name;
    layer.appendChild(el);
  }

  let current: BaseScreen = 'none';
  let hudSolo = false;
  const overlays = new Set<OverlayScreen>();
  let lastFocus: HTMLElement | null = null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.repeat) return;
    if (overlays.has('settings')) ui.hide('settings');
    else if (overlays.has('pause')) {
      ui.hide('pause');
      events.emit('resume', undefined);
    } else if (current === 'hud' && !overlays.has('error')) ctx.open('pause');
    else return;
    e.preventDefault();
  };
  doc.addEventListener('keydown', onKey);

  const ui: UI = {
    show(screen, props) {
      if (isOverlay(screen)) {
        const el = elementOf(screen)!;
        if (!overlays.size && doc.activeElement instanceof HTMLElement) lastFocus = doc.activeElement;
        overlays.add(screen);
        el.hidden = false;
        layer.appendChild(el); // newest overlay on top
        screenOf(screen)!.show(props);
        syncState();
        return;
      }
      for (const o of [...overlays]) ui.hide(o);
      if (current !== screen) {
        const prev = elementOf(current);
        if (prev) prev.hidden = true;
        screenOf(current)?.hide?.();
      }
      current = screen as BaseScreen;
      if (screen === 'hud') hudSolo = !!(props as ScreenProps['hud'])?.solo;
      const el = elementOf(screen);
      if (el) el.hidden = false;
      screenOf(screen)?.show(props);
      syncState();
    },
    hide(screen) {
      if (!overlays.delete(screen)) return;
      screens[screen].el.hidden = true;
      screens[screen].hide?.();
      syncState();
      if (!overlays.size && lastFocus?.isConnected && !lastFocus.hidden) lastFocus.focus({ preventScroll: true });
    },
    getSlot(name) {
      if (name !== 'lobby') throw new Error(`getSlot: unknown slot "${String(name)}"`);
      return lobby;
    },
    hud: hud.api,
    on: (evt, fn) => events.on(evt, fn),
    get settings() {
      return settings;
    },
    get current() {
      return current;
    },
    setAccent(hex) {
      const vars = accentVars(hex);
      if (!vars) return false;
      for (const k in vars) docEl.style.setProperty(k, vars[k as keyof typeof vars]);
      return true;
    },
    setHudFont(name) {
      const stack = hudFontStack(name);
      if (!stack) return false;
      docEl.style.setProperty('--hud-font', stack);
      return true;
    },
    dispose() {
      doc.removeEventListener('keydown', onKey);
      for (const o of [...overlays]) ui.hide(o);
      screens.hud.hide?.();
      events.clear();
      layer.remove();
    },
  };

  /** Mirrors state to data attributes so CSS can, e.g., dim the HUD under a modal. */
  function syncState() {
    layer.dataset.base = current;
    layer.dataset.countdown = overlays.has('countdown') ? 'true' : 'false';
    layer.dataset.modal = overlays.has('pause') || overlays.has('settings') || overlays.has('error') ? 'true' : 'false';
    // Hide what is underneath a modal from assistive tech and keyboard focus.
    const modalOpen = layer.dataset.modal === 'true';
    const base = elementOf(current);
    if (base) base.inert = modalOpen;
  }

  return ui;
}
