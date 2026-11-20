import type { Aabb } from '../math/Collision';
import { aabbOverlaps } from '../math/Collision';
import type { Vec3 } from '../math/Vec3';
import { clamp, damp, lerp } from '../math/Vec3';

/** Anything the motor can collide against. Implemented by LevelStreamer. */
export interface CollisionWorld {
  queryColliders(region: Aabb, output: Aabb[]): void;
}

export type MovementStance = 'walk' | 'run' | 'crouch';

export interface StanceCoefficients {
  /** Target horizontal speed (m/s). */
  readonly maximumSpeed: number;
  /** Ground acceleration factor `a`: per-second fraction of wish speed added (Δv = a · wishSpeed · dt). */
  readonly acceleration: number;
  /** Ground friction coefficient `μ`: speed drop per second = μ · max(speed, stopSpeed). */
  readonly friction: number;
}

export interface CharacterMotorTuning {
  readonly halfWidth: number;
  readonly standingHeight: number;
  readonly crouchingHeight: number;
  readonly standingEyeHeight: number;
  readonly crouchingEyeHeight: number;
  readonly stances: Readonly<Record<MovementStance, StanceCoefficients>>;
  /** Below this speed friction acts as if moving at `stopSpeed`, so the character settles instead of creeping. */
  readonly stopSpeed: number;
  readonly airAcceleration: number;
  /** Air wish-speed cap used in the add-speed test (keeps air strafing bounded). */
  readonly airWishSpeedCap: number;
  readonly gravity: number;
  readonly jumpVelocity: number;
  readonly terminalVelocity: number;
  readonly stepHeight: number;
  readonly skinWidth: number;
  /** Velocity clip overbounce (1 = pure slide, >1 pushes slightly away from the surface). */
  readonly overbounce: number;
  /** Collision response curve: tangential retention = lerp(minRetention, 1, (1 - |cosθ|)^exponent). */
  readonly wallResponseExponent: number;
  readonly wallMinimumTangentRetention: number;
  readonly coyoteSeconds: number;
  readonly jumpBufferSeconds: number;
  readonly staminaDrainPerSecond: number;
  readonly staminaRegenPerSecond: number;
  readonly staminaRecoveryThreshold: number;
  readonly crouchTransitionSharpness: number;
  readonly maximumSubstepDistance: number;
}

export const DEFAULT_CHARACTER_MOTOR_TUNING: CharacterMotorTuning = {
  halfWidth: 0.3,
  standingHeight: 1.78,
  crouchingHeight: 1.1,
  standingEyeHeight: 1.64,
  crouchingEyeHeight: 0.98,
  stances: {
    walk: { maximumSpeed: 3.2, acceleration: 9, friction: 7.5 },
    run: { maximumSpeed: 5.7, acceleration: 11, friction: 5.5 },
    crouch: { maximumSpeed: 1.65, acceleration: 7, friction: 9.5 },
  },
  stopSpeed: 1.25,
  airAcceleration: 1.6,
  airWishSpeedCap: 1.1,
  gravity: 17,
  jumpVelocity: 4.7,
  terminalVelocity: 28,
  stepHeight: 0.32,
  skinWidth: 0.002,
  overbounce: 1.001,
  wallResponseExponent: 1.6,
  wallMinimumTangentRetention: 0.35,
  coyoteSeconds: 0.12,
  jumpBufferSeconds: 0.14,
  staminaDrainPerSecond: 0.22,
  staminaRegenPerSecond: 0.14,
  staminaRecoveryThreshold: 0.35,
  crouchTransitionSharpness: 14,
  maximumSubstepDistance: 0.2,
};

/** Normalised per-frame player intent produced from raw input by the owning state. */
export interface MotorIntent {
  /** -1..1, +1 forward. */
  readonly moveForward: number;
  /** -1..1, +1 right. */
  readonly moveRight: number;
  readonly wantsRun: boolean;
  readonly wantsCrouch: boolean;
  readonly jumpPressed: boolean;
  readonly yawRadians: number;
}

export interface MotorStepReport {
  readonly landedThisStep: boolean;
  /** Downward speed at the moment of landing (m/s), 0 if no landing. */
  readonly landingImpactSpeed: number;
  readonly jumpedThisStep: boolean;
  readonly blockedByCeilingOnStand: boolean;
}

