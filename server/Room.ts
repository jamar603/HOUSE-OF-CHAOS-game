/**
 * One game room: lobby (members, ready flags, settings, host) and, while a
 * match is running, the authoritative simulation with its bots.
 *
 * Disconnections:
 * - in the lobby, a member keeps their place for LOBBY_GRACE_MS and can come back;
 * - in a match, a bot takes over the character until the player reconnects.
 */
import { BotController } from '../src/shared/bots/BotController';
import type { NavigationGrid } from '../src/shared/bots/pathfinding';
import { CHARACTERS, MAX_PLAYERS, PREPARATION_PRESETS } from '../src/shared/constants';
import { encodeSnapshot } from '../src/shared/network/snapshot';
import {
  MAX_ROOM_PLAYERS,
  SNAPSHOT_RATE,
  type ClientMessage,
  type LobbySettings,
  type LobbyState,
  type NoticeTone,
  type ServerMessage,
} from '../src/shared/network/protocol';
import { GameSimulation, type PlayerSetup } from '../src/shared/simulation/GameSimulation';
import { createEmptyInput, type GameEvent, type PlayerInput } from '../src/shared/types';

export const LOBBY_GRACE_MS = 30_000;
export const EMPTY_ROOM_GRACE_MS = 60_000;
const TICK_RATE = 60;
const TICKS_PER_SNAPSHOT = Math.round(TICK_RATE / SNAPSHOT_RATE);
/** Delay between the end of a match and the return to the lobby. */
const RETURN_TO_LOBBY_MS = 4000;

export interface Connection {
  readonly sessionId: string;
  send(message: ServerMessage): void;
}

export interface Member {
  readonly publicId: string;
  readonly sessionId: string;
  name: string;
  characterId: string;
  ready: boolean;
  connection: Connection | null;
  disconnectedAt: number | null;
}

interface PendingInput {
  latest: PlayerInput;
  /** Taps seen since the last tick, so a short key press is never lost. */
  interactLatch: boolean;
  dropLatch: boolean;
  attackLatch: boolean;
}

class Match {
  readonly sim: GameSimulation;
  /** publicId -> player slot. */
  readonly slots = new Map<string, number>();
  readonly bots = new Map<number, BotController>();
  readonly inputs = new Map<number, PendingInput>();
  pendingEvents: GameEvent[] = [];
  tick = 0;
  endedAt: number | null = null;

  constructor(
    readonly setups: PlayerSetup[],
    readonly preparationSeconds: number,
    private readonly grid: NavigationGrid,
    private readonly seed: number,
  ) {
    this.sim = new GameSimulation(setups, { preparationSeconds, seed });
  }

  setBot(slot: number, enabled: boolean): void {
    if (enabled && !this.bots.has(slot)) this.bots.set(slot, new BotController(slot, this.grid, this.seed + slot * 7919));
    if (!enabled) this.bots.delete(slot);
  }
}

let publicIdCounter = 0;

export class Room {
  readonly members: Member[] = [];
  hostPublicId: string | null = null;
  settings: LobbySettings = { preparationSeconds: PREPARATION_PRESETS[0].seconds, fillWithBots: true };
  match: Match | null = null;
  emptySince: number | null = null;

  constructor(
    readonly code: string,
    private readonly grid: NavigationGrid,
    private readonly now: () => number = Date.now,
  ) {}

  // ---------------------------------------------------------------- membership

  get connectedMembers(): Member[] {
    return this.members.filter((member) => member.connection !== null);
  }

  isFull(): boolean {
    return this.members.length >= MAX_ROOM_PLAYERS;
  }

  findBySession(sessionId: string): Member | undefined {
    return this.members.find((member) => member.sessionId === sessionId);
  }

  private freeCharacter(preferred: string, except?: Member): string {
    const taken = new Set(this.members.filter((m) => m !== except).map((m) => m.characterId));
    if (!taken.has(preferred)) return preferred;
    return CHARACTERS.find((character) => !taken.has(character.id))?.id ?? preferred;
  }

  /** Returns an error message, or null when the member was added. */
  addMember(connection: Connection, name: string, characterId: string): Member | string {
    if (this.match) return 'La partie a déjà commencé dans ce salon.';
    if (this.isFull()) return `Ce salon est complet (${MAX_ROOM_PLAYERS} joueurs).`;
    const member: Member = {
      publicId: `p${++publicIdCounter}`,
      sessionId: connection.sessionId,
      name,
      characterId: this.freeCharacter(characterId),
      ready: false,
      connection,
      disconnectedAt: null,
    };
    this.members.push(member);
    if (!this.hostPublicId) this.hostPublicId = member.publicId;
    this.emptySince = null;
    this.broadcastNotice(`${name} a rejoint le salon`, 'good', member);
    this.broadcastLobby();
    return member;
  }

