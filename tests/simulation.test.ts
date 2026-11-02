import { describe, expect, it } from 'vitest';
import {
  BLEED_OUT_SECONDS,
  MAX_HEALTH,
  REVIVE_DURATION_SECONDS,
  REVIVE_HEALTH,
  TILE_SIZE,
} from '../src/shared/constants';
import { ITEM_DEFINITIONS } from '../src/shared/items/itemDefinitions';
import { GameSimulation, type PlayerSetup } from '../src/shared/simulation/GameSimulation';
import { createEmptyInput, type PlayerInput } from '../src/shared/types';

const DT = 1 / 60;

function setups(count: number): PlayerSetup[] {
  return Array.from({ length: count }, (_, index) => ({ name: `P${index}`, characterId: 'max', isBot: false }));
}

function run(sim: GameSimulation, seconds: number, inputs: Map<number, PlayerInput> = new Map()): void {
  for (let t = 0; t < seconds; t += DT) sim.step(DT, inputs);
}

/** Places two players face to face in the living room, in chaos phase. */
function duel(): GameSimulation {
  const sim = new GameSimulation(setups(2), { preparationSeconds: 0, seed: 1 });
  sim.items = [];
  const [a, b] = sim.players;
  a.x = 31 * TILE_SIZE;
  a.y = 23 * TILE_SIZE;
  b.x = a.x + 30;
  b.y = a.y;
  return sim;
}

function giveItem(sim: GameSimulation, playerId: number, kind: keyof typeof ITEM_DEFINITIONS): void {
  const player = sim.players[playerId];
  const item = {
    id: 999 + playerId,
    kind,
    x: player.x,
    y: player.y,
    rotation: 0,
    durability: ITEM_DEFINITIONS[kind].maxDurability,
    holderId: player.id,
    placed: false,
    placedOwnerId: null,
    barricadeHealth: 0,
    width: 0,
    height: 0,
    spawnPointIndex: null,
  };
  sim.items.push(item);
  player.heldItemId = item.id;
}

describe('movement and collisions', () => {
  it('stops players at walls', () => {
    const sim = new GameSimulation(setups(1), { preparationSeconds: 60, seed: 1 });
    const input = createEmptyInput();
    input.moveX = -1;
    run(sim, 5, new Map([[0, input]]));
    const player = sim.players[0];
    expect(player.x).toBeGreaterThan(TILE_SIZE); // room interior starts at tile 1
  });

  it('forbids entering another bedroom during preparation only', () => {
    const sim = new GameSimulation(setups(2), { preparationSeconds: 60, seed: 1 });
    const intruder = sim.players[1];
    const insideBedroom1 = { x: 7.5 * TILE_SIZE, y: 10 * TILE_SIZE };
    expect(sim.collidesAt(intruder, insideBedroom1.x, insideBedroom1.y)).toBe(true);
    expect(sim.collidesAt(sim.players[0], insideBedroom1.x, insideBedroom1.y)).toBe(false);
    run(sim, 61);
    expect(sim.phase).toBe('chaos');
    expect(sim.collidesAt(intruder, insideBedroom1.x, insideBedroom1.y)).toBe(false);
  });

  it('ignores invalid input values', () => {
    const sim = new GameSimulation(setups(1), { preparationSeconds: 60, seed: 1 });
    const before = { ...sim.players[0] };
    const input = { moveX: Number.NaN, moveY: 50, aimAngle: Number.POSITIVE_INFINITY, attack: true, interact: false, drop: false };
    sim.step(DT, new Map([[0, input]]));
    expect(Number.isFinite(sim.players[0].facing)).toBe(true);
    expect(sim.players[0].y - before.y).toBeLessThanOrEqual(3);
  });
});

