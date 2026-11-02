import { describe, expect, it } from 'vitest';
import { HIDE_DELAY_SECONDS, HIDE_REVEAL_DISTANCE, PLAYER_RADIUS } from '../src/shared/constants';
import { COVER_FURNITURE } from '../src/shared/house/houseMap';
import { applySnapshot, encodeSnapshot } from '../src/shared/network/snapshot';
import { GameSimulation, type PlayerSetup } from '../src/shared/simulation/GameSimulation';
import { createEmptyInput, type PlayerInput } from '../src/shared/types';

const DT = 1 / 60;

function setups(count: number): PlayerSetup[] {
  return Array.from({ length: count }, (_, index) => ({ name: `P${index}`, characterId: 'max', isBot: false }));
}

function run(sim: GameSimulation, seconds: number, inputs: Map<number, PlayerInput> = new Map()): void {
  for (let t = 0; t < seconds; t += DT) sim.step(DT, inputs);
}

/** Player 0 stands right next to a wardrobe, player 1 far away. */
function hidingSetup(): GameSimulation {
  const sim = new GameSimulation(setups(2), { preparationSeconds: 0, seed: 3 });
  sim.items = [];
  const cover = sim.map.furniture.find((f) => f.kind === 'wardrobe');
  if (!cover) throw new Error('no wardrobe in the house');
  const [a, b] = sim.players;
  a.x = cover.x + cover.w / 2;
  a.y = cover.y + cover.h + PLAYER_RADIUS + 2;
  b.x = a.x + 300;
  b.y = a.y;
  return sim;
}

describe('hiding behind furniture', () => {
  it('every cover kind exists in the house', () => {
    const sim = new GameSimulation(setups(1), { preparationSeconds: 0, seed: 1 });
    const kinds = new Set(sim.map.furniture.map((f) => f.kind));
    expect([...COVER_FURNITURE].filter((kind) => kinds.has(kind)).length).toBeGreaterThan(5);
  });

  it('hides a player who stays still next to tall furniture', () => {
    const sim = hidingSetup();
    const [a, b] = sim.players;
    expect(sim.isInCover(a)).toBe(true);
    run(sim, HIDE_DELAY_SECONDS * 0.5);
    expect(a.hidden).toBe(false);
    run(sim, HIDE_DELAY_SECONDS);
    expect(a.hidden).toBe(true);
    expect(sim.canSee(b, a)).toBe(false);
    expect(sim.canSee(a, a)).toBe(true);
  });

  it('does not hide a player in the open', () => {
    const sim = hidingSetup();
    const b = sim.players[1];
    expect(sim.isInCover(b)).toBe(false);
    run(sim, 2);
    expect(b.hidden).toBe(false);
  });

  it('reveals a hidden player who moves', () => {
    const sim = hidingSetup();
    run(sim, HIDE_DELAY_SECONDS + 0.2);
    expect(sim.players[0].hidden).toBe(true);
    const move = createEmptyInput();
    move.moveX = 1;
    run(sim, 0.1, new Map([[0, move]]));
    expect(sim.players[0].hidden).toBe(false);
  });

  it('reveals a hidden player who attacks', () => {
    const sim = hidingSetup();
    run(sim, HIDE_DELAY_SECONDS + 0.2);
    const attack = createEmptyInput();
    attack.attack = true;
    run(sim, DT * 2, new Map([[0, attack]]));
    expect(sim.players[0].hidden).toBe(false);
  });

  it('close opponents always see a hidden player', () => {
    const sim = hidingSetup();
    run(sim, HIDE_DELAY_SECONDS + 0.2);
    const [a, b] = sim.players;
    b.x = a.x + HIDE_REVEAL_DISTANCE - 5;
    b.y = a.y;
    expect(a.hidden).toBe(true);
    expect(sim.canSee(b, a)).toBe(true);
  });

  it('sends the hidden state in network snapshots', () => {
    const sim = hidingSetup();
    run(sim, HIDE_DELAY_SECONDS + 0.2);
    const mirror = new GameSimulation(setups(2), { preparationSeconds: 0, seed: 3 });
    applySnapshot(mirror, JSON.parse(JSON.stringify(encodeSnapshot(sim))));
    expect(mirror.players[0].hidden).toBe(true);
    expect(mirror.players[0].hideTime).toBeGreaterThan(0);
  });
});
