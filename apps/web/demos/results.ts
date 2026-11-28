// Demo page for the results screen with the butterfly lines and titles (#84), using sample numbers.
import { summarize } from '../src/butterfly/summary.ts';
import { createUI } from '../src/ui/index.ts';

const ui = createUI(document.getElementById('ui-root')!);

const names = ['Pip', 'Mango', 'Zed', 'Bean', 'Nova', 'Otto', 'Kiki', 'Rue'];
const stats = [
  { pushes: 0, pushFalls: 0, saves: 3 },
  { pushes: 5, pushFalls: 4, saves: 0, marked: true },
  { pushes: 2, pushFalls: 2, saves: 1, marked: true },
  { pushes: 0, pushFalls: 0, saves: 0 },
  { pushes: 9, pushFalls: 6, saves: 0, marked: true },
  { pushes: 1, pushFalls: 0, saves: 2 },
  { pushes: 0, pushFalls: 0, saves: 1 },
  { pushes: 3, pushFalls: 1, saves: 0 },
];
const rows = names.map((name, i) => ({
  id: i + 1,
  name,
  place: i + 1,
  timeMs: 61_000 + i * 2300,
  qualified: i < 4,
}));
const localId = 3; // Zed: marked, saved 1, pushed 2

const butterfly = summarize(
  rows.map((r, i) => ({ ...stats[i], id: r.id, name: r.name, timeMs: r.timeMs })),
  localId,
  { storm: 17, stormMax: 20, throwsAtMe: 4, hitsOnMe: 1 },
);

ui.show('results', { rows, localId, butterfly });
