// Solo practice bots: about a dozen local racers driven by the autopilot through their own player
// controllers. They bump the player and each other (soft crowd collision), can be pushed, saved or
// helped up by the player's grab, sometimes push the player, and finish in a real local race order.
// Everything is preallocated in createBots; step() allocates nothing.
import { Anim, BUTTERFLY, GUNS } from '@wobble/shared/constants';
import type {
  Collider,
  CourseDef,
  GrabKind,
  GunKind,
  InputState,
  PlayerState,
  RemoteState,
} from '@wobble/shared/types';
import { createPlayerController, type PlayerController, type SpawnPoint } from '../player/index.ts';
import { createCrowdCollision } from '../player/crowdCollision.ts';
import { createAutopilot, type Autopilot } from './autopilot.ts';
import { PUSH_FEEL } from '../butterfly/pushFeel.ts';

export const BOTS = Object.freeze({
  /** Bots in a solo race (plus the player makes 21; the trial-player scenario of #179). */
  count: 20,
  /** Slowest bot runs at this fraction of full stick; the fastest at 1. */
  minSkill: 0.8,
  /** Seconds a bot waits between pushes, randomised in [min, min + spread]. */
  pushCooldownMin: 5,
  pushCooldownSpread: 6,
  /** No bot pushes the player again within this many seconds of the last bot push. */
  pushGlobalCooldown: 3,
  /** Chance per step that a bot in reach (and off cooldown) pushes. */
  pushChancePerStep: 0.04,
});

export const BOT_NAMES = Object.freeze([
  'Pip',
  'Noodle',
  'Bramble',
  'Wink',
  'Tofu',
  'Zuzu',
  'Pebble',
  'Fizz',
  'Mochi',
  'Gusto',
  'Puddle',
  'Sprout',
]);

/** Ids of bots start here; the local player is 0. */
export const BOT_ID_BASE = 1;

export interface BotsOptions {
  course: Pick<CourseDef, 'checkpoints' | 'finish' | 'killY'> & Partial<Pick<CourseDef, 'entities'>>;
  getColliders: () => readonly Collider[];
  /** Grid slots for the bots (one per bot, the player's slot left out). */
  slots: readonly number[];
  spawnPoint(slot: number, out: SpawnPoint): SpawnPoint;
  respawnPoint(checkpoint: number, slot: number, out: SpawnPoint): SpawnPoint;
  /** Deterministic in tests. Default Math.random. */
  random?: () => number;
}

export interface BotPushEvent {
  by: number;
  /** unit xz vector from the bot toward the player */
  dir: readonly [number, number];
}

export interface Bots {
  readonly ids: readonly number[];
  /** Live bot states for the crowd renderer, crowd collision and grab targeting (stable objects). */
  readonly remote: ReadonlyMap<number, RemoteState>;
  /** Bots finished so far. */
  readonly finishedCount: number;
  /** Back to the start grid, nobody finished. */
  reset(): void;
  /** One fixed step. `racing` false keeps the bots standing (countdown, pause). */
  step(dt: number, t: number, player: PlayerState, racing: boolean): void;
  /** The player's grab on bot `id`. Returns false when there is no such bot. */
  grabbed(id: number, kind: GrabKind, dir: readonly [number, number], from: PlayerState): boolean;
  /**
   * Gun: the player shot bot `id` (`dir` = unit xz from the player toward it): it is knocked flat, then goes back
   * to its last checkpoint. False when there is no such racing bot.
   */
  shot(id: number, dir: readonly [number, number], kind: GunKind): boolean;
  /** Record the player's finish and return their place. */
  finishPlayer(): number;
  /** Live place of the player among the bots (1 = leading). */
  placeOf(player: PlayerState): number;
  onPush(fn: (e: BotPushEvent) => void): void;
  onFinish(fn: (id: number, place: number) => void): void;
  /** For tests. */
  controller(id: number): PlayerController | undefined;
}

