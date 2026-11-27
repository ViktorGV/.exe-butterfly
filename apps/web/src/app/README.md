# app

Owned by #26. Wires the client modules into the game.

- `state.ts`: the game flow (title → loading → countdown → race → finished, pause as an overlay). `createFlow()` is the only thing that changes phase.
- `clock.ts`: the offline race clock (3-2-1 countdown, race time from GO, negative before) and personal bests in `localStorage` (falls back to memory when storage is blocked).
- `autopilot.ts`: debug driver (`?autopilot=1`) that steers to the next checkpoint and jumps gaps and low hazards. Used by the smoke test that reaches the first checkpoint of the default course headlessly.
- `game.ts`: `startGame({ canvas, uiRoot, touchRoot, query })` wires engine, input, controller, course runtime, follow camera, Wobbler, theme and UI into solo practice, fully offline. Fixed step: clock → `course.stepColliders` → `input.sample` → `player.step`. Render: `course.update` → `wobbler.setPose` (interpolated) → `camera.update` → HUD. URL parameters: `?course=b:first-wobble`, `?skin=`, `?theme=` (built-in ids) and `?autopilot=1`.
