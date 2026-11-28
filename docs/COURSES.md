# Courses

A course starts life as a **recipe**: a name, a seed and 4–12 segments. That is all an LLM or a designer writes; `assembleCourse(recipe)` (`packages/shared/src/course/assemble/`) turns it into a concrete `CourseDef`, and `lintCourse(def)` (`course/lint.ts`) proves it is playable. Assembly is deterministic: the same recipe gives a byte-identical course in every JS engine (seeded PRNG, coordinates rounded to the millimetre).

## Layout

Toward −Z: **start pad** (24 × 20 m, spawn grid of 20 × 15 = 300 slots) → for each segment: **segment**, then a **checkpoint pad** (18 × 12 m, 300-slot respawn grid) → **finale**: a ramp up 2 m, a gate, and a 24 × 16 m finish pad. Pieces are separated by 2 m gaps.

## Segment types

| Type              | What it builds                                                   | Intensity 1 → 5                                      |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `plainRun`        | open floor with low walls to hop                                 | more walls                                           |
| `sweeperRun`      | floor with sweepers whose bars span the full width               | faster (8 → 21 rpm), 3 arms at 4+                    |
| `movingPlatforms` | rows of 4 bobbing platforms over a void, each row out of phase   | bigger rise (0.55 → 1.15 m), shorter period          |
| `bumperField`     | floor scattered with bumpers (at least 3.2 m apart)              | more bumpers, stronger bounce                        |
| `narrowBridges`   | 4–6 parallel bridges over a void                                 | fewer, narrower lanes (never under 4 lanes or 1.2 m) |
| `rampClimb`       | flat, ramp up, flat at the new height                            | higher climb (1.5 → 3.5 m)                           |
| `spinnerDiscs`    | pairs of large spinning discs over a void, alternating direction | faster spin                                          |
| `pendulumAlley`   | floor with pendulums swinging across it                          | faster, wider swings                                 |
| `gateDash`        | floor with gates whose doors slide up and down                   | more doors, faster cycle                             |

`length` is `short` / `medium` / `long` (20 / 32 / 44 m). If the whole course would exceed `LIMITS.maxCourseLength`, segments are shortened evenly (to at least 12 m).

## Crowd rules (up to 300 players)

- Open sections are 32 m wide (at least 14 m), so 100+ players fit side by side.
- Every chokepoint has at least 4 parallel lanes: 4–6 bridges, 4 platforms per moving row, 2 discs per spinner row (each 7.6 m across).
- The start pad holds a 300-slot spawn grid; every checkpoint pad is at least 14 × 8 m with its own respawn grid.

## Linter rules

Errors: too many entities, course too long, geometry outside the int16 position range, `killY` not below all geometry, checkpoints out of order, finish not beyond the last checkpoint, a walkable surface narrower than `minLaneWidth`, spawn or respawn grids not fully on solid ground, and any checkpoint or the finish **unreachable** from the spawn surface by gaps ≤ `maxGap` and step-ups ≤ `maxStepUp` (moving surfaces count when a timing window exists in their cycle). Unknown obstacle kinds are warnings.

## Built-in courses

| Id                   | Name             | Notes                                                                               |
| -------------------- | ---------------- | ----------------------------------------------------------------------------------- |
| `b:gumdrop-gauntlet` | Gumdrop Gauntlet | the default: sweepers → moving platforms → bumpers → narrow bridges → ramp and gate |
| `b:first-wobble`     | First Wobble     | short and gentle                                                                    |
| `b:spin-cycle`       | Spin Cycle       | hard: spinners, pendulums, gates                                                    |
