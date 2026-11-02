/**
 * The house of HOUSE OF CHAOS.
 *
 * Layout (tiles, 64 x 58):
 *
 *   Chambre 1 | Salle de bain | Cuisine        | Chambre 2
 *   ------------------ Couloir nord ---------------------
 *   Cachette  | Grand salon                    | Buanderie
 *   ------------------ Couloir sud ----------------------
 *   Chambre 3 | Hall escalier | Salle à manger | Chambre 4
 *              |          Sous-sol               |
 *
 * Rooms are carved out of a solid block of walls; every wall is one tile thick.
 * Doors, secret passages and stairs are holes in those walls.
 * Every bedroom has one normal door and one secret passage.
 */
import { TILE_SIZE } from '../constants';
import type { ItemKind } from '../types';
import {
  FLOOR_STYLES,
  TileType,
  type DoorTile,
  type Furniture,
  type FurnitureKind,
  type HouseMap,
  type ItemSpawnPoint,
  type RoomDefinition,
} from './houseMap';

const MAP_WIDTH = 64;
const MAP_HEIGHT = 58;

const ROOMS: RoomDefinition[] = [
  { id: 'bedroom-1', name: 'Chambre 1', kind: 'bedroom', x: 1, y: 1, w: 14, h: 12, ownerSlot: 0, floor: 'carpet' },
  { id: 'bathroom', name: 'Salle de bain', kind: 'bathroom', x: 16, y: 1, w: 11, h: 12, ownerSlot: null, floor: 'tile' },
  { id: 'kitchen', name: 'Cuisine', kind: 'kitchen', x: 28, y: 1, w: 20, h: 12, ownerSlot: null, floor: 'checker' },
  { id: 'bedroom-2', name: 'Chambre 2', kind: 'bedroom', x: 49, y: 1, w: 14, h: 12, ownerSlot: 1, floor: 'carpet' },
  { id: 'corridor-north', name: 'Couloir nord', kind: 'corridor', x: 1, y: 14, w: 62, h: 3, ownerSlot: null, floor: 'runner' },
  { id: 'hideout', name: 'Pièce secrète', kind: 'secret', x: 1, y: 18, w: 14, h: 10, ownerSlot: null, floor: 'stone' },
  { id: 'living-room', name: 'Grand salon', kind: 'living', x: 16, y: 18, w: 32, h: 10, ownerSlot: null, floor: 'parquet' },
  { id: 'laundry', name: 'Buanderie', kind: 'laundry', x: 49, y: 18, w: 14, h: 10, ownerSlot: null, floor: 'tile' },
  { id: 'corridor-south', name: 'Couloir sud', kind: 'corridor', x: 1, y: 29, w: 62, h: 3, ownerSlot: null, floor: 'runner' },
  { id: 'bedroom-3', name: 'Chambre 3', kind: 'bedroom', x: 1, y: 33, w: 14, h: 12, ownerSlot: 2, floor: 'carpet' },
  { id: 'hall', name: "Hall de l'escalier", kind: 'hall', x: 16, y: 33, w: 11, h: 12, ownerSlot: null, floor: 'wood' },
  { id: 'dining-room', name: 'Salle à manger', kind: 'dining', x: 28, y: 33, w: 20, h: 12, ownerSlot: null, floor: 'wood' },
  { id: 'bedroom-4', name: 'Chambre 4', kind: 'bedroom', x: 49, y: 33, w: 14, h: 12, ownerSlot: 3, floor: 'carpet' },
  { id: 'basement', name: 'Sous-sol', kind: 'basement', x: 16, y: 46, w: 32, h: 11, ownerSlot: null, floor: 'concrete' },
];

