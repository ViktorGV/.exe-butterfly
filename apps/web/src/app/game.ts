// The game (#26): wires engine, input, controller, course, camera, Wobbler, theme and UI into
// solo practice on a built-in course, fully offline. Phone first: touch controls and a top-edge HUD.
//
// Fixed step:  clock -> course.stepColliders -> input.sample -> player.step
// Render:      course.update -> wobbler.setPose (interpolated) -> camera.update -> HUD
import { assembleCourse, resolveBuiltin } from '@wobble/shared';
import { BUILTIN_SKIN_PACKS, DEFAULT_SKIN_ID, DEFAULT_THEME_ID } from '@wobble/shared/assets/index';
import { DEFAULT_COURSE_ID } from '@wobble/shared/course/recipes/index';
import type * as THREE from 'three';
import type { CourseRecipe, InputState, Pack, SkinDef, ThemeDef, ThemeDefV2, Vec3 } from '@wobble/shared/types';
import type { MatchConfig, RemoteState, RoomState } from '@wobble/shared/types';
import { button, h } from '../ui/dom.ts';
import { THEME_CHOICES } from './themes.ts';
import { applyThemeV2, courseForTheme } from '../theme/v2/index.ts';
import { groundYOf } from '../theme/v2/layout.ts';
import { createThemeSupports, type ThemeSupports } from '../theme/v2/supports.ts';
import { createThemeProps, type ThemeProps } from '../theme/v2/props.ts';
import { createThemeAmbient, type ThemeAmbient } from '../theme/v2/ambient.ts';
import { createFollowCamera } from '../camera/index.ts';
import { createCrowd, type Crowd } from '../crowd/index.ts';
import { createVillainView } from '../villain/index.ts';
import { applyDeskAtmosphere, createDeskCourse, type DeskPaint } from '../desk/index.ts';
import { useWorldMapping } from '../theme/v2/materials.ts';
import { createStormVillainView } from '../desk/villain.ts';
import { BRIDGE_HALF_WIDTH, bridgeSpan, createHeroBridge } from '../hero/index.ts';
import { summarize } from '../butterfly/summary.ts';
import { newClientId } from '../net/clientId.ts';
import { createNetClient, getServerUrl, type NetSession } from '../net/index.ts';
import { createRacerFarTier } from '../racers/far.ts';
import { createRacerWobbler, prepareRacers } from '../racers/play.ts';
import { createCourseRuntime, type SpawnPoint } from '../course/index.ts';
import { createEngine } from '../engine/index.ts';
import { createAudio } from '../audio/index.ts';
import { createInput } from '../input/index.ts';
import { createPlayerController } from '../player/index.ts';
import { createBumper, createCrowdCollision, CROWD } from '../player/crowdCollision.ts';
import { createGrabTargeting } from '../butterfly/targeting.ts';
import { createMarkerView } from '../butterfly/markers.ts';
import { stormLine } from '../butterfly/stormReaction.ts';
import { BUTTERFLY, MAX_PLAYERS_PER_ROOM } from '@wobble/shared/constants';
import { applyTheme } from '../theme/index.ts';
import { createUI, type ResultRow } from '../ui/index.ts';
import { isValidRoomCode, loadName, sanitizeRoomCode } from '../ui/settings.ts';
import { createAutopilot } from './autopilot.ts';
import { BOT_NAMES, BOTS, createBots } from './bots.ts';
import { COUNTDOWN_SEC, createBestTimes, createRaceClock } from './clock.ts';
import { createFlow } from './state.ts';

