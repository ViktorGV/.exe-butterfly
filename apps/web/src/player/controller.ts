// Character controller (#5): a deterministic kinematic capsule for the local player.
//
//   const player = createPlayerController({ getColliders: () => course.getColliders(), course: courseDef });
//   engine.onFixedUpdate((dt, t) => {
//     course.stepColliders(t);                     // poses for time t (prevPose = last step)
//     player.step(input.sample(), camera.yaw, dt, t);
//   });
//   player.on('fell', () => player.respawn(course.respawnPoint(player.state.checkpoint, slot)));
//
// Fixed-step deterministic: the same inputs and collider poses give the same trajectory.
import { Anim, BUTTERFLY, PLAYER } from '@wobble/shared/constants';
import { quatFromYaw } from '@wobble/shared/course/obstacles/math';
import { compileWindZones, windAt } from '@wobble/shared/course/obstacles/wind';
import { BOOST_SEC, boostTileAt, compileBoostTiles, type BoostTile } from '@wobble/shared/course/obstacles/boost';
import type { Collider, CourseDef, InputState, PlayerState, Quat, Vec3, Volume } from '@wobble/shared/types';
import {
  capsuleSpheres,
  capsuleVsCollider,
  carryPoint,
  createContact,
  gatherNearby,
  rotateInverse,
  surfaceVelocity,
  wrapAngle,
  yawDelta,
} from '../physics/index.ts';

export type PlayerEventName = 'jump' | 'land' | 'dive' | 'bounce' | 'hit' | 'boost' | 'fell' | 'checkpoint' | 'finish';

export interface PlayerEventMap {
  jump: { speed: number };
  land: { speed: number };
  dive: { speed: number };
  bounce: { entityId: number; speed: number };
  hit: { entityId: number; speed: number };
  /** Stepped onto an arrow tile: `dir` +1 dashes toward the finish, -1 throws you back. */
  boost: { dir: number; speed: number };
  fell: { y: number };
  checkpoint: { index: number };
  finish: { checkpoint: number };
}

export interface SpawnPoint {
  pos: Vec3;
  yaw: number;
}

export interface PlayerController {
  /** Live state, updated in place by step(). */
  readonly state: PlayerState;
  step(input: InputState, cameraYaw: number, dt: number, t: number): void;
  /** Teleport to a spawn or respawn point and clear motion and timers. Keeps checkpoint progress. */
  respawn(point: SpawnPoint): void;
  /** Add velocity (m/s), e.g. from a remote bump or a scripted launch. */
  applyImpulse(v: Vec3): void;
  /** Stagger for `ms` (default PLAYER.stumbleMs): reduced control, no jumping or diving. Ignored while lying down. */
  stumble(ms?: number): void;
  /** Knock the player flat for BUTTERFLY.KNOCKED_MS, then play the get-up (#84). No control while down. */
  knockDown(): void;
  /** The hero's bridge (#84): while x is inside [minX, maxX] the snow blowers' wind does not push the player. null removes it. */
  setWindShelter(lane: { minX: number; maxX: number } | null): void;
  /** Play the reach / push arm animation for BUTTERFLY.GRAB_ANIM_MS, turning to face `dir` (x, z) when given. */
  grab(dir?: readonly [number, number]): void;
  /** Stand up at once (a help-up): a knocked-down or prone player plays the get-up and is free after it. */
  getUp(): void;
  on<K extends PlayerEventName>(evt: K, fn: (e: PlayerEventMap[K]) => void): () => void;
}

export interface PlayerControllerOptions {
  /** Colliders at the current step's poses (stable array; read every step). */
  getColliders: () => readonly Collider[];
  /** Checkpoints, finish volume and kill height; `entities` adds the snow blowers' wind zones (#110). */
  course: Pick<CourseDef, 'checkpoints' | 'finish' | 'killY'> & Partial<Pick<CourseDef, 'entities'>>;
  /** Initial position. Default: origin facing -Z. */
  spawn?: SpawnPoint;
}

