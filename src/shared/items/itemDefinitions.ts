import type { ItemKind } from '../types';

/** Combat statistics of anything that can be swung, including bare fists. */
export interface WeaponStats {
  label: string;
  damage: number;
  /** Reach in pixels, measured from the attacker's center to the target's edge. */
  range: number;
  cooldownSeconds: number;
  arcDegrees: number;
  /** Initial knockback speed in pixels per second. */
  knockback: number;
  stunSeconds: number;
  moveSpeedMultiplier: number;
  swingSeconds: number;
}

export interface ItemDefinition extends WeaponStats {
  kind: ItemKind;
  /** Number of successful hits before the item breaks. */
  maxDurability: number;
  description: string;
  special: string;
  canBarricade: boolean;
  /** Used by bots to decide which item to go for. Higher is better. */
  botPreference: number;
}

export const FIST_STATS: WeaponStats = {
  label: 'Mains nues',
  damage: 6,
  range: 24,
  cooldownSeconds: 0.45,
  arcDegrees: 80,
  knockback: 60,
  stunSeconds: 0,
  moveSpeedMultiplier: 1,
  swingSeconds: 0.18,
};

/** Extra damage dealt by a bottle on the hit that shatters it. */
export const BOTTLE_SHATTER_BONUS = 12;

export const ITEM_DEFINITIONS: Readonly<Record<ItemKind, ItemDefinition>> = {
  chair: {
    kind: 'chair',
    label: 'Chaise',
    damage: 17,
    range: 38,
    cooldownSeconds: 0.8,
    arcDegrees: 110,
    knockback: 180,
    stunSeconds: 0.15,
    moveSpeedMultiplier: 0.85,
    swingSeconds: 0.32,
    maxDurability: 9,
    description: 'Dégâts moyens, large balayage.',
    special: 'Repousse fortement la cible.',
    canBarricade: false,
    botPreference: 4,
  },
  bottle: {
    kind: 'bottle',
    label: 'Bouteille',
    damage: 9,
    range: 28,
    cooldownSeconds: 0.32,
    arcDegrees: 70,
    knockback: 40,
    stunSeconds: 0,
    moveSpeedMultiplier: 1,
    swingSeconds: 0.15,
    maxDurability: 6,
    description: 'Dégâts faibles, attaque très rapide.',
    special: `Le coup qui la brise inflige +${BOTTLE_SHATTER_BONUS} dégâts.`,
    canBarricade: false,
    botPreference: 2,
  },
  pan: {
    kind: 'pan',
    label: 'Poêle',
    damage: 28,
    range: 34,
    cooldownSeconds: 1.15,
    arcDegrees: 100,
    knockback: 140,
    stunSeconds: 0.45,
    moveSpeedMultiplier: 0.9,
    swingSeconds: 0.38,
    maxDurability: 14,
    description: 'Dégâts élevés, attaque lente.',
    special: 'BONG ! Sonne brièvement la cible.',
    canBarricade: false,
    botPreference: 5,
  },
  broom: {
    kind: 'broom',
    label: 'Balai',
    damage: 9,
    range: 62,
    cooldownSeconds: 0.65,
    arcDegrees: 60,
    knockback: 260,
    stunSeconds: 0.1,
    moveSpeedMultiplier: 0.95,
    swingSeconds: 0.3,
    maxDurability: 10,
    description: 'Portée supérieure, garde les ennemis à distance.',
    special: 'Repousse très loin.',
    canBarricade: false,
    botPreference: 3.5,
  },
  pillow: {
    kind: 'pillow',
    label: 'Coussin',
    damage: 2,
    range: 36,
    cooldownSeconds: 0.55,
    arcDegrees: 120,
    knockback: 90,
    stunSeconds: 1.3,
    moveSpeedMultiplier: 1,
    swingSeconds: 0.3,
    maxDurability: 16,
    description: 'Presque aucun dégât, mais étourdit.',
    special: 'Étourdit 1,3 s (la cible ne peut plus frapper).',
    canBarricade: false,
    botPreference: 1.5,
  },
  table: {
    kind: 'table',
    label: 'Table',
    damage: 22,
    range: 36,
    cooldownSeconds: 1.4,
    arcDegrees: 130,
    knockback: 220,
    stunSeconds: 0.3,
    moveSpeedMultiplier: 0.6,
    swingSeconds: 0.5,
    maxDurability: 7,
    description: 'Lourde et lente. Se pose comme barricade.',
    special: 'Touche G : poser une barricade devant soi.',
    canBarricade: true,
    botPreference: 3,
  },
};

export const ITEM_KINDS: readonly ItemKind[] = ['chair', 'bottle', 'pan', 'broom', 'pillow', 'table'];
