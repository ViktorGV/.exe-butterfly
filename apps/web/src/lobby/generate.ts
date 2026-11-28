// Skin generation state machine (#12): idle -> generating -> preview -> equipped, plus friendly error states.
import { LIMITS } from '@wobble/shared/constants';
import type { Pack } from '@wobble/shared';
import type { GenerateFailure } from './types.ts';

export type GenState =
  | { s: 'idle' }
  | { s: 'generating'; prompt: string }
  | { s: 'preview'; pack: Pack }
  | { s: 'equipped'; pack: Pack }
  | { s: 'rateLimited'; retryAt: number }
  | { s: 'refused'; message: string }
  | { s: 'unavailable' }
  | { s: 'error'; message: string };

export type GenEvent =
  | { e: 'submit'; prompt: string }
  | { e: 'done'; pack: Pack }
  | { e: 'fail'; err: unknown; now: number }
  | { e: 'equip' }
  | { e: 'reset' }
  | { e: 'tick'; now: number };

/** Collapses whitespace and clamps a prompt to LIMITS.promptMax characters. */
export function cleanPrompt(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, LIMITS.promptMax);
}

export function promptCounter(raw: string): string {
  return `${Math.min(raw.length, LIMITS.promptMax)} / ${LIMITS.promptMax}`;
}

function isFailure(err: unknown): err is GenerateFailure {
  return typeof err === 'object' && err !== null && typeof (err as GenerateFailure).status === 'number';
}

/** Maps a failed generate call to a state. Anything that is not an HTTP failure counts as unavailable. */
export function failureState(err: unknown, now: number): GenState {
  if (!isFailure(err)) return { s: 'unavailable' };
  if (err.status === 429) return { s: 'rateLimited', retryAt: now + Math.max(1, err.retryAfterSec ?? 30) * 1000 };
  if (err.status === 422) return { s: 'refused', message: err.message ?? "We can't make that one. Try another idea." };
  if (err.status === 503 || err.status === 0) return { s: 'unavailable' };
  return { s: 'error', message: err.message ?? 'Something went wrong.' };
}

export function canSubmit(st: GenState): boolean {
  return st.s !== 'generating' && st.s !== 'rateLimited';
}

export function genReduce(st: GenState, ev: GenEvent): GenState {
  switch (ev.e) {
    case 'submit': {
      const prompt = cleanPrompt(ev.prompt);
      return canSubmit(st) && prompt ? { s: 'generating', prompt } : st;
    }
    case 'done':
      return st.s === 'generating' ? { s: 'preview', pack: ev.pack } : st;
    case 'fail':
      return st.s === 'generating' ? failureState(ev.err, ev.now) : st;
    case 'equip':
      return st.s === 'preview' ? { s: 'equipped', pack: st.pack } : st;
    case 'reset':
      return st.s === 'generating' || st.s === 'rateLimited' ? st : { s: 'idle' };
    case 'tick':
      return st.s === 'rateLimited' && ev.now >= st.retryAt ? { s: 'idle' } : st;
  }
}

export function retryInSec(st: GenState, now: number): number {
  return st.s === 'rateLimited' ? Math.max(0, Math.ceil((st.retryAt - now) / 1000)) : 0;
}
