import { describe, expect, it } from 'bun:test';
import { PROTOCOL_VERSION, WIRE } from '../constants.ts';
import { ClientMessageSchema, ServerMessageSchema } from '../schemas/protocol.ts';
import type { ClientMessage, RoomPlayer, RoomState, ServerMessage } from '../types.ts';
import { utf8ByteLength } from './control.ts';
import {
  PROTOCOL_MISMATCH,
  SERVER_CONTROL_MAX_BYTES,
  checkProtocolVersion,
  controlMaxBytes,
  isProtocolSupported,
  parseClientControl,
  parseControl,
  parseServerControl,
  serializeControl,
} from './index.ts';
import type { ControlMessage } from './index.ts';
import { rng } from './testkit.ts';

interface Example<M> {
  valid: M;
  /** objects that must be rejected: each breaks one rule of the schema */
  invalid: unknown[];
}

const player: RoomPlayer = { id: 1, name: 'Wob', skinId: 'b:fixture-skin', ready: false, connected: true };
const room: RoomState = {
  id: 'room-1',
  code: 'ABCDE',
  phase: 'lobby',
  hostId: 1,
  config: { courseId: 'b:fixture-course', themeId: 'b:fixture-theme' },
  players: [player],
};

const CLIENT: { [T in ClientMessage['t']]: Example<Extract<ClientMessage, { t: T }>> } = {
  hello: {
    valid: { t: 'hello', v: PROTOCOL_VERSION, name: 'Wob', clientId: 'client-0001', token: 'tok', room: 'quick' },
    invalid: [
      { t: 'hello', v: 1, name: '', clientId: 'client-0001', room: 'quick' },
      { t: 'hello', v: 1, name: 'Wob', clientId: 'short', room: 'quick' },
      { t: 'hello', v: 1, name: 'Wob', clientId: 'client-0001', room: 'abcde' },
      { t: 'hello', v: 1.5, name: 'Wob', clientId: 'client-0001', room: 'new' },
      { t: 'hello', v: 1, name: 'a name that is far too long', clientId: 'client-0001', room: 'ABCDE' },
    ],
  },
  setSkin: {
    valid: { t: 'setSkin', skinId: 'g:abc123' },
    invalid: [{ t: 'setSkin', skinId: 'x:nope' }, { t: 'setSkin' }],
  },
  setReady: { valid: { t: 'setReady', ready: true }, invalid: [{ t: 'setReady', ready: 'yes' }, { t: 'setReady' }] },
  setConfig: {
    valid: { t: 'setConfig', courseId: 'b:fixture-course', themeId: 'b:fixture-theme' },
    invalid: [
      { t: 'setConfig', courseId: 'b:fixture-course' },
      { t: 'setConfig', courseId: 'B:Bad', themeId: 'b:ok' },
    ],
  },
  start: { valid: { t: 'start' }, invalid: [{ t: 'Start' }] },
  loaded: { valid: { t: 'loaded' }, invalid: [{ t: 'loaded ' }] },
  ping: { valid: { t: 'ping', c: 1234.5 }, invalid: [{ t: 'ping' }, { t: 'ping', c: '1' }, { t: 'ping', c: null }] },
  startVote: { valid: { t: 'startVote' }, invalid: [{ t: 'startvote' }] },
  vote: { valid: { t: 'vote', themeId: 'e:theme-candy' }, invalid: [{ t: 'vote' }, { t: 'vote', themeId: 'candy' }] },
  grab: {
    valid: { t: 'grab', target: 2, kind: 'push', dir: [0, -1] },
    invalid: [
      { t: 'grab', target: 2, kind: 'kick', dir: [0, -1] },
      { t: 'grab', target: 2, kind: 'push', dir: [0, -2] },
      { t: 'grab', kind: 'save', dir: [0, 1] },
    ],
  },
  shoot: {
    valid: { t: 'shoot', target: 2 },
    invalid: [{ t: 'shoot' }, { t: 'shoot', target: -1 }, { t: 'shoot', target: 70000 }],
  },
};

