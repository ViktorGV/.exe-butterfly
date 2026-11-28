// The game (#26): wires engine, input, controller, course, camera, Wobbler, theme and UI into
// solo practice on a built-in course, fully offline. Phone first: touch controls and a top-edge HUD.
//
// Fixed step:  clock -> course.stepColliders -> input.sample -> player.step
// Render:      course.update -> wobbler.setPose (interpolated) -> camera.update -> HUD
import { assembleCourse, resolveBuiltin } from '@wobble/shared';
import { DEFAULT_SKIN_ID, DEFAULT_THEME_ID } from '@wobble/shared/assets/index';
import { DEFAULT_COURSE_ID } from '@wobble/shared/course/recipes/index';
import type { CourseRecipe, InputState, Pack, SkinDef, ThemeDef, Vec3 } from '@wobble/shared/types';
import type { MatchConfig, RemoteState, RoomState } from '@wobble/shared/types';
import { applyThemeV2, courseForTheme } from '../theme/v2/index.ts';
import { createFollowCamera } from '../camera/index.ts';
import { createCrowd, type Crowd } from '../crowd/index.ts';
import { createVillainView } from '../villain/index.ts';
import { summarize } from '../butterfly/summary.ts';
import { newClientId } from '../net/clientId.ts';
import { createNetClient, getServerUrl, type NetSession } from '../net/index.ts';
import { createWobbler } from '../character/index.ts';
import { createCourseRuntime, type SpawnPoint } from '../course/index.ts';
import { createEngine } from '../engine/index.ts';
import { createInput } from '../input/index.ts';
import { createPlayerController } from '../player/index.ts';
import { createCrowdCollision } from '../player/crowdCollision.ts';
import { createGrabTargeting } from '../butterfly/targeting.ts';
import { BUTTERFLY } from '@wobble/shared/constants';
import { applyTheme } from '../theme/index.ts';
import { createUI, type ResultRow } from '../ui/index.ts';
import { button, h } from '../ui/dom.ts';
import { isValidRoomCode, loadName, sanitizeRoomCode } from '../ui/settings.ts';
import { createAutopilot } from './autopilot.ts';
import { COUNTDOWN_SEC, createBestTimes, createRaceClock } from './clock.ts';
import { createFlow } from './state.ts';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  uiRoot: HTMLElement;
  touchRoot: HTMLElement;
  /** e.g. location.search: ?course=b:first-wobble&autopilot=1 */
  query?: string;
  /** Event packs fetched by main.ts (dev preview of generated themes and skins). */
  extraPacks?: Pack[];
}

const IDLE: InputState = { moveX: 0, moveY: 0, jump: false, jumpPressed: false, dive: false, divePressed: false };

