import { describe, expect, it } from 'bun:test';
import { LIMITS } from '@wobble/shared/constants';
import { fixtureManifest, fixtureSkinPack } from '@wobble/shared';
import type { RoomPlayer } from '@wobble/shared';
import { createPlayerStore, visibleRange } from './players.ts';
import { lobbyPermissions, phaseBanner } from './permissions.ts';
import { choose, createVoteModel, leader, onVoteResult, onVoteState, secondsLeft, shares } from './vote.ts';
import { cleanPrompt, failureState, genReduce, promptCounter, retryInSec } from './generate.ts';
import type { GenState } from './generate.ts';
import { createMockAssets, createMockNet, fakeVoteResult, fakeVoteState } from './mocks.ts';

const player = (id: number, ready = false): RoomPlayer => ({
  id,
  name: `P${id}`,
  skinId: fixtureSkinPack.id,
  ready,
  connected: true,
});

describe('player store patches', () => {
  it('joins, leaves and updates without touching other rows', () => {
    const s = createPlayerStore();
    s.reset([player(1), player(2, true)]);
    expect(s.readyCount()).toBe(1);
    let r = s.apply({ joined: [player(3, true)] });
    expect(r).toEqual({ changed: [3], orderChanged: true });
    r = s.apply({ updated: [{ id: 1, ready: true }] });
    expect(r).toEqual({ changed: [1], orderChanged: false });
    expect(s.readyCount()).toBe(3);
    r = s.apply({ left: [2, 99] });
    expect(r.orderChanged).toBe(true);
    expect(s.order).toEqual([1, 3]);
    expect(s.readyCount()).toBe(2);
    expect(s.get(1)?.name).toBe('P1');
  });

  it('ignores updates for unknown players and re-joins in place', () => {
    const s = createPlayerStore();
    s.reset([player(1, true)]);
    expect(s.apply({ updated: [{ id: 5, ready: true }] }).changed).toEqual([]);
    expect(s.apply({ joined: [player(1, false)] }).orderChanged).toBe(false);
    expect(s.readyCount()).toBe(0);
    expect(s.size).toBe(1);
  });

  it('handles 300 players churning', () => {
    const s = createPlayerStore();
    const net = createMockNet();
    const off = net.on('roomPatch', (p) => s.apply(p));
    const joined = net.join(300);
    net.patch({ updated: joined.slice(0, 150).map((p) => ({ id: p.id, ready: true })) });
    net.patch({ left: joined.slice(0, 50).map((p) => p.id) });
    off();
    expect(s.size).toBe(250);
    expect(s.readyCount()).toBe(100);
  });

  it('windows only the visible rows', () => {
    expect(visibleRange(0, 440, 44, 300)).toEqual({ start: 0, end: 14 });
    expect(visibleRange(44 * 100, 440, 44, 300)).toEqual({ start: 96, end: 114 });
    expect(visibleRange(1e6, 440, 44, 300).end).toBe(300);
    expect(visibleRange(0, 440, 44, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('host / non-host permissions', () => {
  it('open mode: only the host picks the theme and starts', () => {
    const host = lobbyPermissions({ hostId: 1, phase: 'lobby' }, 1, 'open');
    const guest = lobbyPermissions({ hostId: 1, phase: 'lobby' }, 2, 'open');
    expect(host).toMatchObject({ isHost: true, canPickTheme: true, canStart: true, canStartVote: false });
    expect(guest).toMatchObject({
      isHost: false,
      canPickTheme: false,
      canStart: false,
      canPickSkin: true,
      canReady: true,
    });
  });
  it('event mode: host starts the vote unless the room is public; no skin picking', () => {
    expect(lobbyPermissions({ hostId: 1, phase: 'lobby' }, 1, 'event').canStartVote).toBe(true);
    expect(lobbyPermissions({ hostId: 1, phase: 'lobby' }, 1, 'event', true).canStartVote).toBe(false);
    expect(lobbyPermissions({ hostId: 1, phase: 'lobby' }, 2, 'event').canStartVote).toBe(false);
    expect(lobbyPermissions({ hostId: 1, phase: 'lobby' }, 1, 'event').canPickSkin).toBe(false);
    expect(lobbyPermissions({ hostId: 1, phase: 'voting' }, 2, 'event').canVote).toBe(true);
  });
  it('nobody changes things once a race runs, and an unwelcomed player is never host', () => {
    const p = lobbyPermissions({ hostId: 1, phase: 'race' }, 1, 'open');
    expect(p.canStart || p.canPickTheme || p.canReady || p.canPickSkin).toBe(false);
    expect(lobbyPermissions({ hostId: 0, phase: 'lobby' }, -1, 'open').isHost).toBe(false);
    expect(phaseBanner('race', false, 'open')).toBe("Race in progress — you're in the next one");
    expect(phaseBanner('lobby', false, 'open')).toBe('Waiting for host');
  });
});

describe('vote state machine', () => {
  const opts = fixtureManifest.themes.map((t) => t.id);
  it('idle -> voting -> changeable choice -> reveal', () => {
    let m = createVoteModel();
    expect(choose(m, opts[0]!)).toBeNull();
    m = onVoteState(m, { options: opts, tallies: [0, 0, 0, 0, 0], endsAt: 20_000 });
    expect(m.phase).toBe('voting');
    expect(secondsLeft(m, 0)).toBe(20);
    expect(secondsLeft(m, 30_000)).toBe(0);
    m = choose(m, opts[1]!)!;
    expect(m.myChoice).toBe(opts[1]!);
    m = choose(m, opts[3]!)!;
    expect(m.myChoice).toBe(opts[3]!);
    expect(choose(m, 'e:not-an-option')).toBeNull();
    m = onVoteState(m, { options: opts, tallies: [1, 5, 2, 0, 0], endsAt: 20_000 });
    expect(m.myChoice).toBe(opts[3]!);
    expect(leader(m)).toBe(opts[1]!);
    expect(shares(m)[1]).toBeCloseTo(0.625);
    m = onVoteResult(m, { themeId: opts[2]!, tallies: [1, 5, 9, 0, 0] });
    expect(m.phase).toBe('reveal');
    expect(leader(m)).toBe(opts[2]!);
    expect(choose(m, opts[0]!)).toBeNull();
    expect(onVoteState(m, { options: opts, tallies: [9, 0, 0, 0, 0], endsAt: 1 })).toBe(m);
  });
  it('runs end to end with 300 fake voters', () => {
    let m = createVoteModel();
    let last = fakeVoteState(fixtureManifest, 0, 20_000);
    for (let tick = 0; tick <= 80; tick++) {
      last = fakeVoteState(fixtureManifest, Math.min(300, tick * 4), 20_000, 7);
      m = onVoteState(m, last);
    }
    expect(m.tallies.reduce((a, b) => a + b, 0)).toBe(300);
    m = onVoteResult(m, fakeVoteResult(last));
    expect(m.winner).toBe(leader({ ...m, winner: null }));
    expect(shares({ ...m, tallies: [0, 0, 0, 0, 0] })).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('generation state machine', () => {
  const pack = fixtureSkinPack;
  it('generate -> preview -> equip', () => {
    let s: GenState = { s: 'idle' };
    s = genReduce(s, { e: 'submit', prompt: '   ' });
    expect(s.s).toBe('idle');
    s = genReduce(s, { e: 'submit', prompt: '  a  frog   knight ' });
    expect(s).toEqual({ s: 'generating', prompt: 'a frog knight' });
    expect(genReduce(s, { e: 'submit', prompt: 'again' })).toBe(s);
    expect(genReduce(s, { e: 'reset' })).toBe(s);
    s = genReduce(s, { e: 'done', pack });
    expect(s.s).toBe('preview');
    s = genReduce(s, { e: 'equip' });
    expect(s).toEqual({ s: 'equipped', pack });
    expect(genReduce(s, { e: 'reset' })).toEqual({ s: 'idle' });
  });
  it('maps every failure to a friendly state', () => {
    expect(failureState({ status: 429, retryAfterSec: 12 }, 1000)).toEqual({ s: 'rateLimited', retryAt: 13_000 });
    expect(failureState({ status: 422 }, 0).s).toBe('refused');
    expect(failureState({ status: 503 }, 0).s).toBe('unavailable');
    expect(failureState(new TypeError('fetch failed'), 0).s).toBe('unavailable');
    expect(failureState({ status: 500, message: 'x' }, 0)).toEqual({ s: 'error', message: 'x' });
  });
  it('counts down a rate limit and then allows retrying', () => {
    let s: GenState = genReduce(
      { s: 'generating', prompt: 'x' },
      { e: 'fail', err: { status: 429, retryAfterSec: 3 }, now: 0 },
    );
    expect(retryInSec(s, 0)).toBe(3);
    expect(genReduce(s, { e: 'submit', prompt: 'y' })).toBe(s);
    s = genReduce(s, { e: 'tick', now: 2000 });
    expect(s.s).toBe('rateLimited');
    s = genReduce(s, { e: 'tick', now: 3000 });
    expect(s.s).toBe('idle');
  });
  it('limits prompts to LIMITS.promptMax with a counter', () => {
    const long = 'a'.repeat(LIMITS.promptMax + 50);
    expect(cleanPrompt(long).length).toBe(LIMITS.promptMax);
    expect(promptCounter('abc')).toBe(`3 / ${LIMITS.promptMax}`);
    expect(promptCounter(long)).toBe(`${LIMITS.promptMax} / ${LIMITS.promptMax}`);
  });
  it('mock asset store reaches every state', async () => {
    const assets = createMockAssets({ pageSize: 1 });
    const run = async () => {
      let s: GenState = genReduce({ s: 'idle' }, { e: 'submit', prompt: 'p' });
      try {
        s = genReduce(s, { e: 'done', pack: await assets.generate('skin', 'p') });
      } catch (err) {
        s = genReduce(s, { e: 'fail', err, now: 0 });
      }
      return s.s;
    };
    expect(await run()).toBe('preview');
    for (const [mode, st] of [
      ['rateLimited', 'rateLimited'],
      ['refused', 'refused'],
      ['unavailable', 'unavailable'],
    ] as const) {
      assets.mode = mode;
      expect(await run()).toBe(st);
    }
    const p1 = await assets.list('skin', null);
    expect(p1.nextCursor).toBe('1');
    expect((await assets.list('skin', p1.nextCursor)).nextCursor).toBeNull();
    await assets.report('g:mock-1');
    expect(assets.reported).toEqual(['g:mock-1']);
  });
});

describe('lobby module', () => {
  it('imports without a DOM', async () => {
    expect(typeof document).toBe('undefined');
    const mod = await import('./index.ts');
    expect(typeof mod.mountLobby).toBe('function');
  });
});