const DOORS: DoorTile[] = [
  // Bedroom doors (2 tiles wide).
  { tx: 7, ty: 13, kind: 'door' },
  { tx: 8, ty: 13, kind: 'door' },
  { tx: 55, ty: 13, kind: 'door' },
  { tx: 56, ty: 13, kind: 'door' },
  { tx: 7, ty: 32, kind: 'door' },
  { tx: 8, ty: 32, kind: 'door' },
  { tx: 55, ty: 32, kind: 'door' },
  { tx: 56, ty: 32, kind: 'door' },
  // Common rooms.
  { tx: 21, ty: 13, kind: 'door' },
  { tx: 37, ty: 13, kind: 'door' },
  { tx: 38, ty: 13, kind: 'door' },
  { tx: 31, ty: 17, kind: 'door' },
  { tx: 32, ty: 17, kind: 'door' },
  { tx: 55, ty: 17, kind: 'door' },
  { tx: 48, ty: 22, kind: 'door' },
  { tx: 48, ty: 23, kind: 'door' },
  { tx: 31, ty: 28, kind: 'door' },
  { tx: 32, ty: 28, kind: 'door' },
  { tx: 56, ty: 28, kind: 'door' },
  { tx: 21, ty: 32, kind: 'door' },
  { tx: 37, ty: 32, kind: 'door' },
  { tx: 38, ty: 32, kind: 'door' },
  { tx: 27, ty: 38, kind: 'door' },
  { tx: 27, ty: 39, kind: 'door' },
  // Stairs down to the basement.
  { tx: 21, ty: 45, kind: 'stairs' },
  { tx: 22, ty: 45, kind: 'stairs' },
  // Secret passages: the hideout and one hidden entrance per bedroom.
  { tx: 4, ty: 17, kind: 'secret' },
  { tx: 11, ty: 28, kind: 'secret' },
  { tx: 15, ty: 4, kind: 'secret' },
  { tx: 27, ty: 5, kind: 'secret' },
  { tx: 48, ty: 6, kind: 'secret' },
  { tx: 15, ty: 40, kind: 'secret' },
  { tx: 48, ty: 40, kind: 'secret' },
  { tx: 40, ty: 45, kind: 'secret' },
];

interface FurnitureSpec {
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  solid?: boolean;
  variant?: number;
}

interface ItemSpec {
  kind: ItemKind;
  x: number;
  y: number;
}

/** Bedroom furniture, in tiles relative to the room origin, for the top-left bedroom. */
const BEDROOM_FURNITURE: FurnitureSpec[] = [
  { kind: 'rug', x: 5, y: 4, w: 4, h: 3, solid: false },
  { kind: 'bed', x: 1, y: 1, w: 3, h: 3.5 },
  { kind: 'nightstand', x: 4.3, y: 1, w: 1, h: 1 },
  { kind: 'wardrobe', x: 10, y: 0.15, w: 3.5, h: 1.1 },
  { kind: 'desk', x: 0.15, y: 9.3, w: 3, h: 1.4 },
  { kind: 'deskChair', x: 1.2, y: 8.4, w: 0.9, h: 0.9, solid: false },
  { kind: 'bookshelf', x: 12.7, y: 8, w: 1.1, h: 3 },
  { kind: 'lamp', x: 12.9, y: 11.1, w: 0.8, h: 0.8 },
  { kind: 'beanbag', x: 6.6, y: 0.6, w: 1.6, h: 1.5 },
  { kind: 'toyChest', x: 0.2, y: 5.4, w: 1.1, h: 1.9 },
  { kind: 'plant', x: 4.3, y: 10.9, w: 0.9, h: 0.9 },
];

