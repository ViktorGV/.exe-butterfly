// Lobby (#12): room header, player list, My Racer, theme vote (event mode) or host panel (open mode), ready toggle.
// mountLobby(container, { net, assets, previewFactory, minimapFactory }) -> { dispose() }. Phone-first plain DOM.
import { LIMITS, MAX_PLAYERS_PER_ROOM } from '@wobble/shared/constants';
import { THEME_CHOICES } from '../app/themes.ts';
import type { EventManifest, Pack, RoomState } from '@wobble/shared';
import { applyRoomFields, createPlayerStore, visibleRange } from './players.ts';
import type { RoomPatch } from './players.ts';
import { lobbyPermissions, phaseBanner } from './permissions.ts';
import type { LobbyMode } from './permissions.ts';
import { choose, createVoteModel, leader, onVoteResult, onVoteState, secondsLeft, shares } from './vote.ts';
import { genReduce, promptCounter, retryInSec } from './generate.ts';
import type { GenEvent, GenState } from './generate.ts';
import { LOBBY_CSS } from './styles.ts';
import type { LobbyOptions, PackSummary, Preview } from './types.ts';

export type { LobbyOptions, LobbyNet, LobbyAssets, Preview, PackSummary, WelcomeEvent } from './types.ts';
export { createPlayerStore, visibleRange } from './players.ts';
export { lobbyPermissions } from './permissions.ts';

const ROW_H = 44;

/** Placeholder 3D preview: a colour swatch. */
export function swatchPreview(skin: Pack | null, doc: Document): Preview {
  const el = doc.createElement('div');
  el.className = 'wl-preview';
  const data = skin?.kind === 'skin' ? (skin.data as { body?: { color?: string } }) : null;
  el.style.background = data?.body?.color ?? '#999';
  el.setAttribute('aria-label', skin ? `Preview of ${skin.name}` : 'No character yet');
  el.setAttribute('role', 'img');
  return { el, dispose: () => el.remove() };
}