const SERVER: { [T in ServerMessage['t']]: Example<Extract<ServerMessage, { t: T }>> } = {
  welcome: {
    valid: { t: 'welcome', playerId: 1, token: 'tok', room },
    invalid: [
      { t: 'welcome', playerId: 65536, token: 'tok', room },
      { t: 'welcome', playerId: 1, token: 'tok', room: { ...room, phase: 'podium' } },
      { t: 'welcome', playerId: 1, room },
    ],
  },
  roomPatch: {
    valid: {
      t: 'roomPatch',
      joined: [player],
      left: [2],
      updated: [{ id: 3, ready: true }],
      phase: 'loading',
      hostId: 1,
    },
    invalid: [
      { t: 'roomPatch', left: [-1] },
      { t: 'roomPatch', updated: [{ ready: true }] },
      { t: 'roomPatch', phase: 'warmup' },
    ],
  },
  matchConfig: {
    valid: {
      t: 'matchConfig',
      courseId: 'b:fixture-course',
      themeId: 'b:fixture-theme',
      qualifyCount: 10,
      players: [{ id: 1, slot: 0, skinId: 'b:fixture-skin', name: 'Wob' }],
    },
    invalid: [
      { t: 'matchConfig', courseId: 'b:c', themeId: 'b:t', qualifyCount: -1, players: [] },
      {
        t: 'matchConfig',
        courseId: 'b:c',
        themeId: 'b:t',
        qualifyCount: 1,
        players: [{ id: 1, slot: 300, skinId: 'b:s', name: 'x' }],
      },
    ],
  },
  countdown: {
    valid: { t: 'countdown', startAt: 123456 },
    invalid: [{ t: 'countdown' }, { t: 'countdown', startAt: 'soon' }],
  },
  pong: { valid: { t: 'pong', c: 1, s: 2 }, invalid: [{ t: 'pong', c: 1 }] },
  checkpoint: {
    valid: { t: 'checkpoint', index: 2 },
    invalid: [
      { t: 'checkpoint', index: -1 },
      { t: 'checkpoint', index: 0.5 },
    ],
  },
  correct: {
    valid: { t: 'correct', pos: [1, 2, -3], checkpoint: 1 },
    invalid: [
      { t: 'correct', pos: [1, 2], checkpoint: 1 },
      { t: 'correct', pos: [1, 2, 3] },
    ],
  },
  finished: {
    valid: { t: 'finished', id: 4, place: 1, timeMs: 45123 },
    invalid: [
      { t: 'finished', id: 4, place: 0, timeMs: 1 },
      { t: 'finished', id: 4, place: 1, timeMs: -1 },
    ],
  },

  voteState: {
    valid: {
      t: 'voteState',
      options: ['e:t-1', 'e:t-2', 'e:t-3', 'e:t-4', 'e:t-5'],
      tallies: [3, 0, 1, 0, 2],
      endsAt: 1000,
    },
    invalid: [
      { t: 'voteState', options: ['e:t-1'], tallies: [1], endsAt: 1 },
      { t: 'voteState', options: ['e:t-1', 'e:t-2', 'e:t-3', 'e:t-4', 'e:t-5'], tallies: [-1, 0, 0, 0, 0], endsAt: 1 },
    ],
  },
  voteResult: {
    valid: { t: 'voteResult', themeId: 'e:t-1', tallies: [3, 0, 1, 0, 2] },
    invalid: [
      { t: 'voteResult', themeId: 'e:t-1' },
      { t: 'voteResult', themeId: 'nope', tallies: [0, 0, 0, 0, 0] },
    ],
  },
  grabbed: {
    valid: { t: 'grabbed', by: 2, kind: 'save', dir: [1, 0], pos: [1, 2, -3] },
    invalid: [
      { t: 'grabbed', by: 2, kind: 'save', dir: [1, 0] },
      { t: 'grabbed', by: -1, kind: 'push', dir: [1, 0], pos: [0, 0, 0] },
    ],
  },
  marked: {
    valid: { t: 'marked', id: 3, by: 4 },
    invalid: [
      { t: 'marked', id: 3 },
      { t: 'marked', id: 70000, by: 1 },
    ],
  },
  storm: {
    valid: { t: 'storm', level: 7, max: 20 },
    invalid: [
      { t: 'storm', level: 21, max: 20 },
      { t: 'storm', level: 3, max: 10 },
    ],
  },
  throw: {
    valid: { t: 'throw', n: 4, target: 3, pos: [1.5, -42], landAt: 123456 },
    invalid: [
      { t: 'throw', n: 4, target: 3, pos: [1.5], landAt: 123456 },
      { t: 'throw', n: -1, target: 3, pos: [0, 0], landAt: 1 },
      { t: 'throw', n: 1, target: 70000, pos: [0, 0], landAt: 1 },
    ],
  },
  hit: {
    valid: { t: 'hit', n: 4, dir: [0.6, -0.8] },
    invalid: [
      { t: 'hit', n: 4 },
      { t: 'hit', n: 4, dir: [2, 0] },
    ],
  },
  hero: {
    valid: { t: 'hero', saves: 2 },
    invalid: [{ t: 'hero', saves: 0 }, { t: 'hero', saves: -1 }, { t: 'hero' }],
  },
  gun: {
    valid: { t: 'gun', shots: 10 },
    invalid: [{ t: 'gun' }, { t: 'gun', shots: -1 }, { t: 'gun', shots: 11 }, { t: 'gun', shots: 1.5 }],
  },
  shot: {
    valid: { t: 'shot', by: 2, target: 3 },
    invalid: [
      { t: 'shot', by: 2 },
      { t: 'shot', target: 3 },
      { t: 'shot', by: -1, target: 3 },
    ],
  },
  raceEnd: {
    valid: {
      t: 'raceEnd',
      results: [
        { id: 4, place: 1, timeMs: 45123, checkpoint: 3 },
        { id: 5, place: 2, timeMs: null, checkpoint: 1 },
      ],
    },
    invalid: [{ t: 'raceEnd' }, { t: 'raceEnd', results: [{ id: 4, place: 1, checkpoint: 3 }] }],
  },
  error: { valid: { t: 'error', code: 'bad_message', msg: 'nope' }, invalid: [{ t: 'error', code: 7, msg: 'nope' }] },
};

