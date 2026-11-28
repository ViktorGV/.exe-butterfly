// Which way the wind blows on the player's screen, for the on-screen wind arrow. Pure.
const TAU = Math.PI * 2;

export interface WindOnScreen {
  /** Radians on the screen: 0 = blowing to the right, +PI / 2 = blowing away from you (up the screen). */
  angle: number;
  /** Wind speed, m/s. */
  speed: number;
}

/** The wind (world x, z, m/s) as the player sees it, with the camera facing `cameraYaw` (0 faces -Z). */
export function windOnScreen(windX: number, windZ: number, cameraYaw: number, out?: WindOnScreen): WindOnScreen {
  const r = out ?? { angle: 0, speed: 0 };
  const c = Math.cos(cameraYaw);
  const s = Math.sin(cameraYaw);
  // the camera's forward is (-sin, -cos) and its right is (cos, -sin), on the floor
  const forward = -windX * s - windZ * c;
  const right = windX * c - windZ * s;
  r.angle = Math.atan2(forward, right);
  r.speed = Math.hypot(windX, windZ);
  return r;
}

/** The angle in degrees for a CSS `rotate()` of an arrow that points right at 0 (CSS turns clockwise). */
export const cssRotation = (angle: number): number => -((angle % TAU) * 180) / Math.PI;
