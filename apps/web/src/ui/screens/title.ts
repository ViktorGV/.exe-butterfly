// Title screen: wordmark, name, character, Join with code (main), Create room, Settings. (No Solo practice
// button: the game still handles 'play:solo', but the menu does not offer it.)
import { BUILTIN_SKIN_PACKS, skinSwatch } from '@wobble/shared/assets/index';
import type { SkinDef } from '@wobble/shared/types';
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

  // Character picker: the chosen skin is remembered and sent to the room when you join or create a room.
  const SKIN_KEY = 'wr.skin';
  const skins = BUILTIN_SKIN_PACKS.filter((p) => !p.id.startsWith('b:fixture'));
  let skinId = skins[0]?.id ?? '';
  try {
    const saved = store?.getItem(SKIN_KEY);
    if (saved && skins.some((p) => p.id === saved)) skinId = saved;
  } catch {
    // storage blocked: first character
  }
  const skinBtns = skins.map((p) => {
    const sw = skinSwatch(p.data as SkinDef);
    const b = button(doc, '', 'wr-theme-card', () => {
      skinId = p.id;
      try {
        store?.setItem(SKIN_KEY, p.id);
      } catch {
        // not remembered
      }
      skinBtns.forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    });
    b.title = p.name;
    b.setAttribute('aria-label', p.name);
    b.setAttribute('aria-pressed', String(p.id === skinId));
    b.style.setProperty('--card-color', sw.colors[0] ?? '#ccc');
    b.append(h(doc, 'span', { class: 'wr-theme-name' }, p.name));
    return b;
  });
  const skinField = h(
    doc,
    'div',
    { class: 'wr-field' },
    h(doc, 'span', { class: 'wr-label' }, 'Character'),
    h(doc, 'div', { class: 'wr-theme-grid', role: 'group', 'aria-label': 'Character' }, ...skinBtns),
  );

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
    events.emit('play:join', { name: name(), code, skinId });
  };
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitCode();
  });

  // The main option, right under the name: the room code on the left, Join with code on the right.
  const joinBtn = button(doc, STRINGS.joinWithCode, 'wr-btn-primary wr-btn-big', submitCode);
  const joinRow = h(
    doc,
    'div',
    { class: 'wr-field wr-join-main' },
    h(doc, 'label', { class: 'wr-label', for: 'wr-code' }, STRINGS.codeLabel),
    h(doc, 'div', { class: 'wr-join-main-row' }, codeInput, joinBtn),
    codeErr,
  );

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') codeInput.focus();
  });

  const el = h(
    doc,
    'section',
    { class: 'wr-screen wr-title', 'aria-label': STRINGS.appName },
    h(doc, 'div', { class: 'wr-title-brand' }, createWordmark(doc)),
    h(
      doc,
      'div',
      { class: 'wr-title-menu' },
      h(doc, 'div', { class: 'wr-field' }, nameLabel, nameInput),
      skinField,
      joinRow,
      button(doc, STRINGS.createRoom, '', () => events.emit('play:create', { name: name(), skinId })),
      button(doc, STRINGS.settings, '', () => ctx.open('settings')),
    ),
  );

  return {
    el,
    show(props) {
      nameLabel.textContent = props?.eventMode ? STRINGS.nameLabelEvent : STRINGS.nameLabel;
      if (props?.name != null) nameInput.value = sanitizeName(props.name, '');
      codeErr.textContent = '';
      focusSoon(codeInput);
    },
  };
}
