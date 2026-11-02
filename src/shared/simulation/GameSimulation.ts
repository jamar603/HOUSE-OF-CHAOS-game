/**
 * Authoritative game simulation.
 *
 * This class is the single source of truth for a match: movement, collisions,
 * items, damage, downed/revive/elimination rules, phases and the clock.
 * It has no dependency on the DOM so the exact same code can run in the
 * browser (offline mode with bots) and later on a Node.js server.
 *
 * Players only influence it through {@link PlayerInput}; every input is
 * sanitized and combat is always resolved here, never trusted from a client.
 */
import {
  BARRICADE_HEALTH,
  BLEED_OUT_SECONDS,
  DOWNED_CRAWL_SPEED,
  FINISHING_HIT_BLEED_PENALTY,
  ITEM_RESPAWN_SECONDS,
  KNOCKBACK_DECAY_PER_SECOND,
  MAX_HEALTH,
  MAX_ITEMS_IN_WORLD,
  MAX_PLAYERS,
  PICKUP_RANGE,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  REVIVE_DURATION_SECONDS,
  REVIVE_HEALTH,
  REVIVE_RANGE,
  STUNNED_SPEED_MULTIPLIER,
  STUN_IMMUNITY_AFTER_SECONDS,
  TILE_SIZE,
} from '../constants';
import { createHouseMap } from '../house/houseLayout';
import type { HouseMap } from '../house/houseMap';
import { BOTTLE_SHATTER_BONUS, FIST_STATS, ITEM_DEFINITIONS, type WeaponStats } from '../items/itemDefinitions';
import {
  angleDifference,
  circleIntersectsRect,
  clamp,
  closestPointOnRect,
  createSeededRandom,
  distance,
  rectsOverlap,
  type Rect,
} from '../math';
import {
  createEmptyInput,
  type GameEvent,
  type GamePhase,
  type ItemKind,
  type ItemState,
  type MatchResult,
  type PlayerInput,
  type PlayerState,
  type WeaponKind,
} from '../types';
import { circleCollides, hasLineOfSight, isTileBlocking, moveCircle, type CollisionWorld } from './collision';

export interface PlayerSetup {
  name: string;
  characterId: string;
  isBot: boolean;
}

export interface SimulationOptions {
  /** Length of the preparation phase. 900 s (15 min) in the final game. */
  preparationSeconds: number;
  seed?: number;
}

const NO_BLOCKED_ROOMS: ReadonlySet<number> = new Set();

function createPlayerState(slot: number, setup: PlayerSetup, x: number, y: number): PlayerState {
  return {
    id: slot,
    slot,
    name: setup.name,
    characterId: setup.characterId,
    isBot: setup.isBot,
    x,
    y,
    facing: Math.PI / 2,
    isMoving: false,
    walkCycle: 0,
    health: MAX_HEALTH,
    life: 'alive',
    bleedOutRemaining: 0,
    reviveProgress: 0,
    reviverId: null,
    revivingTargetId: null,
    heldItemId: null,
    attackCooldown: 0,
    swingRemaining: 0,
    swingDuration: 0,
    swingWeapon: 'fists',
    stunRemaining: 0,
    stunImmunityRemaining: 0,
    knockbackX: 0,
    knockbackY: 0,
    lastAttackerId: null,
    eliminatedAtSeconds: null,
    previousInteract: false,
    previousDrop: false,
    stats: { kills: 0, damageDealt: 0, damageTaken: 0, revivesGiven: 0, itemsBroken: 0, timesDowned: 0 },
  };
}

/** Clamps everything a client sends. Never trust raw input. */
export function sanitizeInput(input: PlayerInput | undefined, fallbackAim: number): PlayerInput {
  if (!input) return createEmptyInput(fallbackAim);
  let moveX = Number.isFinite(input.moveX) ? clamp(input.moveX, -1, 1) : 0;
  let moveY = Number.isFinite(input.moveY) ? clamp(input.moveY, -1, 1) : 0;
  const length = Math.hypot(moveX, moveY);
  if (length > 1) {
    moveX /= length;
    moveY /= length;
  }
  return {
    moveX,
    moveY,
    aimAngle: Number.isFinite(input.aimAngle) ? input.aimAngle : fallbackAim,
    attack: input.attack === true,
    interact: input.interact === true,
    drop: input.drop === true,
  };
}

