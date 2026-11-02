/** Routes validated client messages to rooms and keeps the session -> room index. */
import { randomInt, randomUUID } from 'node:crypto';
import { NavigationGrid } from '../src/shared/bots/pathfinding';
import { createHouseMap } from '../src/shared/house/houseLayout';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  type ClientMessage,
} from '../src/shared/network/protocol';
import { Room, type Connection, type Member } from './Room';

export interface ClientSession extends Connection {
  sessionId: string;
  /** Set once the client said hello. */
  helloDone: boolean;
}

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly grid = new NavigationGrid(createHouseMap());

  constructor(private readonly now: () => number = Date.now) {}

  static createSessionId(): string {
    return randomUUID();
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < INVITE_CODE_LENGTH; i++) code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Impossible de générer un code de salon unique.');
  }

  private locate(sessionId: string): { room: Room; member: Member } | null {
    for (const room of this.rooms.values()) {
      const member = room.findBySession(sessionId);
      if (member) return { room, member };
    }
    return null;
  }

  /** Re-attaches a returning session to its room. Returns true when resumed. */
  resume(session: ClientSession): boolean {
    const found = this.locate(session.sessionId);
    if (!found) return false;
    found.room.reconnect(found.member, session);
    return true;
  }

  handle(session: ClientSession, message: ClientMessage): void {
    const found = this.locate(session.sessionId);
    switch (message.type) {
      case 'createRoom': {
        if (found) found.room.removeMember(found.member, 'Vous avez créé un autre salon.');
        const room = new Room(this.generateCode(), this.grid, this.now);
        this.rooms.set(room.code, room);
        room.addMember(session, message.name, message.characterId);
        return;
      }
      case 'joinRoom': {
        const room = this.rooms.get(message.code);
        if (!room) {
          session.send({ type: 'error', message: `Aucun salon avec le code ${message.code || '?'}.` });
          return;
        }
        if (found?.room === room) {
          room.broadcastLobby();
          return;
        }
        const result = room.addMember(session, message.name, message.characterId);
        if (typeof result === 'string') {
          session.send({ type: 'error', message: result });
          return;
        }
        if (found) found.room.removeMember(found.member, 'Vous avez rejoint un autre salon.');
        return;
      }
      case 'ping':
        session.send({ type: 'pong', sentAt: message.sentAt });
        return;
      case 'hello':
        return;
      default:
        if (!found) {
          if (message.type !== 'input') session.send({ type: 'error', message: "Vous n'êtes dans aucun salon." });
          return;
        }
        found.room.handle(found.member, message);
    }
  }

  disconnect(session: ClientSession): void {
    const found = this.locate(session.sessionId);
    // Ignore stale sockets: the member may already use a newer connection.
    if (found && found.member.connection === session) found.room.disconnect(found.member);
  }

  tick(dt: number): void {
    for (const room of this.rooms.values()) room.tick(dt);
  }

  cleanup(): void {
    for (const [code, room] of this.rooms) {
      if (room.cleanup()) this.rooms.delete(code);
    }
  }
}
