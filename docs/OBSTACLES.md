# Obstacles

Every obstacle is a pure function of race time `t`, so all players see the same thing without it being sent over the network. Code: `packages/shared/src/course/obstacles/`. Parameter names and defaults are frozen in `docs/CONTRACTS.md` ("Obstacle params v1"); out-of-range values are clamped, invalid ones fall back to the default.

`pos` is the centre of the **top surface** for `platform`, `bridge`, `movingPlatform` and `spinnerDisc`, and the **base centre on the ground** for the rest. `yaw` turns the whole obstacle about `pos`.

| Kind             | Parts (slot)                                                                           | Motion                                                                | Clamped ranges                                |
| ---------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| `platform`       | box (`slot` param)                                                                     | static                                                                | size 0.5–60 × 0.2–10 × 0.5–60                 |
| `ramp`           | box (`slot`) tilted by `pitch` about X, low end on the ground at +Z                    | static                                                                | pitch ±0.8 rad, size up to 40 × 4 × 40        |
| `sweeper`        | hub cylinder (`accent`) + 1–4 horizontal bars (`hazard`) at `barHeight`                | bars turn at `rpm` in direction `dir`                                 | rpm 0–30, armLength 1–12, barHeight 0.3–2.5   |
| `movingPlatform` | box (`slot`)                                                                           | shuttles `pos → pos + travel → pos` every `periodSec`, sine or linear | period 0.5–60 s, travel ±30 m                 |
| `bumper`         | cylinder (`bouncy`, surface `bouncy`)                                                  | static; launches players at `bounce` m/s                              | radius 0.3–3, bounce 4–20                     |
| `bridge`         | box (`rail`), `length` along Z, `width` along X                                        | static                                                                | width 0.8–8, length 1–40                      |
| `spinnerDisc`    | flat cylinder (`accent`) that carries players                                          | turns at `rpm`                                                        | radius 1–10, rpm 0–30                         |
| `pendulum`       | ball (`hazard`, bouncy) + visual arm (`rail`, no collision) hanging from `pivotHeight` | swings across the course, `amplitude` rad every `periodSec`           | amplitude 0–1.4, period 0.8–20 s, bounce 4–20 |
| `gate`           | two pillars (`accent`), crossbar (`finish`), optional `doors` (`hazard`)               | doors slide up and down, staggered                                    | doors 0–6, width 3–30, height 2–10            |
| `wall`           | box (`hazard`)                                                                         | static                                                                | size up to 40 × 10 × 40                       |

Helpers: `periodOf(def)` (0 when static), `maxSurfaceSpeed(def)` (used for server anti-cheat tolerances and the linter) and `kindBounds(def)` (AABB swept over a full cycle).
