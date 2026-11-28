import { describe, expect, it } from 'bun:test';
import { Anim, PLAYER, SIM_HZ } from '@wobble/shared/constants';
import { fixtureCourse, getObstacleKind } from '@wobble/shared';
import type { Collider, CourseDef, EntityDef, InputState, PartDef, Pose, Vec3 } from '@wobble/shared/types';
import { createScriptedCollider, setYawRoll, toLocal, type ScriptedCollider } from '../physics/index.ts';
import { createPlayerController, type PlayerController, type PlayerEventName } from './controller.ts';

const DT = 1 / SIM_HZ;
const NO_COURSE: Pick<CourseDef, 'checkpoints' | 'finish' | 'killY'> = {
  checkpoints: [],
  finish: { pos: [0, -1000, 0], yaw: 0, half: [1, 1, 1] },
  killY: -50,
};

const part = (over: Partial<PartDef> & Pick<PartDef, 'shape' | 'size'>): PartDef => ({
  surface: 'solid',
  slot: 'platformA',
  collide: true,
  visible: true,
  ...over,
});

/** Static box whose TOP surface is at y = top. */
function floor(id: number, center: Vec3, half: Vec3, over: Partial<PartDef> = {}): ScriptedCollider {
  return createScriptedCollider(id, part({ shape: 'box', size: half, ...over }), (_t, out) => {
    out.pos[0] = center[0];
    out.pos[1] = center[1];
    out.pos[2] = center[2];
  });
}

function input(over: Partial<InputState> = {}): InputState {
  return { moveX: 0, moveY: 0, jump: false, jumpPressed: false, dive: false, divePressed: false, ...over };
}

class Sim {
  t = 0;
  readonly player: PlayerController;
  readonly events: { name: PlayerEventName; t: number; e: unknown }[] = [];
  constructor(
    readonly colliders: ScriptedCollider[],
    spawn: Vec3,
    course = NO_COURSE,
  ) {
    this.player = createPlayerController({ getColliders: () => colliders, course, spawn: { pos: spawn, yaw: 0 } });
    for (const name of ['jump', 'land', 'dive', 'bounce', 'hit', 'fell', 'checkpoint', 'finish'] as const) {
      this.player.on(name, (e) => this.events.push({ name, t: this.t, e: { ...e } }));
    }
  }
  step(i: InputState = input(), n = 1, each?: () => void) {
    for (let k = 0; k < n; k++) {
      this.t += DT;
      for (const c of this.colliders) c.update(this.t);
      // *Pressed only on the first step of a call
      this.player.step(k === 0 ? i : { ...i, jumpPressed: false, divePressed: false }, 0, DT, this.t);
      each?.();
    }
  }
  get s() {
    return this.player.state;
  }
  has(name: PlayerEventName) {
    return this.events.some((e) => e.name === name);
  }
}

const bigFloor = () => floor(1, [0, -0.5, 0], [200, 0.5, 200]);

