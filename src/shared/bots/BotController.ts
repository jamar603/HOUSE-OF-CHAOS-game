/**
 * Bot brain. A bot reads the simulation state and produces the same
 * {@link PlayerInput} a human would send, so bots never get special powers.
 *
 * Behaviour summary:
 * - Preparation: collect the best reachable weapon, barricade its own door
 *   if it holds a table, then patrol.
 * - Chaos: grab a weapon if unarmed, chase and hit the nearest standing enemy,
 *   sometimes revive a downed player (personality), finish downed enemies when
 *   nobody else is standing, and smash barricades that block its way.
 */
import { PICKUP_RANGE, PLAYER_RADIUS, REVIVE_RANGE, TILE_SIZE } from '../constants';
import { bedroomForSlot, roomIndexAt, tileIndex, worldToTile } from '../house/houseMap';
import { ITEM_DEFINITIONS } from '../items/itemDefinitions';
import { createSeededRandom, distance, type Vec2 } from '../math';
import { hasLineOfSight } from '../simulation/collision';
import type { GameSimulation } from '../simulation/GameSimulation';
import { createEmptyInput, type ItemState, type PlayerInput, type PlayerState } from '../types';
import { findPath, tileCenter, type NavigationGrid } from './pathfinding';

interface BotPersonality {
  /** 0..1, probability to revive a downed player instead of ignoring them. */
  kindness: number;
  /** Max aim error in radians. */
  aimError: number;
  /** Delay before swinging once a target is in range. */
  reactionSeconds: number;
  /** Below this health the bot breaks off and retreats. */
  retreatHealth: number;
}

type BotGoal =
  | { kind: 'idle' }
  | { kind: 'item'; itemId: number }
  | { kind: 'enemy'; playerId: number }
  | { kind: 'revive'; playerId: number }
  | { kind: 'barricade'; x: number; y: number; faceAngle: number }
  | { kind: 'wander'; x: number; y: number };

export class BotController {
  readonly playerId: number;
  private readonly grid: NavigationGrid;
  private readonly random: () => number;
  private readonly personality: BotPersonality;
  private goal: BotGoal = { kind: 'idle' };
  private path: Vec2[] = [];
  private pathTargetTile = -1;
  private thinkCooldown = 0;
  private repathCooldown = 0;
  private interactPulse = false;
  private dropPulse = false;
  private stuckSeconds = 0;
  private unstickSeconds = 0;
  private unstickAngle = 0;
  private lastX = 0;
  private lastY = 0;
  private wantedToMove = false;
  private aimLocked = false;
  private inRangeSeconds = 0;
  private aimJitter = 0;
  private wanderUntil = 0;
  /** A bot retreats at most once per life, for a few seconds, then fights to the end. */
  private retreatUsed = false;
  private retreatUntil = 0;
  private barricadePlaced = false;
  private barricadeTargetId: number | null = null;
  private readonly reviveDecisions = new Map<number, boolean>();
  private readonly unreachableItemsUntil = new Map<number, number>();

  constructor(playerId: number, grid: NavigationGrid, seed: number) {
    this.playerId = playerId;
    this.grid = grid;
    this.random = createSeededRandom(seed);
    this.personality = {
      kindness: 0.15 + this.random() * 0.5,
      aimError: 0.12 + this.random() * 0.22,
      reactionSeconds: 0.12 + this.random() * 0.25,
      retreatHealth: this.random() < 0.5 ? 0 : 20 + this.random() * 15,
    };
  }

  computeInput(sim: GameSimulation, dt: number): PlayerInput {
    const self = sim.players[this.playerId];
    const input = createEmptyInput(self.facing);
    if (self.life !== 'alive' || sim.phase === 'finished') return input;

    this.thinkCooldown -= dt;
    this.repathCooldown -= dt;
    this.updateStuckDetection(sim, self, dt);
    if (this.thinkCooldown <= 0) {
      this.think(sim, self);
      this.thinkCooldown = 0.18 + this.random() * 0.12;
    }

    this.wantedToMove = false;
    this.aimLocked = false;
    if (this.barricadeTargetId !== null && this.attackBarricade(sim, self, input)) return input;
    this.executeGoal(sim, self, input, dt);

    if (this.unstickSeconds > 0) {
      this.unstickSeconds -= dt;
      input.moveX = Math.cos(this.unstickAngle);
      input.moveY = Math.sin(this.unstickAngle);
      this.wantedToMove = true;
    }
    return input;
  }

  // ---------------------------------------------------------------- decisions

