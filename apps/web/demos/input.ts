// Demo page for input (#4): live view of the InputState produced by keyboard, gamepad and touch.
import { SIM_HZ } from '@wobble/shared/constants';
import { createInput, type InputDevice } from '../src/input/index.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = createInput({ target: window, touchRoot: $('stage') });

const canvas = $<HTMLCanvasElement>('stick');
const ctx = canvas.getContext('2d')!;
const counts = { jump: 0, dive: 0 };
const flashUntil = { jump: 0, dive: 0 };
const log = $<HTMLOListElement>('log');
let step = 0;
/** Copy of the latest sample for drawing; only the 60 Hz loop calls sample(). */
const shown = { moveX: 0, moveY: 0, jump: false, dive: false };

function drawStick(x: number, y: number) {
  const w = canvas.width;
  const c = w / 2;
  const r = w * 0.42;
  ctx.clearRect(0, 0, w, w);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#d9d4ee';
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.moveTo(c - r, c);
  ctx.lineTo(c + r, c);
  ctx.moveTo(c, c - r);
  ctx.lineTo(c, c + r);
  ctx.stroke();
  const px = c + x * r;
  const py = c - y * r; // forward is up on screen
  ctx.strokeStyle = '#ff6bd5';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(px, py);
  ctx.stroke();
  ctx.fillStyle = '#1d1b2f';
  ctx.beginPath();
  ctx.arc(px, py, 18, 0, Math.PI * 2);
  ctx.fill();
}

function setDevice(d: InputDevice) {
  for (const name of ['keyboard', 'gamepad', 'touch'] as const) $(`dev-${name}`).dataset.on = String(name === d);
}
setDevice(input.activeDevice);
input.onDeviceChange(setDevice);

function addLog(text: string) {
  const li = document.createElement('li');
  li.textContent = text;
  log.prepend(li);
  while (log.children.length > 12) log.lastElementChild!.remove();
}

// Sample at the simulation rate, exactly like the game will.
setInterval(() => {
  step++;
  const s = input.sample();
  shown.moveX = s.moveX;
  shown.moveY = s.moveY;
  shown.jump = s.jump;
  shown.dive = s.dive;
  const now = performance.now();
  for (const b of ['jump', 'dive'] as const) {
    if (s[`${b}Pressed`]) {
      counts[b]++;
      flashUntil[b] = now + 180;
      $(`${b}-count`).textContent = `${counts[b]} press${counts[b] === 1 ? '' : 'es'}`;
      addLog(`step ${step}: ${b} via ${input.activeDevice}`);
    }
  }
}, 1000 / SIM_HZ);

function frame() {
  const s = shown;
  drawStick(s.moveX, s.moveY);
  $('move-readout').textContent = `x ${s.moveX.toFixed(2)} · y ${s.moveY.toFixed(2)}`;
  const now = performance.now();
  for (const b of ['jump', 'dive'] as const) {
    const lamp = $(`lamp-${b}`);
    lamp.dataset.held = String(s[b]);
    lamp.dataset.flash = String(now < flashUntil[b]);
  }
  $('pads').textContent = `${input.gamepads} gamepad${input.gamepads === 1 ? '' : 's'}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

const toggle = $<HTMLButtonElement>('toggle-touch');
const syncToggle = () =>
  (toggle.textContent = input.touchControls?.visible ? 'Hide touch controls' : 'Show touch controls');
toggle.addEventListener('click', () => {
  input.touchControls?.setVisible(!input.touchControls.visible);
  syncToggle();
});
syncToggle();

(window as unknown as { __inputDemo: unknown }).__inputDemo = { input, counts };
