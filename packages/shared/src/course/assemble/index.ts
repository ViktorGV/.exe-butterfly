// Course assembler (#15): CourseRecipe (an ordered list of segments, which is all an LLM or a
// designer writes) -> a concrete, playable CourseDef. Deterministic: a seeded PRNG, no
// Math.random, and every coordinate rounded to the millimetre.
//
// Layout, toward -Z: start pad (300-slot spawn grid) -> [segment -> checkpoint pad] x N ->
// finale (ramp up -> gate -> finish pad).
import { LIMITS } from '../../constants.ts';
import type { CourseDef, CourseRecipe, EntityDef, MaterialSlot, SpawnGrid, Vec3 } from '../../types.ts';

/** Width of every open section (crowd rule: at least 14 m; 48 m gives 100+ players room to spread out). */
export const COURSE_WIDTH = 48;
/** Obstacle layouts were tuned for a 16 m track; rows of obstacles repeat across the width by this factor. */
const WIDTH_SCALE = COURSE_WIDTH / 16;
/** Evenly spaced x positions for `n` columns across the track width. */
const columns = (n: number) =>
  Array.from({ length: n }, (_, c) => r3(-COURSE_WIDTH / 2 + ((c + 0.5) * COURSE_WIDTH) / n));
/** The snow blower field is wider: the event villain (#84) throws there, so players need room to dodge. */
export const SNOW_FIELD_WIDTH = 60;
const GAP = 2;
const START_DEPTH = 20;
const PAD_DEPTH = 12;
const PAD_WIDTH = COURSE_WIDTH + 2;
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
    // Sweepers side by side, each arm reaching its neighbour's edge, so no part of the track is free of them.
    const cols = Math.max(1, Math.round(COURSE_WIDTH / 16));
    const armLength = r3(COURSE_WIDTH / (2 * cols) - 0.5);
    for (let k = 0; k < count; k++) {
      const z = start - ((k + 0.5) * length) / count;
      columns(cols).forEach((x, c) => {
        b.add('sweeper', v3(x, b.y, z), {
          arms: i >= 4 ? 3 : 2,
          armLength,
          rpm: r3(8 + i * 2.5 + b.range(-1, 1)),
          phase: r3(b.range(0, Math.PI * 2)),
          dir: (k + c) % 2 === 0 ? 1 : -1,
        });
      });
    }
  },

  movingPlatforms(b, length, i) {
    // Rows of 4 lanes over a void; each row bobs up and down out of phase with the next.
    const size = 3.4;
    const pitch = size + GAP;
    const rows = Math.max(2, Math.round(length / pitch));
    const rise = Math.min(1.15, 0.4 + 0.15 * i);
    const period = r3(4.8 - 0.45 * i);
    // One winding path of platforms (one per row) fades: 3 s after anyone lands on one it drops away for a while
    // (fade.ts). The path has its own random numbers, so the rest of the course stays exactly as before.
    const pathRand = createRng(Math.round(Math.abs(b.z) * 1000) ^ 0x5eed);
    // Once a path platform drops, every other platform of this run can fall too (fadeLate).
    const fadeRun = Math.round(b.z);
    let path = -1;
    for (let r = 0; r < rows; r++) {
      const front = b.z - GAP - r * pitch;
      const phase = r3((r * 0.23 + b.range(0, 0.1)) % 1);
      const xs = columns(Math.round(COURSE_WIDTH / 4));
      path =
        path < 0
          ? Math.floor(pathRand() * xs.length)
          : Math.max(0, Math.min(xs.length - 1, path + Math.floor(pathRand() * 3) - 1));
      for (let lane = 0; lane < xs.length; lane++) {
        const x = xs[lane]!;
        const params: Record<string, unknown> = {
          size: [size, 0.5, size],
          travel: [0, r3(rise), 0],
          periodSec: period,
          phase,
          ease: 'sine',
          slot: lane % 2 === 0 ? 'platformB' : 'platformA',
        };
        if (lane === path) params.fade = true;
        else params.fadeLate = true;
        params.fadeRun = fadeRun;
        b.add('movingPlatform', v3(x, b.y, front - size / 2), params);
      }
    }
    b.z -= GAP + rows * pitch - GAP;
    b.floorEdge = false;
  },

  bumperField(b, length, i) {
    const start = floorRun(b, length, 'platformB');
    const count = Math.round((length / 4) * (0.6 + 0.2 * i) * WIDTH_SCALE);
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
    const lanes = Math.max(4, 6 - Math.floor(i / 2)) * Math.round(WIDTH_SCALE);
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
    // Rows of big discs side by side across the track; each row turns the opposite way to the last.
    const radius = 3.8;
    const pitch = radius * 2 + GAP;
    const rows = Math.max(1, Math.round(length / pitch));
    for (let r = 0; r < rows; r++) {
      const cz = b.z - GAP - radius - r * pitch;
      columns(Math.max(2, Math.round(COURSE_WIDTH / (radius * 2 + 1.5)))).forEach((x, c) => {
        b.add('spinnerDisc', v3(x, b.y, cz), {
          radius,
          thickness: 0.5,
          ridge: 0.5,
          rpm: r3(7 + i * 2.2),
          dir: (r + c) % 2 === 0 ? 1 : -1,
        });
      });
    }
    b.z -= GAP + rows * pitch - GAP;
    b.floorEdge = false;
  },

  pendulumAlley(b, length, i) {
    const start = floorRun(b, length);
    const count = Math.max(2, Math.floor(length / 8));
    for (let k = 0; k < count; k++) {
      for (const x of columns(Math.max(1, Math.round(COURSE_WIDTH / 12)))) {
        b.add('pendulum', v3(x, b.y, start - ((k + 0.5) * length) / count), {
          pivotHeight: 7,
          length: 5.5,
          ballRadius: 1.1,
          periodSec: r3(3.1 - 0.27 * i),
          phase: r3(k * 0.37 + b.range(0, 0.2)),
          amplitude: r3(Math.min(1.3, 0.9 + 0.08 * i)),
          bounce: 12,
        });
      }
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
        periodSec: r3(Math.max(1.3, 3.5 - 0.35 * i)),
      });
    }
  },

  bouncePads(b, length, i) {
    // Floor islands over a void, joined by gaps wider than a jump; a row of bounce pads at the front
    // of each island launches the player across. The last island joins the checkpoint pad.
    const island = 5;
    const gap = r3(4.2 + 0.2 * i);
    const jumps = Math.max(1, Math.round((length - island) / (island + gap)));
    floorRun(b, island);
    for (let k = 0; k < jumps; k++) {
      // Pads, 3.4 m wide, spread over the whole width near the island's front edge (crowd rule: 4+ lanes).
      const lanes = Math.round(COURSE_WIDTH / 4);
      for (let lane = 0; lane < lanes; lane++) {
        b.add('bouncePad', v3(-COURSE_WIDTH / 2 + (lane + 0.5) * (COURSE_WIDTH / lanes), b.y + 0.05, b.z + 0.3 + 0.8), {
          size: [3.4, 0.4, 1.6],
          bounce: 14,
          tilt: 0.12,
        });
      }
      b.z -= gap;
      b.platform(0, b.y, b.z, COURSE_WIDTH, island, k % 2 === 0 ? 'platformB' : 'platformA');
      b.z -= island;
    }
  },

  slidingWalls(b, length, i) {
    // Rows of wall panels across the whole track. Every panel drops to the floor and rises again on its own
    // phase (up and down, not sideways), so the way through keeps moving: wait for a panel to lift, then run.
    const start = floorRun(b, length);
    const rows = Math.max(1, Math.floor(length / 7));
    const width = COURSE_WIDTH - 1;
    const panels = Math.max(5, Math.min(12, Math.round(width / (7 - i))));
    for (let k = 0; k < rows; k++) {
      b.add('slidingWall', v3(0, b.y, start - ((k + 0.5) * length) / rows), {
        width,
        height: 2.5,
        thickness: 0.6,
        panels,
        periodSec: r3(Math.max(2.2, 3.9 - 0.35 * i)),
        phase: r3(k * 0.37 + b.range(0, 0.2)),
      });
    }
  },

  carousels(b, length, i) {
    // A void crossed on rotating four-pad carousels, side by side across the track. Hop onto a pad as it comes
    // round, ride it, and hop on to the next carousel or off the far side. Neighbouring carousels turn opposite
    // ways, and a pad pointing at the next piece is `hop` metres from it, a jump a runner can make.
    const radius = 4.2;
    const pad = 3.4;
    const reach = radius + pad / 2;
    const hop = 2.2;
    const spacing = 2 * reach + hop;
    const rows = Math.max(1, Math.floor((length - hop) / spacing));
    const xs = columns(Math.max(2, Math.round(COURSE_WIDTH / (2 * reach + 3))));
    const rpm = r3(4 + 0.9 * i);
    const first = b.z - hop - reach;
    for (let row = 0; row < rows; row++) {
      xs.forEach((x, col) => {
        b.add('carousel', v3(x, b.y, first - row * spacing), {
          radius,
          pad,
          thickness: 0.5,
          rpm,
          dir: (row + col) % 2 === 0 ? 1 : -1,
        });
      });
    }
    // the next floor piece starts `hop` past the last carousel's furthest pad (joinGap adds GAP itself)
    b.z = first - (rows - 1) * spacing - reach - (hop - GAP);
    b.floorEdge = false;
  },

  arrowFloor(b, length, i) {
    // Floor tiles with arrows: stepping on one dashes you along it. Forward tiles shoot you ahead (past your
    // jump if you are not careful); back tiles throw you toward the start. Every row keeps at least two
    // forward lanes, and the more intense the segment the more tiles point back.
    const start = floorRun(b, length);
    const tile = 6;
    const lead = 3;
    const rows = Math.max(2, Math.floor((length - lead) / tile));
    const xs = columns(Math.max(3, Math.round(COURSE_WIDTH / tile)));
    const pBack = Math.min(0.55, 0.28 + 0.06 * i);
    const boost = r3(Math.min(18, 9 + 1.2 * i));
    for (let r = 0; r < rows; r++) {
      const z = start - lead - (r + 0.5) * tile;
      const dirs = xs.map(() => (b.rand() < pBack ? -1 : 1));
      // keep at least two forward lanes in every row
      let forward = dirs.filter((d) => d > 0).length;
      for (let c = 0; forward < 2 && c < dirs.length; c++) {
        const col = Math.floor(b.rand() * dirs.length);
        if (dirs[col]! < 0) {
          dirs[col] = 1;
          forward++;
        }
      }
      xs.forEach((x, c) => {
        b.add('arrowTile', v3(x, b.y + 0.12, z), { size: [tile, 0.12, tile], dir: dirs[c], boost });
      });
    }
  },

  snowBlowerField(b, length, i) {
    // Wide open floor (room to dodge the villain's throws, #84) with fans along both edges taking
    // turns to blow players toward the far edge. Low blocks give shelter from the wind.
    joinGap(b);
    const start = b.z;
    b.platform(0, b.y, start, SNOW_FIELD_WIDTH, length, 'platformB');
    b.z -= length;
    const zones = Math.max(2, Math.floor(length / 7));
    const depth = length / zones;
    // Shelter blocks (domino stacks in the desk look): several per fan strip, scattered over the whole floor
    // at random spots and angles, at least BLOCK_GAP apart so a crowd always has open lanes between them. Each
    // strip is cut into equal columns across the floor with one block at a random spot in each, so both sides
    // get their share instead of the blocks bunching up.
    const perZone = 4 + Math.ceil(i / 2);
    const blocks: [number, number][] = [];
    const xMax = SNOW_FIELD_WIDTH / 2 - 5; // clear of the fans on the edges
    for (let k = 0; k < zones; k++) {
      const z = start - (k + 0.5) * depth;
      const side = k % 2 === 0 ? -1 : 1;
      // Yaw 0 blows toward +X; yaw PI turns the fan round to blow toward -X.
      b.add(
        'snowBlower',
        v3((side * SNOW_FIELD_WIDTH) / 2, b.y, z),
        {
          reach: SNOW_FIELD_WIDTH,
          width: r3(depth - 0.5),
          height: 3,
          windSpeed: r3(Math.min(9, 3 + 1.5 * i)),
          onSec: 3,
          offSec: 2,
          warnSec: 0.5,
          phase: r3(k * 2.5),
        },
        side < 0 ? 0 : r3(Math.PI),
      );
      const column = (2 * xMax) / perZone;
      for (let n = 0; n < perZone; n++) {
        for (let tries = 0; tries < 30; tries++) {
          const x = r3(-xMax + (n + b.range(0.1, 0.9)) * column);
          const bz = r3(z + b.range(-(depth / 2 - 1.2), depth / 2 - 1.2));
          if (blocks.some(([ox, oz]) => Math.hypot(x - ox, bz - oz) < BLOCK_GAP)) continue;
          blocks.push([x, bz]);
          // Mostly across the course, some turned a little, about one in four turned end-on.
          const yaw = r3(b.range(-0.45, 0.45) + (b.range(0, 1) < 0.25 ? Math.PI / 2 : 0));
          b.add('wall', v3(x, b.y, bz), { size: [2.4, 0.9, 1.2] }, yaw);
          break;
        }
      }
    }
  },
};

