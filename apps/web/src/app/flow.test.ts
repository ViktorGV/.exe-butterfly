// Multiplayer flow (#27) against a real game server: lobby -> theme vote -> preload -> race -> results -> lobby.
import { afterAll, describe, expect, it } from 'bun:test';
import { VOTE } from '@wobble/shared/constants';
import { BUILTIN_SKIN_PACKS, BUILTIN_THEME_PACKS, VOTE_THEME_IDS } from '@wobble/shared/assets/index';
import type { MatchConfig, Pack, RoomState, VoteResult, VoteState } from '@wobble/shared/types';
import { createGameServer } from '../../../../apps/server/src/index.ts';
import { createNetClient } from '../net/index.ts';
import type { NetSession } from '../net/index.ts';
import type { Preload, PreloadReport } from '../assets/index.ts';
import { AssetError } from '../assets/index.ts';
import { createLobbyAssets, createLobbyNet, toGenerateFailure, voteManifest } from './lobbyBridge.ts';
import { preloadMatch } from './preload.ts';
import { transition } from './state.ts';

const game = createGameServer({
  port: 0,
  timings: { voteMs: 400, countdownMs: 200, loadingMaxMs: 3000, timeLimitMs: 400, resultsMs: 200 },
});
const url = `ws://localhost:${game.listen()}`;
afterAll(() => game.close());

function next<T>(s: NetSession, evt: Parameters<NetSession['on']>[0], pred: (p: T) => boolean = () => true) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${evt}`)), 5000);
    const off = s.on(evt, (p) => {
      if (!pred(p as T)) return;
      clearTimeout(timer);
      off();
      resolve(p as T);
    });
  });
}

/** An asset store stand-in that knows only the built-ins. */
function fakePreload(cfg: MatchConfig): Preload {
  const all = [...BUILTIN_SKIN_PACKS, ...BUILTIN_THEME_PACKS];
  const report = (ids: string[]): PreloadReport => {
    const packs: Record<string, Pack> = {};
    for (const id of ids) packs[id] = all.find((p) => p.id === id) ?? BUILTIN_SKIN_PACKS[0]!;
    return { requested: ids.length, loaded: ids.length, fallbacks: [], timedOut: false, packs };
  };
  return {
    blocking: Promise.resolve(report([cfg.themeId])),
    background: Promise.resolve(report(cfg.players.map((p) => p.skinId))),
  };
}

describe('multiplayer flow', () => {
  it('votes a theme, races on it, shows results and returns to the lobby', async () => {
    const a = createNetClient({ url });
    const b = createNetClient({ url });
    const aWelcome = next<{ room: RoomState }>(a, 'welcome');
    a.connect({ name: 'Ada', clientId: 'flow-client-a', room: 'new' });
    const { room } = await aWelcome;
    const bWelcome = next<{ room: RoomState }>(b, 'welcome');
    b.connect({ name: 'Bo', clientId: 'flow-client-b', room: room.code });
    await bWelcome;

    const lobbyA = createLobbyNet(a);
    const lobbyB = createLobbyNet(b);
    expect(lobbyA.playerId).toBe(room.hostId);
    const rooms: RoomState[] = [];
    const offRoom = lobbyB.on('room', (r) => rooms.push(r));
    expect(rooms).toHaveLength(1); // a late mount still gets the current room

    lobbyB.setSkin(BUILTIN_SKIN_PACKS[1]!.id);
    const voteOpen = new Promise<VoteState>((r) => lobbyB.on('vote', r));
    const result = new Promise<VoteResult>((r) => lobbyA.on('voteResult', r));
    const cfgA = next<MatchConfig>(a, 'matchConfig');
    lobbyA.startVote();
    const state = await voteOpen;
    expect(state.options).toEqual([...VOTE_THEME_IDS]);
    const pick = state.options[2]!;
    lobbyA.vote(pick);
    lobbyB.vote(pick);
    expect((await result).themeId).toBe(pick);

    const cfg = await cfgA;
    expect(cfg.themeId).toBe(pick);
    const packs = await preloadMatch({ preloadMatch: fakePreload }, cfg, a.playerId!);
    expect(packs.theme?.id).toBe(pick);
    expect(packs.skins.get(b.playerId!)?.id).toBe(BUILTIN_SKIN_PACKS[1]!.id);

    const countdown = next(a, 'countdown');
    a.sendLoaded();
    b.sendLoaded();
    await countdown;
    const raceEnd = await next<{ results: unknown[] }>(a, 'raceEnd');
    expect(raceEnd.results.length).toBeGreaterThanOrEqual(0);
    await next<{ phase?: string }>(a, 'roomPatch', (p) => p.phase === 'lobby');
    expect(a.room?.config.themeId).toBe(pick);

    offRoom();
    a.disconnect();
    b.disconnect();
  }, 15_000);
});

describe('lobby bridge', () => {
  it('builds a 5-theme vote manifest from VOTE_THEME_IDS', () => {
    const m = voteManifest();
    expect(VOTE_THEME_IDS).toHaveLength(VOTE.options);
    expect(m.themes.map((t) => t.id)).toEqual([...VOTE_THEME_IDS]);
    expect(voteManifest(['b:candy-workshop']).themes[0]!.title).toBe('Candy Workshop');
  });

  it('starts the skin gallery with the built-ins, even when the API is down', async () => {
    const down = createLobbyAssets({
      list: () => Promise.reject(new AssetError('unavailable', 'down')),
      generate: () => Promise.reject(new AssetError('rate_limited', 'slow down', 7)),
      getPack: (id) => Promise.resolve(BUILTIN_SKIN_PACKS.find((p) => p.id === id) ?? BUILTIN_SKIN_PACKS[0]!),
      report: () => Promise.resolve(),
    });
    const page = await down.list('skin', null);
    expect(page.items.map((s) => s.id)).toEqual(BUILTIN_SKIN_PACKS.map((p) => p.id));
    expect(page.nextCursor).toBeNull();
    await expect(down.list('theme', null)).rejects.toBeInstanceOf(AssetError);
    await expect(down.generate('skin', 'a frog')).rejects.toEqual({
      status: 429,
      retryAfterSec: 7,
      message: 'slow down',
    });
    expect((await down.eventManifest())?.themes).toHaveLength(VOTE.options);
    expect(toGenerateFailure(new Error('x')).status).toBe(503);
  });

  it('goes back to the lobby after the results', () => {
    expect(transition({ phase: 'finished', paused: false }, { type: 'backToLobby' })?.phase).toBe('lobby');
    expect(transition({ phase: 'title', paused: false }, { type: 'backToLobby' })).toBeNull();
  });
});
