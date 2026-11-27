// Fixed-timestep accumulator. Pure and DOM-free so it can be unit-tested and reused headless.
// Simulation time never depends on frame rate: every step is exactly 1/hz seconds.

export type FixedStepFn = (dt: number, simTime: number) => void;

export interface FixedLoop {
  /** Seconds per simulation step (1 / hz). */
  readonly step: number;
  /** Simulation time in seconds at the end of the last step run. Monotonic. */
  readonly simTime: number;
  /** Total steps run since creation or reset(). */
  readonly stepCount: number;
  /** Fraction (0..1) of a step left in the accumulator, for render interpolation. */
  readonly alpha: number;
  /** Steps run by the last advance() call. */
  readonly stepsLastAdvance: number;
  /** Steps discarded because a frame needed more than the catch-up limit. */
  readonly droppedSteps: number;
  /**
   * Feed real elapsed time and run every whole step that fits, up to the catch-up limit.
   * @param frameDt elapsed seconds since the previous call
   * @param maxSteps override the catch-up limit for this call (e.g. while the tab is hidden)
   * @returns the number of steps run
   */
  advance(frameDt: number, maxSteps?: number): number;
  reset(): void;
}

export interface FixedLoopOptions {
  hz: number;
  /** Most steps run per advance() call; the rest is dropped so a slow frame cannot spiral. Default 5. */
  maxSteps?: number;
  onStep: FixedStepFn;
}

export function createFixedLoop({ hz, maxSteps = 5, onStep }: FixedLoopOptions): FixedLoop {
  if (!(hz > 0)) throw new Error(`createFixedLoop: hz must be positive, got ${hz}`);
  const step = 1 / hz;
  // Tolerance so float error (e.g. 1.0 - 60 x 1/60) never loses a whole step.
  const eps = step * 1e-6;
  let acc = 0;
  let stepCount = 0;
  let stepsLast = 0;
  let dropped = 0;

  return {
    step,
    get simTime() {
      // Derived from the integer count so it never accumulates floating-point drift.
      return stepCount * step;
    },
    get stepCount() {
      return stepCount;
    },
    get alpha() {
      return Math.min(1, acc / step);
    },
    get stepsLastAdvance() {
      return stepsLast;
    },
    get droppedSteps() {
      return dropped;
    },
    advance(frameDt, limit = maxSteps) {
      if (frameDt > 0 && Number.isFinite(frameDt)) acc += frameDt;
      let n = 0;
      while (acc >= step - eps && n < limit) {
        acc = Math.max(0, acc - step);
        stepCount++;
        n++;
        onStep(step, stepCount * step);
      }
      if (acc >= step - eps) {
        // Too far behind: drop whole steps, keep the fractional remainder for a smooth alpha.
        const skip = Math.floor((acc + eps) / step);
        dropped += skip;
        acc = Math.max(0, acc - skip * step);
      }
      stepsLast = n;
      return n;
    },
    reset() {
      acc = 0;
      stepCount = 0;
      stepsLast = 0;
      dropped = 0;
    },
  };
}
