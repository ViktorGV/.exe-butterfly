# Asset packs

Skins, themes and courses are data, not code. Anything that loads a pack (the API after generation, every client and the game server) runs it through `sanitizePack(kind, data)` from `packages/shared/src/assets` first. The result is always small, safe and readable on a phone screen, whatever an LLM or an attacker produced. Shapes are defined in `packages/shared/src/schemas/packs.ts` and `docs/CONTRACTS.md` §5; this document lists the ranges and rules the sanitizer enforces. The numbers live in `PACK_RULES` (`assets/sanitize.ts`).

Units: metres, radians. Colours: `#rrggbb`.

## `sanitizePack(kind, data) -> { ok, data, issues }`

- **Never throws.** Throwing getters, proxies and cyclic data give `ok: false` or a repaired pack, never an exception.
- **Rebuilds from known keys only.** Unknown keys, `__proto__` tricks and deep nesting do not survive.
- **`ok: false` only when the input is unrecoverable:** `data` is not a plain object, `data.version !== 1`, or `kind` is not `skin`, `theme` or `course`. Everything else is repaired. Each repair adds a line to `issues` (`path: what happened`, at most 200 lines).
- **Numbers:** a non-finite value takes the field's default. Finite values are clamped to the range below and rounded to 3 decimals (integers where noted).
- **Colours:** `#rgb`, `#rrggbb` and the same without `#` are accepted in any case and normalised to lower-case `#rrggbb`. An invalid required colour takes the field's default. An invalid optional colour (`emissive`, `cheeks`) is dropped (`cheeks` becomes `null`).
- **Enums:** an unknown value takes the field's default (listed below).
- **Optional fields:** `null` and missing are the same. The LLM schemas send `null`.
- **Names** (pack names, decor names): markup tags are removed, then control characters, bidi overrides, zero-width characters and the characters `` < > ` ``. Whitespace is collapsed, the result is trimmed and cut to 24 code points (course names: 48). An empty result takes a default name. Render names with `textContent`, never as HTML.
- **Size:** the serialised data (UTF-8 JSON) is at most `LIMITS.packMaxBytes` (8192 bytes). Content is dropped until it fits, least important first: tile shapes (from the pattern with the most), then decor props (last first), then accessory prims (last first).
- **Idempotent:** sanitising a sanitised pack returns the same data and no issues.
- The final result is checked against the strict schema. If that fails (it should not), the result is `ok: false`.

## Pattern

| Field    | Type / range                                                       | Default            |
| -------- | ------------------------------------------------------------------ | ------------------ |
| `type`   | `none` `stripes` `dots` `checker` `zigzag` `waves` `custom`        | `none`             |
| `colors` | 1..4 colours. `colors[0]` is the background, the rest the motif    | the owner's colour |
| `scale`  | 0.25..4. Motif size: 1 = four repeats per tile                     | 1                  |
| `tile`   | `custom` only, 0..24 tile shapes. Dropped from other pattern types | `[]` for `custom`  |

Tile shape (unit square, x right, y down):

| Field    | Range                                                     | Default   |
| -------- | --------------------------------------------------------- | --------- |
| `kind`   | `circle` `rect` `poly`                                    | `circle`  |
| `fill`   | colour                                                    | `#ffffff` |
| `x`, `y` | 0..1, centre of the shape                                 | 0.5       |
| `r`      | `circle` only, 0.01..0.5                                  | 0.1       |
| `w`, `h` | `rect` only, 0.01..1                                      | 0.2       |
| `rot`    | `rect` / `poly`, radians. Outside ±3.142 it wraps to ±π   | none      |
| `points` | `poly` only, 3..16 `[x, y]` offsets from the centre, ±0.5 | —         |

Fields that do not belong to the shape's kind are dropped. A `poly` with fewer than 3 points is dropped.

### `drawPattern(ctx, pattern, sizePx)`

Draws a seamless square tile into `(0, 0, sizePx, sizePx)`, using only the Canvas 2D calls in `PatternContext` (`fillStyle`, `fillRect`, `beginPath`, `arc`, `rect`, `moveTo`, `lineTo`, `closePath`, `fill`, `save`, `restore`, `translate`, `rotate`). The pattern is sanitised first, so any input is safe.