const ROOM_FURNITURE: Record<string, FurnitureSpec[]> = {
  bathroom: [
    { kind: 'bathMat', x: 3.5, y: 2.4, w: 3, h: 1.2, solid: false },
    { kind: 'bathtub', x: 3, y: 0.15, w: 4.5, h: 2 },
    { kind: 'toilet', x: 9.5, y: 0.2, w: 1.3, h: 1.5 },
    { kind: 'sink', x: 0.15, y: 6, w: 1.1, h: 1.8 },
    { kind: 'cabinet', x: 9.8, y: 7.5, w: 1.1, h: 3 },
    { kind: 'plant', x: 0.2, y: 10.6, w: 1, h: 1 },
  ],
  kitchen: [
    { kind: 'counter', x: 1, y: 0.1, w: 9, h: 1.3 },
    { kind: 'stove', x: 10, y: 0.1, w: 2, h: 1.3 },
    { kind: 'counter', x: 12, y: 0.1, w: 3, h: 1.3 },
    { kind: 'fridge', x: 15.4, y: 0.1, w: 1.8, h: 1.7 },
    { kind: 'counter', x: 0.1, y: 7.5, w: 1.3, h: 4 },
    { kind: 'island', x: 6, y: 5, w: 7, h: 2 },
    { kind: 'roundTable', x: 15, y: 7.5, w: 3, h: 2.2 },
    { kind: 'diningChair', x: 14, y: 8.2, w: 0.9, h: 0.9, solid: false },
    { kind: 'diningChair', x: 18.1, y: 8.2, w: 0.9, h: 0.9, solid: false },
    { kind: 'plant', x: 18.8, y: 0.2, w: 1, h: 1 },
  ],
  'corridor-north': [
    { kind: 'console', x: 24, y: 0.1, w: 2.5, h: 0.8 },
    { kind: 'plant', x: 60.8, y: 0.15, w: 1, h: 1 },
    { kind: 'console', x: 44, y: 0.1, w: 2.5, h: 0.8 },
    { kind: 'bench', x: 9.5, y: 2.1, w: 3, h: 0.8 },
    { kind: 'plant', x: 34, y: 2.05, w: 0.9, h: 0.9 },
  ],
  hideout: [
    { kind: 'mattress', x: 1, y: 5.5, w: 4, h: 2.6, solid: false },
    { kind: 'shelf', x: 0.2, y: 0.3, w: 1.2, h: 3.5 },
    { kind: 'crate', x: 8.5, y: 0.5, w: 2, h: 2 },
    { kind: 'crate', x: 10.8, y: 0.6, w: 1.6, h: 1.6 },
    { kind: 'crate', x: 11.5, y: 2.5, w: 1.5, h: 1.5 },
    { kind: 'roundTable', x: 6.5, y: 4, w: 1.5, h: 1.5 },
  ],
  'living-room': [
    { kind: 'rug', x: 2.5, y: 1.4, w: 9, h: 6.5, solid: false, variant: 1 },
    { kind: 'sofa', x: 3.5, y: 2, w: 6, h: 1.6 },
    { kind: 'coffeeTable', x: 4.5, y: 4.4, w: 4, h: 1.5 },
    { kind: 'tv', x: 4.5, y: 8.6, w: 5, h: 1.1 },
    { kind: 'sofaVertical', x: 0.3, y: 3, w: 1.6, h: 4.5 },
    { kind: 'bookshelf', x: 19, y: 0.1, w: 6, h: 1 },
    { kind: 'armchair', x: 20, y: 3, w: 1.8, h: 1.8 },
    { kind: 'roundTable', x: 22.1, y: 3.2, w: 1.3, h: 1.3 },
    { kind: 'armchair', x: 23.7, y: 3, w: 1.8, h: 1.8 },
    { kind: 'piano', x: 26.5, y: 6.5, w: 4, h: 2.2 },
    { kind: 'plant', x: 0.2, y: 0.2, w: 1, h: 1 },
    { kind: 'plant', x: 30.8, y: 0.2, w: 1, h: 1 },
    { kind: 'plant', x: 30.8, y: 8.8, w: 1, h: 1 },
    { kind: 'lamp', x: 12, y: 0.3, w: 0.8, h: 0.8 },
  ],
  laundry: [
    { kind: 'washer', x: 9.5, y: 0.15, w: 1.7, h: 1.7 },
    { kind: 'washer', x: 11.4, y: 0.15, w: 1.7, h: 1.7, variant: 1 },
    { kind: 'shelf', x: 12.7, y: 3, w: 1.2, h: 4 },
    { kind: 'dryingRack', x: 2, y: 7.5, w: 3.5, h: 1 },
    { kind: 'basket', x: 0.3, y: 0.3, w: 1.2, h: 1.2 },
    { kind: 'basket', x: 7.6, y: 0.4, w: 1.1, h: 1.1 },
    { kind: 'ironingBoard', x: 4.5, y: 4.6, w: 3.4, h: 0.9 },
  ],
  'corridor-south': [
    { kind: 'plant', x: 0.2, y: 0.2, w: 1, h: 1 },
    { kind: 'console', x: 40, y: 2.1, w: 2.5, h: 0.8 },
    { kind: 'console', x: 18, y: 2.1, w: 2.5, h: 0.8 },
    { kind: 'bench', x: 27, y: 0.1, w: 3, h: 0.8 },
    { kind: 'plant', x: 61, y: 2, w: 0.9, h: 0.9 },
  ],
  hall: [
    { kind: 'stairs', x: 4.5, y: 9.6, w: 3, h: 2.4, solid: false },
    { kind: 'coatRack', x: 0.3, y: 0.3, w: 1, h: 1 },
    { kind: 'console', x: 7.5, y: 0.2, w: 3, h: 1 },
    { kind: 'cabinet', x: 0.2, y: 9, w: 1.2, h: 2.5 },
    { kind: 'bench', x: 0.2, y: 2.5, w: 0.9, h: 3 },
    { kind: 'plant', x: 9.8, y: 10.8, w: 1, h: 1 },
  ],
  'dining-room': [
    { kind: 'rug', x: 4, y: 3, w: 11, h: 5, solid: false, variant: 2 },
    { kind: 'diningTable', x: 5, y: 4, w: 9, h: 3 },
    { kind: 'diningChair', x: 5.8, y: 3.1, w: 0.9, h: 0.9, solid: false },
    { kind: 'diningChair', x: 7.8, y: 3.1, w: 0.9, h: 0.9, solid: false },
    { kind: 'diningChair', x: 9.8, y: 3.1, w: 0.9, h: 0.9, solid: false },
    { kind: 'diningChair', x: 11.8, y: 3.1, w: 0.9, h: 0.9, solid: false },
    { kind: 'diningChair', x: 5.8, y: 7, w: 0.9, h: 0.9, solid: false },
    { kind: 'diningChair', x: 7.8, y: 7, w: 0.9, h: 0.9, solid: false },
    { kind: 'diningChair', x: 9.8, y: 7, w: 0.9, h: 0.9, solid: false },
    { kind: 'diningChair', x: 11.8, y: 7, w: 0.9, h: 0.9, solid: false },
    { kind: 'buffet', x: 13.5, y: 0.15, w: 5, h: 1.2 },
    { kind: 'cabinet', x: 0.2, y: 0.2, w: 3, h: 1.1 },
    { kind: 'plant', x: 18.8, y: 10.8, w: 1, h: 1 },
  ],
  basement: [
    { kind: 'shelf', x: 0.2, y: 1.5, w: 1.2, h: 6 },
    { kind: 'shelf', x: 30.6, y: 0.3, w: 1.2, h: 5 },
    { kind: 'boiler', x: 27, y: 6.5, w: 3, h: 3.5 },
    { kind: 'crate', x: 8, y: 2, w: 2, h: 2 },
    { kind: 'crate', x: 10.3, y: 2.4, w: 1.5, h: 1.5 },
    { kind: 'crate', x: 18, y: 7, w: 2, h: 2 },
    { kind: 'crate', x: 14, y: 1, w: 1.6, h: 1.6 },
    { kind: 'workbench', x: 10, y: 9.4, w: 5, h: 1.4 },
    { kind: 'sofa', x: 20, y: 0.5, w: 5, h: 1.6, variant: 3 },
    { kind: 'barrel', x: 3.8, y: 0.3, w: 1.2, h: 1.2 },
    { kind: 'barrel', x: 24, y: 8.9, w: 1.2, h: 1.2 },
    { kind: 'barrel', x: 25.3, y: 9.5, w: 1.1, h: 1.1, variant: 1 },
    { kind: 'barrel', x: 1.8, y: 9.3, w: 1.2, h: 1.2, variant: 1 },
  ],
};

