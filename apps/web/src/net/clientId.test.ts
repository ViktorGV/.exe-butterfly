import { afterEach, describe, expect, it } from 'bun:test';
import { newClientId } from './clientId.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const original = crypto.randomUUID;

afterEach(() => {
  Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true });
});

describe('newClientId', () => {
  it('returns a uuid', () => {
    expect(newClientId()).toMatch(UUID);
  });

  it('still returns a unique v4 uuid when randomUUID is missing (insecure http context)', () => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    const a = newClientId();
    const b = newClientId();
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
  });
});
