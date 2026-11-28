// Title screen: wordmark, name, Join room, Join with code, Create room, Solo practice, Settings.
import { LIMITS } from '@wobble/shared/constants';
import { button, h } from '../dom.ts';
import { isValidRoomCode, loadName, sanitizeName, sanitizeRoomCode, saveName } from '../settings.ts';
import { STRINGS } from '../strings.ts';
import type { TitleProps } from '../types.ts';
import { focusSoon, type Screen, type ScreenContext } from './context.ts';

export function createWordmark(doc: Document): HTMLElement {
  const letters = Array.from(STRINGS.wordmarkTop).map((ch, i) =>
    h(doc, 'span', { class: 'wr-mark-letter', style: `--i:${i}` }, ch),
  );
  return h(
    doc,
    'h1',
    { class: 'wr-mark', 'aria-label': STRINGS.appName },
    h(doc, 'span', { class: 'wr-mark-top', 'aria-hidden': 'true' }, ...letters),
    h(
      doc,
      'span',
      { class: 'wr-mark-bottom', 'aria-hidden': 'true' },
      h(doc, 'span', { class: 'wr-mark-badge' }, STRINGS.wordmarkBadge),
    ),
  );
}

export function createTitleScreen(ctx: ScreenContext): Screen<TitleProps> {
  const { doc, events, store } = ctx;
  const nameInput = h(doc, 'input', {
    id: 'wr-name',
    class: 'wr-input',
    type: 'text',
    maxlength: LIMITS.nameMax,
    autocomplete: 'nickname',
    autocapitalize: 'words',
    spellcheck: 'false',
    enterkeyhint: 'go',
    placeholder: STRINGS.namePlaceholder,
  });
  nameInput.value = loadName(store);
  const nameLabel = h(doc, 'label', { class: 'wr-label', for: 'wr-name' }, STRINGS.nameLabel);

  const name = () => {
    const n = sanitizeName(nameInput.value);
    saveName(store, nameInput.value.trim() ? n : '');
    return n;
  };

  const codeInput = h(doc, 'input', {
    id: 'wr-code',
    class: 'wr-input wr-input-code',
    type: 'text',
    maxlength: 5,
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    enterkeyhint: 'go',
    inputmode: 'text',
    placeholder: STRINGS.codePlaceholder,
    'aria-describedby': 'wr-code-err',
  });
  const codeErr = h(doc, 'p', { id: 'wr-code-err', class: 'wr-field-error', role: 'alert' });
  codeInput.addEventListener('input', () => {
    const v = sanitizeRoomCode(codeInput.value);
    if (v !== codeInput.value) codeInput.value = v;
    codeErr.textContent = '';
  });
  const submitCode = () => {
    const code = sanitizeRoomCode(codeInput.value);
    if (!isValidRoomCode(code)) {
      codeErr.textContent = STRINGS.codeInvalid;
      codeInput.focus();
      return;
    }
    events.emit('play:join', { name: name(), code });
  };
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitCode();
    else if (e.key === 'Escape') toggleJoin(false);
  });

  const joinRow = h(
    doc,
    'div',
    { class: 'wr-join', hidden: true },
    h(doc, 'label', { class: 'wr-label', for: 'wr-code' }, STRINGS.codeLabel),
    h(
      doc,
      'div',
      { class: 'wr-join-row' },
      codeInput,
      button(doc, STRINGS.join, 'wr-btn-primary', submitCode),
      button(doc, STRINGS.cancel, 'wr-btn-ghost', () => toggleJoin(false)),
    ),
    codeErr,
  );

  const quick = button(doc, STRINGS.quickPlay, 'wr-btn-primary wr-btn-big', () =>
    events.emit('play:quick', { name: name() }),
  );
  const joinBtn = button(doc, STRINGS.joinWithCode, '', () => toggleJoin(true));
  joinBtn.setAttribute('aria-expanded', 'false');

  function toggleJoin(open: boolean) {
    joinRow.hidden = !open;
    joinBtn.hidden = open;
    joinBtn.setAttribute('aria-expanded', String(open));
    codeErr.textContent = '';
    if (open) codeInput.focus();
    else focusSoon(joinBtn);
  }

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') quick.click();
  });

  const el = h(
    doc,
    'section',
    { class: 'wr-screen wr-title', 'aria-label': STRINGS.appName },
    h(
      doc,
      'div',
      { class: 'wr-title-brand' },
      createWordmark(doc),
      h(doc, 'p', { class: 'wr-tagline' }, STRINGS.tagline),
    ),
    h(
      doc,
      'div',
      { class: 'wr-title-menu' },
      h(doc, 'div', { class: 'wr-field' }, nameLabel, nameInput),
      quick,
      joinBtn,
      joinRow,
      h(
        doc,
        'div',
        { class: 'wr-btn-grid' },
        button(doc, STRINGS.createRoom, '', () => events.emit('play:create', { name: name() })),
        button(doc, STRINGS.soloPractice, '', () => events.emit('play:solo', { name: name() })),
      ),
      button(doc, STRINGS.settings, 'wr-btn-ghost', () => ctx.open('settings')),
    ),
  );

  return {
    el,
    show(props) {
      nameLabel.textContent = props?.eventMode ? STRINGS.nameLabelEvent : STRINGS.nameLabel;
      if (props?.name != null) nameInput.value = sanitizeName(props.name, '');
      toggleJoinSilently();
      focusSoon(quick);
    },
  };

  function toggleJoinSilently() {
    joinRow.hidden = true;
    joinBtn.hidden = false;
    joinBtn.setAttribute('aria-expanded', 'false');
  }
}
