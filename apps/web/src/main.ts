// Entry point: boots the game (#26).
import { startGame } from './app/game.ts';

const game = startGame({
  canvas: document.getElementById('game') as HTMLCanvasElement,
  uiRoot: document.getElementById('ui-root') as HTMLElement,
  touchRoot: document.getElementById('touch-root') as HTMLElement,
  query: location.search,
});
(window as unknown as { __wobble: typeof game }).__wobble = game;
