/**
 * Compact world snapshots sent by the server ~20 times per second.
 * Players and items are encoded as flat number arrays (about 3 KB per snapshot)
 * and applied onto a client-side "mirror" GameSimulation that is never stepped.
 */
import { ITEM_KINDS } from '../items/itemDefinitions';
import type { GameSimulation } from '../simulation/GameSimulation';
import type { GamePhase, ItemKind, ItemState, LifeState, MatchResult, WeaponKind } from '../types';

export interface EncodedSnapshot {
  /** Elapsed match seconds. */
  t: number;
  phase: GamePhase;
  prep: number;
  chaos: number;
  players: number[][];
  items: number[][];
  result: MatchResult | null;
}

const LIFE_STATES: LifeState[] = ['alive', 'downed', 'eliminated'];
const WEAPONS: WeaponKind[] = ['fists', ...ITEM_KINDS];

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round2 = (value: number): number => Math.round(value * 100) / 100;
const nullable = (value: number | null): number => (value === null ? -1 : value);
const fromNullable = (value: number): number | null => (value < 0 ? null : value);

export function encodeSnapshot(sim: GameSimulation): EncodedSnapshot {
  return {
    t: round2(sim.elapsedSeconds),
    phase: sim.phase,
    prep: round2(sim.phaseTimeRemaining),
    chaos: round2(sim.chaosElapsedSeconds),
    players: sim.players.map((p) => [
      round1(p.x),
      round1(p.y),
      round2(p.facing),
      p.isMoving ? 1 : 0,
      round2(p.walkCycle),
      round1(p.health),
      LIFE_STATES.indexOf(p.life),
      round2(p.bleedOutRemaining),
      round2(p.reviveProgress),
      nullable(p.reviverId),
      nullable(p.revivingTargetId),
      nullable(p.heldItemId),
      round2(p.attackCooldown),
      round2(p.swingRemaining),
      round2(p.swingDuration),
      WEAPONS.indexOf(p.swingWeapon),
      round2(p.stunRemaining),
      p.stats.kills,
      Math.round(p.stats.damageDealt),
      Math.round(p.stats.damageTaken),
      p.stats.revivesGiven,
      p.stats.itemsBroken,
      p.stats.timesDowned,
      nullable(p.lastAttackerId),
    ]),
    items: sim.items.map((item) => [
      item.id,
      ITEM_KINDS.indexOf(item.kind),
      round1(item.x),
      round1(item.y),
      round2(item.rotation),
      item.durability,
      nullable(item.holderId),
      item.placed ? 1 : 0,
      nullable(item.placedOwnerId),
      Math.round(item.barricadeHealth),
      item.width,
      item.height,
    ]),
    result: sim.result,
  };
}

/** Overwrites the mirror simulation state with a snapshot from the server. */
export function applySnapshot(sim: GameSimulation, snapshot: EncodedSnapshot): void {
  sim.elapsedSeconds = snapshot.t;
  sim.phase = snapshot.phase;
  sim.phaseTimeRemaining = snapshot.prep;
  sim.chaosElapsedSeconds = snapshot.chaos;
  sim.result = snapshot.result;
  snapshot.players.forEach((row, index) => {
    const player = sim.players[index];
    if (!player) return;
    player.x = row[0];
    player.y = row[1];
    player.facing = row[2];
    player.isMoving = row[3] === 1;
    player.walkCycle = row[4];
    player.health = row[5];
    player.life = LIFE_STATES[row[6]] ?? 'alive';
    player.bleedOutRemaining = row[7];
    player.reviveProgress = row[8];
    player.reviverId = fromNullable(row[9]);
    player.revivingTargetId = fromNullable(row[10]);
    player.heldItemId = fromNullable(row[11]);
    player.attackCooldown = row[12];
    player.swingRemaining = row[13];
    player.swingDuration = row[14];
    player.swingWeapon = WEAPONS[row[15]] ?? 'fists';
    player.stunRemaining = row[16];
    player.stats.kills = row[17];
    player.stats.damageDealt = row[18];
    player.stats.damageTaken = row[19];
    player.stats.revivesGiven = row[20];
    player.stats.itemsBroken = row[21];
    player.stats.timesDowned = row[22];
    player.lastAttackerId = fromNullable(row[23]);
  });
  sim.items = snapshot.items.map(
    (row): ItemState => ({
      id: row[0],
      kind: (ITEM_KINDS[row[1]] ?? 'bottle') as ItemKind,
      x: row[2],
      y: row[3],
      rotation: row[4],
      durability: row[5],
      holderId: fromNullable(row[6]),
      placed: row[7] === 1,
      placedOwnerId: fromNullable(row[8]),
      barricadeHealth: row[9],
      width: row[10],
      height: row[11],
      spawnPointIndex: null,
    }),
  );
}
