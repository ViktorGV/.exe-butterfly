# Event mode

Hackathon mode (#54, #68): players vote for one of 5 pregenerated themes, and the game server gives every player a themed character. Contestants who submitted a character race as their own character; everyone else gets a random themed one. No two players in a room look alike.

## Enabling it

Event mode is on when **all** of these hold at server start (`loadEventDirector` in `apps/server/src/event/load.ts`):

1. `WOBBLE_EVENT_ID` is set.
2. `EVENT_ROSTER_SECRET` is set (the same secret the pipeline, #63, used to build the roster).
3. `apps/server/event/roster.json` loads and validates against `EventRosterSchema`.
4. `event/manifest.json` loads and validates against `EventManifestSchema`. With `PACKS_BASE_URL` set it is fetched from `<PACKS_BASE_URL>/event/manifest.json`, otherwise read from `apps/web/public/event/manifest.json`.
5. The roster's and manifest's `eventId` equal `WOBBLE_EVENT_ID`.
6. Each manifest theme's v2 theme pack (`event/packs/theme/<slug>.json`) loads; its `costume` kit drives random skins. Theme slugs must be at most 48 characters (the `r:` id limit).

If anything fails, the server logs `[event] event mode off: <reason>` and behaves exactly as without event mode. Skin packs referenced by the pools and roster are loaded for look-alike checks; a missing one is only logged.

## Environment variables

| Variable              | Needed    | Meaning                                                                          |
| --------------------- | --------- | -------------------------------------------------------------------------------- |
| `WOBBLE_EVENT_ID`     | yes       | turns event mode on; must match the roster and manifest                          |
| `EVENT_ROSTER_SECRET` | yes       | HMAC key for `rosterKey(secret, username)`                                       |
| `PACKS_BASE_URL`      | no        | where `event/manifest.json` and `event/packs/**` are served; default: local disk |
| `WOBBLE_SERVER_TOKEN` | live only | bearer token for `POST /api/packs/generate` (#22)                                |
| `WOBBLE_API_URL`      | live only | base URL of the API; defaults to `PACKS_BASE_URL`                                |

Without `WOBBLE_SERVER_TOKEN` and an API URL the live fallback is off; matched players without a pregenerated skin get a random themed one.

## How a skin is chosen (`assignSkins`, when the vote ends)

1. **Personal**: a matched player with a pregenerated skin for the winning theme wears it.
2. **Live**: a matched player with a usable description but no skin for a theme (late submission) gets one generated live. Generation starts on join for every missing theme, results are cached in memory, and assignment waits at most 8 s.
3. **Pool**: everyone else gets an unused pool skin for the theme from the manifest, starting at a position seeded by the username, so returning players tend to get the same one.
4. **Procedural**: once the pool is used up, `randomThemedSkin(costume, seed)` builds a skin from the theme's costume kit. It travels as `r:<themeSlug>:<seed>` and every client rebuilds the identical skin locally.

Every pick is checked against `skinSignature` (quantised colours, face, accessory shapes) for the room: a look-alike moves on to the next pool entry or seed.

## What players see

| Case                                          | Result                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| Username matches a submission                 | `welcome.event.matched = true`, previews of their character per theme                  |
| Matched, but the description was screened out | matched, no previews; races as a random themed character                               |
| Matched, late submission                      | previews appear once live generation finishes                                          |
| No submission                                 | `matched = false`; random themed character                                             |
| Username already in use on this server        | treated as unmatched (`notice: 'duplicate'`); the first connection keeps the character |
| Event mode off                                | the normal game: no vote, players pick their own skin                                  |

## For the room code (#18)

```ts
const { director } = await loadEventDirector();
const id = await director.identify(name, reconnectToken); // on hello -> welcome.event
director.release(name, reconnectToken); // on close
const skins = await director.assignSkins(players, winningThemeId); // before matchConfig
```

Keep the assigned map for the match so reconnecting players keep their skin.
