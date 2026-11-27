// The game (#26): wires engine, input, controller, course, camera, Wobbler, theme and UI into
// solo practice on a built-in course, fully offline. Phone first: touch controls and a top-edge HUD.
//
// Fixed step:  clock -> course.stepColliders -> input.sample -> player.step
// Render:      course.update -> wobbler.setPose (interpolated) -> camera.update -> HUD
import { assembleCourse, fixtureSkin, fixtureTheme, resolveBuiltin } from '@wobble/shared';
import { DEFAULT_COURSE_ID } from '@wobble/shared/course/recipes/index';
import type { CourseRecipe, InputState, Vec3 } from '@wobble/shared/types';
import { createFollowCamera } from '../camera/index.ts';
import { createWobbler } from '../character/index.ts';
import { createCourseRuntime, type SpawnPoint } from '../course/index.ts';
import { createEngine } from '../engine/index.ts';
import { createInput } from '../input/index.ts';
import { createPlayerController } from '../player/index.ts';
import { applyTheme } from '../theme/index.ts';
import { createUI } from '../ui/index.ts';
import { createAutopilot } from './autopilot.ts';
import { COUNTDOWN_SEC, createBestTimes, createRaceClock } from './clock.ts';
import { createFlow } from './state.ts';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  touchRoot: HTMLElement;
  /** e.g. location.search: ?course=b:first-wobble&autopilot=1 */
  query?: string;
}

const IDLE: InputState = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, dive: false, divePressed: false };

