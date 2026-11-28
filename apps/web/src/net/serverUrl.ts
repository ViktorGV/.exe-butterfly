/// <reference types="vite/client" />
// Where the game server lives. Owned by FLY-1 (#86).
// Production serves client and server from one host, so no config is needed;
// VITE_GAME_SERVER_URL overrides it for local dev (Vite on :5173, server on :8787).

export function getServerUrl(
  loc: Pick<Location, 'protocol' | 'host'> = window.location,
  override: string | undefined = import.meta.env?.VITE_GAME_SERVER_URL,
): string {
  if (override) return override;
  // `bun run dev`: Vite serves the page on :5173 and the game server listens on :8787
  if (import.meta.env?.DEV)
    return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host.replace(/:\d+$/, '')}:8787`;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}`;
}
