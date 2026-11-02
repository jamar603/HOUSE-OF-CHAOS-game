/** Small, dependency-free math helpers shared by the simulation and the client. */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

/** Wraps an angle into the range [-PI, PI]. */
export function normalizeAngle(angle: number): number {
  let wrapped = angle % (Math.PI * 2);
  if (wrapped > Math.PI) wrapped -= Math.PI * 2;
  if (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

/** Signed shortest difference from one angle to another. */
export function angleDifference(from: number, to: number): number {
  return normalizeAngle(to - from);
}

export function closestPointOnRect(px: number, py: number, rect: Rect): Vec2 {
  return {
    x: clamp(px, rect.x, rect.x + rect.w),
    y: clamp(py, rect.y, rect.y + rect.h),
  };
}

export function circleIntersectsRect(cx: number, cy: number, radius: number, rect: Rect): boolean {
  const closest = closestPointOnRect(cx, cy, rect);
  const dx = cx - closest.x;
  const dy = cy - closest.y;
  return dx * dx + dy * dy < radius * radius;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function pointInRect(px: number, py: number, rect: Rect): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

/**
 * Deterministic pseudo random generator (mulberry32).
 * The simulation only uses seeded randomness so a match can be replayed
 * identically on a server and in tests.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of integers, used to vary procedural textures. */
export function hashIntegers(a: number, b: number, c = 0): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
