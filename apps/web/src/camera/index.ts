// Camera (#6): third-person follow camera with drag-to-orbit, intro flyover and spectate.
// See README.md for usage.
export {
  FOLLOW_DEFAULTS,
  createFollowCamera,
  type CameraLike,
  type FollowCamera,
  type FollowCameraOptions,
  type PositionProvider,
} from './followCamera.ts';
export { DEFAULT_FRAMING, computeFraming, horizontalFov, type Framing, type FramingOptions } from './framing.ts';
export {
  ORBIT_BLOCK_SELECTOR,
  ORBIT_DEFAULTS,
  attachOrbitControls,
  type OrbitControls,
  type OrbitControlsOptions,
} from './orbitControls.ts';
