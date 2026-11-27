# tools/event

The offline event pipeline, run before the hackathon.

| Step            | Command                    | Issue | Folder                       |
| --------------- | -------------------------- | ----- | ---------------------------- |
| Intake + pick 5 | `bun run event:select`     | #56   | `src/intake/`, `src/select/` |
| Themes + images | `bun run event:themes`     | #59   | `src/themes/`, `src/images/` |
| Characters      | `bun run event:characters` | #63   | `src/characters/`            |

Shared helpers (AI call cache, `--budget-usd` guard, CLI args) live in `src/lib/` and are owned by #56.
Raw submissions go in `input/` (gitignored). Outputs go to `out/` (gitignored) and to `apps/web/public/event/` / `apps/server/event/` (committed).
