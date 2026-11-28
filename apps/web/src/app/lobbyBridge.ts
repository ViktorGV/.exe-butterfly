// Lobby bridge (#27): adapts the net client and asset store to the seams the lobby (#12) is typed against.
import {
  BUILTIN_SKIN_PACKS,
  BUILTIN_THEME_PACKS,
  VOTE_THEME_IDS,
  skinSwatch,
  themeSwatch,
} from '@wobble/shared/assets/index';
import { DEFAULT_COURSE_ID } from '@wobble/shared/course/recipes/index';
import type { EventManifest, Pack, SkinDef, ThemeDef } from '@wobble/shared/types';
import type { NetSession } from '../net/index.ts';
import type { AssetStore } from '../assets/index.ts';
import { AssetError } from '../assets/index.ts';
import type { GenerateFailure, LobbyAssets, LobbyNet, PackSummary } from '../lobby/types.ts';

type Fn = (data: never) => void;

/** The net client as the lobby sees it. Lobby `room` = full state (welcome / resync), `roomPatch` = deltas. */
export function createLobbyNet(session: NetSession): LobbyNet {
  const on = (evt: string, fn: Fn): (() => void) => {
    const f = fn as (d: unknown) => void;
    switch (evt) {
      case 'room':
        if (session.room) f(session.room); // mounted after the welcome (e.g. back from results)
        return session.on('welcome', ({ room }) => f(room));
      case 'roomPatch':
        return session.on('roomPatch', ({ t: _t, ...patch }) => f(patch));
      case 'vote':
        return session.on('voteState', f);
      case 'voteResult':
        return session.on('voteResult', f);
      default:
        return () => {};
    }
  };
  return {
    get playerId() {
      return session.playerId ?? -1;
    },
    get welcomeEvent() {
      return session.welcomeEvent ?? null;
    },
    on: on as LobbyNet['on'],
    setSkin: (id) => session.setSkin(id),
    setReady: (r) => session.setReady(r),
    setConfig: (c) => session.setConfig(c),
    start: () => session.start(),
    startVote: () => session.startVote(),
    vote: (id) => session.vote(id),
    serverNow: () => session.serverNow(),
  };
}

const builtinSkins: PackSummary[] = BUILTIN_SKIN_PACKS.map((p) => ({
  id: p.id,
  kind: 'skin',
  name: p.name,
  swatch: skinSwatch(p.data as SkinDef).colors,
}));

/** The lobby vote cards: VOTE_THEME_IDS as a manifest (the two current maps). */
export function voteManifest(ids: readonly string[] = VOTE_THEME_IDS): EventManifest {
  return {
    version: 1,
    eventId: 'lobby-vote',
    courseId: DEFAULT_COURSE_ID,
    themes: ids.map((id) => {
      const pack = BUILTIN_THEME_PACKS.find((p) => p.id === id);
      const sw = pack ? themeSwatch(pack.data as ThemeDef) : null;
      return {
        id,
        title: (pack?.name ?? id).slice(0, 32),
        tagline: '',
        credit: null,
        voteCard: '',
        swatch: sw ? [sw.sky[0], ...sw.colors].slice(0, 6) : [],
      };
    }),
    pools: {},
  };
}

export function toGenerateFailure(err: unknown): GenerateFailure {
  if (err instanceof AssetError) {
    const status = err.code === 'rate_limited' ? 429 : err.code === 'invalid' ? 422 : 503;
    return { status, retryAfterSec: err.retryAfterSec ?? undefined, message: err.message };
  }
  return { status: 503, message: 'network error' };
}

/** The asset store as the lobby sees it. The skin gallery always starts with the built-in skins. */
export function createLobbyAssets(
  store: Pick<AssetStore, 'list' | 'generate' | 'getPack' | 'report'>,
  manifest: () => EventManifest | null = voteManifest,
): LobbyAssets {
  return {
    async list(kind, cursor) {
      const builtins = kind === 'skin' && !cursor ? builtinSkins : [];
      try {
        const page = await store.list(kind, cursor);
        const seen = new Set(builtins.map((s) => s.id));
        return { items: [...builtins, ...page.items.filter((s) => !seen.has(s.id))], nextCursor: page.nextCursor };
      } catch (err) {
        if (builtins.length) return { items: builtins, nextCursor: null };
        throw err;
      }
    },
    async generate(kind, prompt) {
      try {
        return await store.generate(kind, prompt);
      } catch (err) {
        throw toGenerateFailure(err);
      }
    },
    getPack: (id): Promise<Pack | null> => store.getPack(id),
    report: (id) => store.report(id),
    eventManifest: async () => manifest(),
  };
}
