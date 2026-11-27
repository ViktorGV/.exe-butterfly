// Quality presets. #34 (mobile/low-end) adds automatic switching on top of these.

export type QualityPreset = 'low' | 'medium' | 'high';

export interface QualitySettings {
  /** Upper bound for the device pixel ratio. */
  dprCap: number;
  shadows: boolean;
  /** Shadow map width and height in texels. */
  shadowMapSize: number;
  /** Camera far plane in metres. */
  far: number;
  /** Applied when the renderer is created; changing it needs a new engine (WebGL limitation). */
  antialias: boolean;
}

export const QUALITY_PRESETS: Readonly<Record<QualityPreset, Readonly<QualitySettings>>> = Object.freeze({
  low: Object.freeze({ dprCap: 1, shadows: false, shadowMapSize: 512, far: 250, antialias: false }),
  medium: Object.freeze({ dprCap: 1.5, shadows: true, shadowMapSize: 1024, far: 400, antialias: true }),
  high: Object.freeze({ dprCap: 2, shadows: true, shadowMapSize: 2048, far: 600, antialias: true }),
});

export function isQualityPreset(value: unknown): value is QualityPreset {
  return value === 'low' || value === 'medium' || value === 'high';
}

/** Effective pixel ratio for a device under a preset. */
export function pixelRatioFor(preset: QualityPreset, devicePixelRatio: number): number {
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  return Math.min(dpr, QUALITY_PRESETS[preset].dprCap);
}