/** Placeholder minimap: the course id as a chip. */
export function chipMinimap(courseId: string, doc: Document): Preview {
  const el = doc.createElement('div');
  el.className = 'wl-chips';
  el.textContent = courseId;
  return { el, dispose: () => el.remove() };
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  cls = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function btn(doc: Document, label: string, fn: () => void, cls = ''): HTMLButtonElement {
  const b = el(doc, 'button', `wl-btn ${cls}`, label);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}

export function mountLobby(container: HTMLElement, opts: LobbyOptions): { dispose(): void } {
  const { net, assets } = opts;
  const doc = container.ownerDocument;
  const previewFactory = opts.previewFactory ?? swatchPreview;
  const minimapFactory = opts.minimapFactory ?? chipMinimap;
  const now = () => net.serverNow?.() ?? Date.now();
  const offs: (() => void)[] = [];
  const disposers: (() => void)[] = [];

  let mode: LobbyMode = net.welcomeEvent || opts.vote ? 'event' : 'open';
  let manifest: EventManifest | null = null;
  let room: RoomState | null = null;
  let vote = createVoteModel();
  let gen: GenState = { s: 'idle' };
  let mySkinId: string | null = null;
  const store = createPlayerStore();

  const root = el(doc, 'div', 'wl-root');
  const style = el(doc, 'style');
  style.textContent = LOBBY_CSS;
  root.append(style);

  // ---- header
  const header = el(doc, 'header', 'wl-header');
  const code = el(doc, 'h2', 'wl-code');
  const count = el(doc, 'span', 'wl-count');
  const banner = el(doc, 'p', 'wl-banner');
  banner.setAttribute('role', 'status');
  const invite = btn(doc, 'Copy invite link', () => {
    if (!room) return;
    const link = opts.inviteLink?.(room.code) ?? `${location.origin}/?room=${room.code}`;
    const done = () => (invite.textContent = 'Link copied!');
    navigator.clipboard?.writeText(link).then(done, () => undefined);
  });
  header.append(code, count, invite, banner);

  // ---- My Racer
  const me = el(doc, 'section', 'wl-card wl-me');
  const meTitle = el(doc, 'h3', '', 'My Racer');
  const meBody = el(doc, 'div', 'wl-me-body');
  me.append(meTitle, meBody);

  // ---- theme vote / host panel
  const themes = el(doc, 'section', 'wl-card wl-themes');

  // ---- player list (virtualised)
  const listWrap = el(doc, 'section', 'wl-card wl-list-card');
  const listTitle = el(doc, 'h3', '', 'Players');
  const list = el(doc, 'div', 'wl-list');
  list.setAttribute('role', 'list');
  list.tabIndex = 0;
  const spacer = el(doc, 'div', 'wl-spacer');
  list.append(spacer);
  listWrap.append(listTitle, list);
  const rows = new Map<number, HTMLElement>();

  // ---- footer
  const footer = el(doc, 'footer', 'wl-footer');
  const readyBtn = btn(doc, 'Ready', () => {
    const p = store.get(net.playerId);
    net.setReady(!p?.ready);
  });
  readyBtn.setAttribute('aria-pressed', 'false');
  const startBtn = btn(doc, 'Start', () => (mode === 'event' ? net.startVote() : net.start()), 'wl-primary');
  footer.append(readyBtn, startBtn);

  root.append(header, me, themes, listWrap, footer);
  container.append(root);

  // ---------------------------------------------------------------- render
  function drawRow(row: HTMLElement, id: number) {
    const p = store.get(id);
    if (!p || !room) return;
    row.textContent = '';
    const sw = el(doc, 'span', 'wl-swatch');
    sw.dataset.skin = p.skinId;
    const name = el(doc, 'span', 'wl-name', p.name);
    row.append(sw, name);
    if (p.id === room.hostId) row.append(el(doc, 'span', 'wl-badge', 'Host'));
    row.append(el(doc, 'span', p.ready ? 'wl-ready on' : 'wl-ready', p.ready ? 'Ready' : '…'));
    row.classList.toggle('me', p.id === net.playerId);
  }

  function drawList() {
    const order = store.order;
    spacer.style.height = `${order.length * ROW_H}px`;
    const { start, end } = visibleRange(list.scrollTop, list.clientHeight || ROW_H * 8, ROW_H, order.length);
    const keep = new Set<number>();
    for (let i = start; i < end; i++) {
      const id = order[i]!;
      keep.add(id);
      let row = rows.get(id);
      if (!row) {
        row = el(doc, 'div', 'wl-row');
        row.setAttribute('role', 'listitem');
        rows.set(id, row);
        drawRow(row, id);
        list.append(row);
      }
      row.style.transform = `translateY(${i * ROW_H}px)`;
    }
    for (const [id, row] of rows) {
      if (keep.has(id)) continue;
      row.remove();
      rows.delete(id);
    }
  }
  list.addEventListener('scroll', drawList, { passive: true });

  function drawHeader() {
    if (!room) return;
    const perms = lobbyPermissions(room, net.playerId, mode, opts.publicRoom);
    code.textContent = `Room ${room.code}`;
    count.textContent = `${store.size} / ${MAX_PLAYERS_PER_ROOM}`;
    banner.textContent = phaseBanner(room.phase, perms.isHost, mode);
    const mine = store.get(net.playerId);
    readyBtn.textContent = mine?.ready ? 'Ready ✓' : 'Ready';
    readyBtn.setAttribute('aria-pressed', String(!!mine?.ready));
    readyBtn.disabled = !perms.canReady;
    const canStart = mode === 'event' ? perms.canStartVote : perms.canStart;
    startBtn.hidden = !canStart;
    startBtn.textContent = mode === 'event' ? 'Start vote' : `Start (${store.readyCount()} / ${store.size} ready)`;
  }

  // ---- My Racer: event mode
  let mePreview: Preview | null = null;
  let mePreviewKey = '';
  function setPreview(pack: Pack | null, key: string, host: HTMLElement) {
    if (key === mePreviewKey && mePreview) return;
    mePreview?.dispose();
    mePreview = previewFactory(pack, doc);
    mePreviewKey = key;
    host.append(mePreview.el);
  }

  function drawMeEvent() {
    const ev = net.welcomeEvent;
    meBody.textContent = '';
    mePreviewKey = '';
    if (!ev?.matched || !ev.previewSkins) {
      meBody.append(el(doc, 'p', 'wl-hint', "You'll get a surprise character in the winning theme"));
      return;
    }
    meBody.append(el(doc, 'p', 'wl-hint', 'We found your character!'));
    const themeId = leader(vote) ?? manifest?.themes[0]?.id ?? '';
    const skinId = ev.previewSkins[themeId];
    const host = el(doc, 'div');
    meBody.append(host);
    if (skinId) void assets.getPack(skinId).then((p) => setPreview(p, skinId, host));
  }

  // ---- My Racer: open mode
  let galleryCursor: string | null = null;
  const gallery = el(doc, 'div', 'wl-gallery');
  const more = btn(doc, 'More', () => void loadGallery());
  const prompt = el(doc, 'textarea', 'wl-prompt');
  prompt.maxLength = LIMITS.promptMax;
  prompt.placeholder = 'Describe your Racer';
  prompt.setAttribute('aria-label', 'Describe your Racer');
  const counter = el(doc, 'span', 'wl-counter', promptCounter(''));
  prompt.addEventListener('input', () => (counter.textContent = promptCounter(prompt.value)));
  const genBtn = btn(doc, 'Generate', () => void runGenerate(), 'wl-primary');
  const genStatus = el(doc, 'div', 'wl-gen');
  genStatus.setAttribute('aria-live', 'polite');

  function galleryCard(s: PackSummary): HTMLButtonElement {
    const b = btn(doc, s.name, () => {
      mySkinId = s.id;
      net.setSkin(s.id);
      for (const c of gallery.children) c.classList.toggle('on', (c as HTMLElement).dataset.id === s.id);
    });
    b.dataset.id = s.id;
    b.classList.add('wl-tile');
    b.style.setProperty('--sw', s.swatch[0] ?? '#999');
    b.classList.toggle('on', s.id === mySkinId);
    return b;
  }

  async function loadGallery(reset = false) {
    if (reset) {
      gallery.textContent = '';
      galleryCursor = null;
    }
    try {
      const page = await assets.list('skin', galleryCursor);
      for (const s of page.items) gallery.append(galleryCard(s));
      galleryCursor = page.nextCursor;
      more.hidden = !galleryCursor;
    } catch {
      more.hidden = true;
    }
  }

  function dispatchGen(ev: GenEvent) {
    gen = genReduce(gen, ev);
    drawGen();
  }

  async function runGenerate() {
    const before = gen;
    dispatchGen({ e: 'submit', prompt: prompt.value });
    if (gen === before || gen.s !== 'generating') return;
    try {
      const pack = await assets.generate('skin', gen.prompt);
      dispatchGen({ e: 'done', pack });
    } catch (err) {
      dispatchGen({ e: 'fail', err, now: Date.now() });
    }
  }

  let genTimer: ReturnType<typeof setInterval> | null = null;
  function drawGen() {
    genStatus.textContent = '';
    genBtn.disabled = gen.s === 'generating' || gen.s === 'rateLimited';
    if (genTimer && gen.s !== 'rateLimited') {
      clearInterval(genTimer);
      genTimer = null;
    }
    const msg = (t: string, cls = '') => genStatus.append(el(doc, 'p', `wl-msg ${cls}`, t));
    switch (gen.s) {
      case 'idle':
        return;
      case 'generating':
        return msg('Making your Racer…', 'busy');
      case 'rateLimited':
        msg(`Easy there! Try again in ${retryInSec(gen, Date.now())} s.`, 'warn');
        genTimer ??= setInterval(() => dispatchGen({ e: 'tick', now: Date.now() }), 1000);
        return;
      case 'refused':
        return msg(gen.message, 'warn');
      case 'unavailable':
        return msg('The character maker is resting. Pick one from the gallery for now.', 'warn');
      case 'error':
        return msg(gen.message, 'warn');
      case 'preview':
      case 'equipped': {
        const pack = gen.pack;
        const p = previewFactory(pack, doc);
        disposers.push(p.dispose);
        genStatus.append(p.el);
        if (gen.s === 'preview') {
          genStatus.append(
            btn(
              doc,
              'Equip',
              () => {
                mySkinId = pack.id;
                net.setSkin(pack.id);
                dispatchGen({ e: 'equip' });
                void loadGallery(true);
              },
              'wl-primary',
            ),
          );
        } else msg('Equipped!');
        const rep: HTMLButtonElement = btn(doc, 'Report', () => {
          rep.disabled = true;
          rep.textContent = 'Reported';
          void assets.report(pack.id).catch(() => undefined);
        });
        genStatus.append(rep);
      }
    }
  }

  function drawMeOpen() {
    meBody.textContent = '';
    const row = el(doc, 'div', 'wl-gen-row');
    meBody.append(gallery, more);
    // Generating a skin from a prompt (and reporting one) is a future feature: off unless `generate` is set.
    if (opts.generate) {
      row.append(prompt, counter, genBtn);
      meBody.append(row, genStatus);
    }
    if (!gallery.childElementCount) void loadGallery(true);
  }

  // ---- themes: event vote
  const voteCards = new Map<string, { card: HTMLButtonElement; bar: HTMLElement; n: HTMLElement }>();
  const countdown = el(doc, 'p', 'wl-countdown');
  countdown.setAttribute('aria-live', 'polite');

  function drawVoteCards() {
    themes.textContent = '';
    voteCards.clear();
    themes.append(el(doc, 'h3', '', 'Theme vote'), countdown);
    const grid = el(doc, 'div', 'wl-vote-grid');
    for (const t of manifest?.themes ?? []) {
      const card = btn(doc, '', () => {
        const next = choose(vote, t.id);
        if (!next) return;
        vote = next;
        net.vote(t.id);
        drawVote();
      });
      card.classList.add('wl-vote');
      card.dataset.id = t.id;
      const img = el(doc, 'img');
      img.src = t.voteCard;
      img.alt = '';
      img.loading = 'lazy';
      const sw = el(doc, 'div', 'wl-sw');
      for (const c of t.swatch) {
        const dot = el(doc, 'span');
        dot.style.background = c;
        sw.append(dot);
      }
      const bar = el(doc, 'div', 'wl-bar');
      const n = el(doc, 'span', 'wl-tally', '0');
      card.append(img, el(doc, 'strong', '', t.title), el(doc, 'span', 'wl-tag', t.tagline));
      if (t.credit) card.append(el(doc, 'span', 'wl-credit', `by ${t.credit}`));
      const mine = net.welcomeEvent?.matched ? net.welcomeEvent.previewSkins?.[t.id] : undefined;
      if (mine) card.append(el(doc, 'span', 'wl-mine', 'Your character is ready'));
      card.append(sw, bar, n);
      grid.append(card);
      voteCards.set(t.id, { card, bar, n });
    }
    themes.append(grid);
    drawVote();
  }

  function drawVote() {
    const sh = shares(vote);
    const canVote = room ? lobbyPermissions(room, net.playerId, mode).canVote : false;
    for (const [id, v] of voteCards) {
      const i = vote.options.indexOf(id);
      v.bar.style.width = `${Math.round((sh[i] ?? 0) * 100)}%`;
      v.n.textContent = String(vote.tallies[i] ?? 0);
      v.card.classList.toggle('on', vote.myChoice === id);
      v.card.classList.toggle('win', vote.winner === id);
      v.card.setAttribute('aria-pressed', String(vote.myChoice === id));
      v.card.disabled = !canVote && vote.phase !== 'reveal';
    }
    if (vote.phase === 'reveal') {
      const t = manifest?.themes.find((x) => x.id === vote.winner);
      countdown.textContent = `The winner is ${t?.title ?? vote.winner}!`;
      themes.classList.add('reveal');
    } else if (vote.phase === 'voting') countdown.textContent = `${secondsLeft(vote, now())} s left`;
    else countdown.textContent = 'Vote opens soon';
  }

  // ---- themes: open-mode host panel
  const themeButtons = new Map<string, HTMLButtonElement>();
  let minimap: Preview | null = null;
  function drawHostPanel() {
    themes.textContent = '';
    themeButtons.clear();
    themes.append(el(doc, 'h3', '', 'Theme'));
    const grid = el(doc, 'div', 'wl-theme-grid');
    grid.setAttribute('role', 'radiogroup');
    // The same themes as the title screen: Classic plus the event themes shipped with the game.
    for (const t of THEME_CHOICES) {
      const b = btn(doc, t.title, () => {
        if (!room || !lobbyPermissions(room, net.playerId, mode).canPickTheme) return;
        net.setConfig({ courseId: room.config.courseId, themeId: t.id });
      });
      b.classList.add('wl-tile');
      b.setAttribute('role', 'radio');
      b.style.setProperty('--sw', t.color);
      b.style.setProperty('--sw2', t.color);
      if (t.card) b.style.backgroundImage = `url("${t.card}")`;
      if (t.card) b.style.backgroundSize = 'cover';
      grid.append(b);
      themeButtons.set(t.id, b);
    }
    themes.append(grid, el(doc, 'h3', '', 'Course'));
    minimap?.dispose();
    minimap = room ? minimapFactory(room.config.courseId, doc) : null;
    if (minimap) themes.append(minimap.el);
    syncHostPanel();
  }

  function syncHostPanel() {
    if (!room) return;
    const can = lobbyPermissions(room, net.playerId, mode).canPickTheme;
    for (const [id, b] of themeButtons) {
      const on = room.config.themeId === id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.disabled = !can && !on;
      b.setAttribute('aria-disabled', String(!can));
    }
  }

  // ---------------------------------------------------------------- events
  let built = '';
  function rebuild() {
    const key = `${mode}:${manifest ? 1 : 0}`;
    if (key === built) return;
    built = key;
    if (mode === 'event') {
      // A theme vote outside event mode keeps the skin gallery: no server-assigned character.
      if (net.welcomeEvent) drawMeEvent();
      else drawMeOpen();
      drawVoteCards();
    } else {
      drawMeOpen();
      drawHostPanel();
    }
  }

  function onRoom(r: RoomState) {
    room = { ...r, players: [] };
    store.reset(r.players);
    for (const row of rows.values()) row.remove();
    rows.clear();
    mySkinId = store.get(net.playerId)?.skinId ?? mySkinId;
    rebuild();
    drawHeader();
    drawList();
    if (mode === 'open') syncHostPanel();
    // A host whose room still has the default theme brings their title-screen pick, once.
    const preferred = opts.preferredThemeId;
    if (!sentPreferred && preferred && mode === 'open' && r.config.themeId !== preferred) {
      if (lobbyPermissions(room, net.playerId, mode).canPickTheme) {
        sentPreferred = true;
        net.setConfig({ courseId: r.config.courseId, themeId: preferred });
      }
    }
  }
  let sentPreferred = false;

  function onPatch(p: RoomPatch) {
    if (!room) return;
    applyRoomFields(room, p);
    const res = store.apply(p);
    for (const id of res.changed) {
      const row = rows.get(id);
      if (row) drawRow(row, id);
    }
    if (p.hostId !== undefined) for (const [id, row] of rows) drawRow(row, id);
    if (res.orderChanged) drawList();
    drawHeader();
    if (mode === 'open' && (p.config || p.phase || p.hostId !== undefined)) syncHostPanel();
    if (mode === 'event' && p.phase) drawVote();
  }

  offs.push(
    net.on('room', onRoom),
    net.on('roomPatch', onPatch),
    net.on('vote', (s) => {
      const lead = leader(vote);
      vote = onVoteState(vote, s);
      drawVote();
      if (leader(vote) !== lead) drawMeEvent();
    }),
    net.on('voteResult', (r) => {
      vote = onVoteResult(vote, r);
      drawVote();
      drawMeEvent();
    }),
  );

  const tick = setInterval(() => {
    if (vote.phase === 'voting') drawVote();
  }, 250);

  void assets
    .eventManifest()
    .then((m) => {
      manifest = m;
      if (m && (net.welcomeEvent || opts.vote)) mode = 'event';
      rebuild();
      drawHeader();
    })
    .catch(() => rebuild());

  return {
    dispose() {
      for (const off of offs) off();
      clearInterval(tick);
      if (genTimer) clearInterval(genTimer);
      for (const d of disposers) d();
      mePreview?.dispose();
      minimap?.dispose();
      root.remove();
    },
  };
}
