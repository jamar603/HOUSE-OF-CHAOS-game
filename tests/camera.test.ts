import { describe, expect, it } from 'vitest';
import { Camera, MAX_ZOOM_FACTOR, MIN_ZOOM_FACTOR } from '../src/client/render/Camera';

const MAP = { width: 2048, height: 1856 };
const VIEW_W = 1280;
const VIEW_H = 720;
const BASE = 1;

function settle(camera: Camera, target: { x: number; y: number }, fighters: { x: number; y: number }[] = []): void {
  for (let i = 0; i < 600; i++) camera.update(target, fighters, BASE, VIEW_W, VIEW_H, 1 / 60);
}

describe('Camera', () => {
  it('follows the target in the middle of the map', () => {
    const camera = new Camera(MAP);
    settle(camera, { x: 1000, y: 900 });
    expect(camera.x).toBeCloseTo(1000, 0);
    expect(camera.y).toBeCloseTo(900, 0);
  });

  it('never shows beyond the map edges', () => {
    const camera = new Camera(MAP);
    settle(camera, { x: 10, y: 10 });
    const zoom = camera.zoom(BASE);
    expect(camera.x - VIEW_W / 2 / zoom).toBeGreaterThanOrEqual(-24 - 1e-6);
    expect(camera.y - VIEW_H / 2 / zoom).toBeGreaterThanOrEqual(-24 - 1e-6);
    settle(camera, { x: MAP.width - 5, y: MAP.height - 5 });
    expect(camera.x + VIEW_W / 2 / zoom).toBeLessThanOrEqual(MAP.width + 24 + 1e-6);
    expect(camera.y + VIEW_H / 2 / zoom).toBeLessThanOrEqual(MAP.height + 24 + 1e-6);
  });

  it('centers the map when zoomed out further than the map size', () => {
    const camera = new Camera({ width: 400, height: 300 });
    settle(camera, { x: 20, y: 20 });
    expect(camera.x).toBe(200);
    expect(camera.y).toBe(150);
  });

  it('clamps the player zoom', () => {
    const camera = new Camera(MAP);
    camera.adjustZoom(100);
    expect(camera.zoomFactor).toBe(MIN_ZOOM_FACTOR);
    camera.adjustZoom(-100);
    expect(camera.zoomFactor).toBe(MAX_ZOOM_FACTOR);
  });

  it('zooms out a little and shifts toward a nearby fight', () => {
    const camera = new Camera(MAP);
    camera.adjustZoom(-6); // player zoomed in
    const target = { x: 1000, y: 900 };
    const enemy = { x: 1300, y: 900 };
    settle(camera, target, [enemy]);
    expect(camera.zoom(BASE)).toBeLessThan(camera.zoomFactor);
    expect(camera.x).toBeGreaterThan(target.x);
    // Both fighters fit in the view.
    const halfW = VIEW_W / 2 / camera.zoom(BASE);
    expect(enemy.x).toBeLessThan(camera.x + halfW);
    expect(target.x).toBeGreaterThan(camera.x - halfW);
  });

  it('ignores far opponents', () => {
    const camera = new Camera(MAP);
    settle(camera, { x: 1000, y: 900 }, [{ x: 1800, y: 1700 }]);
    expect(camera.x).toBeCloseTo(1000, 0);
    expect(camera.zoom(BASE)).toBeCloseTo(camera.zoomFactor, 5);
  });
});