interface Bot {
  id: number;
  slot: number;
  ctl: PlayerController;
  pilot: Autopilot;
  skill: number;
  /** wander in x so the pack spreads out, in [-1, 1] */
  wander: number;
  pushIn: number;
  /** Seconds until a shot bot goes back to its checkpoint (0 = not shot). */
  shotFor: number;
  /** Seconds left knocked flat by a gun that does not respawn (blaster, shotgun). */
  stunFor: number;
  remote: RemoteState;
  /** all other bots plus the player, for this bot's crowd collision */
  others: Map<number, RemoteState>;
}

const IDLE: InputState = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, dive: false, divePressed: false };

/** Further along the course is a bigger number (checkpoints first, then distance toward -Z). */
function progress(s: PlayerState): number {
  return (s.finished ? 1e9 : 0) + (s.checkpoint + 1) * 1e5 - s.pos[2];
}

export function createBots(opts: BotsOptions): Bots {
  const rand = opts.random ?? Math.random;
  const count = opts.slots.length;
  const point: SpawnPoint = { pos: [0, 0, 0], yaw: 0 };
  const bumping = createCrowdCollision();
  const remote = new Map<number, RemoteState>();
  const playerRemote: RemoteState = { pos: [0, 0, 0], yaw: 0, anim: Anim.IDLE, flags: 0 };
  const pushDir: [number, number] = [0, 0];
  const pushEvent: BotPushEvent = { by: 0, dir: pushDir };
  const pushFns: ((e: BotPushEvent) => void)[] = [];
  const finishFns: ((id: number, place: number) => void)[] = [];
  const bots: Bot[] = [];
  const ids: number[] = [];
  let finishedCount = 0;
  let placed = 0;
  let playerPlace = 0;
  let globalPushIn = 0;

  for (let i = 0; i < count; i++) {
    const id = BOT_ID_BASE + i;
    const slot = opts.slots[i]!;
    const ctl = createPlayerController({
      getColliders: opts.getColliders,
      course: opts.course,
      spawn: opts.spawnPoint(slot, point),
    });
    const bot: Bot = {
      id,
      slot,
      ctl,
      pilot: createAutopilot(opts.course),
      skill: 1,
      wander: 0,
      pushIn: 0,
      shotFor: 0,
      stunFor: 0,
      // pos is the controller's own array: always current, no copy
      remote: { pos: ctl.state.pos, yaw: 0, anim: Anim.IDLE, flags: 0 },
      others: new Map(),
    };
    ctl.on('fell', () => {
      ctl.respawn(opts.respawnPoint(ctl.state.checkpoint, slot, point));
    });
    ctl.on('finish', () => {
      finishedCount++;
      const place = ++placed;
      for (const fn of finishFns) fn(id, place);
    });
    bots.push(bot);
    ids.push(id);
    remote.set(id, bot.remote);
  }
  for (const b of bots) {
    for (const o of bots) if (o !== b) b.others.set(o.id, o.remote);
    b.others.set(0, playerRemote);
  }

  function reset() {
    finishedCount = 0;
    placed = 0;
    playerPlace = 0;
    globalPushIn = BOTS.pushGlobalCooldown;
    for (const b of bots) {
      b.shotFor = 0;
      b.stunFor = 0;
      b.ctl.state.checkpoint = -1;
      b.ctl.state.finished = false;
      b.ctl.respawn(opts.spawnPoint(b.slot, point));
      b.skill = BOTS.minSkill + (1 - BOTS.minSkill) * rand();
      b.wander = rand() * 2 - 1;
      b.pushIn = BOTS.pushCooldownMin + BOTS.pushCooldownSpread * rand();
      b.remote.yaw = b.ctl.state.yaw;
      b.remote.anim = b.ctl.state.anim;
    }
  }
  reset();

  function tryPush(b: Bot, player: PlayerState) {
    if (b.pushIn > 0 || globalPushIn > 0 || player.finished) return;
    const s = b.ctl.state;
    if (!s.grounded) return;
    const dx = player.pos[0] - s.pos[0];
    const dz = player.pos[2] - s.pos[2];
    const d2 = dx * dx + dz * dz;
    const reach = BUTTERFLY.GRAB_REACH_M;
    if (d2 > reach * reach || Math.abs(player.pos[1] - s.pos[1]) > 1.2) return;
    if (rand() >= BOTS.pushChancePerStep) return;
    const d = Math.sqrt(d2) || 1e-6;
    pushDir[0] = dx / d;
    pushDir[1] = dz / d;
    b.ctl.grab(pushDir);
    b.pushIn = BOTS.pushCooldownMin + BOTS.pushCooldownSpread * rand();
    globalPushIn = BOTS.pushGlobalCooldown;
    pushEvent.by = b.id;
    for (const fn of pushFns) fn(pushEvent);
  }

  return {
    ids,
    remote,
    get finishedCount() {
      return finishedCount;
    },
    reset,
    step(dt, t, player, racing) {
      playerRemote.pos[0] = player.pos[0];
      playerRemote.pos[1] = player.pos[1];
      playerRemote.pos[2] = player.pos[2];
      playerRemote.yaw = player.yaw;
      playerRemote.anim = player.anim;
      if (racing) globalPushIn -= dt;
      for (const b of bots) {
        const s = b.ctl.state;
        let input = IDLE;
        if (racing && !s.finished) {
          input = b.pilot.drive(s, opts.getColliders());
          // slower bots and a gentle sideways drift keep the pack from running in one file
          input.moveX = input.moveX * b.skill + b.wander * 0.15;
          input.moveY *= b.skill;
          b.pushIn -= dt;
          tryPush(b, player);
          bumping.apply(s, b.others, dt);
        }
        if (b.stunFor > 0) b.stunFor = Math.max(0, b.stunFor - dt);
        if (b.shotFor > 0 && (b.shotFor -= dt) <= 0) {
          b.shotFor = 0;
          b.ctl.respawn(opts.respawnPoint(b.ctl.state.checkpoint, b.slot, point));
        }
        b.ctl.step(input, 0, dt, t);
        b.remote.yaw = s.yaw;
        b.remote.anim = s.anim;
      }
    },
    shot(id, dir, kind) {
      const b = bots[id - BOT_ID_BASE];
      if (!b || b.ctl.state.finished || b.shotFor > 0 || b.stunFor > 0) return false;
      const g = GUNS[kind];
      b.ctl.applyImpulse([dir[0] * 5, 3, dir[1] * 5]);
      b.ctl.knockDown(g.stunMs);
      if (g.respawn) b.shotFor = g.stunMs / 1000;
      else b.stunFor = g.stunMs / 1000;
      return true;
    },
    grabbed(id, kind, dir, from) {
      const b = bots[id - BOT_ID_BASE];
      if (!b) return false;
      if (kind === 'push') {
        b.ctl.applyImpulse([dir[0] * PUSH_FEEL.speed, PUSH_FEEL.hop, dir[1] * PUSH_FEEL.speed]);
        b.ctl.knockDown(PUSH_FEEL.downMs); // down until you help them up, or 4 s
      } else if (kind === 'save') {
        point.pos[0] = from.pos[0] + dir[0] * 0.8;
        point.pos[1] = from.pos[1];
        point.pos[2] = from.pos[2] + dir[1] * 0.8;
        point.yaw = b.ctl.state.yaw;
        b.ctl.respawn(point);
      } else b.ctl.getUp();
      b.remote.anim = b.ctl.state.anim;
      return true;
    },
    finishPlayer() {
      if (!playerPlace) playerPlace = ++placed;
      return playerPlace;
    },
    placeOf(player) {
      if (playerPlace) return playerPlace;
      const mine = progress(player);
      let place = 1;
      for (const b of bots) if (progress(b.ctl.state) > mine) place++;
      return place;
    },
    onPush(fn) {
      pushFns.push(fn);
    },
    onFinish(fn) {
      finishFns.push(fn);
    },
    controller(id) {
      return bots[id - BOT_ID_BASE]?.ctl;
    },
  };
}
