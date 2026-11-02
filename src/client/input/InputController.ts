/**
 * Keyboard + mouse input. Keys are read by physical position (KeyboardEvent.code),
 * so WASD on QWERTY and ZQSD on AZERTY both work without configuration.
 * A touch controller can later implement the same `sample` contract.
 */
import type { PlayerInput } from '../../shared/types';

export interface InputCallbacks {
  onPause: () => void;
  onToggleMute: () => void;
}

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];

export class InputController {
  private readonly pressed = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private hasMouse = false;
  private primaryDown = false;
  private interactTap = false;
  private dropTap = false;
  private zoomSteps = 0;
  private lastAim = Math.PI / 2;
  enabled = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly callbacks: InputCallbacks) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.reset);
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.code === 'Escape') {
      this.callbacks.onPause();
      return;
    }
    if (event.key.toLowerCase() === 'm') {
      this.callbacks.onToggleMute();
      return;
    }
    if (!this.enabled) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    if (!event.repeat) {
      if (event.code === 'KeyE' || event.code === 'KeyF') this.interactTap = true;
      if (event.code === 'KeyG') this.dropTap = true;
    }
    this.pressed.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = event.clientX - rect.left;
    this.mouseY = event.clientY - rect.top;
    this.hasMouse = true;
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    this.onMouseMove(event);
    if (event.button === 0) this.primaryDown = true;
    if (event.button === 2) this.dropTap = true;
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.primaryDown = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoomSteps += Math.sign(event.deltaY);
  };

  readonly reset = (): void => {
    this.pressed.clear();
    this.primaryDown = false;
    this.interactTap = false;
    this.dropTap = false;
  };

  private isDown(codes: string[]): boolean {
    return codes.some((code) => this.pressed.has(code));
  }

  /** Builds the input for this tick. playerScreen is the local player's position on screen. */
  sample(playerScreenX: number, playerScreenY: number): PlayerInput {
    let moveX = (this.isDown(RIGHT) ? 1 : 0) - (this.isDown(LEFT) ? 1 : 0);
    let moveY = (this.isDown(DOWN) ? 1 : 0) - (this.isDown(UP) ? 1 : 0);
    const length = Math.hypot(moveX, moveY);
    if (length > 0) {
      moveX /= length;
      moveY /= length;
    }
    if (this.hasMouse) {
      const dx = this.mouseX - playerScreenX;
      const dy = this.mouseY - playerScreenY;
      if (Math.hypot(dx, dy) > 4) this.lastAim = Math.atan2(dy, dx);
    } else if (length > 0) {
      this.lastAim = Math.atan2(moveY, moveX);
    }
    const input: PlayerInput = {
      moveX,
      moveY,
      aimAngle: this.lastAim,
      attack: this.enabled && (this.primaryDown || this.pressed.has('Space')),
      interact: this.enabled && (this.interactTap || this.isDown(['KeyE', 'KeyF'])),
      drop: this.enabled && (this.dropTap || this.pressed.has('KeyG')),
    };
    this.interactTap = false;
    this.dropTap = false;
    if (!this.enabled) {
      input.moveX = 0;
      input.moveY = 0;
    }
    return input;
  }

  consumeZoomSteps(): number {
    const steps = this.zoomSteps;
    this.zoomSteps = 0;
    return steps;
  }
}
