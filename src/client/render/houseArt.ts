/**
 * Pre-renders the static house (floors, walls, doors, furniture, labels)
 * into one offscreen canvas. It is drawn once per match, then blitted every frame.
 */
import { TILE_SIZE } from '../../shared/constants';
import {
  getTile,
  isPassableTile,
  TileType,
  type Furniture,
  type HouseMap,
  type RoomDefinition,
} from '../../shared/house/houseMap';
import { createSeededRandom, hashIntegers } from '../../shared/math';

const T = TILE_SIZE;
const WALL_TOP = '#4a4458';
const WALL_FACE = '#2c2836';
const WALL_EDGE = '#6b6480';
const OUTSIDE = '#141520';

type Ctx = CanvasRenderingContext2D;

function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((value >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((value >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (value & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

function box(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, lineWidth = 1.5): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function circle(ctx: Ctx, x: number, y: number, r: number, fill: string, stroke?: string, lineWidth = 1.2): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function dropShadow(ctx: Ctx, f: Furniture, radius = 4): void {
  ctx.beginPath();
  ctx.roundRect(f.x + 3, f.y + 5, f.w, f.h, radius);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();
}

// ------------------------------------------------------------------ floors

function drawFloor(ctx: Ctx, room: RoomDefinition, ownerColor: string | null): void {
  const x = room.x * T;
  const y = room.y * T;
  const w = room.w * T;
  const h = room.h * T;
  const random = createSeededRandom(room.x * 1000 + room.y);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  switch (room.floor) {
    case 'wood':
    case 'runner': {
      const base = room.floor === 'runner' ? '#8a5a36' : '#a87545';
      ctx.fillStyle = base;
      ctx.fillRect(x, y, w, h);
      const plankHeight = 10;
      for (let py = y, row = 0; py < y + h; py += plankHeight, row++) {
        const offset = (row * 37) % 64;
        for (let px = x - offset, column = 0; px < x + w; px += 64, column++) {
          const tone = (hashIntegers(row, column, room.x) - 0.5) * 26;
          ctx.fillStyle = shade(base, tone);
          ctx.fillRect(px + 1, py + 1, 63, plankHeight - 1);
          ctx.fillStyle = 'rgba(60,30,10,0.18)';
          ctx.fillRect(px + 8 + hashIntegers(column, row) * 40, py + 4, 14, 1);
        }
      }
      if (room.floor === 'runner') {
        const horizontal = w > h;
        const rx = horizontal ? x : x + w / 2 - 24;
        const ry = horizontal ? y + h / 2 - 22 : y;
        const rw = horizontal ? w : 48;
        const rh = horizontal ? 44 : h;
        ctx.fillStyle = '#7b2334';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = '#d4a849';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx + 4, ry + 4, rw - 8, rh - 8);
        ctx.fillStyle = 'rgba(212,168,73,0.35)';
        for (let i = 0; i < (horizontal ? rw : rh); i += 48) {
          ctx.beginPath();
          if (horizontal) {
            ctx.moveTo(rx + i + 24, ry + 12);
            ctx.lineTo(rx + i + 34, ry + rh / 2);
            ctx.lineTo(rx + i + 24, ry + rh - 12);
            ctx.lineTo(rx + i + 14, ry + rh / 2);
          } else {
            ctx.moveTo(rx + 12, ry + i + 24);
            ctx.lineTo(rx + rw / 2, ry + i + 14);
            ctx.lineTo(rx + rw - 12, ry + i + 24);
            ctx.lineTo(rx + rw / 2, ry + i + 34);
          }
          ctx.fill();
        }
      }
      break;
    }
    case 'carpet': {
      const base = ownerColor ? mixWithNeutral(ownerColor, 0.32) : '#6f6a84';
      ctx.fillStyle = base;
      ctx.fillRect(x, y, w, h);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(x + random() * w, y + random() * h, 2, 2);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 6;
      ctx.strokeRect(x + 10, y + 10, w - 20, h - 20);
      break;
    }
    case 'tile': {
      ctx.fillStyle = '#c9dbe3';
      ctx.fillRect(x, y, w, h);
      const size = 16;
      for (let ty = 0; ty < h / size; ty++) {
        for (let tx = 0; tx < w / size; tx++) {
          const tone = hashIntegers(tx, ty, room.y) * 14;
          ctx.fillStyle = `rgb(${200 + tone},${218 + tone * 0.6},${228})`;
          ctx.fillRect(x + tx * size + 1, y + ty * size + 1, size - 2, size - 2);
        }
      }
      break;
    }
    case 'checker': {
      const size = 32;
      for (let ty = 0; ty < h / size; ty++) {
        for (let tx = 0; tx < w / size; tx++) {
          ctx.fillStyle = (tx + ty) % 2 === 0 ? '#efe4cf' : '#b9583f';
          ctx.fillRect(x + tx * size, y + ty * size, size, size);
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      for (let i = 0; i < 300; i++) ctx.fillRect(x + random() * w, y + random() * h, 3, 3);
      break;
    }
    case 'parquet': {
      const cell = 32;
      for (let ty = 0; ty < h / cell; ty++) {
        for (let tx = 0; tx < w / cell; tx++) {
          const cx = x + tx * cell;
          const cy = y + ty * cell;
          const vertical = (tx + ty) % 2 === 0;
          for (let s = 0; s < 4; s++) {
            const tone = (hashIntegers(tx * 4 + s, ty) - 0.5) * 30;
            ctx.fillStyle = shade('#b9824d', tone);
            if (vertical) ctx.fillRect(cx + s * 8 + 0.5, cy + 0.5, 7, cell - 1);
            else ctx.fillRect(cx + 0.5, cy + s * 8 + 0.5, cell - 1, 7);
          }
        }
      }
      break;
    }
    case 'concrete': {
      ctx.fillStyle = '#6e7176';
      ctx.fillRect(x, y, w, h);
      for (let i = 0; i < 1600; i++) {
        ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)';
        ctx.fillRect(x + random() * w, y + random() * h, 1 + random() * 2, 1 + random() * 2);
      }
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = 'rgba(40,40,30,0.18)';
        ctx.beginPath();
        ctx.ellipse(x + random() * w, y + random() * h, 20 + random() * 40, 12 + random() * 20, random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(20,20,25,0.4)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        let cx = x + random() * w;
        let cy = y + random() * h;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        for (let s = 0; s < 5; s++) {
          cx += (random() - 0.5) * 40;
          cy += (random() - 0.5) * 40;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      for (let gx = x; gx < x + w; gx += 128) ctx.strokeRect(gx, y, 128, h);
      break;
    }
    case 'stone': {
      ctx.fillStyle = '#3a3a45';
      ctx.fillRect(x, y, w, h);
      for (let sy = y; sy < y + h; sy += 20) {
        let sx = x - random() * 20;
        while (sx < x + w) {
          const sw = 18 + random() * 26;
          ctx.fillStyle = shade('#55566a', (random() - 0.5) * 30);
          ctx.beginPath();
          ctx.roundRect(sx + 1, sy + 1, sw - 2, 18, 4);
          ctx.fill();
          sx += sw;
        }
      }
      break;
    }
    case 'none':
      break;
  }
  ctx.restore();
}

function mixWithNeutral(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const neutral = [92, 86, 108];
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const mixed = channels.map((channel, i) => Math.round(neutral[i] + (channel - neutral[i]) * amount));
  return `rgb(${mixed[0]},${mixed[1]},${mixed[2]})`;
}

// ------------------------------------------------------------------ walls & doors

function drawWalls(ctx: Ctx, map: HouseMap): void {
  for (let ty = 0; ty < map.heightTiles; ty++) {
    for (let tx = 0; tx < map.widthTiles; tx++) {
      const tile = getTile(map, tx, ty);
      const px = tx * T;
      const py = ty * T;
      if (tile === TileType.Void) {
        ctx.fillStyle = OUTSIDE;
        ctx.fillRect(px, py, T, T);
        continue;
      }
      if (tile !== TileType.Wall && tile !== TileType.Secret) continue;
      ctx.fillStyle = WALL_TOP;
      ctx.fillRect(px, py, T, T);
      // Subtle brick texture on the wall top.
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(px, py + 10, T, 1);
      ctx.fillRect(px, py + 21, T, 1);
      ctx.fillRect(px + ((tx + ty) % 2 === 0 ? 8 : 22), py, 1, 10);
      ctx.fillRect(px + ((tx + ty) % 2 === 0 ? 20 : 6), py + 11, 1, 10);
      // Edges facing walkable tiles: highlight + darker face.
      const below = getTile(map, tx, ty + 1);
      const above = getTile(map, tx, ty - 1);
      const left = getTile(map, tx - 1, ty);
      const right = getTile(map, tx + 1, ty);
      ctx.fillStyle = WALL_EDGE;
      if (isPassableTile(above) && above !== TileType.Secret) ctx.fillRect(px, py, T, 3);
      if (isPassableTile(left) && left !== TileType.Secret) ctx.fillRect(px, py, 3, T);
      if (isPassableTile(right) && right !== TileType.Secret) ctx.fillRect(px + T - 3, py, 3, T);
      if (isPassableTile(below) && below !== TileType.Secret) {
        ctx.fillStyle = WALL_FACE;
        ctx.fillRect(px, py + T - 8, T, 8);
        ctx.fillStyle = '#d9cdb8';
        ctx.fillRect(px, py + T - 2, T, 2);
      }
      if (tile === TileType.Secret) {
        // A secret passage: a wall with a suspicious crack.
        ctx.strokeStyle = 'rgba(255, 220, 140, 0.32)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(px + 9, py + 5);
        ctx.lineTo(px + 15, py + 13);
        ctx.lineTo(px + 12, py + 19);
        ctx.lineTo(px + 19, py + 27);
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(px + 4, py + 4, T - 8, T - 8);
      }
    }
  }
}

function drawDoors(ctx: Ctx, map: HouseMap): void {
  for (const door of map.doors) {
    if (door.kind === 'secret') continue;
    const px = door.tx * T;
    const py = door.ty * T;
    const vertical = isPassableTile(getTile(map, door.tx, door.ty - 1)) && isPassableTile(getTile(map, door.tx, door.ty + 1));
    if (door.kind === 'stairs') {
      ctx.fillStyle = '#3d342c';
      ctx.fillRect(px, py, T, T);
      for (let s = 0; s < 4; s++) {
        ctx.fillStyle = shade('#8c7a66', -s * 18);
        ctx.fillRect(px, py + s * 8, T, 7);
      }
      continue;
    }
    ctx.fillStyle = '#7a5434';
    ctx.fillRect(px, py, T, T);
    ctx.fillStyle = '#5b3d24';
    if (vertical) {
      ctx.fillRect(px, py, T, 3);
      ctx.fillRect(px, py + T - 3, T, 3);
    } else {
      ctx.fillRect(px, py, 3, T);
      ctx.fillRect(px + T - 3, py, 3, T);
    }
    // Door frame jambs.
    ctx.fillStyle = '#c8b08a';
    if (vertical) {
      ctx.fillRect(px, py - 2, T, 2);
    } else {
      ctx.fillRect(px - 2, py, 2, T);
    }
  }
  // Open door leaves, drawn per contiguous door pair.
  for (const door of map.doors) {
    if (door.kind !== 'door') continue;
    const vertical = isPassableTile(getTile(map, door.tx, door.ty - 1));
    const px = door.tx * T;
    const py = door.ty * T;
    ctx.fillStyle = '#b07a48';
    ctx.strokeStyle = '#4a2e18';
    ctx.lineWidth = 1;
    if (vertical) {
      // Door in a horizontal wall: leaf opened along the wall.
      const leftNeighbor = map.doors.some((d) => d.tx === door.tx - 1 && d.ty === door.ty);
      const hingeX = leftNeighbor ? px + T - 4 : px + 1;
      ctx.fillRect(hingeX, py + T, 4, 22);
      ctx.strokeRect(hingeX, py + T, 4, 22);
    } else {
      const topNeighbor = map.doors.some((d) => d.tx === door.tx && d.ty === door.ty - 1);
      const hingeY = topNeighbor ? py + T - 4 : py + 1;
      ctx.fillRect(px + T, hingeY, 22, 4);
      ctx.strokeRect(px + T, hingeY, 22, 4);
    }
  }
}

function drawWallShadows(ctx: Ctx, map: HouseMap): void {
  for (let ty = 0; ty < map.heightTiles; ty++) {
    for (let tx = 0; tx < map.widthTiles; tx++) {
      const tile = getTile(map, tx, ty);
      if (tile !== TileType.Floor) continue;
      const px = tx * T;
      const py = ty * T;
      const above = getTile(map, tx, ty - 1);
      const left = getTile(map, tx - 1, ty);
      if (above === TileType.Wall || above === TileType.Secret) {
        const gradient = ctx.createLinearGradient(0, py, 0, py + 12);
        gradient.addColorStop(0, 'rgba(0,0,0,0.35)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(px, py, T, 12);
      }
      if (left === TileType.Wall || left === TileType.Secret) {
        const gradient = ctx.createLinearGradient(px, 0, px + 8, 0);
        gradient.addColorStop(0, 'rgba(0,0,0,0.25)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(px, py, 8, T);
      }
    }
  }
}

// ------------------------------------------------------------------ furniture

const RUG_COLORS = ['#3d5a80', '#9c3d54', '#2a7f62', '#b5838d'];
const SOFA_COLORS = ['#2f7f86', '#8f3f5a', '#596e3a', '#7b6f63'];
const BOOK_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', '#16a085'];

function drawFurniture(ctx: Ctx, f: Furniture, ownerColor: string | null): void {
  const { x, y, w, h } = f;
  const random = createSeededRandom(Math.floor(x * 7 + y * 13));
  switch (f.kind) {
    case 'rug': {
      const color = RUG_COLORS[f.variant % RUG_COLORS.length];
      box(ctx, x, y, w, h, 6, color);
      ctx.strokeStyle = 'rgba(255,240,210,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);
      ctx.fillStyle = 'rgba(255,240,210,0.25)';
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y + 12);
      ctx.lineTo(x + w - 14, y + h / 2);
      ctx.lineTo(x + w / 2, y + h - 12);
      ctx.lineTo(x + 14, y + h / 2);
      ctx.closePath();
      ctx.fill();
      // Fringes.
      ctx.strokeStyle = 'rgba(255,240,210,0.6)';
      ctx.lineWidth = 1;
      for (let fx = x + 4; fx < x + w - 2; fx += 4) {
        ctx.beginPath();
        ctx.moveTo(fx, y);
        ctx.lineTo(fx, y - 3);
        ctx.moveTo(fx, y + h);
        ctx.lineTo(fx, y + h + 3);
        ctx.stroke();
      }
      return;
    }
    case 'bathMat':
      box(ctx, x, y, w, h, 8, '#6fa8dc');
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 1; i < 5; i++) ctx.fillRect(x + (w / 5) * i, y + 4, 2, h - 8);
      return;
    case 'mattress':
      dropShadow(ctx, f);
      box(ctx, x, y, w, h, 6, '#d8d2c0', '#8a8370');
      ctx.fillStyle = 'rgba(120,100,60,0.3)';
      ctx.beginPath();
      ctx.ellipse(x + w * 0.6, y + h * 0.4, 14, 8, 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,110,90,0.4)';
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 4, y + (h / 4) * i);
        ctx.lineTo(x + w - 4, y + (h / 4) * i);
        ctx.stroke();
      }
      return;
    case 'stairs': {
      const steps = 6;
      for (let s = 0; s < steps; s++) {
        ctx.fillStyle = shade('#9b8b78', -s * 12);
        ctx.fillRect(x, y + (h / steps) * s, w, h / steps - 1);
      }
      ctx.fillStyle = '#5b4b3a';
      ctx.fillRect(x - 4, y, 4, h);
      ctx.fillRect(x + w, y, 4, h);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '700 11px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('▼ SOUS-SOL', x + w / 2, y + 14);
      return;
    }
    case 'deskChair':
      circle(ctx, x + w / 2, y + h / 2, w / 2, '#2f2f3a', '#111');
      circle(ctx, x + w / 2, y + h / 2, w / 4, '#454555');
      return;
    case 'diningChair':
      box(ctx, x, y, w, h, 3, '#8a5a32', '#4b2e16');
      ctx.fillStyle = '#c99a63';
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
      return;
    default:
      break;
  }

  dropShadow(ctx, f);
  switch (f.kind) {
    case 'bed': {
      const blanket = ownerColor ?? '#8f8fb0';
      const headAtTop = true;
      box(ctx, x, y, w, h, 6, '#5d3a22', '#2c1a0e', 2);
      box(ctx, x + 4, y + 4, w - 8, h - 8, 5, '#f4f0e6');
      const pillowY = headAtTop ? y + 8 : y + h - 26;
      box(ctx, x + 10, pillowY, w - 20, 18, 7, '#ffffff', '#cfc8b8');
      const blanketY = y + h * 0.38;
      box(ctx, x + 3, blanketY, w - 6, h - (blanketY - y) - 3, 5, blanket, shade(blanket.startsWith('#') ? blanket : '#888888', -50));
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x + 3, blanketY, w - 6, 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 8, blanketY + 20 * i);
        ctx.lineTo(x + w - 8, blanketY + 20 * i);
        ctx.stroke();
      }
      return;
    }
    case 'nightstand':
      box(ctx, x, y, w, h, 3, '#7a4f2c', '#3b2412');
      circle(ctx, x + w / 2, y + h / 2, w * 0.28, '#ffe08a', '#b8932f');
      ctx.fillStyle = 'rgba(255,224,138,0.18)';
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, w * 0.9, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'lamp':
      ctx.fillStyle = 'rgba(255,224,138,0.18)';
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, w * 1.4, 0, Math.PI * 2);
      ctx.fill();
      circle(ctx, x + w / 2, y + h / 2, w / 2, '#f6e3b0', '#a88c4c');
      circle(ctx, x + w / 2, y + h / 2, w / 5, '#fff7d6');
      return;
    case 'wardrobe':
    case 'buffet':
    case 'cabinet': {
      const wood = f.kind === 'cabinet' ? '#c9a678' : '#6b4226';
      box(ctx, x, y, w, h, 3, wood, '#2d1a0c', 1.8);
      const horizontal = w >= h;
      const doors = Math.max(2, Math.round((horizontal ? w : h) / 40));
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      for (let i = 1; i < doors; i++) {
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(x + (w / doors) * i, y + 3);
          ctx.lineTo(x + (w / doors) * i, y + h - 3);
        } else {
          ctx.moveTo(x + 3, y + (h / doors) * i);
          ctx.lineTo(x + w - 3, y + (h / doors) * i);
        }
        ctx.stroke();
      }
      ctx.fillStyle = '#e0c068';
      for (let i = 0; i < doors; i++) {
        if (horizontal) ctx.fillRect(x + (w / doors) * (i + 0.5) - 1, y + h / 2 - 3, 2, 6);
        else ctx.fillRect(x + w / 2 - 3, y + (h / doors) * (i + 0.5) - 1, 6, 2);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(x + 2, y + 2, w - 4, 3);
      return;
    }
    case 'desk':
      box(ctx, x, y, w, h, 3, '#8d6239', '#3b2412');
      box(ctx, x + w * 0.35, y + 6, w * 0.32, h * 0.55, 2, '#2a2d3a', '#111');
      ctx.fillStyle = '#5fc3e4';
      ctx.fillRect(x + w * 0.35 + 3, y + 9, w * 0.32 - 6, h * 0.55 - 8);
      ctx.fillStyle = '#f2efe6';
      ctx.save();
      ctx.translate(x + 14, y + h / 2);
      ctx.rotate(-0.2);
      ctx.fillRect(-8, -6, 16, 12);
      ctx.restore();
      return;
    case 'bookshelf':
    case 'shelf': {
      const frame = f.kind === 'shelf' ? '#7d8288' : '#4e2f1a';
      box(ctx, x, y, w, h, 2, frame, '#1d1d1d', 1.5);
      const horizontal = w >= h;
      const length = horizontal ? w : h;
      const depth = horizontal ? h : w;
      for (let p = 3; p < length - 3; ) {
        const size = 4 + random() * 5;
        ctx.fillStyle =
          f.kind === 'shelf'
            ? ['#b58d5b', '#c9c9c9', '#8b6f47', '#d35400'][Math.floor(random() * 4)]
            : BOOK_COLORS[Math.floor(random() * BOOK_COLORS.length)];
        const inset = 3 + random() * 2;
        if (horizontal) ctx.fillRect(x + p, y + inset, size - 1, depth - inset * 2);
        else ctx.fillRect(x + inset, y + p, depth - inset * 2, size - 1);
        p += size;
      }
      return;
    }
    case 'bathtub':
      box(ctx, x, y, w, h, 14, '#f7f7f7', '#9aa4ad', 2);
      box(ctx, x + 6, y + 6, w - 12, h - 12, 11, '#8fd0ec');
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 6; i++) circle(ctx, x + 20 + random() * (w - 40), y + 14 + random() * (h - 28), 2 + random() * 3, 'rgba(255,255,255,0.7)');
      circle(ctx, x + w - 12, y + h / 2, 3, '#b0b8c0', '#6b737a');
      return;
    case 'toilet':
      box(ctx, x + 4, y, w - 8, h * 0.35, 3, '#f4f4f4', '#9aa4ad');
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h * 0.65, w * 0.42, h * 0.33, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#9aa4ad';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h * 0.67, w * 0.25, h * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#bfe3f2';
      ctx.fill();
      return;
    case 'sink':
      box(ctx, x, y, w, h, 4, '#eef1f3', '#8f99a3');
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w * 0.3, h * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#c7dce6';
      ctx.fill();
      circle(ctx, x + 5, y + h / 2, 2.5, '#9aa4ad');
      return;
    case 'counter':
      box(ctx, x, y, w, h, 2, '#d9d4cc', '#7c766c', 1.5);
      ctx.fillStyle = 'rgba(120,110,100,0.18)';
      for (let i = 0; i < 12; i++) ctx.fillRect(x + random() * w, y + random() * h, 6, 1);
      if (w > h && w > 100) {
        box(ctx, x + w * 0.45, y + 6, 34, h - 12, 4, '#aab4bb', '#6b737a');
        circle(ctx, x + w * 0.45 + 17, y + h / 2, 2, '#59636a');
        circle(ctx, x + w * 0.2, y + h / 2, 6, '#c0392b');
        circle(ctx, x + w * 0.8, y + h / 2, 7, '#e5e1d7', '#9a948a');
      }
      return;
    case 'stove':
      box(ctx, x, y, w, h, 2, '#2c2e34', '#0f1013', 1.5);
      for (const [cx, cy] of [
        [0.3, 0.32],
        [0.7, 0.32],
        [0.3, 0.7],
        [0.7, 0.7],
      ]) {
        circle(ctx, x + w * cx, y + h * cy, Math.min(w, h) * 0.17, '#1a1b1f', '#5a5d66');
        circle(ctx, x + w * cx, y + h * cy, Math.min(w, h) * 0.08, '#c0392b');
      }
      return;
    case 'fridge':
      box(ctx, x, y, w, h, 4, '#e8ecef', '#8e979f', 2);
      ctx.fillStyle = '#c1c8ce';
      ctx.fillRect(x + 3, y + h * 0.38, w - 6, 2);
      ctx.fillStyle = '#7d868d';
      ctx.fillRect(x + w - 8, y + 8, 3, h * 0.22);
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(x + 8, y + h * 0.55, 8, 8);
      ctx.fillStyle = '#f1c40f';
      ctx.fillRect(x + 20, y + h * 0.6, 7, 7);
      return;
    case 'island':
      box(ctx, x, y, w, h, 4, '#6b4a33', '#2e1d12', 2);
      box(ctx, x + 3, y + 3, w - 6, h - 6, 3, '#e6e1d8');
      circle(ctx, x + w * 0.3, y + h / 2, 12, '#d9b26a', '#8a6d35');
      circle(ctx, x + w * 0.3 - 4, y + h / 2 - 2, 4, '#e74c3c');
      circle(ctx, x + w * 0.3 + 4, y + h / 2 + 1, 4, '#f39c12');
      circle(ctx, x + w * 0.3, y + h / 2 + 5, 3.5, '#27ae60');
      box(ctx, x + w * 0.6, y + h * 0.3, 30, 20, 3, '#a0663a', '#5b3517');
      return;
    case 'roundTable': {
      const r = Math.min(w, h) / 2;
      circle(ctx, x + w / 2, y + h / 2, r, '#8b5a33', '#3c2412', 2);
      circle(ctx, x + w / 2, y + h / 2, r * 0.75, '#a06a3d');
      circle(ctx, x + w / 2, y + h / 2, r * 0.3, '#f4efe6', '#c8c0b0');
      if (f.roomId === 'hideout') circle(ctx, x + w / 2, y + h / 2, 3, '#ffd36b');
      return;
    }
    case 'sofa':
    case 'sofaVertical':
    case 'armchair': {
      const color = SOFA_COLORS[f.variant % SOFA_COLORS.length];
      const vertical = f.kind === 'sofaVertical';
      box(ctx, x, y, w, h, 7, shade(color, -40), '#151515', 1.5);
      const back = 10;
      if (vertical) box(ctx, x + back, y + 6, w - back - 4, h - 12, 5, color);
      else box(ctx, x + 6, y + back, w - 12, h - back - 4, 5, color);
      const seats = f.kind === 'armchair' ? 1 : Math.max(2, Math.round((vertical ? h : w) / 64));
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1.2;
      for (let i = 1; i < seats; i++) {
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(x + back + 2, y + 6 + ((h - 12) / seats) * i);
          ctx.lineTo(x + w - 6, y + 6 + ((h - 12) / seats) * i);
        } else {
          ctx.moveTo(x + 6 + ((w - 12) / seats) * i, y + back + 2);
          ctx.lineTo(x + 6 + ((w - 12) / seats) * i, y + h - 6);
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      if (vertical) ctx.fillRect(x + 2, y + 4, 5, h - 8);
      else ctx.fillRect(x + 4, y + 2, w - 8, 5);
      if (f.variant === 3) {
        ctx.fillStyle = 'rgba(200,190,170,0.25)';
        ctx.fillRect(x, y, w, h);
      }
      return;
    }
    case 'coffeeTable':
      box(ctx, x, y, w, h, 4, '#3e2a1d', '#120a05', 1.5);
      box(ctx, x + 4, y + 4, w - 8, h - 8, 3, 'rgba(170,210,230,0.35)');
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(x + 14, y + 10, 18, 13);
      ctx.fillStyle = '#ecf0f1';
      ctx.fillRect(x + 40, y + 12, 14, 18);
      circle(ctx, x + w - 22, y + h / 2, 6, '#f5f5f5', '#999');
      return;
    case 'tv':
      box(ctx, x, y + h * 0.5, w, h * 0.5, 2, '#3b2b20', '#120a05');
      box(ctx, x + w * 0.1, y, w * 0.8, h * 0.45, 2, '#111318', '#000');
      ctx.fillStyle = 'rgba(95,195,228,0.5)';
      ctx.fillRect(x + w * 0.1 + 2, y + 2, w * 0.8 - 4, h * 0.45 - 4);
      return;
    case 'piano':
      box(ctx, x, y, w, h, 4, '#15151b', '#000', 2);
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(x + 6, y + h - 16, w - 12, 12);
      ctx.fillStyle = '#15151b';
      for (let k = x + 10; k < x + w - 10; k += 7) ctx.fillRect(k, y + h - 16, 3, 7);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x + 6, y + 6, w - 12, 6);
      return;
    case 'plant': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      circle(ctx, cx, cy, w * 0.36, '#b45f3c', '#5c2c18');
      for (let i = 0; i < 7; i++) {
        const angle = (i / 7) * Math.PI * 2 + random();
        ctx.save();
        ctx.translate(cx + Math.cos(angle) * 5, cy + Math.sin(angle) * 5);
        ctx.rotate(angle);
        ctx.beginPath();
        ctx.ellipse(5, 0, 9, 4, 0, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 === 0 ? '#2e8b57' : '#3cb371';
        ctx.fill();
        ctx.restore();
      }
      circle(ctx, cx, cy, 4, '#246b45');
      return;
    }
    case 'washer':
      box(ctx, x, y, w, h, 4, '#f2f4f5', '#8e979f', 2);
      circle(ctx, x + w / 2, y + h * 0.56, w * 0.3, '#9aa4ad', '#5f676e', 2);
      circle(ctx, x + w / 2, y + h * 0.56, w * 0.22, f.variant === 1 ? '#7fb3d5' : '#a3d9a5');
      ctx.fillStyle = '#5f676e';
      ctx.fillRect(x + 6, y + 5, w * 0.4, 4);
      return;
    case 'dryingRack': {
      box(ctx, x, y, w, h, 2, 'rgba(180,180,190,0.9)', '#666');
      const colors = ['#e74c3c', '#3498db', '#f1c40f', '#ecf0f1', '#9b59b6'];
      for (let i = 0; i < 5; i++) ctx.fillStyle = colors[i], ctx.fillRect(x + 6 + i * ((w - 12) / 5), y + 2, (w - 12) / 5 - 3, h - 4);
      return;
    }
    case 'basket':
      circle(ctx, x + w / 2, y + h / 2, w / 2, '#c49a5a', '#7a5a2c', 2);
      circle(ctx, x + w / 2 - 3, y + h / 2 - 2, w / 4, '#ecf0f1');
      circle(ctx, x + w / 2 + 4, y + h / 2 + 3, w / 5, '#e67e22');
      return;
    case 'crate':
      box(ctx, x, y, w, h, 2, '#b58850', '#5d3f1c', 2);
      ctx.strokeStyle = '#7a5428';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + 4, y + 4);
      ctx.lineTo(x + w - 4, y + h - 4);
      ctx.moveTo(x + w - 4, y + 4);
      ctx.lineTo(x + 4, y + h - 4);
      ctx.stroke();
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      return;
    case 'coatRack':
      circle(ctx, x + w / 2, y + h / 2, w / 2, '#5b3a22', '#2a180a');
      circle(ctx, x + w / 2 - 5, y + h / 2 - 3, 6, '#2c3e50');
      circle(ctx, x + w / 2 + 5, y + h / 2 + 3, 6, '#a04030');
      return;
    case 'console':
      box(ctx, x, y, w, h, 3, '#6b4226', '#2d1a0c');
      circle(ctx, x + w * 0.3, y + h / 2, Math.min(h * 0.35, 8), '#3a7bd5', '#1d4a8a');
      ctx.fillStyle = '#e9d8a6';
      ctx.fillRect(x + w * 0.6, y + h * 0.2, w * 0.25, h * 0.6);
      return;
    case 'diningTable':
      box(ctx, x, y, w, h, 6, '#7a4b28', '#2d1a0c', 2);
      box(ctx, x + 6, y + h * 0.3, w - 12, h * 0.4, 2, '#f1e7d3');
      for (let i = 0; i < 4; i++) {
        const px = x + 30 + i * ((w - 60) / 3);
        circle(ctx, px, y + 14, 8, '#fafafa', '#c8c0b0');
        circle(ctx, px, y + h - 14, 8, '#fafafa', '#c8c0b0');
      }
      circle(ctx, x + w / 2, y + h / 2, 5, '#f7dc6f', '#b7950b');
      return;
    case 'boiler':
      box(ctx, x, y, w, h, 6, '#8d9399', '#3b4045', 2);
      circle(ctx, x + w / 2, y + h * 0.4, w * 0.32, '#b0b6bc', '#5a6066', 2);
      circle(ctx, x + w / 2, y + h * 0.4, w * 0.12, '#e74c3c');
      ctx.strokeStyle = '#a0632a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2, y - 20);
      ctx.lineTo(x + w + 30, y - 20);
      ctx.stroke();
      return;
    case 'workbench':
      box(ctx, x, y, w, h, 3, '#9a6b3e', '#4b2e16', 2);
      ctx.fillStyle = '#5d6d7e';
      ctx.fillRect(x + 10, y + 8, 26, 6);
      ctx.fillStyle = '#7f8c8d';
      ctx.fillRect(x + w - 40, y + 10, 8, 20);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(x + w * 0.5, y + 14, 22, 5);
      return;
    default:
      box(ctx, x, y, w, h, 3, '#888', '#333');
  }
}