  private think(sim: GameSimulation, self: PlayerState): void {
    for (const player of sim.players) if (player.life === 'alive') this.reviveDecisions.delete(player.id);
    if (sim.phase === 'preparation') this.thinkPreparation(sim, self);
    else this.thinkChaos(sim, self);
  }

  private thinkPreparation(sim: GameSimulation, self: PlayerState): void {
    const held = sim.heldItemOf(self);
    if (held?.kind === 'table' && !this.barricadePlaced) {
      const spot = this.barricadeSpot(sim, self);
      if (spot) {
        this.goal = { kind: 'barricade', ...spot };
        return;
      }
      this.barricadePlaced = true;
    }
    const currentPreference = held ? ITEM_DEFINITIONS[held.kind].botPreference : 0;
    const item = this.findBestItem(sim, self, held ? 520 : 2400, currentPreference);
    if (item) {
      this.goal = { kind: 'item', itemId: item.id };
      return;
    }
    this.chooseWander(sim, self, sim.phaseTimeRemaining < 12);
  }

  private thinkChaos(sim: GameSimulation, self: PlayerState): void {
    // Bots only chase what they can see: hidden players stay safe until someone comes close.
    const enemies = sim.players.filter((player) => player.id !== self.id && player.life === 'alive' && sim.canSee(self, player));
    let nearestEnemy: PlayerState | null = null;
    let nearestDistance = Infinity;
    for (const enemy of enemies) {
      const gap = distance(self.x, self.y, enemy.x, enemy.y);
      if (gap < nearestDistance) {
        nearestEnemy = enemy;
        nearestDistance = gap;
      }
    }

    // Revive someone (allies do not exist yet: any downed player may be revived).
    const downed = sim.players.filter(
      (player) =>
        player.id !== self.id &&
        player.life === 'downed' &&
        (player.reviverId === null || player.reviverId === self.id),
    );
    const reviveCandidate = downed
      .filter((player) => this.reviveDecision(player.id) && distance(self.x, self.y, player.x, player.y) < 320)
      .sort((a, b) => distance(self.x, self.y, a.x, a.y) - distance(self.x, self.y, b.x, b.y))[0];
    if (reviveCandidate && nearestDistance > 280) {
      this.goal = { kind: 'revive', playerId: reviveCandidate.id };
      return;
    }

    // Retreat once when badly hurt (only cautious personalities), then fight back.
    if (self.health >= this.personality.retreatHealth) this.retreatUsed = false;
    if (!this.retreatUsed && nearestEnemy && self.health < this.personality.retreatHealth && nearestDistance < 220) {
      this.retreatUsed = true;
      this.retreatUntil = sim.elapsedSeconds + 4 + this.random() * 3;
      const home = sim.map.playerSpawns[self.slot];
      this.goal = { kind: 'wander', x: home.x, y: home.y };
      this.wanderUntil = this.retreatUntil;
      return;
    }
    if (sim.elapsedSeconds < this.retreatUntil && this.goal.kind === 'wander') return;

    const held = sim.heldItemOf(self);
    if (!held) {
      const item = this.findBestItem(sim, self, nearestDistance < 200 ? 140 : 420, 0);
      if (item) {
        this.goal = { kind: 'item', itemId: item.id };
        return;
      }
    } else if (nearestDistance > 320) {
      const upgrade = this.findBestItem(sim, self, 240, ITEM_DEFINITIONS[held.kind].botPreference);
      if (upgrade) {
        this.goal = { kind: 'item', itemId: upgrade.id };
        return;
      }
    }

    if (nearestEnemy) {
      // Keep the current target unless someone is clearly closer.
      if (this.goal.kind === 'enemy') {
        const current = sim.players[this.goal.playerId];
        if (
          current.life === 'alive' &&
          sim.canSee(self, current) &&
          distance(self.x, self.y, current.x, current.y) < nearestDistance + 150
        ) {
          return;
        }
      }
      this.goal = { kind: 'enemy', playerId: nearestEnemy.id };
      return;
    }

    // Nobody standing: finish the downed players we decided not to revive.
    const victim = downed
      .filter((player) => !this.reviveDecision(player.id))
      .sort((a, b) => distance(self.x, self.y, a.x, a.y) - distance(self.x, self.y, b.x, b.y))[0];
    if (victim) {
      this.goal = { kind: 'enemy', playerId: victim.id };
      return;
    }
    this.chooseWander(sim, self, false);
  }

