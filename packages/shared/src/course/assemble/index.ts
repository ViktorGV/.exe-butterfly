// Course assembler (#15): CourseRecipe (an ordered list of segments, which is all an LLM or a
// designer writes) -> a concrete, playable CourseDef. Deterministic: a seeded PRNG, no
// Math.random, and every coordinate rounded to the millimetre.
//
// Layout, toward -Z: start pad (300-slot spawn grid) -> [segment -> checkpoint pad] x N ->
// finale (ramp up -> gate -> finish pad).
import { LIMITS } from '../../constants.ts';
import type { CourseDef, CourseRecipe, EntityDef, MaterialSlot, SpawnGrid, Vec3 } from '../../types.ts';

/** Width of every open section (crowd rule: at least 14 m). */
export const COURSE_WIDTH = 16;
const GAP = 2;
const START_DEPTH = 20;
const PAD_DEPTH = 12;
const PAD_WIDTH = 18;
const SEGMENT_LENGTH = { short: 20, medium: 32, long: 44 } as const;
/** Gap + ramp + finish pad. */
const FINALE_LENGTH = 2 + 10 + 16;

type Segment = CourseRecipe['segments'][number];

/** mulberry32: small, fast, identical in every JS engine. */
export function createRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const v3 = (x: number, y: number, z: number): Vec3 => [r3(x), r3(y), r3(z)];

class Builder {
  readonly entities: EntityDef[] = [];
  /** Front edge of the course built so far (z decreases toward the finish). */
  z = 0;
  /** Height of the walking surface at the front edge. */
  y = 0;
  /** True when the course so far ends in solid floor (the next floor piece joins it with no gap). */
  floorEdge = true;
  constructor(readonly rand: () => number) {}

  add(kind: string, pos: Vec3, params: Record<string, unknown>, yaw = 0) {
    this.entities.push({ id: this.entities.length, kind, pos, yaw, params });
  }

  /** Static platform whose top is at y, spanning z from `front` back `depth` metres. */
  platform(x: number, y: number, front: number, w: number, depth: number, slot: MaterialSlot = 'platformA', h = 1) {
    this.add('platform', v3(x, y, front - depth / 2), { size: [r3(w), h, r3(depth)], slot });
  }

  range(lo: number, hi: number) {
    return lo + (hi - lo) * this.rand();
  }
}

function grid(pos: Vec3, cols: number, spacing: number): SpawnGrid {
  return { pos, yaw: 0, cols, spacing };
}

// ---- segment builders: each starts at b.z (after a gap) and leaves b.z at its far end ----

type SegmentBuilder = (b: Builder, length: number, intensity: number) => void;

/** Joins solid floor to solid floor seamlessly; only void sections leave gaps to jump. */
const joinGap = (b: Builder) => {
  if (!b.floorEdge) b.z -= GAP;
  b.floorEdge = true;
};

const floorRun = (b: Builder, length: number, slot: MaterialSlot = 'platformA') => {
  joinGap(b);
  b.platform(0, b.y, b.z, COURSE_WIDTH, length, slot);
  const start = b.z;
  b.z -= length;
  return start;
};

