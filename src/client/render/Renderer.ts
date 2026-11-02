/**
 * Draws the world from the simulation state. Read-only: the renderer never
 * changes the simulation. Positions can be interpolated between two ticks.
 */
import {
  BLEED_OUT_SECONDS,
  getCharacter,
  MAX_HEALTH,
  PICKUP_RANGE,
  REVIVE_DURATION_SECONDS,
  REVIVE_RANGE,
  TILE_SIZE,
} from '../../shared/constants';
import { roomRectPixels } from '../../shared/house/houseMap';
import { ITEM_DEFINITIONS } from '../../shared/items/itemDefinitions';
import { clamp, distance, lerp } from '../../shared/math';
import type { GameSimulation } from '../../shared/simulation/GameSimulation';
import type { ItemState, PlayerState } from '../../shared/types';
import { drawCharacter } from './characterArt';
import { EffectsSystem } from './effects';
import { createHouseLayer } from './houseArt';
import { drawBarricade, drawFloorItem } from './itemArt';

export interface RenderFrame {
  sim: GameSimulation;
  localPlayerId: number;
  cameraTargetId: number;
  time: number;
  dt: number;
  /** Interpolated draw positions per player id. */
  positions: ReadonlyMap<number, { x: number; y: number }>;
}

export interface InteractionHint {
  text: string;
  x: number;
  y: number;
  itemId: number | null;
}

/** What the local player would do by pressing E right now (mirrors the simulation rules). */
export function findInteractionHint(sim: GameSimulation, player: PlayerState): InteractionHint | null {
  if (player.life !== 'alive') return null;
  if (player.revivingTargetId !== null) {
    const target = sim.players[player.revivingTargetId];
    return { text: `Réanimation de ${target.name}…`, x: target.x, y: target.y - 36, itemId: null };
  }
  for (const other of sim.players) {
    if (other.id === player.id || other.life !== 'downed' || other.reviverId !== null) continue;
    if (distance(player.x, player.y, other.x, other.y) <= REVIVE_RANGE) {
      return { text: `Maintenir E · Réanimer ${other.name}`, x: other.x, y: other.y - 36, itemId: null };
    }
  }
  let best: ItemState | null = null;
  let bestDistance = PICKUP_RANGE;
  for (const item of sim.items) {
    if (item.holderId !== null || item.placed) continue;
    const gap = distance(player.x, player.y, item.x, item.y);
    if (gap < bestDistance) {
      best = item;
      bestDistance = gap;
    }
  }
  if (best) {
    const label = ITEM_DEFINITIONS[best.kind].label;
    const verb = player.heldItemId !== null ? 'Échanger contre' : 'Ramasser';
    return { text: `E · ${verb} ${label}`, x: best.x, y: best.y - 26, itemId: best.id };
  }
  const ownBarricade = sim.items.find(
    (item) => item.placed && item.placedOwnerId === player.id && distance(player.x, player.y, item.x, item.y) < PICKUP_RANGE + 20,
  );
  if (ownBarricade) {
    return { text: 'E · Reprendre la table', x: ownBarricade.x, y: ownBarricade.y - 28, itemId: ownBarricade.id };
  }
  return null;
}

export class Renderer {
  readonly effects = new EffectsSystem();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private houseLayer: HTMLCanvasElement;
  private cameraX = 0;
  private cameraY = 0;
  private cameraInitialized = false;
  private zoomFactor = 1;
  private viewWidth = 1;
  private viewHeight = 1;
  private pixelRatio = 1;
  private vignette: CanvasGradient | null = null;

