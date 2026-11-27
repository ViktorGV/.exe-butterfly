# ui

Owned by #11. Every screen and overlay outside the lobby, as plain HTML and CSS over the canvas. No framework. Styles live in `../styles/ui.css` (imported by `base.css`).

Phone first: every screen is laid out for 360–430 px portrait and landscape, then scales up. Touch targets are at least 44 px, safe-area insets are respected, and during a race the HUD stays on the **top edge** so the bottom ~150 px are free for the touch stick and the Jump / Dive buttons (`../input/touchControls.ts`).

## Usage

```ts
import { createUI } from '../ui/index.ts';

const ui = createUI(document.getElementById('ui-root')!); // appends a .wr-ui layer; nothing runs at import time

ui.on('play:quick', ({ name }) => net.connect({ name, room: 'quick' }));
ui.on('play:join', ({ name, code }) => net.connect({ name, room: code })); // code is 5 capital letters
ui.on('settings:change', (s) => {
  audio.setVolumes(s); // { master, music, sfx } 0..1
  engine.setQuality(s.quality); // 'low' | 'medium' (default) | 'high'
});
ui.on('pause', () => session.pause()); // pause button or Esc
ui.on('resume', () => session.resume());

ui.show('title');
mountLobby(ui.getSlot('lobby'), deps);
ui.show('lobby');
ui.show('loading', { progress: 0.4, label: 'Fetching 212 Wobblers…' });
ui.show('hud', { checkpoints: 5, totalPlayers: 300, qualifyMax: 180, device: input.activeDevice });
ui.show('countdown', { msLeft: 3000 }); // or { value: 3 } per tick from the server clock

engine.onRender(() => ui.hud.setTime(raceMs)); // text nodes only, no allocation
ui.hud.setCheckpoint(2, 5);
ui.hud.setPlace(37, 300);
ui.hud.setQualified(12, 180);
ui.hud.toast(STRINGS.toastCheckpoint);
ui.hud.flash(); // after a respawn

ui.show('finish', { kind: 'qualified', timeMs, bestMs, newBest });
ui.show('results', { rows, localId }); // rows sorted by place; virtualised, fine with 300
ui.show('error', { kind: 'reconnecting' });
ui.hide('error');

ui.setAccent(theme.accent); // tints buttons, bars and highlights
ui.setHudFont('rounded'); // rounded | blocky | handwritten | pixel | serif
```

### Screens

| Screen      | Kind    | Props                                                                                         |
| ----------- | ------- | --------------------------------------------------------------------------------------------- |
| `title`     | base    | `{ eventMode?, name? }`                                                                       |
| `lobby`     | base    | none: an empty container filled via `getSlot('lobby')`                                        |
| `loading`   | base    | `{ progress?: 0..1, label? }` (no progress: indeterminate)                                    |
| `hud`       | base    | `{ solo?, checkpoints?, totalPlayers?, qualifyMax?, device? }`                                |
| `results`   | base    | `{ rows: ResultRow[], localId?, solo? }`                                                      |
| `none`      | base    | hides everything                                                                              |
| `countdown` | overlay | `{ value }` (3, 2, 1, 0 = GO) or `{ msLeft }`; hides itself after GO                          |
| `pause`     | overlay | `{ solo? }` (Restart only in solo)                                                            |
| `settings`  | overlay | none                                                                                          |
| `finish`    | overlay | `{ kind: 'qualified' \| 'finished' \| 'timeup' \| 'eliminated', timeMs?, bestMs?, newBest? }` |
| `error`     | overlay | `{ kind?: 'error' \| 'reconnecting', title?, message?, canRetry? }`                           |

Showing a base screen closes all overlays. Overlays stack on the current base screen; `pause`, `settings` and `error` are modal (the base becomes `inert`).

### Events

`play:quick {name}`, `play:join {name, code}`, `play:create {name}`, `play:solo {name}`, `restart`, `leave`, `resume`, `settings:change UISettings`. Two extras beyond `docs/CONTRACTS.md` §8: `pause` (pause button or Esc during the HUD) and `retry` (error modal).

Settings (`{ master, music, sfx, sensitivity, quality }`) and the player name are remembered in `localStorage` when it is available; pass `createUI(root, { store: null })` to disable that.

## Files

- `index.ts`: `createUI(root)`, screen switching, Esc handling, `setAccent`, `setHudFont`.
- `screens/`: one builder per screen; DOM code only runs inside these factories.
- `strings.ts`: every user-visible string (`t(key, vars)`, `ordinal(n)`).
- Pure and unit-tested: `format.ts` (`mm:ss.cc`, allocation-free text writers), `emitter.ts`, `windowing.ts` (virtual list maths), `settings.ts` (settings, name and room-code sanitising), `colors.ts` (accent variables, HUD fonts).
- `virtualList.ts`: pooled rows for the results table.

HUD numbers: `setTime` measured at ~0.0005 ms per call in headless Chrome (budget 0.2 ms), writing at most three text nodes and only when the digits change.