import { preloadMatch } from './preload.ts';
import { createAssetStore } from '../assets/index.ts';

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
  let themePack = pick(params.get('theme'), 'theme', DEFAULT_THEME_ID);
  const courseDef = assembleCourse(coursePack.data as CourseRecipe);

  const ui = createUI(uiRoot);
  const engine = createEngine({ canvas });
  const { scene } = engine;
  // Event themes (v2, #64) bring their own sky, ground, textures and obstacle dressing; images live in
  // /event/themes/<slug>/. Built-in v1 themes keep the original renderer.
  // Music and sound (#13): the engine wakes on the first tap or key press; the volume sliders drive it.
  const audio = createAudio();
  audio.setVolumes(ui.settings);
  ui.on('settings:change', (s) => audio.setVolumes(s));
  let themeV2: ReturnType<typeof applyThemeV2> | null = null;
  let theme: ReturnType<typeof applyTheme> | null = null;
  let course!: ReturnType<typeof createCourseRuntime>;
  // The course look: the Chain Reaction Desk (default) draws every obstacle as a desk object over the same
  // colliders; ?look=classic keeps the theme's own look. The course itself (layout, colliders) never changes.
  const deskLook = params.get('look') !== 'classic';
  let desk: ReturnType<typeof createDeskCourse> | null = null;
  let undoAtmosphere: (() => void) | null = null;
  let deskShown = false;
  /** Desk floors stay desk objects (repainted) in an event theme; every other obstacle uses the theme's own. */
  const DESK_FLOORS = new Set(['platform', 'ramp']);
  /** How an event theme repaints the desk: its palette, and its generated textures per kind of desk stuff. */
  function deskPaint(rt: NonNullable<typeof themeV2>, def: ThemeDefV2): DeskPaint {
    const slotFor = {
      paper: 'platformA',
      wood: 'platformB',
      plastic: 'accent',
      rubber: 'bouncy',
      chrome: 'rail',
      brass: 'rail',
    } as const;
    return {
      palette: [...Object.values(def.materials).map((m) => m.color), ...def.costume.palette, ...def.fx.confetti],
      texture: (kind) => (kind in slotFor ? rt.getMaterial(slotFor[kind as keyof typeof slotFor]) : null),
      worldMapping: (m) => useWorldMapping(m),
    };
  }
  let supports: ThemeSupports | null = null;
  let themeProps: ThemeProps | null = null;
  let themeAmbient: ThemeAmbient | null = null;
  let villainIsStorm = false;
  let villain: ReturnType<typeof createVillainView> | ReturnType<typeof createStormVillainView> | null = null;
  /** Builds (or rebuilds, for the room's voted theme) the theme and the course runtime dressed by it. */
  function buildWorld(pack: Pack) {
    supports?.dispose();
    supports = null;
    themeProps?.dispose();
    themeProps = null;
    themeAmbient?.dispose();
    themeAmbient = null;
    course?.dispose();
    theme?.dispose();
    themeV2?.dispose();
    undoAtmosphere?.();
    const before = new Set(scene.children);
    themePack = pack;
    const themeDef = pack.data as ThemeDef;
    audio.setMusic(themeDef.music);
    themeV2 =
      themeDef.version === 2
        ? applyThemeV2(themeDef, {
            scene,
            renderer: engine.renderer,
            course: courseForTheme(courseDef),
            baseUrl: `/event/themes/${pack.id.replace(/^e:theme-/, '')}/`,
          })
        : null;
    theme = themeV2 ? null : applyTheme(themeDef, { scene, renderer: engine.renderer });
    course = createCourseRuntime({
      courseDef,
      theme: themeV2 ?? theme!,
      getDressing: themeV2?.getDressing,
      scene,
    });
    // The desk map is the course look. Classic is the school desk. An event theme repaints the desk in its own
    // palette and textures, keeps the desk's floors, book stacks and checkpoints, draws every other obstacle with
    // its own objects (theme dressing) and shows its sky, landmarks and particles instead of the school props.
    const event = themeV2;
    if (deskLook) {
      desk?.dispose();
      const dressed = (k: string) => !!event && !DESK_FLOORS.has(k) && !!event.getDressing(k, 0);
      desk = createDeskCourse({
        courseDef,
        paint: event ? deskPaint(event, themeDef as ThemeDefV2) : null,
        themedKind: dressed,
      });
      scene.add(desk.root);
      if (event) {
        course.root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh)
            o.visible = o.name.startsWith('dressing:') && dressed(o.name.split(':')[1] ?? '');
        });
        event.setFeature('ground', false);
        // Its own landmarks sit at the course ends at full scale (one became a giant slab over the finish); on the
        // desk map the set pieces along the sides (theme props below) take their place.
        event.setFeature('landmarks', false);
        // The desk's book stacks and paperclip arches give way to the theme's pylons and gates.
        supports = createThemeSupports({
          course: courseDef,
          groundY: courseDef.killY - 2,
          getMaterial: event.getMaterial,
          gates: true,
        });
        scene.add(supports.group);
        // The giant school props give way to the theme's own set pieces and clutter along the course.
        themeProps = createThemeProps({
          theme: themeDef as ThemeDefV2,
          course: courseDef,
          groundY: courseDef.killY - 2,
        });
        scene.add(themeProps.group);
        // Life in place of the butterflies, domino wave and desk lamp: squadrons, drones, searchlights, a pulse.
        themeAmbient = createThemeAmbient({
          theme: themeDef as ThemeDefV2,
          course: courseDef,
          groundY: courseDef.killY - 2,
        });
        scene.add(themeAmbient.group);
      } else {
        // Keep the theme and course runtime running (colliders, music), but show the desk instead of their meshes.
        course.root.visible = false;
        for (const child of scene.children)
          if (!before.has(child) && child !== course.root && child !== desk.root) child.visible = false;
        undoAtmosphere = applyDeskAtmosphere(scene, engine.renderer);
      }
    } else if (event) {
      // ?look=classic: the course runtime look, with themed supports under the floors.
      supports = createThemeSupports({
        course: courseDef,
        groundY: groundYOf(courseForTheme(courseDef)),
        getMaterial: event.getMaterial,
      });
      scene.add(supports.group);
    }
    deskShown = !!desk && !event;
    if (villain && villainIsStorm !== deskShown) makeVillain();
  }
  buildWorld(themePack);
  const getColliders = () => course.getColliders();
  const input = createInput({ target: window, touchRoot });
  const camera = createFollowCamera(engine.camera);
  // With the desk look the villain is Crumple, the paper storm; same throws, same circles, same timing. An event
  // theme brings its own world, so it gets the generic villain instead (swapped when the room changes theme).
  function makeVillain() {
    villain?.dispose();
    villainIsStorm = deskShown;
    villain = deskShown
      ? createStormVillainView({ scene, ringRadius: BUTTERFLY.THROW_RADIUS_M })
      : createVillainView({ scene });
  }
  makeVillain();
  const heroBridge = createHeroBridge({ scene });
  const markers = createMarkerView({ scene });
  // The boss stands on the finish pad, facing the course.
  const bossFeet: [number, number, number] = [
    courseDef.finish.pos[0],
    courseDef.finish.pos[1] - courseDef.finish.half[1],
    courseDef.finish.pos[2] - courseDef.finish.half[2],
  ];
  // The racers are built once, up front, so no player appearing later causes a hitch. ?racer=<id> picks one.
  prepareRacers();
  const racerParam = params.get('racer');
  let wobbler = createRacerWobbler(racerParam ? { name: racerParam } : (skinPack.data as SkinDef));
  scene.add(wobbler.object3d);

  // Solo: a middle column of the front row (slot 0 is the far-left corner of the 20-wide grid).
  let slot = Math.floor((courseDef.spawn.cols - 1) / 2);
  const point: SpawnPoint = { pos: [0, 0, 0], yaw: 0 };
  const player = createPlayerController({
    getColliders,
    course: courseDef,
    spawn: course.spawnPoint(slot, point),
  });
  // Solo bots: the other grid slots, nearest the player first.
  const soloSlot = slot;
  const botSlots: number[] = [];
  for (let k = 1; botSlots.length < BOTS.count; k++) {
    const sl = soloSlot + (k % 2 ? 1 : -1) * Math.ceil(k / 2);
    if (sl >= 0) botSlots.push(sl);
  }
  const bots = createBots({
    course: courseDef,
    getColliders,
    slots: botSlots,
    spawnPoint: (sl, out) => course.spawnPoint(sl, out),
    respawnPoint: (cp, sl, out) => course.respawnPoint(cp, sl, out),
  });
  /** Solo: the top two thirds qualify. */
  const SOLO_QUALIFY = Math.ceil(((BOTS.count + 1) * 2) / 3);
  let shownPlace = -1;
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
  const bumper = createBumper();
  let remote: ReadonlyMap<number, RemoteState> | null = null;
  const targeting = createGrabTargeting();
  let lastGrabAt = -Infinity;
  /** A Help up / push press waits this long (ms) for someone to come into reach. */
  const GRAB_BUFFER_MS = 600;
  let grabArmedUntil = -Infinity;
  const PUSH_SPEED = 7;
  /** A push puts you on the floor this long, unless someone helps you up sooner. */
  const PUSH_DOWN_MS = 2000;
  const names = new Map<number, string>();
  let finishedCount = 0;
  // Butterfly effect counters for the results screen (#84).
  let stormLevel = 0;
  let throwsAtMe = 0;
  let hitsOnMe = 0;
  let heroHelped = false;
  let lastIncomingAt = -Infinity;
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
    shownPlace = -1;
    if (!net) {
      bots.reset();
      matchSize = BOTS.count + 1;
      qualifyCount = SOLO_QUALIFY;
      finishedCount = 0;
    }
    player.state.checkpoint = -1;
    player.state.finished = false;
    course.stepColliders(t);
    course.stepColliders(t);
    place(course.spawnPoint(slot, point));
    ui.show('hud', {
      solo: false, // solo races the bots, so place and qualified are real
      checkpoints,
      totalPlayers: matchSize || undefined,
      qualifyMax: qualifyCount || undefined,
      device: input.activeDevice,
    });
    ui.hud.setPlace(net ? 0 : bots.placeOf(player.state), matchSize);
    ui.hud.setQualified(0, qualifyCount);
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
    if (!crowd) {
      crowd = createCrowd({
        scene,
        max: BOTS.count,
        wobblerFactory: createRacerWobbler,
        farTier: createRacerFarTier({ renderer: engine.renderer, max: BOTS.count }),
      });
      crowd.setPlayers(
        bots.ids.map((id, i) => ({
          id,
          name: BOT_NAMES[i % BOT_NAMES.length]!,
          skin: BUILTIN_SKIN_PACKS[i % BUILTIN_SKIN_PACKS.length]?.data,
        })),
      );
    }
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
  });
  player.on('fell', () => {
    place(course.respawnPoint(player.state.checkpoint, slot, point));
    ui.hud.flash();
  });
  player.on('dive', () => camera.kick('dive'));
  // Arrow tiles (#84 follow-up): a forward arrow is a dash, a back arrow a shove
  player.on('boost', (e) => (e.dir > 0 ? camera.kick('dive') : ui.hud.flash()));
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
    const place = bots.finishPlayer();
    finishedCount++;
    ui.hud.setPlace(place, matchSize);
    ui.hud.setQualified(Math.min(finishedCount, qualifyCount), qualifyCount);
    const bestBefore = best.get(courseDef.id);
    const newBest = best.submit(courseDef.id, timeMs);
    flow.dispatch({ type: 'finish' });
    ui.hud.setTime(timeMs);
    ui.show('finish', {
      kind: place <= qualifyCount ? 'qualified' : 'finished',
      timeMs,
      bestMs: newBest ? timeMs : bestBefore,
      newBest,
    });
  });

  // ---- solo bots
  bots.onFinish((id, place) => {
    if (net) return;
    finishedCount++;
    ui.hud.setQualified(Math.min(finishedCount, qualifyCount), qualifyCount);
    if (place <= 3 && !player.state.finished)
      ui.hud.toast(`${BOT_NAMES[(id - 1) % BOT_NAMES.length]} finished ${place}`);
  });
  bots.onPush(({ dir }) => {
    if (net) return;
    player.applyImpulse([dir[0] * PUSH_SPEED, 3, dir[1] * PUSH_SPEED]);
    player.stumble(BUTTERFLY.STUMBLE_MS);
    ui.hud.flash();
  });

  // ---- online play (#27): quick play, join with a code, create a room
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

  const assetStore = createAssetStore();
  let lobby: { dispose(): void } | null = null;
  /**
   * The waiting room: room code, who is here, Start race for the host, invite link and Leave. Rooms race in the
   * theme the host picked on the title screen (sent once when the host first sees the room).
   */
  function showLobby(session: NetSession) {
    lobby?.dispose();
    const slotEl = ui.getSlot('lobby');
    let sentTheme = false;
    const render = (room: RoomState | null) => {
      if (!room) return;
      const me = session.playerId ?? -1;
      const host = room.hostId === me;
      if (host && !sentTheme && room.config.themeId !== themePack.id) {
        sentTheme = true;
        session.setConfig({ courseId: room.config.courseId, themeId: themePack.id });
      }
      const here = room.players.filter((p) => p.connected);
      const theme = THEME_CHOICES.find((t) => t.id === room.config.themeId)?.title ?? 'Classic';
      const invite: HTMLButtonElement = button(document, 'Copy invite link', '', () => {
        void navigator.clipboard?.writeText(inviteLink(room.code)).then(() => (invite.textContent = 'Link copied'));
      });
      slotEl.replaceChildren(
        h(
          document,
          'div',
          { class: 'wr-card wr-panel' },
          h(document, 'h2', { class: 'wr-panel-title' }, `Room ${room.code}`),
          h(document, 'p', null, `Theme: ${theme}`),
          h(
            document,
            'p',
            null,
            `${here.length} player${here.length === 1 ? '' : 's'} here. Share the code to invite friends.`,
          ),
          h(document, 'ul', { class: 'wr-help-list' }, ...here.map((p) => h(document, 'li', null, p.name))),
          h(document, 'p', null, host ? 'Press Start when everyone is in.' : 'Waiting for the host to start the race.'),
          h(
            document,
            'div',
            { class: 'wr-actions' },
            host ? button(document, 'Start race', 'wr-btn-primary', () => session.start()) : null,
            invite,
            button(document, 'Leave', 'wr-btn-danger', () => flow.dispatch({ type: 'leave' })),
          ),
        ),
      );
    };
    render(session.room);
    const off = session.on('room', (r) => {
      if (flow.state.phase === 'lobby') render(r);
    });
    lobby = { dispose: () => off() };
  }
  function hideLobby() {
    lobby?.dispose();
    lobby = null;
  }

  /** `?room=CODE` on this page: opening the link joins that room. */
  function inviteLink(code: string): string {
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('room', code);
    return u.toString();
  }

  function startOnline(name: string, room: string) {
    if (net || !flow.dispatch({ type: 'playOnline' })) return;
    crowd?.dispose(); // the solo bots' crowd
    remote = null;
    const session = createNetClient({ url: getServerUrl() });
    net = session;
    crowd = createCrowd({
      scene,
      wobblerFactory: createRacerWobbler,
      farTier: createRacerFarTier({ renderer: engine.renderer, max: MAX_PLAYERS_PER_ROOM - 1 }),
    });
    finishedCount = 0;
    stormLevel = 0;
    throwsAtMe = 0;
    hitsOnMe = 0;
    heroHelped = false;
    let everJoined = false;
    offNet = [
      session.on('welcome', () => {
        ui.hide('error');
        if (!everJoined && flow.state.phase === 'lobby') showLobby(session);
        everJoined = true;
      }),
      session.on('roomPatch', (p) => {
        // results are over: back to the lobby for the next race
        if (p.phase === 'lobby' && flow.dispatch({ type: 'backToLobby' })) {
          ui.show('lobby');
          showLobby(session);
        }
      }),
      session.on('matchConfig', (cfg: MatchConfig) => {
        matchSize = cfg.players.length;
        qualifyCount = cfg.qualifyCount;
        names.clear();
        for (const p of cfg.players) names.set(p.id, p.name);
        const me = cfg.players.find((p) => p.id === session.playerId);
        if (me) slot = me.slot;
        if (cfg.courseId !== coursePack.id) console.warn(`room course ${cfg.courseId} differs from ${coursePack.id}`);
        finishedCount = 0;
        if (!flow.dispatch({ type: 'matchStart' })) return;
        hideLobby();
        // Preload the room's theme and every skin; the race waits only for the blocking part.
        void preloadMatch(assetStore, cfg, session.playerId ?? -1).then((m) => {
          if (net !== session) return;
          if (m.theme && m.theme.id !== themePack.id) {
            buildWorld(m.theme);
            course.stepColliders(t);
          }
          const me = m.skins.get(session.playerId ?? -1);
          if (me && me.id !== skinPack.id) {
            scene.remove(wobbler.object3d);
            wobbler.dispose();
            wobbler = createRacerWobbler(racerParam ? { name: racerParam } : me.data);
            scene.add(wobbler.object3d);
          }
          crowd?.setPlayers(
            cfg.players
              .filter((p) => p.id !== session.playerId)
              .map((p) => ({ id: p.id, name: p.name, skin: m.skins.get(p.id)?.data })),
          );
          session.sendLoaded();
        });
      }),
      session.on('countdown', () => {
        flow.dispatch({ type: 'loaded' });
      }),
      session.on('checkpoint', (m) => {
        ui.hud.setCheckpoint(m.index + 1, checkpoints);
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
        } else ui.hud.toast(`${names.get(m.id) ?? 'Someone'} finished ${m.place}`);
      }),
      session.on('raceEnd', ({ results }) => {
        flow.dispatch({ type: 'finish' });
        villain?.reset();
        heroBridge.close();
        markers.reset();
        markers.reset();
        player.setWindShelter(null);
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
          { storm: stormLevel, stormMax: BUTTERFLY.STORM_MAX, throwsAtMe, hitsOnMe, heroBridge: heroHelped },
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
          player.knockDown(PUSH_DOWN_MS); // on the floor for 2 s; a help-up stands you at once
          ui.hud.toast(`${names.get(m.by) ?? 'Someone'} pushed you over!`, true);
        } else if (m.kind === 'save') {
          // pulled back up next to the grabber
          player.respawn({ pos: m.pos, yaw: player.state.yaw });
          copy(player.state.pos, prev);
          copy(player.state.pos, curr);
          ui.hud.toast(`${names.get(m.by) ?? 'Someone'} saved you!`);
        } else {
          player.getUp(); // a help-up: stand at once
          ui.hud.toast(`${names.get(m.by) ?? 'Someone'} helped you up!`);
        }
      }),
      session.on('storm', (m) => {
        const line = stormLine(stormLevel, m.level, m.max);
        stormLevel = m.level;
        ui.hud.setStorm(m.level, m.max);
        if (line) ui.hud.toast(line);
      }),
      session.on('throw', (m) => {
        // Everyone sees the boss and the red circle; the server only ever aims at marked players.
        villain?.setBoss(bossFeet);
        const mine = m.target === session.playerId;
        if (mine) throwsAtMe++;
        const y = mine ? player.state.pos[1] : (remote?.get(m.target)?.pos[1] ?? player.state.pos[1]);
        villain?.throwAt(m, y, session.serverNow());
        // a volley is several throws at once: warn once per round, not once per ball
        if (mine && performance.now() - lastIncomingAt > 2000) {
          lastIncomingAt = performance.now();
          ui.hud.toast('Incoming! Get out of the circles!');
        }
      }),
      session.on('hero', () => {
        // You helped others and never pushed: the hero opens a bridge, visible only to you, where the wind
        // does not push you.
        heroHelped = true;
        const span = bridgeSpan(courseDef);
        if (span) {
          heroBridge.open(span, performance.now());
          player.setWindShelter({ minX: -BRIDGE_HALF_WIDTH, maxX: BRIDGE_HALF_WIDTH });
        }
        ui.hud.toast('The hero opens a bridge for you!');
      }),
      session.on('hit', (m) => {
        hitsOnMe++;
        // Only a marked player is ever told this. Knocked back like a push, a bit harder.
        player.applyImpulse([m.dir[0] * PUSH_SPEED * 1.4, 4, m.dir[1] * PUSH_SPEED * 1.4]);
        player.knockDown();
        ui.hud.flash();
        ui.hud.toast('The villain got you!');
      }),
      session.on('marked', (m) => {
        markers.mark(m.id);
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
    hideLobby();
    net?.disconnect();
    net = null;
    villain?.reset();
    heroBridge.close();
    player.setWindShelter(null);
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
    if (!net) {
      bots.step(dt, t, player.state, phase === 'race' || phase === 'finished');
      remote = bots.remote;
      if (phase === 'race' && !player.state.finished) {
        const p = bots.placeOf(player.state);
        if (p !== shownPlace) ui.hud.setPlace((shownPlace = p), matchSize);
      }
    }
    {
      // Grab (#84): show what it would do, and send it when pressed
      const racing = phase === 'race' && !player.state.finished;
      const target = racing && remote ? targeting.find(player.state, remote) : null;
      input.touchControls?.setGrab(racing ? (target?.kind ?? null) : 'hidden');
      // keyboard / gamepad: a prompt such as "E  Push down" while someone is in reach
      const touchShown = input.touchControls?.visible === true;
      ui.hud.setAction(touchShown ? null : (target?.kind ?? null), input.activeDevice === 'gamepad' ? 'Y' : 'E');
      // A press stays armed for a moment and fires as soon as someone is in reach, so it works on the run.
      const nowMs = performance.now();
      if (sample.grabPressed) grabArmedUntil = nowMs + GRAB_BUFFER_MS;
      if (target && target.kind && nowMs <= grabArmedUntil) {
        if (nowMs - lastGrabAt >= BUTTERFLY.GRAB_COOLDOWN_MS) {
          grabArmedUntil = -Infinity; // one press, one action
          lastGrabAt = nowMs;
          if (net) net.grab(target.id, target.kind, [target.dirX, target.dirZ]);
          else bots.grabbed(target.id, target.kind, [target.dirX, target.dirZ], player.state);
          player.grab([target.dirX, target.dirZ]); // the reach / push arm animation, seen by everyone
        }
      }
    }
    const control = phase !== 'race' ? IDLE : autopilot ? autopilot.drive(player.state, course.getColliders()) : sample;
    // soft crowd contact runs before the controller's own collision pass
    if (remote && phase === 'race' && !player.state.finished) {
      bumping.apply(player.state, remote, dt);
      // touching someone knocks you both apart (each client bumps its own player)
      const bump = bumper.check(player.state, remote, performance.now());
      if (bump.hit) {
        player.applyImpulse(bump.vel);
        player.stumble(CROWD.bumpStumbleMs);
      }
    }
    copy(curr, prev);
    player.step(control, autopilot ? 0 : camera.yaw, dt, t);
    copy(player.state.pos, curr);
    if (net && (phase === 'race' || phase === 'finished')) net.sendState(player.state);
  });

  // ---- render
  engine.onRender((alpha, frameDt) => {
    const { phase, paused } = flow.state;
    course.update(t);
    if (desk) {
      desk.update(t); // same race time as the colliders
      themeProps?.update(t);
      themeAmbient?.update(t);
      desk.sun.target.position.set(drawn[0], 0, drawn[2]);
      desk.sun.position.set(drawn[0] + 60, 90, drawn[2] + 50);
    }
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
    if (net) villain?.update(net.serverNow(), frameDt);
    heroBridge.update(performance.now());
    if (crowd) {
      if (net) remote = net.sampleRemote();
      if (remote) crowd.update(remote, engine.camera.position, frameDt);
    }
    // Marker butterflies are no longer drawn (the blue ones never went away); marks are still tracked.
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
      hideLobby();
      document.removeEventListener('visibilitychange', onHidden);
      camera.dispose();
      villain?.dispose();
      supports?.dispose();
      themeProps?.dispose();
      themeAmbient?.dispose();
      heroBridge.dispose();
      markers.dispose();
      input.dispose();
      wobbler.dispose();
      course.dispose();
      theme?.dispose();
      themeV2?.dispose();
      desk?.dispose();
      undoAtmosphere?.();
      audio.dispose();
      ui.dispose();
      engine.dispose();
    },
  };
}
