export interface PointerSnapshot {
  /** Client-space CSS pixels relative to the canvas top-left. */
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimaryDown: boolean;
  readonly primaryPressedThisFrame: boolean;
  readonly primaryReleasedThisFrame: boolean;
  readonly movedThisFrame: boolean;
}

/** Polled input state. Event listeners accumulate; `endFrame` clears the per-frame edges. */
export class InputManager {
  private readonly keysHeld: Set<string> = new Set();
  private readonly keysPressed: Set<string> = new Set();
  private readonly keysReleased: Set<string> = new Set();
  private pointerClientX: number = -1;
  private pointerClientY: number = -1;
  private primaryHeld: boolean = false;
  private primaryPressed: boolean = false;
  private primaryReleased: boolean = false;
  private pointerMoved: boolean = false;
  private accumulatedMouseDeltaX: number = 0;
  private accumulatedMouseDeltaY: number = 0;
  private accumulatedWheel: number = 0;
  private anyGesture: boolean = false;
  private readonly abortController: AbortController = new AbortController();

  public constructor(private readonly canvas: HTMLCanvasElement) {
    const signal: AbortSignal = this.abortController.signal;
    window.addEventListener('keydown', (event: KeyboardEvent) => this.onKeyDown(event), { signal });
    window.addEventListener('keyup', (event: KeyboardEvent) => this.onKeyUp(event), { signal });
    window.addEventListener('blur', () => this.keysHeld.clear(), { signal });
    canvas.addEventListener('pointermove', (event: PointerEvent) => this.onPointerMove(event), { signal });
    canvas.addEventListener('pointerdown', (event: PointerEvent) => this.onPointerDown(event), { signal });
    window.addEventListener('pointerup', (event: PointerEvent) => this.onPointerUp(event), { signal });
    canvas.addEventListener('wheel', (event: WheelEvent) => {
      this.accumulatedWheel += Math.sign(event.deltaY);
      event.preventDefault();
    }, { signal, passive: false });
    canvas.addEventListener('contextmenu', (event: Event) => event.preventDefault(), { signal });
  }

  private onKeyDown(event: KeyboardEvent): void {
    const preventedCodes: readonly string[] = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'];
    if (preventedCodes.includes(event.code)) {
      event.preventDefault();
    }
    if (!event.repeat) {
      this.keysPressed.add(event.code);
    }
    this.keysHeld.add(event.code);
    this.anyGesture = true;
  }

  private onKeyUp(event: KeyboardEvent): void {
    this.keysHeld.delete(event.code);
    this.keysReleased.add(event.code);
  }

  private updatePointerPosition(event: PointerEvent): void {
    const bounds: DOMRect = this.canvas.getBoundingClientRect();
    this.pointerClientX = event.clientX - bounds.left;
    this.pointerClientY = event.clientY - bounds.top;
  }

  private onPointerMove(event: PointerEvent): void {
    this.updatePointerPosition(event);
    this.pointerMoved = true;
    if (this.isPointerLocked) {
      this.accumulatedMouseDeltaX += event.movementX;
      this.accumulatedMouseDeltaY += event.movementY;
    }
  }

  private onPointerDown(event: PointerEvent): void {
    this.updatePointerPosition(event);
    if (event.button === 0) {
      this.primaryHeld = true;
      this.primaryPressed = true;
    }
    this.anyGesture = true;
  }

  private onPointerUp(event: PointerEvent): void {
    if (event.button === 0 && this.primaryHeld) {
      this.primaryHeld = false;
      this.primaryReleased = true;
    }
  }

  public isKeyHeld(code: string): boolean {
    return this.keysHeld.has(code);
  }

  public wasKeyPressed(code: string): boolean {
    return this.keysPressed.has(code);
  }

  public wasAnyKeyPressed(codes: readonly string[]): boolean {
    return codes.some((code: string) => this.keysPressed.has(code));
  }

  public get anyGestureThisFrame(): boolean {
    return this.anyGesture;
  }

  public get pointer(): PointerSnapshot {
    return {
      clientX: this.pointerClientX,
      clientY: this.pointerClientY,
      isPrimaryDown: this.primaryHeld,
      primaryPressedThisFrame: this.primaryPressed,
      primaryReleasedThisFrame: this.primaryReleased,
      movedThisFrame: this.pointerMoved,
    };
  }

  public get wheelSteps(): number {
    return this.accumulatedWheel;
  }

  public consumeMouseDelta(): [number, number] {
    const delta: [number, number] = [this.accumulatedMouseDeltaX, this.accumulatedMouseDeltaY];
    this.accumulatedMouseDeltaX = 0;
    this.accumulatedMouseDeltaY = 0;
    return delta;
  }

  public get isPointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  public requestPointerLock(): void {
    if (!this.isPointerLocked && typeof this.canvas.requestPointerLock === 'function') {
      try {
        const result: unknown = this.canvas.requestPointerLock();
        if (result instanceof Promise) {
          result.catch(() => undefined);
        }
      } catch {
        // Pointer lock can be refused (iframes, headless); keyboard look remains available.
      }
    }
  }

  public releasePointerLock(): void {
    if (this.isPointerLocked) {
      document.exitPointerLock();
    }
  }

  public endFrame(): void {
    this.keysPressed.clear();
    this.keysReleased.clear();
    this.primaryPressed = false;
    this.primaryReleased = false;
    this.pointerMoved = false;
    this.accumulatedWheel = 0;
    this.anyGesture = false;
  }

  public dispose(): void {
    this.releasePointerLock();
    this.abortController.abort();
  }
}
