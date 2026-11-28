// Entry point: boots the game (#26).
import type { Pack } from '@wobble/shared/types';
import { startGame } from './app/game.ts';
import { loadBakedRacers } from './racers/baked.ts';
import { eventPackUrl, loadThemeChoice } from './app/themes.ts';

// The theme is the one picked on the title screen (Classic by default); ?theme= overrides it, and
// ?skin=e:skin-<name> previews a generated skin. Event packs are fetched from /event/packs/.
const params = new URLSearchParams(location.search);
const store = (() => {
  try {
    return localStorage;
  } catch {
    return null;
  }
})();
if (!params.has('theme')) params.set('theme', loadThemeChoice(store));

const extraPacks: Pack[] = [];
const fetchPack = async (url: string | null) => {
  if (!url) return;
  try {
    const res = await fetch(url);
    if (res.ok) extraPacks.push((await res.json()) as Pack);
  } catch {
    // missing pack: the game falls back to the built-in theme or skin
  }
};
const skin = params.get('skin');
// Pre-built racer meshes (racers/baked.ts) load alongside the packs, so no racer is sculpted on this device. On a
// slow network the game starts after 1.5 s anyway; later files are still used for racers not built yet.
await Promise.all([
  Promise.race([loadBakedRacers(), new Promise((r) => setTimeout(r, 1500))]),
  fetchPack(eventPackUrl(params.get('theme') ?? '')),
  fetchPack(skin?.startsWith('e:skin-') ? `/event/packs/skin/${skin.slice(2)}.json` : null),
]);

const game = startGame({
  canvas: document.getElementById('game') as HTMLCanvasElement,
  uiRoot: document.getElementById('ui-root') as HTMLElement,
  touchRoot: document.getElementById('touch-root') as HTMLElement,
  query: `?${params.toString()}`,
  extraPacks,
});
(window as unknown as { __wobble: typeof game }).__wobble = game;
