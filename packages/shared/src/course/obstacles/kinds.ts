// Every obstacle kind except `platform` (platform.ts). Parameter names and defaults are frozen in
// docs/CONTRACTS.md ("Obstacle params v1"). All poses are pure functions of race time t.
//
// pos is the centre of the TOP surface for bridge, movingPlatform and spinnerDisc, and the base
// centre on the ground for ramp, sweeper, bumper, pendulum, gate and wall.
import { z } from 'zod';
import type { Quat } from '../../types.ts';
import { TAU, defineKind, dir, int, num, part, place, slot, vec3 } from './common.ts';
import { quatFromAxisAngle, quatMul } from './math.ts';

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

export const movingPlatform = defineKind({
  kind: 'movingPlatform',
  schema: z.object({
    size: vec3([4, 0.5, 4], [1, 0.2, 1], [20, 3, 20]),
    travel: vec3([6, 0, 0], [-30, -10, -30], [30, 10, 30]),
    periodSec: num(4, 0.5, 60),
    phase: num(0, -1e6, 1e6),
    ease: z.enum(['sine', 'linear']).catch('sine'),
    slot: slot('platformB'),
  }),
  parts: (_d, p) => [part('box', [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], p.slot)],
  pose(def, p, t, out) {
    const u = shuttle(t, p.periodSec, p.phase, p.ease);
    place(def, p.travel[0] * u, p.travel[1] * u - p.size[1] / 2, p.travel[2] * u, null, out[0]);
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
    dir: dir(),
  }),
  parts: (_d, p) => [part('cylinder', [p.radius, p.thickness / 2, 0], 'accent')],
  pose(def, p, t, out) {
    quatFromAxisAngle(0, 1, 0, p.dir * ((p.rpm * TAU) / 60) * t, q);
    place(def, 0, -p.thickness / 2, 0, q, out[0]);
  },
  period: (p) => (p.rpm > 0 ? 60 / p.rpm : 0),
  maxSpeed: (p) => ((p.rpm * TAU) / 60) * p.radius,
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
    width: num(10, 3, 30),
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
  schema: z.object({ size: vec3([4, 2, 0.5], [0.2, 0.2, 0.2], [40, 10, 40]) }),
  parts: (_d, p) => [part('box', [p.size[0] / 2, p.size[1] / 2, p.size[2] / 2], 'hazard')],
  pose: (def, p, _t, out) => place(def, 0, p.size[1] / 2, 0, null, out[0]),
  period: () => 0,
  maxSpeed: () => 0,
});