type Axis = 0 | 1 | 2;

/**
 * Physics-driven kinematic character motor.
 *
 * Integration order per step:
 *   1. stance resolution (crouch / stand with ceiling clearance test)
 *   2. jump (buffered, with coyote time)
 *   3. friction (ground only):     v_h ← v_h · max(|v_h| − μ·max(|v_h|, v_stop)·dt, 0) / |v_h|
 *   4. acceleration toward wish:   add = clamp(w − v_h·ŵ, 0, a·w·dt);  v_h ← v_h + add·ŵ
 *   5. external acceleration (tether tension) and gravity
 *   6. sub-stepped, axis-separated AABB sweep with step-up and velocity clipping
 */
export class CharacterMotor {
  /** Feet position (bottom centre of the bounding box). */
  public position: Vec3 = [0, 0, 0];
  public velocity: Vec3 = [0, 0, 0];
  public isGrounded: boolean = false;
  public isCrouching: boolean = false;
  public stance: MovementStance = 'walk';
  public stamina: number = 1;
  public currentHeight: number;
  /** Eye height after crouch smoothing (metres above feet). */
  public smoothedEyeHeight: number;
  private exhausted: boolean = false;
  private secondsSinceGrounded: number = 0;
  private jumpBufferRemaining: number = 0;
  private readonly scratchColliders: Aabb[] = [];

  public constructor(public readonly tuning: CharacterMotorTuning = DEFAULT_CHARACTER_MOTOR_TUNING) {
    this.currentHeight = tuning.standingHeight;
    this.smoothedEyeHeight = tuning.standingEyeHeight;
  }

  public teleport(feetPosition: Readonly<Vec3>): void {
    this.position = [feetPosition[0], feetPosition[1], feetPosition[2]];
    this.velocity = [0, 0, 0];
    this.isGrounded = false;
    this.isCrouching = false;
    this.currentHeight = this.tuning.standingHeight;
    this.smoothedEyeHeight = this.tuning.standingEyeHeight;
    this.stamina = 1;
    this.exhausted = false;
    this.secondsSinceGrounded = 0;
    this.jumpBufferRemaining = 0;
  }

  public get horizontalSpeed(): number {
    return Math.hypot(this.velocity[0], this.velocity[2]);
  }

  public get eyePosition(): Vec3 {
    return [this.position[0], this.position[1] + this.smoothedEyeHeight, this.position[2]];
  }

  /** Approximate shoulder point, used as the tether cable origin for physics. */
  public get shoulderPosition(): Vec3 {
    return [this.position[0], this.position[1] + this.currentHeight * 0.8, this.position[2]];
  }

  public boundsAt(feet: Readonly<Vec3>, height: number = this.currentHeight): Aabb {
    const halfWidth: number = this.tuning.halfWidth;
    return {
      minimum: [feet[0] - halfWidth, feet[1], feet[2] - halfWidth],
      maximum: [feet[0] + halfWidth, feet[1] + height, feet[2] + halfWidth],
    };
  }

  private overlapsWorld(bounds: Aabb, world: CollisionWorld): boolean {
    this.scratchColliders.length = 0;
    world.queryColliders(bounds, this.scratchColliders);
    return this.scratchColliders.some((collider: Aabb) => aabbOverlaps(collider, bounds));
  }

  // ---- Stance --------------------------------------------------------------------------------------------------

  private resolveStance(intent: MotorIntent, world: CollisionWorld): boolean {
    let blockedByCeiling = false;
    if (intent.wantsCrouch) {
      this.isCrouching = true;
    } else if (this.isCrouching) {
      // Standing grows the box upward from the feet; only allowed when the full standing volume is clear.
      const standingBounds: Aabb = this.boundsAt(this.position, this.tuning.standingHeight);
      if (this.overlapsWorld(standingBounds, world)) {
        blockedByCeiling = true;
      } else {
        this.isCrouching = false;
      }
    }
    this.currentHeight = this.isCrouching ? this.tuning.crouchingHeight : this.tuning.standingHeight;
    if (this.stamina <= 0.01) {
      this.exhausted = true;
    } else if (this.stamina >= this.tuning.staminaRecoveryThreshold) {
      this.exhausted = false;
    }
    const canRun: boolean = intent.wantsRun && !this.isCrouching && !this.exhausted && intent.moveForward > 0.1;
    this.stance = this.isCrouching ? 'crouch' : canRun ? 'run' : 'walk';
    return blockedByCeiling;
  }