  removeMember(member: Member, reason: string): void {
    const index = this.members.indexOf(member);
    if (index < 0) return;
    this.members.splice(index, 1);
    member.connection?.send({ type: 'leftRoom', reason });
    if (this.match) {
      const slot = this.match.slots.get(member.publicId);
      if (slot !== undefined) this.match.setBot(slot, true);
      this.match.slots.delete(member.publicId);
    }
    if (this.hostPublicId === member.publicId) this.pickNewHost();
    this.broadcastNotice(`${member.name} a quitté le salon`, 'info');
    this.broadcastLobby();
  }

  private pickNewHost(): void {
    const next = this.members.find((member) => member.connection !== null) ?? this.members[0];
    this.hostPublicId = next?.publicId ?? null;
    if (next) this.broadcastNotice(`${next.name} est maintenant l'hôte`, 'info');
  }

  disconnect(member: Member): void {
    member.connection = null;
    member.disconnectedAt = this.now();
    if (this.match && this.match.endedAt === null) {
      const slot = this.match.slots.get(member.publicId);
      if (slot !== undefined) this.match.setBot(slot, true);
      this.broadcastNotice(`${member.name} s'est déconnecté · un bot le remplace`, 'danger');
    } else {
      this.broadcastNotice(`${member.name} s'est déconnecté`, 'danger');
    }
    if (this.hostPublicId === member.publicId && this.connectedMembers.length > 0) this.pickNewHost();
    if (this.connectedMembers.length === 0) this.emptySince = this.now();
    this.broadcastLobby();
  }

  reconnect(member: Member, connection: Connection): void {
    member.connection = connection;
    member.disconnectedAt = null;
    this.emptySince = null;
    if (!this.hostPublicId || !this.members.some((m) => m.publicId === this.hostPublicId && m.connection)) {
      this.hostPublicId = member.publicId;
    }
    this.broadcastNotice(`${member.name} est de retour`, 'good', member);
    this.sendLobby(member);
    if (this.match && this.match.endedAt === null) {
      const slot = this.match.slots.get(member.publicId);
      if (slot !== undefined) {
        this.match.setBot(slot, false);
        connection.send({
          type: 'matchStart',
          localPlayerId: slot,
          players: this.match.setups,
          preparationSeconds: this.match.preparationSeconds,
        });
      }
    }
    this.broadcastLobby();
  }

  // ---------------------------------------------------------------- messages

  handle(member: Member, message: ClientMessage): void {
    switch (message.type) {
      case 'leaveRoom':
        this.removeMember(member, 'Vous avez quitté le salon.');
        return;
      case 'setReady':
        if (this.match) return;
        member.ready = message.ready;
        this.broadcastLobby();
        return;
      case 'setCharacter': {
        if (this.match) return;
        const taken = this.members.some((other) => other !== member && other.characterId === message.characterId);
        if (taken) {
          member.connection?.send({ type: 'error', message: 'Ce personnage est déjà pris.' });
          return;
        }
        member.characterId = message.characterId;
        this.broadcastLobby();
        return;
      }
      case 'setSettings':
        if (this.match || member.publicId !== this.hostPublicId) return;
        this.settings = { ...this.settings, ...message.settings };
        this.broadcastLobby();
        return;
      case 'startMatch': {
        if (member.publicId !== this.hostPublicId) {
          member.connection?.send({ type: 'error', message: "Seul l'hôte peut lancer la partie." });
          return;
        }
        const problem = this.startProblem();
        if (problem) {
          member.connection?.send({ type: 'error', message: problem });
          return;
        }
        this.startMatch();
        return;
      }
      case 'input': {
        const slot = this.match?.slots.get(member.publicId);
        if (!this.match || slot === undefined) return;
        const pending = this.match.inputs.get(slot);
        const input = message.input;
        if (!pending) {
          this.match.inputs.set(slot, { latest: input, interactLatch: input.interact, dropLatch: input.drop, attackLatch: input.attack });
        } else {
          pending.latest = input;
          pending.interactLatch ||= input.interact;
          pending.dropLatch ||= input.drop;
          pending.attackLatch ||= input.attack;
        }
        return;
      }
      default:
        return;
    }
  }

  /** Why the host cannot start yet, or null. */
  startProblem(): string | null {
    if (this.match) return 'Une partie est déjà en cours.';
    const connected = this.connectedMembers;
    if (connected.length === 0) return 'Aucun joueur connecté.';
    const notReady = connected.filter((member) => member.publicId !== this.hostPublicId && !member.ready);
    if (notReady.length > 0) return `En attente : ${notReady.map((member) => member.name).join(', ')} pas prêt.`;
    if (!this.settings.fillWithBots && connected.length < 2) return 'Il faut au moins 2 joueurs (ou activer les bots).';
    return null;
  }