describe('running and jumping', () => {
  it('settles on the ground and idles', () => {
    const sim = new Sim([bigFloor()], [0, 0.5, 0]);
    sim.step(input(), 30);
    expect(sim.s.grounded).toBe(true);
    expect(sim.s.pos[1]).toBeCloseTo(0, 1);
    expect(sim.s.anim).toBe(Anim.IDLE);
  });

  it('reaches the documented jump apex (~1.74 m, within 5%)', () => {
    const sim = new Sim([bigFloor()], [0, 0, 0]);
    sim.step(input(), 10);
    const ground = sim.s.pos[1];
    let apex = ground;
    sim.step(input({ jump: true, jumpPressed: true }), 60, () => (apex = Math.max(apex, sim.s.pos[1])));
    const expected = PLAYER.jumpVelocity ** 2 / (2 * -PLAYER.gravity);
    expect(apex - ground).toBeGreaterThan(expected * 0.95);
    expect(apex - ground).toBeLessThan(expected * 1.05);
    expect(expected).toBeCloseTo(1.74, 1);
  });

  /** Run forward to top speed, jump, and measure ground-to-ground distance. */
  function jumpDistance(diveAtApex: boolean) {
    const sim = new Sim([bigFloor()], [0, 0, 100]);
    sim.step(input({ moveY: 1 }), 60);
    const z0 = sim.s.pos[2];
    sim.step(input({ moveY: 1, jump: true, jumpPressed: true }));
    let dived = false;
    for (let i = 0; i < 240 && !(sim.s.grounded && i > 2); i++) {
      const dive = diveAtApex && !dived && sim.s.vel[1] <= 0;
      if (dive) dived = true;
      sim.step(input({ moveY: 1, jump: true, dive, divePressed: dive }));
    }
    return { distance: z0 - sim.s.pos[2], sim };
  }

  it('flat jump at full speed covers ~5.4 m (within 5%)', () => {
    const { distance } = jumpDistance(false);
    const expected = PLAYER.runSpeed * ((2 * PLAYER.jumpVelocity) / -PLAYER.gravity);
    expect(expected).toBeCloseTo(5.48, 1);
    expect(distance).toBeGreaterThan(expected * 0.95);
    expect(distance).toBeLessThan(expected * 1.05);
  });

  it('a dive at the apex extends the jump', () => {
    const plain = jumpDistance(false).distance;
    const { distance, sim } = jumpDistance(true);
    expect(sim.has('dive')).toBe(true);
    expect(distance).toBeGreaterThan(plain + 1);
  });

  it('a dive that lands mid-burst becomes a belly slide (prone), then recovers', () => {
    const sim = new Sim([bigFloor()], [0, 0, 0]);
    sim.step(input({ moveY: 1 }), 30);
    let sawProne = false;
    sim.step(input({ moveY: 1, dive: true, divePressed: true }), 30, () => (sawProne ||= sim.s.anim === Anim.PRONE));
    expect(sawProne).toBe(true);
    sim.step(input({ moveY: 1 }), 60);
    expect(sim.s.anim).toBe(Anim.RUN);
  });

  it('cuts the jump short when the button is released early', () => {
    const sim = new Sim([bigFloor()], [0, 0, 0]);
    sim.step(input(), 10);
    let apex = 0;
    sim.step(input({ jump: true, jumpPressed: true }), 4);
    sim.step(input(), 60, () => (apex = Math.max(apex, sim.s.pos[1])));
    expect(apex).toBeLessThan(1.2);
  });

  it('buffers a jump pressed just before landing', () => {
    const sim = new Sim([bigFloor()], [0, 1.5, 0]);
    // falling: press jump ~80 ms before touching down
    while (sim.s.pos[1] > 0.45) sim.step(input());
    sim.step(input({ jump: true, jumpPressed: true }));
    sim.step(input({ jump: true }), 20);
    expect(sim.events.filter((e) => e.name === 'jump').length).toBe(1);
  });

  it('allows a coyote-time jump just after running off a ledge, but not later', () => {
    const run = (lateSteps: number) => {
      const sim = new Sim([floor(1, [0, -0.5, 0], [5, 0.5, 5])], [0, 0, 0]);
      sim.step(input(), 10);
      while (sim.s.grounded) sim.step(input({ moveY: 1 }));
      sim.step(input({ moveY: 1 }), lateSteps);
      sim.step(input({ moveY: 1, jump: true, jumpPressed: true }));
      return sim.has('jump');
    };
    expect(run(2)).toBe(true); // ~50 ms after leaving the edge
    expect(run(9)).toBe(false); // ~170 ms: too late
  });

  it('turns to face the movement direction', () => {
    const sim = new Sim([bigFloor()], [0, 0, 0]);
    sim.step(input({ moveX: 1 }), 30); // camera yaw 0: right is +X
    expect(sim.s.vel[0]).toBeCloseTo(PLAYER.runSpeed, 1);
    expect(sim.s.yaw).toBeCloseTo(-Math.PI / 2, 2);
    expect(sim.s.anim).toBe(Anim.RUN);
  });

  it('slides much further on slippery ground', () => {
    const slide = (surface: PartDef['surface']) => {
      const sim = new Sim([floor(1, [0, -0.5, 0], [200, 0.5, 200], { surface })], [0, 0, 0]);
      sim.step(input({ moveY: 1 }), 60);
      const z = sim.s.pos[2];
      sim.step(input(), 120);
      return z - sim.s.pos[2];
    };
    expect(slide('slippery')).toBeGreaterThan(slide('solid') * 4);
  });

  it('is deterministic', () => {
    const run = () => {
      const sim = new Sim([bigFloor()], [0, 0, 0]);
      sim.step(input({ moveY: 1, moveX: 0.3 }), 40);
      sim.step(input({ moveY: 1, jump: true, jumpPressed: true }), 20);
      sim.step(input({ dive: true, divePressed: true }), 50);
      return JSON.stringify(sim.s);
    };
    expect(run()).toBe(run());
  });
});