const BEDROOM_ITEMS: ItemSpec[] = [{ kind: 'pillow', x: 9.5, y: 6 }];

const ROOM_ITEMS: Record<string, ItemSpec[]> = {
  bathroom: [{ kind: 'bottle', x: 6, y: 6 }],
  kitchen: [
    { kind: 'pan', x: 8, y: 3.6 },
    { kind: 'pan', x: 14, y: 3.6 },
    { kind: 'bottle', x: 4, y: 3 },
    { kind: 'bottle', x: 17, y: 5.5 },
  ],
  'corridor-north': [{ kind: 'bottle', x: 14, y: 1.5 }],
  hideout: [
    { kind: 'pan', x: 4, y: 3.5 },
    { kind: 'table', x: 9, y: 7 },
  ],
  'living-room': [
    { kind: 'pillow', x: 11.5, y: 2.5 },
    { kind: 'pillow', x: 22.7, y: 6 },
    { kind: 'chair', x: 17, y: 7 },
  ],
  laundry: [
    { kind: 'broom', x: 4, y: 3 },
    { kind: 'broom', x: 9, y: 6 },
  ],
  'corridor-south': [{ kind: 'bottle', x: 48, y: 1.5 }],
  hall: [{ kind: 'broom', x: 8, y: 6 }],
  'dining-room': [
    { kind: 'chair', x: 3, y: 9 },
    { kind: 'chair', x: 16, y: 9 },
    { kind: 'table', x: 16, y: 4 },
  ],
  basement: [
    { kind: 'table', x: 5, y: 6 },
    { kind: 'chair', x: 22, y: 5 },
    { kind: 'bottle', x: 13, y: 7 },
    { kind: 'bottle', x: 24.5, y: 9 },
    { kind: 'pan', x: 29, y: 2.5 },
  ],
};

/** Mirrors the bedroom template so every bedroom keeps its doors and secret passage free. */
function mirrorSpec(spec: FurnitureSpec, room: RoomDefinition, flipX: boolean, flipY: boolean): FurnitureSpec {
  return {
    ...spec,
    x: flipX ? room.w - spec.x - spec.w : spec.x,
    y: flipY ? room.h - spec.y - spec.h : spec.y,
  };
}

