// The game (#26): wires engine, input, controller, course, camera, Wobbler, theme and UI into
// solo practice on a built-in course, fully offline. Phone first: touch controls and a top-edge HUD.
//
// Fixed step:  clock -> course.stepColliders -> input.sample -> player.step
// Render:      course.update -> wobbler.setPose (interpolated) -> camera.update -> HUD
import { assembleCourse, getObstacleKind, resolveBuiltin } from '@wobble/shared';
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
import { compileWindZones, windAt } from '@wobble/shared/course/obstacles/wind';
import { createWindView, windOnScreen, type WindOnScreen } from '../wind/index.ts';
import { summarize } from '../butterfly/summary.ts';
import { newClientId } from '../net/clientId.ts';
import { createNetClient, getServerUrl, type NetSession } from '../net/index.ts';
import { createRacerFarTier } from '../racers/far.ts';
import { createRacerWobbler, prepareRacersLater, racerForSkin } from '../racers/play.ts';
import { createPodium, podiumPlacement, type PodiumSpot } from './podium.ts';
import { createCourseRuntime, type SpawnPoint } from '../course/index.ts';
import { createEngine } from '../engine/index.ts';
import { createAudio } from '../audio/index.ts';
import { createInput } from '../input/index.ts';
import { createPlayerController } from '../player/index.ts';
import { createBumper, createCrowdCollision, CROWD } from '../player/crowdCollision.ts';
import { createGrabTargeting } from '../butterfly/targeting.ts';
import { createMarkerView } from '../butterfly/markers.ts';
import { createKnockFx } from '../butterfly/knockFx.ts';
import { PUSH_FEEL } from '../butterfly/pushFeel.ts';
import { stormLine } from '../butterfly/stormReaction.ts';
import { createTracer, nearestTarget } from '../gun/index.ts';
import { boostTileAt, compileBoostTiles } from '@wobble/shared/course/obstacles/boost';
import { createFadeClock, setFadeSource } from '@wobble/shared/course/obstacles/fade';
import { Anim, BUTTERFLY, MAX_PLAYERS_PER_ROOM } from '@wobble/shared/constants';
import { applyTheme } from '../theme/index.ts';
import { createUI, type ResultRow } from '../ui/index.ts';
import { isValidRoomCode, loadName, sanitizeRoomCode } from '../ui/settings.ts';
import { createAutopilot } from './autopilot.ts';
import { BOT_NAMES, BOTS, createBots } from './bots.ts';
import { COUNTDOWN_SEC, createBestTimes, createRaceClock } from './clock.ts';
import { createFlow } from './state.ts';
import { createFx } from '../fx/index.ts';

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
  // Fading tiles: which ones were stepped on when. Online the server tells us (`fade`); solo we check ourselves.
  const fade = createFadeClock();
  const fadeTiles = compileBoostTiles(courseDef.entities).filter((tile) => tile.fade);
  setFadeSource((id, at) => fade.since(id, at));

  const ui = createUI(uiRoot);
  const engine = createEngine({ canvas });
  const { scene } = engine;
  const fx = createFx({ scene }); // game-feel effects (#29): one pooled Points draw call
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
    fx.setColors(themeDef.version === 2 ? themeDef.fx : null);
    // Some themes override their generated music (Fallen Galaxy plays the cinematic sci-fi score).
    audio.setMusic({ ...themeDef.music, ...THEME_CHOICES.find((c) => c.id === pack.id)?.music });
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
      // The theme takes over an obstacle kind only when it dresses every part of it: otherwise some parts would be
      // invisible but still solid. Partly dressed kinds stay desk objects (repainted).
      const partCount = (k: string) => {
        const ent = courseDef.entities.find((x) => x.kind === k);
        try {
          return ent ? (getObstacleKind(k)?.parts(ent).length ?? 0) : 0;
        } catch {
          return 0;
        }
      };
      const fullyDressed = new Map<string, boolean>();
      const dressed = (k: string) => {
        if (!event || DESK_FLOORS.has(k)) return false;
        let v = fullyDressed.get(k);
        if (v === undefined) {
          const n = partCount(k);
          v = n > 0 && Array.from({ length: n }, (_, i) => !!event.getDressing(k, i)).every(Boolean);
          fullyDressed.set(k, v);
        }
        return v;
      };
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
          gateColor: (themeDef as ThemeDefV2).fx.checkpoint,
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
  // The snow blowers' wind: streaks and a floor strip for each fan, and a HUD arrow while it pushes you.
  const windFx = createWindView({ scene, entities: courseDef.entities });
  const windZones = compileWindZones(courseDef.entities);
  const windVec: Vec3 = [0, 0, 0];
  const windScreen: WindOnScreen = { angle: 0, speed: 0 };
  const markers = createMarkerView({ scene });
  // Gun: every BUTTERFLY.GUN_PUSHES pushes you receive give you BUTTERFLY.GUN_SHOTS shots.
  const tracer = createTracer({ scene });
  let shots = 0;
  let pushesReceived = 0;
  let lastShotAt = -Infinity;
  /** When you were shot: knocked flat, then back to your checkpoint at this time (performance.now ms). */
  let shotRespawnAt = -1;
  const GUN_KEY = 'F';
  const knockFx = createKnockFx({ scene });
  // The boss stands on the finish pad, facing the course.
  const bossFeet: [number, number, number] = [
    courseDef.finish.pos[0],
    courseDef.finish.pos[1] - courseDef.finish.half[1],
    courseDef.finish.pos[2] - courseDef.finish.half[2],
  ];
  // Your racer is built now; the others are built in the background once the title is up. ?racer=<id> picks one.
  prepareRacersLater();
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
  /** villain throws knock you back this hard (pushes use PUSH_FEEL) */
  const PUSH_SPEED = 7;
  const names = new Map<number, string>();
  // Butterfly effect counters for the results screen (#84).
  let stormLevel = 0;
  let throwsAtMe = 0;
  let hitsOnMe = 0;
  let heroHelped = false;
  let lastIncomingAt = -Infinity;
  let matchSize = 0;
  let matchSkins: ReadonlyMap<number, Pack> | null = null;

  // ---- final podium (top three) before the results screen
  const PODIUM_MS = 4500;
  const podium = createPodium({
    scene,
    camera: engine.camera,
    figure: (skin) => createRacerWobbler(skin),
    keyOf: (skin) => racerForSkin(skin).id,
    idleAnim: Anim.CELEBRATE,
    labelRoot: uiRoot,
  });
  const podiumSpots: PodiumSpot[] = [];
  /** Above and past the finish pad, clear of the course and the crowd. */
  const podiumBase: Vec3 = [
    courseDef.finish.pos[0],
    courseDef.finish.pos[1] + courseDef.finish.half[1] + 8,
    courseDef.finish.pos[2] - courseDef.finish.half[2] - 6,
  ];
  let podiumTimer: ReturnType<typeof setTimeout> | null = null;
  let podiumDone: (() => void) | null = null;
  function startPodium(spots: readonly PodiumSpot[], localId: number, done: () => void) {
    endPodium(true);
    if (spots.length === 0) return done();
    podium.show(
      podiumBase,
      spots,
      (id) => matchSkins?.get(id)?.data ?? (id === localId ? skinPack.data : undefined),
      (id) => names.get(id) ?? `Player ${id}`,
    );
    podiumDone = done;
    podiumTimer = setTimeout(endPodium, PODIUM_MS);
  }
  /** Takes the podium down; `skip` drops the pending results (a new race or the lobby is next). */
  function endPodium(skip = false) {
    if (podiumTimer) clearTimeout(podiumTimer);
    podiumTimer = null;
    const done = podiumDone;
    podiumDone = null;
    if (!podium.active) return;
    podium.hide();
    if (!skip) done?.();
  }

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
    fade.reset();
    t = net ? net.raceTimeSec() : -COUNTDOWN_SEC;
    shownCount = -1;
    shownPlace = -1;
    if (!net) {
      bots.reset();
      matchSize = BOTS.count + 1;
    }
    player.state.checkpoint = -1;
    player.state.finished = false;
    fx.clear();
    pushesReceived = 0;
    lastShotAt = -Infinity;
    shotRespawnAt = -1;
    course.stepColliders(t);
    course.stepColliders(t);
    place(course.spawnPoint(slot, point));
    ui.show('hud', {
      solo: false, // solo races the bots, so the place is real
      checkpoints,
      totalPlayers: matchSize || undefined,
      device: input.activeDevice,
    });
    ui.hud.setPlace(net ? 0 : bots.placeOf(player.state), matchSize);
    ui.hud.setCheckpoint(0, checkpoints);
    ui.hud.setTime(0);
    setShots(0);
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
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (e.code === 'KeyF' && !e.repeat && !typing) shoot();
  };
  ui.on('shoot', () => shoot());

  const shooterAt: Vec3 = [0, 0, 0];
  function setShots(n: number) {
    shots = n;
    // on a phone the whole Shoot button is tapped, so no keyboard key is shown
    ui.hud.setGun(shots, input.touchControls?.visible === true ? '' : GUN_KEY);
    wobbler.setGun(shots > 0); // the gun in your character's hand
  }
  /** You were shot from `from`: knocked flat, away from the shooter, then back to your last checkpoint. */
  function getShot(from: Readonly<Vec3> | undefined) {
    let dx = 0;
    let dz = -1;
    if (from) {
      const len = Math.hypot(player.state.pos[0] - from[0], player.state.pos[2] - from[2]) || 1;
      dx = (player.state.pos[0] - from[0]) / len;
      dz = (player.state.pos[2] - from[2]) / len;
    }
    player.applyImpulse([dx * 5, 3, dz * 5]);
    player.knockDown(BUTTERFLY.KNOCKED_MS);
    ui.hud.flash();
    shotRespawnAt = performance.now() + BUTTERFLY.KNOCKED_MS;
  }
  /** Fire at the nearest racer in range. Online the server checks and tells everyone; solo the bot is sent back. */
  function shoot() {
    if (flow.state.phase !== 'race' || flow.state.paused || player.state.finished || shots <= 0 || !remote) return;
    const nowMs = performance.now();
    if (nowMs - lastShotAt < BUTTERFLY.GUN_COOLDOWN_MS) return;
    const target = nearestTarget(player.state, remote, net?.playerId ?? -1);
    if (target < 0) return void ui.hud.toast('Nobody in range', true);
    lastShotAt = nowMs;
    const to = remote.get(target)!.pos;
    tracer.fire(player.state.pos, to, nowMs);
    if (net) return void net.shoot(target); // the server answers with `gun` (shots left) and `shot`
    const len = Math.hypot(to[0] - player.state.pos[0], to[2] - player.state.pos[2]) || 1;
    const dir: [number, number] = [(to[0] - player.state.pos[0]) / len, (to[2] - player.state.pos[2]) / len];
    if (bots.shot(target, dir)) {
      setShots(shots - 1);
      ui.hud.toast(`You shot ${BOT_NAMES[(target - 1) % BOT_NAMES.length]}!`, true);
    }
  }
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
  player.on('checkpoint', () => fx.sparkle(player.state.pos));
  player.on('jump', () => fx.dust(player.state.pos, 0.4));
  player.on('land', (e) => {
    fx.dust(player.state.pos, Math.min(1, e.speed / 10));
    if (e.speed > 8) fx.shake(0.25);
  });
  player.on('bounce', () => (fx.ring(player.state.pos), fx.shake(0.4)));
  player.on('hit', () => (fx.stars(player.state.pos), fx.shake(0.6)));
  player.on('finish', () => fx.confetti(player.state.pos));
  player.on('fell', () => {
    place(course.respawnPoint(player.state.checkpoint, slot, point));
    fx.poof(player.state.pos);
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
    ui.hud.setPlace(place, matchSize);
    const bestBefore = best.get(courseDef.id);
    const newBest = best.submit(courseDef.id, timeMs);
    flow.dispatch({ type: 'finish' });
    ui.hud.setTime(timeMs);
    ui.show('finish', {
      kind: 'finished',
      timeMs,
      bestMs: newBest ? timeMs : bestBefore,
      newBest,
    });
  });

  // ---- solo bots
  bots.onFinish((id, place) => {
    if (net) return;
    if (place <= 3 && !player.state.finished)
      ui.hud.toast(`${BOT_NAMES[(id - 1) % BOT_NAMES.length]} finished ${place}`);
  });
  bots.onPush(({ dir }) => {
    if (net) return;
    player.applyImpulse([dir[0] * PUSH_FEEL.speed, PUSH_FEEL.hop, dir[1] * PUSH_FEEL.speed]);
    player.knockDown(PUSH_FEEL.soloDownMs);
    fx.stars(player.state.pos);
    fx.shake(0.8);
    audio.play('push');
    // solo gun: the same count the server keeps online
    if (++pushesReceived % BUTTERFLY.GUN_PUSHES === 0) {
      setShots(BUTTERFLY.GUN_SHOTS);
      ui.hud.toast(`Pushed ${BUTTERFLY.GUN_PUSHES} times: you got a gun! Press ${GUN_KEY} to shoot`);
    }
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
   * The waiting room: room code, who is here, Start (host only) which opens the map vote, invite link and Leave.
   * Everyone who joined with a name is ready; the vote's winning theme is raced.
   */
  function showLobby(session: NetSession) {
    lobby?.dispose();
    const slotEl = ui.getSlot('lobby');
    // The host presses Start, then everyone votes for the map (theme); the winner is raced.
    let vote: { options: string[]; tallies: number[]; endsAt: number } | null = null;
    let myVote = '';
    const themeTitle = (id: string) => THEME_CHOICES.find((t) => t.id === id)?.title ?? id;
    const render = (room: RoomState | null) => {
      if (!room) return;
      const me = session.playerId ?? -1;
      const host = room.hostId === me;
      const voting = room.phase === 'voting' && vote !== null;
      const here = room.players.filter((p) => p.connected);
      const invite: HTMLButtonElement = button(document, 'Copy invite link', '', () => {
        void navigator.clipboard?.writeText(inviteLink(room.code)).then(() => (invite.textContent = 'Link copied'));
      });
      const secs = vote ? Math.max(0, Math.ceil((vote.endsAt - session.serverNow()) / 1000)) : 0;
      const voteList = voting
        ? h(
            document,
            'div',
            { class: 'wr-actions' },
            ...vote!.options.map((id, i) =>
              button(
                document,
                `${themeTitle(id)} (${vote!.tallies[i] ?? 0})${myVote === id ? ' ✓' : ''}`,
                myVote === id ? 'wr-btn-primary' : '',
                () => {
                  myVote = id;
                  session.vote(id);
                  render(session.room);
                },
              ),
            ),
          )
        : null;
      slotEl.replaceChildren(
        h(
          document,
          'div',
          { class: 'wr-card wr-panel' },
          h(document, 'h2', { class: 'wr-panel-title' }, `Room ${room.code}`),
          h(
            document,
            'p',
            null,
            `${here.length} player${here.length === 1 ? '' : 's'} here. Share the code to invite friends.`,
          ),
          h(document, 'ul', { class: 'wr-help-list' }, ...here.map((p) => h(document, 'li', null, p.name))),
          h(
            document,
            'p',
            null,
            voting
              ? `Vote for the map! ${secs}s left`
              : host
                ? 'Press Start when everyone is in, then everyone votes for the map.'
                : 'Waiting for the host to start the map vote.',
          ),
          voteList,
          h(
            document,
            'div',
            { class: 'wr-actions' },
            host && room.phase === 'lobby'
              ? button(document, 'Start', 'wr-btn-primary', () => session.startVote())
              : null,
            invite,
            button(document, 'Leave', 'wr-btn-danger', () => flow.dispatch({ type: 'leave' })),
          ),
        ),
      );
    };
    render(session.room);
    const offs = [
      session.on('room', (r) => {
        if (flow.state.phase === 'lobby') render(r);
      }),
      session.on('voteState', (v) => {
        vote = { options: v.options, tallies: v.tallies, endsAt: v.endsAt };
        if (flow.state.phase === 'lobby') render(session.room);
      }),
      session.on('voteResult', () => {
        vote = null;
        myVote = '';
      }),
    ];
    lobby = { dispose: () => offs.forEach((off) => off()) };
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
        if (p.phase === 'lobby') endPodium(true);
        if (p.phase === 'lobby' && flow.dispatch({ type: 'backToLobby' })) {
          ui.show('lobby');
          showLobby(session);
        }
      }),
      session.on('matchConfig', (cfg: MatchConfig) => {
        matchSize = cfg.players.length;
        names.clear();
        for (const p of cfg.players) names.set(p.id, p.name);
        const me = cfg.players.find((p) => p.id === session.playerId);
        if (me) slot = me.slot;
        if (cfg.courseId !== coursePack.id) console.warn(`room course ${cfg.courseId} differs from ${coursePack.id}`);
        if (!flow.dispatch({ type: 'matchStart' })) return;
        hideLobby();
        // Preload the room's theme and every skin; the race waits only for the blocking part.
        void preloadMatch(assetStore, cfg, session.playerId ?? -1).then((m) => {
          if (net !== session) return;
          if (m.theme && m.theme.id !== themePack.id) {
            buildWorld(m.theme);
            course.stepColliders(t);
          }
          matchSkins = m.skins;
          const me = m.skins.get(session.playerId ?? -1);
          if (me && me.id !== skinPack.id) {
            scene.remove(wobbler.object3d);
            wobbler.dispose();
            wobbler = createRacerWobbler(racerParam ? { name: racerParam } : me.data);
            wobbler.setGun(shots > 0);
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
        if (m.id === session.playerId) {
          ui.hud.setPlace(m.place, matchSize);
          ui.show('finish', { kind: 'finished', timeMs: m.timeMs });
        } else ui.hud.toast(`${names.get(m.id) ?? 'Someone'} finished ${m.place}`);
      }),
      session.on('raceEnd', ({ results }) => {
        flow.dispatch({ type: 'finish' });
        villain?.reset();
        heroBridge.close();
        markers.reset();
        knockFx.reset();
        player.setWindShelter(null);
        ui.hide('finish');
        const rows: ResultRow[] = results
          .map((r) => ({
            id: r.id,
            name: names.get(r.id) ?? `Player ${r.id}`,
            place: r.place,
            timeMs: r.timeMs,
          }))
          .sort((a, b) => a.place - b.place);
        // Butterfly effect (#84): the server's per-player numbers become your line, the lobby line and titles.
        const stats = new Map(results.map((r) => [r.id, r]));
        const butterfly = summarize(
          rows.map((r) => ({ ...stats.get(r.id), id: r.id, name: r.name, timeMs: r.timeMs })),
          session.playerId ?? undefined,
          { storm: stormLevel, stormMax: BUTTERFLY.STORM_MAX, throwsAtMe, hitsOnMe, heroBridge: heroHelped },
        );
        const showResults = () => ui.show('results', { rows, localId: session.playerId ?? undefined, butterfly });
        // The final podium first: the top three on their blocks, then the full results.
        startPodium(podiumPlacement(results, podiumSpots), session.playerId ?? -1, showResults);
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
          player.applyImpulse([m.dir[0] * PUSH_FEEL.speed, PUSH_FEEL.hop, m.dir[1] * PUSH_FEEL.speed]);
          player.knockDown(PUSH_FEEL.downMs); // on the floor until someone helps you up, or 4 s
          fx.stars(player.state.pos);
          fx.shake(0.8);
          audio.play('push');
          ui.hud.toast(`👊 ${names.get(m.by) ?? 'Someone'} knocked you down! Wait for a friend to help you up`);
        } else if (m.kind === 'save') {
          // pulled back up next to the grabber
          player.respawn({ pos: m.pos, yaw: player.state.yaw });
          copy(player.state.pos, prev);
          copy(player.state.pos, curr);
          ui.hud.toast(`${names.get(m.by) ?? 'Someone'} saved you!`);
        } else {
          player.getUp(); // a help-up: stand at once
          audio.play('helpUp');
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
      session.on('gun', (m) => {
        const earned = m.shots > shots && m.shots === BUTTERFLY.GUN_SHOTS;
        setShots(m.shots);
        if (earned) ui.hud.toast(`Pushed ${BUTTERFLY.GUN_PUSHES} times: you got a gun! Press ${GUN_KEY} to shoot`);
      }),
      session.on('fade', (m) => fade.set(m.id, m.at / 1000)),
      session.on('shot', (m) => {
        const me = session.playerId;
        const name = (id: number) => names.get(id) ?? 'Someone';
        if (m.target === me) {
          const from = remote?.get(m.by)?.pos;
          if (from) {
            copy(from, shooterAt);
            tracer.fire(shooterAt, player.state.pos, performance.now());
          }
          // knocked flat, then back to the last checkpoint (the same respawn as after a fall)
          getShot(remote?.get(m.by)?.pos);
          ui.hud.toast(`${name(m.by)} shot you! Back to your checkpoint`);
        } else if (m.by === me) {
          ui.hud.toast(`You shot ${name(m.target)}!`, true);
        } else {
          const a = remote?.get(m.by)?.pos;
          const b = remote?.get(m.target)?.pos;
          if (a && b) tracer.fire(a, b, performance.now());
        }
      }),
      session.on('hit', (m) => {
        hitsOnMe++;
        // Only a marked player is ever told this. A big blast away from the impact, biased back down
        // the course (+Z, the course runs toward -Z) so every hit costs real ground.
        player.applyImpulse([m.dir[0] * PUSH_SPEED * 1.8, 6.5, m.dir[1] * PUSH_SPEED * 1.8 + PUSH_SPEED * 1.6]);
        player.knockDown();
        ui.hud.flash();
        ui.hud.toast('The villain got you!');
        audio.play('hit');
      }),
      session.on('marked', (m) => {
        markers.burst(m.id, m.by); // bursts out of the player who fell and flies to the pusher
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
    endPodium(true);
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
      // solo fading tiles: you and every bot start a tile's countdown by stepping on it
      if (phase === 'race' && fadeTiles.length > 0) {
        const mine = boostTileAt(fadeTiles, player.state.pos[0], player.state.pos[1], player.state.pos[2]);
        if (mine) fade.trigger(mine.id, t);
        for (const b of bots.remote.values()) {
          const tile = boostTileAt(fadeTiles, b.pos[0], b.pos[1], b.pos[2]);
          if (tile) fade.trigger(tile.id, t);
        }
      }
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
          // feedback for the one who acted: a thump and a short note
          const who = net ? (names.get(target.id) ?? 'Someone') : 'a bot';
          if (target.kind === 'push') {
            audio.play('push');
            fx.shake(0.4);
            ui.hud.toast(`👊 You knocked ${who} down!`, true);
          } else {
            audio.play(target.kind === 'save' ? 'save' : 'helpUp');
            ui.hud.toast(target.kind === 'save' ? `✋ You saved ${who}!` : `🤝 You helped ${who} up!`, true);
          }
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
    if (shotRespawnAt >= 0 && performance.now() >= shotRespawnAt) {
      shotRespawnAt = -1;
      if (!player.state.finished) place(course.respawnPoint(player.state.checkpoint, slot, point));
    }
    copy(curr, prev);
    player.step(control, autopilot ? 0 : camera.yaw, dt, t);
    copy(player.state.pos, curr);
    if (net && (phase === 'race' || phase === 'finished')) net.sendState(player.state);
  });

  // ---- render
  let fxTimer = 0;
  let fxRun = false;
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
    podium.update(frameDt); // aims the camera at the podium while it is up
    themeV2?.update(frameDt, engine.camera);
    if (net) villain?.update(net.serverNow(), frameDt);
    heroBridge.update(performance.now());
    // Wind you can see: the streaks follow the fans' cycle (the same race time as the push); the arrow shows only
    // while you are really being pushed, not when the hero's bridge shelters you.
    windFx.update(t, paused ? 0 : frameDt);
    if (windZones.length > 0) {
      const pushed =
        phase === 'race' &&
        !paused &&
        !player.state.finished &&
        windAt(windZones, drawn, t, windVec) > 0 &&
        !(heroHelped && Math.abs(drawn[0]) <= BRIDGE_HALF_WIDTH);
      ui.hud.setWind(pushed ? windOnScreen(windVec[0], windVec[2], camera.yaw, windScreen).angle : null);
    }
    tracer.update(performance.now());
    if (crowd) {
      if (net) remote = net.sampleRemote();
      if (remote) crowd.update(remote, engine.camera.position, frameDt);
    }
    if (!paused) {
      // running dust and dive streaks, a few times a second
      fxTimer -= frameDt;
      if (fxTimer <= 0) {
        fxTimer = 0.12;
        if (s.anim === Anim.DIVE) fx.speedLines(drawn, s.vel);
        else if (s.grounded && s.anim === Anim.RUN && pose.speed > 5 && (fxRun = !fxRun)) fx.dust(drawn, 0.25);
      }
      if (remote) fx.watchRemote(remote, engine.camera.position);
    }
    fx.update(paused ? 0 : frameDt, engine.camera);
    // Marker butterflies are no longer drawn (the blue ones never went away); marks are still tracked.
    // POW! and dizzy stars over anyone knocked down, so pushes read from across the course
    knockFx.update(performance.now() / 1000, remote, drawn, s.anim);
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
    startOnline(loadName(store) || 'Flutty', invited);
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
      windFx.dispose();
      tracer.dispose();
      setFadeSource(null);
      markers.dispose();
      knockFx.dispose();
      input.dispose();
      wobbler.dispose();
      endPodium(true);
      podium.dispose();
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
