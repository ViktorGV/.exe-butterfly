// Every obstacle kind except `platform` (platform.ts). Parameter names and defaults are frozen in
// docs/CONTRACTS.md ("Obstacle params v1"). All poses are pure functions of race time t.
//
// pos is the centre of the TOP surface for bridge, movingPlatform and spinnerDisc, and the base
// centre on the ground for ramp, sweeper, bumper, pendulum, gate and wall.
import { z } from 'zod';
import type { Quat } from '../../types.ts';
import { TAU, defineKind, dir, int, num, part, place, slot, vec3 } from './common.ts';
import { quatFromAxisAngle, quatMul } from './math.ts';
import { fadeOffset } from './fade.ts';

const q: Quat = [0, 0, 0, 1];
const q2: Quat = [0, 0, 0, 1];
const ROLL_90: Quat = quatFromAxisAngle(0, 0, 1, Math.PI / 2, [0, 0, 0, 1]);

/** 0..1..0 over a period: smooth (sine) or constant speed (linear). */
function shuttle(t: number, period: number, phase: number, ease: 'sine' | 'linear') {
  const f = t / period + phase;
  if (ease === 'sine') return (1 - Math.cos(f * TAU)) / 2;
  const x = f - Math.floor(f);
  return x < 0.5 ? x * 2 : 2 - x * 2;
}

export const ramp = defineKind({
  kind: 'ramp',
  schema: z.object({
    size: vec3([6, 0.5, 8], [1, 0.2, 1], [40, 4, 40]),
    pitch: num(0.3, -0.8, 0.8),
    slot: slot('platformB'),
  }),
  parts: (_d, p) => [part('box', [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], p.slot)],
  pose(def, p, _t, out) {
    // The low end's top surface sits on the ground at +Z; it rises toward -Z by `pitch`.
    const [, h, d] = p.size;
    const midTop = (d / 2) * Math.sin(Math.abs(p.pitch));
    quatFromAxisAngle(1, 0, 0, p.pitch, q);
    place(def, 0, midTop - (h / 2) * Math.cos(p.pitch), 0, q, out[0]);
  },
  period: () => 0,
  maxSpeed: () => 0,
});

export const sweeper = defineKind({
  kind: 'sweeper',
  schema: z.object({
    arms: int(2, 1, 4),
    armLength: num(6, 1, 12),
    barRadius: num(0.35, 0.15, 0.8),
    barHeight: num(0.6, 0.3, 2.5),
    rpm: num(12, 0, 30),
    phase: num(0, -1e6, 1e6),
    dir: dir(),
  }),
  parts(_d, p) {
    const hubHalf = (p.barHeight + p.barRadius + 0.2) / 2;
    const parts = [part('cylinder', [0.5, hubHalf, 0], 'accent')];
    for (let i = 0; i < p.arms; i++) parts.push(part('cylinder', [p.barRadius, p.armLength / 2, 0], 'hazard'));
    return parts;
  },
  pose(def, p, t, out) {
    const hubHalf = (p.barHeight + p.barRadius + 0.2) / 2;
    place(def, 0, hubHalf, 0, null, out[0]);
    const base = p.phase + p.dir * ((p.rpm * TAU) / 60) * t;
    for (let i = 0; i < p.arms; i++) {
      const a = base + (i * TAU) / p.arms;
      // Bar axis (local Y) is rolled onto -X, then turned by `a` about Y; its centre sits halfway out.
      quatMul(quatFromAxisAngle(0, 1, 0, a, q), ROLL_90, q2);
      place(def, (-Math.cos(a) * p.armLength) / 2, p.barHeight, (Math.sin(a) * p.armLength) / 2, q2, out[i + 1]);
    }
  },
  period: (p) => (p.rpm > 0 ? 60 / p.rpm : 0),
  maxSpeed: (p) => ((p.rpm * TAU) / 60) * (p.armLength + p.barRadius),
});

const shake = { x: 0, y: 0 };
const still = { x: 0, y: 0 } as const;

