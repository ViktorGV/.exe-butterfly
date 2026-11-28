// Debug autopilot (#26): drives the local player along the course so smoke tests can reach
// checkpoints without flaky key timing. Enabled in the game with ?autopilot=1.
// It steers toward the next checkpoint (then the finish), jumps over gaps and low hazards.
import { PLAYER, SIM_HZ } from '@wobble/shared/constants';
import type { Collider, CourseDef, InputState, PlayerState, Pose } from '@wobble/shared/types';
import { boostTileAt, compileBoostTiles } from '@wobble/shared/course/obstacles/boost';
import { createContact, sphereVsPart } from '../physics/index.ts';
import { boundingRadius } from '../physics/contact.ts';

export interface Autopilot {
  /** Fill and return a reused InputState for camera yaw 0 (forward = -Z). */
  drive(player: PlayerState, colliders: readonly Collider[]): InputState;
}

const LOOK_AHEAD = [2.5, 4, 5.5];
/** Distances ahead checked for something tall in the way (close first: a wall the player touches). */
const BLOCK_AHEAD = [0.7, 1.6];

/** A jump from a void's edge lands somewhere along here; two neighbouring points covered means a pad body is there. */
const LANDING_PROBES = [2.5, 3.5, 4.5, 5.5];
/** Heights above the feet where landing ground is looked for, metres. */
const LANDING_RISE = [0, 0.6, 1.2];
/** Distances ahead (m) checked for a tile that would throw the player back. */
const TILE_PROBES = [0, 1.5, 4, 7.5];
/**
 * Broadphase (#179): only colliders whose bounding sphere comes within this many metres of the player are
 * probed. Every probe is at most ~21 m away (80 half-metre lanes either side, 5.5 m ahead) and a moving pad is
 * predicted under a second ahead, so 30 m keeps every decision exactly the same as probing the whole course.
 */
const NEAR_RADIUS = 30;

/** Cheap exact reject: a probe sphere that cannot reach the part's bounding sphere cannot touch the part. */
function far(pose: Pose, part: Collider['part'], x: number, y: number, z: number, r: number): boolean {
  const dx = x - pose.pos[0];
  const dy = y - pose.pos[1];
  const dz = z - pose.pos[2];
  const reach = boundingRadius(part) + r;
  return dx * dx + dy * dy + dz * dz > reach * reach;
}

