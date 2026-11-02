import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startGameServer, type RunningGameServer } from '../server/gameServer';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../src/shared/network/protocol';
import { applySnapshot, encodeSnapshot } from '../src/shared/network/snapshot';
import { GameSimulation } from '../src/shared/simulation/GameSimulation';
import { createEmptyInput } from '../src/shared/types';

/** Minimal test client that records every server message. */
class TestClient {
  readonly messages: ServerMessage[] = [];
  private socket!: WebSocket;
  sessionId: string | null = null;

  constructor(private readonly url: string) {}

  async connect(sessionId: string | null = null): Promise<void> {
    this.socket = new WebSocket(this.url);
    this.socket.on('message', (data) => this.messages.push(JSON.parse(data.toString()) as ServerMessage));
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
    this.send({ type: 'hello', protocol: PROTOCOL_VERSION, sessionId });
    const welcome = await this.waitFor('welcome');
    this.sessionId = welcome.sessionId;
  }

  send(message: ClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }

  last<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].type === type) return this.messages[i] as Extract<ServerMessage, { type: T }>;
    }
    return undefined;
  }

  async waitFor<T extends ServerMessage['type']>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    timeoutMs = 4000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const start = Date.now();
    let checked = 0;
    for (;;) {
      for (; checked < this.messages.length; checked++) {
        const message = this.messages[checked];
        if (message.type === type && predicate(message as Extract<ServerMessage, { type: T }>)) {
          return message as Extract<ServerMessage, { type: T }>;
        }
      }
      if (Date.now() - start > timeoutMs) throw new Error(`Timeout waiting for ${type}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
}

describe('snapshot encoding', () => {
  it('round-trips the state onto a mirror simulation', () => {
    const setups = [
      { name: 'A', characterId: 'max', isBot: false },
      { name: 'B', characterId: 'lola', isBot: true },
    ];
    const server = new GameSimulation(setups, { preparationSeconds: 0, seed: 4 });
    server.players[0].health = 42;
    server.players[1].life = 'downed';
    server.players[1].bleedOutRemaining = 12.5;
    const mirror = new GameSimulation(setups, { preparationSeconds: 60, seed: 9 });
    applySnapshot(mirror, encodeSnapshot(server));
    expect(mirror.phase).toBe('chaos');
    expect(mirror.players[0].health).toBe(42);
    expect(mirror.players[1].life).toBe('downed');
    expect(mirror.players[1].bleedOutRemaining).toBe(12.5);
    expect(mirror.items.length).toBe(server.items.length);
    expect(mirror.items[0].kind).toBe(server.items[0].kind);
    expect(JSON.stringify(encodeSnapshot(server)).length).toBeLessThan(5000);
  });
});

describe('game server', () => {
  let server: RunningGameServer;
  let url: string;

  beforeAll(async () => {
    server = await startGameServer({ port: 0, log: false, distDir: 'does-not-exist' });
    url = `ws://127.0.0.1:${server.port}/ws`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('rejects malformed and unknown messages', async () => {
    const client = new TestClient(url);
    await client.connect();
    client.send({ type: 'joinRoom', code: 'ZZZZZ', name: 'X', characterId: 'max' });
    const error = await client.waitFor('error');
    expect(error.message).toContain('ZZZZZ');
    client.close();
  });

  it('creates a room, joins with the code, readies up and plays a match', async () => {
    const host = new TestClient(url);
    const guest = new TestClient(url);
    await host.connect();
    await guest.connect();

    host.send({ type: 'createRoom', name: 'Hôte', characterId: 'max' });
    const created = await host.waitFor('lobby');
    expect(created.lobby.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(created.lobby.members[0].isHost).toBe(true);

    // Same character requested: the server gives the guest a free one.
    guest.send({ type: 'joinRoom', code: created.lobby.code.toLowerCase(), name: 'Invité', characterId: 'max' });
    const joined = await guest.waitFor('lobby', (message) => message.lobby.members.length === 2);
    const guestMember = joined.lobby.members.find((member) => member.publicId === joined.lobby.yourPublicId);
    expect(guestMember?.characterId).not.toBe('max');

    // Host cannot start before the guest is ready; the guest cannot start at all.
    host.send({ type: 'startMatch' });
    expect((await host.waitFor('error')).message).toContain('Invité');
    guest.send({ type: 'startMatch' });
    expect((await guest.waitFor('error')).message).toContain("l'hôte");

    guest.send({ type: 'setReady', ready: true });
    await host.waitFor('lobby', (message) => message.lobby.members.some((member) => member.ready));
    host.send({ type: 'setSettings', settings: { preparationSeconds: 60 } });
    host.send({ type: 'startMatch' });
    const hostStart = await host.waitFor('matchStart');
    const guestStart = await guest.waitFor('matchStart');
    expect(hostStart.players).toHaveLength(4);
    expect(hostStart.players.filter((player) => player.isBot)).toHaveLength(2);
    expect(hostStart.localPlayerId).not.toBe(guestStart.localPlayerId);

    // Inputs move the right character on the server.
    const firstSnapshot = await host.waitFor('snapshot');
    const startX = firstSnapshot.snapshot.players[hostStart.localPlayerId][0];
    for (let i = 0; i < 20; i++) {
      host.send({ type: 'input', input: { ...createEmptyInput(), moveX: hostStart.localPlayerId % 2 === 0 ? 1 : -1 } });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const later = host.last('snapshot');
    expect(later).toBeDefined();
    expect(Math.abs(later!.snapshot.players[hostStart.localPlayerId][0] - startX)).toBeGreaterThan(20);

    // Disconnect: a bot takes over, then the player comes back with the same session.
    const guestSession = guest.sessionId;
    guest.close();
    await host.waitFor('notice', (message) => message.text.includes('bot'));
    const returning = new TestClient(url);
    await returning.connect(guestSession);
    const resumedStart = await returning.waitFor('matchStart');
    expect(resumedStart.localPlayerId).toBe(guestStart.localPlayerId);
    await returning.waitFor('snapshot');

    // Leaving the room.
    returning.send({ type: 'leaveRoom' });
    await returning.waitFor('leftRoom');
    host.close();
    returning.close();
  });
});
