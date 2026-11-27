import { describe, expect, it } from 'bun:test';
import { SIM_HZ } from '@wobble/shared/constants';
import { DEFAULT_COURSE_ID } from '@wobble/shared/course/recipes/index';
import { assembleCourse, getObstacleKind, resolveBuiltin } from '@wobble/shared';
import type { Collider, CourseDef, CourseRecipe, Pose } from '@wobble/shared/types';
import { createPlayerController } from '../player/index.ts';
import { createAutopilot } from './autopilot.ts';
import { createBestTimes, createRaceClock } from './clock.ts';
import { createFlow, transition, type FlowState } from './state.ts';

describe('game flow', () => {
  it('runs title -> loading -> countdown -> race -> finished -> title', () => {
    const flow = createFlow();
    const seen: string[] = [];
    flow.onChange((n) => seen.push(n.phase));
    for (const type of ['playSolo', 'loaded', 'go', 'finish', 'leave'] as const)
      expect(flow.dispatch({ type })).toBe(true);
    expect(seen).toEqual(['loading', 'countdown', 'race', 'finished', 'title']);
  });

  it('pauses only during countdown or race, and GO waits while paused', () => {
    const s = (phase: FlowState['phase'], paused = false): FlowState => ({ phase, paused });
    expect(transition(s('title'), { type: 'pause' })).toBeNull();
    expect(transition(s('race'), { type: 'pause' })).toEqual(s('race', true));
    expect(transition(s('countdown', true), { type: 'go' })).toBeNull();
    expect(transition(s('race', true), { type: 'resume' })).toEqual(s('race'));
  });

  it('restart goes back to the countdown from race or finished, and ignores stray events', () => {
    expect(transition({ phase: 'finished', paused: false }, { type: 'restart' })?.phase).toBe('countdown');
    expect(transition({ phase: 'race', paused: true }, { type: 'restart' })).toEqual({
      phase: 'countdown',
      paused: false,
    });
    expect(transition({ phase: 'title', paused: false }, { type: 'finish' })).toBeNull();
    expect(transition({ phase: 'title', paused: false }, { type: 'restart' })).toBeNull();
  });
});

describe('race clock and best times', () => {
  it('counts 3-2-1 then GO, and freezes at finish', () => {
    const clock = createRaceClock(3);
    expect(clock.countdown).toBe(3);
    let went = 0;
    for (let i = 0; i < 3 * SIM_HZ; i++) if (clock.advance(1 / SIM_HZ).wentGo) went++;
    expect(went).toBe(1);
    expect(clock.started).toBe(true);
    for (let i = 0; i < 90; i++) clock.advance(1 / SIM_HZ);
    expect(clock.finish()).toBe(1500);
    clock.advance(1);
    expect(clock.finishMs).toBe(1500);
    clock.reset();
    expect(clock.t).toBe(-3);
  });

  it('keeps the best time per course and survives blocked storage', () => {
    const data = new Map<string, string>();
    const store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
    const best = createBestTimes(store);
    expect(best.submit('c', 60000)).toBe(true);
    expect(best.submit('c', 65000)).toBe(false);
    expect(best.submit('c', 59000)).toBe(true);
    expect(createBestTimes(store).get('c')).toBe(59000);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const b2 = createBestTimes(broken);
    expect(b2.submit('c', 1)).toBe(true);
    expect(b2.get('c')).toBe(1);
  });
});

/** Colliders for a course, posed each step (the course runtime does this in the game). */
function courseColliders(course: CourseDef) {
  const list: { c: Collider; e: CourseDef['entities'][number]; i: number; out: Pose[] }[] = [];
  const colliders: Collider[] = [];
  for (const e of course.entities) {
    const kind = getObstacleKind(e.kind)!;
    const parts = kind.parts(e);
    const out: Pose[] = parts.map(() => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
    kind.pose(e, 0, out);
    parts.forEach((part, i) => {
      if (!part.collide) return;
      const c: Collider = {
        entityId: e.id,
        part,
        pose: { pos: [...out[i].pos], quat: [...out[i].quat] },
        prevPose: { pos: [...out[i].pos], quat: [...out[i].quat] },
      };
      list.push({ c, e, i, out });
      colliders.push(c);
    });
  }
  const step = (t: number) => {
    for (const { c, e, i, out } of list) {
      c.prevPose.pos.splice(0, 3, ...c.pose.pos);
      c.prevPose.quat.splice(0, 4, ...c.pose.quat);
      getObstacleKind(e.kind)!.pose(e, t, out);
      c.pose.pos.splice(0, 3, ...out[i].pos);
      c.pose.quat.splice(0, 4, ...out[i].quat);
    }
  };
  return { colliders, step };
}

describe('smoke: autopilot on the default course', () => {
  function run(untilFinished: boolean) {
    const course = assembleCourse(resolveBuiltin(DEFAULT_COURSE_ID)!.data as CourseRecipe);
    const { colliders, step } = courseColliders(course);
    const at = (g: { pos: number[] }) => ({
      pos: [g.pos[0], g.pos[1] + 0.05, g.pos[2]] as [number, number, number],
      yaw: 0,
    });
    const player = createPlayerController({ getColliders: () => colliders, course, spawn: at(course.spawn) });
    let falls = 0;
    player.on('fell', () => {
      falls++;
      const cp = player.state.checkpoint;
      player.respawn(at(cp >= 0 ? course.checkpoints[cp].respawn : course.spawn));
    });
    const pilot = createAutopilot(course);
    const dt = 1 / SIM_HZ;
    let t = 0;
    const done = () => (untilFinished ? player.state.finished : player.state.checkpoint >= 0);
    for (let i = 0; i < 240 * SIM_HZ && !done(); i++) {
      t += dt;
      step(t);
      player.step(pilot.drive(player.state, colliders), 0, dt, t);
    }
    return { player, t, falls };
  }

  it('reaches the first checkpoint of Gumdrop Gauntlet', () => {
    const { player, t } = run(false);
    expect(player.state.checkpoint).toBe(0);
    expect(t).toBeLessThan(60);
  });

  it('finishes the whole course in under two minutes of race time', () => {
    const { player, t, falls } = run(true);
    console.log(`autopilot finished in ${t.toFixed(1)} s with ${falls} falls`);
    expect(player.state.finished).toBe(true);
    expect(t).toBeLessThan(120);
  });
});
