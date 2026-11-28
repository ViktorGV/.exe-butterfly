// What the local player may do in the lobby (#12). The server enforces the same rules; this only hides controls.
import type { RoomState } from '@wobble/shared';

export type LobbyMode = 'event' | 'open';

export interface LobbyPermissions {
  isHost: boolean;
  canPickTheme: boolean;
  canStart: boolean;
  canStartVote: boolean;
  canVote: boolean;
  canPickSkin: boolean;
  canReady: boolean;
}

export function lobbyPermissions(
  room: Pick<RoomState, 'hostId' | 'phase'>,
  me: number,
  mode: LobbyMode,
  publicRoom = false,
): LobbyPermissions {
  const isHost = me >= 0 && room.hostId === me;
  const inLobby = room.phase === 'lobby';
  return {
    isHost,
    canPickTheme: mode === 'open' && isHost && inLobby,
    canStart: mode === 'open' && isHost && inLobby,
    canStartVote: mode === 'event' && isHost && inLobby && !publicRoom,
    canVote: mode === 'event' && room.phase === 'voting',
    canPickSkin: mode === 'open' && inLobby,
    canReady: inLobby || room.phase === 'voting',
  };
}

export function phaseBanner(phase: RoomState['phase'], isHost: boolean, mode: LobbyMode): string {
  switch (phase) {
    case 'lobby':
      if (mode === 'event') return isHost ? 'Start the theme vote when everyone is in' : 'Waiting for the vote';
      return isHost ? 'Pick a theme and press Start' : 'Waiting for host';
    case 'voting':
      return 'Vote for the theme!';
    default:
      return "Race in progress — you're in the next one";
  }
}
