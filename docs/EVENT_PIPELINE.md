# Event pipeline

Offline steps in `tools/event`, run before the hackathon. All AI goes through OpenRouter via `@wobble/ai` (#22). There is no human approval step.

| Step                   | Command                    | Issue |
| ---------------------- | -------------------------- | ----- |
| Intake + pick 5 themes | `bun run event:select`     | #56   |
| Themes + images        | `bun run event:themes`     | #59   |
| Characters             | `bun run event:characters` | #63   |

## Intake (#56)

### Run it

Export the form as CSV to `tools/event/input/submissions.csv`, then:

```bash
cd tools/event
OPENROUTER_API_KEY=... bun run event:select
```

PowerShell: `$env:OPENROUTER_API_KEY = '...'; bun run event:select`. From the repo root, use `bun run --filter @wobble/event-tools event:select`.

Offline try-out on the synthetic sample (no key, no cost):

```bash
cd tools/event
bun run event:select --input fixtures/submissions.sample.csv --mock
```

| Flag                | Default                         | Meaning                               |
| ------------------- | ------------------------------- | ------------------------------------- |
| `--input <file>`    | `input/submissions.csv`         | form export                           |
| `--columns <file>`  | `input/columns.json` if present | header mapping                        |
| `--out <dir>`       | `out/`                          | output folder                         |
| `--cache-dir <dir>` | `.cache/`                       | AI cache                              |
| `--budget-usd <n>`  | 5                               | stop before spending more             |
| `--fresh`           | off                             | ignore cached AI results              |
| `--seed <text>`     | `wobble`                        | shuffles and tie-breaks               |
| `--mock`            | off                             | canned AI, same as `WOBBLE_AI_MOCK=1` |

Exit codes: 0 selection written, 1 error (including fewer than 5 usable ideas), 2 budget reached.

### Columns

| Field              | Rules                                                                 | Headers recognised without a config                                  |
| ------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `username`         | required; matched by `normalizeUsername` (#54), at most 16 characters | username, your username, handle, nickname, name                      |
| `game_prompt`      | cut at 500 characters                                                 | game_prompt, describe your game, game idea, game                     |
| `character_prompt` | cut at 300 characters; used by #63                                    | character_prompt, describe your character, character idea, character |
| `credit_ok`        | optional yes/no                                                       | credit_ok, may we credit you, credit me, credit                      |
| `submitted_at`     | optional date                                                         | submitted at, timestamp, submitted, time                             |

Longer headers that start with one of these (five letters or more) also match. For anything else, map field to exact header in `columns.json`:

```json
{ "username": "Wie ben je?", "game_prompt": "Jouw spel", "character_prompt": "Jouw figuur" }
```

### What intake does

- Cleans text (Unicode NFKC, control, zero-width and bidi characters removed).
- Drops rows with no username, or with neither prompt (`invalid`).
- For a username that appears more than once, keeps the latest row (by `submitted_at` when every copy has a parseable date, ISO 8601 recommended; otherwise the last row) and reports the others as `duplicate`.
- Writes `out/submissions.json` before any AI call: `{ version: 1, submissions: [{ id, row, username, usernameKey, gamePrompt, characterPrompt, creditOk, submittedAt, flags }], dropped: [{ row, username, status, reason }] }` (`SubmissionsFileSchema` in `src/intake/intake.ts`).

`input/`, `out/` and `.cache/` are gitignored. They contain usernames or submissions: never commit them.

## Selection (#56)

1. **Screen** every game prompt (fast model, 8 at a time): `safe`, `namesExistingIP`, `feasibility` (`visual`, `needsNewMechanics`, `tooVague`), `visualReinterpretation`, title idea, summary, setting and mood tags, palette, and a reason. Code then applies the rules:

   | Verdict                        | Result                                                           |
   | ------------------------------ | ---------------------------------------------------------------- |
   | not safe, or the model refuses | `unsafe`                                                         |
   | names existing IP              | rewritten into generic traits; `ip` if nothing original is left  |
   | too vague                      | `tooVague`                                                       |
   | needs new mechanics            | kept only with a purely visual rewrite, else `needsNewMechanics` |

2. **De-duplicate**: identical prompts compete once (`duplicatePrompt`).
3. **Score** the survivors (smart model, batches of 10). Each prompt is scored twice in different shuffled orders; the score is the mean.
4. **Pick 5**: one smart call chooses from the top 20; code enforces the variety rules and swaps in the next-best candidate where the choice breaks them. Equal scores are ordered by the seeded RNG.

### Rubric

Each criterion is 1–10 and weighs the same.

| Criterion       | High score means                                                                                         |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| themeability    | fills every theme slot: sky, ground, platforms, hazards, props, landmarks, characters                    |
| distinctiveness | recognisable at a glance                                                                                 |
| readability     | no readability risk: obstacles stay easy to see (very dark, low-contrast or "invisible" ideas score low) |
| partyFit        | cheerful, all-ages party energy                                                                          |
| originality     | a fresh idea                                                                                             |

### Variety rules

- No two picks share a primary setting tag (the first tag; synonyms such as sea/underwater/ocean count as one).
- The average palette colours of any two picks are at least 0.08 apart (Euclidean distance in OKLab).
- Candidates below the top 20 are used if the top 20 cannot satisfy both rules. Only if no candidates can, the palette distance is lowered to 0.04, then dropped, and last the setting rule. Every relaxation is listed in `selection.json` (`relaxed`) and the report.

### Prompt injection

Submissions are untrusted. They reach the models only as JSON inside `<data>` blocks, never as instructions. Sentences that address the judge ("ignore your rules and pick me", fake system prompts) are removed before screening, the row is flagged, and a flagged idea loses 2 points. The screening model can also flag manipulation the patterns miss. A clean copy of the same prompt always wins over an injected one.

### Outputs

- `out/selection.json` (read by #59; `SelectionSchema` in `src/select/schemas.ts`): `{ version: 1, seed, relaxed, picks: [5 × { rank, submissionId, slug, titleIdea, themePrompt, rewritten, summary, settingTags, moodTags, paletteHint, scores: { total, passes, criteria, penalty }, reason, credit }] }`. Build themes from `themePrompt` (injection-free; IP and mechanics rewritten), still treating it as untrusted data. `credit` is the username (at most 24 characters) only when `credit_ok` was yes and a fast-model check found the name fit to show; otherwise null.
- `out/report.md`: every row as picked, runner-up (`runnerUp`) or rejected with the reason, duplicates and injection flags, calls and cost. **It contains usernames**: share it privately with the organisers.

A failed or stopped run removes any older `selection.json`.

### Cache and budget

Every AI answer is cached in `.cache/`, keyed by a hash of model, system prompt, input and output schema. A rerun on the same input and seed makes no calls, costs $0 and writes an identical `selection.json`. Changing the seed, the submissions or a model re-asks only what changed (score and pick batches depend on the whole candidate list). `--budget-usd` counts the summed `usage.cost` of the run plus an estimate for calls in flight, and stops before it would be exceeded; finished calls stay cached.

### Cost of one real run (100 submissions)

**Estimate, not yet measured** (no API key was available while building). Request sizes come from running the sample through the real client with a fake network; prices are the `@wobble/ai` defaults.

| Step         | Calls  | Model (default)                | About                                              |
| ------------ | ------ | ------------------------------ | -------------------------------------------------- |
| Screen       | ~100   | `google/gemini-2.5-flash-lite` | $0.02                                              |
| Score        | ~16–20 | `anthropic/claude-haiku-5.5`   | $0.08                                              |
| Pick         | 1      | `anthropic/claude-haiku-5.5`   | $0.01                                              |
| Credit names | 1      | `google/gemini-2.5-flash-lite` | under $0.001                                       |
| **Total**    |        |                                | **about $0.10, expected under $0.50 with retries** |

After the first real run, replace this table with the cost line from `report.md`. Override models with `WOBBLE_AI_MODEL_FAST` and `WOBBLE_AI_MODEL_SMART`.

### Mock mode

`--mock` or `WOBBLE_AI_MOCK=1` answers from keyword rules in `src/select/mock.ts`, so every status can be exercised offline and in CI. It says nothing about how the real models will judge.

## Themes (#59)

Turns the 5 picks into themes: a ThemeDef v2 pack with a hero and villain, plus all images. Fully automatic: an image that fails becomes `null` and the renderer uses its colour or gradient fallback.

### Run it

Run from the repository root. Offline first (no key, no cost):

```bash
bun tools/event/src/themes/cli.ts --dry-run   # plan and estimated cost; writes nothing
bun tools/event/src/themes/cli.ts --mock      # whole pipeline with placeholder images, into tools/event/out/mock/
```

A real run needs `.env.local` in the repository root (gitignored) with one line, `OPENROUTER_API_KEY=<your key>`. The command loads that file itself and never prints it.

1. Smoke test on one theme, then open `tools/event/out/themes.html`. This writes that theme into `apps/web/public/event/`, but not `manifest.json`, which needs all 5.

   ```bash
   bun tools/event/src/themes/cli.ts --only <slug> --budget-usd 0.8
   ```

2. All 5 themes. The first one is cached, so it costs nothing again.

   ```bash
   bun tools/event/src/themes/cli.ts --budget-usd 3
   ```

3. Commit `apps/web/public/event/`.

Input is `tools/event/out/selection.json` from `event:select`. Without one, a real run needs `--selection tools/event/prompts/theme/sample-selection.json` (a hand-written sample with the slugs `candy-volcano`, `deep-reef-disco`, `paper-sky-kites`, `frozen-toy-factory` and `mushroom-swamp`); mock and dry runs fall back to it by themselves. `bun run event:themes` works from `tools/event/`.

If `sharp` fails to load on Windows with "The filename or extension is too long", the checkout path is too deep for Bun's default `node_modules` layout: move the checkout somewhere shorter, or run `bun install --linker hoisted`.

| Flag                   | Default                   | Meaning                                                                |
| ---------------------- | ------------------------- | ---------------------------------------------------------------------- |
| `--selection <file>`   | `out/selection.json`      | the 5 picks                                                            |
| `--out <dir>`          | `apps/web/public/event`   | event folder (mock: `tools/event/out/mock/event`)                      |
| `--only <slug>`        |                           | rebuild one theme; the others come from their published packs          |
| `--slot <name>`        |                           | regenerate a slot even if cached: `skybox`, `texture`, `sprite-2`, ... |
| `--fail-slot <name>`   |                           | force a slot's quality check to fail (repeatable)                      |
| `--preset <name>`      | `lean`                    | `lean` or `full`, see the slot table                                   |
| `--budget-usd <n>`     | 3                         | stop spending at this amount                                           |
| `--fresh`              | off                       | ignore cached AI results                                               |
| `--event-id <id>`      | kept, else `wobble-event` | `eventId` in `manifest.json`                                           |
| `--screenshots <dir>`  |                           | course screenshots in `<dir>/<slug>/*.png` for the readability check   |
| `--concurrency <n>`    | 4                         | image generations in flight                                            |
| `--mock` / `--dry-run` | off                       | see above; `WOBBLE_AI_MOCK=1` is the same as `--mock`                  |

### What happens to each theme

1. **Art direction** (`smart` role, two structured calls: look, then 3D props). The answer schemas are kept plain (no lengths, ranges, tuples or unions) so strict structured outputs accept them; `src/themes/clamp.ts` enforces every contract limit afterwards. A 400 is retried once with the `fast` role. A call that still fails is replaced by a procedural draft, and the run summary says `PROCEDURAL`.
2. **Checks** (`src/themes/legibility.ts`): hazard, bouncy, finish, ground and fog colours differ enough from the platforms (CIE76); fog leaves the next checkpoint clear; sun and ambient light are in range; at least 2 landmarks, 1 particle system, 8 costume accessories and dressing for 3 obstacle kinds of `b:gumdrop-gauntlet`; the cast is not a well-known character. Up to 2 repair rounds, then a deterministic fix. `hideBase` is always false. The result goes through `sanitizePack` (see below).
3. **Images** (`image` role, most important first across all themes, so a spent budget loses the same slots everywhere).
4. **Post-processing** with `sharp`: textures made seamless (blended with a half-offset copy, checked by a seam metric), skybox edges joined and poles collapsed, sprites keyed from a flat chroma background, despilled and trimmed, colours pulled towards the theme palette when far off, WebP quality 80 without metadata, `@0.5x` variants, and the 8 MB budget of #54 (re-encode, then drop the least important).
5. **Quality check** (`vision` role). A rejected image is generated again with the notes, 3 attempts in all, then the slot is `null`. A missing vote card is replaced in `manifest.json` by a locally drawn `vote-card-fallback.webp`.
6. **Readability** (only with `--screenshots`): the vision model judges the screenshots; a failure repairs colours, fog and light once.
7. **Publish** (below).

| Slot                      | Size (`@0.5x` is half) | `lean` | `full`  |
| ------------------------- | ---------------------- | ------ | ------- |
| skybox                    | 4096 × 2048            | 1      | 1       |
| textures                  | 1024 × 1024            | 4      | up to 7 |
| sprites                   | within 512 × 512       | 3      | 8       |
| signage                   | 1024 × 512             | 2      | 6       |
| vote card, reveal, podium | 1024 × 576             | 3      | 3       |

Images are requested at the 1K resolution and scaled to these sizes. The art-direction model may plan fewer textures than `full` asks for.

### Outputs

- `apps/web/public/event/packs/theme/<slug>.json`: pack `e:theme-<slug>`.
- `apps/web/public/event/themes/<slug>/*.webp`: its images. Other `.webp` files in that folder are removed.
- `apps/web/public/event/manifest.json`: `themes`, `courseId`, `eventId`. `pools` (#63) are kept for themes that are still there.
- `tools/event/out/themes.html` (not committed): every image, 3 × 3 tiled textures, colours, cast and notes. `themes-report.txt` next to it has the summary and the cost.

### Cache, budget and cost

Every successful text, image and vision answer is cached in `.cache/`. A rerun with the same selection, prompts and models makes no calls, costs $0 and writes identical files. Failed calls are not cached, so a rerun retries them. A slot whose images failed the quality check stays `null` on reruns; use `--slot` to try it again.

`--budget-usd` counts `usage.cost` (the estimate, if a response reports no cost) plus calls in flight. When it is reached, the remaining images are `null` and the themes are still published. A rejected key (401, 403) or an empty account (402) during art direction stops the run before anything is written.

**Estimate, not yet measured** (no API key was available while building): a `lean` run is about $2.9 for 65 images with the default models, mostly the assumed $0.04 per image. `--dry-run` prints the current figure. Override models with `WOBBLE_AI_MODEL_SMART`, `WOBBLE_AI_MODEL_IMAGE` and `WOBBLE_AI_MODEL_VISION`. After the first real run, replace this paragraph with the cost line from `themes-report.txt`.

### Not covered yet

- Nothing has run against the real OpenRouter API.
- Screenshots for the readability check are not taken automatically; that needs the #64 demo page or the #33 harness.
- `sanitizePack` (#16) only accepts v1 themes: it rejects every v2 theme with `version: expected 1`. The pipeline tolerates exactly that rejection and relies on its own clamping and checks, so the dressing and landmark fairness rules are only approximated.

## Characters (#63)

Every `ok` submitter's character, re-dressed for each of the 5 themes, a pool of generic themed characters per theme, and one hero and one villain skin per theme (#84). Code in `tools/event/src/characters/`, prompts in `tools/event/prompts/character/`.

### Run it

```bash
cd tools/event
# offline, over the made-up 100-row sample and the fixture themes (writes to a temp dir):
WOBBLE_AI_MOCK=1 bun src/characters/cli.ts --themes fixture --submissions sample --public-dir /tmp/ev --roster /tmp/ev/roster.json
# for real, after event:select and event:themes:
OPENROUTER_API_KEY=... EVENT_ROSTER_SECRET=... bun run event:characters
```

| Flag                          | Default                                | What                                                                     |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `--submissions <file>`        | `tools/event/out/submissions.json`     | #56's output; `sample` = the built-in 100-row sample                     |
| `--themes fixture`            | read `manifest.json` + `packs/theme/*` | use the 5 fixture themes instead                                         |
| `--public-dir <dir>`          | `apps/web/public/event`                | where `manifest.json` and `packs/` live                                  |
| `--roster <file>`             | `apps/server/event/roster.json`        |                                                                          |
| `--pool-size <n>`             | 150                                    | pool characters per theme                                                |
| `--limit <n>`                 | all                                    | only the first n submissions                                             |
| `--concurrency <n>`           | 8                                      | model calls in flight, split across themes                               |
| `--only-user <name>`          |                                        | regenerate one person (late submission); pools and cast stay as they are |
| `--budget-usd <n>`            | **1**                                  | themes (#59) take $3 of the $5 credit                                    |
| `--fresh`, `--mock`, `--seed` |                                        | as in #56                                                                |

`EVENT_ROSTER_SECRET` must be the secret the game server uses (mock runs fall back to a fixed test secret).

### What it does

1. **Screen** each character prompt once (`fast`, structured output): `ok | tooVague | unsafe | empty`, traits (hex colours, motifs, vibe, silhouette), `reinterpretedFromIP` and a generic description. Empty and plainly unsafe prompts are caught locally first, without a call. Fewer than two concrete traits (colours + motifs) is `tooVague`, whatever the model said. Ideas naming existing characters or real people stay `ok`, but only their generic traits are kept. The prompt is injection-stripped (#56's `stripInjection`) and sent as data only.
2. **Fuse** each `ok` submitter with each theme (one call per pair): keeps their colours and motifs, dresses them with the theme's `costume` kit. The name is a short character name, never the username.
3. **Check** every skin with `sanitizePack('skin')` and `skinSignature`. A skin that fails, or looks like one already in that theme (personal, pool or cast), is asked for again with `variation: 1, 2`. After that the local builder (`build.ts`) makes one from the traits and jitters it until it is unique, so nobody misses a skin. The run reports how many such fallbacks it made.
4. **Hero and villain** from the theme's `cast` (a generic pair when it is null).
5. **Pool**: batches of 10 per call with "make these differ" and the names used so far, until `--pool-size` is reached (filled locally if the model keeps repeating itself).

### Outputs

| File                                                         | What                                                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `apps/web/public/event/packs/skin/skin-<theme>-<10hex>.json` | personal skin. The 10 hex chars are HMAC(secret, rosterKey + themeId): stable, not linkable to a username            |
| `.../packs/skin/pool-<theme>-<nnn>.json`                     | pool skin                                                                                                            |
| `.../packs/skin/hero-<theme>.json`, `villain-<theme>.json`   | `e:hero-<theme>` / `e:villain-<theme>`, fixed ids (#84)                                                              |
| `apps/web/public/event/manifest.json`                        | only `pools` is replaced (themeId → pool skin ids)                                                                   |
| `apps/server/event/roster.json`                              | `EventRoster`: `rosterKey(secret, username)` → `{ characterPrompt (screened, null if not ok), skins }`. No usernames |
| `tools/event/out/characters.html` (gitignored)               | contact sheet: one row per person across the 5 themes, then cast and pool per theme, counts per status               |

`<theme>` is the theme id without `e:theme-`, cut to 40 characters. A full run first removes the `skin-`, `pool-`, `hero-` and `villain-` packs of an earlier run.

### Cost

About 100 screens + 100 × 5 fusions + 5 × 15 pool batches + 10 cast calls ≈ 685 `fast` calls (`google/gemini-2.5-flash-lite`). Estimate: about $0.35–0.50 for 100 submissions; the $1 default budget leaves room for retries. Replace this with the measured cost after the first real run. Calls are cached in `tools/event/.cache`, so a rerun costs nothing.

**A small real run first** (10 people × 5 themes, pool of 10; roughly 75 calls, a few cents):

```bash
OPENROUTER_API_KEY=... EVENT_ROSTER_SECRET=... bun src/characters/cli.ts --limit 10 --pool-size 10 --budget-usd 0.25
```

Then open `tools/event/out/characters.html` and check that each person's colours and motifs survive in every theme.

### Mock mode

`--mock` or `WOBBLE_AI_MOCK=1` answers from word lists (`lexicon.ts`, `screen.ts`) and the local builder, so statuses, uniqueness and the outputs are testable offline. It says nothing about how the real model will design skins.
