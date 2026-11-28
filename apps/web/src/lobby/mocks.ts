// In-folder mocks of the lobby's net and asset store (#12): fake crowds, a fake vote, and generation that can be
// slow, rate limited, refused or down. Used by tests; integration swaps in the real net client and asset store.
import { VOTE } from '@wobble/shared/constants';
import { fixtureManifest, fixtureSkinPack } from '@wobble/shared';
import type { EventManifest, Pack, PackKind, RoomPlayer, RoomState, VoteResult, VoteState } from '@wobble/shared';
import type { RoomPatch } from './players.ts';
import type { GenerateFailure, LobbyAssets, LobbyNet, PackPage, WelcomeEvent } from './types.ts';

type Handler = (data: never) => void;

export interface MockNet extends LobbyNet {
  playerId: number;
  welcomeEvent: WelcomeEvent | null;
  room: RoomState;
  sent: { t: string; [k: string]: unknown }[];
  emit(evt: 'room' | 'roomPatch' | 'vote' | 'voteResult', data: unknown): void;
  patch(p: RoomPatch): void;
  /** Adds `n` fake players. */
  join(n: number): RoomPlayer[];
  now: number;
}

export function createMockNet(opts: { playerId?: number; hostId?: number; event?: WelcomeEvent | null } = {}): MockNet {
  const handlers = new Map<string, Set<Handler>>();
  const me = opts.playerId ?? 1;
  let nextId = 100;
  const net: MockNet = {
    playerId: me,
    welcomeEvent: opts.event ?? null,
    now: 0,
    sent: [],
    room: {
      id: 'mock',
      code: 'WOBBL',
      phase: 'lobby',
      hostId: opts.hostId ?? me,
      config: { courseId: 'b:fixture-course', themeId: 'b:fixture-theme' },
      players: [{ id: me, name: 'You', skinId: fixtureSkinPack.id, ready: false, connected: true }],
    },
    on(evt: string, fn: Handler) {
      let set = handlers.get(evt);
      if (!set) handlers.set(evt, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    emit(evt, data) {
      for (const fn of handlers.get(evt) ?? []) (fn as (d: unknown) => void)(data);
    },
    patch(p) {
      net.emit('roomPatch', p);
    },
    join(n) {
      const joined: RoomPlayer[] = [];
      for (let i = 0; i < n; i++) {
        const id = nextId++;
        joined.push({ id, name: `Wobbler ${id}`, skinId: fixtureSkinPack.id, ready: false, connected: true });
      }
      net.patch({ joined });
      return joined;
    },
    serverNow: () => net.now,
    setSkin: (skinId) => void net.sent.push({ t: 'setSkin', skinId }),
    setReady: (ready) => void net.sent.push({ t: 'setReady', ready }),
    setConfig: (cfg) => void net.sent.push({ t: 'setConfig', ...cfg }),
    start: () => void net.sent.push({ t: 'start' }),
    startVote: () => void net.sent.push({ t: 'startVote' }),
    vote: (themeId) => void net.sent.push({ t: 'vote', themeId }),
  } as MockNet;
  return net;
}

/** Simulates `voters` fake voters for one vote tick; returns the voteState the server would send. */
export function fakeVoteState(manifest: EventManifest, voters: number, endsAt: number, seed = 1): VoteState {
  const tallies: number[] = new Array<number>(VOTE.options).fill(0);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < voters; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    tallies[s % VOTE.options]!++;
  }
  return { t: 'voteState', options: manifest.themes.map((t) => t.id), tallies, endsAt };
}

export function fakeVoteResult(state: VoteState): VoteResult {
  let best = 0;
  for (let i = 1; i < state.tallies.length; i++) if (state.tallies[i]! > state.tallies[best]!) best = i;
  return { t: 'voteResult', themeId: state.options[best]!, tallies: state.tallies };
}

export type GenMode = 'ok' | 'slow' | 'rateLimited' | 'refused' | 'unavailable';

export interface MockAssets extends LobbyAssets {
  mode: GenMode;
  reported: string[];
  manifest: EventManifest | null;
}

export function createMockAssets(opts: { manifest?: EventManifest | null; pageSize?: number } = {}): MockAssets {
  const generated: Pack[] = [];
  const pageSize = opts.pageSize ?? 8;
  let n = 0;
  const assets: MockAssets = {
    mode: 'ok',
    reported: [],
    manifest: opts.manifest === undefined ? fixtureManifest : opts.manifest,
    async list(kind: PackKind, cursor: string | null): Promise<PackPage> {
      const all = [
        { id: fixtureSkinPack.id, kind, name: 'Fixture', swatch: ['#ffcc33'] },
        ...generated.map((p) => ({ id: p.id, kind, name: p.name, swatch: ['#66ccff'] })),
      ];
      const from = cursor ? Number(cursor) : 0;
      const next = from + pageSize;
      return { items: all.slice(from, next), nextCursor: next < all.length ? String(next) : null };
    },
    async generate(_kind, prompt) {
      const fail = (f: GenerateFailure) => Promise.reject(f);
      if (assets.mode === 'rateLimited') return fail({ status: 429, retryAfterSec: 10 });
      if (assets.mode === 'refused') return fail({ status: 422, message: "That one isn't allowed. Try another idea." });
      if (assets.mode === 'unavailable') return fail({ status: 503 });
      if (assets.mode === 'slow') await new Promise((r) => setTimeout(r, 1500));
      const pack: Pack = { ...fixtureSkinPack, id: `g:mock-${++n}`, name: prompt.slice(0, 32) || 'Wobbler' };
      generated.push(pack);
      return pack;
    },
    async getPack(id) {
      return generated.find((p) => p.id === id) ?? (id === fixtureSkinPack.id ? fixtureSkinPack : null);
    },
    async report(id) {
      assets.reported.push(id);
    },
    async eventManifest() {
      return assets.manifest;
    },
  };
  return assets;
}
