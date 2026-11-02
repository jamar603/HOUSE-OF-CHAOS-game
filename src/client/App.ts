/**
 * Client application.
 *
 * Offline mode: the browser runs the simulation itself with 3 bots (fixed 60 Hz).
 * Online mode: the server runs the simulation; the browser sends its inputs
 * ~30 times per second and draws the snapshots it receives (~20 per second),
 * interpolating positions between them. Both modes share the same rendering,
 * HUD, sounds and event handling.
 */
import { BotController } from '../shared/bots/BotController';
import { NavigationGrid } from '../shared/bots/pathfinding';
import { CHARACTERS, getCharacter, PREPARATION_PRESETS, SIMULATION_TICK_RATE } from '../shared/constants';
import { ITEM_DEFINITIONS } from '../shared/items/itemDefinitions';
import { distance, lerp } from '../shared/math';
import {
  INPUT_SEND_RATE,
  SNAPSHOT_RATE,
  type LobbyState,
  type ServerMessage,
} from '../shared/network/protocol';
import { applySnapshot } from '../shared/network/snapshot';
import { GameSimulation, type PlayerSetup } from '../shared/simulation/GameSimulation';
import { createEmptyInput, type GameEvent, type PlayerInput, type PlayerState } from '../shared/types';
import { SoundEffects, type SoundName } from './audio/SoundEffects';
import { InputController } from './input/InputController';
import { NetworkClient, type ConnectionStatus } from './network/NetworkClient';
import { Renderer } from './render/Renderer';
import { Hud } from './ui/Hud';
import { Screens, type MatchSettings } from './ui/Screens';

const FIXED_DT = 1 / SIMULATION_TICK_RATE;
const SNAPSHOT_INTERVAL_MS = 1000 / SNAPSHOT_RATE;
const INPUT_INTERVAL_MS = 1000 / INPUT_SEND_RATE;
const STORAGE_KEY = 'house-of-chaos.settings.v1';
const SERVER_HELP = 'Serveur de jeu injoignable. Lancez-le avec « npm run dev » (ou « npm start » après un build).';

