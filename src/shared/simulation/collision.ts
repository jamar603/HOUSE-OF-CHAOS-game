/**
 * Circle-vs-world collision used for every moving body.
 *
 * The world is made of: wall/void tiles, solid furniture rectangles, placed
 * barricades, and (during the preparation phase) the bedrooms of other players.
 * Movement is resolved axis by axis in small sub-steps, which gives smooth
 * sliding along walls and never tunnels through thin obstacles.
 */
import { TILE_SIZE } from '../constants';
import { blocksSight, getTile, isInsideMap, isPassableTile, tileIndex, type HouseMap } from '../house/houseMap';
import { circleIntersectsRect, type Rect, type Vec2 } from '../math';

export interface CollisionWorld {
  map: HouseMap;
  rects: readonly Rect[];
  /** Room indexes this body may not enter. */
  blockedRooms: ReadonlySet<number>;
}

const MAX_SUBSTEP = 4;

export function isTileBlocking(map: HouseMap, tx: number, ty: number, blockedRooms: ReadonlySet<number>): boolean {
  if (!isInsideMap(map, tx, ty)) return true;
  const index = tileIndex(map, tx, ty);
  if (!isPassableTile(map.tiles[index])) return true;
  if (blockedRooms.size > 0) {
    const room = map.roomIndexByTile[index];
    if (room >= 0 && blockedRooms.has(room)) return true;
  }
  return false;
}

export function circleCollides(world: CollisionWorld, x: number, y: number, radius: number): boolean {
  const minTx = Math.floor((x - radius) / TILE_SIZE);
  const maxTx = Math.floor((x + radius) / TILE_SIZE);
  const minTy = Math.floor((y - radius) / TILE_SIZE);
  const maxTy = Math.floor((y + radius) / TILE_SIZE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isTileBlocking(world.map, tx, ty, world.blockedRooms)) continue;
      if (circleIntersectsRect(x, y, radius, { x: tx * TILE_SIZE, y: ty * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE })) {
        return true;
      }
    }
  }
  for (const rect of world.rects) {
    if (circleIntersectsRect(x, y, radius, rect)) return true;
  }
  return false;
}

/**
 * Moves a circle by (dx, dy) and returns its new position, sliding along obstacles.
 * A body that already overlaps something (rare: spawned inside a barricade) is
 * allowed to move freely so it can escape.
 */
export function moveCircle(world: CollisionWorld, x: number, y: number, radius: number, dx: number, dy: number): Vec2 {
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x, y };
  if (circleCollides(world, x, y, radius)) return { x: x + dx, y: y + dy };
  const steps = Math.max(1, Math.ceil(length / MAX_SUBSTEP));
  const stepX = dx / steps;
  const stepY = dy / steps;
  let currentX = x;
  let currentY = y;
  for (let i = 0; i < steps; i++) {
    if (stepX !== 0 && !circleCollides(world, currentX + stepX, currentY, radius)) currentX += stepX;
    if (stepY !== 0 && !circleCollides(world, currentX, currentY + stepY, radius)) currentY += stepY;
  }
  return { x: currentX, y: currentY };
}

/** True when no wall stands between the two points. Furniture does not block sight. */
export function hasLineOfSight(map: HouseMap, ax: number, ay: number, bx: number, by: number): boolean {
  const length = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(length / 8));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const tile = getTile(map, Math.floor((ax + (bx - ax) * t) / TILE_SIZE), Math.floor((ay + (by - ay) * t) / TILE_SIZE));
    if (blocksSight(tile)) return false;
  }
  return true;
}