/** Least distance between the centres of two shelter blocks in the fan field (m). */
const BLOCK_GAP = 4.5;

function checkpointPad(b: Builder) {
  joinGap(b);
  const front = b.z;
  b.platform(0, b.y, front, PAD_WIDTH, PAD_DEPTH, 'accent');
  b.z -= PAD_DEPTH;
  return {
    volume: { pos: v3(0, b.y + 1.5, front - PAD_DEPTH / 2), yaw: 0, half: v3(PAD_WIDTH / 2, 1.5, PAD_DEPTH / 2) },
    // 20 x 15 slots at 0.56 m (300 players): 10.6 m x 7.8 m. Row 0 is 3 m back from the far edge (the one
    // players run off when they miss the next jump) and the last row is 1.2 m from the near edge; before
    // this the grid started 0.5 m from the far edge and people kept falling off right after a respawn.
    respawn: grid(v3(0, b.y, front - PAD_DEPTH + 3), 20, 0.56),
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

  // Start pad: (COURSE_WIDTH + 8) x 20 m, spawn grid of 20 x 15 slots at 1 m.
  b.platform(0, 0, START_DEPTH / 2, COURSE_WIDTH + 8, START_DEPTH, 'platformA');
  b.z = -START_DEPTH / 2;
  // Row 0 is 4.4 m back from the front edge, clear of a sweeper in the first segment (its arms reach to about
  // z = -8.1); the last row is 1.6 m inside the back edge.
  const spawn = grid([0, 0, -5.6], 20, 1);

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
  b.platform(0, b.y, finishFront, COURSE_WIDTH + 8, 16, 'finish');
  b.add('gate', v3(0, b.y, finishFront - 2), { width: COURSE_WIDTH, height: 5, doors: 0, periodSec: 3 });
  b.z -= 16;
  const finish = { pos: v3(0, b.y + 1.5, finishFront - 9), yaw: 0, half: v3((COURSE_WIDTH + 8) / 2, 1.5, 6) };
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