export const movingPlatform = defineKind({
  kind: 'movingPlatform',
  schema: z.object({
    size: vec3([4, 0.5, 4], [1, 0.2, 1], [20, 3, 20]),
    travel: vec3([6, 0, 0], [-30, -10, -30], [30, 10, 30]),
    periodSec: num(4, 0.5, 60),
    phase: num(0, -1e6, 1e6),
    ease: z.enum(['sine', 'linear']).catch('sine'),
    slot: slot('platformB'),
    /** a fading platform (fade.ts): 3 s after someone lands on it, it drops away for a while */
    fade: z.boolean().catch(false),
    /** fades too, but only once a `fade` platform of the same `fadeRun` has dropped (fadeTouch.ts) */
    fadeLate: z.boolean().catch(false),
    /** which group of fading platforms this one belongs to */
    fadeRun: z.number().catch(0),
  }),
  parts: (_d, p) => [part('box', [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], p.slot)],
  pose(def, p, t, out) {
    const u = shuttle(t, p.periodSec, p.phase, p.ease);
    // a fading platform wobbles once touched, then drops away (fade.ts)
    const f = p.fade || p.fadeLate ? fadeOffset(def.id, t, shake) : still;
    place(def, p.travel[0] * u + f.x, p.travel[1] * u - p.size[1] / 2 + f.y, p.travel[2] * u, null, out[0]);
  },
  period: (p) => p.periodSec,
  maxSpeed: (p) => {
    const len = Math.hypot(p.travel[0], p.travel[1], p.travel[2]);
    return p.ease === 'sine' ? (len * Math.PI) / p.periodSec : (len * 2) / p.periodSec;
  },
});

export const bumper = defineKind({
  kind: 'bumper',
  schema: z.object({
    radius: num(0.9, 0.3, 3),
    height: num(1.2, 0.4, 4),
    bounce: num(14, 4, 20),
  }),
  parts: (_d, p) => [part('cylinder', [p.radius, p.height / 2, 0], 'bouncy', { surface: 'bouncy', bounce: p.bounce })],
  pose: (def, p, _t, out) => place(def, 0, p.height / 2, 0, null, out[0]),
  period: () => 0,
  maxSpeed: () => 0,
});

export const bridge = defineKind({
  kind: 'bridge',
  schema: z.object({
    length: num(12, 1, 40),
    width: num(1.6, 0.8, 8),
    thickness: num(0.4, 0.2, 2),
  }),
  parts: (_d, p) => [part('box', [p.width / 2, p.thickness / 2, p.length / 2], 'rail')],
  pose: (def, p, _t, out) => place(def, 0, -p.thickness / 2, 0, null, out[0]),
  period: () => 0,
  maxSpeed: () => 0,
});

export const spinnerDisc = defineKind({
  kind: 'spinnerDisc',
  schema: z.object({
    radius: num(4, 1, 10),
    thickness: num(0.5, 0.2, 2),
    rpm: num(8, 0, 30),
    ridge: num(0, 0, 1.2),
    ridgeWidth: num(0.4, 0.2, 1),
    dir: dir(),
  }),
  parts(_d, p) {
    const parts = [part('cylinder', [p.radius, p.thickness / 2, 0], 'accent')];
    // Two crossing ridges, knee high, that turn with the disc: runners hop over them.
    if (p.ridge > 0) {
      for (let i = 0; i < 2; i++) parts.push(part('box', [p.radius, p.ridge / 2, p.ridgeWidth / 2], 'hazard'));
    }
    return parts;
  },
  pose(def, p, t, out) {
    quatFromAxisAngle(0, 1, 0, p.dir * ((p.rpm * TAU) / 60) * t, q);
    place(def, 0, -p.thickness / 2, 0, q, out[0]);
    if (p.ridge > 0) {
      const a = p.dir * ((p.rpm * TAU) / 60) * t;
      for (let i = 0; i < 2; i++) {
        quatFromAxisAngle(0, 1, 0, a + (i * Math.PI) / 2, q2);
        place(def, 0, p.ridge / 2, 0, q2, out[i + 1]);
      }
    }
  },
  period: (p) => (p.rpm > 0 ? 60 / p.rpm : 0),
  maxSpeed: (p) => ((p.rpm * TAU) / 60) * (p.ridge > 0 ? Math.hypot(p.radius, p.ridgeWidth / 2) : p.radius),
});