/** Tuning that is local to the controller (the shared PLAYER constants hold the rest). */
export const CONTROLLER = Object.freeze({
  /** Normals steeper than this (cos of ~53 degrees) count as ground. */
  groundNormalY: 0.6,
  /** Surface hitting the player faster than this (m/s) knocks them off their feet. */
  hitSpeed: 4,
  /** Turn rate toward the movement direction (rad/s). */
  turnRate: 14,
  /** Control while stumbling (fraction of normal acceleration). */
  stumbleControl: 0.25,
  /** Acceleration and friction multiplier on slippery surfaces. */
  slipperyGrip: 0.12,
  /** Upward velocity multiplier when jump is released early. */
  jumpCut: 0.45,
  /** Max distance moved per collision substep (m); prevents tunnelling. */
  maxSubstepMove: 0.2,
  maxSubsteps: 8,
  solverIterations: 4,
  /** How far down to look for ground when walking off a step or down a slope (m). */
  groundSnap: 0.2,
  /** Ignore the same bouncy entity for this long after a bounce (s). */
  bounceCooldown: 0.2,
  maxHorizontalSpeed: 25,
});

const MS = 1 / 1000;

function compileVolume(v: Volume) {
  return { pos: v.pos, half: v.half, quat: quatFromYaw(v.yaw, [0, 0, 0, 1]) as Quat };
}