describe('items', () => {
  it('picks up, drops and places a table as a barricade', () => {
    const sim = duel();
    const player = sim.players[0];
    sim.players[1].x = player.x - 200;
    giveItem(sim, 0, 'table');
    player.facing = 0;
    const press = { ...createEmptyInput(0), drop: true };
    sim.step(DT, new Map([[0, press]]));
    const table = sim.items.find((item) => item.kind === 'table');
    expect(table?.placed).toBe(true);
    expect(player.heldItemId).toBeNull();
    // The barricade blocks movement.
    expect(sim.collidesAt(player, table!.x, table!.y)).toBe(true);
    // Owner can pick it back up.
    sim.step(DT, new Map([[0, createEmptyInput(0)]]));
    sim.step(DT, new Map([[0, { ...createEmptyInput(0), interact: true }]]));
    expect(player.heldItemId).toBe(table!.id);
    expect(table!.placed).toBe(false);
  });

  it('loses durability on hits and breaks', () => {
    const sim = duel();
    giveItem(sim, 0, 'bottle');
    const attack = new Map([[0, { ...createEmptyInput(0), attack: true }]]);
    for (let t = 0; t < 4; t += DT) {
      // Keep the target in reach despite knockback.
      sim.players[1].x = sim.players[0].x + 30;
      sim.players[1].y = sim.players[0].y;
      sim.step(DT, attack);
    }
    expect(sim.items.some((item) => item.kind === 'bottle')).toBe(false);
    expect(sim.players[0].stats.itemsBroken).toBe(1);
  });
});

describe('combat and health', () => {
  it('prevents damage during preparation', () => {
    const sim = new GameSimulation(setups(2), { preparationSeconds: 60, seed: 1 });
    const [a, b] = sim.players;
    a.x = 31 * TILE_SIZE;
    a.y = 23 * TILE_SIZE;
    b.x = a.x + 30;
    b.y = a.y;
    run(sim, 2, new Map([[0, { ...createEmptyInput(0), attack: true }]]));
    expect(b.health).toBe(MAX_HEALTH);
  });

  it('deals the weapon damage in chaos', () => {
    const sim = duel();
    giveItem(sim, 0, 'pan');
    sim.step(DT, new Map([[0, { ...createEmptyInput(0), attack: true }]]));
    expect(sim.players[1].health).toBe(MAX_HEALTH - ITEM_DEFINITIONS.pan.damage);
  });

  it('does not hit targets behind the attacker', () => {
    const sim = duel();
    sim.step(DT, new Map([[0, { ...createEmptyInput(Math.PI), attack: true }]]));
    expect(sim.players[1].health).toBe(MAX_HEALTH);
  });

  it('stuns with the pillow, with immunity afterwards', () => {
    const sim = duel();
    giveItem(sim, 0, 'pillow');
    sim.step(DT, new Map([[0, { ...createEmptyInput(0), attack: true }]]));
    expect(sim.players[1].stunRemaining).toBeGreaterThan(1);
  });

  it('knocks out at 0 HP, revives after 5 s with 35 HP', () => {
    const sim = duel();
    const [reviver, victim] = sim.players;
    victim.health = 5;
    sim.step(DT, new Map([[0, { ...createEmptyInput(0), attack: true }]]));
    expect(victim.life).toBe('downed');
    expect(victim.bleedOutRemaining).toBeCloseTo(BLEED_OUT_SECONDS, 0);

    const hold = new Map([[reviver.id, { ...createEmptyInput(0), interact: true }]]);
    run(sim, REVIVE_DURATION_SECONDS - 0.5, hold);
    expect(victim.life).toBe('downed');
    run(sim, 0.7, hold);
    expect(victim.life).toBe('alive');
    expect(victim.health).toBe(REVIVE_HEALTH);
    expect(reviver.stats.revivesGiven).toBe(1);
  });

  it('cancels the revive when the key is released', () => {
    const sim = duel();
    const [reviver, victim] = sim.players;
    victim.health = 1;
    sim.step(DT, new Map([[0, { ...createEmptyInput(0), attack: true }]]));
    run(sim, 2, new Map([[reviver.id, { ...createEmptyInput(0), interact: true }]]));
    run(sim, 0.1);
    expect(victim.reviverId).toBeNull();
    expect(victim.reviveProgress).toBe(0);
  });

  it('eliminates after 30 s and ends the match', () => {
    const sim = duel();
    const victim = sim.players[1];
    victim.health = 1;
    sim.step(DT, new Map([[0, { ...createEmptyInput(0), attack: true }]]));
    run(sim, BLEED_OUT_SECONDS + 0.5);
    expect(victim.life).toBe('eliminated');
    expect(sim.phase).toBe('finished');
    expect(sim.result?.winnerId).toBe(0);
    expect(sim.players[0].stats.kills).toBe(1);
  });
});