export function startGame({ canvas, uiRoot, touchRoot, query = '', extraPacks = [] }: GameOptions) {
  const params = new URLSearchParams(query);
  const coursePack = resolveBuiltin(params.get('course') ?? '') ?? resolveBuiltin(DEFAULT_COURSE_ID)!;
  const pick = (id: string | null, kind: 'skin' | 'theme', fallback: string) => {
    const pack = extraPacks.find((p) => p.id === id) ?? resolveBuiltin(id ?? '');
    return pack?.kind === kind ? pack : resolveBuiltin(fallback)!;
  };
  const skinPack = pick(params.get('skin'), 'skin', DEFAULT_SKIN_ID);
  const themePack = pick(params.get('theme'), 'theme', DEFAULT_THEME_ID);
  const courseDef = assembleCourse(coursePack.data as CourseRecipe);

  const ui = createUI(uiRoot);
  const engine = createEngine({ canvas });
  const { scene } = engine;
  // Event themes (v2, #64) bring their own sky, ground, textures and obstacle dressing; images live in
  // /event/themes/<slug>/. Built-in v1 themes keep the original renderer.
  const themeDef = themePack.data as ThemeDef;
  const themeV2 =
    themeDef.version === 2
      ? applyThemeV2(themeDef, {
          scene,
          renderer: engine.renderer,
          course: courseForTheme(courseDef),
          baseUrl: `/event/themes/${themePack.id.replace(/^e:theme-/, '')}/`,
        })
      : null;
  const theme = themeV2 ? null : applyTheme(themeDef, { scene, renderer: engine.renderer });
  const course = createCourseRuntime({
    courseDef,
    theme: themeV2 ?? theme!,
    getDressing: themeV2?.getDressing,
    scene,
  });
  const input = createInput({ target: window, touchRoot });
  const camera = createFollowCamera(engine.camera);
  const villain = createVillainView({ scene });
  // The boss stands on the finish pad, facing the course.
  const bossFeet: [number, number, number] = [
    courseDef.finish.pos[0],
    courseDef.finish.pos[1] - courseDef.finish.half[1],
    courseDef.finish.pos[2] - courseDef.finish.half[2],
  ];
  const wobbler = createWobbler(skinPack.data as SkinDef);
  scene.add(wobbler.object3d);

  // Solo: a middle column of the front row (slot 0 is the far-left corner of the 20-wide grid).
  let slot = Math.floor((courseDef.spawn.cols - 1) / 2);
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

  // ---- online state (null while playing solo)
  let net: NetSession | null = null;
  let crowd: Crowd | null = null;
  let offNet: (() => void)[] = [];
  const bumping = createCrowdCollision();
  let remote: ReadonlyMap<number, RemoteState> | null = null;
  const targeting = createGrabTargeting();
  let lastGrabAt = -Infinity;
  const PUSH_SPEED = 7;
  const names = new Map<number, string>();
  let finishedCount = 0;
  // Butterfly effect counters for the results screen (#84).
  let stormLevel = 0;
  let throwsAtMe = 0;
  let hitsOnMe = 0;
  let qualifyCount = 0;
  let matchSize = 0;

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
    t = net ? net.raceTimeSec() : -COUNTDOWN_SEC;
    shownCount = -1;
    player.state.checkpoint = -1;
    player.state.finished = false;
    course.stepColliders(t);
    course.stepColliders(t);
    place(course.spawnPoint(slot, point));
    ui.show('hud', {
      solo: !net,
      checkpoints,
      totalPlayers: matchSize || undefined,
      qualifyMax: qualifyCount || undefined,
      device: input.activeDevice,
    });
    if (net) ui.hud.setPlace(0, matchSize);
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
    touchRoot.hidden = next.phase === 'title' || next.phase === 'loading' || next.phase === 'lobby';
    if (e.type === 'pause') ui.show('pause', { solo: !net });
    else if (e.type === 'resume') ui.hide('pause');
    else if (next.phase === 'title') {
      stopOnline();
      ui.show('title');
    } else if (next.phase === 'lobby') ui.show('lobby');
    else if (next.phase === 'loading')
      ui.show('loading', { label: net ? 'Waiting for the race to start…' : coursePack.name });
    else if (next.phase === 'countdown' && before.phase !== 'countdown') resetRace();
    else if (e.type === 'restart') resetRace();
  });

  ui.on('play:solo', () => {
    if (flow.dispatch({ type: 'playSolo' })) flow.dispatch({ type: 'loaded' });
  });
  ui.on('play:quick', ({ name }) => startOnline(name, 'quick'));
  ui.on('play:create', ({ name }) => startOnline(name, 'new'));
  ui.on('play:join', ({ name, code }) => startOnline(name, code));
  // online the race goes on while the pause panel is open, so pause is only an overlay there
  ui.on('pause', () => (net ? ui.show('pause', { solo: false }) : flow.dispatch({ type: 'pause' })));
  ui.on('resume', () => (net ? ui.hide('pause') : flow.dispatch({ type: 'resume' })));
  ui.on('restart', () => !net && flow.dispatch({ type: 'restart' }));
  ui.on('leave', () => flow.dispatch({ type: 'leave' }));
  input.onDeviceChange((d) => ui.hud.showHints(d));
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'KeyR' && !e.repeat && !net) flow.dispatch({ type: 'restart' });
  };
  window.addEventListener('keydown', onKey);
  const onHidden = () => {
    if (document.hidden && !net) flow.dispatch({ type: 'pause' });
  };
  document.addEventListener('visibilitychange', onHidden);

  // ---- player events
  player.on('checkpoint', (e) => {
    if (net) return; // the server confirms checkpoints online
    ui.hud.setCheckpoint(e.index + 1, checkpoints);
    ui.hud.toast(`Checkpoint ${e.index + 1}/${checkpoints}`, true);
  });
  player.on('fell', () => {
    place(course.respawnPoint(player.state.checkpoint, slot, point));
    ui.hud.flash();
  });
  player.on('dive', () => camera.kick('dive'));
  player.on('land', (e) => e.speed > 8 && camera.kick('land', 0.7));
  player.on('finish', () => {
    if (net) {
      const timeMs = Math.max(0, net.raceTimeSec() * 1000);
      flow.dispatch({ type: 'finish' });
      ui.hud.setTime(timeMs);
      ui.show('finish', { kind: 'finished', timeMs });
      return;
    }
    const timeMs = clock.finish();
    const bestBefore = best.get(courseDef.id);
    const newBest = best.submit(courseDef.id, timeMs);
    flow.dispatch({ type: 'finish' });
    ui.hud.setTime(timeMs);
    ui.show('finish', { kind: 'finished', timeMs, bestMs: newBest ? timeMs : bestBefore, newBest });
  });

  // ---- online play (#27): quick play, join with a code, create a room
  const doc = uiRoot.ownerDocument;
  const clientId = (() => {
    try {
      const k = 'wr.clientId';
      const v = localStorage.getItem(k) ?? newClientId();
      localStorage.setItem(k, v);
      return v;
    } catch {
      return newClientId();
    }
  })();

  function renderLobby(room: RoomState) {
    const me = net?.playerId ?? -1;
    const host = room.hostId === me;
    const count = room.players.filter((p) => p.connected).length;
    const hint = host
      ? 'Press Start when everyone is in.'
      : room.code && !host
        ? 'Waiting for the host to start the race.'
        : '';
    const invite: HTMLButtonElement = button(doc, 'Copy invite link', '', () => copyInvite(room.code, invite));
    ui.getSlot('lobby').replaceChildren(
      h(
        doc,
        'div',
        { class: 'wr-card wr-panel' },
        h(doc, 'h2', { class: 'wr-panel-title' }, `Room ${room.code}`),
        h(doc, 'p', null, `${count} player${count === 1 ? '' : 's'} here. Share the code to invite friends.`),
        h(doc, 'ul', { class: 'wr-help-list' }, ...room.players.map((p) => h(doc, 'li', null, p.name))),
        h(doc, 'p', null, hint),
        h(
          doc,
          'div',
          { class: 'wr-actions' },
          host ? button(doc, 'Start race', 'wr-btn-primary', () => net?.start()) : null,
          invite,
          button(doc, 'Leave', 'wr-btn-danger', () => flow.dispatch({ type: 'leave' })),
        ),
      ),
    );
  }

  /** `?room=CODE` on this page: opening the link joins that room. */
  function inviteLink(code: string): string {
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('room', code);
    return u.toString();
  }

  function copyInvite(code: string, btn: HTMLButtonElement) {
    const link = inviteLink(code);
    const done = () => {
      btn.textContent = 'Link copied!';
      setTimeout(() => (btn.textContent = 'Copy invite link'), 2000);
    };
    if (!navigator.clipboard) return void window.prompt('Copy this invite link', link);
    navigator.clipboard.writeText(link).then(done, () => window.prompt('Copy this invite link', link));
  }

  function startOnline(name: string, room: string) {
    if (net || !flow.dispatch({ type: 'playOnline' })) return;
    const session = createNetClient({ url: getServerUrl() });
    net = session;
    crowd = createCrowd({ scene });
    finishedCount = 0;
    stormLevel = 0;
    throwsAtMe = 0;
    hitsOnMe = 0;
    let everJoined = false;
    offNet = [
      session.on('welcome', ({ room: r }) => {
        everJoined = true;
        ui.hide('error');
        renderLobby(r);
      }),
      session.on('room', (r) => {
        if (flow.state.phase === 'lobby') renderLobby(r);
      }),
      session.on('matchConfig', (cfg: MatchConfig) => {
        matchSize = cfg.players.length;
        qualifyCount = cfg.qualifyCount;
        names.clear();
        for (const p of cfg.players) names.set(p.id, p.name);
        const me = cfg.players.find((p) => p.id === session.playerId);
        if (me) slot = me.slot;
        if (cfg.courseId !== coursePack.id) console.warn(`room course ${cfg.courseId} differs from ${coursePack.id}`);
        crowd?.setPlayers(
          cfg.players
            .filter((p) => p.id !== session.playerId)
            .map((p) => ({ id: p.id, name: p.name, skin: resolveBuiltin(p.skinId)?.data })),
        );
        finishedCount = 0;
        if (flow.dispatch({ type: 'matchStart' })) session.sendLoaded();
      }),
      session.on('countdown', () => {
        flow.dispatch({ type: 'loaded' });
      }),
      session.on('checkpoint', (m) => {
        ui.hud.setCheckpoint(m.index + 1, checkpoints);
        ui.hud.toast(`Checkpoint ${m.index + 1}/${checkpoints}`, true);
      }),
      session.on('correct', (m) => {
        player.respawn({ pos: m.pos, yaw: player.state.yaw });
        copy(player.state.pos, prev);
        copy(player.state.pos, curr);
        ui.hud.flash();
      }),
      session.on('finished', (m) => {
        finishedCount++;
        ui.hud.setQualified(finishedCount, qualifyCount);
        if (m.id === session.playerId) {
          ui.hud.setPlace(m.place, matchSize);
          ui.show('finish', { kind: m.place <= qualifyCount ? 'qualified' : 'finished', timeMs: m.timeMs });
        } else ui.hud.toast(`${names.get(m.id) ?? 'Someone'} finished ${m.place}.`);
      }),
      session.on('raceEnd', ({ results }) => {
        flow.dispatch({ type: 'finish' });
        villain.reset();
        ui.hide('finish');
        const rows: ResultRow[] = results
          .map((r) => ({
            id: r.id,
            name: names.get(r.id) ?? `Player ${r.id}`,
            place: r.place,
            timeMs: r.timeMs,
            qualified: r.place <= qualifyCount,
          }))
          .sort((a, b) => a.place - b.place);
        // Butterfly effect (#84): the server's per-player numbers become your line, the lobby line and titles.
        const stats = new Map(results.map((r) => [r.id, r]));
        const butterfly = summarize(
          rows.map((r) => ({ ...stats.get(r.id), id: r.id, name: r.name, timeMs: r.timeMs })),
          session.playerId ?? undefined,
          { storm: stormLevel, stormMax: BUTTERFLY.STORM_MAX, throwsAtMe, hitsOnMe },
        );
        ui.show('results', { rows, localId: session.playerId ?? undefined, butterfly });
      }),
      session.on('disconnect', ({ willReconnect }) => {
        if (!everJoined) {
          ui.show('error', {
            kind: 'error',
            title: 'Cannot reach the server',
            message: 'Check your connection.',
            canRetry: false,
          });
        } else if (willReconnect) ui.show('error', { kind: 'reconnecting' });
      }),
      session.on('reconnect', () => ui.hide('error')),
      session.on('error', (m) => ui.hud.toast(m.msg)),
      session.on('grabbed', (m) => {
        if (m.kind === 'push') {
          // thrown away from the grabber; near a ledge this knocks the player off
          player.applyImpulse([m.dir[0] * PUSH_SPEED, 3, m.dir[1] * PUSH_SPEED]);
          ui.hud.flash();
        } else if (m.kind === 'save') {
          // pulled back up next to the grabber
          player.respawn({ pos: m.pos, yaw: player.state.yaw });
          copy(player.state.pos, prev);
          copy(player.state.pos, curr);
          ui.hud.toast(`${names.get(m.by) ?? 'Someone'} saved you!`);
        } else ui.hud.toast(`${names.get(m.by) ?? 'Someone'} helped you up!`);
      }),
      session.on('storm', (m) => {
        stormLevel = m.level;
        ui.hud.setStorm(m.level, m.max);
      }),
      session.on('throw', (m) => {
        // Everyone sees the boss and the red circle; the server only ever aims at marked players.
        villain.setBoss(bossFeet);
        const mine = m.target === session.playerId;
        if (mine) throwsAtMe++;
        const y = mine ? player.state.pos[1] : (remote?.get(m.target)?.pos[1] ?? player.state.pos[1]);
        villain.throwAt(m, y, session.serverNow());
        if (mine) ui.hud.toast('Incoming! Get out of the circle!');
      }),
      session.on('hit', (m) => {
        hitsOnMe++;
        // Only a marked player is ever told this. Knocked back like a push, a bit harder.
        player.applyImpulse([m.dir[0] * PUSH_SPEED * 1.4, 4, m.dir[1] * PUSH_SPEED * 1.4]);
        ui.hud.flash();
        ui.hud.toast('The villain got you!');
      }),
      session.on('marked', (m) => {
        ui.hud.butterfly(); // everyone sees a small butterfly drift by: the butterfly effect has begun
        if (m.id === session.playerId) {
          ui.hud.flash();
          ui.hud.toast('A butterfly follows you…');
        } else ui.hud.toast(`${names.get(m.id) ?? 'Someone'} is marked!`);
      }),
    ];
    session.connect({ name, clientId, room });
  }

  function stopOnline() {
    for (const off of offNet) off();
    offNet = [];
    net?.disconnect();
    net = null;
    villain.reset();
    remote = null;
    crowd?.dispose();
    crowd = null;
    matchSize = 0;
    qualifyCount = 0;
    slot = Math.floor((courseDef.spawn.cols - 1) / 2);
    t = -COUNTDOWN_SEC;
  }

  // ---- simulation
  engine.onFixedUpdate((dt) => {
    const { phase, paused } = flow.state;
    if (paused || phase === 'title' || phase === 'lobby' || phase === 'loading') {
      input.sample(); // drop presses made while not playing
      return;
    }
    if (net) {
      t = net.raceTimeSec();
      if (phase === 'countdown') {
        if (t >= 0) {
          flow.dispatch({ type: 'go' });
          ui.show('countdown', { value: 0 });
        } else if (Math.ceil(-t) !== shownCount) {
          shownCount = Math.ceil(-t);
          ui.show('countdown', { value: shownCount });
        }
      }
    } else t += dt;
    if (net) {
      // the server owns the clock; nothing to advance here
    } else if (clock.advance(dt).wentGo) {
      flow.dispatch({ type: 'go' });
      ui.show('countdown', { value: 0 });
    } else if (!clock.started && clock.countdown !== shownCount) {
      shownCount = clock.countdown;
      ui.show('countdown', { value: shownCount });
    }
    course.stepColliders(t);
    const sample = input.sample();
    if (net) {
      // Grab (#84): show what it would do, and send it when pressed
      const racing = phase === 'race' && !player.state.finished;
      const target = racing && remote ? targeting.find(player.state, remote) : null;
      input.touchControls?.setGrab(racing ? (target?.kind ?? null) : 'hidden');
      if (target && target.kind && sample.grabPressed) {
        const nowMs = performance.now();
        if (nowMs - lastGrabAt >= BUTTERFLY.GRAB_COOLDOWN_MS) {
          lastGrabAt = nowMs;
          net.grab(target.id, target.kind, [target.dirX, target.dirZ]);
        }
      }
    } else input.touchControls?.setGrab('hidden');
    const control = phase !== 'race' ? IDLE : autopilot ? autopilot.drive(player.state, course.getColliders()) : sample;
    // soft crowd contact runs before the controller's own collision pass
    if (net && remote && phase === 'race' && !player.state.finished) bumping.apply(player.state, remote, dt);
    copy(curr, prev);
    player.step(control, autopilot ? 0 : camera.yaw, dt, t);
    copy(player.state.pos, curr);
    if (net && (phase === 'race' || phase === 'finished')) net.sendState(player.state);
  });

  // ---- render
  engine.onRender((alpha, frameDt) => {
    const { phase, paused } = flow.state;
    course.update(t);
    theme?.tick(t);
    theme?.setShadowFocus(drawn[0], drawn[1], drawn[2]);
    for (let k = 0; k < 3; k++) drawn[k] = prev[k] + (curr[k] - prev[k]) * alpha;
    const s = player.state;
    pose.yaw = s.yaw;
    pose.anim = s.anim;
    pose.speed = Math.hypot(s.vel[0], s.vel[2]);
    wobbler.setPose(pose, paused ? 0 : frameDt);
    camera.update(drawn, s.vel, frameDt);
    themeV2?.update(frameDt, engine.camera);
    if (net) villain.update(net.serverNow(), frameDt);
    if (net && crowd) {
      remote = net.sampleRemote();
      crowd.update(remote, engine.camera.position, frameDt);
    }
    if (phase === 'race') ui.hud.setTime(Math.max(0, (net ? t : clock.t) * 1000));
  });

  course.stepColliders(t);
  place(course.spawnPoint(slot, point));
  touchRoot.hidden = true;
  ui.show('title');
  engine.start();
  // invite link: join the room straight away with the remembered name
  const invited = sanitizeRoomCode(params.get('room') ?? '');
  if (isValidRoomCode(invited)) {
    const store = (() => {
      try {
        return localStorage;
      } catch {
        return null;
      }
    })();
    startOnline(loadName(store) || 'Wobbler', invited);
  }

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
      villain.dispose();
      input.dispose();
      wobbler.dispose();
      course.dispose();
      theme?.dispose();
      themeV2?.dispose();
      ui.dispose();
      engine.dispose();
    },
  };
}
