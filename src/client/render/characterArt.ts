/**
 * Top-down character drawing. Characters are drawn facing +X in a local
 * frame and rotated to their aim direction. Walking animates the feet,
 * attacking swings the held item along its arc.
 */
import type { CharacterDefinition } from '../../shared/constants';
import type { ItemKind, LifeState } from '../../shared/types';
import { drawItemShape } from './itemArt';

export interface CharacterPose {
  x: number;
  y: number;
  facing: number;
  walkCycle: number;
  isMoving: boolean;
  life: LifeState;
  heldItem: ItemKind | null;
  /** 0..1 progress of the current swing, or -1 when not swinging. */
  swingProgress: number;
  swingArc: number;
  /** 0..1, white flash after being hit. */
  hitFlash: number;
  stunned: boolean;
  time: number;
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

function drawHead(ctx: CanvasRenderingContext2D, character: CharacterDefinition, x: number, y: number, dizzy: boolean): void {
  // Hair behind the head.
  if (character.hairStyle === 'long') {
    ellipse(ctx, x - 5, y, 8, 8.5);
    ctx.fillStyle = character.hairColor;
    ctx.fill();
  }
  if (character.hairStyle === 'bun') {
    ellipse(ctx, x - 8.5, y, 4, 4);
    ctx.fillStyle = character.hairColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ellipse(ctx, x, y, 7.2, 7.2);
  ctx.fillStyle = character.skinColor;
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,20,20,0.75)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  if (character.hairStyle === 'bald') {
    ellipse(ctx, x - 1.5, y - 2.5, 2.5, 1.6);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
  } else {
    // Hair cap covering the back of the head.
    ctx.beginPath();
    ctx.arc(x - 1.2, y, 7, Math.PI * 0.42, Math.PI * 1.58);
    ctx.closePath();
    ctx.fillStyle = character.hairColor;
    ctx.fill();
    if (character.hairStyle === 'short') {
      ctx.beginPath();
      ctx.moveTo(x + 1, y - 6);
      ctx.lineTo(x + 4, y - 3);
      ctx.lineTo(x + 0.5, y - 2.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Eyes / face hint.
  if (dizzy) {
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + 3.5, y + side * 2.6 - 1.3);
      ctx.lineTo(x + 6, y + side * 2.6 + 1.3);
      ctx.moveTo(x + 6, y + side * 2.6 - 1.3);
      ctx.lineTo(x + 3.5, y + side * 2.6 + 1.3);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#1d1d24';
    ellipse(ctx, x + 4.6, y - 2.6, 1.3, 1.3);
    ctx.fill();
    ellipse(ctx, x + 4.6, y + 2.6, 1.3, 1.3);
    ctx.fill();
  }
}

function drawStars(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  for (let i = 0; i < 3; i++) {
    const angle = time * 4 + (i * Math.PI * 2) / 3;
    const sx = x + Math.cos(angle) * 11;
    const sy = y + Math.sin(angle) * 5 - 16;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(time * 6);
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    for (let p = 0; p < 5; p++) {
      const outer = (p * Math.PI * 2) / 5 - Math.PI / 2;
      const inner = outer + Math.PI / 5;
      ctx.lineTo(Math.cos(outer) * 3.5, Math.sin(outer) * 3.5);
      ctx.lineTo(Math.cos(inner) * 1.5, Math.sin(inner) * 1.5);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

export function drawCharacter(ctx: CanvasRenderingContext2D, character: CharacterDefinition, pose: CharacterPose): void {
  if (pose.life !== 'alive') {
    drawLyingCharacter(ctx, character, pose);
    return;
  }
  const { x, y } = pose;
  // Shadow.
  ellipse(ctx, x + 1.5, y + 4, 13, 9);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(pose.facing);

  // Feet.
  const stride = pose.isMoving ? Math.sin(pose.walkCycle * 1.2) * 4.5 : 0;
  ctx.fillStyle = '#2a2a33';
  ellipse(ctx, stride, -5, 4, 2.8);
  ctx.fill();
  ellipse(ctx, -stride, 5, 4, 2.8);
  ctx.fill();

  // Body / shoulders.
  ellipse(ctx, -1, 0, 8.5, 11.5);
  ctx.fillStyle = character.bodyColor;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,20,0.85)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ellipse(ctx, -2.5, 0, 4, 8);
  ctx.fillStyle = character.accentColor;
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Held item and hands.
  const swinging = pose.swingProgress >= 0;
  let swingAngle = 0;
  if (swinging) {
    const eased = 1 - Math.pow(1 - pose.swingProgress, 3);
    swingAngle = -pose.swingArc / 2 + pose.swingArc * eased;
  }
  if (pose.heldItem) {
    ctx.save();
    ctx.rotate(swinging ? swingAngle : 0.35);
    ctx.translate(6, 0);
    ctx.save();
    const lengthScale = pose.heldItem === 'table' ? 0.75 : 0.85;
    ctx.scale(lengthScale, lengthScale);
    ctx.translate(2, 0);
    drawItemShape(ctx, pose.heldItem);
    ctx.restore();
    // Hand on the grip.
    ellipse(ctx, 1, 0, 3.4, 3.4);
    ctx.fillStyle = character.skinColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,14,20,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    // Free hand.
    ellipse(ctx, 4, -10, 3.2, 3.2);
    ctx.fillStyle = character.skinColor;
    ctx.fill();
    ctx.stroke();
  } else {
    const punch = swinging ? Math.sin(pose.swingProgress * Math.PI) * 9 : 0;
    const armSwing = pose.isMoving ? Math.sin(pose.walkCycle * 1.2) * 2.5 : 0;
    ctx.fillStyle = character.skinColor;
    ctx.strokeStyle = 'rgba(20,14,20,0.7)';
    ctx.lineWidth = 1;
    ellipse(ctx, 5 - armSwing, -10, 3.4, 3.4);
    ctx.fill();
    ctx.stroke();
    ellipse(ctx, 5 + armSwing + punch, 10 - punch * 0.6, 3.4, 3.4);
    ctx.fill();
    ctx.stroke();
  }

  drawHead(ctx, character, 1.5, 0, pose.stunned);

  if (pose.hitFlash > 0) {
    ctx.globalAlpha = pose.hitFlash * 0.7;
    ellipse(ctx, 0, 0, 12, 13);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  if (swinging) {
    // Motion trail along the swing arc.
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(pose.facing);
    ctx.beginPath();
    ctx.arc(0, 0, pose.heldItem === 'broom' ? 44 : 26, -pose.swingArc / 2, swingAngle);
    ctx.strokeStyle = `rgba(255,255,255,${0.45 * (1 - pose.swingProgress)})`;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();
  }
  if (pose.stunned) drawStars(ctx, x, y, pose.time);
}

function drawLyingCharacter(ctx: CanvasRenderingContext2D, character: CharacterDefinition, pose: CharacterPose): void {
  const eliminated = pose.life === 'eliminated';
  ctx.save();
  ctx.globalAlpha = eliminated ? 0.45 : 1;
  ctx.translate(pose.x, pose.y);
  if (!eliminated) {
    // Dust / pain puddle that pulses.
    const pulse = 0.5 + Math.sin(pose.time * 3) * 0.5;
    ellipse(ctx, 0, 2, 20 + pulse * 2, 13 + pulse);
    ctx.fillStyle = 'rgba(160, 20, 30, 0.28)';
    ctx.fill();
  }
  ctx.rotate(pose.facing);
  ellipse(ctx, 1, 3, 17, 9);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();
  // Limbs spread.
  ctx.strokeStyle = eliminated ? '#6d6d78' : character.bodyColor;
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-2, -6);
  ctx.lineTo(6, -15);
  ctx.moveTo(-2, 6);
  ctx.lineTo(7, 14);
  ctx.moveTo(-12, -3);
  ctx.lineTo(-20, -8);
  ctx.moveTo(-12, 3);
  ctx.lineTo(-20, 8);
  ctx.stroke();
  ellipse(ctx, -4, 0, 11, 7.5);
  ctx.fillStyle = eliminated ? '#8a8a96' : character.bodyColor;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,14,20,0.85)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  drawHead(ctx, character, 10, 0, true);
  ctx.restore();
  if (!eliminated) drawStars(ctx, pose.x, pose.y + 4, pose.time * 0.6);
}

/** Small portrait used by menus and the HUD. */
export function drawCharacterPortrait(canvas: HTMLCanvasElement, character: CharacterDefinition, time: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const scale = canvas.width / 40;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawCharacter(ctx, character, {
    x: 20,
    y: 19,
    facing: Math.PI / 2 + Math.sin(time * 1.5) * 0.25,
    walkCycle: time * 6,
    isMoving: true,
    life: 'alive',
    heldItem: null,
    swingProgress: -1,
    swingArc: 0,
    hitFlash: 0,
    stunned: false,
    time,
  });
}
