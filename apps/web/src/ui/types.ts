// Public types of the UI module.
import type { UISettings } from './settings.ts';

export type Device = 'touch' | 'keyboard' | 'gamepad';

export interface UIEvents {
  'play:quick': { name: string };
  'play:join': { name: string; code: string };
  'play:create': { name: string };
  'play:solo': { name: string };
  restart: undefined;
  leave: undefined;
  resume: undefined;
  /** The full settings after the change. */
  'settings:change': UISettings;
  /** Extra (not in the §8 list): the pause button or Esc opened the pause screen. */
  pause: undefined;
  /** Extra (not in the §8 list): "Try again" on the error modal. */
  retry: undefined;
}

export type UIEventName = keyof UIEvents;

export interface TitleProps {
  /** Event mode labels the name field "Your username". */
  eventMode?: boolean;
  name?: string;
}

export interface LoadingProps {
  /** 0..1; omit for an indeterminate bar. */
  progress?: number;
  label?: string;
}

export interface CountdownProps {
  /** Show one value: 3, 2, 1, or 0 for GO. */
  value?: number;
  /** Or run the countdown locally for this many ms (GO when it reaches zero). */
  msLeft?: number;
}

export interface HudProps {
  /** Solo hides place and qualified, and the pause screen offers Restart. */
  solo?: boolean;
  checkpoints?: number;
  totalPlayers?: number;
  qualifyMax?: number;
  /** Shows control hints for this device for the first few seconds. */
  device?: Device;
}

export interface PauseProps {
  solo?: boolean;
}

export type FinishKind = 'qualified' | 'finished' | 'timeup' | 'eliminated';

export interface FinishProps {
  kind: FinishKind;
  timeMs?: number | null;
  bestMs?: number | null;
  newBest?: boolean;
}

export interface ResultRow {
  id: number;
  name: string;
  place: number;
  timeMs: number | null;
  qualified?: boolean;
}

export interface ResultsProps {
  /** Sorted by place. */
  rows: readonly ResultRow[];
  localId?: number;
  solo?: boolean;
}

export interface ErrorProps {
  kind?: 'error' | 'reconnecting';
  title?: string;
  message?: string;
  canRetry?: boolean;
}

export interface ScreenProps {
  none: undefined;
  title: TitleProps;
  lobby: undefined;
  loading: LoadingProps;
  hud: HudProps;
  results: ResultsProps;
  countdown: CountdownProps;
  pause: PauseProps;
  settings: undefined;
  finish: FinishProps;
  error: ErrorProps;
}

export type ScreenName = keyof ScreenProps;

/** Screens that replace each other. */
export const BASE_SCREENS = Object.freeze(['none', 'title', 'lobby', 'loading', 'hud', 'results'] as const);
/** Screens shown on top of the current base screen. */
export const OVERLAY_SCREENS = Object.freeze(['countdown', 'pause', 'settings', 'finish', 'error'] as const);

export type BaseScreen = (typeof BASE_SCREENS)[number];
export type OverlayScreen = (typeof OVERLAY_SCREENS)[number];

export function isOverlay(name: ScreenName): name is OverlayScreen {
  return (OVERLAY_SCREENS as readonly string[]).includes(name);
}
