// "Your game prompt" on the title screen: type a theme idea and press Generate. For demos and videos this
// only SIMULATES generation: it walks through scripted steps with a progress bar, then offers Play, which
// starts solo practice in the current theme. Nothing is sent anywhere.
import { button, h } from '../dom.ts';
import { STRINGS } from '../strings.ts';

/** Scripted steps: label and how long it "takes", ms. */
export const FAKE_STEPS: readonly { label: string; ms: number }[] = Object.freeze([
  { label: 'Reading your prompt', ms: 900 },
  { label: 'Dreaming up a world', ms: 1500 },
  { label: 'Sketching the course', ms: 1400 },
  { label: 'Painting textures and sky', ms: 1700 },
  { label: 'Placing obstacles', ms: 1200 },
  { label: 'Dressing up the Wobblers', ms: 1100 },
  { label: 'Tuning the wobble', ms: 700 },
]);

export const PROMPT_MAX = 200;

export interface PromptField {
  readonly el: HTMLElement;
  /** Back to the empty prompt (stops a run in progress). */
  reset(): void;
}

export function createPromptField(doc: Document, onPlay: () => void): PromptField {
  const input = h(doc, 'textarea', {
    id: 'wr-prompt',
    class: 'wr-input wr-prompt-input',
    rows: 2,
    maxlength: PROMPT_MAX,
    spellcheck: 'true',
    placeholder: STRINGS.promptPlaceholder,
  }) as HTMLTextAreaElement;
  const err = h(doc, 'p', { class: 'wr-field-error', role: 'alert' });
  const go = button(doc, STRINGS.promptGenerate, 'wr-btn-primary wr-prompt-go', () => start());

  const quote = h(doc, 'p', { class: 'wr-gen-quote' });
  const fill = h(doc, 'div', { class: 'wr-gen-fill' });
  const pct = doc.createTextNode('0%');
  const steps = FAKE_STEPS.map((s) => h(doc, 'li', { class: 'wr-gen-step' }, s.label));
  const play = button(doc, STRINGS.promptPlay, 'wr-btn-primary wr-btn-big', () => onPlay());
  const again = button(doc, STRINGS.promptAgain, 'wr-btn-ghost', () => reset());
  const done = h(
    doc,
    'div',
    { class: 'wr-gen-done', hidden: true },
    h(doc, 'p', { class: 'wr-gen-ready' }, STRINGS.promptReady),
    play,
    again,
  );
  const panel = h(
    doc,
    'div',
    { class: 'wr-gen', hidden: true, role: 'status', 'aria-live': 'polite' },
    h(doc, 'p', { class: 'wr-gen-title' }, STRINGS.promptGenerating),
    quote,
    h(doc, 'div', { class: 'wr-gen-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill),
    h(doc, 'p', { class: 'wr-gen-pct' }, pct),
    h(doc, 'ol', { class: 'wr-gen-steps' }, ...steps),
    done,
  );
  const form = h(doc, 'div', { class: 'wr-prompt-form' }, h(doc, 'div', { class: 'wr-prompt-row' }, input, go), err);
  const el = h(
    doc,
    'div',
    { class: 'wr-field wr-prompt' },
    h(doc, 'label', { class: 'wr-label', for: 'wr-prompt' }, STRINGS.promptLabel),
    form,
    panel,
  );

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      start();
    }
  });
  input.addEventListener('input', () => (err.textContent = ''));

  let timer = 0;
  let raf = 0;

  function start() {
    const text = input.value.trim();
    if (!text) {
      err.textContent = STRINGS.promptEmpty;
      input.focus();
      return;
    }
    quote.textContent = `“${text}”`;
    form.hidden = true;
    panel.hidden = false;
    done.hidden = true;
    for (const s of steps) s.className = 'wr-gen-step';
    run();
  }

  function run() {
    const total = FAKE_STEPS.reduce((a, s) => a + s.ms, 0);
    const t0 = performance.now();
    const tick = () => {
      const elapsed = performance.now() - t0;
      // ease the bar so it slows near the end, like real work
      const p = Math.min(1, elapsed / total);
      const shown = Math.round((1 - (1 - p) * (1 - p)) * 100);
      fill.style.width = `${shown}%`;
      pct.nodeValue = `${shown}%`;
      let at = 0;
      FAKE_STEPS.forEach((s, i) => {
        const cls =
          elapsed >= at + s.ms ? 'wr-gen-step is-done' : elapsed >= at ? 'wr-gen-step is-active' : 'wr-gen-step';
        if (steps[i]!.className !== cls) steps[i]!.className = cls;
        at += s.ms;
      });
      if (p < 1) raf = requestAnimationFrame(tick);
      else timer = window.setTimeout(finish, 300);
    };
    raf = requestAnimationFrame(tick);
  }

  function finish() {
    done.hidden = false;
    play.focus();
  }

  function reset() {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    panel.hidden = true;
    form.hidden = false;
    fill.style.width = '0%';
    pct.nodeValue = '0%';
    input.value = '';
    err.textContent = '';
  }

  return { el, reset };
}