export const pendulum = defineKind({
  kind: 'pendulum',
  schema: z.object({
    pivotHeight: num(7, 2, 15),
    length: num(5.5, 1, 14),
    ballRadius: num(1.1, 0.3, 3),
    periodSec: num(3, 0.8, 20),
    phase: num(0, -1e6, 1e6),
    amplitude: num(1.1, 0, 1.4),
    bounce: num(12, 4, 20),
  }),
  parts: (_d, p) => [
    part('sphere', [p.ballRadius, 0, 0], 'hazard', { surface: 'bouncy', bounce: p.bounce }),
    part('cylinder', [0.12, p.length / 2, 0], 'rail', { collide: false }),
  ],
  pose(def, p, t, out) {
    // Swings across the course (in the entity's local X-Y plane).
    const a = p.amplitude * Math.sin((t / p.periodSec + p.phase) * TAU);
    const sx = Math.sin(a);
    const cy = Math.cos(a);
    place(def, sx * p.length, p.pivotHeight - cy * p.length, 0, null, out[0]);
    quatFromAxisAngle(0, 0, 1, a, q);
    place(def, (sx * p.length) / 2, p.pivotHeight - (cy * p.length) / 2, 0, q, out[1]);
  },
  period: (p) => p.periodSec,
  maxSpeed: (p) => p.amplitude * (TAU / p.periodSec) * (p.length + p.ballRadius),
});

export const gate = defineKind({
  kind: 'gate',
  schema: z.object({
    width: num(10, 3, 60),
    height: num(5, 2, 10),
    doors: int(0, 0, 6),
    periodSec: num(3, 1, 20),
  }),
  parts(_d, p) {
    const parts = [
      part('box', [0.5, p.height / 2, 0.5], 'accent'),
      part('box', [0.5, p.height / 2, 0.5], 'accent'),
      part('box', [p.width / 2 + 0.5, 0.4, 0.5], 'finish'),
    ];
    const w = p.width / Math.max(1, p.doors);
    for (let i = 0; i < p.doors; i++) parts.push(part('box', [w / 2 - 0.05, p.height / 2 - 0.2, 0.2], 'hazard'));
    return parts;
  },
  pose(def, p, t, out) {
    place(def, -p.width / 2 - 0.5, p.height / 2, 0, null, out[0]);
    place(def, p.width / 2 + 0.5, p.height / 2, 0, null, out[1]);
    place(def, 0, p.height + 0.4, 0, null, out[2]);
    const w = p.width / Math.max(1, p.doors);
    for (let i = 0; i < p.doors; i++) {
      // Each door slides up into the crossbar and back down, staggered across the gate.
      const open = shuttle(t, p.periodSec, i / p.doors, 'sine');
      place(def, -p.width / 2 + w * (i + 0.5), p.height / 2 - 0.2 + open * (p.height - 0.6), 0, null, out[3 + i]);
    }
  },
  period: (p) => (p.doors > 0 ? p.periodSec : 0),
  maxSpeed: (p) => (p.doors > 0 ? ((p.height - 0.6) * Math.PI) / p.periodSec : 0),
});

export const wall = defineKind({
  kind: 'wall',
  // `bounce` 0 (the default) is a solid wall; above 0 it ricochets: touching it launches the player away
  // from the face they hit at `bounce` m/s, like a bumper.
  schema: z.object({ size: vec3([4, 2, 0.5], [0.2, 0.2, 0.2], [40, 10, 40]), bounce: num(0, 0, 20) }),
  parts: (_d, p) =>
    p.bounce > 0
      ? [part('box', [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], 'hazard', { surface: 'bouncy', bounce: p.bounce })]
      : [part('box', [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], 'hazard')],
  pose: (def, p, _t, out) => place(def, 0, p.size[1] / 2, 0, null, out[0]),
  period: () => 0,
  maxSpeed: () => 0,
});

// ---- event course kinds (#110) ----

export const bouncePad = defineKind({
  kind: 'bouncePad',
  schema: z.object({
    size: vec3([3.4, 0.4, 1.6], [1, 0.2, 1], [12, 2, 8]),
    bounce: num(13, 6, 20),
    tilt: num(0.12, 0, 0.5),
  }),
  // `pad` makes the controller launch along the pad's up axis, keep the player's sideways speed and
  // skip the stumble that bumpers cause.
  parts: (_d, p) => [
    part('box', [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], 'bouncy', {
      surface: 'bouncy',
      bounce: p.bounce,
      pad: true,
    }),
  ],
  pose(def, p, _t, out) {
    // pos is the centre of the top surface. `tilt` tips the top face toward -Z so the launch also
    // carries the player forward; the box hangs below its top centre along its own down axis.
    const h = p.size[1] / 2;
    quatFromAxisAngle(1, 0, 0, -p.tilt, q);
    place(def, 0, -h * Math.cos(p.tilt), h * Math.sin(p.tilt), q, out[0]);
  },
  period: () => 0,
  maxSpeed: () => 0,
});

/** How far a raised panel's bottom edge is off the floor, metres: a running player (1.3 m tall) fits under it. */
export const WALL_LIFT = 1.9;

