/** In-game HUD (DOM overlay): health, phase timer, players, held item, minimap, notifications. */
import { getCharacter, MAX_HEALTH, TILE_SIZE } from '../../shared/constants';
import { ITEM_DEFINITIONS, FIST_STATS } from '../../shared/items/itemDefinitions';
import type { GameSimulation } from '../../shared/simulation/GameSimulation';
import type { ItemKind } from '../../shared/types';
import { drawCharacterPortrait } from '../render/characterArt';
import { createMinimapLayer } from '../render/houseArt';
import { drawItemShape, ITEM_ART_LENGTH } from '../render/itemArt';

export type NotificationTone = 'info' | 'danger' | 'good' | 'chaos';

const MINIMAP_SCALE = 3;

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  parent?.appendChild(element);
  return element;
}

export class Hud {
  private readonly root: HTMLElement;
  private readonly phaseLabel: HTMLElement;
  private readonly phaseTime: HTMLElement;
  private readonly phaseSub: HTMLElement;
  private readonly phaseBox: HTMLElement;
  private readonly portrait: HTMLCanvasElement;
  private readonly selfName: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly healthText: HTMLElement;
  private readonly selfStatus: HTMLElement;
  private readonly playersBox: HTMLElement;
  private readonly itemIcon: HTMLCanvasElement;
  private readonly itemName: HTMLElement;
  private readonly itemStats: HTMLElement;
  private readonly durabilityFill: HTMLElement;
  private readonly durabilityBox: HTMLElement;
  private readonly itemSpecial: HTMLElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly notifications: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly downed: HTMLElement;
  private readonly downedTimer: HTMLElement;
  private readonly downedHint: HTMLElement;
  private readonly networkInfo: HTMLElement;
  private minimapBase: HTMLCanvasElement | null = null;
  private lastItemKey = '';
  private lastPlayersKey = '';
  private bannerTimeout = 0;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud hidden', parent);

    this.phaseBox = el('div', 'hud-phase', this.root);
    this.phaseLabel = el('div', 'phase-label', this.phaseBox);
    this.phaseTime = el('div', 'phase-time', this.phaseBox);
    this.phaseSub = el('div', 'phase-sub', this.phaseBox);

    const self = el('div', 'hud-self panel', this.root);
    this.portrait = el('canvas', 'self-portrait', self);
    this.portrait.width = 112;
    this.portrait.height = 112;
    const selfInfo = el('div', 'self-info', self);
    this.selfName = el('div', 'self-name', selfInfo);
    const healthBar = el('div', 'health-bar', selfInfo);
    this.healthFill = el('div', 'health-fill', healthBar);
    this.healthText = el('span', 'health-text', healthBar);
    this.selfStatus = el('div', 'self-status', selfInfo);

    const rightColumn = el('div', 'hud-right', this.root);
    this.playersBox = el('div', 'hud-players panel', rightColumn);
    this.networkInfo = el('div', 'hud-network hidden', rightColumn);

    const item = el('div', 'hud-item panel', this.root);
    this.itemIcon = el('canvas', 'item-icon', item);
    this.itemIcon.width = 128;
    this.itemIcon.height = 128;
    const itemInfo = el('div', 'item-info', item);
    this.itemName = el('div', 'item-name', itemInfo);
    this.itemStats = el('div', 'item-stats', itemInfo);
    this.durabilityBox = el('div', 'durability', itemInfo);
    this.durabilityFill = el('div', 'durability-fill', this.durabilityBox);
    this.itemSpecial = el('div', 'item-special', itemInfo);

    const keys = el('div', 'hud-keys', this.root);
    keys.innerHTML =
      '<span><kbd>ZQSD</kbd>/<kbd>WASD</kbd> bouger</span><span><kbd>Clic</kbd> frapper</span><span><kbd>E</kbd> ramasser · réanimer</span><span><kbd>G</kbd> lâcher · poser table</span><span>Immobile près d’un meuble : caché</span><span><kbd>Molette</kbd>/<kbd>+</kbd><kbd>-</kbd> zoom</span><span><kbd>Échap</kbd> pause</span>';

    this.minimap = el('canvas', 'hud-minimap panel', this.root);
    this.notifications = el('div', 'hud-notifications', this.root);
    this.banner = el('div', 'hud-banner', this.root);

