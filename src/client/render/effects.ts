/** Short-lived visual effects: particles, floating text, impact rings and screen shake. */
import type { GameEvent, PlayerState } from '../../shared/types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  spin: number;
  shape: 'square' | 'circle' | 'feather';
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  maxLife: number;
  radius: number;
  color: string;
}

export class EffectsSystem {
  private particles: Particle[] = [];
  private texts: FloatingText[] = [];
  private rings: Ring[] = [];
  private shakeAmount = 0;
  /** Time of last hit per player id, for the white flash. */
  readonly lastHitAt = new Map<number, number>();
  readonly barricadeShakeUntil = new Map<number, number>();

  handleEvent(event: GameEvent, players: readonly PlayerState[], localPlayerId: number, time: number): void {
    switch (event.type) {
      case 'hit': {
        this.lastHitAt.set(event.targetId, time);
        if (event.finishing) {
          this.burst(event.x, event.y, 8, ['#8b0000', '#c0392b'], 120, 'circle');
          this.text(event.x, event.y - 18, 'ACHÈVEMENT', '#ff5c5c', 13);
          return;
        }
        const colors: Record<string, string[]> = {
          pillow: ['#ffffff', '#f7c8d8'],
          bottle: ['#2ecc71', '#a9f5c4', '#ffffff'],
          pan: ['#ffd84a', '#ffffff', '#9aa0a6'],
          chair: ['#b8743f', '#ffffff'],
          broom: ['#e3bf62', '#ffffff'],
          table: ['#a36a3c', '#ffffff'],
          fists: ['#ffffff', '#ffd1a6'],
        };
        this.burst(event.x, event.y, event.weapon === 'pillow' ? 16 : 10, colors[event.weapon], 170, event.weapon === 'pillow' ? 'feather' : 'square');
        this.ring(event.x, event.y, event.weapon === 'pan' ? 34 : 22, '#ffffff');
        const big = event.amount >= 20;
        this.text(event.x + (Math.random() - 0.5) * 10, event.y - 18, `-${event.amount}`, big ? '#ff4d4d' : '#ffe066', big ? 20 : 15);
        if (event.weapon === 'pan') this.text(event.x, event.y - 38, 'BONG !', '#ffd84a', 18);
        if (event.stunned && event.weapon === 'pillow') this.text(event.x, event.y - 38, 'PAF !', '#ffffff', 15);
        if (event.targetId === localPlayerId) this.shake(event.amount >= 20 ? 9 : 5);
        else if (event.attackerId === localPlayerId) this.shake(event.amount >= 20 ? 4 : 2);
        return;
      }
      case 'barricadeHit':
        this.barricadeShakeUntil.set(event.itemId, time + 0.18);
        this.burst(event.x, event.y, 8, ['#a36a3c', '#5b3517', '#d18f55'], 150, 'square');
        return;
      case 'barricadeDestroyed':
        this.burst(event.x, event.y, 30, ['#a36a3c', '#5b3517', '#d18f55', '#9aa0a6'], 260, 'square');
        this.ring(event.x, event.y, 50, '#ffcc88');
        this.text(event.x, event.y - 20, 'BARRICADE DÉTRUITE', '#ffb366', 14);
        this.shake(4);
        return;
      case 'itemBroken': {
        const colors: Record<string, string[]> = {
          bottle: ['#2ecc71', '#a9f5c4', '#ffffff'],
          pillow: ['#ffffff', '#f7c8d8'],
        };
        this.burst(event.x, event.y, 20, colors[event.itemKind] ?? ['#a36a3c', '#5b3517', '#cccccc'], 220, event.itemKind === 'pillow' ? 'feather' : 'square');
        this.text(event.x, event.y - 30, 'CASSÉ !', '#ff9f43', 15);
        return;
      }
      case 'downed': {
        const player = players[event.playerId];
        this.burst(player.x, player.y, 18, ['#ffffff', '#ffd84a'], 200, 'circle');
        this.ring(player.x, player.y, 60, '#ff4d4d');
        this.text(player.x, player.y - 30, 'K.O. !', '#ff4d4d', 22);
        if (event.playerId === localPlayerId) this.shake(12);
        return;
      }
      case 'revived': {
        const player = players[event.targetId];
        this.burst(player.x, player.y, 22, ['#7dffb3', '#ffffff'], 140, 'circle');
        this.ring(player.x, player.y, 50, '#7dffb3');
        this.text(player.x, player.y - 30, 'RÉANIMÉ', '#7dffb3', 18);
        return;
      }
      case 'eliminated': {
        const player = players[event.playerId];
        this.burst(player.x, player.y, 30, ['#9b59b6', '#ffffff', '#2c2c2c'], 220, 'circle');
        this.ring(player.x, player.y, 70, '#c39bd3');
        this.text(player.x, player.y - 30, 'ÉLIMINÉ', '#c39bd3', 20);
        return;
      }
      case 'itemSpawned':
        this.ring(event.x, event.y, 26, '#ffe8a3');
        this.burst(event.x, event.y, 8, ['#fff2b3', '#ffffff'], 70, 'circle');
        return;
      default:
        return;
    }
  }