const BUILDERS: Record<Segment['type'], SegmentBuilder> = {
  plainRun(b, length, i) {
    const start = floorRun(b, length);
    // Low walls to hop over, more of them at higher intensity.
    const count = Math.floor((length / 10) * (i / 3));
    for (let k = 0; k < count; k++) {
      const z = start - ((k + 1) * length) / (count + 1);
      const x = b.range(-4, 4);
      b.add('wall', v3(x, b.y, z), { size: [r3(b.range(3, 6)), 0.8, 0.6] });
    }
  },

  sweeperRun(b, length, i) {
    const start = floorRun(b, length);
    const count = Math.max(1, Math.floor(length / 12));
    for (let k = 0; k < count; k++) {
      const z = start - ((k + 0.5) * length) / count;
      b.add('sweeper', v3(0, b.y, z), {
        arms: i >= 4 ? 3 : 2,
        armLength: COURSE_WIDTH / 2 - 0.5,
        rpm: r3(8 + i * 2.5 + b.range(-1, 1)),
        phase: r3(b.range(0, Math.PI * 2)),
        dir: k % 2 === 0 ? 1 : -1,
      });
    }
  },

  movingPlatforms(b, length, i) {
    // Rows of 4 lanes over a void; each row bobs up and down out of phase with the next.
    const size = 3.4;
    const pitch = size + GAP;
    const rows = Math.max(2, Math.round(length / pitch));
    const rise = Math.min(1.15, 0.4 + 0.15 * i);
    const period = r3(5.5 - 0.5 * i);
    for (let r = 0; r < rows; r++) {
      const front = b.z - GAP - r * pitch;
      const phase = r3((r * 0.23 + b.range(0, 0.1)) % 1);
      for (let lane = 0; lane < 4; lane++) {
        const x = -6 + lane * 4;
        b.add('movingPlatform', v3(x, b.y, front - size / 2), {
          size: [size, 0.5, size],
          travel: [0, r3(rise), 0],
          periodSec: period,
          phase,
          ease: 'sine',
          slot: lane % 2 === 0 ? 'platformB' : 'platformA',
        });
      }
    }
    b.z -= GAP + rows * pitch - GAP;
    b.floorEdge = false;
  },

  bumperField(b, length, i) {
    const start = floorRun(b, length, 'platformB');
    const count = Math.round((length / 4) * (0.6 + 0.2 * i));
    const placed: [number, number][] = [];
    for (let tries = 0; placed.length < count && tries < count * 20; tries++) {
      const x = b.range(-COURSE_WIDTH / 2 + 1.5, COURSE_WIDTH / 2 - 1.5);
      const z = start - b.range(2, length - 2);
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 3.2)) continue;
      placed.push([x, z]);
      b.add('bumper', v3(x, b.y, z), { radius: 0.9, height: 1.2, bounce: Math.min(20, 11 + i) });
    }
  },

  narrowBridges(b, length, i) {
    // 4-6 parallel lanes over a void (crowd rule: chokepoints have at least 4 lanes).
    const lanes = Math.max(4, 6 - Math.floor(i / 2));
    const width = r3(Math.max(1.2, 1.9 - 0.15 * i));
    b.z -= GAP;
    // Bridges are at most 40 m long, so long runs are built from sections laid end to end.
    const sections = Math.ceil(length / 40);
    const piece = length / sections;
    for (let k = 0; k < lanes; k++) {
      const x = -COURSE_WIDTH / 2 + ((k + 0.5) * COURSE_WIDTH) / lanes;
      for (let s = 0; s < sections; s++) {
        b.add('bridge', v3(x, b.y, b.z - piece * (s + 0.5)), { length: r3(piece), width, thickness: 0.4 });
      }
    }
    b.z -= length;
    b.floorEdge = false;
  },

  rampClimb(b, length, i) {
    // Flat -> ramp up by `rise` -> flat at the new height.
    const rise = Math.min(4, 1 + 0.5 * i);
    const rampLen = length * 0.5;
    const flat = (length - rampLen) / 2;
    floorRun(b, flat);
    const pitch = Math.atan2(rise, rampLen);
    const slant = Math.hypot(rise, rampLen);
    b.add('ramp', v3(0, b.y, b.z - rampLen / 2), {
      size: [COURSE_WIDTH, 0.5, r3(slant)],
      pitch: r3(pitch),
      slot: 'platformB',
    });
    b.z -= rampLen;
    b.y = r3(b.y + rise);
    b.platform(0, b.y, b.z, COURSE_WIDTH, flat);
    b.z -= flat;
  },

  spinnerDiscs(b, length, i) {
    // Pairs of big discs side by side; each row turns the opposite way to the last.
    const radius = 3.8;
    const pitch = radius * 2 + GAP;
    const rows = Math.max(1, Math.round(length / pitch));
    for (let r = 0; r < rows; r++) {
      const cz = b.z - GAP - radius - r * pitch;
      for (const x of [-4, 4]) {
        b.add('spinnerDisc', v3(x, b.y, cz), {
          radius,
          thickness: 0.5,
          rpm: r3(4 + i * 1.5),
          dir: (r + (x > 0 ? 1 : 0)) % 2 === 0 ? 1 : -1,
        });
      }
    }
    b.z -= GAP + rows * pitch - GAP;
    b.floorEdge = false;
  },

  pendulumAlley(b, length, i) {
    const start = floorRun(b, length);
    const count = Math.max(2, Math.floor(length / 8));
    for (let k = 0; k < count; k++) {
      b.add('pendulum', v3(0, b.y, start - ((k + 0.5) * length) / count), {
        pivotHeight: 7,
        length: 5.5,
        ballRadius: 1.1,
        periodSec: r3(3.6 - 0.3 * i),
        phase: r3(k * 0.37 + b.range(0, 0.2)),
        amplitude: r3(Math.min(1.3, 0.9 + 0.08 * i)),
        bounce: 12,
      });
    }
  },

  gateDash(b, length, i) {
    const start = floorRun(b, length);
    const count = Math.max(1, Math.floor(length / 12));
    for (let k = 0; k < count; k++) {
      b.add('gate', v3(0, b.y, start - ((k + 0.5) * length) / count), {
        width: COURSE_WIDTH - 1,
        height: 4,
        doors: Math.min(6, 2 + i),
        periodSec: r3(Math.max(1.5, 4 - 0.4 * i)),
      });
    }
  },
};

