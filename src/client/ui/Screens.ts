/** Full-screen menus: main menu with character select, controls, pause, elimination, end of match. */
import { CHARACTERS, getCharacter, PREPARATION_PRESETS } from '../../shared/constants';
import type { PlayerState } from '../../shared/types';
import type { SoundEffects } from '../audio/SoundEffects';
import { drawCharacterPortrait } from '../render/characterArt';

export interface MatchSettings {
  playerName: string;
  characterId: string;
  preparationSeconds: number;
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

  showMainMenu(defaults: MatchSettings, onPlay: (settings: MatchSettings) => void): void {
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
          <div class="field">
            <span>Durée de la préparation</span>
            <div class="segments">${presets}</div>
          </div>
          <div class="menu-actions">
            <button id="play-offline" class="button primary">Jouer hors ligne · 3 bots</button>
            <button id="show-controls" class="button ghost">Contrôles et règles</button>
          </div>
          <p class="menu-note">Multijoueur en ligne à 4 (salon, code d'invitation) : prévu dans la version 0.3.</p>
        </section>
      </div>`,
      'main-menu',
    );

    const nameInput = this.root.querySelector<HTMLInputElement>('#player-name');
    if (!nameInput) return;
    nameInput.value = settings.playerName;
    nameInput.addEventListener('input', () => (settings.playerName = nameInput.value));

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

    this.bind('#play-offline', () => {
      const name = settings.playerName.trim().slice(0, 14);
      onPlay({ ...settings, playerName: name.length > 0 ? name : 'Joueur' });
    });
    this.bind('#show-controls', () => this.showControls(() => this.showMainMenu(settings, onPlay)));

    const animate = (timestamp: number): void => {
      cards.forEach((card, index) => {
        const canvas = card.querySelector('canvas');
        if (canvas) drawCharacterPortrait(canvas, CHARACTERS[index], timestamp / 1000 + index);
      });
      this.animationFrame = requestAnimationFrame(animate);
    };
    this.animationFrame = requestAnimationFrame(animate);
  }

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
            <li><kbd>Échap</kbd><span>Pause</span> </li>
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
          <div class="menu-actions"><button id="controls-back" class="button primary">Retour</button></div>
        </section>
      </div>`,
      'controls-screen',
    );
    this.bind('#controls-back', onBack);
  }

  showPause(handlers: { onResume: () => void; onRestart: () => void; onMenu: () => void; onToggleMute: () => boolean }): void {
    this.mount(
      `
      <div class="menu-shell narrow">
        <section class="menu-card center">
          <h2>Pause</h2>
          <div class="menu-actions column">
            <button id="pause-resume" class="button primary">Reprendre</button>
            <button id="pause-restart" class="button">Recommencer la partie</button>
            <button id="pause-mute" class="button ghost">${this.sounds.muted ? 'Activer le son' : 'Couper le son'}</button>
            <button id="pause-menu" class="button ghost">Menu principal</button>
          </div>
        </section>
      </div>`,
      'overlay-screen',
    );
    this.bind('#pause-resume', handlers.onResume);
    this.bind('#pause-restart', handlers.onRestart);
    this.bind('#pause-menu', handlers.onMenu);
    this.bind('#pause-mute', () => {
      const muted = handlers.onToggleMute();
      const button = this.root.querySelector('#pause-mute');
      if (button) button.textContent = muted ? 'Activer le son' : 'Couper le son';
    });
  }

  showEliminated(killerName: string | null, handlers: { onSpectate: () => void; onRestart: () => void; onMenu: () => void }): void {
    this.mount(
      `
      <div class="menu-shell narrow">
        <section class="menu-card center defeat">
          <div class="result-title">ÉLIMINÉ</div>
          <p>${killerName ? `${escapeHtml(killerName)} vous a sorti de la maison.` : 'Personne ne vous a réanimé à temps.'}</p>
          <div class="menu-actions column">
            <button id="elim-spectate" class="button primary">Regarder la fin</button>
            <button id="elim-restart" class="button">Rejouer</button>
            <button id="elim-menu" class="button ghost">Menu principal</button>
          </div>
        </section>
      </div>`,
      'overlay-screen',
    );
    this.bind('#elim-spectate', handlers.onSpectate);
    this.bind('#elim-restart', handlers.onRestart);
    this.bind('#elim-menu', handlers.onMenu);
  }

  showGameOver(info: EndOfMatchInfo, handlers: { onRestart: () => void; onMenu: () => void }): void {
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
            <button id="over-restart" class="button primary">Rejouer</button>
            <button id="over-menu" class="button ghost">Menu principal</button>
          </div>
        </section>
      </div>`,
      'overlay-screen',
    );
    this.bind('#over-restart', handlers.onRestart);
    this.bind('#over-menu', handlers.onMenu);
  }
}
