/** Shared game state types. The simulation owns these objects; renderers only read them. */

export type ItemKind = 'chair' | 'bottle' | 'pan' | 'broom' | 'pillow' | 'table';
export type WeaponKind = ItemKind | 'fists';
export type LifeState = 'alive' | 'downed' | 'eliminated';
export type GamePhase = 'preparation' | 'chaos' | 'finished';

/**
 * Everything a player (human or bot) is allowed to send to the simulation.
 * Clients never send positions, damage or hits: the simulation derives them.
 */
export interface PlayerInput {
  moveX: number;
  moveY: number;
  aimAngle: number;
  attack: boolean;
  /** Held state of the interaction key: a press picks up, holding revives. */
  interact: boolean;
  /** Held state of the drop key; the simulation reacts to the press edge. */
  drop: boolean;
}

export function createEmptyInput(aimAngle = 0): PlayerInput {
  return { moveX: 0, moveY: 0, aimAngle, attack: false, interact: false, drop: false };
}

export interface PlayerStats {
  kills: number;
  damageDealt: number;
  damageTaken: number;
  revivesGiven: number;
  itemsBroken: number;
  timesDowned: number;
}

export interface PlayerState {
  readonly id: number;
  readonly slot: number;
  readonly name: string;
  readonly characterId: string;
  readonly isBot: boolean;
  x: number;
  y: number;
  facing: number;
  isMoving: boolean;
  walkCycle: number;
  health: number;
  life: LifeState;
  bleedOutRemaining: number;
  /** Revive progress in seconds, stored on the downed player. */
  reviveProgress: number;
  reviverId: number | null;
  revivingTargetId: number | null;
  heldItemId: number | null;
  attackCooldown: number;
  swingRemaining: number;
  swingDuration: number;
  swingWeapon: WeaponKind;
  stunRemaining: number;
  stunImmunityRemaining: number;
  knockbackX: number;
  knockbackY: number;
  lastAttackerId: number | null;
  /** Seconds spent standing still behind cover furniture. */
  hideTime: number;
  /** Hidden behind furniture: invisible to opponents further than HIDE_REVEAL_DISTANCE. */
  hidden: boolean;
  eliminatedAtSeconds: number | null;
  previousInteract: boolean;
  previousDrop: boolean;
  stats: PlayerStats;
}

export interface ItemState {
  readonly id: number;
  readonly kind: ItemKind;
  x: number;
  y: number;
  rotation: number;
  durability: number;
  holderId: number | null;
  /** A placed item is a solid barricade (only tables can be placed). */
  placed: boolean;
  placedOwnerId: number | null;
  barricadeHealth: number;
  width: number;
  height: number;
  spawnPointIndex: number | null;
}

export type GameEvent =
  | { type: 'swing'; playerId: number; weapon: WeaponKind }
  | {
      type: 'hit';
      attackerId: number;
      targetId: number;
      amount: number;
      x: number;
      y: number;
      weapon: WeaponKind;
      finishing: boolean;
      stunned: boolean;
    }
  | { type: 'barricadeHit'; itemId: number; x: number; y: number; amount: number }
  | { type: 'barricadeDestroyed'; itemId: number; x: number; y: number }
  | { type: 'itemBroken'; playerId: number; itemKind: ItemKind; x: number; y: number }
  | { type: 'pickup'; playerId: number; itemKind: ItemKind }
  | { type: 'drop'; playerId: number; itemKind: ItemKind; placed: boolean }
  | { type: 'downed'; playerId: number; attackerId: number | null }
  | { type: 'reviveStarted'; reviverId: number; targetId: number }
  | { type: 'revived'; reviverId: number; targetId: number }
  | { type: 'eliminated'; playerId: number; killerId: number | null }
  | { type: 'phaseChanged'; phase: GamePhase }
  | { type: 'combatBlocked'; playerId: number }
  | { type: 'itemSpawned'; itemKind: ItemKind; x: number; y: number }
  | { type: 'matchEnded'; winnerId: number | null };

export interface MatchResult {
  winnerId: number | null;
  durationSeconds: number;
  /** Player ids from first place to last place. */
  ranking: number[];
}
