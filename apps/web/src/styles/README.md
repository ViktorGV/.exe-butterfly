# styles

Owned by #11. See the issue for scope, and `docs/CONTRACTS.md` for the interfaces this folder must keep.

- `base.css`: page basics (no page scroll, pull-to-refresh or double-tap zoom). Linked from `index.html`; imports `ui.css`.
- `ui.css`: every screen of `../ui`. Classes are prefixed `wr-`. Colours come from CSS variables on `:root` (`--accent`, `--accent-dark`, `--accent-light`, `--accent-ink`, `--sun`, `--mint`, `--sky`, `--danger`, `--ink`, `--paper`); `ui.setAccent(hex)` overrides the accent ones. Event themes may set `--hud-accent` and `--hud-font`. Motion is short and is cut to nothing under `prefers-reduced-motion`.
