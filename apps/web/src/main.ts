// Entry point: boots the game (#26).
import type { Pack } from '@wobble/shared/types';
import { startGame } from './app/game.ts';

// Dev preview of generated event packs: ?theme=e:theme-<slug>&skin=e:skin-<name> loads them from /event/packs/.
const params = new URLSearchParams(location.search);
const extraPacks: Pack[] = [];
for (const [key, dir, prefix] of [
  ['theme', 'theme', 'e:theme-'],
  ['skin', 'skin', 'e:skin-'],
] as const) {
  const id = params.get(key);
  if (id?.startsWith(prefix)) {
    const res = await fetch(`/event/packs/${dir}/${id.slice(prefix.length)}.json`);
    if (res.ok) extraPacks.push((await res.json()) as Pack);
  }
}

const game = startGame({
  canvas: document.getElementById('game') as HTMLCanvasElement,
  uiRoot: document.getElementById('ui-root') as HTMLElement,
  touchRoot: document.getElementById('touch-root') as HTMLElement,
  query: location.search,
  extraPacks,
});
(window as unknown as { __wobble: typeof game }).__wobble = game;
