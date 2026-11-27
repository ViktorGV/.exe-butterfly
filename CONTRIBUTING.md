# Contributing to Wobble Rush 3D

The plan, architecture and issue map are in the epic, #1. Every piece of work is one GitHub issue.

## Setup

You need [Bun](https://bun.sh) 1.4 or newer.

```bash
bun install
bun run dev        # web app on http://localhost:5173 (with /api/*) + game server on ws://localhost:8787
```

| Command             | What it does                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `bun run dev`       | Vite dev server for `apps/web` (including `apps/web/api/**` at `/api/*`) and the game server, together |
| `bun run test`      | All unit tests (`bun test`, files named `*.test.ts`)                                                   |
| `bun run lint`      | ESLint and Prettier check                                                                              |
| `bun run format`    | Prettier write                                                                                         |
| `bun run typecheck` | `tsc` in strict mode over every workspace                                                              |
| `bun run build`     | Production build of the web app into `apps/web/dist`                                                   |

CI runs lint, typecheck, test and build on every pull request.

## Code conventions

- TypeScript everywhere, strict mode. Bun runs it directly; Vite bundles the client.
- Relative imports use explicit `.ts` extensions (`import { x } from './thing.ts'`). Shared code is imported as `@wobble/shared` or `@wobble/shared/<path>` without an extension.
- Type-only imports use `import type`.
- No per-frame or per-tick allocations in hot paths: reuse buffers and objects.
- Original content only: no third-party characters, names, art, audio or level layouts.

## The ownership rule

Each issue lists the paths it **owns**. Only touch those paths.

- Need something from a module that does not exist yet? Import it through its **seam** (below) or use the fixtures. Do not create or edit files in a folder you do not own.
- Found a problem in someone else's module? Comment on the owning issue.
- Every module folder has a `README.md` naming its owning issue.

This is what lets 23 wave-1 issues run at the same time without merge conflicts.

## Contracts

The shared contracts are in `packages/shared/src` (`constants.ts`, `types.ts`, `schemas/`, `fixtures/`) and are documented in `docs/CONTRACTS.md`. They are law: code against them, not against another module's internals.

### Changing a contract

1. Open a small, separate pull request labelled `contract-change` that touches **only** the contract files (and `docs/CONTRACTS.md`).
2. Explain the change and list the issues it affects.
3. Mention it on #1 so everyone working in parallel sees it.
4. Merge it before the feature PR that depends on it.

## Seams

A seam is a file seeded by #2 with a working stub, and later replaced by its owner. Other modules import the seam path and keep working unchanged when the real implementation lands. The current list is in `docs/CONTRACTS.md#seams`.

## Proving a module in isolation

- **Unit tests** next to the code, named `*.test.ts`, using `bun:test`.
- **Demo page** for anything visual: `apps/web/demos/<module>.html` plus its script. Every `demos/*.html` is served by `bun run dev` at `/demos/<module>.html`, listed at `/demos/`, and built as an extra entry.
- Build against `packages/shared/src/fixtures` instead of waiting for other modules.

## Pull requests

- One issue per pull request where possible; link it with `Closes #N`.
- Keep CI green. Never skip or disable a test to get there.
- Include a screenshot or short clip for visual changes, and benchmark numbers when the issue states a budget.
