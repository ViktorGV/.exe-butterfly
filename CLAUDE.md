# CLAUDE.md

Guide for Claude (and other coding agents) working in this repo. Read it before starting any issue.

**Wobble Rush 3D**: a browser 3D obstacle-course party racer. Many players race at once in a room; each browser simulates its own Wobbler and the server relays positions and decides events (start, checkpoints, finish order).

## Source of truth

1. **The code on `main` and `docs/CONTRACTS.md` win.** If an issue disagrees with them, follow `main`.
2. Some issues (the `[FG-n]` ones, #37–#49) were written for an earlier plan. Keep their **goal and acceptance criteria**, but ignore these details from them:
   - plain JavaScript → use **TypeScript**
   - "no Vite" → the client **uses Vite** (`apps/web`)
   - `client/`, `server/`, `shared/` folders → use **`apps/web`, `apps/server`, `packages/shared`**
   - Protobuf / `game.proto` / `buf` → use the **binary STATE/SNAPSHOT frames and JSON control messages** in `docs/CONTRACTS.md` §6
   - 20 Hz / 100 ms → use `NET_SEND_HZ`, `SNAPSHOT_HZ` and `INTERP_DELAY_MS` from `constants.ts`
3. Overall plan and issue map: issue #1. How to contribute: `CONTRIBUTING.md`.

If an issue and `main` disagree in a way these rules don't cover, stop and ask in the issue rather than guessing.

## Stack

- **Bun 1.4+** for everything: package manager, test runner, scripts, game server. Never use npm, yarn, pnpm, Node or Jest.
- **TypeScript**, strict mode. Bun runs `.ts` directly; there is no build step for the server.
- **Client** (`apps/web`): Three.js, bundled by Vite (`bunx --bun vite`).
- **Server** (`apps/server`): `Bun.serve` with native WebSockets. No Express, no `ws`, no Socket.IO.
- **Shared** (`packages/shared`): constants, types, Zod schemas, fixtures and pure game logic. Used by the client, server, API and bots.
- **API** (`apps/web/api`): Vercel-style functions, served at `/api/*` during dev.

## Commands

```bash
bun install            # install deps (CI uses --frozen-lockfile)
bun run dev            # web on http://localhost:5173 + game server on ws://localhost:8787
bun run test           # all *.test.ts files (bun:test)
bun test <path>        # tests for one folder, e.g. bun test apps/server/src/room
bun run typecheck      # tsc, strict, all workspaces
bun run lint           # eslint + prettier --check
bun run format         # prettier --write
bun run build          # production web build into apps/web/dist
```

**Before you say an issue is done, run all four CI checks and make sure they pass:**

```bash
bun run lint && bun run typecheck && bun run test && bun run build
```

Never skip, delete or weaken a test to make CI pass.

## Layout

```
apps/web/src/<module>/     client modules (engine, input, player, camera, course, crowd, net, ui, audio, ...)
apps/web/demos/            one demo page per visual module: demos/<module>.html
apps/web/api/              HTTP API functions (_lib/ = shared server code, not routes)
apps/server/src/<module>/  game server modules (transport, room, race, metrics, http)
packages/shared/src/       constants.ts, types.ts, schemas/, fixtures/, protocol/, course/, assets/
tools/loadtest/            headless bot swarm over the real wire protocol
docs/CONTRACTS.md          all shared interfaces, wire formats and seams
```

Every module folder has a `README.md` that names its owning issue. Read it first.

## Rules

### Only touch the paths your issue owns

Each issue lists the paths it owns. Don't create or edit files outside them.

- If you need a module that doesn't exist yet, import it through its **seam** (see `docs/CONTRACTS.md#seams`) or use `packages/shared/src/fixtures`. Don't build your own copy.
- If you find a bug in someone else's module, say so in your PR description or on that module's issue. Don't fix it in your PR.

### Contracts are frozen

`packages/shared/src/constants.ts`, `types.ts`, `schemas/`, `fixtures/` and `docs/CONTRACTS.md` are contracts.

- Code against them, not against another module's internals.
- Don't change them in a feature PR. If a change is really needed, it goes in a small separate PR labelled `contract-change` that touches only contract files (see `CONTRIBUTING.md`). Point this out to the human instead of doing it silently.

### Code style

- Relative imports include the `.ts` extension: `import { x } from './thing.ts'`.
- Shared code is imported without an extension: `@wobble/shared` or `@wobble/shared/constants`.
- Type-only imports use `import type`.
- Units are metres, seconds, radians. Y is up, the course runs toward −Z, yaw 0 faces −Z.
- Keep functions small and modules focused; match the factory shapes in `docs/CONTRACTS.md` §8 (`createX({...}) -> { ... }`).
- Original content only: no third-party characters, names, art, audio or level layouts.

### Performance rules (the game must handle 100+ players)

- **No allocations in hot paths** (per frame on the client, per tick or per message on the server). Reuse buffers, vectors and arrays.
- Binary frames use `DataView` over preallocated `ArrayBuffer`s, little-endian, with the exact layouts in `docs/CONTRACTS.md` §6 and `WIRE` in `constants.ts`.
- Server: encode a snapshot once and send the same bytes to every receiver who should get it (`server.publish` / `ws.publish` to a room topic) instead of re-encoding per player where possible.
- Server: if `ws.send()` reports backpressure for a client, drop that client's snapshot for the tick. Never queue up stale snapshots.
- Server: validate every client STATE (max speed, checkpoint order, bounds) before relaying it.
- Client: remote players are interpolated, not physically simulated. Draw crowds with instancing and LOD (`apps/web/src/crowd`).
- Keep `perMessageDeflate` off for game traffic.
- If the issue gives a budget (bytes, ms, FPS), include measured numbers in the PR.

## How to prove your work

- **Logic**: unit tests next to the code as `*.test.ts`, using `bun:test`. Cover the issue's acceptance criteria with tests where they can be tested.
- **Visual modules**: add `apps/web/demos/<module>.html` and its script. It's served at `/demos/<module>.html` by `bun run dev` and built by `bun run build`. It must load with no console errors.
- **Networking**: test against a real `createGameServer({ port: 0 })` in tests, and use `tools/loadtest` bots for anything about player counts.
- Build against fixtures (`fixtureCourse`, `fixtureSkin`, `fixtureTheme`) instead of waiting for other issues.

## Pull requests

- One issue per PR, linked with `Closes #N`.
- Keep it small enough to review (roughly under 400 changed lines, excluding tests and generated files). If an issue is bigger, split it and say how.
- In the description: what changed, how you tested it, any numbers the issue asks for, and anything you couldn't do or that conflicts with `main`.
- Screenshot or short clip for visual changes.
