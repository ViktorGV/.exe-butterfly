// Render quality: one setting for every device (the former 'medium' preset).

export interface QualitySettings {
  /** Upper bound for the device pixel ratio. */
  dprCap: number;
  shadows: boolean;
  /** Shadow map width and height in texels. */
  shadowMapSize: number;
  /** Camera far plane in metres. */
  far: number;
  /** Applied when the renderer is created. */
  antialias: boolean;
}

export const QUALITY: Readonly<QualitySettings> = Object.freeze({
  dprCap: 1.5,
  shadows: true,
  shadowMapSize: 1024,
  far: 400,
  antialias: true,
});

/** Effective pixel ratio for a device. */
export function pixelRatioFor(devicePixelRatio: number): number {
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  return Math.min(dpr, QUALITY.dprCap);
}
