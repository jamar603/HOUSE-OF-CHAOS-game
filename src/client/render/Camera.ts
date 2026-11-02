/**
 * Top-down 2D camera: looks straight down at the house, follows one target,
 * frames nearby fighters during combat and never shows beyond the map edges.
 *
 * Pure math (no DOM) so it can be unit-tested.
 */
import { clamp, lerp } from '../../shared/math';

export const MIN_ZOOM_FACTOR = 0.5;
export const MAX_ZOOM_FACTOR = 2;
const ZOOM_STEP = 1.12;
/** Opponents closer than this (world px) are kept in frame. */
export const COMBAT_FRAME_RADIUS = 340;
/** Share of the view the framed group may occupy before the camera zooms out. */
const COMBAT_FRAME_FILL = 0.7;
/** The automatic combat zoom never goes below this share of the chosen zoom. */
const COMBAT_MIN_ZOOM_SHARE = 0.72;
/** How far (0..1) the camera center moves from the target toward the fight's center. */
const COMBAT_CENTER_PULL = 0.35;
/** Default margin (world px) the camera may show outside the map, so outer walls are fully visible. */
const DEFAULT_EDGE_MARGIN = 24;

export interface CameraBounds {
  width: number;
  height: number;
  /** How far (world px) the view may extend past the map edges. */
  margin?: number;
}

export interface Point {
  x: number;
  y: number;
}

export class Camera {
  x = 0;
  y = 0;
  /** Zoom chosen by the player (wheel, +/-). */
  zoomFactor = 1;
  /** Zoom actually applied, including the automatic combat zoom. */
  private appliedFactor = 1;
  private initialized = false;

  constructor(private bounds: CameraBounds) {}

  setBounds(bounds: CameraBounds): void {
    this.bounds = bounds;
  }

  adjustZoom(steps: number): void {
    this.zoomFactor = clamp(this.zoomFactor * Math.pow(ZOOM_STEP, -steps), MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR);
  }

  /** Final zoom for a given base zoom (the base adapts to the window size). */
  zoom(baseZoom: number): number {
    return baseZoom * this.appliedFactor;
  }

  /**
   * Moves the camera for one frame.
   * @param target position of the followed player
   * @param fighters positions of opponents to keep in frame when close
   */
  update(target: Point, fighters: readonly Point[], baseZoom: number, viewWidth: number, viewHeight: number, dt: number): void {
    let centerX = target.x;
    let centerY = target.y;
    let factor = this.zoomFactor;

    const close = fighters.filter((p) => Math.hypot(p.x - target.x, p.y - target.y) <= COMBAT_FRAME_RADIUS);
    if (close.length > 0) {
      let minX = target.x;
      let maxX = target.x;
      let minY = target.y;
      let maxY = target.y;
      for (const p of close) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      centerX = lerp(target.x, (minX + maxX) / 2, COMBAT_CENTER_PULL);
      centerY = lerp(target.y, (minY + maxY) / 2, COMBAT_CENTER_PULL);
      // Half extents measured from the camera center, plus room for name tags.
      const halfW = Math.max(centerX - minX, maxX - centerX) + 40;
      const halfH = Math.max(centerY - minY, maxY - centerY) + 50;
      const fitZoom = Math.min((viewWidth * COMBAT_FRAME_FILL) / 2 / halfW, (viewHeight * COMBAT_FRAME_FILL) / 2 / halfH);
      const fitFactor = fitZoom / baseZoom;
      factor = clamp(Math.min(factor, fitFactor), this.zoomFactor * COMBAT_MIN_ZOOM_SHARE, this.zoomFactor);
    }

    if (!this.initialized) {
      this.appliedFactor = factor;
      this.x = centerX;
      this.y = centerY;
      this.initialized = true;
    } else {
      this.appliedFactor = lerp(this.appliedFactor, factor, 1 - Math.exp(-4 * dt));
      const follow = 1 - Math.exp(-10 * dt);
      this.x = lerp(this.x, centerX, follow);
      this.y = lerp(this.y, centerY, follow);
    }
    this.clampToBounds(this.zoom(baseZoom), viewWidth, viewHeight);
  }

  /** Keeps the visible area inside the map; centers the map on an axis smaller than the view. */
  private clampToBounds(zoom: number, viewWidth: number, viewHeight: number): void {
    const halfW = viewWidth / 2 / zoom;
    const halfH = viewHeight / 2 / zoom;
    const margin = this.bounds.margin ?? DEFAULT_EDGE_MARGIN;
    this.x = clampAxis(this.x, halfW, this.bounds.width, margin);
    this.y = clampAxis(this.y, halfH, this.bounds.height, margin);
  }
}

function clampAxis(value: number, halfView: number, size: number, margin: number): number {
  const min = halfView - margin;
  const max = size - halfView + margin;
  if (min >= max) return size / 2;
  return clamp(value, min, max);
}