- `sizePx` is rounded and clamped to 1..256 (`PATTERN_MAX_PX`). Non-finite sizes use 64.
- It always starts with `colors[0]` over the whole tile. A context with only `fillStyle` and `fillRect` gets just that flat colour.
- Repeats per tile: `round(4 / scale)` clamped to 1..16 (`patternRepeats`); `custom` uses `round(1 / scale)` clamped to 1..4 (`customRepeats`).
- `stripes`: 45° bands cycling through all colours. `dots`: two dots per cell, `colors[1]` and `colors[2]` (or `colors[1]` again). `checker`: `colors[0]` and `colors[1]`, plus a small `colors[2]` square in the light cells. `zigzag` / `waves`: horizontal bands with triangle / sine edges cycling through all colours. `custom`: the tile shapes over `colors[0]`. A missing motif colour is white.
- Seamless: every motif repeats a whole number of times, and any shape that crosses an edge is drawn again on the opposite side. The tests rasterise every pattern twice, once clipped like a real canvas and once wrapped around a torus, and require identical pixels.

## Skin (`SkinDef`)

| Field                   | Range / values                                        | Default         |
| ----------------------- | ----------------------------------------------------- | --------------- |
| `version`               | must be `1`                                           | unrecoverable   |
| `name`                  | 1..24 characters (see Names)                          | `Wobbler`       |
| `body.color`            | colour                                                | `#ff8a3d`       |
| `body.belly`            | colour                                                | `#ffe4b8`       |
| `body.pattern`          | pattern                                               | `none`          |
| `body.height`, `.girth` | 0.85..1.15, cosmetic only: the collider never changes | 1               |
| `face.eyes`             | `dot` `oval` `sleepy` `star` `wide`                   | `dot`           |
| `face.eyeColor`         | colour                                                | `#1d1b2f`       |
| `face.mouth`            | `smile` `o` `flat` `grin` `none`                      | `smile`         |
| `face.cheeks`           | colour or `null`                                      | `null`          |
| `limbs.color`           | colour                                                | the body colour |
| `accessories`           | 0..3, at most 24 prims in total                       | `[]`            |
| `accessories[].anchor`  | `headTop` `face` `back` `waist`                       | `headTop`       |
| `accessories[].prims`   | 1..24 prims. An accessory with none left is dropped   | —               |

Prim (accessories and decor):

| Field      | Range                                                          | Default           |
| ---------- | -------------------------------------------------------------- | ----------------- |
| `shape`    | `sphere` `box` `cylinder` `cone` `torus` `capsule`             | `sphere`          |
| `pos`      | each ±1.2 for accessories, ±10 for decor                       | `[0, 0, 0]`       |
| `rot`      | radians, Euler XYZ. Outside ±3.142 it wraps to ±π              | `[0, 0, 0]`       |
| `scale`    | size in metres, each 0.01..2.4 (accessories), 0.01..20 (decor) | `[0.2, 0.2, 0.2]` |
| `color`    | colour                                                         | `#ffffff`         |
| `emissive` | optional colour                                                | none              |

Prims are unit-sized (they fit a 1 m cube before scaling), so a prim reaches `|pos| + |scale| / 2` from its origin.

### Fairness

- **Accessory sphere:** every accessory prim must fit inside a 1.2 m sphere around its anchor, so no skin is a wall, a shield or a camouflage cloak. A prim that pokes out is first shrunk (if it is too big on its own) and then pulled towards the anchor until it fits (0.01 m margin).
- **Cosmetic body:** `height` and `girth` are clamped to 0.85..1.15 and never change the collider.

### Legibility

- **Eyes contrast with the body:** if `eyeColor` is closer than 0.15 (OKLab distance) to `body.color`, it becomes `#1d1b2f` or `#ffffff`, whichever is further from the body.

## Theme (`ThemeDef`)

| Field                    | Range / values                                                                                                           | Default                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `version`                | must be `1`                                                                                                              | unrecoverable                 |
| `name`                   | 1..24 characters                                                                                                         | `Theme`                       |
| `sky.top/horizon/bottom` | colours                                                                                                                  | `#5ec8ff` `#ffd9f2` `#fff4d6` |
| `fog.color`              | colour                                                                                                                   | `#ffd9f2`                     |
| `fog.near`               | 10..300 m                                                                                                                | 60                            |
| `fog.far`                | 80..1200 m, and at least `near + 60`                                                                                     | 220                           |
| `light.ambient`, `.sun`  | colours                                                                                                                  | `#ffffff`                     |
| `light.ambientIntensity` | 0.2..2                                                                                                                   | 0.9                           |
| `light.sunIntensity`     | 0.5..4                                                                                                                   | 2                             |
| `light.sunDir`           | each −1..1, and `y` in −1..−0.2 (from above)                                                                             | `[-0.4, -1, -0.3]`            |
| `materials.<slot>`       | one per slot: `platformA` `platformB` `hazard` `bouncy` `accent` `rail` `finish`. A missing slot is filled with defaults |                               |
| `material.color`         | colour                                                                                                                   | per slot                      |
| `material.roughness`     | 0..1                                                                                                                     | 0.5                           |
| `material.metalness`     | 0..1                                                                                                                     | 0                             |
| `material.emissive`      | optional colour                                                                                                          | none                          |
| `material.pattern`       | optional pattern                                                                                                         | none                          |
| `decor`                  | 0..6 props, scattered beside the course, never on it                                                                     | `[]`                          |
| `decor[].name`           | 1..24 characters                                                                                                         | `Prop`                        |
| `decor[].prims`          | 1..12 prims. A prop with none is dropped                                                                                 | —                             |
| `decor[].density`        | 0..1                                                                                                                     | 0.3                           |
| `decor[].minScale`       | 0.25..4                                                                                                                  | 1                             |
| `decor[].maxScale`       | `minScale`..4                                                                                                            | `minScale`                    |
| `music.tempo`            | 70..180 bpm, integer                                                                                                     | 120                           |
| `music.scale`            | `major` `minor` `pentatonic` `lydian`                                                                                    | `major`                       |
| `music.energy`           | 1, 2 or 3                                                                                                                | 2                             |

