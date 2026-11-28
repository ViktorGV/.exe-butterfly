// Shared constants. Contract owned by #2: change only through a `contract-change` PR.
// Units: metres, seconds, radians. Y up, the course runs toward -Z, yaw 0 faces -Z.

export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS_PER_ROOM = 300;
export const SIM_HZ = 60; // client fixed step
export const NET_SEND_HZ = 15; // client -> server STATE
export const SNAPSHOT_HZ = 15; // server -> client SNAPSHOT
export const INTERP_DELAY_MS = 150;
export const POS_SCALE = 50; // int16 quantisation = 2 cm, range +-655 m
export const NEAR_SET_SIZE = 64; // full-rate neighbours per client

export const PLAYER = Object.freeze({
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
});

export const LIMITS = Object.freeze({
  maxGap: 4.0,
  maxStepUp: 1.2,
  minLaneWidth: 1.2,
  maxCourseLength: 480,
  maxEntities: 400,
  nameMax: 16,
  promptMax: 200,
  packMaxBytes: 8192,
  /** ThemeDef v2 JSON (images are separate files, see THEME_IMAGE_LIMITS). #54 */
  themePackMaxBytes: 49152,
});

/** Image budgets per event theme (#54). Pixel sizes are maxima; `@0.5x` variants are half of each side. */
export const THEME_IMAGE_LIMITS = Object.freeze({
  totalBytes: 8 * 1024 * 1024,
  skybox: [4096, 2048],
  texture: [1024, 1024],
  sprite: [512, 512],
  signage: [1024, 512],
  card: [1024, 576],
} as const);

/** Theme vote in event mode (#54). */
export const VOTE = Object.freeze({ durationSec: 20, stateHz: 4, options: 5 });

export const GROUND_KINDS = Object.freeze(['void', 'water', 'lava', 'clouds', 'goo', 'sand', 'ice'] as const);
export const PARTICLE_KINDS = Object.freeze([
  'snow',
  'rain',
  'embers',
  'bubbles',
  'leaves',
  'petals',
  'sparkles',
  'dust',
  'ash',
] as const);
export const LANDMARK_ANCHORS = Object.freeze(['start', 'finish', 'skylineLeft', 'skylineRight', 'midway'] as const);
export const SIGNAGE_SLOTS = Object.freeze(['startArch', 'checkpoint', 'finishGate', 'sideBanner'] as const);
export const HUD_FONTS = Object.freeze(['rounded', 'blocky', 'handwritten', 'pixel', 'serif'] as const);
export const MUSIC_INSTRUMENTS = Object.freeze([
  'chiptune',
  'marimba',
  'synthpop',
  'brass',
  'strings',
  'steelpan',
  'organ',
  'lofi',
] as const);
export const SKIN_EYES = Object.freeze(['dot', 'oval', 'sleepy', 'star', 'wide'] as const);
export const SKIN_MOUTHS = Object.freeze(['smile', 'o', 'flat', 'grin', 'none'] as const);
export const ACCESSORY_ANCHORS = Object.freeze(['headTop', 'face', 'back', 'waist'] as const);

/** Animation states. Values are part of the wire format (low 4 bits of animFlags). */
export const Anim = Object.freeze({
  IDLE: 0,
  RUN: 1,
  JUMP: 2,
  FALL: 3,
  DIVE: 4,
  PRONE: 5,
  STUMBLE: 6,
  CELEBRATE: 7,
  /** reaching out to grab someone (#84) */
  GRAB: 8,
  /** lying on the back after a hard hit, e.g. a villain throw (#84) */
  KNOCKED: 9,
  /** standing back up after KNOCKED, or at once after a help-up (#84) */
  GETUP: 10,
} as const);

/** What a grab does, decided by the situation of the target (#84). */
export const GRAB_KINDS = Object.freeze(['push', 'save', 'helpUp'] as const);

/** Butterfly effect numbers (#84). Starting values; they are meant to be tuned in playtests. */
export const BUTTERFLY = Object.freeze({
  /** pushes that mark a player (any accepted push, whether or not the target falls) */
  MARK_PUSHES: 2,
  /** the storm level never goes above this */
  STORM_MAX: 20,
  PUSH_FALL_WINDOW_MS: 3000,
  /** a falling player can be saved for this long after leaving the edge */
  SAVE_WINDOW_MS: 1000,
  GRAB_REACH_M: 2.5,
  GRAB_COOLDOWN_MS: 1000,
  /** the reach / push arm animation after pressing Grab */
  GRAB_ANIM_MS: 400,
  /** a push on open floor only makes the target stumble this long */
  STUMBLE_MS: 1000,
  /** a hard hit (a villain throw) knocks the player down this long, then they get up */
  KNOCKED_MS: 1200,
  /** the get-up animation, after KNOCKED or straight away after a help-up */
  GETUP_MS: 500,
  /** the red target circle shows this long before a villain throw lands */
  THROW_WARN_MS: 1000,
  /** the villain throws at a marked player this often: calm storm vs full storm */
  THROW_EVERY_CALM_MS: 6000,
  THROW_EVERY_FULL_MS: 2000,
  /** a thrown obstacle hits a marked player standing within this distance (xz, metres) of its impact point when it lands */
  THROW_RADIUS_M: 2,
} as const);

export const MATERIAL_SLOTS = Object.freeze([
  'platformA',
  'platformB',
  'hazard',
  'bouncy',
  'accent',
  'rail',
  'finish',
] as const);

export const SEGMENT_TYPES = Object.freeze([
  'plainRun',
  'sweeperRun',
  'movingPlatforms',
  'bumperField',
  'narrowBridges',
  'rampClimb',
  'spinnerDiscs',
  'pendulumAlley',
  'gateDash',
  'bouncePads',
  'slidingWalls',
  'snowBlowerField',
  'carousels',
  'arrowFloor',
] as const);

export const OBSTACLE_KINDS = Object.freeze([
  'platform',
  'ramp',
  'sweeper',
  'movingPlatform',
  'bumper',
  'bridge',
  'spinnerDisc',
  'pendulum',
  'gate',
  'wall',
  'bouncePad',
  'slidingWall',
  'snowBlower',
  'carousel',
  'arrowTile',
] as const);

export const PACK_KINDS = Object.freeze(['skin', 'theme', 'course'] as const);

/** `voting` only happens in event mode (#54): lobby -> voting -> loading. */
export const ROOM_PHASES = Object.freeze(['lobby', 'voting', 'loading', 'countdown', 'race', 'results'] as const);

/**
 * Binary wire layout (little-endian). Byte-level tables live in docs/CONTRACTS.md.
 * The codec itself is owned by #17 (packages/shared/src/protocol/).
 */
export const WIRE = Object.freeze({
  MSG_STATE: 0x01,
  MSG_SNAPSHOT: 0x02,
  STATE_BYTES: 15,
  SNAPSHOT_HEADER_BYTES: 7,
  SNAPSHOT_RECORD_BYTES: 10,
  CONTROL_MAX_BYTES: 4096,
  ANIM_MASK: 0x0f,
  FLAG_GROUNDED: 1 << 4,
  FLAG_FINISHED: 1 << 5,
  FLAG_RESPAWNED: 1 << 6,
});