/** Panels that fit across the width, each at least 3 m wide. */
const wallPanels = (p: { width: number; panels: number }) => Math.max(1, Math.min(p.panels, Math.floor(p.width / 3)));

/**
 * Panel i's phase, in cycles: scattered (golden ratio) so neighbouring panels are never open together and the
 * open gap hops around the wall instead of travelling in a line.
 */
const wallPhase = (p: { phase: number }, i: number) => p.phase + ((i * 0.618034) % 1);

export const slidingWall = defineKind({
  kind: 'slidingWall',
  schema: z.object({
    width: num(15, 4, 60),
    height: num(2.5, 1, 6),
    thickness: num(0.6, 0.2, 2),
    panels: int(2, 1, 12),
    periodSec: num(4, 1, 20),
    phase: num(0, -1e6, 1e6),
  }),
  parts(_d, p) {
    // two pillars frame the wall; the panels fill the span between them and slide UP and DOWN
    const pillar = (p.height + WALL_LIFT) / 2 + 0.2;
    const parts = [
      part('box', [0.5, pillar, p.thickness / 2 + 0.1], 'accent'),
      part('box', [0.5, pillar, p.thickness / 2 + 0.1], 'accent'),
    ];
    const n = wallPanels(p);
    const s = p.width / n;
    for (let i = 0; i < n; i++) parts.push(part('box', [s / 2 - 0.08, p.height / 2, p.thickness / 2], 'hazard'));
    return parts;
  },
  pose(def, p, t, out) {
    const pillar = (p.height + WALL_LIFT) / 2 + 0.2;
    place(def, -p.width / 2 - 0.5, pillar, 0, null, out[0]);
    place(def, p.width / 2 + 0.5, pillar, 0, null, out[1]);
    // Each panel drops to the floor (blocking the way) and rises until a runner fits under it, on its own
    // phase, so some panel is always open and the opening keeps moving.
    const n = wallPanels(p);
    const s = p.width / n;
    for (let i = 0; i < n; i++) {
      const lift = shuttle(t, p.periodSec, wallPhase(p, i), 'sine') * WALL_LIFT;
      place(def, -p.width / 2 + s * (i + 0.5), p.height / 2 + lift, 0, null, out[2 + i]);
    }
  },
  period: (p) => p.periodSec,
  maxSpeed: (p) => (WALL_LIFT * Math.PI) / p.periodSec,
});

// ---- more course components ----

/**
 * Four square pads on a rotating cross, with nothing joining them: players hop onto a pad as it comes round,
 * ride it, and hop off on the far side (like a merry-go-round over a void). pos is the centre of the top
 * surface at the axis.
 */
export const carousel = defineKind({
  kind: 'carousel',
  schema: z.object({
    /** distance from the axis to the middle of each pad */
    radius: num(4.2, 2.5, 10),
    /** side length of each pad */
    pad: num(3.4, 2, 6),
    thickness: num(0.5, 0.2, 2),
    rpm: num(5, 1, 14),
    dir: dir(),
  }),
  parts: (_d, p) =>
    [0, 1, 2, 3].map((i) => part('box', [p.pad / 2, p.thickness / 2, p.pad / 2], i % 2 === 0 ? 'accent' : 'platformB')),
  pose(def, p, t, out) {
    const w = p.dir * ((p.rpm * TAU) / 60) * t;
    for (let i = 0; i < 4; i++) {
      // the whole cross turns as one rigid body: pad i sits at angle w + i * 90 degrees and turns with it
      const a = w + (i * Math.PI) / 2;
      quatFromAxisAngle(0, 1, 0, a, q);
      place(def, p.radius * Math.cos(a), -p.thickness / 2, -p.radius * Math.sin(a), q, out[i]);
    }
  },
  period: (p) => 60 / p.rpm,
  maxSpeed: (p) => ((p.rpm * TAU) / 60) * (p.radius + p.pad * Math.SQRT1_2),
});

/**
 * A floor tile with arrows on it. Stepping on it launches a short dash along the arrows: `dir` +1 points
 * toward the finish (the entity's local -Z), -1 back toward the start. The dash itself is applied by the
 * player controller (see boost.ts); here it is only a thin plate with chevrons. pos is the centre of the top
 * surface.
 */
