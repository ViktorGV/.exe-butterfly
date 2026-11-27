import { describe, expect, it } from 'bun:test';
import { createEmitter } from './emitter.ts';
import type { UIEvents } from './types.ts';

describe('createEmitter', () => {
  it('delivers payloads to every listener of that event only', () => {
    const e = createEmitter<UIEvents>();
    const joins: UIEvents['play:join'][] = [];
    let quick = 0;
    e.on('play:join', (p) => joins.push(p));
    e.on('play:join', (p) => joins.push({ ...p, code: p.code.toLowerCase() }));
    e.on('play:quick', () => quick++);
    e.emit('play:join', { name: 'Ada', code: 'ABCDE' });
    expect(joins).toEqual([
      { name: 'Ada', code: 'ABCDE' },
      { name: 'Ada', code: 'abcde' },
    ]);
    expect(quick).toBe(0);
  });

  it('unsubscribes with the returned function, also during emit', () => {
    const e = createEmitter<UIEvents>();
    let a = 0;
    let b = 0;
    const offA = e.on('resume', () => {
      a++;
      offA();
    });
    e.on('resume', () => b++);
    e.emit('resume', undefined);
    e.emit('resume', undefined);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it('keeps calling other listeners when one throws', () => {
    const errors: unknown[] = [];
    const e = createEmitter<UIEvents>((err) => errors.push(err));
    let called = false;
    e.on('leave', () => {
      throw new Error('boom');
    });
    e.on('leave', () => (called = true));
    e.emit('leave', undefined);
    expect(called).toBe(true);
    expect(errors.length).toBe(1);
  });

  it('emitting with no listeners is a no-op, and clear() removes everything', () => {
    const e = createEmitter<UIEvents>();
    expect(() => e.emit('restart', undefined)).not.toThrow();
    let n = 0;
    e.on('restart', () => n++);
    e.clear();
    e.emit('restart', undefined);
    expect(n).toBe(0);
  });

  it('carries the full settings object on settings:change', () => {
    const e = createEmitter<UIEvents>();
    let got: UIEvents['settings:change'] | null = null;
    e.on('settings:change', (s) => (got = s));
    const s = { master: 0.5, music: 0.2, sfx: 1, sensitivity: 1.5, quality: 'high' as const };
    e.emit('settings:change', s);
    expect(got!).toEqual(s);
  });
});
