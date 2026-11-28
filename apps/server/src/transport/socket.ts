// Bun WebSocket handlers: handshake, control-message parsing, binary forwarding, close.
import type { ServerWebSocket, WebSocketHandler } from 'bun';
import { PROTOCOL_VERSION, WIRE } from '@wobble/shared/constants';
import { ClientMessageSchema } from '@wobble/shared/schemas/protocol';
import type { ServerMessage } from '@wobble/shared/types';
import type { RoomRegistry } from '../room/registry.ts';
import type { Member, Peer, Room } from '../room/room.ts';
import type { IpCounter } from './guards.ts';

export const HANDSHAKE_TIMEOUT_MS = 5000;

export interface WsData {
  ip: string;
  room: Room | null;
  member: Member | null;
  peer: Peer | null;
  helloTimer: ReturnType<typeof setTimeout> | null;
}

type Ws = ServerWebSocket<WsData>;

const encode = (msg: ServerMessage) => JSON.stringify(msg);

function toPeer(ws: Ws): Peer {
  return {
    send: (data) => ws.send(data),
    buffered: () => ws.getBufferedAmount(),
    close: (code, reason) => ws.close(code, reason),
    subscribe: (t) => ws.subscribe(t),
    unsubscribe: (t) => ws.unsubscribe(t),
  };
}

function reject(ws: Ws, code: string, msg: string, closeCode = 4000) {
  ws.send(encode({ t: 'error', code, msg }));
  ws.close(closeCode, code);
}

export function createSocketHandler({
  registry,
  ips,
  handshakeMs = HANDSHAKE_TIMEOUT_MS,
}: {
  registry: RoomRegistry;
  ips: IpCounter;
  handshakeMs?: number;
}): WebSocketHandler<WsData> {
  function hello(ws: Ws, msg: Extract<ReturnType<typeof ClientMessageSchema.parse>, { t: 'hello' }>) {
    if (msg.v !== PROTOCOL_VERSION) return reject(ws, 'bad_version', `server speaks protocol ${PROTOCOL_VERSION}`);
    const peer = toPeer(ws);
    if (msg.token) {
      const found = registry.findToken(msg.token);
      if (found) {
        Object.assign(ws.data, { room: found.room, member: found.member, peer });
        found.room.reconnect(found.member, peer);
        return;
      }
    }
    let room: Room | null;
    if (msg.room === 'quick') room = registry.quick();
    else if (msg.room === 'new') room = registry.create(false);
    else {
      room = registry.byCode(msg.room);
      if (!room) return reject(ws, 'room_not_found', `no room ${msg.room}`);
    }
    if (!room) return reject(ws, 'draining', 'server is shutting down');
    if (!room.hasSpace()) return reject(ws, 'room_full', 'room is full');
    const member = room.join(peer, msg.name, msg.clientId.startsWith('bot-'));
    Object.assign(ws.data, { room, member, peer });
  }

  return {
    maxPayloadLength: WIRE.CONTROL_MAX_BYTES,
    perMessageDeflate: false,
    idleTimeout: 60, // heartbeat: Bun pings idle sockets and closes dead ones
    sendPings: true,
    open(ws) {
      ws.data.helloTimer = setTimeout(() => {
        if (!ws.data.member) reject(ws, 'handshake_timeout', 'expected hello', 4001);
      }, handshakeMs);
    },
    message(ws, data) {
      const { member, room } = ws.data;
      if (typeof data !== 'string') {
        if (member && room) room.handleBinary(member, data);
        else ws.close(4001, 'hello first');
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(data);
      } catch {
        raw = null;
      }
      const parsed = ClientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        if (!member) return reject(ws, 'bad_message', 'first frame must be a valid hello', 4001);
        ws.send(encode({ t: 'error', code: 'bad_message', msg: 'unrecognised control message' }));
        return;
      }
      const msg = parsed.data;
      if (msg.t === 'ping') return void ws.send(encode({ t: 'pong', c: msg.c, s: Date.now() }));
      if (!member || !room) {
        if (msg.t !== 'hello') return reject(ws, 'bad_message', 'first frame must be hello', 4001);
        if (ws.data.helloTimer) clearTimeout(ws.data.helloTimer);
        ws.data.helloTimer = null;
        return hello(ws, msg);
      }
      if (msg.t === 'hello') return void ws.send(encode({ t: 'error', code: 'bad_phase', msg: 'already joined' }));
      room.handle(member, msg);
    },
    close(ws) {
      const { member, room, peer, helloTimer } = ws.data;
      if (helloTimer) clearTimeout(helloTimer);
      ips.release(ws.data.ip);
      if (member && room && peer) room.disconnect(member, peer);
    },
  };
}
