import { describe, expect, it } from 'vitest';
import { BotController } from '../src/shared/bots/BotController';
import { NavigationGrid } from '../src/shared/bots/pathfinding';
import { CHARACTERS } from '../src/shared/constants';
import { GameSimulation } from '../src/shared/simulation/GameSimulation';
import type { PlayerInput } from '../src/shared/types';

const DT = 1 / 60;

function playBotMatch(seed: number, preparationSeconds: number): GameSimulation {
  const sim = new GameSimulation(
    CHARACTERS.map((character) => ({ name: character.name, characterId: character.id, isBot: true })),
    { preparationSeconds, seed },
  );
  const grid = new NavigationGrid(sim.map);
  const bots = sim.players.map((player) => new BotController(player.id, grid, seed * 31 + player.id));
  const maxSteps = (preparationSeconds + 12 * 60) / DT;
  for (let step = 0; step < maxSteps && sim.phase !== 'finished'; step++) {
    const inputs = new Map<number, PlayerInput>();
    for (const bot of bots) inputs.set(bot.playerId, bot.computeInput(sim, DT));
    sim.step(DT, inputs);
  }
  return sim;
}

describe('bot match', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`four bots finish a match (seed ${seed})`, () => {
      const sim = playBotMatch(seed, 30);
      expect(sim.phase).toBe('finished');
      expect(sim.result?.winnerId).not.toBeNull();
      // Bots picked up weapons during preparation.
      const totalDamage = sim.players.reduce((sum, player) => sum + player.stats.damageDealt, 0);
      expect(totalDamage).toBeGreaterThan(300);
      console.log(
        `seed ${seed}: winner ${sim.players[sim.result!.winnerId!].name} after ${sim.result!.durationSeconds.toFixed(0)} s`,
      );
    });
  }
});