describe('moving surfaces', () => {
  it('is carried by a moving platform with < 5 cm drift over 30 s', () => {
    const half: Vec3 = [2, 0.25, 2];
    const plat = createScriptedCollider(1, part({ shape: 'box', size: half }), (t, out) => {
      const k = Math.sin((t / 4) * Math.PI * 2);
      out.pos[0] = k * 3;
      out.pos[1] = 2 + k;
      out.pos[2] = 0;
    });
    const sim = new Sim([plat], [0, 2.3, 0]);
    sim.step(input(), 30);
    const start = toLocal(plat.pose, sim.s.pos[0], sim.s.pos[1], sim.s.pos[2], [0, 0, 0]);
    sim.step(input(), 30 * SIM_HZ);
    const end = toLocal(plat.pose, sim.s.pos[0], sim.s.pos[1], sim.s.pos[2], [0, 0, 0]);
    expect(Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2])).toBeLessThan(0.05);
    expect(sim.s.grounded).toBe(true);
  });

  it('rides a spinner disc: position and facing rotate with it', () => {
    const rpm = 8;
    const disc = createScriptedCollider(1, part({ shape: 'cylinder', size: [4, 0.25, 0] }), (t, out) => {
      out.pos[0] = 0;
      out.pos[1] = -0.25;
      out.pos[2] = 0;
      setYawRoll(t * ((rpm * Math.PI * 2) / 60), 0, out.quat);
    });
    const sim = new Sim([disc], [2, 0.2, 0]);
    sim.step(input(), 20);
    const yaw0 = sim.s.yaw;
    const angle0 = Math.atan2(sim.s.pos[2], sim.s.pos[0]);
    const local0 = toLocal(disc.pose, sim.s.pos[0], sim.s.pos[1], sim.s.pos[2], [0, 0, 0]);
    sim.step(input(), Math.round(SIM_HZ * (60 / rpm / 4))); // a quarter turn
    const local1 = toLocal(disc.pose, sim.s.pos[0], sim.s.pos[1], sim.s.pos[2], [0, 0, 0]);
    expect(Math.hypot(local1[0] - local0[0], local1[2] - local0[2])).toBeLessThan(0.05);
    // +yaw is counter-clockwise from above, which decreases atan2(z, x) by 90 degrees
    expect(Math.atan2(sim.s.pos[2], sim.s.pos[0]) - angle0).toBeCloseTo(-Math.PI / 2, 1);
    expect(Math.abs(sim.s.yaw - yaw0 - Math.PI / 2)).toBeLessThan(0.05);
  });

  it('a bumper launches the player at its bounce speed and makes them stumble', () => {
    const bumper = createScriptedCollider(
      7,
      part({ shape: 'cylinder', size: [0.9, 0.6, 0], surface: 'bouncy', bounce: 14, slot: 'bouncy' }),
      (_t, out) => {
        out.pos[0] = 0;
        out.pos[1] = 0.6;
        out.pos[2] = -6;
      },
    );
    const sim = new Sim([bigFloor(), bumper], [0, 0, 0]);
    let speedAfter = 0;
    sim.player.on('bounce', () => (speedAfter = Math.hypot(...sim.s.vel)));
    sim.step(input({ moveY: 1 }), 90);
    expect(sim.has('bounce')).toBe(true);
    expect(speedAfter).toBeCloseTo(14, 0);
    expect(sim.events.find((e) => e.name === 'bounce')?.e).toEqual({ entityId: 7, speed: 14 });
  });

  it('a sweeper bar at 20 rpm knocks a standing player off their feet', () => {
    const rpm = 20;
    const sweeper = createScriptedCollider(
      3,
      part({ shape: 'cylinder', size: [0.35, 6, 0], slot: 'hazard' }),
      (t, out) => {
        out.pos[0] = 0;
        out.pos[1] = 0.6;
        out.pos[2] = 0;
        // Bar lies horizontally (roll 90 degrees) and spins about the vertical axis.
        setYawRoll(-Math.PI / 4 + t * ((rpm * Math.PI * 2) / 60), Math.PI / 2, out.quat);
      },
    );
    const sim = new Sim([bigFloor(), sweeper], [3, 0, 0]);
    let stumbled = false;
    sim.step(input(), 90, () => (stumbled ||= sim.s.anim === Anim.STUMBLE));
    expect(sim.has('hit')).toBe(true);
    expect(stumbled).toBe(true);
    const hit = sim.events.find((e) => e.name === 'hit')!.e as { speed: number };
    expect(hit.speed).toBeGreaterThan(4);
  });
});

