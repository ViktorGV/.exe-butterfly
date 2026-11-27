// JSON control-message schemas (text frames, at most 4 KB). Contract owned by #2.
// Binary STATE / SNAPSHOT layouts are in constants.js (WIRE) and docs/CONTRACTS.md.
// parseControl / serializeControl and the binary codec are owned by #17 (src/protocol/).
import { z } from 'zod';
import { LIMITS, ROOM_PHASES, VOTE } from '../constants.ts';
import { PackIdSchema, Vec3Schema } from './common.ts';

const PlayerId = z.number().int().nonnegative().max(65535);
const RoomCode = z.string().regex(/^[A-Z]{5}$/, 'expected a 5-letter room code');

export const RoomConfigSchema = z.object({ courseId: PackIdSchema, themeId: PackIdSchema });

export const RoomPlayerSchema = z.object({
  id: PlayerId,
  name: z.string().min(1).max(LIMITS.nameMax),
  skinId: PackIdSchema,
  ready: z.boolean(),
  connected: z.boolean(),
});

export const RoomStateSchema = z.object({
  id: z.string(),
  code: RoomCode,
  phase: z.enum(ROOM_PHASES),
  hostId: PlayerId,
  config: RoomConfigSchema,
  players: z.array(RoomPlayerSchema).max(300),
});

// ---- client -> server ----------------------------------------------------

export const HelloMsg = z.object({
  t: z.literal('hello'),
  v: z.number().int(),
  name: z.string().min(1).max(LIMITS.nameMax),
  clientId: z.string().min(8).max(64),
  token: z.string().max(128).optional(),
  room: z.union([z.literal('quick'), z.literal('new'), RoomCode]),
});
export const SetSkinMsg = z.object({ t: z.literal('setSkin'), skinId: PackIdSchema });
export const SetReadyMsg = z.object({ t: z.literal('setReady'), ready: z.boolean() });
export const SetConfigMsg = z.object({ t: z.literal('setConfig'), courseId: PackIdSchema, themeId: PackIdSchema });
export const StartMsg = z.object({ t: z.literal('start') });
export const LoadedMsg = z.object({ t: z.literal('loaded') });
export const PingMsg = z.object({ t: z.literal('ping'), c: z.number() });
/** Event mode (#54): host starts the theme vote (public rooms start it automatically). */
export const StartVoteMsg = z.object({ t: z.literal('startVote') });
/** Event mode (#54): any player; may change their vote until the vote ends. */
export const VoteMsg = z.object({ t: z.literal('vote'), themeId: PackIdSchema });

export const ClientMessageSchema = z.discriminatedUnion('t', [
  HelloMsg,
  SetSkinMsg,
  SetReadyMsg,
  SetConfigMsg,
  StartMsg,
  LoadedMsg,
  PingMsg,
  StartVoteMsg,
  VoteMsg,
]);

// ---- server -> client ----------------------------------------------------

export const WelcomeMsg = z.object({
  t: z.literal('welcome'),
  playerId: PlayerId,
  token: z.string(),
  room: RoomStateSchema,
  /** Event mode only (#54): did the username match a submission, and the player's skin per theme. */
  event: z
    .object({
      matched: z.boolean(),
      previewSkins: z.record(z.string(), PackIdSchema).nullable(),
    })
    .optional(),
});
/** Event mode (#54): sent at most VOTE.stateHz times per second while voting. */
export const VoteStateMsg = z.object({
  t: z.literal('voteState'),
  options: z.array(PackIdSchema).length(VOTE.options),
  tallies: z.array(z.number().int().nonnegative()).length(VOTE.options),
  /** server time (ms) when the vote closes */
  endsAt: z.number(),
});
/** Event mode (#54): the winning theme; matchConfig follows with server-assigned skins. */
export const VoteResultMsg = z.object({
  t: z.literal('voteResult'),
  themeId: PackIdSchema,
  tallies: z.array(z.number().int().nonnegative()).length(VOTE.options),
});
export const RoomPatchMsg = z.object({
  t: z.literal('roomPatch'),
  joined: z.array(RoomPlayerSchema).optional(),
  left: z.array(PlayerId).optional(),
  updated: z.array(RoomPlayerSchema.partial().extend({ id: PlayerId })).optional(),
  phase: z.enum(ROOM_PHASES).optional(),
  hostId: PlayerId.optional(),
  config: RoomConfigSchema.optional(),
});
export const MatchConfigMsg = z.object({
  t: z.literal('matchConfig'),
  courseId: PackIdSchema,
  themeId: PackIdSchema,
  qualifyCount: z.number().int().nonnegative(),
  players: z.array(
    z.object({
      id: PlayerId,
      slot: z.number().int().nonnegative().max(299),
      skinId: PackIdSchema,
      name: z.string(),
    }),
  ),
});
export const CountdownMsg = z.object({ t: z.literal('countdown'), startAt: z.number() });
export const PongMsg = z.object({ t: z.literal('pong'), c: z.number(), s: z.number() });
export const CheckpointMsg = z.object({ t: z.literal('checkpoint'), index: z.number().int().nonnegative() });
export const CorrectMsg = z.object({ t: z.literal('correct'), pos: Vec3Schema, checkpoint: z.number().int() });
export const FinishedMsg = z.object({
  t: z.literal('finished'),
  id: PlayerId,
  place: z.number().int().positive(),
  timeMs: z.number().int().nonnegative(),
});
export const RaceEndMsg = z.object({
  t: z.literal('raceEnd'),
  results: z.array(
    z.object({
      id: PlayerId,
      place: z.number().int().positive(),
      timeMs: z.number().int().nonnegative().nullable(),
      checkpoint: z.number().int(),
    }),
  ),
});
export const ErrorMsg = z.object({ t: z.literal('error'), code: z.string(), msg: z.string() });

export const ServerMessageSchema = z.discriminatedUnion('t', [
  WelcomeMsg,
  RoomPatchMsg,
  MatchConfigMsg,
  CountdownMsg,
  PongMsg,
  CheckpointMsg,
  CorrectMsg,
  FinishedMsg,
  RaceEndMsg,
  ErrorMsg,
  VoteStateMsg,
  VoteResultMsg,
]);
