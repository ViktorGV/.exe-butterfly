// Client/server clock sync over the `ping{c}` / `pong{c,s}` control messages (docs/CONTRACTS.md §6).
// Pure and transport-agnostic: the caller sends pings and forwards pongs, so it can be unit-tested
// with a fake clock and a fake network.
//
// Algorithm (min-RTT sampling, NTP-style):
// - start(): a burst of `burst` pings, `burstGapMs` apart. Each pong gives
//   rtt = now - c and an offset sample s - (c + rtt / 2). During the burst the lowest-RTT sample wins
//   and is applied directly.
// - Then every `resyncEveryMs`, a round of `resyncCount` pings. Samples with rtt > 2x the best recent
//   RTT are ignored. The target offset is the lowest-RTT sample among the recent accepted ones (up
//   to 8, at most 3 re-sync periods old; NTP-style clock filter), so one unlucky round of 3 pings
//   cannot drag the estimate around, yet a changed server clock is picked up within ~3 rounds.
// - The applied offset slews toward the target by at most `maxSlewMsPerSec`, and serverNow() never
//   returns less than its previous value, so server time never jumps backwards once synced.

export interface ClockSyncOptions {
  /** Send `ping{c}` to the server. `c` is this clock's local time at send. */
  sendPing(c: number): void;
  /**
   * Local clock in ms. Default `performance.timeOrigin + performance.now()`: monotonic within the
   * page (immune to wall-clock changes) yet epoch-based, so it sits close to the server's
   * `Date.now()` and the offset stays small. Any drift against the server is absorbed by re-syncs.
   */
  now?: () => number;
  /** Timer hooks, injectable for tests. Default setTimeout / clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Pings in the initial burst. Default 8. */
  burst?: number;
  /** Gap between pings in a burst or re-sync round, in ms. Default 100. */
  burstGapMs?: number;
  /** Time between re-sync rounds, in ms. Default 10000. */
  resyncEveryMs?: number;
  /** Pings per re-sync round. Default 3. */
  resyncCount?: number;
  /** Fastest the applied offset may move toward a new target, in ms per second. Default 5. */
  maxSlewMsPerSec?: number;
}

export interface ClockSync {
  /** Begin syncing (initial burst, then periodic re-syncs). No-op if already running. */
  start(): void;
  /** Cancel all timers and forget outstanding pings. The current offset is kept. */
  stop(): void;
  /** Feed a `pong{c,s}`. Pongs whose `c` does not match an outstanding ping are ignored. */
  onPong(c: number, s: number): void;
  /** Estimated server time in ms (server `Date.now()` scale). Monotonic non-decreasing once synced. */
  serverNow(): number;
  /** RTT in ms of the sample behind the current offset target; 0 until synced. */
  rttMs(): number;
  /** True once at least one pong has been applied. */
  readonly synced: boolean;
}

/** RTT history used for the "2x best recent RTT" outlier test (covers about 5 re-sync rounds). */
const RTT_WINDOW = 16;
/** Accepted samples the target is picked from (covers a whole burst). */
const SAMPLE_WINDOW = 8;
/** Most pings kept waiting for a pong; older ones are presumed lost. */
const MAX_OUTSTANDING = 32;