  // ---- Horizontal dynamics -----------------------------------------------------------------------------------------

  /**
   * Ground friction:  drop = μ · max(speed, stopSpeed) · dt;  speed' = max(speed − drop, 0).
   * Using max(speed, stopSpeed) makes low speeds decay linearly to a full stop instead of asymptotically.
   */
  private applyFriction(coefficients: StanceCoefficients, deltaSeconds: number): void {
    const speed: number = this.horizontalSpeed;
    if (speed < 1e-4) {
      this.velocity[0] = 0;
      this.velocity[2] = 0;
      return;
    }
    const control: number = Math.max(speed, this.tuning.stopSpeed);
    const drop: number = control * coefficients.friction * deltaSeconds;
    const newSpeed: number = Math.max(speed - drop, 0);
    const scale: number = newSpeed / speed;
    this.velocity[0] *= scale;
    this.velocity[2] *= scale;
  }

  /**
   * Acceleration toward a wish direction ŵ with wish speed w:
   *   current = v_h · ŵ;  add = (cap ?? w) − current;  if add ≤ 0 → no change;
   *   accelSpeed = min(a · w · dt, add);  v_h += accelSpeed · ŵ.
   */
  private accelerate(wishDirectionX: number, wishDirectionZ: number, wishSpeed: number, acceleration: number, addSpeedCap: number, deltaSeconds: number): void {
    const currentSpeed: number = this.velocity[0] * wishDirectionX + this.velocity[2] * wishDirectionZ;
    const addSpeed: number = Math.min(wishSpeed, addSpeedCap) - currentSpeed;
    if (addSpeed <= 0) {
      return;
    }
    const accelerationSpeed: number = Math.min(acceleration * wishSpeed * deltaSeconds, addSpeed);
    this.velocity[0] += accelerationSpeed * wishDirectionX;
    this.velocity[2] += accelerationSpeed * wishDirectionZ;
  }

  // ---- Collision ---------------------------------------------------------------------------------------------------

  /**
   * Moves along one axis and resolves penetration by snapping to the blocking face.
   * Returns the face normal hit (or null).
   */
  private moveAxis(axis: Axis, displacement: number, world: CollisionWorld): Vec3 | null {
    if (displacement === 0) {
      return null;
    }
    this.position[axis] = (this.position[axis] as number) + displacement;
    const bounds: Aabb = this.boundsAt(this.position);
    this.scratchColliders.length = 0;
    world.queryColliders(bounds, this.scratchColliders);
    let hitNormal: Vec3 | null = null;
    const skin: number = this.tuning.skinWidth;
    const halfWidth: number = this.tuning.halfWidth;
    for (const collider of this.scratchColliders) {
      const current: Aabb = this.boundsAt(this.position);
      if (!aabbOverlaps(current, collider)) {
        continue;
      }
      if (displacement > 0) {
        // Moving +axis: our max face rests against the collider's min face.
        const extent: number = axis === 1 ? this.currentHeight : halfWidth;
        this.position[axis] = (collider.minimum[axis] as number) - extent - skin;
        hitNormal = [0, 0, 0];
        hitNormal[axis] = -1;
      } else {
        const extent: number = axis === 1 ? 0 : halfWidth;
        this.position[axis] = (collider.maximum[axis] as number) + extent + skin;
        hitNormal = [0, 0, 0];
        hitNormal[axis] = 1;
      }
    }
    return hitNormal;
  }

