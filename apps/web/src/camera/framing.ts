// Aspect-aware framing (pure). Phones are played in portrait as often as landscape; a fixed vertical
// FOV in portrait leaves a sliver of horizontal view, so obstacles to the side and ahead fall out of
// frame. In portrait we widen the vertical FOV until a minimum horizontal FOV is kept (up to a cap),
// pull the camera back and raise it, and aim further ahead.

export interface FramingOptions {
  /** Vertical FOV in landscape, degrees. */
  baseFov: number;
  /** Horizontal FOV kept at any aspect, degrees (limited by maxFov). */
  minHorizontalFov: number;
  /** Upper bound for the vertical FOV, degrees. */
  maxFov: number;
  /** Camera distance from the focus point in landscape, metres. */
  distance: number;
  /** Default pitch (elevation above the focus) in landscape, radians. */
  pitch: number;
  /** Extra distance in full portrait (aspect -> 0), as a fraction of `distance`. */
  portraitPull: number;
  /** Extra pitch in full portrait, radians. */
  portraitRaise: number;
  /** Extra aim-ahead in full portrait, metres. */
  portraitAhead: number;
}

export const DEFAULT_FRAMING: Readonly<FramingOptions> = {
  baseFov: 60,
  minHorizontalFov: 66,
  maxFov: 84,
  distance: 6.5,
  pitch: 0.32,
  portraitPull: 0.6,
  portraitRaise: 0.14,
  portraitAhead: 2.5,
};

export interface Framing {
  /** Vertical FOV, degrees. */
  fov: number;
  distance: number;
  pitch: number;
  /** Extra metres to aim ahead of the focus point. */
  ahead: number;
}

const DEG = Math.PI / 180;

/** Framing for a viewport aspect (width / height). Writes into `out` and returns it. */
export function computeFraming(aspect: number, opts: Readonly<FramingOptions>, out: Framing): Framing {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const needed = (2 * Math.atan(Math.tan((opts.minHorizontalFov * DEG) / 2) / a)) / DEG;
  out.fov = Math.min(opts.maxFov, Math.max(opts.baseFov, needed));
  // 0 in landscape (aspect >= 1), rising to 1 as the screen gets taller than wide.
  const portrait = a >= 1 ? 0 : 1 - a;
  out.distance = opts.distance * (1 + opts.portraitPull * portrait);
  out.pitch = opts.pitch + opts.portraitRaise * portrait;
  out.ahead = opts.portraitAhead * portrait;
  return out;
}

/** Horizontal FOV in degrees for a vertical FOV and aspect. */
export function horizontalFov(fov: number, aspect: number) {
  return (2 * Math.atan(Math.tan((fov * DEG) / 2) * aspect)) / DEG;
}
