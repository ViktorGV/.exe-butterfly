// Type contracts. Contract owned by #2: change only through a `contract-change` PR.
// Data types are inferred from the Zod schemas so the two can never drift apart.
//
// Conventions: metres, seconds, radians. Y up. The course runs toward -Z. Yaw 0 faces -Z,
// positive yaw turns left (counter-clockwise seen from above). A player position is the
// capsule's bottom centre (feet). `t` is race time in seconds (negative during the countdown).
import type { z } from 'zod';
import type { Anim, GRAB_KINDS, GUN_KINDS } from './constants.ts';
import type { PackIdSchema } from './schemas/common.ts';
import type {
  CheckpointDefSchema,
  CourseDefSchema,
  CourseRecipeSchema,
  EntityDefSchema,
  MaterialSlotSchema,
  PartDefSchema,
  SegmentTypeSchema,
  ShapeSchema,
  SpawnGridSchema,
  SurfaceSchema,
  VolumeSchema,
} from './schemas/course.ts';
import type {
  CastMemberSchema,
  CostumeKitSchema,
  DecorV2Schema,
  DressingSchema,
  ImageRefSchema,
  LandmarkSchema,
  MaterialDefSchema,
  PackKindSchema,
  PackSchema,
  ParticlesSchema,
  PatternSchema,
  PrimSchema,
  SignageSchema,
  SkinDefSchema,
  ThemeDefSchema,
  ThemeDefV1Schema,
  ThemeDefV2Schema,
  TileShapeSchema,
} from './schemas/packs.ts';
import type { EventManifestSchema, EventRosterSchema } from './schemas/event.ts';
import type {
  ClientMessageSchema,
  MatchConfigMsg,
  RoomPlayerSchema,
  RoomStateSchema,
  ServerMessageSchema,
  VoteResultMsg,
  VoteStateMsg,
} from './schemas/protocol.ts';

// ---- primitives -----------------------------------------------------------

export type Vec3 = [number, number, number];
/** x, y, z, w */
export type Quat = [number, number, number, number];
/** "#rrggbb" */
export type Hex = string;
export type PackId = z.infer<typeof PackIdSchema>;

// ---- gameplay -------------------------------------------------------------

export interface InputState {
  /** -1..1, camera-relative, right positive */
  moveX: number;
  /** -1..1, camera-relative, forward positive */
  moveY: number;
  jump: boolean;
  /** true for exactly one sample() after the press */
  jumpPressed: boolean;
  dive: boolean;
  /** true for exactly one sample() after the press */
  divePressed: boolean;
  /** Butterfly effect (#84): the Grab button. Absent means false, so older code keeps working. */
  grab?: boolean;
  /** true for exactly one sample() after the press */
  grabPressed?: boolean;
}

/** What a grab does (#84). */
export type GrabKind = (typeof GRAB_KINDS)[number];

/** A gun kind (#210). */
export type GunKind = (typeof GUN_KINDS)[number];

export type AnimValue = (typeof Anim)[keyof typeof Anim];

export interface PlayerState {
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  anim: AnimValue;
  grounded: boolean;
  /** index of the latest checkpoint reached, -1 before the first */
  checkpoint: number;
  finished: boolean;
}

export interface RemoteState {
  pos: Vec3;
  yaw: number;
  anim: AnimValue;
  /** WIRE.FLAG_* bits */
  flags: number;
}

// ---- course ---------------------------------------------------------------

export type Shape = z.infer<typeof ShapeSchema>;
export type Surface = z.infer<typeof SurfaceSchema>;
export type MaterialSlot = z.infer<typeof MaterialSlotSchema>;
export type PartDef = z.infer<typeof PartDefSchema>;
export interface Pose {
  pos: Vec3;
  quat: Quat;
}
export type EntityDef = z.infer<typeof EntityDefSchema>;
export type SpawnGrid = z.infer<typeof SpawnGridSchema>;
export type Volume = z.infer<typeof VolumeSchema>;
export type CheckpointDef = z.infer<typeof CheckpointDefSchema>;
export type CourseDef = z.infer<typeof CourseDefSchema>;
export type SegmentType = z.infer<typeof SegmentTypeSchema>;
export type CourseRecipe = z.infer<typeof CourseRecipeSchema>;

/**
 * An obstacle kind. Every kind is a pure function of race time, so obstacles are never sent
 * over the network. Implementations live in course/obstacles/ (#14).
 */
export interface ObstacleKind {
  kind: string;
  /** applies defaults and clamps */
  paramsSchema: z.ZodType;
  /** static, called once */
  parts(def: EntityDef): PartDef[];
  /** world pose of every part at time t. PURE, valid for any real t, allocates nothing. */
  pose(def: EntityDef, t: number, out: Pose[]): void;
}

