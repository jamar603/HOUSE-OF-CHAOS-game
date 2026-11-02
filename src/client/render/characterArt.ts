/**
 * Top-down character drawing. Characters are drawn facing +X in a local
 * frame (+Y is their right side) and rotated to their aim direction.
 *
 * Walking animates feet, arms and a small body bob. Attacks use three phases
 * (wind-up, strike, recovery) with a body twist, a forward lunge and a smear
 * arc, so hits read clearly even when four players fight at once.
 */
import type { CharacterDefinition } from '../../shared/constants';
import type { ItemKind, LifeState } from '../../shared/types';
import { ITEM_ART_LENGTH, drawItemShape } from './itemArt';

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
  /** Overall opacity (hidden players are drawn faded for themselves). */
  alpha?: number;
}

const OUTLINE = 'rgba(22,14,24,0.9)';
const SHOE = '#26232e';
/** Resting angle of a held item: pointing forward and slightly to the right. */
const HELD_REST_ANGLE = 0.35;
const RIGHT_SHOULDER = { x: -1, y: 9 };
const LEFT_SHOULDER = { x: -1, y: -9 };

// ---------------------------------------------------------------- helpers

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb color. */
function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => {
    const c = (value >> shift) & 255;
    const target = amount > 0 ? 255 : 0;
    return Math.round(c + (target - c) * Math.abs(amount));
  };
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number): number => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------------------------------------------------------------- swing timing

interface SwingPose {
  /** Angle of the weapon arm around the body. */
  angle: number;
  /** Forward body offset (world px). */
  lunge: number;
  /** Torso rotation that follows the strike. */
  twist: number;
  /** Smear arc between these angles, alpha 0 = no smear. */
  smearFrom: number;
  smearTo: number;
  smearAlpha: number;
}

const WINDUP_END = 0.18;
const STRIKE_END = 0.5;

function weaponSwing(progress: number, arc: number): SwingPose {
  const start = -arc / 2 - 0.3;
  const end = arc / 2 + 0.2;
  if (progress < WINDUP_END) {
    // Anticipation: pull the weapon back.
    const t = easeOutCubic(progress / WINDUP_END);
    const angle = lerp(HELD_REST_ANGLE, start, t);
    return { angle, lunge: -1.5 * t, twist: -0.18 * t, smearFrom: 0, smearTo: 0, smearAlpha: 0 };
  }
  if (progress < STRIKE_END) {
    // Strike: fast, overshooting a little past the arc.
    const t = (progress - WINDUP_END) / (STRIKE_END - WINDUP_END);
    const angle = lerp(start, end, easeOutBack(t));
    return { angle, lunge: Math.sin(t * Math.PI) * 4, twist: lerp(-0.18, 0.22, t), smearFrom: start, smearTo: angle, smearAlpha: 0.6 };
  }
  // Recovery: settle back to rest while the smear tail fades.
  const t = (progress - STRIKE_END) / (1 - STRIKE_END);
  const angle = lerp(end, HELD_REST_ANGLE, easeInOut(t));
  const tail = clamp01(t / 0.45);
  return {
    angle,
    lunge: 0,
    twist: lerp(0.22, 0, easeInOut(t)),
    smearFrom: lerp(start, end, easeOutCubic(tail)),
    smearTo: end,
    smearAlpha: 0.6 * (1 - tail),
  };
}

interface PunchPose {
  /** How far the punching fist goes forward (px). */
  reach: number;
  lunge: number;
  twist: number;
  /** 0..1 strength of the speed lines. */
  streak: number;
}

function punch(progress: number): PunchPose {
  if (progress < 0.2) {
    const t = easeOutCubic(progress / 0.2);
    return { reach: -3 * t, lunge: -1 * t, twist: -0.15 * t, streak: 0 };
  }
  if (progress < 0.45) {
    const t = (progress - 0.2) / 0.25;
    return { reach: lerp(-3, 13, easeOutBack(t)), lunge: Math.sin(t * Math.PI) * 3.5, twist: lerp(-0.15, 0.25, t), streak: 1 - t * 0.4 };
  }
  const t = (progress - 0.45) / 0.55;
  return { reach: lerp(13, 0, easeInOut(t)), lunge: 0, twist: lerp(0.25, 0, t), streak: Math.max(0, 0.6 - t * 2) };
}

