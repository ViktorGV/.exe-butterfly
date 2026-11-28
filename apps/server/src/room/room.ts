// One room: members, lobby, and the phase machine lobby -> loading -> countdown -> race -> results -> lobby.
// Race rules live behind createRaceSession (race/index.ts seam); this file only drives it.
import { SNAPSHOT_HZ, VOTE } from '@wobble/shared/constants';
import { VOTE_THEME_IDS } from '@wobble/shared/assets/voteThemes';
import type { ClientMessage, RaceResult, RoomState, ServerMessage } from '@wobble/shared/types';
import { createButterflyServer } from '../butterfly/index.ts';
import { createVillain } from '../butterfly/villain.ts';
import { createFadeWatch, type FadeWatch } from '../race/fade.ts';
import type { Villain } from '../butterfly/villain.ts';
import type { ButterflyServer } from '../butterfly/index.ts';
import type { ServerMetrics } from '../metrics/index.ts';
import { createRaceSession } from '../race/index.ts';
import type { RaceSessionExt } from '../race/index.ts';
import { overSoftLimit } from '../transport/options.ts';
import { createStateDecoder } from '../transport/stateFrame.ts';
import type { ResolveCourse } from './courses.ts';
import { DEFAULT_COURSE_ID } from './courses.ts';
import { uniqueName } from './names.ts';
import { createPatchBatcher } from './patchBatcher.ts';
import type { RoomPhase } from './patchBatcher.ts';
import { graceMs } from './reconnect.ts';
import { createTickLoop } from './tickLoop.ts';
import { createThemeVote } from './vote.ts';
import type { ThemeVote } from './vote.ts';

export { DEFAULT_SKIN_ID, DEFAULT_THEME_ID } from '@wobble/shared/assets/index';
import { DEFAULT_THEME_ID, pickStarterSkin } from '@wobble/shared/assets/index';

/** The room's view of one socket; the transport adapts Bun's ServerWebSocket to it. */
export interface Peer {
  /** Bun semantics: bytes sent, -1 queued (backpressure), 0 dropped. */
  send(data: string | Uint8Array): number;
  buffered(): number;
  close(code?: number, reason?: string): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
}

export interface RoomTimings {
  /** Longest wait for `loaded` before the countdown starts anyway. */
  loadingMaxMs: number;
  /** Countdown length. */
  countdownMs: number;
  resultsMs: number;
  /** Public rooms start by themselves this long after two players are present; 0 (default) leaves it to the host. */
  autoStartMs: number;
  /** A disconnected player keeps their seat this long. */
  reconnectMs: number;
  /** Grace in the lobby (default 5 s, capped at reconnectMs); see reconnect.ts. */
  lobbyReconnectMs?: number;
  /** Hard stop for a race. */
  timeLimitMs: number;
  /** Length of the lobby theme vote (default VOTE.durationSec). */
  voteMs?: number;
}

export const DEFAULT_TIMINGS: RoomTimings = Object.freeze({
  loadingMaxMs: 15_000,
  countdownMs: 3000,
  resultsMs: 20_000,
  autoStartMs: 0,
  reconnectMs: 15_000,
  timeLimitMs: 240_000, // races end after 4 minutes
});

/** Share of match players whose `loaded` ends the loading phase early. */
export const LOADED_QUORUM = 0.9;

export interface Member {
  readonly id: number;
  readonly token: string;
  name: string;
  skinId: string;
  ready: boolean;
  connected: boolean;
  peer: Peer | null;
  /** Part of the running match (false for players who joined mid-match). */
  inMatch: boolean;
  loaded: boolean;
  slot: number;
  graceTimer: ReturnType<typeof setTimeout> | null;
  /** A load-test bot (clientId "bot-..."): never chosen as host while a human is connected. */
  bot?: boolean;
  /** The browser's stable id: a new join replaces a disconnected seat that has the same one. */
  clientId?: string;
}