  /**
   * Collision response:
   *   1. clip:   v ← v − n·(v·n)·overbounce          (removes the into-surface component)
   *   2. curve:  tangential retention r = lerp(r_min, 1, (1 − |v̂·n|)^k)
   *      Grazing contacts (|v̂·n| → 0) keep full speed; head-on impacts keep r_min of the slide speed.
   */
  private applyCollisionResponse(normal: Vec3, preImpactVelocity: Readonly<Vec3>): void {
    const speedBefore: number = Math.hypot(preImpactVelocity[0], preImpactVelocity[1], preImpactVelocity[2]);
    const into: number = this.velocity[0] * normal[0] + this.velocity[1] * normal[1] + this.velocity[2] * normal[2];
    if (into < 0) {
      this.velocity[0] -= normal[0] * into * this.tuning.overbounce;
      this.velocity[1] -= normal[1] * into * this.tuning.overbounce;
      this.velocity[2] -= normal[2] * into * this.tuning.overbounce;
    }
    if (normal[1] !== 0 || speedBefore < 1e-4) {
      return;
    }
    const impactCosine: number = Math.abs(
      (preImpactVelocity[0] * normal[0] + preImpactVelocity[1] * normal[1] + preImpactVelocity[2] * normal[2]) / speedBefore,
    );
    const retention: number = lerp(this.tuning.wallMinimumTangentRetention, 1, Math.pow(1 - impactCosine, this.tuning.wallResponseExponent));
    this.velocity[0] *= retention;
    this.velocity[2] *= retention;
  }

  /** Attempts a horizontal move with automatic step-up over obstacles shorter than `stepHeight`. */
  private moveHorizontal(axis: 0 | 2, displacement: number, world: CollisionWorld): void {
    if (displacement === 0) {
      return;
    }
    const before: Vec3 = [this.position[0], this.position[1], this.position[2]];
    const preImpactVelocity: Vec3 = [this.velocity[0], this.velocity[1], this.velocity[2]];
    const hit: Vec3 | null = this.moveAxis(axis, displacement, world);
    if (hit === null) {
      return;
    }
    if (this.isGrounded) {
      // Step-up: lift by stepHeight, retry the full displacement, then settle back down onto the step.
      const lifted: Vec3 = [before[0], before[1] + this.tuning.stepHeight, before[2]];
      if (!this.overlapsWorld(this.boundsAt(lifted), world)) {
        const steppedTarget: Vec3 = [lifted[0], lifted[1], lifted[2]];
        steppedTarget[axis] = (steppedTarget[axis] as number) + displacement;
        if (!this.overlapsWorld(this.boundsAt(steppedTarget), world)) {
          this.position = steppedTarget;
          this.moveAxis(1, -this.tuning.stepHeight - 0.01, world);
          return;
        }
      }
    }
    this.applyCollisionResponse(hit, preImpactVelocity);
  }

  /** Translates the character by `delta` with full collision (used by tether constraint projection). */
  public translateWithCollision(delta: Readonly<Vec3>, world: CollisionWorld): void {
    this.moveAxis(1, delta[1], world);
    this.moveHorizontal(0, delta[0], world);
    this.moveHorizontal(2, delta[2], world);
  }

  // ---- Step --------------------------------------------------------------------------------------------------------

