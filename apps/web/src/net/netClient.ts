// Online session: WebSocket connection, reconnect, clock sync, throttled STATE out and
// interpolated SNAPSHOTs in (#20). Wire formats: docs/CONTRACTS.md §6.
import { INTERP_DELAY_MS, NET_SEND_HZ, PROTOCOL_VERSION, WIRE } from '@wobble/shared/constants';
import { ServerMessageSchema } from '@wobble/shared/schemas/protocol';
import { encodeState } from '@wobble/shared/protocol/state';
import type { WireState } from '@wobble/shared/protocol/state';
import { createClockSync } from './clock.ts';
import { createRemoteBuffer, unwrapServerTime } from './remoteBuffer.ts';
import { createRoomStore } from './roomStore.ts';
import { createEmitter } from './session.ts';
import type { Hello, NetSession, NetStats } from './session.ts';

/** The subset of the browser WebSocket the client uses, so tests can pass a mock. */
export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  /** Buffered bytes not yet sent; used to skip a STATE when the socket is backed up. */
  readonly bufferedAmount?: number;
  send(data: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface NetClientOptions {
  url: string;
  createSocket?: (url: string) => SocketLike;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  random?: () => number;
  /** Is the page hidden? Default reads `document.visibilityState`. */
  isHidden?: () => boolean;
  /** STATE rate while hidden, as a keep-alive trickle. Default 1 Hz. */
  hiddenSendHz?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  interpDelayMs?: number;
}

const OPEN = 1;
/** A jump bigger than this between two sent states is flagged as a respawn/teleport. */
const TELEPORT_M = 4;

export function createNetClient(opts: NetClientOptions): NetSession & { readonly connected: boolean } {
  const now = opts.now ?? (() => performance.timeOrigin + performance.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const random = opts.random ?? Math.random;
  const createSocket = opts.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
  const isHidden = opts.isHidden ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  const sendIntervalMs = 1000 / NET_SEND_HZ;
  const hiddenIntervalMs = 1000 / (opts.hiddenSendHz ?? 1);
  const baseMs = opts.reconnectBaseMs ?? 250;
  const maxMs = opts.reconnectMaxMs ?? 8000;

  const ev = createEmitter();
  const store = createRoomStore();
  let ws: SocketLike | null = null;
  let hello: Hello | null = null;
  let token: string | undefined;
  let playerId: number | null = null;
  let wanted = false;
  let everWelcomed = false;
  let attempt = 0;
  let reconnectTimer: unknown = null;
  let startAt: number | null = null;

  // outgoing STATE: one preallocated frame, latest state copied in
  const stateBuf = new Uint8Array(WIRE.STATE_BYTES);
  const latest: WireState = { pos: [0, 0, 0], yaw: 0, anim: 0, grounded: false, finished: false, respawned: false };
  const lastSentPos = [0, 0, 0];
  let haveLatest = false;
  let seq = 0;
  let lastSendAt = -Infinity;
  let trickleTimer: unknown = null;

  // stats
  let bytesIn = 0;
  let bytesOut = 0;
  let snapsIn = 0;
  let statsSince = now();
  let jitter = 0;
  let lastRtt = -1;
  const stats: NetStats = {
    rttMs: 0,
    jitterMs: 0,
    clockOffsetMs: 0,
    kbInPerSec: 0,
    kbOutPerSec: 0,
    snapshotsPerSec: 0,
    renderDelayMs: 0,
  };

  function sendText(msg: object): void {
    if (!ws || ws.readyState !== OPEN) return;
    const s = JSON.stringify(msg);
    bytesOut += s.length;
    ws.send(s);
  }

  const clock = createClockSync({
    now,
    setTimer,
    clearTimer,
    resyncEveryMs: 2000,
    sendPing: (c) => sendText({ t: 'ping', c }),
  });
  // Snapshots arrive about one trip after they were stamped, so remote players are rendered at
  // serverNow() - arrivalLag - interpDelay. The lag estimate rises fast and falls slowly, and
  // the render clock never runs backwards.
  const interpDelayMs = opts.interpDelayMs ?? INTERP_DELAY_MS;
  let arrivalLag = -1;
  let renderNow = -Infinity;
  function remoteNow(): number {
    const t = clock.serverNow() - Math.max(0, arrivalLag);
    if (t > renderNow) renderNow = t;
    return renderNow;
  }
  const remote = createRemoteBuffer({ serverNow: remoteNow, interpDelayMs });

  function onText(text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return;
    }
    const parsed = ServerMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const m = parsed.data;
    switch (m.t) {
      case 'pong': {
        const rtt = now() - m.c;
        if (lastRtt >= 0) jitter += (Math.abs(rtt - lastRtt) - jitter) / 8;
        lastRtt = rtt;
        clock.onPong(m.c, m.s);
        return;
      }
      case 'welcome': {
        const resumed = everWelcomed && playerId === m.playerId;
        playerId = m.playerId;
        token = m.token;
        attempt = 0;
        store.reset(m.room);
        ev.emit('welcome', { playerId: m.playerId, room: store.room! });
        if (resumed) ev.emit('reconnect', { playerId: m.playerId });
        everWelcomed = true;
        ev.emit('room', store.room!);
        return;
      }
      case 'roomPatch':
        if (store.apply(m)) ev.emit('room', store.room!);
        return;
      case 'matchConfig': {
        const { t: _t, ...cfg } = m;
        ev.emit('matchConfig', cfg as never);
        return;
      }
      case 'countdown':
        startAt = m.startAt;
        ev.emit('countdown', { startAt: m.startAt });
        return;
      case 'checkpoint':
        ev.emit('checkpoint', m);
        return;
      case 'correct':
        ev.emit('correct', m);
        return;
      case 'finished':
        ev.emit('finished', m);
        return;
      case 'raceEnd':
        ev.emit('raceEnd', m);
        return;
      case 'error':
        ev.emit('error', m);
        return;
      case 'grabbed':
        ev.emit('grabbed', m);
        return;
      case 'marked':
        ev.emit('marked', m);
        return;
      case 'storm':
        ev.emit('storm', m);
        return;
      case 'throw':
        ev.emit('throw', m);
        return;
      case 'hit':
        ev.emit('hit', m);
        return;
      case 'hero':
        ev.emit('hero', m);
        return;
    }
  }

  function open(): void {
    reconnectTimer = null;
    const sock = createSocket(opts.url);
    ws = sock;
    sock.binaryType = 'arraybuffer';
    sock.onopen = () => {
      if (ws !== sock || !hello) return;
      sendText({ t: 'hello', v: PROTOCOL_VERSION, ...hello, ...(token ? { token } : {}) });
      clock.stop();
      clock.start();
    };
    sock.onmessage = (e) => {
      if (ws !== sock) return;
      const d = e.data;
      if (typeof d === 'string') {
        bytesIn += d.length;
        onText(d);
      } else if (d instanceof ArrayBuffer) {
        bytesIn += d.byteLength;
        const dv = new DataView(d);
        if (remote.ingest(dv) > 0) {
          snapsIn++;
          if (clock.synced) {
            const now = clock.serverNow();
            const lag = now - unwrapServerTime(dv.getUint32(1, true), now);
            if (arrivalLag < 0) arrivalLag = lag;
            else arrivalLag += (lag - arrivalLag) * (lag > arrivalLag ? 0.2 : 0.02);
          }
        }
      }
    };
    sock.onerror = () => {};
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      clock.stop();
      ev.emit('disconnect', { willReconnect: wanted });
      if (wanted) scheduleReconnect();
    };
  }

  function scheduleReconnect(): void {
    const delay = Math.min(maxMs, baseMs * 2 ** attempt) * (0.75 + 0.5 * random());
    attempt++;
    reconnectTimer = setTimer(open, delay);
  }

  function transmit(t: number): void {
    if (!ws || ws.readyState !== OPEN || !haveLatest) return;
    if ((ws.bufferedAmount ?? 0) > 64 * 1024) return; // backed up: skip, the next one is newer
    const p = latest.pos;
    const dx = p[0] - lastSentPos[0]!;
    const dy = p[1] - lastSentPos[1]!;
    const dz = p[2] - lastSentPos[2]!;
    const teleported = seq > 0 && dx * dx + dy * dy + dz * dz > TELEPORT_M * TELEPORT_M;
    latest.respawned = teleported;
    encodeState(latest, seq++, raceTimeSec() * 1000, stateBuf);
    lastSentPos[0] = p[0];
    lastSentPos[1] = p[1];
    lastSentPos[2] = p[2];
    bytesOut += WIRE.STATE_BYTES;
    lastSendAt = t;
    ws.send(stateBuf);
  }

  function trickle(): void {
    trickleTimer = setTimer(trickle, hiddenIntervalMs);
    const t = now();
    if (t - lastSendAt >= hiddenIntervalMs) transmit(t);
  }

  function raceTimeSec(): number {
    if (startAt === null) return 0;
    return (clock.serverNow() - startAt) / 1000;
  }

  return {
    connect(h) {
      hello = h;
      wanted = true;
      if (ws || reconnectTimer !== null) return;
      attempt = 0;
      open();
      if (trickleTimer === null) trickleTimer = setTimer(trickle, hiddenIntervalMs);
    },
    on: ev.on,
    disconnect() {
      wanted = false;
      if (reconnectTimer !== null) clearTimer(reconnectTimer);
      reconnectTimer = null;
      if (trickleTimer !== null) clearTimer(trickleTimer);
      trickleTimer = null;
      clock.stop();
      const sock = ws;
      if (sock) sock.close(1000, 'bye');
    },
    sendState(s) {
      const p = latest.pos;
      p[0] = s.pos[0];
      p[1] = s.pos[1];
      p[2] = s.pos[2];
      latest.yaw = s.yaw;
      latest.anim = s.anim;
      latest.grounded = s.grounded;
      latest.finished = s.finished;
      haveLatest = true;
      const t = now();
      const interval = isHidden() ? hiddenIntervalMs : sendIntervalMs;
      // small tolerance so a 60 Hz caller lands on every 4th frame instead of drifting to 5
      if (t - lastSendAt >= interval - 2) transmit(t);
    },
    serverNow: () => clock.serverNow(),
    raceTimeSec,
    sampleRemote: () => remote.sampleRemote(),
    setSkin: (skinId) => sendText({ t: 'setSkin', skinId }),
    setReady: (ready) => sendText({ t: 'setReady', ready }),
    setConfig: (cfg) => sendText({ t: 'setConfig', courseId: cfg.courseId, themeId: cfg.themeId }),
    start: () => sendText({ t: 'start' }),
    sendLoaded: () => sendText({ t: 'loaded' }),
    grab: (target, kind, dir) => sendText({ t: 'grab', target, kind, dir: [dir[0], dir[1]] }),
    stats() {
      const t = now();
      const dt = (t - statsSince) / 1000;
      if (dt >= 1) {
        stats.kbInPerSec = bytesIn / 1024 / dt;
        stats.kbOutPerSec = bytesOut / 1024 / dt;
        stats.snapshotsPerSec = snapsIn / dt;
        bytesIn = bytesOut = snapsIn = 0;
        statsSince = t;
      }
      stats.rttMs = clock.rttMs();
      stats.jitterMs = jitter;
      stats.clockOffsetMs = clock.serverNow() - t;
      stats.renderDelayMs = clock.serverNow() - remoteNow() + interpDelayMs;
      return stats;
    },
    get playerId() {
      return playerId;
    },
    get room() {
      return store.room;
    },
    get connected() {
      return ws !== null && ws.readyState === OPEN;
    },
  };
}
