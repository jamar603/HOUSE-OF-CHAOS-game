import { TILE_SIZE } from '../constants';
import type { Rect, Vec2 } from '../math';
import type { ItemKind } from '../types';

/** Tile codes stored in {@link HouseMap.tiles}. */
export const TileType = {
  Void: 0,
  Wall: 1,
  Floor: 2,
  Door: 3,
  /** Looks like a wall but can be walked through. */
  Secret: 4,
  Stairs: 5,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export const FLOOR_STYLES = [
  'none',
  'wood',
  'carpet',
  'tile',
  'checker',
  'parquet',
  'concrete',
  'runner',
  'stone',
] as const;
export type FloorStyle = (typeof FLOOR_STYLES)[number];

export type RoomKind =
  | 'bedroom'
  | 'living'
  | 'kitchen'
  | 'bathroom'
  | 'corridor'
  | 'basement'
  | 'secret'
  | 'laundry'
  | 'dining'
  | 'hall';

export interface RoomDefinition {
  id: string;
  name: string;
  kind: RoomKind;
  /** Room interior rectangle in tiles. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Player slot owning this room (bedrooms only). */
  ownerSlot: number | null;
  floor: FloorStyle;
}

export type FurnitureKind =
  | 'bed'
  | 'nightstand'
  | 'wardrobe'
  | 'desk'
  | 'deskChair'
  | 'bookshelf'
  | 'rug'
  | 'bathtub'
  | 'toilet'
  | 'sink'
  | 'cabinet'
  | 'bathMat'
  | 'counter'
  | 'stove'
  | 'fridge'
  | 'island'
  | 'roundTable'
  | 'sofa'
  | 'sofaVertical'
  | 'coffeeTable'
  | 'tv'
  | 'armchair'
  | 'piano'
  | 'plant'
  | 'washer'
  | 'dryingRack'
  | 'basket'
  | 'crate'
  | 'mattress'
  | 'coatRack'
  | 'console'
  | 'diningTable'
  | 'diningChair'
  | 'buffet'
  | 'boiler'
  | 'shelf'
  | 'workbench'
  | 'stairs'
  | 'lamp'
  | 'beanbag'
  | 'toyChest'
  | 'ironingBoard'
  | 'bench'
  | 'barrel';

/** Tall furniture a player can hide behind. */
export const COVER_FURNITURE: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>([
  'wardrobe',
  'bookshelf',
  'fridge',
  'sofa',
  'sofaVertical',
  'armchair',
  'piano',
  'plant',
  'shelf',
  'boiler',
  'coatRack',
  'buffet',
  'crate',
  'washer',
  'bed',
  'barrel',
  'beanbag',
]);

/** A static piece of furniture. Rect is in world pixels. */
export interface Furniture extends Rect {
  kind: FurnitureKind;
  solid: boolean;
  roomId: string;
  /** Free variation index used by the renderer (colors, contents). */
  variant: number;
}

export interface ItemSpawnPoint {
  kind: ItemKind;
  x: number;
  y: number;
  roomId: string;
}

export interface DoorTile {
  tx: number;
  ty: number;
  kind: 'door' | 'secret' | 'stairs';
}

export interface HouseMap {
  widthTiles: number;
  heightTiles: number;
  tiles: Uint8Array;
  /** Index into {@link FLOOR_STYLES} for each tile. */
  floorStyles: Uint8Array;
  /** Index into {@link HouseMap.rooms} for each tile, -1 for walls and doors. */
  roomIndexByTile: Int16Array;
  rooms: RoomDefinition[];
  furniture: Furniture[];
  itemSpawns: ItemSpawnPoint[];
  /** Spawn position (world pixels) for each player slot. */
  playerSpawns: Vec2[];
  doors: DoorTile[];
}

export function tileIndex(map: HouseMap, tx: number, ty: number): number {
  return ty * map.widthTiles + tx;
}

export function isInsideMap(map: HouseMap, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < map.widthTiles && ty < map.heightTiles;
}

export function getTile(map: HouseMap, tx: number, ty: number): number {
  if (!isInsideMap(map, tx, ty)) return TileType.Void;
  return map.tiles[tileIndex(map, tx, ty)];
}

export function isPassableTile(tile: number): boolean {
  return (
    tile === TileType.Floor ||
    tile === TileType.Door ||
    tile === TileType.Secret ||
    tile === TileType.Stairs
  );
}

/** Walls and the void block line of sight; secret passages do not (they are thin). */
export function blocksSight(tile: number): boolean {
  return tile === TileType.Wall || tile === TileType.Void;
}

export function worldToTile(value: number): number {
  return Math.floor(value / TILE_SIZE);
}

export function roomIndexAt(map: HouseMap, px: number, py: number): number {
  const tx = worldToTile(px);
  const ty = worldToTile(py);
  if (!isInsideMap(map, tx, ty)) return -1;
  return map.roomIndexByTile[tileIndex(map, tx, ty)];
}

export function roomAt(map: HouseMap, px: number, py: number): RoomDefinition | null {
  const index = roomIndexAt(map, px, py);
  return index >= 0 ? map.rooms[index] : null;
}

export function bedroomForSlot(map: HouseMap, slot: number): RoomDefinition | null {
  return map.rooms.find((room) => room.kind === 'bedroom' && room.ownerSlot === slot) ?? null;
}

export function roomRectPixels(room: RoomDefinition): Rect {
  return { x: room.x * TILE_SIZE, y: room.y * TILE_SIZE, w: room.w * TILE_SIZE, h: room.h * TILE_SIZE };
}

export function mapPixelSize(map: HouseMap): Vec2 {
  return { x: map.widthTiles * TILE_SIZE, y: map.heightTiles * TILE_SIZE };
}
