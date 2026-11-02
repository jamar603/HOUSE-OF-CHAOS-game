/**
 * Client application: menus, the offline match loop (simulation + bots),
 * rendering, HUD, sounds. The simulation runs at a fixed 60 Hz; rendering
 * interpolates positions between ticks for smooth motion on any monitor.
 */
import { BotController } from '../shared/bots/BotController';
import { NavigationGrid } from '../shared/bots/pathfinding';
import { CHARACTERS, getCharacter, PREPARATION_PRESETS, SIMULATION_TICK_RATE } from '../shared/constants';
import { ITEM_DEFINITIONS } from '../shared/items/itemDefinitions';
import { distance, lerp } from '../shared/math';
import { GameSimulation, type PlayerSetup } from '../shared/simulation/GameSimulation';
import type { GameEvent, PlayerInput, PlayerState } from '../shared/types';
import { SoundEffects, type SoundName } from './audio/SoundEffects';
import { InputController } from './input/InputController';
import { Renderer } from './render/Renderer';
import { Hud } from './ui/Hud';
import { Screens, type MatchSettings } from './ui/Screens';

const FIXED_DT = 1 / SIMULATION_TICK_RATE;
const STORAGE_KEY = 'house-of-chaos.settings.v1';

type AppState = 'menu' | 'playing' | 'paused' | 'eliminated' | 'spectating' | 'over';

function loadSettings(): MatchSettings {
  const defaults: MatchSettings = {
    playerName: 'Joueur',
    characterId: CHARACTERS[0].id,
    preparationSeconds: PREPARATION_PRESETS[0].seconds,
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<MatchSettings>;
    return {
      playerName: typeof parsed.playerName === 'string' ? parsed.playerName.slice(0, 14) : defaults.playerName,
      characterId: CHARACTERS.some((c) => c.id === parsed.characterId) ? (parsed.characterId as string) : defaults.characterId,
      preparationSeconds: PREPARATION_PRESETS.some((p) => p.seconds === parsed.preparationSeconds)
        ? (parsed.preparationSeconds as number)
        : defaults.preparationSeconds,
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: MatchSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode): settings are simply not remembered.
  }
}