// ---------------------------------------------------------------- body parts

function drawFeet(ctx: CanvasRenderingContext2D, stride: number): void {
  ctx.fillStyle = SHOE;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  for (const [side, offset] of [[-1, stride], [1, -stride]] as const) {
    ellipse(ctx, offset + 1, side * 5.2, 4.6, 3);
    ctx.fill();
    ctx.stroke();
  }
}

/** An arm from a shoulder to a hand, drawn as a sleeve with an outline, plus the hand. */
function drawArm(
  ctx: CanvasRenderingContext2D,
  shoulder: { x: number; y: number },
  hand: { x: number; y: number },
  sleeve: string,
  skin: string,
): void {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(hand.x, hand.y);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 6.6;
  ctx.stroke();
  ctx.strokeStyle = sleeve;
  ctx.lineWidth = 4.4;
  ctx.stroke();
  ellipse(ctx, hand.x, hand.y, 3.5, 3.5);
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function sleeveColor(character: CharacterDefinition): string {
  return character.outfit === 'tank' ? character.skinColor : shade(character.bodyColor, -0.12);
}

function drawTorso(ctx: CanvasRenderingContext2D, character: CharacterDefinition, breathe: number): void {
  const body = character.bodyColor;
  const rx = 8.2;
  const ry = 11.8 + breathe;

  // Hood sits behind the shoulders.
  if (character.outfit === 'hoodie') {
    ellipse(ctx, -7.5, 0, 4.5, 7.5);
    ctx.fillStyle = shade(body, -0.25);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  ellipse(ctx, -1, 0, rx, ry);
  ctx.fillStyle = body;
  ctx.fill();

  // Details clipped to the torso.
  ctx.save();
  ellipse(ctx, -1, 0, rx, ry);
  ctx.clip();
  switch (character.outfit) {
    case 'overalls': {
      ctx.fillStyle = '#35507a';
      ctx.fillRect(-10, -5.5, 20, 11);
      ctx.fillStyle = '#4a6a9c';
      ctx.fillRect(-10, -3.5, 2.2, 7);
      ctx.fillStyle = '#ffd54a';
      ellipse(ctx, 4.5, -3.2, 1, 1);
      ctx.fill();
      ellipse(ctx, 4.5, 3.2, 1, 1);
      ctx.fill();
      break;
    }
    case 'hoodie': {
      ctx.strokeStyle = shade(body, 0.55);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(3, -2.5);
      ctx.lineTo(7, -3);
      ctx.moveTo(3, 2.5);
      ctx.lineTo(7, 3);
      ctx.stroke();
      ctx.fillStyle = shade(body, -0.15);
      ctx.fillRect(-3, -6, 2, 12);
      break;
    }
    case 'tank': {
      ctx.fillStyle = character.skinColor;
      ellipse(ctx, -1, -11, 5, 3.6);
      ctx.fill();
      ellipse(ctx, -1, 11, 5, 3.6);
      ctx.fill();
      ctx.fillStyle = character.accentColor;
      ctx.fillRect(-1.5, -12, 3, 24);
      break;
    }
    case 'stripes': {
      ctx.strokeStyle = character.accentColor;
      ctx.lineWidth = 2;
      for (const y of [-8, -3.5, 1, 5.5, 10]) {
        ctx.beginPath();
        ctx.moveTo(-10, y);
        ctx.lineTo(10, y);
        ctx.stroke();
      }
      break;
    }
  }
  // Soft light from the top-left, shadow on the lower-right.
  const light = ctx.createLinearGradient(-6, -10, 6, 10);
  light.addColorStop(0, 'rgba(255,255,255,0.22)');
  light.addColorStop(0.5, 'rgba(255,255,255,0)');
  light.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = light;
  ctx.fillRect(-10, -14, 20, 28);
  ctx.restore();

  ellipse(ctx, -1, 0, rx, ry);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.7;
  ctx.stroke();
}

/** Long hair flowing behind the head; sways while moving. */
function drawBackHair(ctx: CanvasRenderingContext2D, character: CharacterDefinition, x: number, sway: number): void {
  if (character.hairStyle !== 'long') return;
  ctx.beginPath();
  ctx.moveTo(x - 1, -7.5);
  ctx.quadraticCurveTo(x - 13, -9 + sway, x - 15, sway * 1.6);
  ctx.quadraticCurveTo(x - 13, 9 + sway, x - 1, 7.5);
  ctx.closePath();
  ctx.fillStyle = character.hairColor;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.3;
  ctx.stroke();
  ctx.strokeStyle = shade(character.hairColor, -0.25);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 4, -3);
  ctx.quadraticCurveTo(x - 10, -3 + sway, x - 13, sway * 1.4);
  ctx.moveTo(x - 4, 3);
  ctx.quadraticCurveTo(x - 10, 3 + sway, x - 13, sway * 1.4);
  ctx.stroke();
}

function drawHead(ctx: CanvasRenderingContext2D, character: CharacterDefinition, x: number, y: number, dizzy: boolean): void {
  const r = 7.4;
  // Ears.
  ctx.fillStyle = shade(character.skinColor, -0.08);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  for (const side of [-1, 1]) {
    ellipse(ctx, x + 0.5, y + side * 7.3, 1.8, 2.2);
    ctx.fill();
    ctx.stroke();
  }
  if (character.hairStyle === 'bun') {
    ellipse(ctx, x - 8.5, y, 4.4, 4.4);
    ctx.fillStyle = character.hairColor;
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.fillStyle = character.accentColor;
    ellipse(ctx, x - 5.2, y, 1.6, 3.2);
    ctx.fill();
  }

  ellipse(ctx, x, y, r, r);
  ctx.fillStyle = character.skinColor;
  ctx.fill();

  if (character.hairStyle === 'bald') {
    // Shine and a headband.
    ctx.save();
    ellipse(ctx, x, y, r, r);
    ctx.clip();
    ctx.fillStyle = character.accentColor;
    ctx.fillRect(x - 1.5, y - r, 3, r * 2);
    ctx.restore();
    ellipse(ctx, x - 2.5, y - 2.5, 2.6, 1.6);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fill();
  } else {
    // Hair covers the back and top of the head, with a curved fringe toward the face.
    const from = Math.PI * 0.36;
    const to = Math.PI * 1.64;
    ctx.beginPath();
    ctx.arc(x, y, r + 0.3, from, to);
    ctx.quadraticCurveTo(x + 4.5, y, x + Math.cos(from) * (r + 0.3), y + Math.sin(from) * (r + 0.3));
    ctx.closePath();
    ctx.fillStyle = character.hairColor;
    ctx.fill();
    if (character.hairStyle === 'short') {
      // Spiky fringe.
      ctx.beginPath();
      for (const offset of [-4, 0, 4]) {
        ctx.moveTo(x + 1, y + offset - 2);
        ctx.lineTo(x + 4.6, y + offset);
        ctx.lineTo(x + 1, y + offset + 2);
      }
      ctx.fill();
    }
    // Hair shine.
    ctx.beginPath();
    ctx.arc(x - 1, y, r - 2.6, Math.PI * 1.1, Math.PI * 1.45);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ellipse(ctx, x, y, r, r);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Face at the front edge.
  if (dizzy) {
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + 3.6, y + side * 2.8 - 1.3);
      ctx.lineTo(x + 6.1, y + side * 2.8 + 1.3);
      ctx.moveTo(x + 6.1, y + side * 2.8 - 1.3);
      ctx.lineTo(x + 3.6, y + side * 2.8 + 1.3);
      ctx.stroke();
    }
  } else {
    for (const side of [-1, 1]) {
      ellipse(ctx, x + 4.6, y + side * 2.8, 1.7, 1.5);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ellipse(ctx, x + 5.2, y + side * 2.8, 1, 1);
      ctx.fillStyle = '#1d1d24';
      ctx.fill();
    }
    // Eyebrows.
    ctx.strokeStyle = shade(character.hairStyle === 'bald' ? '#4a3a30' : character.hairColor, -0.3);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x + 2.8, y - 4.4);
    ctx.lineTo(x + 3.4, y - 1.8);
    ctx.moveTo(x + 2.8, y + 4.4);
    ctx.lineTo(x + 3.4, y + 1.8);
    ctx.stroke();
  }
  // Nose tip.
  ellipse(ctx, x + 7.2, y, 1.2, 1.4);
  ctx.fillStyle = shade(character.skinColor, -0.15);
  ctx.fill();
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
    ctx.strokeStyle = 'rgba(80,50,0,0.6)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let p = 0; p < 5; p++) {
      const outer = (p * Math.PI * 2) / 5 - Math.PI / 2;
      const inner = outer + Math.PI / 5;
      ctx.lineTo(Math.cos(outer) * 3.8, Math.sin(outer) * 3.8);
      ctx.lineTo(Math.cos(inner) * 1.6, Math.sin(inner) * 1.6);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** Crescent smear behind a weapon: brightest at the leading edge. */