function drawRoomLabel(ctx: Ctx, room: RoomDefinition, label: string): void {
  ctx.save();
  ctx.font = '900 20px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = (room.x + room.w / 2) * T;
  const cy = room.kind === 'corridor' ? (room.y + room.h / 2) * T : (room.y + room.h - 0.9) * T;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillText(label.toUpperCase(), cx + 1, cy + 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillText(label.toUpperCase(), cx, cy);
  ctx.restore();
}

export interface HouseArtOptions {
  /** Color of the player owning each slot, or null if the slot is empty. */
  ownerColors: (string | null)[];
  ownerNames: (string | null)[];
}

export function createHouseLayer(map: HouseMap, options: HouseArtOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.widthTiles * T;
  canvas.height = map.heightTiles * T;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible.');

  ctx.fillStyle = OUTSIDE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const room of map.rooms) {
    const ownerColor = room.ownerSlot !== null ? options.ownerColors[room.ownerSlot] ?? null : null;
    drawFloor(ctx, room, ownerColor);
  }
  drawWallShadows(ctx, map);
  for (const furniture of map.furniture) {
    const ownerColor = furniture.roomId.startsWith('bedroom') ? options.ownerColors[furniture.variant] ?? null : null;
    drawFurniture(ctx, furniture, ownerColor);
  }
  for (const room of map.rooms) {
    const owner = room.ownerSlot !== null ? options.ownerNames[room.ownerSlot] : null;
    if (room.kind === 'corridor' || room.kind === 'secret') continue;
    drawRoomLabel(ctx, room, owner ? `Chambre de ${owner}` : room.name);
  }
  drawWalls(ctx, map);
  drawDoors(ctx, map);
  return canvas;
}