export function createClockSync({
  sendPing,
  now = () => performance.timeOrigin + performance.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  burst = 8,
  burstGapMs = 100,
  resyncEveryMs = 10000,
  resyncCount = 3,
  maxSlewMsPerSec = 5,
}: ClockSyncOptions): ClockSync {
  const outstanding: number[] = []; // send times (c) of pings awaiting a pong, oldest first
  const rttHist = new Float64Array(RTT_WINDOW);
  let rttHistLen = 0;
  let rttHistPos = 0;
  const sampleRtt = new Float64Array(SAMPLE_WINDOW);
  const sampleOffset = new Float64Array(SAMPLE_WINDOW);
  const sampleAt = new Float64Array(SAMPLE_WINDOW);
  const sampleMaxAgeMs = 3 * resyncEveryMs;
  let sampleLen = 0;
  let samplePos = 0;

  let running = false;
  let timer: unknown = undefined;
  let lastC = -Infinity;

  let synced = false;
  let initial = true; // true until the first re-sync round starts
  let applied = 0; // offset used by serverNow()
  let target = 0; // offset we are slewing toward
  let targetRtt = 0;
  let slewAt = 0; // local time the applied offset was last advanced
  let lastServerNow = -Infinity;

  function slew(t: number): void {
    const dt = t - slewAt;
    slewAt = t;
    if (dt <= 0 || applied === target) return;
    const maxStep = (maxSlewMsPerSec * dt) / 1000;
    const diff = target - applied;
    applied = Math.abs(diff) <= maxStep ? target : applied + Math.sign(diff) * maxStep;
  }

  function bestRecentRtt(): number {
    let best = Infinity;
    for (let i = 0; i < rttHistLen; i++) if (rttHist[i] < best) best = rttHist[i];
    return best;
  }

  function recordRtt(rtt: number): void {
    rttHist[rttHistPos] = rtt;
    rttHistPos = (rttHistPos + 1) % RTT_WINDOW;
    if (rttHistLen < RTT_WINDOW) rttHistLen++;
  }

  /** Add an accepted sample and point the target at the lowest-RTT sample in the window. */
  function addSample(t: number, rtt: number, offset: number): void {
    let best = samplePos; // the newest sample always qualifies
    sampleRtt[samplePos] = rtt;
    sampleOffset[samplePos] = offset;
    sampleAt[samplePos] = t;
    samplePos = (samplePos + 1) % SAMPLE_WINDOW;
    if (sampleLen < SAMPLE_WINDOW) sampleLen++;
    for (let i = 0; i < sampleLen; i++) {
      if (sampleAt[i] >= t - sampleMaxAgeMs && sampleRtt[i] < sampleRtt[best]) best = i;
    }
    targetRtt = sampleRtt[best];
    target = sampleOffset[best];
  }

  function ping(): void {
    let c = now();
    if (c <= lastC) c = lastC + 1e-3; // keep every outstanding c unique
    lastC = c;
    outstanding.push(c);
    if (outstanding.length > MAX_OUTSTANDING) outstanding.shift();
    sendPing(c);
  }

  /** Send `count` pings `burstGapMs` apart, then schedule the next re-sync round. */
  function sendRound(count: number): void {
    let left = count;
    const next = (): void => {
      if (!running) return;
      ping();
      left--;
      timer = left > 0 ? setTimer(next, burstGapMs) : setTimer(beginResync, resyncEveryMs);
    };
    next();
  }

  function beginResync(): void {
    if (!running) return;
    if (synced) initial = false;
    sendRound(initial ? burst : resyncCount);
  }

  return {
    start() {
      if (running) return;
      running = true;
      initial = !synced;
      sendRound(initial ? burst : resyncCount);
    },

    stop() {
      running = false;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
      outstanding.length = 0;
    },

    onPong(c, s) {
      const idx = outstanding.indexOf(c);
      if (idx < 0) return;
      outstanding.splice(idx, 1);

      const t = now();
      const rtt = Math.max(0, t - c);
      const sample = s - (c + rtt / 2);
      const bestRecent = bestRecentRtt();
      recordRtt(rtt);

      if (!initial && rtt > 2 * bestRecent) return; // outlier: queued or asymmetric path
      if (synced) slew(t); // bank the slew up to now before the target moves
      addSample(t, rtt, sample);

      if (!synced) {
        synced = true;
        applied = target;
        slewAt = t;
        lastServerNow = -Infinity;
      } else if (initial) {
        applied = target; // still in the first burst: apply directly (serverNow() stays monotonic)
      }
    },

    serverNow() {
      const t = now();
      if (!synced) return t;
      slew(t);
      let v = t + applied;
      if (v < lastServerNow) v = lastServerNow;
      lastServerNow = v;
      return v;
    },

    rttMs() {
      return synced ? targetRtt : 0;
    },

    get synced() {
      return synced;
    },
  };
}