export interface RoomOptions {
  id: string;
  code: string;
  isPublic: boolean;
  maxPlayers: number;
  timings: RoomTimings;
  resolveCourse: ResolveCourse;
  /** Sends the same bytes to every subscriber of `topic` (server.publish). */
  publish(topic: string, data: string): void;
  /** Counters for /healthz (#73). Optional so rooms can run without them in tests. */
  metrics?: ServerMetrics;
  /** Theme ids of the lobby vote. Default VOTE_THEME_IDS. */
  voteOptions?: readonly string[];
  /** Called once when the last member is gone; the room is disposed afterwards. */
  onEmpty(room: Room): void;
}

export type Room = ReturnType<typeof createRoom>;

const encode = (msg: ServerMessage): string => JSON.stringify(msg);

export function createRoom(opts: RoomOptions) {
  const { id, code, isPublic, maxPlayers, timings } = opts;
  const topic = `room:${id}`;
  const members = new Map<number, Member>(); // insertion order = join order
  let phase: RoomPhase = 'lobby';
  let hostId = 0;
  const config = { courseId: DEFAULT_COURSE_ID, themeId: DEFAULT_THEME_ID };
  let nextId = 1;
  let disposed = false;
  let phaseTimer: ReturnType<typeof setTimeout> | null = null;
  let autoStartTimer: ReturnType<typeof setTimeout> | null = null;
  let vote: ThemeVote | null = null;
  let voteTimer: ReturnType<typeof setInterval> | null = null;
  /** Theme ids players vote among; replaceable per room for tests. */
  const voteOptions = opts.voteOptions ?? VOTE_THEME_IDS;
  let session: RaceSessionExt | null = null;
  let startAt = 0;
  let matchSize = 0;
  let butterfly: ButterflyServer | null = null;
  let villain: Villain | null = null;
  /** Fading tiles: who stepped where (null outside a race). */
  let fade: FadeWatch | null = null;
  /** Players who finished: the villain stops throwing at them. */
  const finishedIds = new Set<number>();
  /** The checkpoint that starts the final section (the one before the last): the villain and the hero act from here. */
  let finalSectionCheckpoint = 0;
  /** Players the hero's bridge was already sent to (each gets it once). */
  const heroSent = new Set<number>();
  let dropped = 0;
  const decode = createStateDecoder();

  const batcher = createPatchBatcher({ publish: (msg) => opts.publish(topic, encode(msg)) });
  const metrics = opts.metrics;
  const loop = createTickLoop({
    hz: SNAPSHOT_HZ,
    onTick: () => {
      const t0 = performance.now();
      tick(Date.now());
      metrics?.tick(performance.now() - t0);
    },
  });

  // ---- helpers -------------------------------------------------------------

  const send = (m: Member, msg: ServerMessage) => {
    if (!m.peer) return;
    const text = encode(msg);
    m.peer.send(text);
    metrics?.sent(text.length);
  };
  const error = (m: Member, code: string, msg: string) => send(m, { t: 'error', code, msg });
  const connectedCount = () => {
    let n = 0;
    for (const m of members.values()) if (m.connected) n++;
    return n;
  };
  const clearTimer = (t: ReturnType<typeof setTimeout> | null) => {
    if (t) clearTimeout(t);
    return null;
  };

  function setPhase(next: RoomPhase) {
    phase = next;
    batcher.setPhase(next);
  }

  function setPhaseTimer(ms: number, fn: () => void) {
    phaseTimer = clearTimer(phaseTimer);
    phaseTimer = setTimeout(() => {
      phaseTimer = null;
      fn();
    }, ms);
  }

  function allocId(): number {
    for (;;) {
      const pid = nextId;
      nextId = nextId >= 65535 ? 1 : nextId + 1;
      if (!members.has(pid)) return pid;
    }
  }

  function migrateHost() {
    const current = members.get(hostId);
    if (current?.connected && !current.bot) return;
    // Prefer a connected human: load-test bots never press start, so a bot host leaves the room stuck.
    let next: Member | undefined;
    for (const m of members.values()) {
      if (m.connected && !m.bot) {
        next = m;
        break;
      }
    }
    if (!next && current?.connected) return; // only bots are connected: the current one keeps host
    if (!next) {
      for (const m of members.values()) {
        if (m.connected) {
          next = m;
          break;
        }
      }
    }
    next ??= members.values().next().value;
    if (next && next.id !== hostId) {
      hostId = next.id;
      batcher.setHost(hostId);
    }
  }

  function sendDroppable(m: Member, data: string | Uint8Array) {
    const peer = m.peer;
    if (!peer) return;
    // slow client: skip this frame rather than queue it; Bun closes the socket at the hard limit
    if (overSoftLimit(peer.buffered())) {
      dropped++;
      metrics?.dropped();
      return;
    }
    peer.send(data);
    metrics?.sent(typeof data === 'string' ? data.length : data.byteLength);
  }

  // ---- lobby ---------------------------------------------------------------

  function maybeAutoStart() {
    if (!isPublic || phase !== 'lobby' || timings.autoStartMs <= 0) return;
    const n = connectedCount();
    if (n >= maxPlayers) {
      autoStartTimer = clearTimer(autoStartTimer);
      startVote();
    } else if (n >= 2) {
      // everyone in the room is ready (joining makes you ready), so open the theme vote
      autoStartTimer ??= setTimeout(() => {
        autoStartTimer = null;
        startVote();
      }, timings.autoStartMs);
    } else {
      autoStartTimer = clearTimer(autoStartTimer);
    }
  }

  // ---- theme vote ----------------------------------------------------------

  function startVote() {
    if (phase !== 'lobby' || disposed || vote) return;
    autoStartTimer = clearTimer(autoStartTimer);
    vote = createThemeVote(voteOptions, Date.now() + (timings.voteMs ?? VOTE.durationSec * 1000));
    setPhase('voting');
    publishVoteState();
    voteTimer = setInterval(() => {
      if (!vote) return;
      if (Date.now() >= vote.endsAt) endVote();
      else publishVoteState();
    }, 1000 / VOTE.stateHz);
  }

  function publishVoteState() {
    if (!vote) return;
    opts.publish(
      topic,
      encode({ t: 'voteState', options: [...vote.options], tallies: vote.tallies(), endsAt: vote.endsAt }),
    );
  }

  function endVote() {
    if (voteTimer) clearInterval(voteTimer);
    voteTimer = null;
    const v = vote;
    vote = null;
    if (!v || disposed) return;
    config.themeId = v.winner();
    batcher.setConfig(config);
    opts.publish(topic, encode({ t: 'voteResult', themeId: config.themeId, tallies: v.tallies() }));
    setPhase('lobby');
    // one stage: the vote picks the theme, then a single race like a plain start
    void startMatch();
  }

  // ---- match ---------------------------------------------------------------

  async function startMatch() {
    if (phase !== 'lobby' || disposed) return;
    const players: Member[] = [];
    for (const m of members.values()) {
      m.inMatch = m.connected;
      m.loaded = false;
      if (m.connected) {
        m.slot = players.length;
        players.push(m);
      }
    }
    if (players.length === 0) return;
    autoStartTimer = clearTimer(autoStartTimer);
    matchSize = players.length;
    setPhase('loading');
    const course = await opts.resolveCourse(config.courseId);
    if (disposed || (phase as RoomPhase) !== 'loading') return; // the room may have moved on while awaiting

    const qualifyCount = Math.max(1, Math.ceil(matchSize / 2));
    const matchConfig = encode({
      t: 'matchConfig',
      courseId: config.courseId,
      themeId: config.themeId,
      qualifyCount,
      players: players.map((m) => ({ id: m.id, slot: m.slot, skinId: m.skinId, name: m.name })),
    });
    for (const m of players) m.peer?.send(matchConfig);

    butterfly = createButterflyServer({
      session: () => session,
      send: (pid, msg) => {
        const target = members.get(pid);
        if (target) send(target, msg);
      },
      publish: (msg) => opts.publish(topic, encode(msg)),
      racers: () => members.keys(),
      isRacing: (pid) => {
        const m = members.get(pid);
        return !!m && m.inMatch && m.connected && !finishedIds.has(pid);
      },
    });
    finishedIds.clear();
    finalSectionCheckpoint = Math.max(0, course.checkpoints.length - 2);
    heroSent.clear();
    villain = createVillain({
      playerIds: () => players.map((m) => m.id),
      getPosition: (pid, out) => session?.getPosition(pid, out) ?? false,
      isMarked: (pid) => butterfly?.isMarked(pid) ?? false,
      storm: () => butterfly?.storm ?? 0,
      isTargetable: (pid) => {
        const m = members.get(pid);
        return !!m && m.inMatch && m.connected && !finishedIds.has(pid);
      },
      send: (pid, msg) => {
        const target = members.get(pid);
        if (target) send(target, msg);
      },
      publish: (msg) => opts.publish(topic, encode(msg)),
    });
    fade = createFadeWatch(course, (msg) => opts.publish(topic, encode(msg)));
    session = createRaceSession({
      course,
      players: players.map((m) => ({ id: m.id, slot: m.slot })),
      config: { qualifyCount, timeLimitMs: timings.timeLimitMs },
      send: (pid, data) => {
        const m = members.get(pid);
        if (m) sendDroppable(m, data);
      },
      onEvent: onRaceEvent,
    });
    for (const m of players) if (!m.connected) session.setConnected(m.id, false);
    setPhaseTimer(timings.loadingMaxMs, beginCountdown);
    checkLoaded();
  }

  function checkLoaded() {
    if (phase !== 'loading' || !session) return;
    let loaded = 0;
    for (const m of members.values()) if (m.inMatch && m.loaded) loaded++;
    if (loaded >= Math.ceil(matchSize * LOADED_QUORUM)) beginCountdown();
  }

  function beginCountdown() {
    if (phase !== 'loading' || !session) return;
    phaseTimer = clearTimer(phaseTimer);
    startAt = Date.now() + timings.countdownMs;
    session.start(startAt);
    setPhase('countdown');
    const msg = encode({ t: 'countdown', startAt });
    for (const m of members.values()) if (m.inMatch) m.peer?.send(msg);
    loop.start();
  }

  function tick(now: number) {
    if (!session) return;
    if (phase === 'countdown' && now >= startAt) setPhase('race');
    session.tick(now);
    if (phase === 'race') villain?.tick(now);
    const race = session;
    if (phase === 'race') fade?.tick((now - startAt) / 1000, racingIds(), (id, out) => race.getPosition(id, out));
    if (phase === 'race' && !session.finished && now >= startAt + timings.timeLimitMs) endRace(session.results());
  }

  /** Players still racing: in the match, connected, not finished. */
  function* racingIds() {
    for (const m of members.values()) if (m.inMatch && m.connected && !finishedIds.has(m.id)) yield m.id;
  }

  function onRaceEvent(evt: { type: string; [k: string]: unknown }) {
    switch (evt.type) {
      case 'raceEnd':
        endRace((evt.results as RaceResult[] | undefined) ?? session?.results() ?? []);
        break;
      case 'finished':
        finishedIds.add(evt.id as number);
        opts.publish(
          topic,
          encode({ t: 'finished', id: evt.id as number, place: evt.place as number, timeMs: evt.timeMs as number }),
        );
        break;
      case 'checkpoint': {
        // The first player to enter the final section brings the villain out.
        const inFinal = (evt.index as number) >= finalSectionCheckpoint;
        if (inFinal) villain?.activate(Date.now());
        // The race session already sent the checkpoint message to the player; sending it again showed the pop-up twice.
        const m = members.get(evt.id as number);
        // A player who helped others and never pushed gets the hero's bridge as they enter the final section.
        if (m && inFinal && !heroSent.has(evt.id as number)) {
          const saves = butterfly?.heroHelp(evt.id as number) ?? 0;
          if (saves > 0) {
            heroSent.add(evt.id as number);
            send(m, { t: 'hero', saves });
          }
        }
        break;
      }
      case 'kick':
        members.get(evt.id as number)?.peer?.close(4009, 'kicked');
        break;
      case 'respawn':
        butterfly?.respawned(evt.id as number, evt.save === true);
        break;
    }
  }

  function endRace(results: RaceResult[]) {
    if (phase !== 'race' && phase !== 'countdown') return;
    loop.stop();
    session = null;
    villain = null;
    fade = null;
    setPhase('results');
    opts.publish(topic, encode({ t: 'raceEnd', results: butterfly ? butterfly.withStats(results) : results }));
    setPhaseTimer(timings.resultsMs, backToLobby);
  }

  function backToLobby() {
    if (disposed) return;
    loop.stop();
    session = null;
    villain = null;
    fade = null;
    setPhase('lobby');
    for (const m of members.values()) {
      m.inMatch = false;
      m.loaded = false;
    }
    maybeAutoStart();
  }

  // ---- membership ----------------------------------------------------------

  function state(): RoomState {
    return {
      id,
      code,
      phase,
      hostId,
      config: { ...config },
      players: [...members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        skinId: m.skinId,
        ready: m.ready,
        connected: m.connected,
      })),
    };
  }

  function welcome(m: Member, peer: Peer) {
    m.peer = peer;
    peer.subscribe(topic);
    peer.send(encode({ t: 'welcome', playerId: m.id, token: m.token, room: state() }));
  }

  function join(peer: Peer, rawName: string, bot = false, clientId?: string): Member {
    const ghosts = clientId ? [...members.values()].filter((x) => !x.connected && x.clientId === clientId) : [];
    const pid = allocId();
    const m: Member = {
      id: pid,
      token: crypto.randomUUID(),
      name: uniqueName(
        rawName,
        Array.from(members.values(), (x) => (ghosts.includes(x) ? '' : x.name)),
      ),
      skinId: pickStarterSkin(Array.from(members.values(), (x) => (ghosts.includes(x) ? '' : x.skinId))),
      ready: true,
      connected: true,
      peer: null,
      inMatch: false,
      loaded: false,
      slot: -1,
      graceTimer: null,
      bot,
      clientId,
    };
    members.set(pid, m);
    for (const g of ghosts) remove(g);
    if (hostId === 0 || !members.has(hostId)) {
      hostId = pid;
      batcher.setHost(pid);
    }
    batcher.join({ id: pid, name: m.name, skinId: m.skinId, ready: true, connected: true });
    welcome(m, peer);
    migrateHost();
    maybeAutoStart();
    return m;
  }

  function findToken(token: string): Member | null {
    for (const m of members.values()) if (m.token === token) return m;
    return null;
  }

  function reconnect(m: Member, peer: Peer) {
    m.graceTimer = clearTimer(m.graceTimer);
    if (m.peer && m.peer !== peer) {
      m.peer.unsubscribe(topic);
      m.peer.close(4002, 'replaced');
    }
    m.connected = true;
    batcher.update({ id: m.id, connected: true });
    session?.setConnected(m.id, true);
    welcome(m, peer);
    if (m.inMatch && phase === 'countdown') send(m, { t: 'countdown', startAt });
    migrateHost();
    maybeAutoStart();
  }

  function disconnect(m: Member, peer: Peer) {
    if (m.peer !== peer || disposed) return; // an old socket closing after a reconnect
    m.peer = null;
    m.connected = false;
    batcher.update({ id: m.id, connected: false });
    session?.setConnected(m.id, false);
    migrateHost();
    maybeAutoStart();
    m.graceTimer = setTimeout(() => remove(m), graceMs(phase, timings));
    if (connectedCount() === 0 && phase !== 'lobby') backToLobby();
  }

  function remove(m: Member) {
    m.graceTimer = clearTimer(m.graceTimer);
    if (!members.delete(m.id)) return;
    batcher.leave(m.id);
    migrateHost();
    if (members.size === 0) {
      opts.onEmpty(api);
      dispose();
    } else {
      maybeAutoStart();
    }
  }

  // ---- messages ------------------------------------------------------------

  function handle(m: Member, msg: ClientMessage) {
    switch (msg.t) {
      case 'setSkin':
      case 'setReady':
      case 'setConfig':
      case 'start':
        if (phase !== 'lobby') return void error(m, 'bad_phase', `${msg.t} is only allowed in the lobby`);
        break;
      case 'startVote':
        if (phase !== 'lobby') return void error(m, 'bad_phase', 'startVote is only allowed in the lobby');
        if (m.id !== hostId) return void error(m, 'not_host', 'startVote is host-only');
        return void startVote();
      case 'vote':
        if (phase !== 'voting' || !vote) return void error(m, 'bad_phase', 'no vote open');
        if (!vote.cast(m.id, msg.themeId)) return void error(m, 'bad_vote', 'not a vote option');
        return;
      case 'grab': {
        if (phase !== 'race' || !m.inMatch || !butterfly) return void error(m, 'bad_phase', 'no grabbing now');
        const verdict = butterfly.grab(m.id, msg);
        if (verdict !== 'ok') error(m, 'grab_refused', verdict);
        return;
      }
      case 'shoot': {
        if (phase !== 'race' || !m.inMatch || !butterfly) return void error(m, 'bad_phase', 'no shooting now');
        const verdict = butterfly.shoot(m.id, msg.target);
        if (verdict !== 'ok') error(m, 'shoot_refused', verdict);
        return;
      }
      case 'loaded':
        if (phase !== 'loading' || !m.inMatch) return void error(m, 'bad_phase', 'not loading');
        m.loaded = true;
        return void checkLoaded();
      default:
        return void error(m, 'bad_message', `unexpected ${msg.t}`);
    }
    if ((msg.t === 'setConfig' || msg.t === 'start') && m.id !== hostId) {
      return void error(m, 'not_host', `${msg.t} is host-only`);
    }
    if (msg.t === 'setSkin') {
      m.skinId = msg.skinId;
      batcher.update({ id: m.id, skinId: msg.skinId });
    } else if (msg.t === 'setReady') {
      m.ready = msg.ready;
      batcher.update({ id: m.id, ready: msg.ready });
    } else if (msg.t === 'setConfig') {
      config.courseId = msg.courseId;
      config.themeId = msg.themeId;
      batcher.setConfig(config);
    } else {
      void startMatch();
    }
  }

  function handleBinary(m: Member, bytes: Uint8Array) {
    if (phase !== 'race' || !m.inMatch || !session) return;
    const st = decode(bytes);
    if (st) session.handleState(m.id, st);
  }

  /** Sends a control message to every member (for server notices such as shutdown). */
  function broadcast(msg: ServerMessage) {
    opts.publish(topic, encode(msg));
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    loop.stop();
    batcher.dispose();
    phaseTimer = clearTimer(phaseTimer);
    autoStartTimer = clearTimer(autoStartTimer);
    if (voteTimer) clearInterval(voteTimer);
    voteTimer = null;
    vote = null;
    for (const m of members.values()) m.graceTimer = clearTimer(m.graceTimer);
    members.clear();
    session = null;
    villain = null;
    fade = null;
  }

  const api = {
    id,
    code,
    isPublic,
    get phase() {
      return phase;
    },
    get hostId() {
      return hostId;
    },
    /** Snapshots skipped for slow clients since the room was created. */
    get droppedSnapshots() {
      return dropped;
    },
    get size() {
      return members.size;
    },
    get disposed() {
      return disposed;
    },
    hasSpace: () => members.size < maxPlayers,
    connectedCount,
    state,
    join,
    findToken,
    reconnect,
    disconnect,
    handle,
    handleBinary,
    broadcast,
    /** Flushes pending lobby patches now (tests and shutdown). */
    flush: () => batcher.flush(),
    dispose,
  };
  return api;
}
