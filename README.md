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

## Layout

```
apps/web/          Three.js client (Vite) and Vercel API functions (apps/web/api)
apps/server/       realtime game server (Bun native WebSockets)
packages/shared/   contracts, schemas, fixtures and pure game logic shared by everything
tools/loadtest/    bot swarm for load testing
docs/              contracts and other design docs
```
