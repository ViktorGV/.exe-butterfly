// Event mode schemas (#54): the public manifest of the 5 pregenerated themes and the
// server-only roster that maps hashed usernames to pregenerated skins.
import { z } from 'zod';
import { VOTE } from '../constants.ts';
import { HexSchema, PackIdSchema } from './common.ts';

/** `apps/web/public/event/manifest.json`, served to every client. */
export const EventManifestSchema = z.object({
  version: z.literal(1),
  eventId: z.string().min(1).max(64),
  /** the one course every match is played on, e.g. 'b:gumdrop-gauntlet' */
  courseId: PackIdSchema,
  themes: z
    .array(
      z.object({
        /** an `e:` theme pack id */
        id: PackIdSchema,
        title: z.string().min(1).max(32),
        tagline: z.string().max(80),
        credit: z.string().max(24).nullable(),
        /** URL path of the vote card image, e.g. '/event/themes/<slug>/vote-card.webp' */
        voteCard: z.string().max(200),
        swatch: z.array(HexSchema).max(6),
      }),
    )
    .length(VOTE.options),
  /** themeId -> skin ids of the pool for players without a personal character */
  pools: z.record(z.string(), z.array(PackIdSchema)),
});

/** 32 hex chars: the first 128 bits of hmacSha256(EVENT_ROSTER_SECRET, normalizeUsername(name)). */
export const RosterKeySchema = z.string().regex(/^[0-9a-f]{32}$/, 'expected a 32-char hex roster key');

/** `apps/server/event/roster.json`. Server only: never under `public/`, never contains usernames. */
export const EventRosterSchema = z.object({
  version: z.literal(1),
  eventId: z.string().min(1).max(64),
  entries: z.record(
    RosterKeySchema,
    z.object({
      /** the screened character description; null when it was too vague or unsafe */
      characterPrompt: z.string().max(300).nullable(),
      /** themeId -> skin pack id */
      skins: z.record(z.string(), PackIdSchema),
    }),
  ),
});
