// Rolling frame-time statistics with fixed storage (no allocation per sample or per query).

export interface FrameStats {
  push(frameMs: number): void;
  /** Average frames per second over the window. */
  fps(): number;
  /** Frame time percentile in ms, p in 0..100. */
  percentile(p: number): number;
  readonly count: number;
  reset(): void;
}

export function createFrameStats(windowSize = 120): FrameStats {
  const samples = new Float32Array(windowSize);
  const scratch = new Float32Array(windowSize);
  let head = 0;
  let count = 0;

  return {
    push(frameMs) {
      if (!(frameMs >= 0) || !Number.isFinite(frameMs)) return;
      samples[head] = frameMs;
      head = (head + 1) % windowSize;
      if (count < windowSize) count++;
    },
    fps() {
      if (count === 0) return 0;
      let sum = 0;
      for (let i = 0; i < count; i++) sum += samples[i];
      return sum > 0 ? (1000 * count) / sum : 0;
    },
    percentile(p) {
      if (count === 0) return 0;
      // Copy and insertion-sort in place: no views, no engine sort buffers (runs a few times a second).
      for (let i = 0; i < count; i++) {
        const v = samples[i];
        let j = i - 1;
        while (j >= 0 && scratch[j] > v) {
          scratch[j + 1] = scratch[j];
          j--;
        }
        scratch[j + 1] = v;
      }
      const idx = Math.min(count - 1, Math.max(0, Math.ceil((p / 100) * count) - 1));
      return scratch[idx];
    },
    get count() {
      return count;
    },
    reset() {
      head = 0;
      count = 0;
    },
  };
}