  private reviveDecision(playerId: number): boolean {
    let decision = this.reviveDecisions.get(playerId);
    if (decision === undefined) {
      decision = this.random() < this.personality.kindness;
      this.reviveDecisions.set(playerId, decision);
    }
    return decision;
  }

  private chooseWander(sim: GameSimulation, self: PlayerState, stayHome: boolean): void {
    if (this.goal.kind === 'wander' && sim.elapsedSeconds < this.wanderUntil) return;
    this.wanderUntil = sim.elapsedSeconds + 4 + this.random() * 5;
    const blockedRooms = sim.blockedRoomsFor(self);
    const home = bedroomForSlot(sim.map, self.slot);
    for (let attempt = 0; attempt < 40; attempt++) {
      let tx: number;
      let ty: number;
      if ((stayHome || this.random() < 0.35) && home) {
        tx = home.x + Math.floor(this.random() * home.w);
        ty = home.y + Math.floor(this.random() * home.h);
      } else {
        tx = Math.floor(this.random() * this.grid.width);
        ty = Math.floor(this.random() * this.grid.height);
      }
      if (!this.grid.isWalkable(tx, ty)) continue;
      const room = sim.map.roomIndexByTile[tileIndex(sim.map, tx, ty)];
      if (room >= 0 && blockedRooms.has(room)) continue;
      const center = tileCenter(tx, ty);
      this.goal = { kind: 'wander', x: center.x, y: center.y };
      return;
    }
    this.goal = { kind: 'idle' };
  }

