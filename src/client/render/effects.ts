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
  shape: 'square' | 'circle' | 'feather' | 'spark';
}

/** Short spiky flash at the point of impact. */
interface Impact {
  x: number;
  y: number;
  angle: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
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
  private impacts: Impact[] = [];
  private shakeAmount = 0;
  /** Direction of the current shake (unit vector), 0,0 for random shake. */
  private shakeDirX = 0;
  private shakeDirY = 0;
  private shakeTime = 0;
  /** Time of last hit per player id, for the white flash. */
  readonly lastHitAt = new Map<number, number>();
  readonly barricadeShakeUntil = new Map<number, number>();

  handleEvent(event: GameEvent, players: readonly PlayerState[], localPlayerId: number, time: number): void {
    switch (event.type) {
      case 'hit': {
        this.lastHitAt.set(event.targetId, time);
        const attacker = players[event.attackerId];
        const angle = attacker ? Math.atan2(event.y - attacker.y, event.x - attacker.x) : Math.random() * Math.PI * 2;
        // The hit lands between the two bodies, toward the attacker.
        const hitX = event.x - Math.cos(angle) * 8;
        const hitY = event.y - Math.sin(angle) * 8;
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
        const big = event.amount >= 20;
        this.burst(event.x, event.y, event.weapon === 'pillow' ? 16 : 8, colors[event.weapon], 170, event.weapon === 'pillow' ? 'feather' : 'square');
        this.sparks(hitX, hitY, angle, big ? 10 : 6, event.weapon === 'pillow' ? '#ffffff' : '#fff3c4');
        this.impact(hitX, hitY, angle, big ? 22 : 15, event.weapon === 'pan' ? '#ffe680' : '#ffffff');
        this.ring(event.x, event.y, event.weapon === 'pan' ? 34 : 22, '#ffffff');
        this.text(event.x + (Math.random() - 0.5) * 10, event.y - 18, `-${event.amount}`, big ? '#ff4d4d' : '#ffe066', big ? 20 : 15);
        if (event.weapon === 'pan') this.text(event.x, event.y - 38, 'BONG !', '#ffd84a', 18);
        if (event.stunned && event.weapon === 'pillow') this.text(event.x, event.y - 38, 'PAF !', '#ffffff', 15);
        if (event.targetId === localPlayerId) this.shake(big ? 9 : 5, angle);
        else if (event.attackerId === localPlayerId) this.shake(big ? 4 : 2.5, angle);
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

  /** Fast streaks thrown out in the direction of the blow. */
  private sparks(x: number, y: number, angle: number, count: number, color: string): void {
    for (let i = 0; i < count; i++) {
      const spread = angle + (Math.random() - 0.5) * 1.3;
      const velocity = 260 + Math.random() * 200;
      const life = 0.14 + Math.random() * 0.12;
      this.particles.push({
        x,
        y,
        vx: Math.cos(spread) * velocity,
        vy: Math.sin(spread) * velocity,
        life,
        maxLife: life,
        size: 1.6 + Math.random() * 1.2,
        color,
        gravity: 0,
        spin: 0,
        shape: 'spark',
      });
    }
  }

  private impact(x: number, y: number, angle: number, size: number, color: string): void {
    this.impacts.push({ x, y, angle, size, color, life: 0.12, maxLife: 0.12 });
  }

  private text(x: number, y: number, text: string, color: string, size: number): void {
    this.texts.push({ x, y, text, color, life: 0.9, maxLife: 0.9, size });
  }

  private ring(x: number, y: number, radius: number, color: string): void {
    this.rings.push({ x, y, radius, color, life: 0.3, maxLife: 0.3 });
  }

  /** Shakes the screen; with an angle the shake kicks along the blow first, then wobbles. */
  shake(amount: number, angle?: number): void {
    if (amount < this.shakeAmount) return;
    this.shakeAmount = amount;
    this.shakeTime = 0;
    this.shakeDirX = angle === undefined ? 0 : Math.cos(angle);
    this.shakeDirY = angle === undefined ? 0 : Math.sin(angle);
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
    for (const impact of this.impacts) impact.life -= dt;
    this.impacts = this.impacts.filter((impact) => impact.life > 0);

    this.shakeTime += dt;
    let offset: { x: number; y: number };
    if (this.shakeDirX !== 0 || this.shakeDirY !== 0) {
      // Damped oscillation along the blow direction, plus a little noise.
      const wave = Math.cos(this.shakeTime * 55) * this.shakeAmount * 0.8;
      offset = {
        x: this.shakeDirX * wave + (Math.random() - 0.5) * this.shakeAmount * 0.3,
        y: this.shakeDirY * wave + (Math.random() - 0.5) * this.shakeAmount * 0.3,
      };
    } else {
      offset = { x: (Math.random() - 0.5) * this.shakeAmount, y: (Math.random() - 0.5) * this.shakeAmount };
    }
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
    for (const impact of this.impacts) {
      const t = 1 - impact.life / impact.maxLife;
      ctx.save();
      ctx.translate(impact.x, impact.y);
      ctx.rotate(impact.angle);
      ctx.globalAlpha = 1 - t * 0.6;
      const size = impact.size * (0.7 + t * 0.5);
      ctx.beginPath();
      const points = 8;
      for (let i = 0; i < points * 2; i++) {
        const a = (i / (points * 2)) * Math.PI * 2;
        // Longer spikes forward, along the blow.
        const forward = 1 + Math.max(0, Math.cos(a)) * 0.6;
        const radius = i % 2 === 0 ? size * forward : size * 0.38;
        ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius * 0.8);
      }
      ctx.closePath();
      ctx.fillStyle = impact.color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(40,20,10,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    for (const particle of this.particles) {
      ctx.globalAlpha = Math.min(1, (particle.life / particle.maxLife) * 1.5);
      ctx.fillStyle = particle.color;
      if (particle.shape === 'spark') {
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x - particle.vx * 0.035, particle.y - particle.vy * 0.035);
        ctx.strokeStyle = particle.color;
        ctx.lineWidth = particle.size;
        ctx.lineCap = 'round';
        ctx.stroke();
      } else if (particle.shape === 'circle') {
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
      // Pop in with a small overshoot, then settle.
      const age = 1 - t;
      const scale = age < 0.12 ? 0.6 + (age / 0.12) * 0.75 : age < 0.25 ? 1.35 - ((age - 0.12) / 0.13) * 0.35 : 1;
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
    this.impacts = [];
    this.shakeAmount = 0;
    this.lastHitAt.clear();
    this.barricadeShakeUntil.clear();
  }
}