export class GameSimulation {
  readonly map: HouseMap;
  readonly players: PlayerState[] = [];
  items: ItemState[] = [];
  phase: GamePhase = 'preparation';
  /** Seconds left in the preparation phase. */
  phaseTimeRemaining: number;
  readonly preparationSeconds: number;
  elapsedSeconds = 0;
  chaosElapsedSeconds = 0;
  /** Events produced by the last call to {@link step}. */
  events: GameEvent[] = [];
  result: MatchResult | null = null;

  private readonly random: () => number;
  private nextItemId = 1;
  private readonly spawnTimers: number[];
  private readonly eliminationOrder: number[] = [];
  private readonly furnitureRects: Rect[];
  private readonly blockedRoomsBySlot: ReadonlySet<number>[];

  constructor(setups: PlayerSetup[], options: SimulationOptions, map: HouseMap = createHouseMap()) {
    if (setups.length === 0 || setups.length > MAX_PLAYERS) {
      throw new Error(`A match needs between 1 and ${MAX_PLAYERS} players (got ${setups.length}).`);
    }
    this.map = map;
    this.random = createSeededRandom(options.seed ?? Date.now());
    this.preparationSeconds = Math.max(0, options.preparationSeconds);
    this.phaseTimeRemaining = this.preparationSeconds;
    this.furnitureRects = map.furniture.filter((f) => f.solid).map((f) => ({ x: f.x, y: f.y, w: f.w, h: f.h }));
    this.blockedRoomsBySlot = [0, 1, 2, 3].map(
      (slot) =>
        new Set(
          map.rooms
            .map((room, index) => (room.kind === 'bedroom' && room.ownerSlot !== slot ? index : -1))
            .filter((index) => index >= 0),
        ),
    );

    setups.forEach((setup, slot) => {
      const spawn = map.playerSpawns[slot];
      this.players.push(createPlayerState(slot, setup, spawn.x, spawn.y));
    });

    this.spawnTimers = map.itemSpawns.map(() => 0);
    map.itemSpawns.forEach((spawn, index) => this.spawnItem(spawn.kind, spawn.x, spawn.y, index));

    if (this.preparationSeconds === 0) this.startChaos();
  }

  // ---------------------------------------------------------------- queries

  getPlayer(playerId: number): PlayerState | undefined {
    return this.players[playerId];
  }

  getItem(itemId: number): ItemState | undefined {
    return this.items.find((item) => item.id === itemId);
  }

  heldItemOf(player: PlayerState): ItemState | undefined {
    return player.heldItemId === null ? undefined : this.getItem(player.heldItemId);
  }

  weaponStatsOf(player: PlayerState): WeaponStats {
    const item = this.heldItemOf(player);
    return item ? ITEM_DEFINITIONS[item.kind] : FIST_STATS;
  }

  /** Bedrooms a player may not enter right now (other players' rooms during preparation). */
  blockedRoomsFor(player: PlayerState): ReadonlySet<number> {
    return this.phase === 'preparation' ? this.blockedRoomsBySlot[player.slot] : NO_BLOCKED_ROOMS;
  }

  barricadeRect(item: ItemState): Rect {
    return { x: item.x - item.width / 2, y: item.y - item.height / 2, w: item.width, h: item.height };
  }

  solidRects(): Rect[] {
    const rects = this.furnitureRects.slice();
    for (const item of this.items) if (item.placed) rects.push(this.barricadeRect(item));
    return rects;
  }

  // ---------------------------------------------------------------- update