export function createPlayerController({ getColliders, course, spawn }: PlayerControllerOptions): PlayerController {
  const shape = { radius: PLAYER.radius, height: PLAYER.height };
  const heights = capsuleSpheres(shape);
  const checkpoints = course.checkpoints.map((c) => compileVolume(c.volume));
  const finish = compileVolume(course.finish);
  const windZones = compileWindZones(course.entities ?? []);
  const boostTiles = compileBoostTiles(course.entities ?? []);

  const state: PlayerState = {
    pos: [0, 0, 0],
    vel: [0, 0, 0],
    yaw: 0,
    anim: Anim.IDLE,
    grounded: false,
    checkpoint: -1,
    finished: false,
  };

  // timers in seconds
  let jumpBuffer = 0;
  let airTime = 0;
  let diveTime = 0;
  let proneTime = 0;
  let diveCooldown = 0;
  let stumbleTime = 0;
  let knockedTime = 0;
  let getupTime = 0;
  let grabTime = 0;
  let shelter: { minX: number; maxX: number } | null = null;
  /** Arrow tiles: how long the current dash lasts, its velocity, and the tile the player is standing on. */
  let boostTime = 0;
  let boostVx = 0;
  let boostVz = 0;
  let onBoostTile: BoostTile | null = null;
  let diving = false;
  let prone = false;
  let jumping = false;
  let fellReported = false;
  let ground: Collider | null = null;
  let groundSlippery = false;
  const bounceCooldowns = new Map<number, number>();

  // scratch (reused every step)
  const nearby: Collider[] = [];
  const contact = createContact();
  const vSurf: Vec3 = [0, 0, 0];
  const carried: Vec3 = [0, 0, 0];
  const local: Vec3 = [0, 0, 0];
  const snapSave: Vec3 = [0, 0, 0];
  const wind: Vec3 = [0, 0, 0];

  // events
  const listeners: { [K in PlayerEventName]?: ((e: PlayerEventMap[K]) => void)[] } = {};
  const payload: PlayerEventMap = {
    jump: { speed: 0 },
    land: { speed: 0 },
    dive: { speed: 0 },
    bounce: { entityId: 0, speed: 0 },
    hit: { entityId: 0, speed: 0 },
    boost: { dir: 1, speed: 0 },
    fell: { y: 0 },
    checkpoint: { index: 0 },
    finish: { checkpoint: 0 },
  };
  function emit<K extends PlayerEventName>(evt: K) {
    const list = listeners[evt];
    if (list) for (let i = 0; i < list.length; i++) list[i](payload[evt]);
  }

  function inVolume(v: ReturnType<typeof compileVolume>) {
    const p = state.pos;
    rotateInverse(v.quat, p[0] - v.pos[0], p[1] + PLAYER.height / 2 - v.pos[1], p[2] - v.pos[2], local);
    return Math.abs(local[0]) <= v.half[0] && Math.abs(local[1]) <= v.half[1] && Math.abs(local[2]) <= v.half[2];
  }

  /**
   * Bounce pad (#110): set the speed along the pad's up axis to `speed` and keep the rest, so a running
   * player sails forward over the gap. No stumble, and no coyote jump to cut the launch short.
   */
  function padLaunch(c: Collider, speed: number) {
    const [x, y, z, w] = c.pose.quat;
    const ux = 2 * (x * y - z * w);
    const uy = 1 - 2 * (x * x + z * z);
    const uz = 2 * (y * z + x * w);
    const v = state.vel;
    const add = speed - (v[0] * ux + v[1] * uy + v[2] * uz);
    v[0] += ux * add;
    v[1] += uy * add;
    v[2] += uz * add;
    jumping = false;
    airTime = Infinity;
  }

  function stumble(ms: number = PLAYER.stumbleMs) {
    if (knockedTime > 0 || getupTime > 0) return; // already on the floor
    stumbleTime = ms * MS;
    diving = false;
    prone = false;
    jumping = false;
  }

  /**
   * Push the capsule out of every overlapping collider and fix up velocity.
   * Returns the best ground collider touched (or null).
   */
  function resolve(dt: number): Collider | null {
    const p = state.pos;
    const v = state.vel;
    let best: Collider | null = null;
    let bestNy: number = CONTROLLER.groundNormalY;
    for (let iter = 0; iter < CONTROLLER.solverIterations; iter++) {
      let touched = false;
      for (let i = 0; i < nearby.length; i++) {
        const c = nearby[i];
        const sphere = capsuleVsCollider(p, shape.radius, heights, c, contact);
        if (sphere < 0 || contact.depth < 1e-6) continue;
        touched = true;
        const n = contact.normal;
        p[0] += n[0] * contact.depth;
        p[1] += n[1] * contact.depth;
        p[2] += n[2] * contact.depth;

        if (n[1] > bestNy) {
          bestNy = n[1];
          best = c;
        }

        const part = c.part;
        // A pad only launches when stepped on from above; its sides are solid.
        const launch = part.pad ? n[1] > CONTROLLER.groundNormalY : true;
        if (part.surface === 'bouncy' && launch && !bounceCooldowns.has(c.entityId)) {
          const speed = part.bounce ?? 12;
          if (part.pad) {
            padLaunch(c, speed);
          } else {
            v[0] = n[0] * speed;
            v[1] = n[1] * speed;
            v[2] = n[2] * speed;
            stumble();
          }
          bounceCooldowns.set(c.entityId, CONTROLLER.bounceCooldown);
          payload.bounce.entityId = c.entityId;
          payload.bounce.speed = speed;
          emit('bounce');
          continue;
        }

        const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
        if (n[1] > CONTROLLER.groundNormalY) {
          // Ground: stop sinking; the carry step already moved us with the surface.
          if (vn < 0) {
            v[0] -= n[0] * vn;
            v[1] -= n[1] * vn;
            v[2] -= n[2] * vn;
          }
          continue;
        }

        // Wall, ceiling or moving obstacle: match the surface's speed along the normal.
        const h = heights[sphere];
        surfaceVelocity(
          c,
          p[0] - n[0] * shape.radius,
          p[1] + h - n[1] * shape.radius,
          p[2] - n[2] * shape.radius,
          dt,
          vSurf,
        );
        const sn = vSurf[0] * n[0] + vSurf[1] * n[1] + vSurf[2] * n[2];
        const rel = vn - sn;
        if (rel < 0) {
          v[0] -= n[0] * rel;
          v[1] -= n[1] * rel;
          v[2] -= n[2] * rel;
          if (sn > 0.5 && -rel > CONTROLLER.hitSpeed && stumbleTime <= 0) {
            stumble();
            payload.hit.entityId = c.entityId;
            payload.hit.speed = -rel;
            emit('hit');
          }
        }
      }
      if (!touched) break;
    }
    return best;
  }

  const controller: PlayerController = {
    state,

    step(input, cameraYaw, dt, t) {
      if (!(dt > 0)) return;
      const p = state.pos;
      const v = state.vel;
      const wasGrounded = state.grounded;

      // ---- timers
      jumpBuffer = Math.max(0, jumpBuffer - dt);
      diveCooldown = Math.max(0, diveCooldown - dt);
      stumbleTime = Math.max(0, stumbleTime - dt);
      if (knockedTime > 0) {
        knockedTime = Math.max(0, knockedTime - dt);
        if (knockedTime === 0) getupTime = BUTTERFLY.GETUP_MS * MS; // knocked down -> get up
      } else getupTime = Math.max(0, getupTime - dt);
      grabTime = Math.max(0, grabTime - dt);
      const lying = knockedTime > 0 || getupTime > 0;
      if (diving) {
        diveTime -= dt;
        // Burst over while still airborne: back to a normal fall with air control.
        if (diveTime <= 0 && !wasGrounded) diving = false;
      }
      if (prone) {
        proneTime -= dt;
        if (proneTime <= 0) prone = false;
      }
      for (const [id, left] of bounceCooldowns) {
        if (left - dt <= 0) bounceCooldowns.delete(id);
        else bounceCooldowns.set(id, left - dt);
      }
      if (input.jumpPressed) jumpBuffer = PLAYER.jumpBufferMs * MS;

      // ---- ride the surface we stood on last step (moving platforms, spinners)
      if (wasGrounded && ground) {
        carryPoint(ground.prevPose, ground.pose, p[0], p[1], p[2], carried);
        p[0] = carried[0];
        p[1] = carried[1];
        p[2] = carried[2];
        state.yaw = wrapAngle(state.yaw + yawDelta(ground.prevPose.quat, ground.pose.quat));
      }

      // ---- horizontal control (camera-relative)
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
      const wishX = input.moveX * cos - input.moveY * sin;
      const wishZ = -input.moveX * sin - input.moveY * cos;
      const hasInput = wishX !== 0 || wishZ !== 0;
      const frozen = state.finished && wasGrounded;
      // Snow blowers that are on add their wind to the velocity the player is steering toward, so it
      // pushes sideways without slowing a player who walks straight ahead.
      const sheltered = shelter !== null && p[0] >= shelter.minX && p[0] <= shelter.maxX;
      const windy = windZones.length > 0 && !frozen && !sheltered && windAt(windZones, p, t, wind) > 0;
      let pushX = windy ? wind[0] : 0;
      let pushZ = windy ? wind[2] : 0;
      // Arrow tiles: stepping onto one starts a short dash along its arrows (leaving the tile re-arms it).
      boostTime = Math.max(0, boostTime - dt);
      if (boostTiles.length > 0) {
        const tile = wasGrounded && !frozen && !lying ? boostTileAt(boostTiles, p[0], p[1], p[2]) : null;
        if (tile && tile !== onBoostTile) {
          boostTime = BOOST_SEC;
          boostVx = tile.vx;
          boostVz = tile.vz;
          payload.boost.dir = tile.dir;
          payload.boost.speed = Math.hypot(tile.vx, tile.vz);
          emit('boost');
        }
        onBoostTile = tile;
      }
      if (boostTime > 0) {
        pushX += boostVx;
        pushZ += boostVz;
      }
      const pushed = pushX !== 0 || pushZ !== 0;

      if (!diving) {
        let grip = groundSlippery && wasGrounded ? CONTROLLER.slipperyGrip : 1;
        if (stumbleTime > 0) grip *= CONTROLLER.stumbleControl;
        let rate: number;
        let tx = wishX * PLAYER.runSpeed;
        let tz = wishZ * PLAYER.runSpeed;
        if (prone || lying || frozen) {
          tx = tz = 0;
          rate = PLAYER.friction * grip;
        } else if (wasGrounded) {
          rate = (hasInput ? PLAYER.accelGround : PLAYER.friction) * grip;
        } else {
          rate = hasInput || pushed ? PLAYER.accelAir * grip : 0; // keep momentum in the air
        }
        if (pushed) {
          tx += pushX;
          tz += pushZ;
        }
        if (prone && !wasGrounded) rate = 0;
        // Move the horizontal velocity toward the target as a 2D vector.
        const dx = tx - v[0];
        const dz = tz - v[2];
        const dist = Math.hypot(dx, dz);
        const maxStep = rate * dt;
        if (dist <= maxStep) {
          v[0] = tx;
          v[2] = tz;
        } else if (dist > 0) {
          v[0] += (dx / dist) * maxStep;
          v[2] += (dz / dist) * maxStep;
        }
      }

      // ---- jump (buffer + coyote time + inherit surface velocity)
      const canAct = !diving && !prone && !lying && stumbleTime <= 0 && !state.finished;
      let jumpedNow = false;
      if (jumpBuffer > 0 && canAct && (wasGrounded || airTime <= PLAYER.coyoteMs * MS)) {
        if (wasGrounded && ground) {
          surfaceVelocity(ground, p[0], p[1], p[2], dt, vSurf);
          v[0] += vSurf[0];
          v[2] += vSurf[2];
        }
        v[1] = PLAYER.jumpVelocity;
        jumpBuffer = 0;
        airTime = Infinity; // no second coyote jump
        jumping = true;
        jumpedNow = true;
        state.grounded = false;
        payload.jump.speed = PLAYER.jumpVelocity;
        emit('jump');
      }
      if (jumping && v[1] > 0 && !input.jump) {
        v[1] *= CONTROLLER.jumpCut;
        jumping = false;
      }
      if (v[1] <= 0) jumping = false;

      // ---- dive (forward burst, usable in the air)
      if (input.divePressed && canAct && diveCooldown <= 0) {
        let dx = hasInput ? wishX : -Math.sin(state.yaw);
        let dz = hasInput ? wishZ : -Math.cos(state.yaw);
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const speed = Math.max(PLAYER.diveSpeed, Math.hypot(v[0], v[2]));
        v[0] = dx * speed;
        v[2] = dz * speed;
        v[1] = Math.max(v[1], PLAYER.diveUp);
        diving = true;
        jumping = false;
        diveTime = PLAYER.diveMs * MS;
        diveCooldown = PLAYER.diveCooldownMs * MS;
        state.yaw = Math.atan2(-dx, -dz);
        state.grounded = false;
        payload.dive.speed = speed;
        emit('dive');
      }

      // ---- integrate with substeps, resolving collisions after each
      const hs = Math.hypot(v[0], v[2]);
      if (hs > CONTROLLER.maxHorizontalSpeed) {
        v[0] *= CONTROLLER.maxHorizontalSpeed / hs;
        v[2] *= CONTROLLER.maxHorizontalSpeed / hs;
      }
      const travel = (Math.hypot(v[0], v[1], v[2]) + Math.abs(PLAYER.gravity) * dt) * dt;
      const subs = Math.min(CONTROLLER.maxSubsteps, Math.max(1, Math.ceil(travel / CONTROLLER.maxSubstepMove)));
      const h = dt / subs;
      gatherNearby(getColliders(), p, shape, travel + CONTROLLER.groundSnap + 0.5, nearby);

      let groundHit: Collider | null = null;
      for (let s = 0; s < subs; s++) {
        const vy0 = v[1];
        v[1] = Math.max(PLAYER.maxFallSpeed, v[1] + PLAYER.gravity * h);
        p[0] += v[0] * h;
        p[1] += (vy0 + v[1]) * 0.5 * h; // exact for constant gravity
        p[2] += v[2] * h;
        groundHit = resolve(dt) ?? groundHit;
      }

      // ---- stick to the ground when walking down steps and slopes
      if (!groundHit && wasGrounded && !jumpedNow && !diving && v[1] <= 0 && stumbleTime <= 0) {
        snapSave[0] = p[0];
        snapSave[1] = p[1];
        snapSave[2] = p[2];
        p[1] -= CONTROLLER.groundSnap;
        groundHit = resolve(dt);
        if (!groundHit) {
          p[0] = snapSave[0];
          p[1] = snapSave[1];
          p[2] = snapSave[2];
        }
      }

      // ---- ground state and landing
      ground = groundHit;
      groundSlippery = groundHit?.part.surface === 'slippery';
      state.grounded = groundHit !== null && v[1] <= 0.01;
      if (state.grounded) {
        airTime = 0;
        if (v[1] < 0) v[1] = 0;
        if (!wasGrounded) {
          payload.land.speed = -Math.min(0, state.vel[1]);
          emit('land');
        }
        if (diving) {
          // Belly landing: slide into prone, then get back up.
          diving = false;
          prone = true;
          proneTime = PLAYER.proneMs * MS;
        }
      } else {
        airTime += dt;
      }

      // ---- facing
      if (diving) {
        // keep dive direction
      } else if (hasInput && !prone && !lying && !frozen) {
        const target = Math.atan2(-wishX, -wishZ);
        const diff = wrapAngle(target - state.yaw);
        const turn = CONTROLLER.turnRate * dt * (stumbleTime > 0 ? CONTROLLER.stumbleControl : 1);
        state.yaw = wrapAngle(state.yaw + Math.max(-turn, Math.min(turn, diff)));
      }

      // ---- animation state
      const speed = Math.hypot(v[0], v[2]);
      // On the floor after a hard hit (only while standing on something: in the air it is a plain fall).
      if (knockedTime > 0 && state.grounded) state.anim = Anim.KNOCKED;
      else if (getupTime > 0 && state.grounded) state.anim = Anim.GETUP;
      else if (prone) state.anim = Anim.PRONE;
      else if (diving) state.anim = Anim.DIVE;
      else if (stumbleTime > 0) state.anim = Anim.STUMBLE;
      else if (grabTime > 0 && state.grounded && !state.finished) state.anim = Anim.GRAB;
      else if (state.finished && state.grounded) state.anim = Anim.CELEBRATE;
      else if (state.grounded) state.anim = speed > 0.5 ? Anim.RUN : Anim.IDLE;
      else state.anim = v[1] > 0 ? Anim.JUMP : Anim.FALL;

      // ---- triggers
      const next = state.checkpoint + 1;
      if (next < checkpoints.length && inVolume(checkpoints[next])) {
        state.checkpoint = next;
        payload.checkpoint.index = next;
        emit('checkpoint');
      }
      if (!state.finished && state.checkpoint === checkpoints.length - 1 && inVolume(finish)) {
        state.finished = true;
        payload.finish.checkpoint = state.checkpoint;
        emit('finish');
      }
      if (!fellReported && p[1] < course.killY) {
        fellReported = true;
        payload.fell.y = p[1];
        emit('fell');
      }
    },

    respawn(point) {
      state.pos[0] = point.pos[0];
      state.pos[1] = point.pos[1];
      state.pos[2] = point.pos[2];
      state.vel[0] = state.vel[1] = state.vel[2] = 0;
      state.yaw = point.yaw;
      state.anim = Anim.IDLE;
      state.grounded = false;
      jumpBuffer = 0;
      airTime = Infinity;
      diving = prone = jumping = false;
      diveTime = proneTime = diveCooldown = stumbleTime = knockedTime = getupTime = grabTime = boostTime = 0;
      onBoostTile = null;
      fellReported = false;
      ground = null;
      groundSlippery = false;
      bounceCooldowns.clear();
    },

    applyImpulse(imp) {
      state.vel[0] += imp[0];
      state.vel[1] += imp[1];
      state.vel[2] += imp[2];
      if (imp[1] > 0) {
        state.grounded = false;
        airTime = Infinity;
      }
    },

    stumble(ms) {
      stumble(ms);
    },

    knockDown() {
      boostTime = 0; // floored: any dash in progress ends
      knockedTime = BUTTERFLY.KNOCKED_MS * MS;
      getupTime = 0;
      stumbleTime = 0;
      diving = false;
      prone = false;
      jumping = false;
    },

    setWindShelter(lane) {
      shelter = lane ? { minX: lane.minX, maxX: lane.maxX } : null;
    },

    grab(dir) {
      grabTime = BUTTERFLY.GRAB_ANIM_MS * MS;
      if (dir && (dir[0] !== 0 || dir[1] !== 0)) state.yaw = Math.atan2(-dir[0], -dir[1]); // face the target
    },

    getUp() {
      const wasDown = knockedTime > 0 || prone;
      knockedTime = 0;
      stumbleTime = 0;
      prone = false;
      proneTime = 0;
      getupTime = wasDown ? BUTTERFLY.GETUP_MS * MS : 0;
    },

    on(evt, fn) {
      const list = (listeners[evt] ??= []) as ((e: PlayerEventMap[typeof evt]) => void)[];
      list.push(fn);
      return () => {
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    },
  };

  if (spawn) controller.respawn(spawn);
  return controller;
}
