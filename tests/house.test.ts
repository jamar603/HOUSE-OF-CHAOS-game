import { describe, expect, it } from 'vitest';
import { findPath, NavigationGrid } from '../src/shared/bots/pathfinding';
import { TILE_SIZE } from '../src/shared/constants';
import { createHouseMap } from '../src/shared/house/houseLayout';
import { getTile, isPassableTile, TileType, worldToTile } from '../src/shared/house/houseMap';

describe('house map', () => {
  const map = createHouseMap();
  const grid = new NavigationGrid(map);

  it('has 4 bedrooms with one owner each and the common rooms', () => {
    const bedrooms = map.rooms.filter((room) => room.kind === 'bedroom');
    expect(bedrooms.map((room) => room.ownerSlot).sort()).toEqual([0, 1, 2, 3]);
    for (const kind of ['living', 'kitchen', 'bathroom', 'corridor', 'basement', 'secret'] as const) {
      expect(map.rooms.some((room) => room.kind === kind)).toBe(true);
    }
    expect(map.furniture.length).toBeGreaterThan(80);
  });

  it('places every door in a wall between two walkable tiles', () => {
    for (const door of map.doors) {
      const horizontal =
        isPassableTile(getTile(map, door.tx - 1, door.ty)) && isPassableTile(getTile(map, door.tx + 1, door.ty));
      const vertical =
        isPassableTile(getTile(map, door.tx, door.ty - 1)) && isPassableTile(getTile(map, door.tx, door.ty + 1));
      expect(horizontal || vertical, `door ${door.tx},${door.ty}`).toBe(true);
    }
  });

  it('gives every bedroom a normal door and a secret passage', () => {
    map.rooms
      .filter((room) => room.kind === 'bedroom')
      .forEach((room) => {
        const touching = map.doors.filter(
          (door) =>
            door.tx >= room.x - 1 && door.tx <= room.x + room.w && door.ty >= room.y - 1 && door.ty <= room.y + room.h,
        );
        expect(touching.some((door) => door.kind === 'door'), room.id).toBe(true);
        expect(touching.some((door) => door.kind === 'secret'), room.id).toBe(true);
      });
  });

  it('keeps every room reachable from the first bedroom', () => {
    const start = map.playerSpawns[0];
    for (const room of map.rooms) {
      let reached = false;
      for (let ty = room.y; ty < room.y + room.h && !reached; ty++) {
        for (let tx = room.x; tx < room.x + room.w && !reached; tx++) {
          if (!grid.isWalkable(tx, ty)) continue;
          reached = findPath(grid, worldToTile(start.x), worldToTile(start.y), tx, ty) !== null;
        }
      }
      expect(reached, room.id).toBe(true);
    }
  });

  it('keeps every item spawn and player spawn reachable', () => {
    const start = map.playerSpawns[0];
    for (const spawn of [...map.itemSpawns, ...map.playerSpawns]) {
      const path = findPath(grid, worldToTile(start.x), worldToTile(start.y), worldToTile(spawn.x), worldToTile(spawn.y));
      expect(path, `${spawn.x / TILE_SIZE},${spawn.y / TILE_SIZE}`).not.toBeNull();
    }
  });

  it('surrounds the house with walls', () => {
    for (let tx = 0; tx < map.widthTiles; tx++) {
      expect(isPassableTile(getTile(map, tx, 0))).toBe(false);
      expect(isPassableTile(getTile(map, tx, map.heightTiles - 1))).toBe(false);
    }
    expect(getTile(map, 0, 0)).not.toBe(TileType.Floor);
  });
});
