// Game flow (#26): the one place that changes what the player is doing.
//   boot -> title -> (lobby ->) loading -> countdown -> race -> finished -> title, with pause as an overlay.
// Pure and DOM-free; the game wires UI events and race events into it.

export type Phase = 'title' | 'lobby' | 'loading' | 'countdown' | 'race' | 'finished';

export interface FlowState {
  phase: Phase;
  paused: boolean;
}

export type FlowEvent =
  | { type: 'playSolo' }
  | { type: 'playOnline' }
  | { type: 'matchStart' }
  | { type: 'loaded' }
  | { type: 'go' }
  | { type: 'finish' }
  | { type: 'restart' }
  | { type: 'leave' }
  | { type: 'pause' }
  | { type: 'resume' };

/** Next state for an event, or null when the event does not apply in this state. */
export function transition(s: FlowState, e: FlowEvent): FlowState | null {
  switch (e.type) {
    case 'playSolo':
      return s.phase === 'title' ? { phase: 'loading', paused: false } : null;
    case 'playOnline':
      return s.phase === 'title' ? { phase: 'lobby', paused: false } : null;
    case 'matchStart':
      return s.phase === 'lobby' ? { phase: 'loading', paused: false } : null;
    case 'loaded':
      return s.phase === 'loading' ? { phase: 'countdown', paused: false } : null;
    case 'go':
      return s.phase === 'countdown' && !s.paused ? { phase: 'race', paused: false } : null;
    case 'finish':
      return s.phase === 'race' ? { phase: 'finished', paused: false } : null;
    case 'restart':
      return s.phase === 'countdown' || s.phase === 'race' || s.phase === 'finished'
        ? { phase: 'countdown', paused: false }
        : null;
    case 'leave':
      return s.phase === 'title' ? null : { phase: 'title', paused: false };
    case 'pause':
      return (s.phase === 'countdown' || s.phase === 'race') && !s.paused ? { ...s, paused: true } : null;
    case 'resume':
      return s.paused ? { ...s, paused: false } : null;
  }
}

export interface Flow {
  readonly state: Readonly<FlowState>;
  /** Apply an event; returns true if the state changed. */
  dispatch(e: FlowEvent): boolean;
  onChange(fn: (next: Readonly<FlowState>, prev: Readonly<FlowState>, e: FlowEvent) => void): () => void;
}

export function createFlow(initial: FlowState = { phase: 'title', paused: false }): Flow {
  let state = initial;
  const listeners = new Set<(n: FlowState, p: FlowState, e: FlowEvent) => void>();
  return {
    get state() {
      return state;
    },
    dispatch(e) {
      const next = transition(state, e);
      if (!next) return false;
      const prev = state;
      state = next;
      for (const fn of listeners) fn(state, prev, e);
      return true;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