  private startMatch(): void {
    // Disconnected members are dropped before the match starts.
    for (const member of this.members.filter((m) => m.connection === null)) this.removeMember(member, 'Déconnecté.');
    const playerCount = this.settings.fillWithBots ? MAX_PLAYERS : this.members.length;
    const usedCharacters = new Set(this.members.map((member) => member.characterId));
    const botCharacters = CHARACTERS.filter((character) => !usedCharacters.has(character.id));

    // One entry per player, humans first, then bots for the empty places.
    const entries: { setup: PlayerSetup; member: Member | null }[] = this.members.map((member) => ({
      setup: { name: member.name, characterId: member.characterId, isBot: false },
      member,
    }));
    while (entries.length < playerCount) {
      const character = botCharacters.shift() ?? CHARACTERS[entries.length];
      entries.push({ setup: { name: character.name, characterId: character.id, isBot: true }, member: null });
    }
    // Shuffle so everyone gets a random bedroom (slot = bedroom).
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
    const finalSetups = entries.map((entry) => entry.setup);
    const memberForFinalSlot = new Map<number, Member>();
    entries.forEach((entry, slot) => {
      if (entry.member) memberForFinalSlot.set(slot, entry.member);
    });

    const seed = Math.floor(Math.random() * 1_000_000);
    const match = new Match(finalSetups, this.settings.preparationSeconds, this.grid, seed);
    finalSetups.forEach((setup, slot) => {
      if (setup.isBot) match.setBot(slot, true);
    });
    memberForFinalSlot.forEach((member, slot) => match.slots.set(member.publicId, slot));
    this.match = match;
    for (const member of this.members) member.ready = false;
    this.broadcastLobby();
    for (const [slot, member] of memberForFinalSlot) {
      member.connection?.send({
        type: 'matchStart',
        localPlayerId: slot,
        players: finalSetups,
        preparationSeconds: this.settings.preparationSeconds,
      });
    }
    this.broadcastSnapshot();
  }

  // ---------------------------------------------------------------- simulation

  /** Advances the match by one fixed tick (1/60 s). */
  tick(dt: number): void {
    const match = this.match;
    if (!match) return;
    if (match.endedAt !== null) {
      if (this.now() - match.endedAt >= RETURN_TO_LOBBY_MS) this.returnToLobby();
      return;
    }
    const inputs = new Map<number, PlayerInput>();
    for (const [slot, bot] of match.bots) inputs.set(slot, bot.computeInput(match.sim, dt));
    for (const [slot, pending] of match.inputs) {
      if (match.bots.has(slot)) continue;
      inputs.set(slot, {
        ...pending.latest,
        interact: pending.latest.interact || pending.interactLatch,
        drop: pending.latest.drop || pending.dropLatch,
        attack: pending.latest.attack || pending.attackLatch,
      });
      pending.interactLatch = false;
      pending.dropLatch = false;
      pending.attackLatch = false;
    }
    for (const slot of match.slots.values()) if (!inputs.has(slot)) inputs.set(slot, createEmptyInput(match.sim.players[slot].facing));

    match.sim.step(dt, inputs);
    match.pendingEvents.push(...match.sim.events);
    match.tick++;
    const finished = match.sim.phase === 'finished';
    if (match.tick % TICKS_PER_SNAPSHOT === 0 || finished) this.broadcastSnapshot();
    if (finished) match.endedAt = this.now();
  }

  private broadcastSnapshot(): void {
    const match = this.match;
    if (!match) return;
    const message: ServerMessage = { type: 'snapshot', snapshot: encodeSnapshot(match.sim), events: match.pendingEvents };
    match.pendingEvents = [];
    for (const member of this.members) member.connection?.send(message);
  }

  private returnToLobby(): void {
    this.match = null;
    for (const member of this.members.filter((m) => m.connection === null)) this.removeMember(member, 'Déconnecté.');
    for (const member of this.members) member.ready = false;
    this.broadcastLobby();
  }

  /** Removes members whose lobby grace period expired. Returns true if the room should be deleted. */
  cleanup(): boolean {
    const now = this.now();
    if (!this.match) {
      for (const member of this.members.filter((m) => m.disconnectedAt !== null && now - m.disconnectedAt > LOBBY_GRACE_MS)) {
        this.removeMember(member, 'Déconnecté trop longtemps.');
      }
    }
    if (this.members.length === 0) return true;
    return this.emptySince !== null && now - this.emptySince > EMPTY_ROOM_GRACE_MS;
  }

  // ---------------------------------------------------------------- broadcasting

  lobbyStateFor(member: Member): LobbyState {
    return {
      code: this.code,
      members: this.members.map((m) => ({
        publicId: m.publicId,
        name: m.name,
        characterId: m.characterId,
        ready: m.ready,
        connected: m.connection !== null,
        isHost: m.publicId === this.hostPublicId,
      })),
      settings: { ...this.settings },
      inMatch: this.match !== null && this.match.endedAt === null,
      yourPublicId: member.publicId,
      maxPlayers: MAX_ROOM_PLAYERS,
    };
  }

  private sendLobby(member: Member): void {
    member.connection?.send({ type: 'lobby', lobby: this.lobbyStateFor(member) });
  }

  broadcastLobby(): void {
    for (const member of this.members) this.sendLobby(member);
  }

  broadcastNotice(text: string, tone: NoticeTone, except?: Member): void {
    for (const member of this.members) if (member !== except) member.connection?.send({ type: 'notice', text, tone });
  }
}