const typesOf = (schema: typeof ClientMessageSchema | typeof ServerMessageSchema): string[] =>
  schema.options.map((o) => o.shape.t.value).sort();
const SIDES = [
  ['client', CLIENT],
  ['server', SERVER],
] as const;

describe('control messages', () => {
  it('has a valid and an invalid example for every message in the schemas', () => {
    expect(Object.keys(CLIENT).sort()).toEqual(typesOf(ClientMessageSchema));
    expect(Object.keys(SERVER).sort()).toEqual(typesOf(ServerMessageSchema));
    for (const [, examples] of SIDES)
      for (const ex of Object.values(examples)) expect(ex.invalid.length).toBeGreaterThan(0);
  });

  for (const [from, examples] of SIDES) {
    const other = from === 'client' ? 'server' : 'client';
    describe.each(Object.entries(examples))(`${from} %s`, (t, ex: Example<ControlMessage>) => {
      it('valid example survives serialize -> parse unchanged', () => {
        const text = serializeControl(ex.valid);
        expect(JSON.parse(text)).toEqual(ex.valid);
        expect(parseControl(text, from)).toEqual(ex.valid);
        expect((from === 'client' ? parseClientControl : parseServerControl)(text)).toEqual(ex.valid);
      });

      it('is rejected when it comes from the other side', () => {
        expect(parseControl(JSON.stringify(ex.valid), other)).toBeNull();
      });

      it('unknown fields are stripped', () => {
        const noisy = { ...ex.valid, admin: true, __proto__: { hacked: 1 }, t2: 'x' };
        const text = JSON.stringify(noisy).replace(/}$/, ',"__proto__":{"polluted":true}}');
        expect(parseControl(text, from)).toEqual(ex.valid);
        expect(serializeControl(noisy as ControlMessage)).toBe(serializeControl(ex.valid));
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });

      it('invalid examples are rejected by parse and by serialize', () => {
        for (const bad of ex.invalid) {
          expect(parseControl(JSON.stringify(bad), from)).toBeNull();
          expect(() => serializeControl(bad as ControlMessage)).toThrow(TypeError);
        }
        expect(parseControl(JSON.stringify({ ...ex.valid, t: `${t}X` }), from)).toBeNull();
      });
    });
  }

  it('strips unknown fields inside nested objects', () => {
    const noisyRoom = {
      ...room,
      secret: 1,
      players: [{ ...player, ip: '10.0.0.1' }],
      config: { ...room.config, x: 1 },
    };
    const text = JSON.stringify({ t: 'welcome', playerId: 1, token: 'tok', room: noisyRoom });
    expect(parseServerControl(text)).toEqual({ t: 'welcome', playerId: 1, token: 'tok', room });
  });

  it('rejects unknown types, non-objects and non-JSON without throwing', () => {
    const bad = [
      '',
      ' ',
      'null',
      'true',
      '42',
      '"ping"',
      '[]',
      '[{"t":"ping","c":1}]',
      '{}',
      '{"t":1}',
      '{"t":"nope"}',
    ];
    bad.push(
      '{"t":"ping","c":1',
      '{"t":"ping","c":1}}',
      "{'t':'start'}",
      '{"t":"ping","c":NaN}',
      '{"t":"ping","c":1e999}',
    );
    bad.push('{"t":"toString"}', '{"t":"__proto__"}', '['.repeat(4000), '{"a":'.repeat(800));
    for (const text of bad) {
      expect(parseClientControl(text)).toBeNull();
      expect(parseServerControl(text)).toBeNull();
    }
    for (const notText of [null, undefined, 42, {}, new Uint8Array(4)]) {
      expect(parseClientControl(notText as unknown as string)).toBeNull();
    }
    expect(() => serializeControl(null as unknown as ControlMessage)).toThrow(TypeError);
    expect(() => serializeControl({ t: 'nope' } as unknown as ControlMessage)).toThrow(TypeError);
  });

  it('enforces the 4 KB cap on client frames, counted in UTF-8 bytes', () => {
    const pad = (n: number, ch = ' ') => `{"t":"start"${ch.repeat(n)}}`;
    const base = pad(0).length;
    expect(controlMaxBytes('client')).toBe(WIRE.CONTROL_MAX_BYTES);
    expect(parseClientControl(pad(WIRE.CONTROL_MAX_BYTES - base))).toEqual({ t: 'start' });
    expect(parseClientControl(pad(WIRE.CONTROL_MAX_BYTES - base + 1))).toBeNull();
    // 2000 code units, but 6000 bytes: a length check on the string alone would let it through
    const wide = JSON.stringify({ t: 'start', junk: '€'.repeat(1990) });
    expect(wide.length).toBeLessThan(WIRE.CONTROL_MAX_BYTES);
    expect(parseClientControl(wide)).toBeNull();
    expect(parseControl(wide, 'client', 8192)).toEqual({ t: 'start' });
    expect(parseControl('{"t":"start"}', 'client', 5)).toBeNull();
  });

  it('counts UTF-8 bytes like TextEncoder does', () => {
    const rand = rng(3);
    const encoder = new TextEncoder();
    const samples = ['', 'abc', 'é', '€', '🦋', '\ud83e', '\udd8b', 'a\ud83eb', '\udd8b\ud83e'];
    for (let i = 0; i < 2000; i++) {
      samples.push(
        String.fromCharCode(...Array.from({ length: Math.floor(rand() * 12) }, () => Math.floor(rand() * 65536))),
      );
    }
    for (const s of samples) expect(utf8ByteLength(s)).toBe(encoder.encode(s).length);
  });

  it('lets a full 300-player room through the server cap (it cannot fit in 4 KB)', () => {
    const players: RoomPlayer[] = Array.from({ length: 300 }, (_, id) => ({
      id,
      name: `Player_${String(id).padStart(9, '0')}`,
      skinId: `g:${'s'.repeat(40)}`,
      ready: true,
      connected: true,
    }));
    const welcome: ServerMessage = { t: 'welcome', playerId: 0, token: 'tok', room: { ...room, players } };
    const text = serializeControl(welcome);
    expect(utf8ByteLength(text)).toBeGreaterThan(WIRE.CONTROL_MAX_BYTES);
    expect(utf8ByteLength(text)).toBeLessThan(SERVER_CONTROL_MAX_BYTES / 2);
    expect(parseServerControl(text)).toEqual(welcome);
    expect(parseControl(text, 'server', WIRE.CONTROL_MAX_BYTES)).toBeNull();
  });

  it('serializeControl refuses a frame over the cap', () => {
    const big: ServerMessage = { t: 'error', code: 'x', msg: 'm'.repeat(SERVER_CONTROL_MAX_BYTES) };
    expect(() => serializeControl(big)).toThrow(RangeError);
  });

  it('never throws on truncated, mutated or random text (20,000 cases)', () => {
    const rand = rng(11);
    const texts = [...Object.values(CLIENT), ...Object.values(SERVER)].map((ex) => JSON.stringify(ex.valid));
    let thrown = 0;
    let parsed = 0;
    for (let i = 0; i < 20000; i++) {
      let text = texts[i % texts.length];
      const at = Math.floor(rand() * (text.length + 1));
      if (i % 4 === 0) text = text.slice(0, at);
      else if (i % 4 === 1)
        text = text.slice(0, at) + String.fromCharCode(Math.floor(rand() * 65536)) + text.slice(at + 1);
      else if (i % 4 === 2) text = String.fromCharCode(...Array.from({ length: at }, () => Math.floor(rand() * 128)));
      try {
        if (parseClientControl(text) !== null) parsed++;
        if (parseServerControl(text) !== null) parsed++;
      } catch {
        thrown++;
      }
    }
    expect(thrown).toBe(0);
    expect(parsed).toBeGreaterThan(5000);
  });
});

describe('protocol version', () => {
  it('accepts only this build’s version', () => {
    expect(isProtocolSupported(PROTOCOL_VERSION)).toBe(true);
    expect(checkProtocolVersion(PROTOCOL_VERSION)).toBeNull();
    for (const v of [PROTOCOL_VERSION + 1, PROTOCOL_VERSION - 1, 0, String(PROTOCOL_VERSION), null, undefined, NaN]) {
      expect(isProtocolSupported(v)).toBe(false);
      const err = checkProtocolVersion(v)!;
      expect(err.code).toBe(PROTOCOL_MISMATCH);
      expect(parseServerControl(serializeControl(err))).toEqual(err);
    }
    expect(checkProtocolVersion(PROTOCOL_VERSION + 1)!.msg).toContain(`v${PROTOCOL_VERSION + 1}`);
  });
});
