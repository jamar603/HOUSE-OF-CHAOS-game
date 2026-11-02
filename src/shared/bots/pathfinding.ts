/**
 * Grid navigation for bots: a static walkability grid built from the house
 * (walls + solid furniture) and an A* search with 8-way movement.
 * Dynamic obstacles (barricades, forbidden bedrooms) are passed as a callback.
 */
import { PLAYER_RADIUS, TILE_SIZE } from '../constants';
import { isPassableTile, type HouseMap } from '../house/houseMap';
import type { Vec2 } from '../math';

/** Extra clearance so a bot standing on a walkable tile center never touches furniture. */
const FURNITURE_CLEARANCE = PLAYER_RADIUS + 1;

export class NavigationGrid {
  readonly width: number;
  readonly height: number;
  private readonly walkable: Uint8Array;

  constructor(map: HouseMap) {
    this.width = map.widthTiles;
    this.height = map.heightTiles;
    this.walkable = new Uint8Array(this.width * this.height);
    const solids = map.furniture.filter((f) => f.solid);
    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < this.width; tx++) {
        const index = ty * this.width + tx;
        if (!isPassableTile(map.tiles[index])) continue;
        const cx = tx * TILE_SIZE + TILE_SIZE / 2;
        const cy = ty * TILE_SIZE + TILE_SIZE / 2;
        const covered = solids.some(
          (f) =>
            cx > f.x - FURNITURE_CLEARANCE &&
            cx < f.x + f.w + FURNITURE_CLEARANCE &&
            cy > f.y - FURNITURE_CLEARANCE &&
            cy < f.y + f.h + FURNITURE_CLEARANCE,
        );
        if (!covered) this.walkable[index] = 1;
      }
    }
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  isWalkable(tx: number, ty: number): boolean {
    return this.inBounds(tx, ty) && this.walkable[ty * this.width + tx] === 1;
  }
}

export type TileBlocker = (tx: number, ty: number) => boolean;

class MinHeap {
  private readonly nodes: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, priority: number): void {
    this.nodes.push(node);
    this.priorities.push(priority);
    let index = this.nodes.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[index]) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): number {
    const top = this.nodes[0];
    const lastNode = this.nodes.pop() as number;
    const lastPriority = this.priorities.pop() as number;
    if (this.nodes.length > 0) {
      this.nodes[0] = lastNode;
      this.priorities[0] = lastPriority;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < this.nodes.length && this.priorities[left] < this.priorities[smallest]) smallest = left;
        if (right < this.nodes.length && this.priorities[right] < this.priorities[smallest]) smallest = right;
        if (smallest === index) break;
        this.swap(index, smallest);
        index = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
  }
}

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/**
 * Finds a path of tile coordinates from start to goal (start excluded).
 * Returns null when the goal cannot be reached.
 */
export function findPath(
  grid: NavigationGrid,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  isBlocked?: TileBlocker,
  maxIterations = 8000,
): Vec2[] | null {
  const canWalk = (tx: number, ty: number): boolean => grid.isWalkable(tx, ty) && !(isBlocked?.(tx, ty) ?? false);

  let targetX = goalX;
  let targetY = goalY;
  if (!canWalk(targetX, targetY)) {
    let found = false;
    for (let radius = 1; radius <= 2 && !found; radius++) {
      for (let dy = -radius; dy <= radius && !found; dy++) {
        for (let dx = -radius; dx <= radius && !found; dx++) {
          if (canWalk(goalX + dx, goalY + dy)) {
            targetX = goalX + dx;
            targetY = goalY + dy;
            found = true;
          }
        }
      }
    }
    if (!found) return null;
  }
  if (!grid.inBounds(startX, startY)) return null;
  if (startX === targetX && startY === targetY) return [];

  const width = grid.width;
  const size = width * grid.height;
  const start = startY * width + startX;
  const goal = targetY * width + targetX;
  const gScore = new Float32Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);
  const heap = new MinHeap();
  const heuristic = (node: number): number => {
    const dx = Math.abs((node % width) - targetX);
    const dy = Math.abs(Math.floor(node / width) - targetY);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };

  gScore[start] = 0;
  heap.push(start, heuristic(start));
  let iterations = 0;
  while (heap.size > 0) {
    const current = heap.pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === goal) {
      const path: Vec2[] = [];
      let node = goal;
      while (node !== start && node !== -1) {
        path.push({ x: node % width, y: Math.floor(node / width) });
        node = cameFrom[node];
      }
      return path.reverse();
    }
    if (++iterations > maxIterations) return null;
    const cx = current % width;
    const cy = Math.floor(current / width);
    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!canWalk(nx, ny)) continue;
      if (dx !== 0 && dy !== 0 && (!canWalk(cx + dx, cy) || !canWalk(cx, cy + dy))) continue;
      const neighbor = ny * width + nx;
      if (closed[neighbor]) continue;
      const tentative = gScore[current] + cost;
      if (tentative < gScore[neighbor]) {
        gScore[neighbor] = tentative;
        cameFrom[neighbor] = current;
        heap.push(neighbor, tentative + heuristic(neighbor));
      }
    }
  }
  return null;
}

export function tileCenter(tx: number, ty: number): Vec2 {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
}