type AppState = 'menu' | 'connecting' | 'lobby' | 'playing' | 'paused' | 'eliminated' | 'spectating' | 'over';
type Mode = 'offline' | 'online';

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
  private mode: Mode = 'offline';
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
  private inviteCode: string | undefined;

  // Online.
  private readonly network = new NetworkClient();
  private lobby: LobbyState | null = null;
  private snapshotReceivedAt = 0;
  private lastInputSentAt = 0;
  private pendingResume = false;

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
    this.network.onMessage = (message) => this.onServerMessage(message);
    this.network.onStatus = (status) => this.onConnectionStatus(status);
    window.addEventListener('resize', () => this.renderer?.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'offline' && this.state === 'playing') this.togglePause();
    });
    canvas.addEventListener('mousedown', () => this.sounds.unlock());
  }

  start(): void {
    const params = new URLSearchParams(window.location.search);
    this.inviteCode = params.get('room')?.toUpperCase() ?? undefined;
    if (params.has('autostart')) {
      const prep = Number(params.get('prep'));
      this.startOfflineMatch({
        ...this.settings,
        preparationSeconds: params.has('prep') && Number.isFinite(prep) ? prep : this.settings.preparationSeconds,
      });
    } else {
      this.showMainMenu();
      this.tryResumeSession();
    }
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- menus

  private showMainMenu(error?: string): void {
    this.state = 'menu';
    this.mode = 'offline';
    this.input.enabled = false;
    this.hud.hide();
    this.sim = null;
    this.renderer = null;
    const context = this.canvas.getContext('2d');
    context?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const remember = (settings: MatchSettings): void => {
      this.settings = settings;
      saveSettings(settings);
      this.sounds.unlock();
    };
    this.screens.showMainMenu(
      this.settings,
      {
        onPlayOffline: (settings) => {
          remember(settings);
          this.startOfflineMatch(settings);
        },
        onCreateRoom: (settings) => {
          remember(settings);
          this.goOnline('Création du salon…', () =>
            this.network.send({ type: 'createRoom', name: settings.playerName, characterId: settings.characterId }),
          );
        },
        onJoinRoom: (settings, code) => {
          remember(settings);
          this.inviteCode = code;
          this.goOnline(`Connexion au salon ${code}…`, () =>
            this.network.send({ type: 'joinRoom', code, name: settings.playerName, characterId: settings.characterId }),
          );
        },
      },
      { inviteCode: this.inviteCode, error },
    );
  }

  // ---------------------------------------------------------------- online flow

  /** After a page refresh, silently try to get back into the previous room. */
  private tryResumeSession(): void {
    try {
      if (!window.sessionStorage.getItem('house-of-chaos.session')) return;
    } catch {
      return;
    }
    this.pendingResume = true;
    this.network.connect().catch(() => {
      this.pendingResume = false;
    });
  }

  private goOnline(text: string, action: () => void): void {
    this.state = 'connecting';
    this.mode = 'online';
    this.screens.showConnecting(text, () => this.leaveOnline());
    this.network
      .connect()
      .then(() => {
        if (this.state === 'connecting') action();
      })
      .catch(() => {
        if (this.mode === 'online') this.showMainMenu(SERVER_HELP);
      });
  }

  private leaveOnline(): void {
    if (this.lobby) this.network.send({ type: 'leaveRoom' });
    this.lobby = null;
    window.setTimeout(() => this.network.close(), 100);
    this.network.forgetSession();
    this.showMainMenu();
  }

  private showLobbyScreen(): void {
    if (!this.lobby) return;
    this.state = 'lobby';
    this.mode = 'online';
    this.input.enabled = false;
    this.hud.hide();
    this.sim = null;
    this.renderer = null;
    this.screens.showLobby(this.lobby, {
      onReady: (ready) => this.network.send({ type: 'setReady', ready }),
      onCharacter: (characterId) => {
        this.settings = { ...this.settings, characterId };
        saveSettings(this.settings);
        this.network.send({ type: 'setCharacter', characterId });
      },
      onSettings: (settings) => this.network.send({ type: 'setSettings', settings }),
      onStart: () => this.network.send({ type: 'startMatch' }),
      onLeave: () => this.leaveOnline(),
      onCopy: (text) => {
        navigator.clipboard
          ?.writeText(text)
          .then(() => this.screens.toast('Copié !', 'good'))
          .catch(() => this.screens.toast(text, 'info'));
      },
      inviteLink: (code) => `${window.location.origin}${window.location.pathname}?room=${code}`,
    });
  }

  private onConnectionStatus(status: ConnectionStatus): void {
    if (this.mode !== 'online') return;
    if (status === 'reconnecting') {
      if (this.sim) this.hud.notify('Connexion perdue · reconnexion…', 'danger');
      else this.screens.toast('Connexion perdue · reconnexion…', 'danger');
    } else if (status === 'closed' && this.state !== 'menu') {
      this.lobby = null;
      this.showMainMenu(SERVER_HELP);
    }
  }

  private onServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
        if (this.pendingResume) {
          this.pendingResume = false;
          if (message.resumed) this.mode = 'online';
          else this.network.close();
        }
        return;
      case 'lobby': {
        const wasInLobby = this.lobby !== null;
        this.lobby = message.lobby;
        this.inviteCode = message.lobby.code;
        if (this.state === 'menu' || this.state === 'connecting' || this.state === 'lobby') {
          if (!wasInLobby && this.state === 'menu') this.mode = 'online';
          if (this.mode === 'online') this.showLobbyScreen();
        }
        return;
      }
      case 'leftRoom':
        this.lobby = null;
        this.network.close();
        this.network.forgetSession();
        if (this.mode === 'online') this.showMainMenu(message.reason);
        return;
      case 'matchStart':
        this.startOnlineMatch(message.localPlayerId, message.players, message.preparationSeconds);
        return;
      case 'snapshot':
        this.applyServerSnapshot(message.snapshot, message.events);
        return;
      case 'notice':
        if (this.sim && this.mode === 'online') this.hud.notify(message.text, message.tone);
        else this.screens.toast(message.text, message.tone);
        return;
      case 'error':
        if (this.state === 'connecting') {
          this.lobby = null;
          this.network.close();
          this.showMainMenu(message.message);
        } else if (this.sim) {
          this.hud.notify(message.message, 'danger');
        } else {
          this.screens.toast(message.message, 'danger');
        }
        return;
      case 'pong':
        return;
    }
  }

  private startOnlineMatch(localPlayerId: number, players: PlayerSetup[], preparationSeconds: number): void {
    this.mode = 'online';
    this.screens.hide();
    this.localPlayerId = localPlayerId;
    // Mirror simulation: never stepped here, only overwritten by server snapshots.
    this.sim = new GameSimulation(players, { preparationSeconds, seed: 1 });
    this.bots = [];
    this.renderer = new Renderer(this.canvas, this.sim);
    this.beginMatchPresentation(this.sim, preparationSeconds);
  }

  private applyServerSnapshot(snapshot: Parameters<typeof applySnapshot>[1], events: GameEvent[]): void {
    const sim = this.sim;
    const renderer = this.renderer;
    if (this.mode !== 'online' || !sim || !renderer) return;
    for (const player of sim.players) this.previousPositions.set(player.id, { x: player.x, y: player.y });
    applySnapshot(sim, snapshot);
    this.snapshotReceivedAt = performance.now();
    for (const event of events) this.handleEvent(sim, renderer, event);
    this.announceCountdown(sim);
  }

  private sendNeutralInput(): void {
    if (this.mode !== 'online' || !this.sim) return;
    this.network.send({ type: 'input', input: createEmptyInput(this.sim.players[this.localPlayerId].facing) });
  }

  // ---------------------------------------------------------------- offline flow

  private startOfflineMatch(settings: MatchSettings): void {
    this.mode = 'offline';
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
    this.bots = this.sim.players
      .filter((player) => player.isBot)
      .map((player) => new BotController(player.id, grid, seed + player.id * 7919));
    this.renderer = new Renderer(this.canvas, this.sim);
    this.beginMatchPresentation(this.sim, settings.preparationSeconds);
  }

  private beginMatchPresentation(sim: GameSimulation, preparationSeconds: number): void {
    this.spectateTargetId = this.localPlayerId;
    this.accumulator = 0;
    this.snapshotReceivedAt = performance.now();
    this.previousPositions = new Map(sim.players.map((player) => [player.id, { x: player.x, y: player.y }]));
    this.announcedCountdown.clear();
    this.input.reset();
    this.input.enabled = true;
    this.state = 'playing';
    this.hud.show(sim);
    if (preparationSeconds > 0) {
      const duration = preparationSeconds >= 60 ? `${Math.round(preparationSeconds / 60)} min` : `${Math.round(preparationSeconds)} s`;
      this.hud.showBanner('PRÉPARATION', `${duration} pour vous armer et barricader votre chambre`, 'info');
    } else {
      this.hud.showBanner('LE CHAOS COMMENCE !', 'Le dernier debout gagne', 'chaos');
    }
    const room = sim.map.rooms.find((candidate) => candidate.ownerSlot === this.localPlayerId);
    this.hud.notify(`Votre chambre : ${room?.name ?? ''}`, 'info');
  }

  private restartOffline(): void {
    this.startOfflineMatch(this.settings);
  }

  private togglePause(): void {
    if (!this.sim) return;
    if (this.state === 'playing' || this.state === 'spectating') {
      const resumeState = this.state;
      this.state = 'paused';
      this.input.enabled = false;
      this.sendNeutralInput();
      const online = this.mode === 'online';
      this.screens.showPause({
        online,
        onResume: () => this.resume(resumeState),
        onRestart: online ? null : () => this.restartOffline(),
        onMenu: () => (online ? this.leaveOnline() : this.showMainMenu()),
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
      let alpha = 1;
      if (this.mode === 'offline') {
        const simulating = this.state === 'playing' || this.state === 'eliminated' || this.state === 'spectating';
        if (simulating) {
          this.accumulator += dt;
          let steps = 0;
          while (this.accumulator >= FIXED_DT && steps < 6) {
            this.stepOffline(sim, renderer);
            this.accumulator -= FIXED_DT;
            steps++;
          }
          if (steps === 6) this.accumulator = 0;
          alpha = this.accumulator / FIXED_DT;
        }
      } else {
        const now = performance.now();
        if (this.state === 'playing' && now - this.lastInputSentAt >= INPUT_INTERVAL_MS) {
          this.lastInputSentAt = now;
          const local = sim.players[this.localPlayerId];
          const screen = renderer.worldToScreen(local.x, local.y);
          this.network.send({ type: 'input', input: this.input.sample(screen.x, screen.y) });
        }
        alpha = Math.min(1, (now - this.snapshotReceivedAt) / SNAPSHOT_INTERVAL_MS);
      }
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
      this.hud.setNetworkInfo(this.mode === 'online' ? this.networkLabel() : null);
    }
    requestAnimationFrame(this.frame);
  };

  private networkLabel(): string {
    const ping = this.network.pingMs;
    const code = this.lobby?.code ?? '';
    return `En ligne · salon ${code}${ping !== null ? ` · ${ping} ms` : ''}`;
  }

  private cameraTargetId(sim: GameSimulation): number {
    const local = sim.players[this.localPlayerId];
    if (local.life !== 'eliminated') return local.id;
    const current = sim.players[this.spectateTargetId];
    if (current && current.life !== 'eliminated' && current.id !== local.id) return current.id;
    const next = sim.players.find((player) => player.life === 'alive') ?? sim.players.find((player) => player.life === 'downed');
    this.spectateTargetId = next?.id ?? local.id;
    return this.spectateTargetId;
  }

  private stepOffline(sim: GameSimulation, renderer: Renderer): void {
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
        if (event.playerId === localId && sim.phase !== 'finished') this.onLocalEliminated(killer);
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

  private onLocalEliminated(killer: PlayerState | null): void {
    this.state = 'eliminated';
    this.input.enabled = false;
    this.input.reset();
    this.sendNeutralInput();
    const online = this.mode === 'online';
    this.screens.showEliminated(killer?.name ?? null, {
      onSpectate: () => {
        this.screens.hide();
        this.state = 'spectating';
      },
      onRestart: online ? null : () => this.restartOffline(),
      onMenu: () => (online ? this.leaveOnline() : this.showMainMenu()),
      menuLabel: online ? 'Quitter le salon' : 'Menu principal',
    });
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
    const online = this.mode === 'online';
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
        online
          ? {
              restartLabel: 'Retour au salon',
              menuLabel: 'Quitter',
              onRestart: () => this.showLobbyScreen(),
              onMenu: () => this.leaveOnline(),
            }
          : {
              restartLabel: 'Rejouer',
              menuLabel: 'Menu principal',
              onRestart: () => this.restartOffline(),
              onMenu: () => this.showMainMenu(),
            },
      );
    }, 1800);
  }

  /** Debug access from the browser console: `houseOfChaos.debug`. */
  get debug(): { sim: GameSimulation | null; state: AppState; mode: Mode; lobby: LobbyState | null; character: ReturnType<typeof getCharacter> } {
    return { sim: this.sim, state: this.state, mode: this.mode, lobby: this.lobby, character: getCharacter(this.settings.characterId) };
  }
}