describe('collision robustness', () => {
  it('never tunnels through a 0.5 m platform at max fall speed', () => {
    const sim = new Sim([floor(1, [0, -0.25, 0], [3, 0.25, 3])], [0, 20, 0]);
    sim.player.applyImpulse([0, PLAYER.maxFallSpeed, 0]);
    let lowest = Infinity;
    sim.step(input(), 120, () => (lowest = Math.min(lowest, sim.s.pos[1])));
    expect(sim.s.grounded).toBe(true);
    expect(lowest).toBeGreaterThan(-0.02); // residual penetration <= 2 cm
    expect(sim.has('land')).toBe(true);
  });

  it('stops at walls and slides along them', () => {
    const wall = floor(2, [0, 1, -3], [50, 1, 0.25]);
    const sim = new Sim([bigFloor(), wall], [0, 0, 0]);
    sim.step(input({ moveY: 1, moveX: 0.5 }), 90);
    expect(sim.s.pos[2]).toBeGreaterThan(-3 + 0.25 + PLAYER.radius - 0.03);
    expect(sim.s.pos[0]).toBeGreaterThan(2); // slid sideways
  });

  it('steps 400 colliders in < 0.15 ms per step', () => {
    const cols: ScriptedCollider[] = [];
    for (let i = 0; i < 400; i++)
      cols.push(floor(i, [(i % 20) * 6 - 60, -0.5, Math.floor(i / 20) * -6], [2.5, 0.5, 2.5]));
    const sim = new Sim(cols, [0, 0, 0]);
    sim.step(input({ moveY: 1 }), 60); // warm up
    const steps = 1200;
    const t0 = performance.now();
    for (let i = 0; i < steps; i++) sim.player.step(input({ moveY: 1, moveX: 0.2 }), 0, DT, i * DT);
    const per = (performance.now() - t0) / steps;
    expect(per).toBeLessThan(0.15);
  });
});

