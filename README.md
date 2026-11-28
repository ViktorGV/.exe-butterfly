# Wobble Rush 3D

A browser-based 3D obstacle-course party racer for up to 300 players per room, with original characters ("Wobblers") and LLM-generated skins, themes and courses.

The plan, architecture and issue map are in issue #1. How to work on the code is in [CONTRIBUTING.md](CONTRIBUTING.md), and the shared contracts are in [docs/CONTRACTS.md](docs/CONTRACTS.md).

## Quick start

Requires [Bun](https://bun.sh) 1.4+.

```bash
bun install
bun run dev
```

Then open http://localhost:5173. The game server listens on ws://localhost:8787 (`/healthz` for health).

## Testing multiplayer

**Two people on the same network.** One of you runs `bun run dev`; it prints a `Network:` address
(for example `http://192.168.1.20:5173`). Everyone opens that address, one presses **Create room**, then
**Copy invite link** in the waiting room and sends the link (`?room=CODE` joins straight away). The host
presses **Start race**. Allow ports 5173 and 8787 through the firewall on the machine that runs it.

**Alone, with bots.** Create a room in your browser, then fill it with bots that race whenever you start:

```bash
bun run loadtest -- --url ws://localhost:8787 --room ABCDE --bots 8 --duration 1800
```

They join, ready up, run the course every match and stay until `--duration` runs out (Ctrl+C stops them).

**Production build on one port.** `bun run build`, then `bun apps/server/src/index.ts` serves the client,
`/api` and the WebSocket together on http://localhost:8787 (open it from other machines with the host's IP).

**Public server.** Pushes to `main` deploy to Fly.io once the `FLY_API_TOKEN` secret is set (see #99).

## Layout

```
apps/web/          Three.js client (Vite) and Vercel API functions (apps/web/api)
apps/server/       realtime game server (Bun native WebSockets)
packages/shared/   contracts, schemas, fixtures and pure game logic shared by everything
tools/loadtest/    bot swarm for load testing
docs/              contracts and other design docs
```
