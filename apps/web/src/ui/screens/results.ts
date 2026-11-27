// Results: your place / time / qualified summary, then a virtualised ranked list of every player.
import { button, h } from '../dom.ts';
import { formatTimeOrDash, numStr } from '../format.ts';
import { ordinal, STRINGS, t } from '../strings.ts';
import type { ResultRow, ResultsProps } from '../types.ts';
import { createVirtualList } from '../virtualList.ts';
import { focusSoon, type Screen, type ScreenContext } from './context.ts';

export const RESULT_ROW_HEIGHT = 48;

export function createResultsScreen(ctx: ScreenContext): Screen<ResultsProps> {
  const { doc, events } = ctx;
  let rows: readonly ResultRow[] = [];
  let localId: number | undefined;

  const list = createVirtualList(doc, {
    rowHeight: RESULT_ROW_HEIGHT,
    createRow(d) {
      const place = d.createTextNode('');
      const name = d.createTextNode('');
      const time = d.createTextNode('');
      const el = h(
        d,
        'div',
        { class: 'wr-row', role: 'row' },
        h(d, 'span', { class: 'wr-row-place wr-mono', role: 'cell' }, place),
        h(d, 'span', { class: 'wr-row-name', role: 'cell' }, name),
        h(d, 'span', { class: 'wr-row-time wr-mono', role: 'cell' }, time),
      );
      return { el, place, name, time };
    },
    bindRow(row, i) {
      const r = rows[i];
      row.place.nodeValue = numStr(r.place);
      row.name.nodeValue = r.id === localId ? `${r.name} (${STRINGS.you})` : r.name;
      row.time.nodeValue = formatTimeOrDash(r.timeMs);
      row.el.setAttribute('aria-rowindex', String(i + 2));
      row.el.classList.toggle('wr-row-local', r.id === localId);
      row.el.classList.toggle('wr-row-out', r.qualified === false);
    },
  });
  list.el.setAttribute('role', 'rowgroup');

  const header = h(
    doc,
    'div',
    { class: 'wr-row wr-row-head', role: 'row', 'aria-rowindex': 1 },
    h(doc, 'span', { class: 'wr-row-place', role: 'columnheader' }, STRINGS.resultsPlace),
    h(doc, 'span', { class: 'wr-row-name', role: 'columnheader' }, STRINGS.resultsName),
    h(doc, 'span', { class: 'wr-row-time', role: 'columnheader' }, STRINGS.resultsTime),
  );
  const table = h(
    doc,
    'div',
    { class: 'wr-results-table', role: 'table', 'aria-label': STRINGS.results },
    header,
    list.el,
  );

  const summaryPlace = h(doc, 'p', { class: 'wr-results-place' });
  const summaryTime = h(doc, 'p', { class: 'wr-results-time wr-mono' });
  const summaryBadge = h(doc, 'span', { class: 'wr-badge' });
  const summary = h(doc, 'div', { class: 'wr-results-summary' }, summaryPlace, summaryTime, summaryBadge);

  const findMe = button(doc, STRINGS.resultsFindMe, 'wr-btn-small', () => {
    const i = rows.findIndex((r) => r.id === localId);
    if (i >= 0) list.scrollToIndex(i);
  });
  const again = button(doc, STRINGS.resultsAgain, 'wr-btn-primary', () => events.emit('restart', undefined));
  const back = button(doc, STRINGS.resultsBack, '', () => events.emit('leave', undefined));

  const el = h(
    doc,
    'section',
    { class: 'wr-screen wr-results', 'aria-labelledby': 'wr-results-title' },
    h(
      doc,
      'div',
      { class: 'wr-card wr-results-card' },
      h(
        doc,
        'div',
        { class: 'wr-results-head' },
        h(doc, 'h2', { id: 'wr-results-title', class: 'wr-panel-title' }, STRINGS.results),
        findMe,
      ),
      summary,
      table,
      h(doc, 'div', { class: 'wr-actions' }, again, back),
    ),
  );

  return {
    el,
    show(props) {
      rows = props?.rows ?? [];
      localId = props?.localId;
      table.setAttribute('aria-rowcount', String(rows.length + 1));
      const me = rows.findIndex((r) => r.id === localId);
      summary.hidden = me < 0;
      findMe.hidden = me < 0;
      if (me >= 0) {
        const r = rows[me];
        summaryPlace.textContent = t('resultsYouPlaced', { place: ordinal(r.place) });
        summaryTime.textContent = formatTimeOrDash(r.timeMs);
        summaryBadge.hidden = r.qualified == null;
        summaryBadge.textContent = r.qualified ? STRINGS.resultsQualified : STRINGS.resultsEliminated;
        summaryBadge.dataset.kind = r.qualified ? 'in' : 'out';
      }
      again.hidden = !props?.solo;
      list.setCount(rows.length);
      if (me >= 0) requestAnimationFrame(() => list.scrollToIndex(me));
      focusSoon(props?.solo ? again : back);
    },
  };
}
