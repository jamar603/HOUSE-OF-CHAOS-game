/** Global gameplay constants. Distances are in world pixels, durations in seconds. */

export const TILE_SIZE = 32;
export const PLAYER_RADIUS = 11;
export const MAX_PLAYERS = 4;

export const MAX_HEALTH = 100;
export const REVIVE_DURATION_SECONDS = 5;
export const REVIVE_HEALTH = 35;
export const BLEED_OUT_SECONDS = 30;
export const REVIVE_RANGE = 46;
export const PICKUP_RANGE = 44;

export const PLAYER_SPEED = 165;
export const DOWNED_CRAWL_SPEED = 26;
export const STUNNED_SPEED_MULTIPLIER = 0.35;
/** Seconds removed from a downed player's bleed-out timer per hit ("finishing"). */
export const FINISHING_HIT_BLEED_PENALTY = 4;
/** After a stun ends, the player cannot be stunned again for this long (prevents stun-locks). */
export const STUN_IMMUNITY_AFTER_SECONDS = 0.9;
export const KNOCKBACK_DECAY_PER_SECOND = 9;

export const ITEM_RESPAWN_SECONDS = 45;
export const MAX_ITEMS_IN_WORLD = 48;
export const BARRICADE_HEALTH = 90;

/** Seconds a player must stay still next to tall furniture before being hidden. */
export const HIDE_DELAY_SECONDS = 0.7;
/** Distance (world px) from a cover piece of furniture that still counts as "behind" it. */
export const HIDE_COVER_MARGIN = 16;
/** Opponents closer than this always see a hidden player. */
export const HIDE_REVEAL_DISTANCE = 72;

export const SIMULATION_TICK_RATE = 60;

export interface PreparationPreset {
  id: string;
  label: string;
  seconds: number;
}

export const PREPARATION_PRESETS: readonly PreparationPreset[] = [
  { id: 'quick', label: 'Rapide · 1 min', seconds: 60 },
  { id: 'medium', label: 'Normale · 3 min', seconds: 180 },
  { id: 'final', label: 'Complète · 15 min', seconds: 900 },
];

export type HairStyle = 'short' | 'long' | 'bald' | 'bun';
/** Top-down clothing look; purely cosmetic. */
export type Outfit = 'overalls' | 'hoodie' | 'tank' | 'stripes';

export interface CharacterDefinition {
  id: string;
  name: string;
  bodyColor: string;
  accentColor: string;
  hairColor: string;
  skinColor: string;
  hairStyle: HairStyle;
  outfit: Outfit;
  tagline: string;
}

export const CHARACTERS: readonly CharacterDefinition[] = [
  {
    id: 'max',
    name: 'Max',
    bodyColor: '#e4572e',
    accentColor: '#ffb199',
    hairColor: '#3b2416',
    skinColor: '#f1c27d',
    hairStyle: 'short',
    outfit: 'overalls',
    tagline: 'Bricoleur impulsif',
  },
  {
    id: 'lola',
    name: 'Lola',
    bodyColor: '#3a86ff',
    accentColor: '#a9c9ff',
    hairColor: '#e8c547',
    skinColor: '#ffdbac',
    hairStyle: 'long',
    outfit: 'hoodie',
    tagline: 'Stratège sournoise',
  },
  {
    id: 'bruno',
    name: 'Bruno',
    bodyColor: '#2bb673',
    accentColor: '#a5ecc8',
    hairColor: '#1a1a1a',
    skinColor: '#8d5524',
    hairStyle: 'bald',
    outfit: 'tank',
    tagline: 'Gros bras, petit cerveau',
  },
  {
    id: 'zoe',
    name: 'Zoé',
    bodyColor: '#b65cf2',
    accentColor: '#e2bdfb',
    hairColor: '#ff6f91',
    skinColor: '#e0ac69',
    hairStyle: 'bun',
    outfit: 'stripes',
    tagline: 'Reine du chaos',
  },
];

export function getCharacter(characterId: string): CharacterDefinition {
  return CHARACTERS.find((character) => character.id === characterId) ?? CHARACTERS[0];
}