/** Tiny colored overview of the house for the minimap. */
export function createMinimapLayer(map: HouseMap, pixelsPerTile: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.widthTiles * pixelsPerTile;
  canvas.height = map.heightTiles * pixelsPerTile;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const roomColors: Record<string, string> = {
    bedroom: '#5d5a78',
    living: '#8a6a45',
    kitchen: '#9a6a55',
    bathroom: '#5f8a9a',
    corridor: '#6a4a3a',
    basement: '#55585e',
    secret: '#3a3a48',
    laundry: '#5f8a9a',
    dining: '#7a5a3a',
    hall: '#7a5a3a',
  };
  for (let ty = 0; ty < map.heightTiles; ty++) {
    for (let tx = 0; tx < map.widthTiles; tx++) {
      const tile = getTile(map, tx, ty);
      let color = 'rgba(0,0,0,0)';
      if (tile === TileType.Wall || tile === TileType.Secret) color = '#2a2733';
      else if (tile === TileType.Door || tile === TileType.Stairs) color = '#b08a5a';
      else if (tile === TileType.Floor) {
        const room = map.rooms[map.roomIndexByTile[ty * map.widthTiles + tx]];
        color = room ? roomColors[room.kind] ?? '#666' : '#666';
      }
      ctx.fillStyle = color;
      ctx.fillRect(tx * pixelsPerTile, ty * pixelsPerTile, pixelsPerTile, pixelsPerTile);
    }
  }
  return canvas;
}
