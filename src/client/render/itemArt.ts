/**
 * Procedural art for the household weapons.
 * Every item is drawn in a local frame where the grip is at (0, 0) and the
 * item extends along +X, so the same drawing works on the floor and in hand.
 */
import type { ItemKind } from '../../shared/types';

export const ITEM_ART_LENGTH: Record<ItemKind, number> = {
  chair: 22,
  bottle: 20,
  pan: 28,
  broom: 50,
  pillow: 22,
  table: 40,
};

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

export function drawItemShape(ctx: CanvasRenderingContext2D, kind: ItemKind): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (kind) {
    case 'chair': {
      // Seat.
      roundedRect(ctx, 4, -9, 18, 18, 3);
      ctx.fillStyle = '#b8743f';
      ctx.fill();
      ctx.strokeStyle = '#5b3517';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#d18f55';
      ctx.fillRect(7, -6, 12, 2);
      ctx.fillRect(7, -1, 12, 2);
      ctx.fillRect(7, 4, 12, 2);
      // Backrest.
      roundedRect(ctx, 0, -10, 5, 20, 2);
      ctx.fillStyle = '#8a5229';
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'bottle': {
      roundedRect(ctx, 6, -5, 14, 10, 4);
      ctx.fillStyle = '#2e9d57';
      ctx.fill();
      ctx.strokeStyle = '#13532b';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(9, -3.5, 8, 1.6);
      roundedRect(ctx, 0, -2.2, 7, 4.4, 1.5);
      ctx.fillStyle = '#36b866';
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d9b44a';
      ctx.fillRect(-1.5, -2.4, 2.5, 4.8);
      ctx.fillStyle = '#f4efe1';
      ctx.fillRect(11, -5, 4, 10);
      return;
    }
    case 'pan': {
      roundedRect(ctx, 0, -2, 14, 4, 2);
      ctx.fillStyle = '#c0392b';
      ctx.fill();
      ctx.fillStyle = '#2b2b30';
      ctx.fillRect(10, -1.6, 6, 3.2);
      ctx.beginPath();
      ctx.arc(24, 0, 10, 0, Math.PI * 2);
      ctx.fillStyle = '#34343c';
      ctx.fill();
      ctx.strokeStyle = '#121216';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(24, 0, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#4a4a55';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(21.5, -2.5, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fill();
      return;
    }
    case 'broom': {
      ctx.strokeStyle = '#8b5a2b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(36, 0);
      ctx.stroke();
      ctx.fillStyle = '#c94f3d';
      ctx.fillRect(34, -3.5, 4, 7);
      ctx.beginPath();
      ctx.moveTo(38, -4);
      ctx.lineTo(50, -8);
      ctx.lineTo(50, 8);
      ctx.lineTo(38, 4);
      ctx.closePath();
      ctx.fillStyle = '#e3bf62';
      ctx.fill();
      ctx.strokeStyle = '#9c7a2c';
      ctx.lineWidth = 1;
      ctx.stroke();
      for (let i = -6; i <= 6; i += 3) {
        ctx.beginPath();
        ctx.moveTo(40, i * 0.5);
        ctx.lineTo(50, i);
        ctx.stroke();
      }
      return;
    }
    case 'pillow': {
      roundedRect(ctx, 0, -8, 22, 16, 6);
      ctx.fillStyle = '#f7c8d8';
      ctx.fill();
      ctx.strokeStyle = '#c4778f';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([2, 2]);
      roundedRect(ctx, 3, -5, 16, 10, 4);
      ctx.strokeStyle = '#e59ab3';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(11, 0, 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 'table': {
      roundedRect(ctx, 0, -13, 40, 26, 3);
      ctx.fillStyle = '#a36a3c';
      ctx.fill();
      ctx.strokeStyle = '#4f2f14';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(79,47,20,0.45)';
      ctx.lineWidth = 1;
      for (let y = -6; y <= 6; y += 6) {
        ctx.beginPath();
        ctx.moveTo(2, y);
        ctx.lineTo(38, y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(2, -11, 36, 3);
      return;
    }
  }
}

/** Draws an item lying on the floor, centered on (x, y). */
export function drawFloorItem(
  ctx: CanvasRenderingContext2D,
  kind: ItemKind,
  x: number,
  y: number,
  rotation: number,
  time: number,
  highlighted: boolean,
): void {
  const bob = Math.sin(time * 3 + x * 0.05) * 1.2;
  ctx.save();
  ctx.translate(x, y);
  // Glow ring so items read clearly on busy floors.
  const pulse = 0.5 + Math.sin(time * 4 + y) * 0.5;
  ctx.beginPath();
  ctx.ellipse(0, 4, 17, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = highlighted ? `rgba(255, 214, 92, ${0.35 + pulse * 0.25})` : `rgba(255, 235, 170, ${0.1 + pulse * 0.1})`;
  ctx.fill();
  ctx.translate(0, bob - 2);
  ctx.rotate(rotation);
  const scale = kind === 'broom' ? 0.8 : 0.95;
  ctx.scale(scale, scale);
  ctx.translate(-ITEM_ART_LENGTH[kind] / 2, 0);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowOffsetY = 3;
  ctx.shadowBlur = 2;
  drawItemShape(ctx, kind);
  ctx.restore();
}

/** Draws a placed table barricade with its damage state. */
export function drawBarricade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  healthRatio: number,
  shakeAmount: number,
): void {
  ctx.save();
  ctx.translate(x + (Math.random() - 0.5) * shakeAmount, y + (Math.random() - 0.5) * shakeAmount);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-width / 2 + 3, -height / 2 + 4, width, height);
  ctx.beginPath();
  ctx.roundRect(-width / 2, -height / 2, width, height, 3);
  ctx.fillStyle = '#9b6234';
  ctx.fill();
  ctx.strokeStyle = '#3f240e';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Planks across the long side.
  const horizontal = width > height;
  ctx.strokeStyle = 'rgba(63,36,14,0.55)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    if (horizontal) {
      const py = -height / 2 + (height / 4) * i;
      ctx.moveTo(-width / 2 + 2, py);
      ctx.lineTo(width / 2 - 2, py);
    } else {
      const px = -width / 2 + (width / 4) * i;
      ctx.moveTo(px, -height / 2 + 2);
      ctx.lineTo(px, height / 2 - 2);
    }
    ctx.stroke();
  }
  // Metal brackets.
  ctx.fillStyle = '#9aa0a6';
  const bracket = 4;
  ctx.fillRect(-width / 2 + 2, -height / 2 + 2, bracket, bracket);
  ctx.fillRect(width / 2 - 2 - bracket, -height / 2 + 2, bracket, bracket);
  ctx.fillRect(-width / 2 + 2, height / 2 - 2 - bracket, bracket, bracket);
  ctx.fillRect(width / 2 - 2 - bracket, height / 2 - 2 - bracket, bracket, bracket);
  // Cracks as it takes damage.
  if (healthRatio < 0.7) {
    ctx.strokeStyle = 'rgba(30,15,5,0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-width * 0.2, -height * 0.4);
    ctx.lineTo(-width * 0.05, 0);
    ctx.lineTo(-width * 0.15, height * 0.35);
    if (healthRatio < 0.4) {
      ctx.moveTo(width * 0.25, -height * 0.4);
      ctx.lineTo(width * 0.1, -height * 0.05);
      ctx.lineTo(width * 0.3, height * 0.4);
    }
    ctx.stroke();
  }
  ctx.restore();
}
