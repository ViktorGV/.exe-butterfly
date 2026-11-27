# race

Owned by #19. See the issue for scope, and `docs/CONTRACTS.md` for the interfaces this folder must keep.

`createRaceSession()` (`index.ts`) is socket-free: the room (#18) feeds decoded states into `handleState`
and calls `tick(nowMs)` at `SNAPSHOT_HZ`; every tick sends one SNAPSHOT per connected player.

- `limits.ts`: plausibility limits derived from `PLAYER` and the course (25% tolerance).
- `geometry.ts`: spawn-grid areas, swept tests against oriented volumes.
- `snapshot.ts`: record writer (local until #17's codec) and interest management: nearest
  `NEAR_SET_SIZE` every tick, everyone else in 4 rotating groups (3.75 Hz).
- `harness.ts`: deterministic scripted bots for tests and the bench.

Frames: `checkpoint`/`correct` to the player, `finished` to everyone, SNAPSHOT bytes are reused
between calls (send must copy or send synchronously). `raceEnd` is an event only; the room broadcasts it.
Events: `checkpoint`, `finished`, `respawn` (with `save`), `correct`, `kick`, `raceEnd`.
Extra hooks for #84: `getPosition(id, out)` and `approveSave(id, pos, nowMs)`.

Bench: `bun apps/server/src/race/bench.ts` (a `bench:race` script needs a root `package.json` change).
