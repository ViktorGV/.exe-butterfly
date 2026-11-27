// Pause and Settings panels. Both hold the volume sliders and the controls help; Pause adds Resume, Restart (solo only) and Leave, Settings adds Done.
import { button, h } from '../dom.ts';
import type { UISettings } from '../settings.ts';
import { STRINGS, type StringKey } from '../strings.ts';
import type { PauseProps } from '../types.ts';
import { focusSoon, type Screen, type ScreenContext } from './context.ts';

type Mode = 'pause' | 'settings';
type SliderKey = 'master' | 'music' | 'sfx';

const HELP: readonly { device: StringKey; rows: readonly [StringKey, StringKey][] }[] = [
  {
    device: 'controlsTouch',
    rows: [
      ['actionMove', 'touchMove'],
      ['actionJump', 'touchJump'],
      ['actionDive', 'touchDive'],
      ['actionCamera', 'touchCamera'],
      ['actionPause', 'touchPause'],
    ],
  },
  {
    device: 'controlsKeyboard',
    rows: [
      ['actionMove', 'keyMove'],
      ['actionJump', 'keyJump'],
      ['actionDive', 'keyDive'],
      ['actionCamera', 'keyCamera'],
      ['actionPause', 'keyPause'],
    ],
  },
  {
    device: 'controlsGamepad',
    rows: [
      ['actionMove', 'padMove'],
      ['actionJump', 'padJump'],
      ['actionDive', 'padDive'],
      ['actionCamera', 'padCamera'],
      ['actionPause', 'padPause'],
    ],
  },
];

function controlsHelp(doc: Document): HTMLElement {
  return h(
    doc,
    'div',
    { class: 'wr-help' },
    ...HELP.map(({ device, rows }) =>
      h(
        doc,
        'div',
        { class: 'wr-help-block' },
        h(doc, 'h4', { class: 'wr-help-title' }, STRINGS[device]),
        h(
          doc,
          'dl',
          { class: 'wr-help-list' },
          ...rows.flatMap(([a, b]) => [h(doc, 'dt', null, STRINGS[a]), h(doc, 'dd', null, STRINGS[b])]),
        ),
      ),
    ),
  );
}

export function createSettingsPanel(ctx: ScreenContext, mode: Mode): Screen<PauseProps | undefined> {
  const { doc, events } = ctx;
  const id = (s: string) => `wr-${mode}-${s}`;
  const sliders = new Map<SliderKey, { input: HTMLInputElement; out: HTMLOutputElement; scale: number }>();

  const slider = (key: SliderKey, label: StringKey, min: number, max: number, step: number) => {
    const scale = 100;
    const input = h(doc, 'input', {
      id: id(key),
      class: 'wr-range',
      type: 'range',
      min: min * scale,
      max: max * scale,
      step: step * scale,
    });
    const out = h(doc, 'output', { class: 'wr-range-value wr-mono', for: id(key) });
    input.addEventListener('input', () => {
      const v = Number(input.value) / scale;
      out.textContent = formatSlider(key, v);
      ctx.updateSettings({ [key]: v } as Partial<UISettings>);
    });
    sliders.set(key, { input, out, scale });
    return h(doc, 'div', { class: 'wr-slider' }, h(doc, 'label', { for: id(key) }, STRINGS[label]), input, out);
  };

  const resume = button(doc, STRINGS.resume, 'wr-btn-primary', () => {
    ctx.close('pause');
    events.emit('resume', undefined);
  });
  const restart = button(doc, STRINGS.restart, '', () => {
    ctx.close('pause');
    events.emit('restart', undefined);
  });
  const leave = button(doc, STRINGS.leave, 'wr-btn-danger', () => {
    ctx.close('pause');
    events.emit('leave', undefined);
  });
  const done = button(doc, STRINGS.done, 'wr-btn-primary', () => ctx.close('settings'));

  const titleId = id('title');
  const actions =
    mode === 'pause'
      ? h(doc, 'div', { class: 'wr-actions' }, resume, restart, leave)
      : h(doc, 'div', { class: 'wr-actions' }, done);

  const el = h(
    doc,
    'section',
    { class: 'wr-overlay wr-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h(
      doc,
      'div',
      { class: 'wr-card wr-panel' },
      h(doc, 'h2', { id: titleId, class: 'wr-panel-title' }, mode === 'pause' ? STRINGS.paused : STRINGS.settings),
      actions,
      h(
        doc,
        'div',
        { class: 'wr-panel-cols' },
        h(
          doc,
          'div',
          { class: 'wr-panel-col' },
          h(doc, 'h3', { class: 'wr-panel-sub' }, STRINGS.volume),
          slider('master', 'volumeMaster', 0, 1, 0.05),
          slider('music', 'volumeMusic', 0, 1, 0.05),
          slider('sfx', 'volumeSfx', 0, 1, 0.05),
        ),
        h(
          doc,
          'div',
          { class: 'wr-panel-col' },
          h(doc, 'h3', { class: 'wr-panel-sub' }, STRINGS.controls),
          controlsHelp(doc),
        ),
      ),
    ),
  );

  return {
    el,
    show(props) {
      const s = ctx.getSettings();
      for (const [key, { input, out, scale }] of sliders) {
        input.value = String(s[key] * scale);
        out.textContent = formatSlider(key, s[key]);
      }
      restart.hidden = !props?.solo;
      focusSoon(mode === 'pause' ? resume : done);
    },
  };
}

function formatSlider(_key: SliderKey, v: number): string {
  return `${Math.round(v * 100)}%`;
}