export const arrowTile = defineKind({
  kind: 'arrowTile',
  schema: z.object({
    size: vec3([4, 0.12, 4], [1.5, 0.05, 1.5], [10, 0.4, 10]),
    dir: dir(),
    /** dash speed (m/s) added along the arrows; a back-pointing tile pushes harder (see BOOST_BACK_FACTOR) */
    boost: num(11, 4, 18),
  }),
  parts(_d, p) {
    const forward = p.dir > 0;
    const w = Math.min(p.size[0], p.size[2]);
    const bar = (w * 0.34) / 2; // half length of a chevron arm
    const thick = Math.max(0.12, w * 0.045);
    const plate = part('box', [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], forward ? 'accent' : 'hazard');
    // two chevrons, each two arms, laid on the plate: visible only
    const arm = () => part('box', [bar, 0.03, thick], 'rail', { collide: false });
    return [plate, arm(), arm(), arm(), arm()];
  },
  pose(def, p, _t, out) {
    const h = p.size[1];
    place(def, 0, -h / 2, 0, null, out[0]);
    const w = Math.min(p.size[0], p.size[2]);
    const reach = ((w * 0.34) / 2) * Math.SQRT1_2; // each arm's middle sits this far from the tip, on both axes
    // chevron tips toward the arrow's direction: -Z for dir +1, +Z for dir -1
    const tips = [w * 0.2, -w * 0.18];
    for (let c = 0; c < 2; c++) {
      const tipZ = -p.dir * tips[c]!;
      for (let side = 0; side < 2; side++) {
        const sx = side === 0 ? 1 : -1;
        quatFromAxisAngle(0, 1, 0, -p.dir * sx * (Math.PI / 4), q);
        place(def, sx * reach, 0.04, tipZ + p.dir * reach, q, out[1 + c * 2 + side]);
      }
    }
  },
  period: () => 0,
  maxSpeed: () => 0,
});

export const snowBlowerSchema = z.object({
  /** How far the wind blows across the course (local +X from the fan face). */
  reach: num(20, 2, 60),
  /** Depth of the wind zone along the course (local Z). */
  width: num(6, 1, 20),
  height: num(3, 1, 8),
  /** Sideways wind (m/s) added to the player's target velocity while the fan is on. */
  windSpeed: num(3, 0, 10),
  onSec: num(3, 0.5, 20),
  offSec: num(2, 0.5, 20),
  /** Snow and wind lines start this long before the push. */
  warnSec: num(0.5, 0, 2),
  /** Seconds added to race time, so neighbouring fans can take turns. */
  phase: num(0, -1e6, 1e6),
});
export type SnowBlowerParams = z.infer<typeof snowBlowerSchema>;

export const WIND_OFF = 0;
export const WIND_WARN = 1;
export const WIND_ON = 2;
export type WindPhase = typeof WIND_OFF | typeof WIND_WARN | typeof WIND_ON;

/** Seconds into the fan's on/off cycle (0 = the push starts). Pure, any real t. */
export function blowerCycleTime(p: SnowBlowerParams, t: number): number {
  const period = p.onSec + p.offSec;
  const x = t + p.phase;
  return x - Math.floor(x / period) * period;
}

/** Off, warning (the last `warnSec` of the off time) or on, at race time t. */
export function blowerPhase(p: SnowBlowerParams, t: number): WindPhase {
  const u = blowerCycleTime(p, t);
  if (u < p.onSec) return WIND_ON;
  return u >= p.onSec + p.offSec - Math.min(p.warnSec, p.offSec) ? WIND_WARN : WIND_OFF;
}

/** The rotor turns a whole number of times per on-phase, so the pose repeats every cycle. */
const rotorRate = (p: SnowBlowerParams) => (Math.max(1, Math.round(p.onSec * 2)) * TAU) / p.onSec;

export const snowBlower = defineKind({
  kind: 'snowBlower',
  schema: snowBlowerSchema,
  parts: (_d, p) => [
    part('box', [0.6, p.height / 2, p.width / 2], 'accent'),
    part('cylinder', [Math.min(p.height, p.width) * 0.4, 0.15, 0], 'hazard', { collide: false }),
  ],
  pose(def, p, t, out) {
    // pos is the base centre of the fan face, on the ground; the wind blows toward local +X.
    place(def, -0.6, p.height / 2, 0, null, out[0]);
    // The rotor (visual only) spins while the fan is on and rests while it is off.
    const angle = rotorRate(p) * Math.min(blowerCycleTime(p, t), p.onSec);
    quatMul(quatFromAxisAngle(1, 0, 0, angle, q), ROLL_90, q2);
    place(def, 0.15, p.height / 2, 0, q2, out[1]);
  },
  period: (p) => p.onSec + p.offSec,
  // Nothing that collides ever moves: the housing is static and the rotor has collide: false.
  maxSpeed: () => 0,
});
