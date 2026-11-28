// Demo page for the race HUD, including the butterfly that drifts across when a player is marked (#84).
import { createUI } from '../src/ui/index.ts';

const ui = createUI(document.getElementById('ui-root')!);
ui.show('hud', { checkpoints: 4, totalPlayers: 100, qualifyMax: 50, device: 'keyboard' });
ui.hud.setCheckpoint(1, 4);
ui.hud.setPlace(12, 100);
ui.hud.setStorm(3, 20);

let t = 0;
let storm = 3;
setInterval(() => ui.hud.setTime((t += 100)), 100);

document.getElementById('mark')!.addEventListener('click', () => {
  ui.hud.butterfly();
  ui.hud.toast('Pip is marked!');
});
document.getElementById('storm')!.addEventListener('click', () => ui.hud.setStorm(Math.min(20, ++storm), 20));
