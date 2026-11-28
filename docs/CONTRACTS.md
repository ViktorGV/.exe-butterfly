# Contracts

These contracts let the wave-1 issues (#3 to #25) be built in parallel. The code is the source of truth:

| What        | Where                                                                             |
| ----------- | --------------------------------------------------------------------------------- |
| Constants   | `packages/shared/src/constants.ts`                                                |
| Types       | `packages/shared/src/types.ts` (data types are `z.infer` of the schemas)          |
| Zod schemas | `packages/shared/src/schemas/` (`course.ts`, `packs.ts`, `protocol.ts`, `api.ts`) |
| Fixtures    | `packages/shared/src/fixtures/index.ts`                                           |
| Seams       | see [Seams](#seams)                                                               |

To change anything here, open a small separate PR labelled `contract-change` that touches only the contract files, and mention it on #1. See `CONTRIBUTING.md`.

Import from the shared package as `@wobble/shared` or with deep paths such as `@wobble/shared/constants`, `@wobble/shared/types`, `@wobble/shared/schemas/protocol`.

## 1. Conventions

- Units: metres, seconds, radians.
- Y is up. The course runs toward **−Z**.
- Yaw 0 faces −Z; positive yaw turns left (counter-clockwise seen from above).
- A player position is the capsule's bottom centre (feet).
- `t` is race time in seconds, negative during the countdown.
- Colours are `#rrggbb` strings.
- Pack ids: `b:<slug>` is built in (bundled in `packages/shared`, resolved offline by `resolveBuiltin`); `g:<id>` is generated (fetched from the API); `e:<slug>` is an event pack (static file under `/event/packs/<kind>/<slug>.json`); `r:<themeSlug>:<seed>` is a procedural themed skin rebuilt locally with `randomThemedSkin` (see §9).

## 2. Constants

```ts
PROTOCOL_VERSION = 1;
MAX_PLAYERS_PER_ROOM = 300;
SIM_HZ = 60; // client fixed step
NET_SEND_HZ = 15; // client -> server STATE
SNAPSHOT_HZ = 15; // server -> client SNAPSHOT
INTERP_DELAY_MS = 150;
POS_SCALE = 50; // int16 quantisation = 2 cm, range ±655 m
NEAR_SET_SIZE = 64; // full-rate neighbours per client

PLAYER = {
  radius: 0.45,
  height: 1.3,
  runSpeed: 7.5,
  accelGround: 60,
  accelAir: 20,
  friction: 40,
  jumpVelocity: 9.5,
  gravity: -26,
  maxFallSpeed: -40,
  diveSpeed: 12,
  diveUp: 3,
  diveMs: 450,
  proneMs: 550,
  diveCooldownMs: 900,
  coyoteMs: 100,
  jumpBufferMs: 120,
  stumbleMs: 600,
};
LIMITS = {
  maxGap: 4.0,
  maxStepUp: 1.2,
  minLaneWidth: 1.2,
  maxCourseLength: 400,
  maxEntities: 400,
  nameMax: 16,
  promptMax: 200,
  packMaxBytes: 8192,
};
Anim = {
  IDLE: 0,
  RUN: 1,
  JUMP: 2,
  FALL: 3,
  DIVE: 4,
  PRONE: 5,
  STUMBLE: 6,
  CELEBRATE: 7,
  GRAB: 8,
  KNOCKED: 9,
  GETUP: 10,
};
BUTTERFLY = {
  MARK_PUSHES: 2,
  STORM_MAX: 20,
  PUSH_FALL_WINDOW_MS: 3000,
  SAVE_WINDOW_MS: 1000,
  GRAB_REACH_M: 1.5,
  GRAB_COOLDOWN_MS: 1000,
  GRAB_ANIM_MS: 400,
  STUMBLE_MS: 1000,
  KNOCKED_MS: 1200,
  GETUP_MS: 500,
  THROW_WARN_MS: 1000,
  THROW_EVERY_CALM_MS: 6000,
  THROW_EVERY_FULL_MS: 2000,
  THROW_RADIUS_M: 2,
}; // #84
GRAB_KINDS = ['push', 'save', 'helpUp'];
```

`MATERIAL_SLOTS`, `SEGMENT_TYPES`, `OBSTACLE_KINDS`, `PACK_KINDS`, `ROOM_PHASES` and `WIRE` are also exported.

## 3. Gameplay types

```ts
interface InputState {
  moveX: number;
  moveY: number; // -1..1, camera-relative, right/forward positive
  jump: boolean;
  jumpPressed: boolean;
  dive: boolean;
  divePressed: boolean;
  grab?: boolean; // butterfly effect (#84); absent = false
  grabPressed?: boolean;
} // *Pressed = true for one sample()
interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  anim: AnimValue;
  grounded: boolean;
  checkpoint: number;
  finished: boolean;
}
interface RemoteState {
  pos: Vec3;
  yaw: number;
  anim: AnimValue;
  flags: number;
}
```

`checkpoint` is the index of the latest checkpoint reached, `-1` before the first.

## 4. Course

```ts
type Shape = 'box' | 'cylinder' | 'sphere';
type Surface = 'solid' | 'bouncy' | 'slippery';
type MaterialSlot = 'platformA' | 'platformB' | 'hazard' | 'bouncy' | 'accent' | 'rail' | 'finish';
interface PartDef {
  shape;
  size: Vec3;
  surface;
  bounce?: number;
  pad?: boolean; // bounce pad (#110): bouncy only from above, along the part's up axis, keeps sideways speed, no stumble
  slot;
  collide: boolean;
  visible: boolean;
}
//   size: box = half extents · cylinder = [radius, halfHeight, 0], axis = local Y · sphere = [radius, 0, 0]
interface Pose {
  pos: Vec3;
  quat: Quat;
} // quat = [x, y, z, w]
interface EntityDef {
  id: number;
  kind: string;
  pos: Vec3;
  yaw: number;
  params: Record<string, unknown>;
}
interface ObstacleKind {
  kind;
  paramsSchema; // Zod schema with defaults and clamps
  parts(def): PartDef[]; // static, called once
  pose(def, t, out: Pose[]): void;
} // world pose of every part at time t. PURE, any real t, no allocation
interface Collider {
  entityId;
  part: PartDef;
  pose: Pose;
  prevPose: Pose;
} // physics derives surface velocity from the pose delta
interface SpawnGrid {
  pos: Vec3;
  yaw: number;
  cols: number;
  spacing: number;
}
interface Volume {
  pos: Vec3;
  yaw: number;
  half: Vec3;
} // oriented trigger box
interface CheckpointDef {
  volume: Volume;
  respawn: SpawnGrid;
}
interface CourseDef {
  version: 1;
  id;
  name;
  spawn: SpawnGrid;
  checkpoints: CheckpointDef[];
  finish: Volume;
  killY: number;
  bounds: { min: Vec3; max: Vec3 };
  entities: EntityDef[];
  parTimeMs: number;
  timeLimitMs: number;
}
interface CourseRecipe {
  version: 1;
  name: string;
  seed: number; // what the LLM writes; assembleCourse(recipe) -> CourseDef
  segments: { type: SegmentType; length: 'short' | 'medium' | 'long'; intensity: 1 | 2 | 3 | 4 | 5 }[];
} // 4..12
```

**Spawn grids.** Slot `n` maps to row `floor(n / cols)` and column `n % cols`. Columns are centred on `pos` across the row; row 0 sits at `pos` and further rows extend backwards (toward local +Z, behind the facing direction), `spacing` metres apart.

### Obstacle params v1

Names and defaults are frozen so the obstacle issue (#14) and the assembler issue (#15) can proceed in parallel. `pos` is the centre of the **top surface** for `platform`, `bridge`, `movingPlatform`, `spinnerDisc` and `bouncePad`, and the base centre on the ground for the rest.

| kind             | params (defaults)                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform`       | `size: [w, h, d]` (full size), `slot`                                                                                                             |
| `ramp`           | `size: [w, h, d]`, `pitch` (rad, positive rises toward −Z), `slot`                                                                                |
| `sweeper`        | `arms: 2`, `armLength: 6`, `barRadius: 0.35`, `barHeight: 0.6`, `rpm: 12`, `phase: 0`, `dir: 1`                                                   |
| `movingPlatform` | `size: [4, 0.5, 4]`, `travel: [x, y, z]`, `periodSec: 4`, `phase: 0`, `ease: 'sine'`                                                              |
| `bumper`         | `radius: 0.9`, `height: 1.2`, `bounce: 14`                                                                                                        |
| `bridge`         | `length: 12`, `width: 1.6`, `thickness: 0.4`                                                                                                      |
| `spinnerDisc`    | `radius: 4`, `thickness: 0.5`, `rpm: 8`, `dir: 1`                                                                                                 |
| `pendulum`       | `pivotHeight: 7`, `length: 5.5`, `ballRadius: 1.1`, `periodSec: 3`, `phase: 0`, `amplitude: 1.1`, `bounce: 12`                                    |
| `gate`           | `width: 10`, `height: 5`, `doors: 0`, `periodSec: 3`                                                                                              |
| `wall`           | `size: [w, h, d]`                                                                                                                                 |
| `bouncePad`      | `size: [3.4, 0.4, 1.6]`, `bounce: 13`, `tilt: 0.12` (rad, tips the launch toward −Z) (#110)                                                       |
| `slidingWall`    | `width: 15`, `height: 2.5`, `thickness: 0.6`, `panels: 2`, `periodSec: 4`, `phase: 0` (#110)                                                      |
| `snowBlower`     | `reach: 20`, `width: 6`, `height: 3`, `windSpeed: 3`, `onSec: 3`, `offSec: 2`, `warnSec: 0.5`, `phase: 0` (seconds); blows toward local +X (#110) |

Only `platform` exists today (`packages/shared/src/course/obstacles/platform.ts`); #14 adds the rest.

Event course (#110): segment types `bouncePads`, `slidingWalls` and `snowBlowerField` build on these kinds. Snow blower wind is applied by the local player controller only (`createPlayerController` reads `course.entities`); the server's speed limits allow for bounce-pad launches and wind.

## 5. Asset packs

```ts
type Pattern = {
  type: 'none' | 'stripes' | 'dots' | 'checker' | 'zigzag' | 'waves' | 'custom';
  colors: Hex[];
  scale: number;
  tile?: TileShape[];
};
type TileShape = {
  kind: 'circle' | 'rect' | 'poly';
  fill: Hex;
  x: number;
  y: number; // unit square 0..1, at most 24 shapes
  r?: number;
  w?: number;
  h?: number;
  rot?: number;
  points?: [number, number][];
};
interface Prim {
  shape: 'sphere' | 'box' | 'cylinder' | 'cone' | 'torus' | 'capsule';
  pos: Vec3;
  rot: Vec3;
  scale: Vec3;
  color: Hex;
  emissive?: Hex;
}
interface SkinDef {
  version: 1;
  name: string;
  body: { color; belly; pattern: Pattern; height: number; girth: number }; // 0.85..1.15, cosmetic only; the collider never changes
  face: {
    eyes: 'dot' | 'oval' | 'sleepy' | 'star' | 'wide';
    eyeColor;
    mouth: 'smile' | 'o' | 'flat' | 'grin' | 'none';
    cheeks: Hex | null;
  };
  limbs: { color: Hex };
  accessories: { anchor: 'headTop' | 'face' | 'back' | 'waist'; prims: Prim[] }[];
} // at most 5, 40 prims in total (was 3 / 24 before event characters)
interface MaterialDef {
  color;
  roughness;
  metalness;
  emissive?: Hex;
  pattern?: Pattern;
}
interface ThemeDef {
  version: 1;
  name: string;
  sky: { top; horizon; bottom };
  fog: { color; near; far };
  light: { ambient; ambientIntensity; sun; sunIntensity; sunDir: Vec3 };
  materials: Record<MaterialSlot, MaterialDef>;
  decor: { name; prims: Prim[]; density; minScale; maxScale }[]; // at most 6, scattered off-course
  music: { tempo: number; scale: 'major' | 'minor' | 'pentatonic' | 'lydian'; energy: 1 | 2 | 3 };
}
interface Pack {
  id;
  kind: 'skin' | 'theme' | 'course';
  name;
  prompt?;
  createdAt;
  data: SkinDef | ThemeDef | CourseRecipe;
}
```

- No schema may be recursive: LLM structured outputs reject recursive schemas.
- The schemas check shapes, enums and counts, not numeric ranges. `sanitizePack` (#16) clamps every number; never trust a pack that has not been through it.

## 6. Wire protocol

### JSON control frames

Text frames `{ t, ...payload }`, at most 4 KB. Schemas: `ClientMessageSchema` and `ServerMessageSchema` in `schemas/protocol.ts`. Unknown fields are stripped.

| Direction | Messages                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C→S       | `hello{v,name,clientId,token?,room:'quick'\|'new'\|<CODE>}` · `setSkin{skinId}` · `setReady{ready}` · `setConfig{courseId,themeId}` (host) · `start` (host) · `loaded` · `ping{c}` · `startVote` (host, event mode) · `vote{themeId}` (event mode) · `grab{target,kind:'push'\|'save'\|'helpUp',dir:[x,z]}` (butterfly effect, #84)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| S→C       | `welcome{playerId,token,room:RoomState}` · `roomPatch{joined?,left?,updated?,phase?,hostId?,config?}` · `matchConfig{courseId,themeId,qualifyCount,players:[{id,slot,skinId,name}]}` · `countdown{startAt}` · `pong{c,s}` · `checkpoint{index}` · `correct{pos,checkpoint}` · `finished{id,place,timeMs}` · `raceEnd{results:[{id,place,timeMs\|null,checkpoint}]}` · `error{code,msg}` · `voteState{options,tallies,endsAt}` · `voteResult{themeId,tallies}` · `welcome.event?{matched,previewSkins}` (event mode) · `grabbed{by,kind,dir,pos}` (to the target only) · `marked{id,by}` (`id` is marked at their 2nd push, on `by`, whether or not `by` falls) · `storm{level,max}` (butterfly effect, #84) · `throw{n,target,pos:[x,z],landAt}` (room-wide: the villain throws at a marked player, red circle of `THROW_RADIUS_M` until `landAt`; only marked players are ever the target) · `hit{n,dir:[x,z]}` (to the target only at `landAt`, if still inside the circle; knockback + stumble like a push) · `hero{saves}` (to one player when they reach the last checkpoint with at least 1 save and 0 pushes: the hero opens a wind-sheltered bridge for them across the final section; `saves` = players they helped) · `raceEnd.results[]` may also carry `pushes?,pushFalls?,saves?,marked?` |

```ts
interface RoomState {
  id: string;
  code: string /* 5 capital letters */;
  phase: 'lobby' | 'voting' | 'loading' | 'countdown' | 'race' | 'results'; // 'voting' only in event mode (§9)
  hostId: number;
  config: { courseId: string; themeId: string };
  players: { id: number; name: string; skinId: string; ready: boolean; connected: boolean }[];
}
```

### Binary frames (little-endian)

Quantisation: `pos = round(metres × POS_SCALE)` as int16 · `yaw = round(yaw / 2π × 256) & 255` · `animFlags = anim | grounded<<4 | finished<<5 | respawned<<6`.

**C→S STATE, type `0x01`, 15 bytes**

| Offset | Type | Field         |
| -----: | ---- | ------------- |
|      0 | u8   | type = `0x01` |
|      1 | u16  | seq           |
|      3 | u32  | raceTimeMs    |
|      7 | i16  | x             |
|      9 | i16  | y             |
|     11 | i16  | z             |
|     13 | u8   | yaw           |
|     14 | u8   | animFlags     |

**S→C SNAPSHOT, type `0x02`, 7 + 10 × count bytes**

|  Offset | Type | Field            |
| ------: | ---- | ---------------- |
|       0 | u8   | type = `0x02`    |
|       1 | u32  | serverTimeMs     |
|       5 | u16  | count            |
| 7 + 10n | —    | record n (below) |

| Record offset | Type | Field     |
| ------------: | ---- | --------- |
|             0 | u16  | playerId  |
|             2 | i16  | x         |
|             4 | i16  | y         |
|             6 | i16  | z         |
|             8 | u8   | yaw       |
|             9 | u8   | animFlags |

Sizes and flag bits are also exported as `WIRE` from `constants.ts`. The codec is #17.

## 7. HTTP API (Vercel functions)

```
POST /api/packs/generate   { kind: 'skin', prompt, clientId, themeId? }  -> 200 { id, kind, pack } | 422 { error } | 429 (Retry-After) | 503   (skins only, #54)
GET  /api/packs?kind=&cursor=                          -> { items: [{ id, kind, name, swatch }], nextCursor }
GET  /api/packs/:id                                    -> Pack   (public, immutable)
GET  /api/packs/batch?ids=a,b,c                        -> { packs: Pack[], missing: string[] }   (at most 50 ids)
POST /api/packs/:id/report                             -> 204
GET  /api/health                                       -> { ok, service, protocol }
```

Request and response schemas: `schemas/api.ts`. Handlers use the Web signature (`export async function GET(request: Request): Promise<Response>`); dynamic segments arrive in the query string (`new URL(request.url).searchParams.get('id')`).

## 8. Module interfaces

```ts
// client (apps/web/src)
createEngine({ canvas }) -> { scene, camera, renderer, onFixedUpdate(fn(dt, simTime)), onRender(fn(alpha, frameDt)), start(), stop(), setQuality(preset), dispose() }
createInput({ target, touchRoot }) -> { sample(): InputState, dispose() }
createPlayerController({ getColliders, course }) -> { state: PlayerState, step(input, cameraYaw, dt, t), respawn(point), applyImpulse(v), stumble(ms?), knockDown(), getUp(), grab(dir?), setWindShelter(lane?), on(evt, fn) }
     // events: jump | land | dive | bounce | hit | fell | checkpoint | finish
createFollowCamera(camera) -> { update(targetPos, targetVel, dt), yaw, snapTo(pos, yaw), follow(provider), playIntro(points, ms) }
createCourseRuntime({ courseDef, theme, scene }) -> { stepColliders(t), update(t), getColliders(): Collider[], spawnPoint(slot), respawnPoint(checkpoint, slot), dispose() }
createWobbler(skin) -> { object3d, setPose({ pos, yaw, anim, speed }, dt), dispose() }
getLodGeometry() -> BufferGeometry · skinToInstance(skin) -> { primary, belly, limbs }
createCrowd({ scene, max, wobblerFactory }) -> { setPlayers(list), update(remoteStates, cameraPos, dt), setSkin(id, skin), dispose() }
applyTheme(themeDef, { scene, renderer }) -> { getMaterial(slot), dispose() }
createUI(root) -> { show(screen, props), getSlot(name), hud: { setTime, setCheckpoint, setPlace, setQualified, toast }, on(evt, fn) }
mountLobby(container, { net, assets, previewFactory, minimapFactory }) -> { dispose() }
createAudio() -> { unlock(), play(name, opts), setMusic(musicDef), setVolumes(v), setListener(pos, yaw), dispose() }
createNetClient({ url }) | createOfflineSession(cfg) -> { connect(hello), on(evt, fn), sendState(state), serverNow(), raceTimeSec(),
     sampleRemote(): Map<number, RemoteState>, setSkin(id), setReady(b), setConfig(cfg), start(), sendLoaded(), disconnect() }
createAssetStore({ apiBase }) -> { getPack(id), preloadMatch(matchConfig), list(kind, cursor), generate(kind, prompt), report(id) }

// shared (packages/shared/src)
getObstacleKind(kind): ObstacleKind | null · assembleCourse(recipe): CourseDef · lintCourse(def): LintResult
sanitizePack(kind, data): SanitizeResult · drawPattern(ctx2d, pattern, sizePx) · resolveBuiltin(id): Pack | null

// server (apps/server/src)
createRaceSession({ course, players, config, send(playerId, data), onEvent(evt) }) -> RaceSession
interface RaceSession { start(startAtMs); handleState(playerId, state); setConnected(playerId, bool); tick(nowMs); finished: boolean; results() }

// api (apps/web/api/_lib)
interface PackStore { put(pack); get(id); list({ kind, cursor, limit }); findByPromptHash(kind, hash); flag(id) }
getPackStore(): PackStore · rateLimit(action, { clientId, ip }): Promise<RateLimitResult>
```

Exact TypeScript signatures for the shared, server and API interfaces are in `types.ts`. Client module factories are typed by their owners, matching the shapes above.

## Seams

Each seam is seeded by #2 with a working stub and replaced by its owner. Other modules import only through these paths, so nobody waits and nobody edits a folder they do not own.

| Seam                                                                                                                        | Stub today                                                                                                                                                                                    | Replaced by                          |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `packages/shared/src/builtins.ts` → `resolveBuiltin(id)`                                                                    | Stays owned by #2. Reads `BUILTIN_COURSE_PACKS` (`course/recipes/index.ts`) and `BUILTIN_SKIN_PACKS` / `BUILTIN_THEME_PACKS` (`assets/builtin/index.ts`), which start with just the fixtures. | recipes: #15 · skins and themes: #16 |
| `packages/shared/src/course/assemble/index.ts` → `assembleCourse`; `course/lint.ts` → `lintCourse`                          | returns a copy of `fixtureCourse`; lint always passes                                                                                                                                         | #15                                  |
| `packages/shared/src/assets/index.ts` → `sanitizePack`, `drawPattern`                                                       | strict schema parse only; fills `colors[0]`                                                                                                                                                   | #16                                  |
| `apps/web/src/theme/index.ts` → `applyTheme`                                                                                | flat-colour material per slot, plain sky colour                                                                                                                                               | #10                                  |
| `apps/server/src/race/index.ts` → `createRaceSession`                                                                       | fake session that ends the race after 10 s                                                                                                                                                    | #19                                  |
| `apps/web/api/_lib/store/index.ts` → `getPackStore`; `apps/web/api/_lib/ratelimit.ts` → `rateLimit`                         | in-memory map; allow-all                                                                                                                                                                      | #23                                  |
| `apps/web/api/health.ts`                                                                                                    | returns `{ ok: true }`                                                                                                                                                                        | —                                    |
| `packages/shared/src/event/index.ts` → `normalizeUsername`, `rosterKey` (real, frozen), `skinSignature`, `randomThemedSkin` | signature = FNV-1a of the JSON; random returns `fixtureSkin`                                                                                                                                  | #68                                  |
| `apps/server/src/event/index.ts` → `createEventDirector`                                                                    | event mode off; nobody matches; everyone gets the default skin                                                                                                                                | #68                                  |

## Fixtures

`fixtureSkin`, `fixtureTheme`, `fixtureRecipe`, `fixtureCourse` and their packs (`b:fixture-skin`, `b:fixture-theme`, `b:fixture-course`).

`fixtureCourse` uses only `platform`: a start pad with a 300-slot spawn grid, two platforms, a checkpoint pad with a 300-slot respawn grid, one more platform and a finish pad. Every gap is 2 m.

Event mode (#54): `fixtureThemeV2` (every v2 field, placeholder images in `apps/web/public/event/themes/fixture/`), `fixtureThemeV2Pack` (`e:theme-fixture`), `fixtureManifest` (5 themes), `fixtureRoster` (two entries, one screened out).

## 9. Event mode (#54)

The hackathon flow: contestants submit a username, a game idea and a character idea before the event. An offline pipeline (`tools/event`, #56 / #59 / #63) picks 5 ideas and pregenerates a rich theme for each plus every submitter's character in every theme. On event day there is one course; players vote for the theme, and the server assigns skins (#68).

### ThemeDef v2

`ThemeDefV2Schema` in `schemas/packs.ts`. `ThemeDefSchema` is the union of v1 and v2 (discriminated by `version`); `sanitizePack` (#16) upgrades v1 to v2. Optional parts are `.nullable()` so OpenRouter strict structured outputs can require every key. New fields on top of v1: `title`, `tagline`, `credit`, `sky.image`, `materials[slot].texture`, `ground`, `particles` (≤ 2), `dressing` (≤ 24, one per obstacle part so every part on the map can change; ≤ 16 prims; cosmetic, follows obstacle part `part` of `kind`; `slot` draws the prims with that material slot's texture tinted by prim colour, null = flat colours), `landmarks` (≤ 4), `decor` (≤ 8, `type: 'prims' | 'sprite'`), `signage` (≤ 6), `costume` (palette and accessory kit for characters), `fx`, `hud`, `music.instrument` / `music.swing`, `art` (vote card, reveal, podium) and `cast` (hero and villain, #84; null = generic).

`ImageRef.src` is a bare file name in the theme folder (`^[a-z0-9-]+(@0\.5x)?\.webp$`), never a URL. Limits: `LIMITS.themePackMaxBytes` (JSON) and `THEME_IMAGE_LIMITS` (images).

Fairness rules the sanitizer enforces: dressing stays within the part's bounds + 0.3 m, `hideBase` only when the dressing covers ≥ 80% of the collider, hazard and bouncy dressing keeps its colour distance from platforms, landmarks and decor stay outside the playable bounds.

### Files

```
apps/web/public/event/manifest.json            EventManifest (public)
apps/web/public/event/packs/<kind>/<slug>.json  Pack (e: ids)
apps/web/public/event/themes/<slug>/*.webp      images for that theme
apps/server/event/roster.json                  EventRoster (server only, keyed by rosterKey, no usernames)
```

`rosterKey(secret, name)` = first 32 hex chars of HMAC-SHA256(`EVENT_ROSTER_SECRET`, `normalizeUsername(name)`). Both live in `packages/shared/src/event` and are frozen.

### Vote

Phases: lobby → **voting** → loading → countdown → race → results. `VOTE = { durationSec: 20, stateHz: 4, options: 5 }`. Host sends `startVote` (public rooms start it automatically); players send `vote{themeId}` and may change it; the server broadcasts `voteState` at most 4 times a second and ends with `voteResult`, then `matchConfig` with server-assigned `skinId`s. `setSkin` is ignored in event mode.

### Client interfaces (event mode)

```ts
applyTheme(themeDef, { scene, renderer, course?: { bounds, anchors }, baseUrl }) -> ThemeRuntime
ThemeRuntime { getMaterial(slot), getDressing(kind, partIndex): DressingTemplate | null, fx, hud, ready: Promise<void>, dispose() }
createCourseRuntime(...) also exposes getAnchors(): { start: Pose; finish: Pose; checkpoints: Pose[]; sideBanners: Pose[] }
```

### Server

`EventDirector` (types.ts): `enabled`, `identify(name)`, `voteOptions()`, `assignSkins(players, themeId)`. Seam: `apps/server/src/event/index.ts`.