export function createAutopilot(
  course: Pick<CourseDef, 'checkpoints' | 'finish'> & Partial<Pick<CourseDef, 'entities'>>,
): Autopilot {
  const tiles = compileBoostTiles(course.entities ?? []);
  /** Is there floor within a jump's reach ahead (along heading hx, hz)? */
  const landingAhead = (colliders: readonly Collider[], x: number, y: number, z: number, hx: number, hz: number) => {
    let before = false;
    for (const d of LANDING_PROBES) {
      // the pad must be under that point when the jump gets there, d metres away at run speed
      // (a jump can land on ground that rises, like the finish ramp, so look at a few heights)
      const t = d / PLAYER.runSpeed;
      let here = false;
      for (let r = 0; r < LANDING_RISE.length && !here; r++) {
        here = groundAt(colliders, x + hx * d, y + LANDING_RISE[r]!, z + hz * d, t);
      }
      if (here && before) return true;
      before = here;
    }
    return false;
  };
  const out: InputState = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, dive: false, divePressed: false };
  const contact = createContact();
  let jumpHeld = 0;
  /** Lane (world x) chosen while grounded, kept through the jump that follows. */
  let laneX: number | null = null;
  /** Arrow tiles: the lane (world x) the bot committed to, kept until its tiles stop pointing forward. */
  let tileLane: number | null = null;

  /** A pose moved along a collider's own velocity (estimated from its last step) for `ahead` seconds. */
  const predicted: Pose = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
  /**
   * Is there something solid under (x, z) within reach of height y? With `ahead` > 0, is there going to be, that
   * many seconds from now: a pad turning on a carousel has moved on by the time a jump gets there.
   */
  const groundAt = (colliders: readonly Collider[], x: number, y: number, z: number, ahead = 0) => {
    for (const c of colliders) {
      if (!c.part.collide || c.part.surface === 'bouncy') continue;
      let pose = c.pose;
      if (ahead > 0) {
        const k = ahead * SIM_HZ; // steps ahead; the velocity is the movement over one step
        const dx = (c.pose.pos[0] - c.prevPose.pos[0]) * k;
        const dy = (c.pose.pos[1] - c.prevPose.pos[1]) * k;
        const dz = (c.pose.pos[2] - c.prevPose.pos[2]) * k;
        if (dx !== 0 || dy !== 0 || dz !== 0) {
          predicted.pos[0] = c.pose.pos[0] + dx;
          predicted.pos[1] = c.pose.pos[1] + dy;
          predicted.pos[2] = c.pose.pos[2] + dz;
          predicted.quat = c.pose.quat;
          pose = predicted;
        }
      }
      // A small probe just under the feet: a wide one bridges narrow gaps (between spinner discs) and a
      // deep one sits nearer the underside of thin floors, so neither would count as floor. 0.12 m down keeps
      // the probe nearer the top face than the bottom face of a 0.4 m bridge (at 0.2 m it is dead centre, and
      // a player standing at exactly y = 0 ties between the two faces).
      if (far(pose, c.part, x, y - 0.12, z, 0.25)) continue;
      if (sphereVsPart(x, y - 0.12, z, 0.25, c.part, pose, contact) && contact.normal[1] > 0.5) return true;
    }
    return false;
  };
  /** Is there a solid obstacle at knee/hip height at (x, z)? */
  const blockedAt = (colliders: readonly Collider[], x: number, y: number, z: number) => {
    for (const c of colliders) {
      if (!c.part.collide || far(c.pose, c.part, x, y + 0.6, z, 0.4)) continue;
      if (sphereVsPart(x, y + 0.6, z, 0.4, c.part, c.pose, contact) && contact.normal[1] < 0.5) return true;
    }
    return false;
  };

  /** Colliders near the player this step (reused; see NEAR_RADIUS). */
  const near: Collider[] = [];
  const gather = (all: readonly Collider[], p: PlayerState) => {
    near.length = 0;
    for (let i = 0; i < all.length; i++) {
      const c = all[i]!;
      if (!c.part.collide) continue;
      const r = boundingRadius(c.part) + NEAR_RADIUS;
      const dx = c.pose.pos[0] - p.pos[0];
      const dy = c.pose.pos[1] - p.pos[1];
      const dz = c.pose.pos[2] - p.pos[2];
      if (dx * dx + dy * dy + dz * dz <= r * r) near.push(c);
    }
    return near;
  };
  // Arrow tiles (allocation-free helpers; the heading is set at the start of each drive).
  let tfx = 0;
  let tfz = 0;
  let tpy = 0;
  let tpz = 0;
  const tileAt = (x: number, d: number) => boostTileAt(tiles, x + tfx * d, tpy, tpz + tfz * d);
  const badAt = (x: number) => {
    for (let i = 0; i < TILE_PROBES.length; i++) {
      const t = tileAt(x, TILE_PROBES[i]!);
      if (t !== null && t.dir < 0) return true;
    }
    return false;
  };
  const anyAt = (x: number) => {
    for (let i = 0; i < TILE_PROBES.length; i++) if (tileAt(x, TILE_PROBES[i]!) !== null) return true;
    return false;
  };

  return {
    drive(p, allColliders) {
      const colliders = gather(allColliders, p);
      const next = p.checkpoint + 1;
      const target = next < course.checkpoints.length ? course.checkpoints[next].volume.pos : course.finish.pos;
      const dx = target[0] - p.pos[0];
      const dz = target[2] - p.pos[2];
      const len = Math.hypot(dx, dz) || 1;
      // camera yaw 0: right = +X, forward = -Z
      out.moveX = dx / len;
      out.moveY = -dz / len;

      // No floor straight ahead (bridges, platform rows): steer to the nearest lane that has some.
      // Looks 2.5 m ahead first, then further, so it also finds floor that starts later (spinner discs).
      if (p.grounded) {
        laneX = null;
        if (!groundAt(colliders, p.pos[0] + (dx / len) * 2.5, p.pos[1], p.pos[2] + (dz / len) * 2.5)) {
          search: for (const ahead of LOOK_AHEAD) {
            const fz = p.pos[2] + (dz / len) * ahead;
            for (let k = 1; k <= 80; k++) {
              const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
              if (groundAt(colliders, p.pos[0] + off, p.pos[1], fz)) {
                laneX = p.pos[0] + off;
                break search;
              }
            }
          }
        }
      }
      // Something tall straight ahead (sliding wall panels): steer to the nearest clear gap.
      if (p.grounded && laneX === null) {
        blocked: for (const ahead of BLOCK_AHEAD) {
          const bz = p.pos[2] + (dz / len) * ahead;
          if (!blockedAt(colliders, p.pos[0] + (dx / len) * ahead, p.pos[1], bz)) continue;
          for (let k = 1; k <= 80; k++) {
            const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
            const x = p.pos[0] + off;
            if (!blockedAt(colliders, x, p.pos[1], bz) && groundAt(colliders, x, p.pos[1], bz)) {
              laneX = x;
              break blocked;
            }
          }
        }
      }
      // Arrow tiles: do not walk into a tile that throws you back. Pick a lane whose tiles point forward for the
      // next couple of rows, snap to the middle of its tile, and stay in it until it stops being safe.
      if (tiles.length > 0 && p.grounded && laneX === null) {
        tfz = dz / len;
        tfx = dx / len;
        tpy = p.pos[1];
        tpz = p.pos[2];
        if (tileLane !== null && (badAt(tileLane) || (!anyAt(tileLane) && !anyAt(p.pos[0])))) tileLane = null;
        if (tileLane === null && badAt(p.pos[0])) {
          for (let k = 1; k <= 80 && tileLane === null; k++) {
            const x = p.pos[0] + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
            if (badAt(x)) continue;
            // snap to the middle of the tile ahead so the bot is not riding a seam between two columns
            const t = tileAt(x, TILE_PROBES[2]!) ?? tileAt(x, TILE_PROBES[1]!);
            tileLane = t ? t.x : x;
          }
        }
        if (tileLane !== null) laneX = tileLane;
      }
      // Head for the chosen lane, on the ground and through the air until the next landing.
      if (laneX !== null) {
        const lx = laneX - p.pos[0];
        const lz = (dz / len) * 2.5;
        const l = Math.hypot(lx, lz) || 1;
        out.moveX = lx / l;
        out.moveY = -lz / l;
      }
      const hx = out.moveX;
      const hz = -out.moveY;
      const ax = p.pos[0] + hx * 1.6;
      const az = p.pos[2] + hz * 1.6;
      const blocked = blockedAt(colliders, ax, p.pos[1], az);
      const voidAhead = p.grounded && !groundAt(colliders, ax, p.pos[1], az);
      let wantJump = p.grounded && (voidAhead || blocked);
      if (wantJump && voidAhead && !blocked && !landingAhead(colliders, p.pos[0], p.pos[1], p.pos[2], hx, hz)) {
        // About to leap into a void with nothing to land on (a carousel pad has not come round yet): wait at the edge.
        wantJump = false;
        // keep lining up sideways with the lane (a narrow bridge), but do not step off
        out.moveX = laneX !== null ? Math.max(-0.6, Math.min(0.6, laneX - p.pos[0])) : 0;
        out.moveY = 0;
      }
      if (wantJump) jumpHeld = 18;
      out.jumpPressed = wantJump;
      out.jump = jumpHeld > 0;
      if (jumpHeld > 0) jumpHeld--;
      return out;
    },
  };
}