function toFurniture(room: RoomDefinition, spec: FurnitureSpec): Furniture {
  return {
    kind: spec.kind,
    x: (room.x + spec.x) * TILE_SIZE,
    y: (room.y + spec.y) * TILE_SIZE,
    w: spec.w * TILE_SIZE,
    h: spec.h * TILE_SIZE,
    solid: spec.solid ?? true,
    roomId: room.id,
    variant: spec.variant ?? 0,
  };
}

function toSpawn(room: RoomDefinition, spec: ItemSpec): ItemSpawnPoint {
  return {
    kind: spec.kind,
    x: (room.x + spec.x) * TILE_SIZE,
    y: (room.y + spec.y) * TILE_SIZE,
    roomId: room.id,
  };
}

/** Builds the complete house map. The result is deterministic. */
export function createHouseMap(): HouseMap {
  const tileCount = MAP_WIDTH * MAP_HEIGHT;
  const tiles = new Uint8Array(tileCount).fill(TileType.Wall);
  const floorStyles = new Uint8Array(tileCount);
  const roomIndexByTile = new Int16Array(tileCount).fill(-1);
  const rooms = ROOMS.map((room) => ({ ...room }));

  rooms.forEach((room, roomIndex) => {
    const floorStyleIndex = FLOOR_STYLES.indexOf(room.floor);
    for (let ty = room.y; ty < room.y + room.h; ty++) {
      for (let tx = room.x; tx < room.x + room.w; tx++) {
        const index = ty * MAP_WIDTH + tx;
        tiles[index] = TileType.Floor;
        floorStyles[index] = floorStyleIndex;
        roomIndexByTile[index] = roomIndex;
      }
    }
  });

  for (const door of DOORS) {
    const index = door.ty * MAP_WIDTH + door.tx;
    tiles[index] =
      door.kind === 'secret' ? TileType.Secret : door.kind === 'stairs' ? TileType.Stairs : TileType.Door;
  }

  // Walls that do not touch any walkable tile become "void" (outside of the house).
  const walkable = (tx: number, ty: number): boolean => {
    if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) return false;
    return tiles[ty * MAP_WIDTH + tx] !== TileType.Wall && tiles[ty * MAP_WIDTH + tx] !== TileType.Void;
  };
  const voidTiles: number[] = [];
  for (let ty = 0; ty < MAP_HEIGHT; ty++) {
    for (let tx = 0; tx < MAP_WIDTH; tx++) {
      if (tiles[ty * MAP_WIDTH + tx] !== TileType.Wall) continue;
      let touchesFloor = false;
      for (let dy = -1; dy <= 1 && !touchesFloor; dy++) {
        for (let dx = -1; dx <= 1 && !touchesFloor; dx++) {
          if (walkable(tx + dx, ty + dy)) touchesFloor = true;
        }
      }
      if (!touchesFloor) voidTiles.push(ty * MAP_WIDTH + tx);
    }
  }
  for (const index of voidTiles) tiles[index] = TileType.Void;

  const furniture: Furniture[] = [];
  const itemSpawns: ItemSpawnPoint[] = [];
  const playerSpawns = [0, 1, 2, 3].map(() => ({ x: 0, y: 0 }));

  for (const room of rooms) {
    if (room.kind === 'bedroom' && room.ownerSlot !== null) {
      const flipX = room.ownerSlot === 1 || room.ownerSlot === 3;
      const flipY = room.ownerSlot === 2 || room.ownerSlot === 3;
      for (const spec of BEDROOM_FURNITURE) {
        furniture.push(toFurniture(room, { ...mirrorSpec(spec, room, flipX, flipY), variant: room.ownerSlot }));
      }
      for (const spec of BEDROOM_ITEMS) {
        const itemX = flipX ? room.w - spec.x : spec.x;
        const itemY = flipY ? room.h - spec.y : spec.y;
        itemSpawns.push(toSpawn(room, { ...spec, x: itemX, y: itemY }));
      }
      playerSpawns[room.ownerSlot] = {
        x: (room.x + 7) * TILE_SIZE,
        y: (room.y + 6) * TILE_SIZE,
      };
      continue;
    }
    for (const spec of ROOM_FURNITURE[room.id] ?? []) furniture.push(toFurniture(room, spec));
    for (const spec of ROOM_ITEMS[room.id] ?? []) itemSpawns.push(toSpawn(room, spec));
  }

  // Non-solid furniture (rugs...) is drawn first.
  furniture.sort((a, b) => Number(a.solid) - Number(b.solid));

  return {
    widthTiles: MAP_WIDTH,
    heightTiles: MAP_HEIGHT,
    tiles,
    floorStyles,
    roomIndexByTile,
    rooms,
    furniture,
    itemSpawns,
    playerSpawns,
    doors: DOORS.map((door) => ({ ...door })),
  };
}
