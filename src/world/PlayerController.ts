import type { InputManager } from '../core/InputManager';
import type { GameSettings } from '../core/PersistentStores';
import type { PerspectiveCamera } from '../graphics/Camera';
import type { Vec3 } from '../math/Vec3';
import { clamp, damp } from '../math/Vec3';
import type { LevelStreamer } from './LevelStreamer';

export interface PlayerTuning {
  readonly walkSpeed: number;
  readonly sprintSpeed: number;
  readonly acceleration: number;
  readonly eyeHeight: number;
  readonly collisionRadius: number;
  readonly staminaDrainPerSecond: number;
  readonly staminaRegenPerSecond: number;
  readonly mouseRadiansPerPixel: number;
  readonly keyboardLookRadiansPerSecond: number;
}

export const DEFAULT_PLAYER_TUNING: PlayerTuning = {
  walkSpeed: 3.1,
  sprintSpeed: 5.6,
  acceleration: 10,
  eyeHeight: 1.62,
  collisionRadius: 0.35,
  staminaDrainPerSecond: 0.22,
  staminaRegenPerSecond: 0.14,
  mouseRadiansPerPixel: 0.0022,
  keyboardLookRadiansPerSecond: 2.1,
};

/** First-person kinematic controller with sprint stamina, head bob and footstep cadence events. */
export class PlayerController {
  public position: Vec3 = [0, 0, 0];
  public yawRadians: number = 0;
  public pitchRadians: number = 0;
  public stamina: number = 1;
  public isSprinting: boolean = false;
  private velocity: Vec3 = [0, 0, 0];
  private bobPhase: number = 0;
  private lastStepPhase: number = 0;
  private exhausted: boolean = false;

  public constructor(private readonly tuning: PlayerTuning = DEFAULT_PLAYER_TUNING) {}

  public teleport(position: Readonly<Vec3>, yawRadians: number): void {
    this.position = [position[0], position[1], position[2]];
    this.yawRadians = yawRadians;
    this.pitchRadians = 0;
    this.velocity = [0, 0, 0];
    this.stamina = 1;
    this.exhausted = false;
  }

  public get horizontalSpeed(): number {
    return Math.hypot(this.velocity[0], this.velocity[2]);
  }

  /** Returns true on frames where a footstep should sound. */
  public update(deltaSeconds: number, input: InputManager, settings: Readonly<GameSettings>, streamer: LevelStreamer): boolean {
    const [mouseDeltaX, mouseDeltaY] = input.consumeMouseDelta();
    const lookScale: number = this.tuning.mouseRadiansPerPixel * settings.mouseSensitivity;
    const invert: number = settings.invertLookY ? -1 : 1;
    this.yawRadians -= mouseDeltaX * lookScale;
    this.pitchRadians -= mouseDeltaY * lookScale * invert;
    const keyboardLook: number = this.tuning.keyboardLookRadiansPerSecond * deltaSeconds * settings.mouseSensitivity;
    if (input.isKeyHeld('ArrowLeft')) this.yawRadians += keyboardLook;
    if (input.isKeyHeld('ArrowRight')) this.yawRadians -= keyboardLook;
    if (input.isKeyHeld('ArrowUp')) this.pitchRadians += keyboardLook * 0.6 * invert;
    if (input.isKeyHeld('ArrowDown')) this.pitchRadians -= keyboardLook * 0.6 * invert;
    this.pitchRadians = clamp(this.pitchRadians, -1.35, 1.35);

    let moveForward = 0;
    let moveRight = 0;
    if (input.isKeyHeld('KeyW')) moveForward += 1;
    if (input.isKeyHeld('KeyS')) moveForward -= 1;
    if (input.isKeyHeld('KeyD')) moveRight += 1;
    if (input.isKeyHeld('KeyA')) moveRight -= 1;
    const inputMagnitude: number = Math.hypot(moveForward, moveRight);
    if (inputMagnitude > 1) {
      moveForward /= inputMagnitude;
      moveRight /= inputMagnitude;
    }
    const wantsSprint: boolean = (input.isKeyHeld('ShiftLeft') || input.isKeyHeld('ShiftRight')) && moveForward > 0;
    if (this.stamina <= 0.01) {
      this.exhausted = true;
    } else if (this.stamina > 0.35) {
      this.exhausted = false;
    }
    this.isSprinting = wantsSprint && !this.exhausted;
    this.stamina = clamp(
      this.stamina + (this.isSprinting ? -this.tuning.staminaDrainPerSecond : this.tuning.staminaRegenPerSecond) * deltaSeconds,
      0,
      1,
    );
    const targetSpeed: number = this.isSprinting ? this.tuning.sprintSpeed : this.tuning.walkSpeed;
    const forwardX: number = -Math.sin(this.yawRadians);
    const forwardZ: number = -Math.cos(this.yawRadians);
    const rightX: number = Math.cos(this.yawRadians);
    const rightZ: number = -Math.sin(this.yawRadians);
    const targetVelocityX: number = (forwardX * moveForward + rightX * moveRight) * targetSpeed;
    const targetVelocityZ: number = (forwardZ * moveForward + rightZ * moveRight) * targetSpeed;
    this.velocity[0] = damp(this.velocity[0], targetVelocityX, this.tuning.acceleration, deltaSeconds);
    this.velocity[2] = damp(this.velocity[2], targetVelocityZ, this.tuning.acceleration, deltaSeconds);
    this.position[0] += this.velocity[0] * deltaSeconds;
    this.position[2] += this.velocity[2] * deltaSeconds;
    streamer.resolveCircleCollision(this.position, this.tuning.collisionRadius);

    const speed: number = this.horizontalSpeed;
    this.bobPhase += deltaSeconds * speed * (this.isSprinting ? 2.25 : 2.6);
    const stepPhase: number = Math.floor(this.bobPhase / Math.PI);
    const stepped: boolean = speed > 0.6 && stepPhase !== this.lastStepPhase;
    this.lastStepPhase = stepPhase;
    return stepped;
  }

  public applyToCamera(camera: PerspectiveCamera, settings: Readonly<GameSettings>): void {
    const speedRatio: number = clamp(this.horizontalSpeed / this.tuning.sprintSpeed, 0, 1);
    const bobVertical: number = Math.abs(Math.sin(this.bobPhase)) * 0.06 * speedRatio;
    const bobLateral: number = Math.sin(this.bobPhase) * 0.035 * speedRatio;
    camera.position = [
      this.position[0] + Math.cos(this.yawRadians) * bobLateral,
      this.tuning.eyeHeight + bobVertical,
      this.position[2] - Math.sin(this.yawRadians) * bobLateral,
    ];
    camera.yawRadians = this.yawRadians;
    camera.pitchRadians = this.pitchRadians;
    camera.rollRadians = Math.sin(this.bobPhase) * 0.006 * speedRatio;
    camera.fieldOfViewRadians = ((settings.fieldOfViewDegrees + (this.isSprinting ? 6 : 0) * speedRatio) * Math.PI) / 180;
  }
}