  constructor(canvas: HTMLCanvasElement, sim: GameSimulation) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D indisponible.');
    this.ctx = ctx;
    this.houseLayer = createHouseLayer(sim.map, {
      ownerColors: [0, 1, 2, 3].map((slot) => {
        const player = sim.players[slot];
        return player ? getCharacter(player.characterId).bodyColor : null;
      }),
      ownerNames: [0, 1, 2, 3].map((slot) => sim.players[slot]?.name ?? null),
    });
    this.resize();
  }

  resize(): void {
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.viewWidth = this.canvas.clientWidth || window.innerWidth;
    this.viewHeight = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.viewWidth * this.pixelRatio);
    this.canvas.height = Math.round(this.viewHeight * this.pixelRatio);
    this.vignette = null;
  }

  adjustZoom(steps: number): void {
    this.zoomFactor = clamp(this.zoomFactor * Math.pow(1.12, -steps), 0.6, 1.7);
  }

  /** Base zoom adapts to the window so the visible area stays comparable on any screen. */
  get zoom(): number {
    const base = clamp(Math.min(this.viewWidth / 880, this.viewHeight / 540), 0.85, 2.4);
    return base * this.zoomFactor;
  }

  worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.cameraX) * this.zoom + this.viewWidth / 2,
      y: (y - this.cameraY) * this.zoom + this.viewHeight / 2,
    };
  }

  render(frame: RenderFrame): void {
    const { sim, time, dt } = frame;
    const ctx = this.ctx;
    const target = frame.positions.get(frame.cameraTargetId) ?? sim.players[frame.cameraTargetId];
    const follow = 1 - Math.exp(-10 * dt);
    if (!this.cameraInitialized) {
      this.cameraX = target.x;
      this.cameraY = target.y;
      this.cameraInitialized = true;
    } else {
      this.cameraX = lerp(this.cameraX, target.x, follow);
      this.cameraY = lerp(this.cameraY, target.y, follow);
    }
    const shake = this.effects.update(dt);
    const zoom = this.zoom;

    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.fillStyle = '#0d0e16';
    ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);

    ctx.save();
    ctx.translate(this.viewWidth / 2 + shake.x, this.viewHeight / 2 + shake.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-this.cameraX, -this.cameraY);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.houseLayer, 0, 0);

    const local = sim.players[frame.localPlayerId];
    if (sim.phase === 'preparation') this.drawForbiddenBedrooms(sim, local, time);

    const hint = findInteractionHint(sim, local);
    for (const item of sim.items) {
      if (item.holderId !== null) continue;
      if (item.placed) {
        const shakeUntil = this.effects.barricadeShakeUntil.get(item.id) ?? 0;
        drawBarricade(ctx, item.x, item.y, item.width, item.height, item.barricadeHealth / 90, time < shakeUntil ? 3 : 0);
        continue;
      }
      drawFloorItem(ctx, item.kind, item.x, item.y, item.rotation, time, hint?.itemId === item.id);
    }

    const drawOrder = sim.players.slice().sort((a, b) => {
      const lifeOrder = (player: PlayerState): number => (player.life === 'eliminated' ? 0 : player.life === 'downed' ? 1 : 2);
      return lifeOrder(a) - lifeOrder(b) || a.y - b.y;
    });
    for (const player of drawOrder) this.drawPlayer(frame, player);

    this.effects.draw(ctx);
    for (const player of sim.players) this.drawPlayerOverlay(frame, player);
    if (hint) this.drawHint(hint);
    ctx.restore();

    this.drawVignette(local);
  }

  private drawPlayer(frame: RenderFrame, player: PlayerState): void {
    const { sim, time } = frame;
    const position = frame.positions.get(player.id) ?? player;
    const held = sim.heldItemOf(player);
    const swinging = player.swingRemaining > 0 && player.swingDuration > 0;
    const stats = sim.weaponStatsOf(player);
    const lastHit = this.effects.lastHitAt.get(player.id);
    drawCharacter(this.ctx, getCharacter(player.characterId), {
      x: position.x,
      y: position.y,
      facing: player.facing,
      walkCycle: player.walkCycle,
      isMoving: player.isMoving,
      life: player.life,
      heldItem: held?.kind ?? null,
      swingProgress: swinging ? 1 - player.swingRemaining / player.swingDuration : -1,
      swingArc: (stats.arcDegrees * Math.PI) / 180,
      hitFlash: lastHit === undefined ? 0 : clamp(1 - (time - lastHit) / 0.15, 0, 1),
      stunned: player.stunRemaining > 0,
      time,
    });
  }

  private drawPlayerOverlay(frame: RenderFrame, player: PlayerState): void {
    const ctx = this.ctx;
    const position = frame.positions.get(player.id) ?? player;
    const character = getCharacter(player.characterId);
    const isLocal = player.id === frame.localPlayerId;
    if (player.life === 'eliminated') return;

    if (player.life === 'downed') {
      const bleedRatio = clamp(player.bleedOutRemaining / BLEED_OUT_SECONDS, 0, 1);
      ctx.beginPath();
      ctx.arc(position.x, position.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * bleedRatio);
      ctx.strokeStyle = 'rgba(255,77,77,0.85)';
      ctx.lineWidth = 3;
      ctx.stroke();
      if (player.reviverId !== null) {
        const reviveRatio = clamp(player.reviveProgress / REVIVE_DURATION_SECONDS, 0, 1);
        ctx.beginPath();
        ctx.arc(position.x, position.y, 29, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reviveRatio);
        ctx.strokeStyle = '#7dffb3';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.font = '800 10px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb3b3';
      ctx.fillText(`${Math.ceil(player.bleedOutRemaining)} s`, position.x, position.y + 38);
    }

    // Name tag and health bar.
    const tagY = position.y - 27;
    ctx.font = `800 ${isLocal ? 11 : 10}px Nunito, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = isLocal ? `${player.name} (vous)` : player.name;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10,8,16,0.85)';
    ctx.strokeText(label, position.x, tagY - 7);
    ctx.fillStyle = isLocal ? '#ffffff' : character.accentColor;
    ctx.fillText(label, position.x, tagY - 7);
    if (player.life === 'alive') {
      const width = 30;
      const ratio = player.health / MAX_HEALTH;
      ctx.fillStyle = 'rgba(10,8,16,0.8)';
      ctx.fillRect(position.x - width / 2 - 1, tagY - 1, width + 2, 5);
      ctx.fillStyle = ratio > 0.5 ? '#4cd97b' : ratio > 0.25 ? '#ffc94d' : '#ff4d4d';
      ctx.fillRect(position.x - width / 2, tagY, width * ratio, 3);
    }
  }

  private drawHint(hint: InteractionHint): void {
    const ctx = this.ctx;
    ctx.font = '800 11px Nunito, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(hint.text).width + 16;
    ctx.beginPath();
    ctx.roundRect(hint.x - width / 2, hint.y - 10, width, 20, 10);
    ctx.fillStyle = 'rgba(20,14,30,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,214,92,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(hint.text, hint.x, hint.y + 0.5);
  }

  private drawForbiddenBedrooms(sim: GameSimulation, local: PlayerState, time: number): void {
    const ctx = this.ctx;
    for (const room of sim.map.rooms) {
      if (room.kind !== 'bedroom' || room.ownerSlot === local.slot) continue;
      const rect = roomRectPixels(room);
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x - TILE_SIZE, rect.y - TILE_SIZE, rect.w + TILE_SIZE * 2, rect.h + TILE_SIZE * 2);
      ctx.clip();
      ctx.fillStyle = 'rgba(200, 30, 60, 0.12)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = 'rgba(255, 80, 100, 0.16)';
      ctx.lineWidth = 6;
      const offset = (time * 12) % 28;
      for (let d = -rect.h; d < rect.w + rect.h; d += 28) {
        ctx.beginPath();
        ctx.moveTo(rect.x + d + offset, rect.y);
        ctx.lineTo(rect.x + d + offset - rect.h, rect.y + rect.h);
        ctx.stroke();
      }
      ctx.restore();
      ctx.font = '900 14px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 170, 180, 0.8)';
      ctx.fillText('🔒 PRIVÉ JUSQU’AU CHAOS', rect.x + rect.w / 2, rect.y + rect.h / 2);
    }
  }

  private drawVignette(local: PlayerState): void {
    const ctx = this.ctx;
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    if (!this.vignette) {
      const radius = Math.max(this.viewWidth, this.viewHeight) * 0.75;
      this.vignette = ctx.createRadialGradient(
        this.viewWidth / 2,
        this.viewHeight / 2,
        radius * 0.45,
        this.viewWidth / 2,
        this.viewHeight / 2,
        radius,
      );
      this.vignette.addColorStop(0, 'rgba(0,0,0,0)');
      this.vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);
    const danger = local.life === 'downed' ? 0.5 : local.life === 'alive' && local.health < 30 ? (30 - local.health) / 60 : 0;
    if (danger > 0) {
      const gradient = ctx.createRadialGradient(
        this.viewWidth / 2,
        this.viewHeight / 2,
        Math.min(this.viewWidth, this.viewHeight) * 0.3,
        this.viewWidth / 2,
        this.viewHeight / 2,
        Math.max(this.viewWidth, this.viewHeight) * 0.7,
      );
      gradient.addColorStop(0, 'rgba(160,0,20,0)');
      gradient.addColorStop(1, `rgba(160,0,20,${danger})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);
    }
  }
}
