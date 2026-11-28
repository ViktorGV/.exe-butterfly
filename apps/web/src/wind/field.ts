// The snow blowers' wind, as something you can see (CPU side, pure): wind streaks that blow out of each fan across
// its zone, and an intensity per fan that follows the fan's on / warning / off cycle. Allocation-free after
// construction. The view (index.ts) draws the arrays this fills; nothing here touches Three.js.
import { blowerCycleTime, blowerPhase, WIND_OFF, WIND_ON } from '@wobble/shared/course/obstacles/kinds';
import type { WindZone } from '@wobble/shared/course/obstacles/wind';

/** Streaks per fan. */
export const STREAKS_PER_ZONE = 72;
/** Streaks fly this much faster than the wind actually pushes, so the motion reads at a glance. */
export const VISUAL_SPEED = 1.6;
/** Intensity (0..1) while a fan is only warning: sparse and slow, building toward the push. */
const WARN_FROM = 0.25;
const WARN_TO = 0.75;
/** How fast a fan's intensity follows its phase, 1/s. */
const EASE_RATE = 7;

export interface WindField {
  /** Streaks in total (zones x STREAKS_PER_ZONE). */
  readonly count: number;
  /** World centre of each streak, xyz. */
  readonly pos: Float32Array;
  /** Unit direction of each streak on the floor plane (world x, z). */
  readonly dir: Float32Array;
  /** Length and thickness of each streak, metres. */
  readonly size: Float32Array;
  /** Opacity 0..1 of each streak. */
  readonly alpha: Float32Array;
  /** 0..1 per fan: 0 off, rising through the warning, 1 while blowing. */
  readonly intensity: Float32Array;
  /** Advance to race time `t`, `dt` seconds after the last call. */
  update(t: number, dt: number): void;
}

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

export function createWindField(zones: readonly WindZone[], random: () => number = Math.random): WindField {
  const n = zones.length * STREAKS_PER_ZONE;
  const pos = new Float32Array(n * 3);
  const dir = new Float32Array(n * 2);
  const size = new Float32Array(n * 2);
  const alpha = new Float32Array(n);
  const intensity = new Float32Array(zones.length);
  // per streak: where it is along the wind (u), across the zone (v), height above the floor (h), how fast it
  // flies (a factor), its length, how likely it is to show while a fan is only warning (gate), and its own opacity
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const h = new Float32Array(n);
  const speed = new Float32Array(n);
  const len = new Float32Array(n);
  const gate = new Float32Array(n);
  const base = new Float32Array(n);

  function respawn(i: number, zone: WindZone, fresh: boolean) {
    const p = zone.params;
    // fresh streaks (a fan that was idle) start spread over the first half of the zone, so a gust fills quickly
    u[i] = fresh ? random() * p.reach * 0.5 : -random() * 3;
    v[i] = (random() - 0.5) * p.width;
    h[i] = 0.3 + random() * (p.height + 0.7);
    speed[i] = 0.75 + random() * 0.6;
    len[i] = 1.6 + random() * 2.6;
    gate[i] = random();
    base[i] = 0.6 + random() * 0.4;
  }
  for (let z = 0; z < zones.length; z++) {
    for (let k = 0; k < STREAKS_PER_ZONE; k++) {
      const i = z * STREAKS_PER_ZONE + k;
      respawn(i, zones[z]!, true);
      dir[i * 2] = zones[z]!.c; // local +X turned by the yaw is (cos, 0, -sin)
      dir[i * 2 + 1] = -zones[z]!.s;
      size[i * 2] = len[i]!;
      size[i * 2 + 1] = 0.26;
    }
  }

  return {
    count: n,
    pos,
    dir,
    size,
    alpha,
    intensity,
    update(t, dt) {
      const ease = 1 - Math.exp(-EASE_RATE * Math.max(0, dt));
      for (let z = 0; z < zones.length; z++) {
        const zone = zones[z]!;
        const p = zone.params;
        const phase = blowerPhase(p, t);
        let target = 0;
        if (phase === WIND_ON) target = 1;
        else if (phase !== WIND_OFF) {
          // warning: build up over the last warnSec of the off time
          const period = p.onSec + p.offSec;
          const into = blowerCycleTime(p, t) - (period - Math.min(p.warnSec, p.offSec));
          target = WARN_FROM + (WARN_TO - WARN_FROM) * Math.min(1, Math.max(0, into / Math.max(1e-6, p.warnSec)));
        }
        const before = intensity[z]!;
        const now = before + (target - before) * ease;
        intensity[z] = now < 0.002 && target === 0 ? 0 : now;
        const live = intensity[z]!;
        // the whole zone is idle: park the streaks near the fan, ready for the next gust
        const idle = live === 0;
        for (let k = 0; k < STREAKS_PER_ZONE; k++) {
          const i = z * STREAKS_PER_ZONE + k;
          if (idle) {
            if (alpha[i]! !== 0 || u[i]! > p.reach * 0.5) respawn(i, zone, true);
            alpha[i] = 0;
            continue;
          }
          u[i] = u[i]! + p.windSpeed * VISUAL_SPEED * speed[i]! * (0.35 + 0.65 * live) * dt;
          if (u[i]! > p.reach + len[i]!) respawn(i, zone, false);
          const along = u[i]! / p.reach;
          // fade in just past the fan and out at the far end
          const envelope = smooth(0, 0.06, along) * (1 - smooth(0.9, 1, along));
          // while warning only some streaks show; the rest join as the push gets closer
          const shown = smooth(gate[i]!, gate[i]! + 0.15, live);
          alpha[i] = base[i]! * envelope * shown;
          // local (u, v) to world: +X along the wind, +Z across
          const lx = u[i]!;
          const lz = v[i]!;
          pos[i * 3] = zone.pos[0] + lx * zone.c + lz * zone.s;
          pos[i * 3 + 1] = zone.pos[1] + h[i]!;
          pos[i * 3 + 2] = zone.pos[2] - lx * zone.s + lz * zone.c;
          size[i * 2] = len[i]!;
        }
      }
    },
  };
}