    this.downed = el('div', 'hud-downed hidden', this.root);
    el('div', 'downed-title', this.downed).textContent = 'VOUS ÊTES K.O.';
    this.downedTimer = el('div', 'downed-timer', this.downed);
    this.downedHint = el('div', 'downed-hint', this.downed);
  }

  show(sim: GameSimulation): void {
    this.root.classList.remove('hidden');
    this.notifications.innerHTML = '';
    this.banner.className = 'hud-banner';
    this.minimapBase = createMinimapLayer(sim.map, MINIMAP_SCALE);
    this.minimap.width = this.minimapBase.width;
    this.minimap.height = this.minimapBase.height;
    this.lastItemKey = '';
    this.lastPlayersKey = '';
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  /** Online status line (room code, ping), or null to hide it. */
  setNetworkInfo(text: string | null): void {
    this.networkInfo.classList.toggle('hidden', text === null);
    if (text !== null && this.networkInfo.textContent !== text) this.networkInfo.textContent = text;
  }

  notify(text: string, tone: NotificationTone = 'info'): void {
    const note = el('div', `note note-${tone}`, this.notifications);
    note.textContent = text;
    while (this.notifications.children.length > 5) this.notifications.firstElementChild?.remove();
    window.setTimeout(() => note.classList.add('fade'), 3600);
    window.setTimeout(() => note.remove(), 4200);
  }

  showBanner(title: string, subtitle: string, tone: NotificationTone): void {
    this.banner.innerHTML = '';
    el('div', 'banner-title', this.banner).textContent = title;
    el('div', 'banner-sub', this.banner).textContent = subtitle;
    this.banner.className = `hud-banner visible banner-${tone}`;
    window.clearTimeout(this.bannerTimeout);
    this.bannerTimeout = window.setTimeout(() => (this.banner.className = 'hud-banner'), 2800);
  }

  update(sim: GameSimulation, localPlayerId: number, time: number): void {
    const local = sim.players[localPlayerId];
    const character = getCharacter(local.characterId);

    // Phase and clock.
    if (sim.phase === 'preparation') {
      this.phaseBox.dataset.phase = 'preparation';
      this.phaseLabel.textContent = 'PRÉPARATION';
      this.phaseTime.textContent = formatClock(sim.phaseTimeRemaining);
      this.phaseSub.textContent = 'Fouillez, armez-vous, barricadez votre chambre';
      this.phaseBox.classList.toggle('urgent', sim.phaseTimeRemaining <= 10);
    } else {
      this.phaseBox.dataset.phase = 'chaos';
      this.phaseLabel.textContent = sim.phase === 'finished' ? 'TERMINÉ' : 'CHAOS';
      this.phaseTime.textContent = formatClock(sim.chaosElapsedSeconds);
      const alive = sim.players.filter((player) => player.life !== 'eliminated').length;
      this.phaseSub.textContent = `${alive} survivant${alive > 1 ? 's' : ''} · le dernier debout gagne`;
      this.phaseBox.classList.remove('urgent');
    }

    // Self.
    drawCharacterPortrait(this.portrait, character, time);
    this.selfName.textContent = local.name;
    this.selfName.style.color = character.accentColor;
    const ratio = local.health / MAX_HEALTH;
    this.healthFill.style.transform = `scaleX(${ratio})`;
    this.healthFill.dataset.level = ratio > 0.5 ? 'high' : ratio > 0.25 ? 'mid' : 'low';
    this.healthText.textContent = `${Math.ceil(local.health)} / ${MAX_HEALTH} PV`;
    let status = '';
    if (local.life === 'eliminated') status = 'Éliminé · mode spectateur';
    else if (local.life === 'downed') status = 'Inconscient';
    else if (local.stunRemaining > 0) status = 'Étourdi !';
    else if (local.revivingTargetId !== null) status = 'Réanimation en cours…';
    this.selfStatus.textContent = status;

    this.updateItem(sim, localPlayerId);
    this.updatePlayers(sim, localPlayerId);
    this.updateMinimap(sim, localPlayerId, time);

    // Downed overlay.
    const isDowned = local.life === 'downed';
    this.downed.classList.toggle('hidden', !isDowned);
    if (isDowned) {
      this.downedTimer.textContent = `${Math.ceil(local.bleedOutRemaining)} s`;
      this.downedHint.textContent =
        local.reviverId !== null
          ? `${sim.players[local.reviverId].name} vous réanime… ${Math.floor((local.reviveProgress / 5) * 100)} %`
          : 'Rampez vers quelqu’un · n’importe qui peut vous réanimer (5 s)';
    }
  }

  private updateItem(sim: GameSimulation, localPlayerId: number): void {
    const local = sim.players[localPlayerId];
    const item = sim.heldItemOf(local);
    const key = item ? `${item.id}:${item.durability}` : 'fists';
    if (key === this.lastItemKey) return;
    this.lastItemKey = key;
    const ctx = this.itemIcon.getContext('2d');
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 128, 128);
      if (item) drawIcon(ctx, item.kind);
      else {
        ctx.font = '64px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👊', 64, 68);
      }
    }
    const stats = item ? ITEM_DEFINITIONS[item.kind] : FIST_STATS;
    this.itemName.textContent = stats.label;
    this.itemStats.innerHTML = `<span>⚔ ${stats.damage}</span><span>↔ ${stats.range}</span><span>⏱ ${stats.cooldownSeconds}s</span>`;
    if (item) {
      const definition = ITEM_DEFINITIONS[item.kind];
      this.durabilityBox.classList.remove('hidden');
      this.durabilityFill.style.transform = `scaleX(${item.durability / definition.maxDurability})`;
      this.durabilityBox.title = `Durabilité ${item.durability}/${definition.maxDurability}`;
      this.itemSpecial.textContent = definition.special;
    } else {
      this.durabilityBox.classList.add('hidden');
      this.itemSpecial.textContent = 'Ramassez un objet de la maison (E)';
    }
  }

  private updatePlayers(sim: GameSimulation, localPlayerId: number): void {
    const key = sim.players
      .map((player) => `${player.life}:${Math.ceil(player.health)}:${Math.ceil(player.bleedOutRemaining)}:${player.stats.kills}`)
      .join('|');
    if (key === this.lastPlayersKey) return;
    this.lastPlayersKey = key;
    this.playersBox.innerHTML = '';
    for (const player of sim.players) {
      const character = getCharacter(player.characterId);
      const row = el('div', `player-row life-${player.life}`, this.playersBox);
      const dot = el('span', 'player-dot', row);
      dot.style.background = character.bodyColor;
      const name = el('span', 'player-name', row);
      name.textContent = player.id === localPlayerId ? `${player.name} (vous)` : player.name;
      const state = el('span', 'player-state', row);
      if (player.life === 'alive') {
        const bar = el('span', 'mini-bar', state);
        const fill = el('span', 'mini-fill', bar);
        fill.style.width = `${(player.health / MAX_HEALTH) * 100}%`;
      } else if (player.life === 'downed') {
        state.textContent = `K.O. ${Math.ceil(player.bleedOutRemaining)}s`;
      } else {
        state.textContent = 'ÉLIMINÉ';
      }
      if (player.stats.kills > 0) {
        const kills = el('span', 'player-kills', row);
        kills.textContent = `☠${player.stats.kills}`;
      }
    }
  }

  private updateMinimap(sim: GameSimulation, localPlayerId: number, time: number): void {
    const ctx = this.minimap.getContext('2d');
    if (!ctx || !this.minimapBase) return;
    ctx.clearRect(0, 0, this.minimap.width, this.minimap.height);
    ctx.drawImage(this.minimapBase, 0, 0);
    const scale = MINIMAP_SCALE / TILE_SIZE;
    for (const item of sim.items) {
      if (item.holderId !== null) continue;
      ctx.fillStyle = item.placed ? '#c98b4a' : 'rgba(255,230,150,0.85)';
      ctx.fillRect(item.x * scale - 1, item.y * scale - 1, item.placed ? 3 : 2, item.placed ? 3 : 2);
    }
    const viewer = sim.players[localPlayerId];
    for (const player of sim.players) {
      if (player.life === 'eliminated' || !sim.canSee(viewer, player)) continue;
      const character = getCharacter(player.characterId);
      ctx.beginPath();
      ctx.arc(player.x * scale, player.y * scale, player.id === localPlayerId ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = player.life === 'downed' ? '#777' : character.bodyColor;
      ctx.fill();
      if (player.id === localPlayerId) {
        ctx.strokeStyle = `rgba(255,255,255,${0.6 + Math.sin(time * 6) * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
}

function drawIcon(ctx: CanvasRenderingContext2D, kind: ItemKind): void {
  const length = ITEM_ART_LENGTH[kind];
  const scale = Math.min(2.6, 96 / length);
  ctx.save();
  ctx.translate(64, 64);
  ctx.rotate(-Math.PI / 4);
  ctx.scale(scale, scale);
  ctx.translate(-length / 2, 0);
  drawItemShape(ctx, kind);
  ctx.restore();
}
