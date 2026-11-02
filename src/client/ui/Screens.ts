/** Full-screen menus: main menu, online lobby, controls, pause, elimination, end of match. */
import { CHARACTERS, getCharacter, PREPARATION_PRESETS } from '../../shared/constants';
import { INVITE_CODE_LENGTH, type LobbySettings, type LobbyState } from '../../shared/network/protocol';
import type { PlayerState } from '../../shared/types';
import type { SoundEffects } from '../audio/SoundEffects';
import { drawCharacterPortrait } from '../render/characterArt';

export interface MatchSettings {
  playerName: string;
  characterId: string;
  preparationSeconds: number;
}

export interface MainMenuHandlers {
  onPlayOffline: (settings: MatchSettings) => void;
  onCreateRoom: (settings: MatchSettings) => void;
  onJoinRoom: (settings: MatchSettings, code: string) => void;
}

export interface LobbyHandlers {
  onReady: (ready: boolean) => void;
  onCharacter: (characterId: string) => void;
  onSettings: (settings: Partial<LobbySettings>) => void;
  onStart: () => void;
  onLeave: () => void;
  onCopy: (text: string) => void;
  inviteLink: (code: string) => string;
}

export interface EndOfMatchInfo {
  victory: boolean;
  winner: PlayerState | null;
  ranking: PlayerState[];
  localPlayer: PlayerState;
  durationSeconds: number;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`;
}

export class Screens {
  private animationFrame = 0;

  constructor(private readonly root: HTMLElement, private readonly sounds: SoundEffects) {}

  hide(): void {
    cancelAnimationFrame(this.animationFrame);
    this.root.innerHTML = '';
    this.root.className = '';
  }

  private mount(html: string, className: string): HTMLElement {
    this.hide();
    this.root.className = `screen ${className}`;
    this.root.innerHTML = html;
    this.root.querySelectorAll('button').forEach((button) =>
      button.addEventListener('click', () => {
        this.sounds.unlock();
        this.sounds.play('click');
      }),
    );
    return this.root;
  }

  private bind(selector: string, handler: () => void): void {
    const element = this.root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Élément introuvable : ${selector}`);
    element.addEventListener('click', handler);
  }

  private animatePortraits(portraits: { canvas: HTMLCanvasElement | null; index: number }[]): void {
    const animate = (timestamp: number): void => {
      for (const { canvas, index } of portraits) {
        if (canvas) drawCharacterPortrait(canvas, CHARACTERS[index], timestamp / 1000 + index);
      }
      this.animationFrame = requestAnimationFrame(animate);
    };
    this.animationFrame = requestAnimationFrame(animate);
  }

  /** Small message at the bottom of the current screen. */
  toast(text: string, tone: 'info' | 'danger' | 'good' = 'info'): void {
    if (!this.root.className) return;
    const toast = document.createElement('div');
    toast.className = `screen-toast toast-${tone}`;
    toast.textContent = text;
    this.root.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3500);
  }

  // ---------------------------------------------------------------- main menu

  showMainMenu(defaults: MatchSettings, handlers: MainMenuHandlers, options: { inviteCode?: string; error?: string } = {}): void {
    const settings = { ...defaults };
    const characterCards = CHARACTERS.map(
      (character) => `
        <button class="character-card" data-character="${character.id}" style="--character:${character.bodyColor};--accent:${character.accentColor}">
          <canvas width="160" height="160"></canvas>
          <span class="character-name">${character.name}</span>
          <span class="character-tagline">${character.tagline}</span>
        </button>`,
    ).join('');
    const presets = PREPARATION_PRESETS.map(
      (preset) => `<button class="segment" data-seconds="${preset.seconds}">${preset.label}</button>`,
    ).join('');

    this.mount(
      `
      <div class="menu-shell">
        <header class="menu-header">
          <div class="logo">HOUSE<span>OF</span>CHAOS</div>
          <p class="tagline">4 colocataires. 1 maison. Aucune règle.</p>
        </header>
        <section class="menu-card">
          <label class="field">
            <span>Votre pseudo</span>
            <input id="player-name" maxlength="14" autocomplete="off" spellcheck="false" />
          </label>
          <div class="field">
            <span>Choisissez votre personnage</span>
            <div class="character-grid">${characterCards}</div>
          </div>
          <div class="mode-grid">
            <div class="mode-box">
              <h3>En ligne · jusqu'à 4 joueurs</h3>
              <button id="create-room" class="button primary">Créer une partie</button>
              <div class="join-row">
                <input id="invite-code" maxlength="${INVITE_CODE_LENGTH}" placeholder="CODE" autocomplete="off" spellcheck="false" aria-label="Code d'invitation" />
                <button id="join-room" class="button">Rejoindre</button>
              </div>
            </div>
            <div class="mode-box">
              <h3>Hors ligne · contre 3 bots</h3>
              <div class="segments compact">${presets}</div>
              <button id="play-offline" class="button">Jouer hors ligne</button>
            </div>
          </div>
          <p id="menu-error" class="menu-error" role="alert"></p>
          <div class="menu-actions">
            <button id="show-controls" class="button ghost">Contrôles et règles</button>
          </div>
        </section>
      </div>`,
      'main-menu',
    );

    const nameInput = this.root.querySelector<HTMLInputElement>('#player-name');
    const codeInput = this.root.querySelector<HTMLInputElement>('#invite-code');
    const errorBox = this.root.querySelector<HTMLElement>('#menu-error');
    if (!nameInput || !codeInput || !errorBox) return;
    nameInput.value = settings.playerName;
    nameInput.addEventListener('input', () => (settings.playerName = nameInput.value));
    codeInput.value = options.inviteCode ?? '';
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    errorBox.textContent = options.error ?? '';

    const cards = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.character-card'));
    const refreshCards = (): void =>
      cards.forEach((card) => card.classList.toggle('selected', card.dataset.character === settings.characterId));
    cards.forEach((card) =>
      card.addEventListener('click', () => {
        settings.characterId = card.dataset.character ?? settings.characterId;
        refreshCards();
      }),
    );
    refreshCards();

    const segments = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.segment'));
    const refreshSegments = (): void =>
      segments.forEach((segment) =>
        segment.classList.toggle('selected', Number(segment.dataset.seconds) === settings.preparationSeconds),
      );
    segments.forEach((segment) =>
      segment.addEventListener('click', () => {
        settings.preparationSeconds = Number(segment.dataset.seconds);
        refreshSegments();
      }),
    );
    refreshSegments();

    const finalSettings = (): MatchSettings => {
      const name = settings.playerName.trim().slice(0, 14);
      return { ...settings, playerName: name.length > 0 ? name : 'Joueur' };
    };
    this.bind('#play-offline', () => handlers.onPlayOffline(finalSettings()));
    this.bind('#create-room', () => handlers.onCreateRoom(finalSettings()));
    const join = (): void => {
      const code = codeInput.value.trim();
      if (code.length !== INVITE_CODE_LENGTH) {
        errorBox.textContent = `Entrez le code à ${INVITE_CODE_LENGTH} caractères donné par l'hôte.`;
        codeInput.focus();
        return;
      }
      handlers.onJoinRoom(finalSettings(), code);
    };
    this.bind('#join-room', join);
    codeInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') join();
    });
    this.bind('#show-controls', () =>
      this.showControls(() => this.showMainMenu(settings, handlers, { inviteCode: codeInput.value })),
    );
    if (options.inviteCode) codeInput.focus();

    this.animatePortraits(cards.map((card, index) => ({ canvas: card.querySelector('canvas'), index })));
  }

  // ---------------------------------------------------------------- online

  showConnecting(text: string, onCancel: () => void): void {
    this.mount(
      `
      <div class="menu-shell narrow">
        <section class="menu-card center">
          <div class="spinner" aria-hidden="true"></div>
          <h2>${escapeHtml(text)}</h2>
          <div class="menu-actions"><button id="connect-cancel" class="button ghost">Annuler</button></div>
        </section>
      </div>`,
      'controls-screen',
    );
    this.bind('#connect-cancel', onCancel);
  }

  /** Renders (or re-renders) the online lobby. */
  showLobby(lobby: LobbyState, handlers: LobbyHandlers): void {
    const you = lobby.members.find((member) => member.publicId === lobby.yourPublicId);
    const isHost = you?.isHost === true;
    const takenBy = new Map(lobby.members.map((member) => [member.characterId, member]));
    const slots = Array.from({ length: lobby.maxPlayers }, (_, index) => lobby.members[index] ?? null);
    const memberRows = slots
      .map((member) => {
        if (!member) {
          return `<li class="lobby-slot empty"><span class="slot-avatar"></span><span class="slot-name">${
            lobby.settings.fillWithBots ? 'Place libre · un bot jouera ici' : 'Place libre'
          }</span></li>`;
        }
        const character = getCharacter(member.characterId);
        const status = !member.connected
          ? '<span class="tag danger">Déconnecté</span>'
          : member.isHost
            ? '<span class="tag host">Hôte</span>'
            : member.ready
              ? '<span class="tag good">Prêt</span>'
              : '<span class="tag">Pas prêt</span>';
        const isYou = member.publicId === lobby.yourPublicId;
        return `<li class="lobby-slot ${isYou ? 'you' : ''}">
            <canvas class="slot-avatar" width="96" height="96" data-character="${character.id}"></canvas>
            <span class="slot-name">${escapeHtml(member.name)}${isYou ? ' <small>(vous)</small>' : ''}</span>
            <span class="slot-character" style="color:${character.accentColor}">${character.name}</span>
            ${status}
          </li>`;
      })
      .join('');
    const characterButtons = CHARACTERS.map((character) => {
      const owner = takenBy.get(character.id);
      const mine = owner?.publicId === lobby.yourPublicId;
      return `<button class="character-chip ${mine ? 'selected' : ''}" data-character="${character.id}" ${
        owner && !mine ? 'disabled' : ''
      } style="--character:${character.bodyColor}">${character.name}</button>`;
    }).join('');
    const presets = PREPARATION_PRESETS.map(
      (preset) =>
        `<button class="segment ${preset.seconds === lobby.settings.preparationSeconds ? 'selected' : ''}" data-seconds="${preset.seconds}" ${
          isHost ? '' : 'disabled'
        }>${preset.label}</button>`,
    ).join('');
    const connected = lobby.members.filter((member) => member.connected).length;
    const waiting = lobby.members.filter((member) => member.connected && !member.isHost && !member.ready);
    const canStart = !lobby.inMatch && waiting.length === 0 && (lobby.settings.fillWithBots || connected >= 2);
    const startHint = lobby.inMatch
      ? 'Une partie est en cours dans ce salon.'
      : waiting.length > 0
        ? `En attente : ${waiting.map((member) => escapeHtml(member.name)).join(', ')}`
        : !lobby.settings.fillWithBots && connected < 2
          ? 'Il faut au moins 2 joueurs, ou activer les bots.'
          : isHost
            ? 'Tout le monde est prêt !'
            : "En attente du lancement par l'hôte…";

    this.mount(
      `
      <div class="menu-shell">
        <section class="menu-card lobby">
          <div class="lobby-header">
            <div>
              <div class="lobby-label">Code d'invitation</div>
              <div class="invite-code">${escapeHtml(lobby.code)}</div>
            </div>
            <div class="lobby-share">
              <button id="copy-code" class="button ghost">Copier le code</button>
              <button id="copy-link" class="button ghost">Copier le lien</button>
            </div>
          </div>
          <div class="lobby-grid">
            <div>
              <div class="lobby-label">Joueurs ${lobby.members.length}/${lobby.maxPlayers}</div>
              <ul class="lobby-slots">${memberRows}</ul>
            </div>
            <div class="lobby-side">
              <div class="field">
                <span>Votre personnage</span>
                <div class="character-chips">${characterButtons}</div>
              </div>
              <div class="field">
                <span>Préparation ${isHost ? '' : "<small>(choix de l'hôte)</small>"}</span>
                <div class="segments compact">${presets}</div>
              </div>
              <label class="toggle ${isHost ? '' : 'disabled'}">
                <input id="fill-bots" type="checkbox" ${lobby.settings.fillWithBots ? 'checked' : ''} ${isHost ? '' : 'disabled'} />
                <span>Compléter les places libres avec des bots</span>
              </label>
            </div>
          </div>
          <p class="lobby-hint">${startHint}</p>
          <div class="menu-actions">
            ${
              isHost
                ? `<button id="start-match" class="button primary" ${canStart ? '' : 'disabled'}>Lancer la partie</button>`
                : `<button id="toggle-ready" class="button ${you?.ready ? '' : 'primary'}">${you?.ready ? 'Annuler « prêt »' : 'Je suis prêt'}</button>`
            }
            <button id="leave-room" class="button ghost">Quitter le salon</button>
          </div>
        </section>
      </div>`,
      'main-menu',
    );

    this.root.querySelectorAll<HTMLButtonElement>('.character-chip').forEach((chip) =>
      chip.addEventListener('click', () => {
        const id = chip.dataset.character;
        if (id) handlers.onCharacter(id);
      }),
    );
    if (isHost) {
      this.root.querySelectorAll<HTMLButtonElement>('.segment').forEach((segment) =>
        segment.addEventListener('click', () => handlers.onSettings({ preparationSeconds: Number(segment.dataset.seconds) })),
      );
      this.root.querySelector<HTMLInputElement>('#fill-bots')?.addEventListener('change', (event) => {
        handlers.onSettings({ fillWithBots: (event.target as HTMLInputElement).checked });
      });
      this.bind('#start-match', handlers.onStart);
    } else {
      this.bind('#toggle-ready', () => handlers.onReady(!you?.ready));
    }
    this.bind('#leave-room', handlers.onLeave);
    this.bind('#copy-code', () => handlers.onCopy(lobby.code));
    this.bind('#copy-link', () => handlers.onCopy(handlers.inviteLink(lobby.code)));

    const portraits = Array.from(this.root.querySelectorAll<HTMLCanvasElement>('canvas.slot-avatar')).map((canvas) => ({
      canvas,
      index: Math.max(0, CHARACTERS.findIndex((character) => character.id === canvas.dataset.character)),
    }));
    this.animatePortraits(portraits);
  }

  // ---------------------------------------------------------------- shared screens

  showControls(onBack: () => void): void {
    this.mount(
      `
      <div class="menu-shell narrow">
        <section class="menu-card">
          <h2>Contrôles</h2>
          <ul class="controls-list">
            <li><kbd>ZQSD</kbd> / <kbd>WASD</kbd> / flèches<span>Se déplacer</span></li>
            <li><kbd>Souris</kbd><span>Viser</span></li>
            <li><kbd>Clic gauche</kbd> / <kbd>Espace</kbd><span>Frapper</span></li>
            <li><kbd>E</kbd><span>Ramasser · échanger un objet</span></li>
            <li><kbd>E</kbd> maintenu<span>Réanimer un joueur K.O. (5 s)</span></li>
            <li><kbd>G</kbd> / <kbd>Clic droit</kbd><span>Lâcher l'objet · poser la table en barricade</span></li>
            <li><kbd>Molette</kbd><span>Zoom</span></li>
            <li><kbd>Échap</kbd><span>Pause / menu</span></li>
            <li><kbd>M</kbd><span>Couper le son</span></li>
          </ul>
          <h2>Règles</h2>
          <ol class="rules-list">
            <li><b>Préparation</b> : personne ne peut se blesser. Les chambres des autres sont fermées. Fouillez la maison et barricadez votre porte.</li>
            <li><b>Chaos</b> : tout est permis. Entrez chez les autres, cassez les barricades, frappez.</li>
            <li>À 0 PV vous êtes <b>K.O.</b> pendant 30 s. N'importe qui peut vous réanimer (5 s, retour à 35 PV). Les coups sur un joueur K.O. accélèrent son élimination.</li>
            <li>Chaque objet s'use et finit par casser. Chaque chambre cache un <b>passage secret</b> (mur fissuré).</li>
            <li>Le dernier joueur debout gagne.</li>
          </ol>
          <h2>En ligne</h2>
          <ol class="rules-list">
            <li>L'hôte crée la partie et partage le <b>code</b> ou le <b>lien</b>.</li>
            <li>Chaque invité choisit un personnage libre et clique sur « Je suis prêt ».</li>
            <li>L'hôte lance la partie. Les places vides peuvent être jouées par des bots.</li>
            <li>En cas de coupure, un bot vous remplace jusqu'à votre retour (rechargez la page).</li>
          </ol>
          <div class="menu-actions"><button id="controls-back" class="button primary">Retour</button></div>
        </section>
      </div>`,
      'controls-screen',
    );
    this.bind('#controls-back', onBack);
  }

  showPause(handlers: {
    onResume: () => void;
    onRestart: (() => void) | null;
    onMenu: () => void;
    onToggleMute: () => boolean;
    online: boolean;
  }): void {
    this.mount(
      `
      <div class="menu-shell narrow">
        <section class="menu-card center">
          <h2>${handlers.online ? 'Menu' : 'Pause'}</h2>
          ${handlers.online ? '<p class="muted">La partie continue en ligne pendant que ce menu est ouvert.</p>' : ''}
          <div class="menu-actions column">
            <button id="pause-resume" class="button primary">Reprendre</button>
            ${handlers.onRestart ? '<button id="pause-restart" class="button">Recommencer la partie</button>' : ''}
            <button id="pause-mute" class="button ghost">${this.sounds.muted ? 'Activer le son' : 'Couper le son'}</button>
            <button id="pause-menu" class="button ghost">${handlers.online ? 'Quitter la partie' : 'Menu principal'}</button>
          </div>
        </section>
      </div>`,
      'overlay-screen',
    );
    this.bind('#pause-resume', handlers.onResume);
    if (handlers.onRestart) this.bind('#pause-restart', handlers.onRestart);
    this.bind('#pause-menu', handlers.onMenu);
    this.bind('#pause-mute', () => {
      const muted = handlers.onToggleMute();
      const button = this.root.querySelector('#pause-mute');
      if (button) button.textContent = muted ? 'Activer le son' : 'Couper le son';
    });
  }

  showEliminated(
    killerName: string | null,
    handlers: { onSpectate: () => void; onRestart: (() => void) | null; onMenu: () => void; menuLabel: string },
  ): void {
    this.mount(
      `
      <div class="menu-shell narrow">
        <section class="menu-card center defeat">
          <div class="result-title">ÉLIMINÉ</div>
          <p>${killerName ? `${escapeHtml(killerName)} vous a sorti de la maison.` : 'Personne ne vous a réanimé à temps.'}</p>
          <div class="menu-actions column">
            <button id="elim-spectate" class="button primary">Regarder la fin</button>
            ${handlers.onRestart ? '<button id="elim-restart" class="button">Rejouer</button>' : ''}
            <button id="elim-menu" class="button ghost">${handlers.menuLabel}</button>
          </div>
        </section>
      </div>`,
      'overlay-screen',
    );
    this.bind('#elim-spectate', handlers.onSpectate);
    if (handlers.onRestart) this.bind('#elim-restart', handlers.onRestart);
    this.bind('#elim-menu', handlers.onMenu);
  }

  showGameOver(
    info: EndOfMatchInfo,
    handlers: { onRestart: () => void; onMenu: () => void; restartLabel: string; menuLabel: string },
  ): void {
    const rows = info.ranking
      .map((player, index) => {
        const character = getCharacter(player.characterId);
        const isLocal = player.id === info.localPlayer.id;
        return `
          <tr class="${isLocal ? 'local' : ''}">
            <td class="rank">${index + 1}</td>
            <td><span class="player-dot" style="background:${character.bodyColor}"></span>${escapeHtml(player.name)}${player.isBot ? ' <small>bot</small>' : ''}</td>
            <td>${player.stats.kills}</td>
            <td>${Math.round(player.stats.damageDealt)}</td>
            <td>${player.stats.revivesGiven}</td>
            <td>${player.stats.timesDowned}</td>
          </tr>`;
      })
      .join('');
    this.mount(
      `
      <div class="menu-shell narrow">
        <section class="menu-card center ${info.victory ? 'victory' : 'defeat'}">
          <div class="result-title">${info.victory ? 'VICTOIRE !' : 'DÉFAITE'}</div>
          <p>${
            info.victory
              ? 'Vous êtes le dernier debout dans la maison.'
              : info.winner
                ? `${escapeHtml(info.winner.name)} remporte la maison.`
                : 'Personne ne survit au chaos.'
          }</p>
          <p class="muted">Durée de la partie : ${formatDuration(info.durationSeconds)}</p>
          <table class="ranking">
            <thead><tr><th>#</th><th>Joueur</th><th>Élim.</th><th>Dégâts</th><th>Réa.</th><th>K.O.</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="menu-actions">
            <button id="over-restart" class="button primary">${handlers.restartLabel}</button>
            <button id="over-menu" class="button ghost">${handlers.menuLabel}</button>
          </div>
        </section>
      </div>`,
      'overlay-screen',
    );
    this.bind('#over-restart', handlers.onRestart);
    this.bind('#over-menu', handlers.onMenu);
  }
}