function checkpointPad(b: Builder) {
  joinGap(b);
  const front = b.z;
  b.platform(0, b.y, front, PAD_WIDTH, PAD_DEPTH, 'accent');
  b.z -= PAD_DEPTH;
  return {
    volume: { pos: v3(0, b.y + 1.5, front - PAD_DEPTH / 2), yaw: 0, half: v3(PAD_WIDTH / 2, 1.5, PAD_DEPTH / 2) },
    // 20 x 15 slots at 0.75 m: 15 m x 11.25 m, inside the 18 x 12 m pad.
    respawn: grid(v3(0, b.y, front - PAD_DEPTH + 0.5), 20, 0.75),
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'course';

/** Turn a recipe into a playable course. Same recipe -> identical CourseDef. */
export function assembleCourse(recipe: CourseRecipe): CourseDef {
  const b = new Builder(createRng(recipe.seed));

  // Start pad: 24 x 20 m, spawn grid of 20 x 15 slots at 1 m.
  b.platform(0, 0, START_DEPTH / 2, 24, START_DEPTH, 'platformA');
  b.z = -START_DEPTH / 2;
  const spawn = grid([0, 0, -9], 20, 1);

  // Shrink segments evenly if the whole course would be longer than LIMITS.maxCourseLength.
  const fixed = START_DEPTH + FINALE_LENGTH + recipe.segments.length * (GAP * 2 + PAD_DEPTH + 6);
  const wanted = recipe.segments.reduce((sum, s) => sum + SEGMENT_LENGTH[s.length], 0);
  const scale = Math.min(1, (LIMITS.maxCourseLength - 20 - fixed) / wanted);

  const checkpoints: CourseDef['checkpoints'] = [];
  let pathLength = START_DEPTH / 2;
  let difficulty = 0;
  for (const seg of recipe.segments) {
    const before = b.z;
    const length = Math.max(12, Math.round(SEGMENT_LENGTH[seg.length] * scale));
    BUILDERS[seg.type](b, length, seg.intensity);
    checkpoints.push(checkpointPad(b));
    pathLength += before - b.z;
    difficulty += length * seg.intensity * 0.06;
  }

  // Finale: ramp up 2 m, gate, finish pad.
  joinGap(b);
  const rampLen = 10;
  b.add('ramp', v3(0, b.y, b.z - rampLen / 2), {
    size: [COURSE_WIDTH, 0.5, r3(Math.hypot(2, rampLen))],
    pitch: r3(Math.atan2(2, rampLen)),
    slot: 'platformB',
  });
  b.z -= rampLen;
  b.y = r3(b.y + 2);
  const finishFront = b.z;
  b.platform(0, b.y, finishFront, 24, 16, 'finish');
  b.add('gate', v3(0, b.y, finishFront - 2), { width: 20, height: 5, doors: 0, periodSec: 3 });
  b.z -= 16;
  const finish = { pos: v3(0, b.y + 1.5, finishFront - 9), yaw: 0, half: v3(12, 1.5, 6) };
  pathLength += GAP + rampLen + 16;

  const maxY = Math.max(...b.entities.map((e) => e.pos[1])) + 10;
  const parTimeMs = Math.round((pathLength / 5.5 + difficulty) * 1000);
  return {
    version: 1,
    id: `course-${slug(recipe.name)}-${recipe.seed}`,
    name: recipe.name,
    spawn,
    checkpoints,
    finish,
    killY: -10,
    bounds: { min: v3(-COURSE_WIDTH, -12, b.z - 4), max: v3(COURSE_WIDTH, maxY, START_DEPTH / 2 + 2) },
    entities: b.entities,
    parTimeMs,
    timeLimitMs: Math.round(parTimeMs * 2.5 + 30000),
  };
}