export class App {
  private readonly canvas: HTMLCanvasElement;
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly sounds = new SoundEffects();
  private readonly input: InputController;
  private settings: MatchSettings;
  private state: AppState = 'menu';
  private sim: GameSimulation | null = null;
  private renderer: Renderer | null = null;
  private bots: BotController[] = [];
  private grid: NavigationGrid | null = null;
  private localPlayerId = 0;
  private spectateTargetId = 0;
  private accumulator = 0;
  private lastTimestamp = 0;
  private time = 0;
  private previousPositions = new Map<number, { x: number; y: number }>();
  private lastCombatBlockedNotice = -10;
  private announcedCountdown = new Set<number>();

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, screenRoot: HTMLElement) {
    this.canvas = canvas;
    this.hud = new Hud(hudRoot);
    this.screens = new Screens(screenRoot, this.sounds);
    this.settings = loadSettings();
    this.input = new InputController(canvas, {
      onPause: () => this.togglePause(),
      onToggleMute: () => {
        const muted = this.sounds.toggleMute();
        if (this.sim) this.hud.notify(muted ? 'Son coupé (M)' : 'Son activé (M)');
      },
    });
    window.addEventListener('resize', () => this.renderer?.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.togglePause();
    });
    canvas.addEventListener('mousedown', () => this.sounds.unlock());
  }

  start(): void {
    const params = new URLSearchParams(window.location.search);
    if (params.has('autostart')) {
      const prep = Number(params.get('prep'));
      this.startMatch({ ...this.settings, preparationSeconds: Number.isFinite(prep) && params.has('prep') ? prep : this.settings.preparationSeconds });
    } else {
      this.showMainMenu();
    }
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- flow

  private showMainMenu(): void {
    this.state = 'menu';
    this.input.enabled = false;
    this.hud.hide();
    this.sim = null;
    this.renderer = null;
    const context = this.canvas.getContext('2d');
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.screens.showMainMenu(this.settings, (settings) => {
      this.settings = settings;
      saveSettings(settings);
      this.sounds.unlock();
      this.startMatch(settings);
    });
  }

  private startMatch(settings: MatchSettings): void {
    this.screens.hide();
    const seed = Math.floor(Math.random() * 1_000_000);
    // The human gets a random bedroom; bots take the other characters.
    this.localPlayerId = Math.floor(Math.random() * 4);
    const botCharacters = CHARACTERS.filter((character) => character.id !== settings.characterId);
    const setups: PlayerSetup[] = [];
    for (let slot = 0; slot < 4; slot++) {
      if (slot === this.localPlayerId) {
        setups.push({ name: settings.playerName, characterId: settings.characterId, isBot: false });
      } else {
        const character = botCharacters.shift() ?? CHARACTERS[slot];
        setups.push({ name: character.name, characterId: character.id, isBot: true });
      }
    }
    this.sim = new GameSimulation(setups, { preparationSeconds: settings.preparationSeconds, seed });
    this.grid ??= new NavigationGrid(this.sim.map);
    const grid = this.grid;
    this.bots = this.sim.players.filter((player) => player.isBot).map((player) => new BotController(player.id, grid, seed + player.id * 7919));
    this.renderer = new Renderer(this.canvas, this.sim);
    this.spectateTargetId = this.localPlayerId;
    this.accumulator = 0;
    this.previousPositions = new Map(this.sim.players.map((player) => [player.id, { x: player.x, y: player.y }]));
    this.announcedCountdown.clear();
    this.input.reset();
    this.input.enabled = true;
    this.state = 'playing';
    this.hud.show(this.sim);
    const preparation = settings.preparationSeconds;
    if (preparation > 0) {
      const duration = preparation >= 60 ? `${Math.round(preparation / 60)} min` : `${Math.round(preparation)} s`;
      this.hud.showBanner('PRÉPARATION', `${duration} pour vous armer et barricader votre chambre`, 'info');
    } else {
      this.hud.showBanner('LE CHAOS COMMENCE !', 'Le dernier debout gagne', 'chaos');
    }
    this.hud.notify(`Votre chambre : ${this.sim.map.rooms.find((room) => room.ownerSlot === this.localPlayerId)?.name ?? ''}`, 'info');
  }

  private togglePause(): void {
    if (!this.sim) return;
    if (this.state === 'playing' || this.state === 'spectating') {
      const resumeState = this.state;
      this.state = 'paused';
      this.input.enabled = false;
      this.screens.showPause({
        onResume: () => this.resume(resumeState),
        onRestart: () => this.startMatch(this.settings),
        onMenu: () => this.showMainMenu(),
        onToggleMute: () => this.sounds.toggleMute(),
      });
    } else if (this.state === 'paused') {
      const local = this.sim.players[this.localPlayerId];
      this.resume(local.life === 'eliminated' ? 'spectating' : 'playing');
    }
  }

  private resume(state: AppState): void {
    this.screens.hide();
    this.state = state;
    this.input.reset();
    this.input.enabled = state === 'playing';
    this.lastTimestamp = performance.now();
  }

  // ---------------------------------------------------------------- loop

  private readonly frame = (timestamp: number): void => {
    const dt = Math.min(0.1, Math.max(0, (timestamp - (this.lastTimestamp || timestamp)) / 1000));
    this.lastTimestamp = timestamp;
    this.time += dt;
    const sim = this.sim;
    const renderer = this.renderer;
    if (sim && renderer) {
      const zoomSteps = this.input.consumeZoomSteps();
      if (zoomSteps !== 0) renderer.adjustZoom(zoomSteps);
      const simulating = this.state === 'playing' || this.state === 'eliminated' || this.state === 'spectating';
      if (simulating) {
        this.accumulator += dt;
        let steps = 0;
        while (this.accumulator >= FIXED_DT && steps < 6) {
          this.stepSimulation(sim, renderer);
          this.accumulator -= FIXED_DT;
          steps++;
        }
        if (steps === 6) this.accumulator = 0;
      }
      const alpha = simulating ? this.accumulator / FIXED_DT : 1;
      const positions = new Map<number, { x: number; y: number }>();
      for (const player of sim.players) {
        const previous = this.previousPositions.get(player.id) ?? player;
        positions.set(player.id, { x: lerp(previous.x, player.x, alpha), y: lerp(previous.y, player.y, alpha) });
      }
      renderer.render({
        sim,
        localPlayerId: this.localPlayerId,
        cameraTargetId: this.cameraTargetId(sim),
        time: this.time,
        dt,
        positions,
      });
      this.hud.update(sim, this.localPlayerId, this.time);
    }
    requestAnimationFrame(this.frame);
  };

  private cameraTargetId(sim: GameSimulation): number {
    const local = sim.players[this.localPlayerId];
    if (local.life !== 'eliminated') return local.id;
    const current = sim.players[this.spectateTargetId];
    if (current && current.life !== 'eliminated' && current.id !== local.id) return current.id;
    const next = sim.players.find((player) => player.life === 'alive') ?? sim.players.find((player) => player.life === 'downed');
    this.spectateTargetId = next?.id ?? local.id;
    return this.spectateTargetId;
  }

  private stepSimulation(sim: GameSimulation, renderer: Renderer): void {
    for (const player of sim.players) this.previousPositions.set(player.id, { x: player.x, y: player.y });
    const inputs = new Map<number, PlayerInput>();
    const local = sim.players[this.localPlayerId];
    const screen = renderer.worldToScreen(local.x, local.y);
    inputs.set(local.id, this.input.sample(screen.x, screen.y));
    for (const bot of this.bots) inputs.set(bot.playerId, bot.computeInput(sim, FIXED_DT));
    sim.step(FIXED_DT, inputs);
    for (const event of sim.events) this.handleEvent(sim, renderer, event);
    this.announceCountdown(sim);
  }

  // ---------------------------------------------------------------- events

  private soundAt(name: SoundName, x: number, y: number, sim: GameSimulation): void {
    const listener = sim.players[this.cameraTargetId(sim)];
    const volume = 1 - distance(listener.x, listener.y, x, y) / 750;
    this.sounds.play(name, volume);
  }

  private handleEvent(sim: GameSimulation, renderer: Renderer, event: GameEvent): void {
    renderer.effects.handleEvent(event, sim.players, this.localPlayerId, this.time);
    const localId = this.localPlayerId;
    const name = (player: PlayerState | undefined): string => (player ? (player.id === localId ? 'Vous' : player.name) : '?');
    switch (event.type) {
      case 'swing': {
        const player = sim.players[event.playerId];
        this.soundAt('swing', player.x, player.y, sim);
        return;
      }
      case 'hit': {
        const sound: SoundName = event.weapon === 'pan' ? 'bong' : event.weapon === 'pillow' ? 'pillow' : 'hit';
        this.soundAt(sound, event.x, event.y, sim);
        return;
      }
      case 'combatBlocked':
        if (event.playerId === localId && this.time - this.lastCombatBlockedNotice > 2.5) {
          this.lastCombatBlockedNotice = this.time;
          this.hud.notify('Aucun dégât pendant la préparation !', 'info');
        }
        return;
      case 'itemBroken':
        this.soundAt(event.itemKind === 'bottle' ? 'glass' : 'wood', event.x, event.y, sim);
        if (event.playerId === localId) this.hud.notify(`Votre ${ITEM_DEFINITIONS[event.itemKind].label.toLowerCase()} est cassé(e) !`, 'danger');
        return;
      case 'pickup':
        if (event.playerId === localId) this.sounds.play('pickup');
        return;
      case 'drop':
        if (event.playerId !== localId) return;
        if (event.placed) {
          this.sounds.play('wood');
          this.hud.notify('Barricade posée · E pour la reprendre', 'good');
        } else {
          this.sounds.play('drop');
          if (event.itemKind === 'table') this.hud.notify('Pas de place pour une barricade : table lâchée', 'info');
        }
        return;
      case 'barricadeHit':
      case 'barricadeDestroyed':
        this.soundAt('wood', event.x, event.y, sim);
        return;
      case 'downed': {
        const player = sim.players[event.playerId];
        this.soundAt('down', player.x, player.y, sim);
        if (event.playerId === localId) {
          this.hud.showBanner('K.O. !', '30 secondes pour être réanimé', 'danger');
        } else {
          const attacker = event.attackerId !== null ? sim.players[event.attackerId] : undefined;
          this.hud.notify(`${player.name} est K.O.${attacker ? ` (${name(attacker)})` : ''}`, 'danger');
        }
        return;
      }
      case 'reviveStarted':
        if (event.targetId === localId) this.hud.notify(`${sim.players[event.reviverId].name} vous réanime !`, 'good');
        return;
      case 'revived': {
        const target = sim.players[event.targetId];
        this.soundAt('revive', target.x, target.y, sim);
        this.hud.notify(`${name(sim.players[event.reviverId])} a réanimé ${event.targetId === localId ? 'vous' : target.name}`, 'good');
        return;
      }
      case 'eliminated': {
        const player = sim.players[event.playerId];
        const killer = event.killerId !== null ? sim.players[event.killerId] : null;
        this.soundAt('eliminated', player.x, player.y, sim);
        this.hud.notify(`${player.name} est éliminé${killer ? ` par ${name(killer)}` : ''}`, 'danger');
        if (event.playerId === localId && sim.phase !== 'finished') {
          this.state = 'eliminated';
          this.input.enabled = false;
          this.input.reset();
          this.screens.showEliminated(killer?.name ?? null, {
            onSpectate: () => {
              this.screens.hide();
              this.state = 'spectating';
            },
            onRestart: () => this.startMatch(this.settings),
            onMenu: () => this.showMainMenu(),
          });
        }
        return;
      }
      case 'phaseChanged':
        if (event.phase === 'chaos') {
          this.sounds.play('phase');
          this.hud.showBanner('LE CHAOS COMMENCE !', 'Les chambres sont ouvertes. Tous les coups sont permis.', 'chaos');
        }
        return;
      case 'itemSpawned':
        this.soundAt('pickup', event.x, event.y, sim);
        return;
      case 'matchEnded':
        this.finishMatch(sim, event.winnerId);
        return;
    }
  }

  private announceCountdown(sim: GameSimulation): void {
    if (sim.phase !== 'preparation') return;
    for (const mark of [60, 30, 10, 5, 4, 3, 2, 1]) {
      if (sim.phaseTimeRemaining <= mark && sim.preparationSeconds > mark && !this.announcedCountdown.has(mark)) {
        this.announcedCountdown.add(mark);
        if (mark > 5) this.hud.notify(`Le chaos commence dans ${mark} s !`, 'chaos');
        else this.sounds.play('click');
      }
    }
  }

  private finishMatch(sim: GameSimulation, winnerId: number | null): void {
    const local = sim.players[this.localPlayerId];
    const victory = winnerId === local.id;
    this.sounds.play(victory ? 'victory' : 'defeat');
    this.input.enabled = false;
    this.input.reset();
    this.state = 'over';
    const result = sim.result;
    const winner = winnerId !== null ? sim.players[winnerId] : null;
    if (winner) this.spectateTargetId = winner.id;
    this.hud.showBanner(victory ? 'VICTOIRE !' : 'FIN DE PARTIE', winner ? `${winner.name} est le dernier debout` : '', victory ? 'good' : 'danger');
    window.setTimeout(() => {
      if (this.sim !== sim) return;
      this.screens.showGameOver(
        {
          victory,
          winner,
          localPlayer: local,
          durationSeconds: result?.durationSeconds ?? sim.elapsedSeconds,
          ranking: (result?.ranking ?? sim.players.map((player) => player.id)).map((id) => sim.players[id]),
        },
        { onRestart: () => this.startMatch(this.settings), onMenu: () => this.showMainMenu() },
      );
    }, 1800);
  }

  /** Debug access from the browser console: `houseOfChaos.sim`. */
  get debug(): { sim: GameSimulation | null; state: AppState; character: ReturnType<typeof getCharacter> } {
    return { sim: this.sim, state: this.state, character: getCharacter(this.settings.characterId) };
  }
}
