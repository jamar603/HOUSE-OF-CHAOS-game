/**
 * Client <-> server messages (JSON over WebSocket).
 *
 * Clients only ever send lobby actions and their raw PlayerInput. The server
 * owns the simulation and answers with lobby states and world snapshots.
 * Every incoming message is validated by {@link parseClientMessage}.
 */
import { CHARACTERS, MAX_PLAYERS, PREPARATION_PRESETS } from '../constants';
import type { PlayerSetup } from '../simulation/GameSimulation';
import type { GameEvent, PlayerInput } from '../types';
import type { EncodedSnapshot } from './snapshot';

export const PROTOCOL_VERSION = 1;
export const INVITE_CODE_LENGTH = 5;
/** No 0/O/1/I to avoid confusion when a code is read aloud. */
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const SNAPSHOT_RATE = 20;
export const INPUT_SEND_RATE = 30;
export const MAX_NAME_LENGTH = 14;
export const MAX_MESSAGE_BYTES = 2048;
export const WEBSOCKET_PATH = '/ws';

export interface LobbyMember {
  publicId: string;
  name: string;
  characterId: string;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
}

export interface LobbySettings {
  preparationSeconds: number;
  /** Empty slots are played by server-side bots. */
  fillWithBots: boolean;
}

export interface LobbyState {
  code: string;
  members: LobbyMember[];
  settings: LobbySettings;
  inMatch: boolean;
  yourPublicId: string;
  maxPlayers: number;
}

export type NoticeTone = 'info' | 'danger' | 'good';

export type ClientMessage =
  | { type: 'hello'; protocol: number; sessionId: string | null }
  | { type: 'createRoom'; name: string; characterId: string }
  | { type: 'joinRoom'; code: string; name: string; characterId: string }
  | { type: 'leaveRoom' }
  | { type: 'setReady'; ready: boolean }
  | { type: 'setCharacter'; characterId: string }
  | { type: 'setSettings'; settings: Partial<LobbySettings> }
  | { type: 'startMatch' }
  | { type: 'input'; input: PlayerInput }
  | { type: 'ping'; sentAt: number };

export type ServerMessage =
  | { type: 'welcome'; sessionId: string; resumed: boolean }
  | { type: 'error'; message: string }
  | { type: 'lobby'; lobby: LobbyState }
  | { type: 'leftRoom'; reason: string }
  | { type: 'matchStart'; localPlayerId: number; players: PlayerSetup[]; preparationSeconds: number }
  | { type: 'snapshot'; snapshot: EncodedSnapshot; events: GameEvent[] }
  | { type: 'notice'; text: string; tone: NoticeTone }
  | { type: 'pong'; sentAt: number };

export function normalizeInviteCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, INVITE_CODE_LENGTH);
}

export function sanitizeName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : 'Joueur';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCharacterId(value: unknown): value is string {
  return typeof value === 'string' && CHARACTERS.some((character) => character.id === value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Validates an untrusted message. Returns null when it is malformed. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'hello':
      if (raw.protocol !== PROTOCOL_VERSION) return null;
      if (raw.sessionId !== null && (typeof raw.sessionId !== 'string' || raw.sessionId.length > 64)) return null;
      return { type: 'hello', protocol: PROTOCOL_VERSION, sessionId: raw.sessionId as string | null };
    case 'createRoom':
      if (typeof raw.name !== 'string' || !isCharacterId(raw.characterId)) return null;
      return { type: 'createRoom', name: sanitizeName(raw.name), characterId: raw.characterId };
    case 'joinRoom':
      if (typeof raw.code !== 'string' || typeof raw.name !== 'string' || !isCharacterId(raw.characterId)) return null;
      return { type: 'joinRoom', code: normalizeInviteCode(raw.code), name: sanitizeName(raw.name), characterId: raw.characterId };
    case 'leaveRoom':
    case 'startMatch':
      return { type: raw.type };
    case 'setReady':
      if (typeof raw.ready !== 'boolean') return null;
      return { type: 'setReady', ready: raw.ready };
    case 'setCharacter':
      if (!isCharacterId(raw.characterId)) return null;
      return { type: 'setCharacter', characterId: raw.characterId };
    case 'setSettings': {
      if (!isRecord(raw.settings)) return null;
      const settings: Partial<LobbySettings> = {};
      const prep = raw.settings.preparationSeconds;
      if (prep !== undefined) {
        if (!PREPARATION_PRESETS.some((preset) => preset.seconds === prep)) return null;
        settings.preparationSeconds = prep as number;
      }
      if (raw.settings.fillWithBots !== undefined) {
        if (typeof raw.settings.fillWithBots !== 'boolean') return null;
        settings.fillWithBots = raw.settings.fillWithBots;
      }
      return { type: 'setSettings', settings };
    }
    case 'input': {
      const input = raw.input;
      if (!isRecord(input)) return null;
      if (!isFiniteNumber(input.moveX) || !isFiniteNumber(input.moveY) || !isFiniteNumber(input.aimAngle)) return null;
      return {
        type: 'input',
        input: {
          moveX: input.moveX,
          moveY: input.moveY,
          aimAngle: input.aimAngle,
          attack: input.attack === true,
          interact: input.interact === true,
          drop: input.drop === true,
        },
      };
    }
    case 'ping':
      if (!isFiniteNumber(raw.sentAt)) return null;
      return { type: 'ping', sentAt: raw.sentAt };
    default:
      return null;
  }
}

export const MAX_ROOM_PLAYERS = MAX_PLAYERS;