export function startGame({ canvas, uiRoot, touchRoot, query = '' }: GameOptions) {
  const params = new URLSearchParams(query);
  const coursePack = resolveBuiltin(params.get('course') ?? '') ?? resolveBuiltin(DEFAULT_COURSE_ID)!;
  const skinPack = resolveBuiltin(params.get('skin') ?? '');
  const themePack = resolveBuiltin(params.get('theme') ?? '');
  const courseDef = assembleCourse(coursePack.data as CourseRecipe);

  const ui = createUI(uiRoot);
  const engine = createEngine({ canvas, quality: ui.settings.quality });
  const { scene } = engine;
  const theme = applyTheme(themePack?.kind === 'theme' ? themePack.data : fixtureTheme, {
    scene,
    renderer: engine.renderer,
  });
  const course = createCourseRuntime({ courseDef, theme, scene });
  const input = createInput({ target: window, touchRoot });
  const camera = createFollowCamera(engine.camera);
  const wobbler = createWobbler(skinPack?.kind === 'skin' ? skinPack.data : fixtureSkin);
  scene.add(wobbler.object3d);

  // Solo: a middle column of the front row (slot 0 is the far-left corner of the 20-wide grid).
  const slot = Math.floor((courseDef.spawn.cols - 1) / 2);
  const point: SpawnPoint = { pos: [0, 0, 0], yaw: 0 };
  const player = createPlayerController({
    getColliders: course.getColliders,
    course: courseDef,
    spawn: course.spawnPoint(slot, point),
  });
  const autopilot = params.get('autopilot') === '1' ? createAutopilot(courseDef) : null;
  const flow = createFlow();
  const clock = createRaceClock(COUNTDOWN_SEC);
  const best = createBestTimes(typeof localStorage === 'undefined' ? null : localStorage);
  const checkpoints = courseDef.checkpoints.length;

  /** Race time driving the obstacles; keeps running after the finish so the course stays alive. */
  let t = -COUNTDOWN_SEC;
  let shownCount = -1;
  const prev: Vec3 = [0, 0, 0];
  const curr: Vec3 = [0, 0, 0];
  const drawn: Vec3 = [0, 0, 0];
  const pose = { pos: drawn, yaw: 0, anim: player.state.anim, speed: 0 };
  const copy = (from: Readonly<Vec3>, to: Vec3) => {
    to[0] = from[0];
    to[1] = from[1];
    to[2] = from[2];
  };

  function place(p: SpawnPoint) {
    player.respawn(p);
    copy(player.state.pos, prev);
    copy(player.state.pos, curr);
    camera.snapTo(p.pos, p.yaw);
  }

  function resetRace() {
    clock.reset();
    t = -COUNTDOWN_SEC;
    shownCount = -1;
    player.state.checkpoint = -1;
    player.state.finished = false;
    course.stepColliders(t);
    course.stepColliders(t);
    place(course.spawnPoint(slot, point));
    ui.show('hud', { solo: true, checkpoints, device: input.activeDevice });
    ui.hud.setCheckpoint(0, checkpoints);
    ui.hud.setTime(0);
    const s = point.pos;
    void camera.playIntro(
      [
        [s[0] + 14, s[1] + 16, s[2] - 46],
        [s[0] - 8, s[1] + 9, s[2] - 16],
      ],
      (COUNTDOWN_SEC - 0.4) * 1000,
    );
  }

  // ---- flow -> screens
  flow.onChange((next, before, e) => {
    touchRoot.hidden = next.phase === 'title' || next.phase === 'loading';
    if (e.type === 'pause') ui.show('pause', { solo: true });
    else if (e.type === 'resume') ui.hide('pause');
    else if (next.phase === 'title') ui.show('title');
    else if (next.phase === 'loading') ui.show('loading', { label: coursePack.name });
    else if (next.phase === 'countdown' && before.phase !== 'countdown') resetRace();
    else if (e.type === 'restart') resetRace();
  });

  ui.on('play:solo', () => {
    if (flow.dispatch({ type: 'playSolo' })) flow.dispatch({ type: 'loaded' });
  });
  ui.on('pause', () => flow.dispatch({ type: 'pause' }));
  ui.on('resume', () => flow.dispatch({ type: 'resume' }));
  ui.on('restart', () => flow.dispatch({ type: 'restart' }));
  ui.on('leave', () => flow.dispatch({ type: 'leave' }));
  ui.on('settings:change', (s) => engine.setQuality(s.quality));
  input.onDeviceChange((d) => ui.hud.showHints(d));
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyR' && !e.repeat) flow.dispatch({ type: 'restart' });
  };
  window.addEventListener('keydown', onKey);
  const onHidden = () => {
    if (document.hidden) flow.dispatch({ type: 'pause' });
  };
  document.addEventListener('visibilitychange', onHidden);

  // ---- player events
  player.on('checkpoint', (e) => {
    ui.hud.setCheckpoint(e.index + 1, checkpoints);
    ui.hud.toast(`Checkpoint ${e.index + 1}/${checkpoints}!`);
  });
  player.on('fell', () => {
    place(course.respawnPoint(player.state.checkpoint, slot, point));
    ui.hud.flash();
  });
  player.on('dive', () => camera.kick('dive'));
  player.on('land', (e) => e.speed > 8 && camera.kick('land', 0.7));
  player.on('finish', () => {
    const timeMs = clock.finish();
    const bestBefore = best.get(courseDef.id);
    const newBest = best.submit(courseDef.id, timeMs);
    flow.dispatch({ type: 'finish' });
    ui.hud.setTime(timeMs);
    ui.show('finish', { kind: 'finished', timeMs, bestMs: newBest ? timeMs : bestBefore, newBest });
  });

  // ---- simulation
  engine.onFixedUpdate((dt) => {
    const { phase, paused } = flow.state;
    if (paused || phase === 'title' || phase === 'loading') {
      input.sample(); // drop presses made while not playing
      return;
    }
    t += dt;
    if (clock.advance(dt).wentGo) {
      flow.dispatch({ type: 'go' });
      ui.show('countdown', { value: 0 });
    } else if (!clock.started && clock.countdown !== shownCount) {
      shownCount = clock.countdown;
      ui.show('countdown', { value: shownCount });
    }
    course.stepColliders(t);
    const sample = input.sample();
    const control = phase !== 'race' ? IDLE : autopilot ? autopilot.drive(player.state, course.getColliders()) : sample;
    copy(curr, prev);
    player.step(control, autopilot ? 0 : camera.yaw, dt, t);
    copy(player.state.pos, curr);
  });

  // ---- render
  engine.onRender((alpha, frameDt) => {
    const { phase, paused } = flow.state;
    course.update(t);
    theme.tick(t);
    theme.setShadowFocus(drawn[0], drawn[1], drawn[2]);
    for (let k = 0; k < 3; k++) drawn[k] = prev[k] + (curr[k] - prev[k]) * alpha;
    const s = player.state;
    pose.yaw = s.yaw;
    pose.anim = s.anim;
    pose.speed = Math.hypot(s.vel[0], s.vel[2]);
    wobbler.setPose(pose, paused ? 0 : frameDt);
    camera.update(drawn, s.vel, frameDt);
    if (phase === 'race') ui.hud.setTime(Math.max(0, clock.t * 1000));
  });

  course.stepColliders(t);
  place(course.spawnPoint(slot, point));
  touchRoot.hidden = true;
  ui.show('title');
  engine.start();

  return {
    engine,
    flow,
    player,
    camera,
    ui,
    dispose() {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onHidden);
      camera.dispose();
      input.dispose();
      wobbler.dispose();
      course.dispose();
      theme.dispose();
      ui.dispose();
      engine.dispose();
    },
  };
}
