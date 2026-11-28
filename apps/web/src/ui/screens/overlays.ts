// Small screens: loading, countdown, finish banner and the error / reconnecting modal.
import { button, h } from '../dom.ts';
import { countdownValue, formatTime } from '../format.ts';
import { STRINGS, t } from '../strings.ts';
import type { CountdownProps, ErrorProps, FinishKind, FinishProps, LoadingProps } from '../types.ts';
import { createHowToPlayCard } from '../../butterfly/howToPlay.ts';
import { focusSoon, type Screen, type ScreenContext } from './context.ts';

export function createLoadingScreen({ doc }: ScreenContext): Screen<LoadingProps> {
  const fill = h(doc, 'div', { class: 'wr-progress-fill' });
  const bar = h(
    doc,
    'div',
    { class: 'wr-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 },
    fill,
  );
  const label = h(doc, 'p', { class: 'wr-loading-label', 'aria-live': 'polite' }, STRINGS.loading);
  const el = h(doc, 'section', { class: 'wr-screen wr-loading' }, h(doc, 'div', { class: 'wr-card' }, label, bar));
  return {
    el,
    show(props) {
      label.textContent = props?.label ?? STRINGS.loading;
      const p = props?.progress;
      const known = typeof p === 'number' && Number.isFinite(p);
      bar.classList.toggle('wr-progress-indeterminate', !known);
      if (known) {
        const pct = Math.round(Math.min(1, Math.max(0, p)) * 100);
        fill.style.transform = `scaleX(${pct / 100})`;
        bar.setAttribute('aria-valuenow', String(pct));
      } else {
        fill.style.transform = '';
        bar.removeAttribute('aria-valuenow');
      }
      bar.setAttribute('aria-label', label.textContent);
    },
  };
}

const GO_HOLD_MS = 700;

export function createCountdownScreen(ctx: ScreenContext, onDone: () => void): Screen<CountdownProps> {
  const { doc } = ctx;
  const num = doc.createTextNode('3');
  const digit = h(doc, 'div', { class: 'wr-count-digit' }, num);
  const el = h(doc, 'section', { class: 'wr-overlay wr-countdown', 'aria-live': 'assertive' }, digit);
  el.append(createHowToPlayCard(doc)); // controls only, no butterfly spoilers (#84)
  let timer = 0;
  let endAt = 0;
  let shown = -1;

  const render = (v: number) => {
    if (v === shown) return;
    shown = v;
    num.nodeValue = v > 0 ? String(v) : STRINGS.go;
    digit.classList.toggle('wr-count-go', v <= 0);
    // restart the pop animation without forcing layout: swap the element's animation name via a data flip
    digit.dataset.tick = digit.dataset.tick === 'a' ? 'b' : 'a';
    if (v <= 0) {
      clearTimeout(timer);
      timer = window.setTimeout(onDone, GO_HOLD_MS);
    }
  };

  const tick = () => {
    const left = endAt - performance.now();
    render(countdownValue(left));
    if (left > 0) timer = window.setTimeout(tick, Math.max(16, (left % 1000) + 1));
  };

  return {
    el,
    show(props) {
      clearTimeout(timer);
      shown = -1;
      if (typeof props?.msLeft === 'number') {
        endAt = performance.now() + props.msLeft;
        tick();
      } else {
        render(Math.max(0, Math.round(props?.value ?? 3)));
      }
    },
    hide() {
      clearTimeout(timer);
    },
  };
}

const FINISH_TITLE: Record<FinishKind, string> = {
  qualified: STRINGS.finishQualified,
  finished: STRINGS.finishFinished,
  timeup: STRINGS.finishTimeUp,
  eliminated: STRINGS.finishEliminated,
};

export function createFinishScreen({ doc, events }: ScreenContext): Screen<FinishProps> {
  const title = h(doc, 'h2', { class: 'wr-finish-title' });
  const time = h(doc, 'p', { class: 'wr-finish-time wr-mono' });
  const best = h(doc, 'p', { class: 'wr-finish-best' });
  // Back to the intro screen, same as Leave in the pause panel.
  const playAgain = button(doc, STRINGS.playAgain, 'wr-btn-primary wr-finish-action', () =>
    events.emit('leave', undefined),
  );
  const banner = h(doc, 'div', { class: 'wr-finish-banner' }, title, time, best, playAgain);
  const el = h(doc, 'section', { class: 'wr-overlay wr-finish', role: 'status' }, banner);
  return {
    el,
    show(props) {
      const kind = props?.kind ?? 'finished';
      banner.dataset.kind = kind;
      title.textContent = FINISH_TITLE[kind];
      time.hidden = props?.timeMs == null;
      time.textContent = props?.timeMs == null ? '' : formatTime(props.timeMs);
      if (props?.newBest) best.textContent = STRINGS.newPersonalBest;
      else if (props?.bestMs != null) best.textContent = t('personalBest', { time: formatTime(props.bestMs) });
      else best.textContent = '';
      best.hidden = !best.textContent;
      best.classList.toggle('wr-finish-newbest', !!props?.newBest);
    },
  };
}

export function createErrorScreen(ctx: ScreenContext): Screen<ErrorProps> {
  const { doc, events } = ctx;
  const title = h(doc, 'h2', { id: 'wr-error-title', class: 'wr-panel-title' });
  const msg = h(doc, 'p', { class: 'wr-error-msg' });
  const spinner = h(doc, 'div', { class: 'wr-spinner', 'aria-hidden': 'true' });
  const retry = button(doc, STRINGS.errorRetry, 'wr-btn-primary', () => {
    ctx.close('error');
    events.emit('retry', undefined);
  });
  const back = button(doc, STRINGS.errorBack, '', () => {
    ctx.close('error');
    events.emit('leave', undefined);
  });
  const el = h(
    doc,
    'section',
    { class: 'wr-overlay wr-modal', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'wr-error-title' },
    h(
      doc,
      'div',
      { class: 'wr-card wr-error' },
      spinner,
      title,
      msg,
      h(doc, 'div', { class: 'wr-actions' }, retry, back),
    ),
  );
  return {
    el,
    show(props) {
      const reconnecting = props?.kind === 'reconnecting';
      spinner.hidden = !reconnecting;
      title.textContent = props?.title ?? (reconnecting ? STRINGS.reconnecting : STRINGS.errorTitle);
      msg.textContent = props?.message ?? (reconnecting ? STRINGS.reconnectingBody : '');
      msg.hidden = !msg.textContent;
      retry.hidden = reconnecting || props?.canRetry === false;
      back.textContent = reconnecting ? STRINGS.leave : STRINGS.errorBack;
      focusSoon(retry.hidden ? back : retry);
    },
  };
}