  /** Advances the match by dt seconds. Inputs are keyed by player id. */
  step(dt: number, inputs: ReadonlyMap<number, PlayerInput>): void {
    this.events = [];
    if (this.phase === 'finished') return;
    const deltaSeconds = clamp(dt, 0, 0.1);
    this.elapsedSeconds += deltaSeconds;
    this.updatePhase(deltaSeconds);

    const rects = this.solidRects();
    for (const player of this.players) {
      this.updatePlayer(player, sanitizeInput(inputs.get(player.id), player.facing), deltaSeconds, rects);
    }
    this.separatePlayers(rects);
    this.updateDownedPlayers(deltaSeconds);
    this.updateItemRespawns(deltaSeconds);
    this.checkVictory();
  }

  private updatePhase(dt: number): void {
    if (this.phase === 'preparation') {
      this.phaseTimeRemaining -= dt;
      if (this.phaseTimeRemaining <= 0) this.startChaos();
    } else if (this.phase === 'chaos') {
      this.chaosElapsedSeconds += dt;
    }
  }

  private startChaos(): void {
    this.phase = 'chaos';
    this.phaseTimeRemaining = 0;
    this.events.push({ type: 'phaseChanged', phase: 'chaos' });
  }

  private collisionWorldFor(player: PlayerState, rects: readonly Rect[]): CollisionWorld {
    return { map: this.map, rects, blockedRooms: this.blockedRoomsFor(player) };
  }

  private updatePlayer(player: PlayerState, input: PlayerInput, dt: number, rects: readonly Rect[]): void {
    player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    player.swingRemaining = Math.max(0, player.swingRemaining - dt);
    player.stunRemaining = Math.max(0, player.stunRemaining - dt);
    player.stunImmunityRemaining = Math.max(0, player.stunImmunityRemaining - dt);
    if (player.life === 'eliminated') {
      player.isMoving = false;
      return;
    }

    const interactPressed = input.interact && !player.previousInteract;
    const dropPressed = input.drop && !player.previousDrop;
    player.previousInteract = input.interact;
    player.previousDrop = input.drop;

    if (player.life === 'alive') player.facing = input.aimAngle;

    // Movement.
    let speed = 0;
    if (player.life === 'alive') {
      speed = PLAYER_SPEED * this.weaponStatsOf(player).moveSpeedMultiplier;
      if (player.stunRemaining > 0) speed *= STUNNED_SPEED_MULTIPLIER;
      if (player.revivingTargetId !== null) speed = 0;
    } else if (player.reviverId === null) {
      speed = DOWNED_CRAWL_SPEED;
    }
    const moveLength = Math.hypot(input.moveX, input.moveY);
    const decay = Math.exp(-KNOCKBACK_DECAY_PER_SECOND * dt);
    const dx = input.moveX * speed * dt + player.knockbackX * dt;
    const dy = input.moveY * speed * dt + player.knockbackY * dt;
    player.knockbackX *= decay;
    player.knockbackY *= decay;
    if (Math.abs(player.knockbackX) < 1) player.knockbackX = 0;
    if (Math.abs(player.knockbackY) < 1) player.knockbackY = 0;
    const before = { x: player.x, y: player.y };
    const moved = moveCircle(this.collisionWorldFor(player, rects), player.x, player.y, PLAYER_RADIUS, dx, dy);
    player.x = moved.x;
    player.y = moved.y;
    const travelled = distance(before.x, before.y, player.x, player.y);
    player.isMoving = moveLength > 0.1 && travelled > 0.05;
    if (player.isMoving) player.walkCycle += travelled / 6;
    if (player.life === 'downed' && player.isMoving) player.facing = Math.atan2(input.moveY, input.moveX);

    if (player.life !== 'alive') return;

    this.handleInteraction(player, input.interact, interactPressed, dt);
    if (dropPressed) this.dropHeldItem(player, true);
    if (
      input.attack &&
      player.attackCooldown <= 0 &&
      player.stunRemaining <= 0 &&
      player.revivingTargetId === null
    ) {
      this.performAttack(player);
    }
  }