  public step(deltaSeconds: number, intent: MotorIntent, world: CollisionWorld, externalAcceleration: Readonly<Vec3>): MotorStepReport {
    const tuning: CharacterMotorTuning = this.tuning;
    const blockedByCeilingOnStand: boolean = this.resolveStance(intent, world);
    const coefficients: StanceCoefficients = tuning.stances[this.stance];

    // Jump buffering and coyote time.
    this.jumpBufferRemaining = intent.jumpPressed ? tuning.jumpBufferSeconds : Math.max(0, this.jumpBufferRemaining - deltaSeconds);
    this.secondsSinceGrounded = this.isGrounded ? 0 : this.secondsSinceGrounded + deltaSeconds;
    let jumpedThisStep = false;
    if (this.jumpBufferRemaining > 0 && this.secondsSinceGrounded <= tuning.coyoteSeconds && !this.isCrouching) {
      this.velocity[1] = tuning.jumpVelocity;
      this.isGrounded = false;
      this.secondsSinceGrounded = tuning.coyoteSeconds + 1;
      this.jumpBufferRemaining = 0;
      jumpedThisStep = true;
    }

    // Wish direction in world space from yaw (yaw 0 faces -Z).
    let forwardInput: number = clamp(intent.moveForward, -1, 1);
    let rightInput: number = clamp(intent.moveRight, -1, 1);
    const inputMagnitude: number = Math.hypot(forwardInput, rightInput);
    if (inputMagnitude > 1) {
      forwardInput /= inputMagnitude;
      rightInput /= inputMagnitude;
    }
    const sinYaw: number = Math.sin(intent.yawRadians);
    const cosYaw: number = Math.cos(intent.yawRadians);
    const wishX: number = -sinYaw * forwardInput + cosYaw * rightInput;
    const wishZ: number = -cosYaw * forwardInput - sinYaw * rightInput;
    const wishLength: number = Math.hypot(wishX, wishZ);
    const wishDirectionX: number = wishLength > 1e-5 ? wishX / wishLength : 0;
    const wishDirectionZ: number = wishLength > 1e-5 ? wishZ / wishLength : 0;
    const wishSpeed: number = coefficients.maximumSpeed * Math.min(1, wishLength);

    if (this.isGrounded && !jumpedThisStep) {
      this.applyFriction(coefficients, deltaSeconds);
      this.accelerate(wishDirectionX, wishDirectionZ, wishSpeed, coefficients.acceleration, wishSpeed, deltaSeconds);
    } else {
      this.accelerate(wishDirectionX, wishDirectionZ, wishSpeed, tuning.airAcceleration, tuning.airWishSpeedCap, deltaSeconds);
    }

    // External forces (tether tension) and gravity.
    this.velocity[0] += externalAcceleration[0] * deltaSeconds;
    this.velocity[1] += (externalAcceleration[1] - tuning.gravity) * deltaSeconds;
    this.velocity[2] += externalAcceleration[2] * deltaSeconds;
    this.velocity[1] = Math.max(this.velocity[1], -tuning.terminalVelocity);

    // Stamina.
    const isRunning: boolean = this.stance === 'run' && this.horizontalSpeed > coefficients.maximumSpeed * 0.5;
    this.stamina = clamp(this.stamina + (isRunning ? -tuning.staminaDrainPerSecond : tuning.staminaRegenPerSecond) * deltaSeconds, 0, 1);

    // Sub-stepped axis-separated sweep: vertical first (establishes grounding), then X, then Z.
    const wasGrounded: boolean = this.isGrounded;
    const fallSpeedBeforeMove: number = -this.velocity[1];
    const travel: number = Math.hypot(this.velocity[0], this.velocity[1], this.velocity[2]) * deltaSeconds;
    const substeps: number = Math.max(1, Math.ceil(travel / tuning.maximumSubstepDistance));
    const substepSeconds: number = deltaSeconds / substeps;
    this.isGrounded = false;
    for (let substep = 0; substep < substeps; substep += 1) {
      const verticalVelocity: number = this.velocity[1];
      const verticalHit: Vec3 | null = this.moveAxis(1, verticalVelocity * substepSeconds, world);
      if (verticalHit !== null) {
        if ((verticalHit[1] as number) > 0) {
          this.isGrounded = true;
        }
        this.velocity[1] = 0;
      }
      this.moveHorizontal(0, this.velocity[0] * substepSeconds, world);
      this.moveHorizontal(2, this.velocity[2] * substepSeconds, world);
    }
    // Ground probe: stay grounded on flat floors even when vertical speed was zeroed this frame.
    if (!this.isGrounded && this.velocity[1] <= 0) {
      const probe: Aabb = this.boundsAt([this.position[0], this.position[1] - 0.04, this.position[2]]);
      if (this.overlapsWorld(probe, world)) {
        this.isGrounded = true;
      }
    }

    // Crouch eye smoothing: e ← e + (target − e)·(1 − exp(−k·dt)).
    const targetEyeHeight: number = this.isCrouching ? tuning.crouchingEyeHeight : tuning.standingEyeHeight;
    this.smoothedEyeHeight = damp(this.smoothedEyeHeight, targetEyeHeight, tuning.crouchTransitionSharpness, deltaSeconds);

    const landedThisStep: boolean = !wasGrounded && this.isGrounded;
    return {
      landedThisStep,
      landingImpactSpeed: landedThisStep ? Math.max(0, fallSpeedBeforeMove) : 0,
      jumpedThisStep,
      blockedByCeilingOnStand,
    };
  }
}
