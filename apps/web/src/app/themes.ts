// Themes a player can pick on the title screen. Classic (the built-in theme) is the default; event themes are
// generated ahead of the event (tools/event) and shipped under public/event/. Add a theme by adding its entry.
import { DEFAULT_THEME_ID } from '@wobble/shared/assets/index';
import type { MusicDef } from '../audio/pattern.ts';

export interface ThemeChoice {
  /** Pack id: the built-in theme id, or e:theme-<slug> for an event theme */
  id: string;
  title: string;
  tagline: string;
  /** Card picture (served from public/), or null for a plain colour */
  card: string | null;
  /** Card colour behind the picture */
  color: string;
  /** Overrides on top of the theme's generated music, e.g. the cinematic sci-fi score. */
  music?: Partial<MusicDef>;
  /** A set of desk pieces built for this theme (see desk/chalga.ts), on top of the repaint. */
  desk?: 'chalga';
}

export const THEME_SLOTS = 6;

export const THEME_CHOICES: readonly ThemeChoice[] = Object.freeze([
  { id: DEFAULT_THEME_ID, title: 'Classic', tagline: 'Candy sky', card: null, color: '#7ad7ff' },
  {
    id: 'e:theme-fallen-galaxy',
    title: 'Fallen Galaxy',
    tagline: 'Apocalyptic space opera',
    card: '/event/themes/fallen-galaxy/vote-card@0.5x.webp',
    color: '#712b13',
    // A dark, mysterious battle cue: drone and ostinato, an eerie motif, then war drums and low brass.
    music: { style: 'cinematic', instrument: 'cinematic', tempo: 96 },
  },
  {
    id: 'e:theme-chalga-night',
    title: 'Chalga Night',
    tagline: 'Balkan pop-folk mega concert',
    card: '/event/themes/chalga-night/vote-card@0.5x.webp',
    color: '#ff2fa8',
    desk: 'chalga',
    // Balkan pop-folk: a kyuchek groove in A Hijaz, clarinet hook and solo, accordion stabs.
    music: { style: 'chalga', instrument: 'chalga', tempo: 128 },
  },
]);

const THEME_KEY = 'wobble.theme';

type Store = Pick<Storage, 'getItem' | 'setItem'> | null | undefined;

/** The saved choice, if it is still a known theme; otherwise Classic. */
export function loadThemeChoice(store: Store): string {
  try {
    const id = store?.getItem(THEME_KEY);
    if (id && THEME_CHOICES.some((t) => t.id === id)) return id;
  } catch {
    // storage blocked: use the default
  }
  return DEFAULT_THEME_ID;
}

export function saveThemeChoice(store: Store, id: string): void {
  try {
    store?.setItem(THEME_KEY, id);
  } catch {
    // not remembered; harmless
  }
}

/** Where an event theme's pack JSON is served, or null for a built-in theme. */
export function eventPackUrl(id: string): string | null {
  // docs/CONTRACTS.md: e:<id> is served at /event/packs/<kind>/<id>.json.
  return id.startsWith('e:theme-') ? `/event/packs/theme/${id.slice(2)}.json` : null;
}