export interface Collider {
  entityId: number;
  part: PartDef;
  pose: Pose;
  /** physics derives surface velocity from prevPose -> pose */
  prevPose: Pose;
}

// ---- asset packs ----------------------------------------------------------

export type Pattern = z.infer<typeof PatternSchema>;
export type TileShape = z.infer<typeof TileShapeSchema>;
export type Prim = z.infer<typeof PrimSchema>;
export type SkinDef = z.infer<typeof SkinDefSchema>;
export type MaterialDef = z.infer<typeof MaterialDefSchema>;
/** Any theme version. sanitizePack always returns ThemeDefV2. */
export type ThemeDef = z.infer<typeof ThemeDefSchema>;
export type ThemeDefV1 = z.infer<typeof ThemeDefV1Schema>;
export type ThemeDefV2 = z.infer<typeof ThemeDefV2Schema>;
export type ImageRef = z.infer<typeof ImageRefSchema>;
export type Particles = z.infer<typeof ParticlesSchema>;
export type Dressing = z.infer<typeof DressingSchema>;
export type Landmark = z.infer<typeof LandmarkSchema>;
export type DecorV2 = z.infer<typeof DecorV2Schema>;
export type Signage = z.infer<typeof SignageSchema>;
export type CostumeKit = z.infer<typeof CostumeKitSchema>;
export type CastMember = z.infer<typeof CastMemberSchema>;
export type PackKind = z.infer<typeof PackKindSchema>;
export type Pack = z.infer<typeof PackSchema>;
export type PackData = SkinDef | ThemeDef | CourseRecipe;

export type SanitizeResult<T = PackData> =
  | { ok: true; data: T; issues: string[] }
  /** ok is false only when the input is unrecoverable */
  | { ok: false; data: null; issues: string[] };

export interface LintResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// ---- wire protocol --------------------------------------------------------

export type RoomState = z.infer<typeof RoomStateSchema>;
export type RoomPlayer = z.infer<typeof RoomPlayerSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type MatchConfig = z.infer<typeof MatchConfigMsg>;
export type VoteState = z.infer<typeof VoteStateMsg>;
export type VoteResult = z.infer<typeof VoteResultMsg>;

// ---- event mode (#54) -------------------------------------------------------

export type EventManifest = z.infer<typeof EventManifestSchema>;
export type EventRoster = z.infer<typeof EventRosterSchema>;

export interface EventIdentity {
  matched: boolean;
  /** themeId -> skin id, only for matched players */
  previewSkins: Record<string, string> | null;
}

/** apps/server/src/event (seam seeded by #54, real implementation #68). */
export interface EventDirector {
  /** false when event mode is off: the room then behaves as before */
  enabled: boolean;
  identify(name: string): Promise<EventIdentity>;
  /** the 5 theme ids from the manifest, in manifest order */
  voteOptions(): string[];
  /** called when the vote ends, before matchConfig; every player gets a distinct-looking skin */
  assignSkins(players: { id: number; name: string; matched: boolean }[], themeId: string): Promise<Map<number, string>>;
}

// ---- server ---------------------------------------------------------------

export interface RaceEvent {
  /** checkpoint | finished | kick | raceEnd */
  type: string;
  [key: string]: unknown;
}

export interface RaceSessionOptions {
  course: CourseDef;
  players: { id: number; slot: number }[];
  config: { qualifyCount: number; timeLimitMs: number };
  send(playerId: number, data: string | Uint8Array): void;
  onEvent(evt: RaceEvent): void;
}

export interface RaceResult {
  id: number;
  place: number;
  timeMs: number | null;
  checkpoint: number;
}

/** A decoded client STATE frame as handed to the race session. */
export interface IncomingState extends PlayerState {
  seq: number;
  raceTimeMs: number;
  respawned?: boolean;
}

/** Created only through createRaceSession() in apps/server/src/race/index.ts (#19). */
export interface RaceSession {
  start(startAtMs: number): void;
  handleState(playerId: number, state: IncomingState): void;
  setConnected(playerId: number, connected: boolean): void;
  tick(nowMs: number): void;
  readonly finished: boolean;
  results(): RaceResult[];
}

// ---- API ------------------------------------------------------------------

/** Pack storage, behind getPackStore() in apps/web/api/_lib/store (#23). */
export interface PackStore {
  put(pack: Pack): Promise<void>;
  get(id: string): Promise<Pack | null>;
  list(q: { kind: PackKind; cursor?: string | null; limit?: number }): Promise<{
    items: Pack[];
    nextCursor: string | null;
  }>;
  findByPromptHash(kind: PackKind, hash: string): Promise<Pack | null>;
  flag(id: string): Promise<void>;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
}