  /** Pushes overlapping standing players apart. */
  private separatePlayers(rects: readonly Rect[]): void {
    const standing = this.players.filter((player) => player.life === 'alive');
    for (let i = 0; i < standing.length; i++) {
      for (let j = i + 1; j < standing.length; j++) {
        const a = standing[i];
        const b = standing[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const gap = Math.hypot(dx, dy);
        const minGap = PLAYER_RADIUS * 2;
        if (gap >= minGap) continue;
        const nx = gap > 0.001 ? dx / gap : 1;
        const ny = gap > 0.001 ? dy / gap : 0;
        const push = (minGap - gap) / 2;
        const movedA = moveCircle(this.collisionWorldFor(a, rects), a.x, a.y, PLAYER_RADIUS, -nx * push, -ny * push);
        const movedB = moveCircle(this.collisionWorldFor(b, rects), b.x, b.y, PLAYER_RADIUS, nx * push, ny * push);
        a.x = movedA.x;
        a.y = movedA.y;
        b.x = movedB.x;
        b.y = movedB.y;
      }
    }
  }

  // ---------------------------------------------------------------- interactions

  private handleInteraction(player: PlayerState, interactHeld: boolean, interactPressed: boolean, dt: number): void {
    if (player.revivingTargetId !== null) {
      const target = this.players[player.revivingTargetId];
      const stillValid =
        interactHeld &&
        target !== undefined &&
        target.life === 'downed' &&
        distance(player.x, player.y, target.x, target.y) <= REVIVE_RANGE + 10;
      if (!stillValid) {
        this.cancelRevive(player);
        return;
      }
      target.reviveProgress += dt;
      if (target.reviveProgress >= REVIVE_DURATION_SECONDS) this.completeRevive(player, target);
      return;
    }
    if (!interactPressed) return;

    const downedTarget = this.findDownedPlayerNear(player);
    if (downedTarget) {
      player.revivingTargetId = downedTarget.id;
      downedTarget.reviverId = player.id;
      downedTarget.reviveProgress = 0;
      this.events.push({ type: 'reviveStarted', reviverId: player.id, targetId: downedTarget.id });
      return;
    }
    this.tryPickup(player);
  }

  private findDownedPlayerNear(player: PlayerState): PlayerState | null {
    let best: PlayerState | null = null;
    let bestDistance = REVIVE_RANGE;
    for (const other of this.players) {
      if (other.id === player.id || other.life !== 'downed' || other.reviverId !== null) continue;
      const gap = distance(player.x, player.y, other.x, other.y);
      if (gap > bestDistance || !hasLineOfSight(this.map, player.x, player.y, other.x, other.y)) continue;
      best = other;
      bestDistance = gap;
    }
    return best;
  }

  private cancelRevive(reviver: PlayerState): void {
    if (reviver.revivingTargetId === null) return;
    const target = this.players[reviver.revivingTargetId];
    if (target && target.reviverId === reviver.id) {
      target.reviverId = null;
      target.reviveProgress = 0;
    }
    reviver.revivingTargetId = null;
  }

  private completeRevive(reviver: PlayerState, target: PlayerState): void {
    target.life = 'alive';
    target.health = REVIVE_HEALTH;
    target.bleedOutRemaining = 0;
    target.reviveProgress = 0;
    target.reviverId = null;
    target.stunRemaining = 0;
    reviver.revivingTargetId = null;
    reviver.stats.revivesGiven += 1;
    this.events.push({ type: 'revived', reviverId: reviver.id, targetId: target.id });
  }

  private tryPickup(player: PlayerState): boolean {
    let best: ItemState | null = null;
    let bestScore = Infinity;
    for (const item of this.items) {
      if (item.holderId !== null) continue;
      if (item.placed && item.placedOwnerId !== player.id) continue;
      const point = item.placed ? closestPointOnRect(player.x, player.y, this.barricadeRect(item)) : item;
      const gap = distance(player.x, player.y, point.x, point.y);
      if (gap > PICKUP_RANGE) continue;
      if (!hasLineOfSight(this.map, player.x, player.y, point.x, point.y)) continue;
      // Loose items are preferred over picking your own barricade back up.
      const score = gap + (item.placed ? 1000 : 0);
      if (score < bestScore) {
        best = item;
        bestScore = score;
      }
    }
    if (!best) return false;
    if (player.heldItemId !== null) this.dropHeldItem(player, false);
    best.placed = false;
    best.placedOwnerId = null;
    best.holderId = player.id;
    best.spawnPointIndex = null;
    player.heldItemId = best.id;
    this.events.push({ type: 'pickup', playerId: player.id, itemKind: best.kind });
    return true;
  }

  private dropHeldItem(player: PlayerState, tryPlaceBarricade: boolean): void {
    const item = this.heldItemOf(player);
    if (!item) return;
    player.heldItemId = null;
    item.holderId = null;
    if (tryPlaceBarricade && ITEM_DEFINITIONS[item.kind].canBarricade && this.tryPlaceBarricade(player, item)) {
      this.events.push({ type: 'drop', playerId: player.id, itemKind: item.kind, placed: true });
      return;
    }
    item.x = player.x;
    item.y = player.y;
    item.rotation = player.facing;
    this.events.push({ type: 'drop', playerId: player.id, itemKind: item.kind, placed: false });
  }

  /** Places a table as a solid barricade in front of the player if there is room. */
  private tryPlaceBarricade(player: PlayerState, item: ItemState): boolean {
    const horizontal = Math.abs(Math.sin(player.facing)) > Math.abs(Math.cos(player.facing));
    const width = horizontal ? 58 : 30;
    const height = horizontal ? 30 : 58;
    const centerX = player.x + Math.cos(player.facing) * 34;
    const centerY = player.y + Math.sin(player.facing) * 34;
    const rect: Rect = { x: centerX - width / 2, y: centerY - height / 2, w: width, h: height };
    const blockedRooms = this.blockedRoomsFor(player);

    for (let ty = Math.floor(rect.y / TILE_SIZE); ty <= Math.floor((rect.y + rect.h) / TILE_SIZE); ty++) {
      for (let tx = Math.floor(rect.x / TILE_SIZE); tx <= Math.floor((rect.x + rect.w) / TILE_SIZE); tx++) {
        if (!isTileBlocking(this.map, tx, ty, blockedRooms)) continue;
        const tileRect = { x: tx * TILE_SIZE, y: ty * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
        if (rectsOverlap(rect, tileRect)) return false;
      }
    }
    for (const solid of this.solidRects()) if (rectsOverlap(rect, solid)) return false;
    for (const other of this.players) {
      if (other.life === 'eliminated') continue;
      if (circleIntersectsRect(other.x, other.y, PLAYER_RADIUS + 1, rect)) return false;
    }

    item.placed = true;
    item.placedOwnerId = player.id;
    item.barricadeHealth = BARRICADE_HEALTH;
    item.x = centerX;
    item.y = centerY;
    item.width = width;
    item.height = height;
    item.rotation = horizontal ? 0 : Math.PI / 2;
    return true;
  }

  // ---------------------------------------------------------------- combat

  private performAttack(attacker: PlayerState): void {
    const heldItem = this.heldItemOf(attacker);
    const stats = heldItem ? ITEM_DEFINITIONS[heldItem.kind] : FIST_STATS;
    const weapon: WeaponKind = heldItem ? heldItem.kind : 'fists';
    attacker.attackCooldown = stats.cooldownSeconds;
    attacker.swingRemaining = stats.swingSeconds;
    attacker.swingDuration = stats.swingSeconds;
    attacker.swingWeapon = weapon;
    this.events.push({ type: 'swing', playerId: attacker.id, weapon });

    const halfArc = ((stats.arcDegrees * Math.PI) / 180) / 2;
    const isShatteringHit = heldItem?.kind === 'bottle' && heldItem.durability === 1;
    const damage = stats.damage + (isShatteringHit ? BOTTLE_SHATTER_BONUS : 0);
    let landedHit = false;

    for (const target of this.players) {
      if (target.id === attacker.id || target.life === 'eliminated') continue;
      if (!this.isInAttackArc(attacker, target.x, target.y, stats.range + PLAYER_RADIUS, halfArc)) continue;
      if (this.phase !== 'chaos') {
        this.events.push({ type: 'combatBlocked', playerId: attacker.id });
        continue;
      }
      landedHit = true;
      this.applyHit(attacker, target, damage, stats, weapon);
    }

    if (this.phase === 'chaos') {
      for (const item of this.items.slice()) {
        if (!item.placed) continue;
        const closest = closestPointOnRect(attacker.x, attacker.y, this.barricadeRect(item));
        if (!this.isInAttackArc(attacker, closest.x, closest.y, stats.range + 4, halfArc)) continue;
        landedHit = true;
        this.damageBarricade(item, damage);
      }
    }

    if (landedHit && heldItem) {
      heldItem.durability -= 1;
      if (heldItem.durability <= 0) this.breakHeldItem(attacker, heldItem);
    }
  }

  private isInAttackArc(attacker: PlayerState, tx: number, ty: number, reach: number, halfArc: number): boolean {
    const dx = tx - attacker.x;
    const dy = ty - attacker.y;
    const gap = Math.hypot(dx, dy);
    if (gap > reach) return false;
    if (gap > PLAYER_RADIUS * 1.4 && Math.abs(angleDifference(attacker.facing, Math.atan2(dy, dx))) > halfArc) {
      return false;
    }
    return hasLineOfSight(this.map, attacker.x, attacker.y, tx, ty);
  }

  private applyHit(attacker: PlayerState, target: PlayerState, damage: number, stats: WeaponStats, weapon: WeaponKind): void {
    target.lastAttackerId = attacker.id;
    if (target.life === 'downed') {
      target.bleedOutRemaining -= FINISHING_HIT_BLEED_PENALTY;
      this.events.push({
        type: 'hit',
        attackerId: attacker.id,
        targetId: target.id,
        amount: 0,
        x: target.x,
        y: target.y,
        weapon,
        finishing: true,
        stunned: false,
      });
      return;
    }

    const dealt = Math.min(damage, target.health);
    target.health -= damage;
    attacker.stats.damageDealt += dealt;
    target.stats.damageTaken += dealt;

    const dx = target.x - attacker.x;
    const dy = target.y - attacker.y;
    const gap = Math.hypot(dx, dy) || 1;
    target.knockbackX = (dx / gap) * stats.knockback;
    target.knockbackY = (dy / gap) * stats.knockback;

    let stunned = false;
    if (stats.stunSeconds > 0 && target.stunImmunityRemaining <= 0) {
      target.stunRemaining = stats.stunSeconds;
      target.stunImmunityRemaining = stats.stunSeconds + STUN_IMMUNITY_AFTER_SECONDS;
      stunned = true;
    }
    this.cancelRevive(target);
    this.events.push({
      type: 'hit',
      attackerId: attacker.id,
      targetId: target.id,
      amount: dealt,
      x: target.x,
      y: target.y,
      weapon,
      finishing: false,
      stunned,
    });

    if (target.health <= 0) this.knockOut(target);
  }

  private knockOut(player: PlayerState): void {
    player.health = 0;
    player.life = 'downed';
    player.bleedOutRemaining = BLEED_OUT_SECONDS;
    player.reviveProgress = 0;
    player.reviverId = null;
    player.stunRemaining = 0;
    player.stats.timesDowned += 1;
    this.cancelRevive(player);
    this.dropHeldItem(player, false);
    this.events.push({ type: 'downed', playerId: player.id, attackerId: player.lastAttackerId });
  }

  private damageBarricade(item: ItemState, damage: number): void {
    item.barricadeHealth -= damage;
    this.events.push({ type: 'barricadeHit', itemId: item.id, x: item.x, y: item.y, amount: damage });
    if (item.barricadeHealth <= 0) {
      this.items = this.items.filter((other) => other.id !== item.id);
      this.events.push({ type: 'barricadeDestroyed', itemId: item.id, x: item.x, y: item.y });
    }
  }

  private breakHeldItem(player: PlayerState, item: ItemState): void {
    this.items = this.items.filter((other) => other.id !== item.id);
    player.heldItemId = null;
    player.stats.itemsBroken += 1;
    this.events.push({ type: 'itemBroken', playerId: player.id, itemKind: item.kind, x: player.x, y: player.y });
  }

  // ---------------------------------------------------------------- health

  private updateDownedPlayers(dt: number): void {
    for (const player of this.players) {
      if (player.life !== 'downed') continue;
      // The bleed-out timer pauses while someone is reviving.
      if (player.reviverId === null) player.bleedOutRemaining -= dt;
      if (player.bleedOutRemaining <= 0) this.eliminate(player);
    }
  }

  private eliminate(player: PlayerState): void {
    if (player.reviverId !== null) {
      const reviver = this.players[player.reviverId];
      if (reviver) reviver.revivingTargetId = null;
    }
    player.life = 'eliminated';
    player.health = 0;
    player.bleedOutRemaining = 0;
    player.reviverId = null;
    player.reviveProgress = 0;
    player.eliminatedAtSeconds = this.elapsedSeconds;
    this.eliminationOrder.push(player.id);
    const killerId = player.lastAttackerId !== null && player.lastAttackerId !== player.id ? player.lastAttackerId : null;
    if (killerId !== null) this.players[killerId].stats.kills += 1;
    this.events.push({ type: 'eliminated', playerId: player.id, killerId });
  }

  private checkVictory(): void {
    if (this.phase !== 'chaos') return;
    const remaining = this.players.filter((player) => player.life !== 'eliminated');
    if (remaining.length > 1) return;
    if (this.players.length === 1 && remaining.length === 1) return; // solo sandbox never ends
    const winnerId = remaining[0]?.id ?? this.eliminationOrder[this.eliminationOrder.length - 1] ?? null;
    const ranking = [...remaining.map((player) => player.id), ...this.eliminationOrder.slice().reverse()].filter(
      (id, index, list) => list.indexOf(id) === index,
    );
    this.phase = 'finished';
    this.result = { winnerId, durationSeconds: this.elapsedSeconds, ranking };
    this.events.push({ type: 'matchEnded', winnerId });
  }

  // ---------------------------------------------------------------- items

  private spawnItem(kind: ItemKind, x: number, y: number, spawnPointIndex: number | null): ItemState {
    const item: ItemState = {
      id: this.nextItemId++,
      kind,
      x,
      y,
      rotation: this.random() * Math.PI * 2,
      durability: ITEM_DEFINITIONS[kind].maxDurability,
      holderId: null,
      placed: false,
      placedOwnerId: null,
      barricadeHealth: 0,
      width: 0,
      height: 0,
      spawnPointIndex,
    };
    this.items.push(item);
    return item;
  }

  private updateItemRespawns(dt: number): void {
    this.map.itemSpawns.forEach((spawn, index) => {
      const occupied = this.items.some(
        (item) => item.holderId === null && !item.placed && distance(item.x, item.y, spawn.x, spawn.y) < 24,
      );
      if (occupied) {
        this.spawnTimers[index] = 0;
        return;
      }
      this.spawnTimers[index] += dt;
      if (this.spawnTimers[index] < ITEM_RESPAWN_SECONDS || this.items.length >= MAX_ITEMS_IN_WORLD) return;
      // Never spawn an item on top of a standing player.
      const blocked = this.players.some(
        (player) => player.life !== 'eliminated' && distance(player.x, player.y, spawn.x, spawn.y) < PLAYER_RADIUS * 2,
      );
      if (blocked) return;
      this.spawnTimers[index] = 0;
      this.spawnItem(spawn.kind, spawn.x, spawn.y, index);
      this.events.push({ type: 'itemSpawned', itemKind: spawn.kind, x: spawn.x, y: spawn.y });
    });
  }

  /** Debug helper used by tests: true if a circle at this position would collide. */
  collidesAt(player: PlayerState, x: number, y: number): boolean {
    return circleCollides(this.collisionWorldFor(player, this.solidRects()), x, y, PLAYER_RADIUS);
  }
}
