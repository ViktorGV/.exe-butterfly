// Small, allocation-free 2D helpers shared by every input device.

/** Scale (x, y) down so it lies inside the unit circle (diagonals are not faster). Writes into out. */
export function clampToUnitCircle(x: number, y: number, out: [number, number]): [number, number] {
  const m = Math.hypot(x, y);
  if (m > 1) {
    out[0] = x / m;
    out[1] = y / m;
  } else {
    out[0] = x;
    out[1] = y;
  }
  return out;
}

/**
 * Radial dead zone with rescaling: magnitudes below `deadzone` become 0, the rest is remapped
 * to 0..1 so there is no jump at the edge of the dead zone. Writes into out.
 */
export function applyRadialDeadzone(x: number, y: number, deadzone: number, out: [number, number]): [number, number] {
  const m = Math.hypot(x, y);
  if (!(m > deadzone)) {
    out[0] = 0;
    out[1] = 0;
    return out;
  }
  const scaled = Math.min(1, (m - deadzone) / (1 - deadzone));
  out[0] = (x / m) * scaled;
  out[1] = (y / m) * scaled;
  return out;
}

/**
 * Virtual joystick: screen-space drag (dx right, dy DOWN, in px) -> movement with y UP positive.
 * `radius` is the drag distance for full deflection.
 */
export function joystickVector(
  dx: number,
  dy: number,
  radius: number,
  deadzone: number,
  out: [number, number],
): [number, number] {
  return applyRadialDeadzone(dx / radius, -dy / radius, deadzone, out);
}
