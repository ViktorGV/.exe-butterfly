// Fading platforms: moving platforms with `fade: true`. Landing on one (a player or a bot) starts a FADE.WARN_S
// wobble, then the platform drops away for FADE.GONE_S and comes back. Who stepped where is not a function of race
// time, so its pose asks a fade source (set by the game) how long ago it was triggered; with no source (server, lint,
// tests) a fading platform is a plain one. fadeTouch.ts finds which one someone is standing on.
//
//   const fade = createFadeClock();
//   setFadeSource((id, t) => fade.since(id, t));
//   if (fade.trigger(tileId, raceTimeSec)) publish(...);   // the first touch only; ignored while it is down
//
// Online the server detects the touches from everyone's positions and tells the room (`fade`); solo the game
// checks the player and its bots itself.

/** Seconds a touched tile wobbles before it drops, and seconds it stays gone before coming back. */
export const FADE = Object.freeze({ WARN_S: 3, GONE_S: 5 });
/** How far a gone tile drops (out of reach and out of sight). */
const DROP_M = 600;

type FadeSource = (id: number, t: number) => number;
let source: FadeSource | null = null;

/** Where fading tiles read their state from (the game's fade clock); null turns fading off. */
export function setFadeSource(fn: FadeSource | null): void {
  source = fn;
}

/** Seconds since entity `id` was triggered, or -1 when it is solid and untouched (or there is no source). */
export function fadeSince(id: number, t: number): number {
  return source ? source(id, t) : -1;
}

/** Offsets for a fading tile at race time t: a growing wobble while it warns, then far below while gone. */
export function fadeOffset(id: number, t: number, out: { x: number; y: number }): { x: number; y: number } {
  const s = fadeSince(id, t);
  out.x = 0;
  out.y = 0;
  if (s < 0) return out;
  if (s >= FADE.WARN_S) {
    out.y = -DROP_M;
    return out;
  }
  const k = s / FADE.WARN_S;
  out.x = Math.sin(s * 40) * 0.08 * k;
  out.y = -0.08 * k;
  return out;
}

/** True while tile `id` is gone at race time t (nothing to stand on). */
export const fadeGone = (id: number, t: number): boolean => fadeSince(id, t) >= FADE.WARN_S;

/** Which tiles were triggered when, in race seconds. One per race; the same rules on the server and the client. */
export function createFadeClock() {
  const at = new Map<number, number>();
  const cycle = FADE.WARN_S + FADE.GONE_S;
  return {
    /** Someone is on tile `id` at t: start its countdown. False when it is already counting down or gone. */
    trigger(id: number, t: number): boolean {
      const a = at.get(id);
      if (a !== undefined && t >= a && t < a + cycle) return false;
      at.set(id, t);
      return true;
    },
    /** Set a trigger time told by the server. */
    set(id: number, t: number): void {
      at.set(id, t);
    },
    /** Seconds since `id` was triggered while that still matters, else -1. */
    since(id: number, t: number): number {
      const a = at.get(id);
      if (a === undefined) return -1;
      const s = t - a;
      return s >= 0 && s < cycle ? s : -1;
    },
    /** A new race: every tile solid again. */
    reset(): void {
      at.clear();
    },
  };
}

export type FadeClock = ReturnType<typeof createFadeClock>;
