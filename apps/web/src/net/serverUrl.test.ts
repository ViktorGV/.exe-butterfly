import { describe, expect, it } from 'bun:test';
import { getServerUrl } from './serverUrl.ts';

describe('getServerUrl', () => {
  it('uses wss on https', () => {
    expect(getServerUrl({ protocol: 'https:', host: 'wobble.fly.dev' }, undefined)).toBe('wss://wobble.fly.dev');
  });
  it('uses ws on http, keeping the port', () => {
    expect(getServerUrl({ protocol: 'http:', host: 'localhost:8787' }, undefined)).toBe('ws://localhost:8787');
  });
  it('lets VITE_GAME_SERVER_URL override', () => {
    expect(getServerUrl({ protocol: 'http:', host: 'localhost:5173' }, 'ws://localhost:8787')).toBe(
      'ws://localhost:8787',
    );
  });
});