  private findBestItem(sim: GameSimulation, self: PlayerState, maxDistance: number, minPreference: number): ItemState | null {
    const blockedRooms = sim.blockedRoomsFor(self);
    let best: ItemState | null = null;
    let bestScore = -Infinity;
    for (const item of sim.items) {
      if (item.holderId !== null || item.placed) continue;
      const preference = ITEM_DEFINITIONS[item.kind].botPreference;
      if (preference <= minPreference) continue;
      if ((this.unreachableItemsUntil.get(item.id) ?? 0) > sim.elapsedSeconds) continue;
      const room = roomIndexAt(sim.map, item.x, item.y);
      if (room >= 0 && blockedRooms.has(room)) continue;
      // Do not race a player who is standing on the item.
      const contested = sim.players.some(
        (other) => other.id !== self.id && other.life === 'alive' && distance(other.x, other.y, item.x, item.y) < 30,
      );
      if (contested) continue;
      const gap = distance(self.x, self.y, item.x, item.y);
      if (gap > maxDistance) continue;
      const score = preference * 90 - gap * 0.35;
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
    return best;
  }

  /** Spot just inside the bot's bedroom door, facing the door. */
  private barricadeSpot(sim: GameSimulation, self: PlayerState): { x: number; y: number; faceAngle: number } | null {
    const home = bedroomForSlot(sim.map, self.slot);
    if (!home) return null;
    const homeIndex = sim.map.rooms.indexOf(home);
    const doorTiles = sim.map.doors.filter((door) => {
      if (door.kind !== 'door') return false;
      const above = sim.map.roomIndexByTile[tileIndex(sim.map, door.tx, door.ty - 1)];
      const below = sim.map.roomIndexByTile[tileIndex(sim.map, door.tx, door.ty + 1)];
      return above === homeIndex || below === homeIndex;
    });
    if (doorTiles.length === 0) return null;
    const centerX = doorTiles.reduce((sum, door) => sum + door.tx * TILE_SIZE + TILE_SIZE / 2, 0) / doorTiles.length;
    const doorY = doorTiles[0].ty * TILE_SIZE + TILE_SIZE / 2;
    const roomIsAbove = sim.map.roomIndexByTile[tileIndex(sim.map, doorTiles[0].tx, doorTiles[0].ty - 1)] === homeIndex;
    const insideOffset = 1.6 * TILE_SIZE;
    return {
      x: centerX,
      y: roomIsAbove ? doorY - insideOffset : doorY + insideOffset,
      faceAngle: roomIsAbove ? Math.PI / 2 : -Math.PI / 2,
    };
  }

  // ---------------------------------------------------------------- execution

  private executeGoal(sim: GameSimulation, self: PlayerState, input: PlayerInput, dt: number): void {
    const goal = this.goal;
    switch (goal.kind) {
      case 'item': {
        const item = sim.getItem(goal.itemId);
        if (!item || item.holderId !== null || item.placed) {
          this.thinkCooldown = 0;
          return;
        }
        if (distance(self.x, self.y, item.x, item.y) < PICKUP_RANGE - 12) {
          this.lookAt(self, item.x, item.y, input);
          this.pulseInteract(input);
          return;
        }
        if (!this.moveTowards(sim, self, item.x, item.y, input)) {
          this.unreachableItemsUntil.set(item.id, sim.elapsedSeconds + 8);
          this.thinkCooldown = 0;
        }
        return;
      }
      case 'enemy': {
        const target = sim.players[goal.playerId];
        if (!target || target.life === 'eliminated' || (target.life === 'downed' && sim.players.some((p) => p.id !== self.id && p.id !== target.id && p.life === 'alive'))) {
          this.thinkCooldown = 0;
        }
        if (!target || target.life === 'eliminated') return;
        if (!sim.canSee(self, target)) {
          // The target vanished behind furniture: think again.
          this.thinkCooldown = 0;
          return;
        }
        const stats = sim.weaponStatsOf(self);
        const reach = stats.range + PLAYER_RADIUS - 4;
        const gap = distance(self.x, self.y, target.x, target.y);
        const visible = gap < 420 && hasLineOfSight(sim.map, self.x, self.y, target.x, target.y);
        if (visible && gap < 170) {
          const angle = Math.atan2(target.y - self.y, target.x - self.x);
          input.aimAngle = angle + this.aimJitter;
          this.aimLocked = true;
        }
        if (visible && gap <= reach) {
          this.inRangeSeconds += dt;
          // Long weapons keep their distance.
          if (stats.range > 50 && gap < reach * 0.55) {
            input.moveX = (self.x - target.x) / gap;
            input.moveY = (self.y - target.y) / gap;
          }
          if (this.inRangeSeconds >= this.personality.reactionSeconds && self.attackCooldown <= 0) {
            input.attack = true;
            this.aimJitter = (this.random() * 2 - 1) * this.personality.aimError;
          }
          return;
        }
        this.inRangeSeconds = 0;
        this.moveTowards(sim, self, target.x, target.y, input);
        return;
      }
      case 'revive': {
        const target = sim.players[goal.playerId];
        if (!target || target.life !== 'downed' || (target.reviverId !== null && target.reviverId !== self.id)) {
          this.thinkCooldown = 0;
          return;
        }
        if (distance(self.x, self.y, target.x, target.y) < REVIVE_RANGE - 12) {
          this.lookAt(self, target.x, target.y, input);
          if (self.revivingTargetId === target.id) input.interact = true;
          else this.pulseInteract(input);
          return;
        }
        this.moveTowards(sim, self, target.x, target.y, input);
        return;
      }
      case 'barricade': {
        const held = sim.heldItemOf(self);
        if (held?.kind !== 'table') {
          this.barricadePlaced = true;
          this.thinkCooldown = 0;
          return;
        }
        if (distance(self.x, self.y, goal.x, goal.y) < 8) {
          input.aimAngle = goal.faceAngle;
          this.aimLocked = true;
          this.dropPulse = !this.dropPulse;
          input.drop = this.dropPulse;
          return;
        }
        if (!this.moveTowards(sim, self, goal.x, goal.y, input)) {
          this.barricadePlaced = true;
          this.thinkCooldown = 0;
        }
        return;
      }
      case 'wander': {
        if (distance(self.x, self.y, goal.x, goal.y) < 20) {
          this.goal = { kind: 'idle' };
          return;
        }
        this.moveTowards(sim, self, goal.x, goal.y, input);
        return;
      }
      case 'idle':
        return;
    }
  }

  /** Steers along an A* path. Returns false when the destination is unreachable. */
  private moveTowards(sim: GameSimulation, self: PlayerState, targetX: number, targetY: number, input: PlayerInput): boolean {
    const targetTile = worldToTile(targetY) * this.grid.width + worldToTile(targetX);
    let reachable = true;
    if (this.repathCooldown <= 0 || targetTile !== this.pathTargetTile) {
      const path = this.computePath(sim, self, targetX, targetY);
      reachable = path !== null;
      this.path = path ?? [];
      this.pathTargetTile = targetTile;
      this.repathCooldown = 0.45 + this.random() * 0.2;
    }
    while (this.path.length > 0 && distance(self.x, self.y, this.path[0].x, this.path[0].y) < 9) this.path.shift();
    const waypoint = this.path[0] ?? { x: targetX, y: targetY };
    const dx = waypoint.x - self.x;
    const dy = waypoint.y - self.y;
    const length = Math.hypot(dx, dy);
    if (length < 2) return reachable;
    input.moveX = dx / length;
    input.moveY = dy / length;
    this.wantedToMove = true;
    if (!this.aimLocked) input.aimAngle = Math.atan2(dy, dx);
    return reachable;
  }

  private computePath(sim: GameSimulation, self: PlayerState, targetX: number, targetY: number): Vec2[] | null {
    const map = sim.map;
    const blockedRooms = sim.blockedRoomsFor(self);
    const barricadeTiles = new Set<number>();
    for (const item of sim.items) {
      if (!item.placed) continue;
      const rect = sim.barricadeRect(item);
      const margin = PLAYER_RADIUS + 1;
      for (let ty = worldToTile(rect.y - margin); ty <= worldToTile(rect.y + rect.h + margin); ty++) {
        for (let tx = worldToTile(rect.x - margin); tx <= worldToTile(rect.x + rect.w + margin); tx++) {
          const center = tileCenter(tx, ty);
          if (
            center.x > rect.x - margin &&
            center.x < rect.x + rect.w + margin &&
            center.y > rect.y - margin &&
            center.y < rect.y + rect.h + margin
          ) {
            barricadeTiles.add(ty * map.widthTiles + tx);
          }
        }
      }
    }
    const roomBlocked = (tx: number, ty: number): boolean => {
      if (blockedRooms.size === 0) return false;
      const room = map.roomIndexByTile[tileIndex(map, tx, ty)];
      return room >= 0 && blockedRooms.has(room);
    };
    const startX = worldToTile(self.x);
    const startY = worldToTile(self.y);
    const goalX = worldToTile(targetX);
    const goalY = worldToTile(targetY);
    let tiles = findPath(this.grid, startX, startY, goalX, goalY, (tx, ty) =>
      roomBlocked(tx, ty) || barricadeTiles.has(ty * map.widthTiles + tx),
    );
    // No way around the barricades: walk up to one and break it.
    if (!tiles && barricadeTiles.size > 0) tiles = findPath(this.grid, startX, startY, goalX, goalY, roomBlocked);
    return tiles ? tiles.map((tile) => tileCenter(tile.x, tile.y)) : null;
  }

  private lookAt(self: PlayerState, x: number, y: number, input: PlayerInput): void {
    input.aimAngle = Math.atan2(y - self.y, x - self.x);
    this.aimLocked = true;
  }

  private pulseInteract(input: PlayerInput): void {
    this.interactPulse = !this.interactPulse;
    input.interact = this.interactPulse;
  }

  private updateStuckDetection(sim: GameSimulation, self: PlayerState, dt: number): void {
    const moved = distance(self.x, self.y, this.lastX, this.lastY);
    this.lastX = self.x;
    this.lastY = self.y;
    if (this.wantedToMove && moved < 0.6 && self.stunRemaining <= 0) this.stuckSeconds += dt;
    else this.stuckSeconds = Math.max(0, this.stuckSeconds - dt * 2);
    if (this.stuckSeconds < 0.8) return;
    this.stuckSeconds = 0;
    this.path = [];
    this.repathCooldown = 0;
    if (sim.phase === 'chaos') {
      const barricade = sim.items.find(
        (item) =>
          item.placed &&
          item.placedOwnerId !== self.id &&
          distance(self.x, self.y, item.x, item.y) < 70,
      );
      if (barricade) {
        this.barricadeTargetId = barricade.id;
        return;
      }
    }
    this.unstickSeconds = 0.35;
    this.unstickAngle = this.random() * Math.PI * 2;
  }

  /** Hits the barricade blocking the way. Returns true while busy. */
  private attackBarricade(sim: GameSimulation, self: PlayerState, input: PlayerInput): boolean {
    const barricade = this.barricadeTargetId === null ? undefined : sim.getItem(this.barricadeTargetId);
    if (!barricade || !barricade.placed || sim.phase !== 'chaos') {
      this.barricadeTargetId = null;
      return false;
    }
    const rect = sim.barricadeRect(barricade);
    const closestX = Math.max(rect.x, Math.min(self.x, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(self.y, rect.y + rect.h));
    const gap = distance(self.x, self.y, closestX, closestY);
    if (gap > 90) {
      this.barricadeTargetId = null;
      return false;
    }
    input.aimAngle = Math.atan2(closestY - self.y, closestX - self.x);
    if (gap > sim.weaponStatsOf(self).range) {
      input.moveX = Math.cos(input.aimAngle);
      input.moveY = Math.sin(input.aimAngle);
      this.wantedToMove = true;
    } else if (self.attackCooldown <= 0) {
      input.attack = true;
    }
    return true;
  }
}