  private burst(x: number, y: number, count: number, colors: string[], speed: number, shape: Particle['shape']): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = speed * (0.3 + Math.random() * 0.7);
      const life = shape === 'feather' ? 0.9 + Math.random() * 0.6 : 0.35 + Math.random() * 0.35;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life,
        maxLife: life,
        size: shape === 'feather' ? 4 : 2 + Math.random() * 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        gravity: shape === 'feather' ? 20 : 0,
        spin: (Math.random() - 0.5) * 10,
        shape,
      });
    }
  }

  private text(x: number, y: number, text: string, color: string, size: number): void {
    this.texts.push({ x, y, text, color, life: 0.9, maxLife: 0.9, size });
  }

  private ring(x: number, y: number, radius: number, color: string): void {
    this.rings.push({ x, y, radius, color, life: 0.3, maxLife: 0.3 });
  }

  shake(amount: number): void {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
  }

  /** Returns the camera offset for this frame. */
  update(dt: number): { x: number; y: number } {
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      const drag = particle.shape === 'feather' ? 3.5 : 6;
      particle.vx *= Math.exp(-drag * dt);
      particle.vy = particle.vy * Math.exp(-drag * dt) + particle.gravity * dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
    for (const text of this.texts) {
      text.life -= dt;
      text.y -= 34 * dt;
    }
    this.texts = this.texts.filter((text) => text.life > 0);
    for (const ring of this.rings) ring.life -= dt;
    this.rings = this.rings.filter((ring) => ring.life > 0);

    const offset = { x: (Math.random() - 0.5) * this.shakeAmount, y: (Math.random() - 0.5) * this.shakeAmount };
    this.shakeAmount *= Math.exp(-12 * dt);
    if (this.shakeAmount < 0.1) this.shakeAmount = 0;
    return offset;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const ring of this.rings) {
      const t = 1 - ring.life / ring.maxLife;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius * (0.3 + t * 0.7), 0, Math.PI * 2);
      ctx.strokeStyle = ring.color;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.stroke();
    }
    for (const particle of this.particles) {
      ctx.globalAlpha = Math.min(1, (particle.life / particle.maxLife) * 1.5);
      ctx.fillStyle = particle.color;
      if (particle.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.save();
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.spin * (particle.maxLife - particle.life));
        if (particle.shape === 'feather') {
          ctx.beginPath();
          ctx.ellipse(0, 0, particle.size * 1.6, particle.size * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
        }
        ctx.restore();
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const text of this.texts) {
      const t = text.life / text.maxLife;
      ctx.globalAlpha = Math.min(1, t * 2);
      const scale = t > 0.8 ? 1 + (t - 0.8) * 2 : 1;
      ctx.font = `900 ${Math.round(text.size * scale)}px "Lilita One", Nunito, sans-serif`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(20,10,20,0.9)';
      ctx.strokeText(text.text, text.x, text.y);
      ctx.fillStyle = text.color;
      ctx.fillText(text.text, text.x, text.y);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.shakeAmount = 0;
    this.lastHitAt.clear();
    this.barricadeShakeUntil.clear();
  }
}