function drawSmear(ctx: CanvasRenderingContext2D, from: number, to: number, inner: number, outer: number, alpha: number): void {
  if (alpha <= 0.01 || Math.abs(to - from) < 0.05) return;
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const a0 = lerp(from, to, i / steps);
    const a1 = lerp(from, to, (i + 1) / steps);
    const weight = (i + 1) / steps;
    ctx.beginPath();
    ctx.arc(0, 0, outer, a0, a1 + (to > from ? 0.01 : -0.01), to < from);
    ctx.arc(0, 0, inner + (outer - inner) * (1 - weight) * 0.6, a1, a0, to > from);
    ctx.closePath();
    ctx.fillStyle = `rgba(255,255,255,${alpha * weight * weight})`;
    ctx.fill();
  }
  // Crisp leading edge.
  ctx.beginPath();
  ctx.arc(0, 0, outer, lerp(from, to, 0.75), to, to < from);
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ---------------------------------------------------------------- main

export function drawCharacter(ctx: CanvasRenderingContext2D, character: CharacterDefinition, pose: CharacterPose): void {
  if (pose.life !== 'alive') {
    drawLyingCharacter(ctx, character, pose);
    return;
  }
  const { x, y } = pose;
  ctx.save();
  ctx.globalAlpha = pose.alpha ?? 1;

  // Shadow.
  ellipse(ctx, x + 2, y + 4, 14, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.fill();

  const swinging = pose.swingProgress >= 0;
  const weapon = swinging && pose.heldItem ? weaponSwing(pose.swingProgress, pose.swingArc) : null;
  const fist = swinging && !pose.heldItem ? punch(pose.swingProgress) : null;
  const lunge = weapon?.lunge ?? fist?.lunge ?? 0;
  const twist = weapon?.twist ?? fist?.twist ?? 0;
  const step = pose.isMoving ? Math.sin(pose.walkCycle * 1.2) : 0;
  const bob = pose.isMoving ? Math.abs(step) * 0.6 : Math.sin(pose.time * 2.2) * 0.25;

  ctx.translate(x, y);
  ctx.rotate(pose.facing);
  ctx.translate(lunge, 0);
  if (pose.hitFlash > 0) ctx.scale(1 - pose.hitFlash * 0.12, 1 + pose.hitFlash * 0.1);

  drawFeet(ctx, step * 4.8);

  ctx.save();
  ctx.rotate(twist);
  const skin = character.skinColor;
  const sleeve = sleeveColor(character);
  drawBackHair(ctx, character, 1.5, pose.isMoving ? Math.sin(pose.walkCycle * 0.9) * 2 : Math.sin(pose.time * 1.5) * 0.6);

  // Left (free) arm goes under the torso.
  const armSwing = pose.isMoving ? step * 3 : 0;
  const leftHand = weapon
    ? { x: lerp(5, -1, Math.abs(weapon.twist) / 0.22), y: -11 }
    : fist
      ? { x: 5 - fist.reach * 0.25, y: -10.5 }
      : pose.heldItem
        ? { x: 4.5, y: -10.5 }
        : { x: 5 - armSwing, y: -10.5 };
  drawArm(ctx, LEFT_SHOULDER, leftHand, sleeve, skin);

  drawTorso(ctx, character, bob);

  if (pose.heldItem) {
    const angle = weapon ? weapon.angle : HELD_REST_ANGLE + (pose.isMoving ? step * 0.08 : 0);
    const handRadius = 8;
    const hand = { x: Math.cos(angle) * handRadius, y: Math.sin(angle) * handRadius };
    const scale = pose.heldItem === 'table' ? 0.75 : 0.85;
    if (weapon) {
      const tip = handRadius + (ITEM_ART_LENGTH[pose.heldItem] + 2) * scale;
      drawSmear(ctx, weapon.smearFrom, weapon.smearTo, handRadius + 2, tip + 3, weapon.smearAlpha);
    }
    drawArm(ctx, RIGHT_SHOULDER, hand, sleeve, skin);
    ctx.save();
    ctx.translate(hand.x, hand.y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.translate(1, 0);
    drawItemShape(ctx, pose.heldItem);
    ctx.restore();
    // Hand wraps the grip, over the item.
    ellipse(ctx, hand.x, hand.y, 3.5, 3.5);
    ctx.fillStyle = skin;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  } else {
    const reach = fist ? fist.reach : 0;
    const hand = { x: 5 + armSwing + reach, y: 10.5 - Math.max(0, reach) * 0.55 };
    if (fist && fist.streak > 0) {
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * fist.streak})`;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const offset of [-2.6, 0, 2.6]) {
        ctx.moveTo(hand.x - 4, hand.y + offset);
        ctx.lineTo(hand.x - 4 - 9 * fist.streak, hand.y + offset + 3 * fist.streak);
      }
      ctx.stroke();
    }
    drawArm(ctx, RIGHT_SHOULDER, hand, sleeve, skin);
    if (fist && fist.reach > 9) {
      // Impact-ready fist grows a little.
      ellipse(ctx, hand.x, hand.y, 4.2, 4.2);
      ctx.fillStyle = skin;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  drawHead(ctx, character, 1.5, 0, pose.stunned);

  if (pose.hitFlash > 0) {
    ctx.globalAlpha = (pose.alpha ?? 1) * pose.hitFlash * 0.75;
    ctx.fillStyle = '#ffffff';
    ellipse(ctx, -1, 0, 9, 12.5);
    ctx.fill();
    ellipse(ctx, 1.5, 0, 7.8, 7.8);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  if (pose.stunned) drawStars(ctx, x, y, pose.time);
}

function drawLyingCharacter(ctx: CanvasRenderingContext2D, character: CharacterDefinition, pose: CharacterPose): void {
  const eliminated = pose.life === 'eliminated';
  const body = eliminated ? '#8a8a96' : character.bodyColor;
  ctx.save();
  ctx.globalAlpha = (pose.alpha ?? 1) * (eliminated ? 0.45 : 1);
  ctx.translate(pose.x, pose.y);
  if (!eliminated) {
    const pulse = 0.5 + Math.sin(pose.time * 3) * 0.5;
    ellipse(ctx, 0, 2, 20 + pulse * 2, 13 + pulse);
    ctx.fillStyle = 'rgba(160, 20, 30, 0.28)';
    ctx.fill();
  }
  ctx.rotate(pose.facing);
  ellipse(ctx, 1, 3, 17, 9);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fill();
  // Legs.
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-12, side * 3);
    ctx.lineTo(-21, side * 8);
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 6.4;
    ctx.stroke();
    ctx.strokeStyle = eliminated ? '#6d6d78' : '#3b3f55';
    ctx.lineWidth = 4.4;
    ctx.stroke();
    ellipse(ctx, -22, side * 8.5, 3, 2.4);
    ctx.fillStyle = SHOE;
    ctx.fill();
  }
  // Arms spread.
  const sleeve = eliminated ? '#6d6d78' : sleeveColor(character);
  drawArm(ctx, { x: -2, y: -6 }, { x: 6, y: -15 }, sleeve, character.skinColor);
  drawArm(ctx, { x: -2, y: 6 }, { x: 7, y: 14 }, sleeve, character.skinColor);
  ellipse(ctx, -4, 0, 11, 7.5);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
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
    y: 20,
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