### Legibility

- **Hazards and bounce pads stand out.** The surface slots are `platformA`, `platformB`, `accent` and `finish`. `hazard.color` must be at least 0.15 (OKLab distance, `colorDistance`) from every surface slot; `bouncy.color` must be at least 0.15 from every surface slot and from `hazard`. A colour that is too close is replaced with the first colour from a fixed list of bright candidates that passes (the best one if none passes). Hazard first, then bouncy.
- **Pattern matches its slot:** for `hazard` and `bouncy`, a pattern's `colors[0]` is set to the slot colour.
- **Fog never hides the course:** `near` ≥ 10 m, `far` ≥ 80 m and `far` ≥ `near + 60`.
- **Sane light:** sun intensity 0.5..4, ambient 0.2..2, and the sun always shines from above (`sunDir[1]` ≤ −0.2).

## Course (`CourseRecipe`)

The sanitizer checks the recipe only; `assembleCourse` and `lintCourse` (#15) handle playability.

| Field                  | Range / values                                                            | Default       |
| ---------------------- | ------------------------------------------------------------------------- | ------------- |
| `version`              | must be `1`                                                               | unrecoverable |
| `name`                 | 1..48 characters                                                          | `Course`      |
| `seed`                 | integer 0..2147483647 (negatives are made positive)                       | 1             |
| `segments`             | 4..12. Over 12 are cut; under 4 are padded with `{ plainRun, medium, 1 }` |               |
| `segments[].type`      | one of `SEGMENT_TYPES`. Unknown types are dropped                         | —             |
| `segments[].length`    | `short` `medium` `long`                                                   | `medium`      |
| `segments[].intensity` | integer 1..5                                                              | 2             |

## LLM-facing schemas

`skinLLMSchema`, `themeLLMSchema` and `courseLLMSchema` (`assets/llm.ts`) are what the generation endpoint (#22) sends as the structured-output schema.

- Same shapes as the data schemas, minus `version` (set by the server: call `sanitizePack(kind, { version: 1, ...answer })`).
- Non-recursive, no `$ref`. Every key is required; optional values are `.nullable()`, as strict JSON-schema modes require.
- Every field has a `.describe()` hint with units, ranges and style guidance (bright, saturated, toy-like colours; hazards hot and distinct; small accessories).
- No numeric `minimum` / `maximum`: providers do not enforce them. `sanitizePack` clamps.

## Built-in packs

`assets/builtin/` holds the packs every player has offline, registered through `BUILTIN_SKIN_PACKS` and `BUILTIN_THEME_PACKS` (read by `resolveBuiltin`). All are original designs and pass through `sanitizePack` unchanged.

- **12 skins:** `b:sunny-bean` (default, `DEFAULT_SKIN_ID`), `b:mint-zap`, `b:grape-fizz`, `b:coral-dash`, `b:tide-pop`, `b:comet-kid`, `b:plain-jelly`, `b:berry-knight`, `b:lemon-drop`, `b:frost-puff`, `b:lava-jogger`, `b:cocoa-cub`. Together they use every eye style, mouth, pattern type and anchor, with and without cheeks.
- **4 themes:** `b:candy-workshop` (default, `DEFAULT_THEME_ID`), `b:bathtub-bay`, `b:moonlit-arcade`, `b:garden-party`.
- The fixtures `b:fixture-skin` and `b:fixture-theme` stay registered. `DEFAULT_COURSE_ID` lives in `course/recipes`.
- `skinSwatch(skin)` and `themeSwatch(theme)` give small summaries (name, key colours, pattern, face) for gallery cards.

Import them with `@wobble/shared/assets/index`.