describe('course triggers', () => {
  function courseColliders(course: CourseDef): Collider[] {
    const out: Collider[] = [];
    for (const e of course.entities) {
      const kind = getObstacleKind(e.kind)!;
      const parts = kind.parts(e);
      const poses: Pose[] = parts.map(() => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
      kind.pose(e, 0, poses);
      parts.forEach((p, i) => out.push({ entityId: e.id, part: p, pose: poses[i], prevPose: poses[i] }));
    }
    return out;
  }

  it('fires checkpoint, finish and fell on the fixture course', () => {
    const cols = courseColliders(fixtureCourse);
    const player = createPlayerController({
      getColliders: () => cols,
      course: fixtureCourse,
      spawn: { pos: [0, 0, -8], yaw: 0 },
    });
    const seen: string[] = [];
    for (const name of ['checkpoint', 'finish', 'fell'] as const) player.on(name, () => seen.push(name));

    let t = 0;
    const run = (i: InputState, n: number) => {
      for (let k = 0; k < n; k++) player.step(k === 0 ? i : { ...i, jumpPressed: false }, 0, DT, (t += DT));
    };
    // Run and hop the 2 m gaps all the way to the finish pad.
    for (let k = 0; k < 40 && !player.state.finished; k++) {
      run(input({ moveY: 1, jump: true, jumpPressed: true }), 45);
    }
    expect(player.state.checkpoint).toBe(0);
    expect(player.state.finished).toBe(true);
    expect(seen).toEqual(['checkpoint', 'finish']);

    // A finished player celebrates in place: input no longer moves them.
    const x = player.state.pos[0];
    run(input({ moveX: 1 }), 30);
    expect(player.state.pos[0]).toBeCloseTo(x, 1);
    expect(player.state.anim).toBe(Anim.CELEBRATE);
  });

  it('reports a fall below killY once, and respawn keeps checkpoint progress', () => {
    const cols = courseColliders(fixtureCourse);
    const player = createPlayerController({
      getColliders: () => cols,
      course: fixtureCourse,
      spawn: { pos: [0, 0, -36], yaw: 0 }, // on the checkpoint pad
    });
    let fell = 0;
    player.on('fell', () => fell++);
    let t = 0;
    const run = (i: InputState, n: number) => {
      for (let k = 0; k < n; k++) player.step(i, 0, DT, (t += DT));
    };
    run(input(), 5);
    expect(player.state.checkpoint).toBe(0);
    run(input({ moveX: 1 }), 300); // off the right edge and down
    expect(fell).toBe(1);
    player.respawn({ pos: [0, 0, -43], yaw: 0 });
    run(input(), 30);
    expect(player.state.grounded).toBe(true);
    expect(player.state.checkpoint).toBe(0);
    expect(fell).toBe(1);
  });
});

/** A real obstacle kind as a scripted collider (one part). */
function kindCollider(def: EntityDef, index = 0): ScriptedCollider {
  const kind = getObstacleKind(def.kind)!;
  const parts = kind.parts(def);
  const poses: Pose[] = parts.map(() => ({ pos: [0, 0, 0], quat: [0, 0, 0, 1] }));
  return createScriptedCollider(def.id, parts[index], (t, out) => {
    kind.pose(def, t, poses);
    out.pos[0] = poses[index].pos[0];
    out.pos[1] = poses[index].pos[1];
    out.pos[2] = poses[index].pos[2];
    for (let k = 0; k < 4; k++) out.quat[k] = poses[index].quat[k];
  });
}

describe('bounce pads (#110)', () => {
  const pad = (pos: Vec3, tilt: number): EntityDef => ({
    id: 9,
    kind: 'bouncePad',
    pos,
    yaw: 0,
    params: { size: [3.4, 0.4, 1.6], bounce: 14, tilt },
  });

  it('launch a running player up and forward over a 5 m gap, without a stumble', () => {
    // Island z 10..-6 with a pad at its front edge, a 5 m void, then an island z -11..-30.
    const near = floor(1, [0, -0.5, 2], [8, 0.5, 8]);
    const far = floor(2, [0, -0.5, -20.5], [8, 0.5, 9.5]);
    const sim = new Sim([near, far, kindCollider(pad([0, 0.05, -4.9], 0.12))], [0, 0, 0]);
    let launch: Vec3 = [0, 0, 0];
    sim.player.on('bounce', () => (launch = [...sim.s.vel]));
    let stumbled = false;
    sim.step(input({ moveY: 1 }), 150, () => (stumbled ||= sim.s.anim === Anim.STUMBLE));
    expect(sim.has('bounce')).toBe(true);
    expect(stumbled).toBe(false);
    expect(launch[1]).toBeGreaterThan(13);
    expect(-launch[2]).toBeGreaterThan(PLAYER.runSpeed); // kept the run, plus the tilt
    expect(sim.has('fell')).toBe(false);
    expect(sim.s.grounded).toBe(true);
    expect(sim.s.pos[2]).toBeLessThan(-11);
    expect(sim.s.pos[1]).toBeCloseTo(0, 1);
  });

  it('without the pad the same run falls into the gap', () => {
    const near = floor(1, [0, -0.5, 2], [8, 0.5, 8]);
    const far = floor(2, [0, -0.5, -20.5], [8, 0.5, 9.5]);
    const sim = new Sim([near, far], [0, 0, 0]);
    sim.step(input({ moveY: 1 }), 150);
    expect(sim.s.pos[1]).toBeLessThan(-5);
  });

  it('a flat pad sends a standing player straight up at its bounce speed', () => {
    const sim = new Sim([bigFloor(), kindCollider(pad([0, 0.05, 0], 0))], [0, 1, 0]);
    let launch: Vec3 = [0, 0, 0];
    sim.player.on('bounce', () => (launch = [...sim.s.vel]));
    sim.step(input(), 30);
    expect(launch[1]).toBeCloseTo(14, 1);
    expect(Math.hypot(launch[0], launch[2])).toBeLessThan(0.05);
    expect(sim.s.anim).not.toBe(Anim.STUMBLE);
  });
});

describe('snow blower wind (#110)', () => {
  // A fan at the left edge blowing +X over z -15..-5, on for 3 s and off for 2 s from t = 0.
  const fan: EntityDef = {
    id: 20,
    kind: 'snowBlower',
    pos: [-10, 0, -10],
    yaw: 0,
    params: { reach: 20, width: 10, windSpeed: 3, onSec: 3, offSec: 2, warnSec: 0.5 },
  };
  const course = { ...NO_COURSE, entities: [fan] };

  it('pushes an idle player sideways only while the fan is on', () => {
    const sim = new Sim([bigFloor()], [0, 0, -10], course);
    sim.step(input(), 30); // 0.5 s
    const x1 = sim.s.pos[0];
    sim.step(input(), 120); // to 2.5 s
    expect((sim.s.pos[0] - x1) / 2).toBeCloseTo(3, 1);
    expect(Math.abs(sim.s.pos[2] + 10)).toBeLessThan(1e-6);
    sim.step(input(), 42); // to 3.2 s: off, friction stops the drift
    const x2 = sim.s.pos[0];
    sim.step(input(), 72); // to 4.4 s, still off (warning from 4.5 s)
    expect(sim.s.pos[0]).toBeCloseTo(x2, 6);
  });

  it('a player walking straight ahead keeps full forward speed while drifting', () => {
    const sim = new Sim([bigFloor()], [0, 0, -4], course);
    sim.step(input({ moveY: 1 }), 30);
    expect(sim.s.pos[2]).toBeLessThan(-5); // inside the zone
    expect(-sim.s.vel[2]).toBeCloseTo(PLAYER.runSpeed, 1);
    expect(sim.s.vel[0]).toBeCloseTo(3, 1);
  });

  it('steering into the wind holds the line and still makes progress', () => {
    const sim = new Sim([bigFloor()], [0, 0, -5.5], course);
    const into = 3 / PLAYER.runSpeed;
    sim.step(input({ moveX: -into, moveY: Math.sqrt(1 - into * into) }), 50);
    expect(Math.abs(sim.s.vel[0])).toBeLessThan(0.05);
    expect(-sim.s.vel[2]).toBeGreaterThan(6.5);
  });

  it('has no wind when the course has no snow blowers', () => {
    const sim = new Sim([bigFloor()], [0, 0, -10]);
    sim.step(input(), 60);
    expect(sim.s.pos[0]).toBeCloseTo(0, 6);
  });
});
