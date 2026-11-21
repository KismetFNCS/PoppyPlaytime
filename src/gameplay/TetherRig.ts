import type { ImportedMeshId } from '../assets/AssetManifest';
import type { MeshLibrary } from '../assets/MeshLibrary';
import type { PerspectiveCamera } from '../graphics/Camera';
import { createCylinderMesh } from '../graphics/Geometry';
import { GpuMesh } from '../graphics/GpuMesh';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4FromBasis, orthonormalBasisFromForward } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { clamp, vec3Add, vec3Distance, vec3Dot, vec3Lerp, vec3Normalize, vec3Scale, vec3Subtract } from '../math/Vec3';
import type { CharacterMotor, CollisionWorld } from './CharacterMotor';
import type { TypedEventBus } from './TypedEventBus';
import type { Polarity, TetherTarget, TetherTargetKind, WorldRayHit } from '../world/LevelStreamer';

export type ClawSide = 'left' | 'right';
export type ClawPhase = 'holstered' | 'extending' | 'latched' | 'retracting';

/** The rig needs ray casts on top of box collision. */
export interface TetherWorld extends CollisionWorld {
  raycast(origin: Readonly<Vec3>, direction: Readonly<Vec3>, maximumDistance: number): WorldRayHit | null;
}

export interface TetherEventMap {
  clawFired: { readonly side: ClawSide; readonly polarity: Polarity; readonly origin: Vec3; readonly direction: Vec3 };
  clawLatched: { readonly side: ClawSide; readonly polarity: Polarity; readonly target: TetherTarget; readonly point: Vec3 };
  clawDeflected: { readonly side: ClawSide; readonly polarity: Polarity; readonly point: Vec3; readonly normal: Vec3 };
  clawRangeLimit: { readonly side: ClawSide; readonly polarity: Polarity; readonly point: Vec3 };
  clawRetracted: { readonly side: ClawSide; readonly polarity: Polarity };
  plateActivated: { readonly plateId: string; readonly polarity: Polarity; readonly side: ClawSide };
  plateRejected: { readonly plateId: string; readonly platePolarity: Polarity; readonly clawPolarity: Polarity; readonly side: ClawSide };
}

export interface TetherRigTuning {
  /** Claw muzzle speed (m/s). */
  readonly launchSpeed: number;
  /** Physical cable length limit; the claw can never be farther than this from its socket while extending. */
  readonly maximumRange: number;
  readonly retractBaseSpeed: number;
  /** Retraction speeds up over time: v(t) = v0 + a·t. */
  readonly retractAcceleration: number;
  /** How long a claw stays seated on a relay plate before auto-retracting. */
  readonly plateContactSeconds: number;
  /** Spring stiffness k (acceleration per metre of stretch). */
  readonly springStiffness: number;
  /** Spring damping c (acceleration per m/s of separation speed). */
  readonly springDamping: number;
  /** Rope may stretch this far past rest length before the hard distance constraint engages. */
  readonly maximumStretch: number;
  readonly reelSpeed: number;
  readonly minimumRopeLength: number;
  /** On latch, rest length = latch distance × factor (< 1 gives an initial tug). */
  readonly latchRestLengthFactor: number;
  /** Rate at which the rig winds slack in toward an anchor's preferred rope length after latching (m/s). */
  readonly autoReelSpeed: number;
  /** Tangential "pump" acceleration players can add while swinging, along the camera's flat forward. */
  readonly swingPumpAcceleration: number;
  readonly cableSegmentCount: number;
  readonly cableSagPerSlackMeter: number;
}

export const DEFAULT_TETHER_RIG_TUNING: TetherRigTuning = {
  launchSpeed: 38,
  maximumRange: 20,
  retractBaseSpeed: 14,
  retractAcceleration: 55,
  plateContactSeconds: 0.8,
  springStiffness: 60,
  springDamping: 6.5,
  maximumStretch: 0.22,
  reelSpeed: 3.2,
  minimumRopeLength: 1.2,
  latchRestLengthFactor: 0.97,
  autoReelSpeed: 4,
  swingPumpAcceleration: 3.2,
  cableSegmentCount: 12,
  cableSagPerSlackMeter: 0.35,
};

export interface ClawState {
  readonly side: ClawSide;
  readonly polarity: Polarity;
  phase: ClawPhase;
  position: Vec3;
  /** Unit vector the claw is facing (travel direction while extending). */
  direction: Vec3;
  traveledDistance: number;
  phaseSeconds: number;
  target: TetherTarget | null;
  /** Rope rest length while latched to an anchor. */
  restLength: number;
  /** Remaining auto-reel goal for this latch (null once reached or for non-anchor targets). */
  autoReelTarget: number | null;
  triggerHeld: boolean;
}

export interface TetherControlInput {
  readonly leftTriggerPressed: boolean;
  readonly leftTriggerHeld: boolean;
  readonly rightTriggerPressed: boolean;
  readonly rightTriggerHeld: boolean;
  /** Positive shortens latched ropes, negative lengthens (metres per second request, scaled by reelSpeed). */
  readonly reelInput: number;
  /** Flat forward input for swing pumping (-1..1). */
  readonly pumpInput: number;
}

/** Camera-space socket offsets (right, up, forward) for each launcher barrel. */
const SOCKET_OFFSETS: Readonly<Record<ClawSide, Vec3>> = {
  left: [-0.23, -0.2, 0.44],
  right: [0.23, -0.2, 0.44],
};
/** Visual scale of the launched hands (collision uses the hand's centre point, not the mesh). */
const HAND_SCALE: number = 1.9;
/** Held (holstered) hands: smaller, raised beside each launcher. Offset is [outward, up, forward] in camera space. */
const HELD_HAND_SCALE: number = 1.45;
const HELD_HAND_OFFSET: Vec3 = [0.09, 0.0, 0.07];
const SIDE_POLARITY: Readonly<Record<ClawSide, Polarity>> = { left: 'teal', right: 'rose' };
const CLAW_MODEL: Readonly<Record<Polarity, ImportedMeshId>> = { teal: 'tether_claw_teal', rose: 'tether_claw_rose' };
/** Targets a hand wraps its fingers around (swing anchors now; levers, crates and pull handles as they are added). */
const GRIPPABLE_TARGETS: ReadonlySet<TetherTargetKind> = new Set<TetherTargetKind>(['anchor']);
/** Gripping variant shown while a hand is latched onto something it can hold. */
const CLAMPED_MODEL: Readonly<Record<Polarity, ImportedMeshId>> = { teal: 'tether_claw_teal_clamped', rose: 'tether_claw_rose_clamped' };

/**
 * Tether Rig: two wrist launchers, each firing a polarity-coded steel hand on a cable.
 *
 * Claw state machine:  holstered → extending → (latched | retracting) → retracting → holstered
 *  - extending: forward projection loop, swept ray per frame, distance clamped to `maximumRange`
 *  - latched:   anchors hold while the trigger is held (spring cable physics); relay plates auto-release
 *  - retracting: accelerating return toward the moving socket
 */
export class TetherRig {
  public readonly claws: Readonly<Record<ClawSide, ClawState>>;
  private readonly cableMesh: GpuMesh;
  private cameraBasis: { origin: Vec3; right: Vec3; up: Vec3; forward: Vec3 } = { origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] };

  public constructor(
    gl: WebGL2RenderingContext,
    private readonly meshes: MeshLibrary,
    private readonly events: TypedEventBus<TetherEventMap>,
    public readonly tuning: TetherRigTuning = DEFAULT_TETHER_RIG_TUNING,
  ) {
    const createClaw = (side: ClawSide): ClawState => ({
      side,
      polarity: SIDE_POLARITY[side],
      phase: 'holstered',
      position: [0, 0, 0],
      direction: [0, 0, -1],
      traveledDistance: 0,
      phaseSeconds: 0,
      target: null,
      restLength: 0,
      autoReelTarget: null,
      triggerHeld: false,
    });
    this.claws = { left: createClaw('left'), right: createClaw('right') };
    // Unit cable segment: radius 1 cm, length 1 m along +Y, centred at the origin.
    this.cableMesh = new GpuMesh(gl, 'tether.cable', createCylinderMesh(0.011, 0.011, 1, 6));
  }

  // ---- Geometry helpers ------------------------------------------------------------------------------------------

  /** Captures the camera frame once per update so sockets follow the view. */
  public syncCamera(camera: PerspectiveCamera): void {
    const forward: Vec3 = camera.forward;
    const right: Vec3 = vec3Normalize([Math.cos(camera.yawRadians), 0, -Math.sin(camera.yawRadians)]);
    const up: Vec3 = vec3Normalize([
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ]);
    this.cameraBasis = { origin: [camera.position[0], camera.position[1], camera.position[2]], right, up, forward };
  }

  /** socket = eye + right·o_x + up·o_y + forward·o_z */
  public socketPosition(side: ClawSide): Vec3 {
    const offset: Vec3 = SOCKET_OFFSETS[side];
    const basis = this.cameraBasis;
    return vec3Add(basis.origin, vec3Add(vec3Scale(basis.right, offset[0]), vec3Add(vec3Scale(basis.up, offset[1]), vec3Scale(basis.forward, offset[2]))));
  }

  /** Where the cosmetic hand fill light sits: just below and in front of the eye, between the hands. */
  public handFillPosition(): Vec3 {
    const basis = this.cameraBasis;
    return vec3Add(basis.origin, vec3Add(vec3Scale(basis.up, -0.05), vec3Scale(basis.forward, 0.12)));
  }

  public get isAnchored(): boolean {
    return (Object.values(this.claws) as ClawState[]).some((claw: ClawState) => claw.phase === 'latched' && claw.target?.kind === 'anchor');
  }

  private setPhase(claw: ClawState, phase: ClawPhase): void {
    claw.phase = phase;
    claw.phaseSeconds = 0;
  }

  // ---- Firing ------------------------------------------------------------------------------------------------------

  /**
   * Fire: the claw leaves its socket aimed at the crosshair's world point so both sides converge.
   *   aimPoint = eye + forward · t_hit   (t_hit from a centre ray, or maximumRange on a miss)
   *   d̂ = normalize(aimPoint − socket)
   */
  private fire(claw: ClawState, world: TetherWorld): void {
    if (claw.phase !== 'holstered') {
      return;
    }
    const basis = this.cameraBasis;
    const centreHit: WorldRayHit | null = world.raycast(basis.origin, basis.forward, this.tuning.maximumRange);
    const aimDistance: number = centreHit !== null ? centreHit.distance : this.tuning.maximumRange;
    const aimPoint: Vec3 = vec3Add(basis.origin, vec3Scale(basis.forward, aimDistance));
    const socket: Vec3 = this.socketPosition(claw.side);
    const direction: Vec3 = vec3Normalize(vec3Subtract(aimPoint, socket));
    claw.position = socket;
    claw.direction = direction[0] === 0 && direction[1] === 0 && direction[2] === 0 ? basis.forward : direction;
    claw.traveledDistance = 0;
    claw.target = null;
    this.setPhase(claw, 'extending');
    this.events.emit('clawFired', { side: claw.side, polarity: claw.polarity, origin: socket, direction: claw.direction });
  }

  public forceRetract(side: ClawSide): void {
    const claw: ClawState = this.claws[side];
    if (claw.phase === 'extending' || claw.phase === 'latched') {
      claw.target = null;
      this.setPhase(claw, 'retracting');
    }
  }

  // ---- Per-frame claw update -----------------------------------------------------------------------------------------

  /**
   * Forward projection loop for an extending claw:
   *   step = min(v_launch · dt, R_max − traveled)
   *   sweep ray from p along d̂ for `step`; on hit → latch/deflect at hit point
   *   else p ← p + d̂·step; traveled ← traveled + step; traveled ≥ R_max → retract (range limit)
   */
  private updateExtending(claw: ClawState, world: TetherWorld, deltaSeconds: number): void {
    const remaining: number = this.tuning.maximumRange - claw.traveledDistance;
    const step: number = Math.min(this.tuning.launchSpeed * deltaSeconds, Math.max(0, remaining));
    const hit: WorldRayHit | null = step > 0 ? world.raycast(claw.position, claw.direction, step) : null;
    if (hit !== null) {
      if (hit.target !== null) {
        claw.position = [hit.target.attachPoint[0], hit.target.attachPoint[1], hit.target.attachPoint[2]];
        claw.direction = vec3Scale(hit.target.attachNormal, -1);
        claw.target = hit.target;
        if (hit.target.kind === 'anchor') {
          const socket: Vec3 = this.socketPosition(claw.side);
          claw.restLength = Math.max(this.tuning.minimumRopeLength, vec3Distance(socket, claw.position) * this.tuning.latchRestLengthFactor);
          const preferred: number | null = hit.target.preferredRopeLength;
          claw.autoReelTarget = preferred !== null && preferred < claw.restLength ? Math.max(this.tuning.minimumRopeLength, preferred) : null;
        } else {
          claw.autoReelTarget = null;
        }
        this.setPhase(claw, 'latched');
        this.events.emit('clawLatched', { side: claw.side, polarity: claw.polarity, target: hit.target, point: claw.position });
      } else {
        // Plain surface: the magnet finds no polarity contact and the claw rebounds.
        claw.position = vec3Add(hit.point, vec3Scale(hit.normal, 0.05));
        this.setPhase(claw, 'retracting');
        this.events.emit('clawDeflected', { side: claw.side, polarity: claw.polarity, point: hit.point, normal: hit.normal });
      }
      return;
    }
    claw.position = vec3Add(claw.position, vec3Scale(claw.direction, step));
    claw.traveledDistance += step;
    if (claw.traveledDistance >= this.tuning.maximumRange - 1e-4) {
      this.setPhase(claw, 'retracting');
      this.events.emit('clawRangeLimit', { side: claw.side, polarity: claw.polarity, point: claw.position });
    }
  }

  /**
   * Retraction toward the moving socket:
   *   v(t) = v0 + a·t;  Δ = socket − p;  if |Δ| ≤ v·dt → holstered;  else p ← p + Δ̂ · v·dt
   * The claw keeps facing away from the socket so it lands talons-first.
   */
  private updateRetracting(claw: ClawState, deltaSeconds: number): void {
    const socket: Vec3 = this.socketPosition(claw.side);
    const toSocket: Vec3 = vec3Subtract(socket, claw.position);
    const distance: number = Math.hypot(toSocket[0], toSocket[1], toSocket[2]);
    const speed: number = this.tuning.retractBaseSpeed + this.tuning.retractAcceleration * claw.phaseSeconds;
    const step: number = speed * deltaSeconds;
    if (distance <= step || distance < 1e-3) {
      claw.position = socket;
      claw.target = null;
      this.setPhase(claw, 'holstered');
      this.events.emit('clawRetracted', { side: claw.side, polarity: claw.polarity });
      return;
    }
    const towardSocket: Vec3 = vec3Scale(toSocket, 1 / distance);
    claw.position = vec3Add(claw.position, vec3Scale(towardSocket, step));
    claw.direction = vec3Scale(towardSocket, -1);
  }

  private updateLatched(claw: ClawState, input: TetherControlInput, deltaSeconds: number): void {
    const target: TetherTarget | null = claw.target;
    if (target === null) {
      this.setPhase(claw, 'retracting');
      return;
    }
    if (target.kind === 'relayPlate') {
      if (claw.phaseSeconds >= this.tuning.plateContactSeconds) {
        this.setPhase(claw, 'retracting');
        claw.target = null;
      }
      return;
    }
    if (!claw.triggerHeld) {
      this.setPhase(claw, 'retracting');
      claw.target = null;
      return;
    }
    // Auto-reel: L ← max(L*, L − v_auto·dt) until the anchor's preferred length L* is reached.
    if (claw.autoReelTarget !== null) {
      claw.restLength = Math.max(claw.autoReelTarget, claw.restLength - this.tuning.autoReelSpeed * deltaSeconds);
      if (claw.restLength <= claw.autoReelTarget + 1e-4) {
        claw.autoReelTarget = null;
      }
    }
    // Manual reel: L ← clamp(L − reel·v_reel·dt, L_min, R_max)
    claw.restLength = clamp(claw.restLength - input.reelInput * this.tuning.reelSpeed * deltaSeconds, this.tuning.minimumRopeLength, this.tuning.maximumRange);
  }

  /** Advances both claws. Call before the motor step. */
  public update(deltaSeconds: number, input: TetherControlInput, world: TetherWorld, camera: PerspectiveCamera): void {
    this.syncCamera(camera);
    const triggers: Record<ClawSide, { pressed: boolean; held: boolean }> = {
      left: { pressed: input.leftTriggerPressed, held: input.leftTriggerHeld },
      right: { pressed: input.rightTriggerPressed, held: input.rightTriggerHeld },
    };
    for (const side of ['left', 'right'] as const) {
      const claw: ClawState = this.claws[side];
      claw.triggerHeld = triggers[side].held;
      claw.phaseSeconds += deltaSeconds;
      if (triggers[side].pressed) {
        this.fire(claw, world);
      }
      switch (claw.phase) {
        case 'holstered':
          claw.position = this.socketPosition(side);
          claw.direction = this.cameraBasis.forward;
          break;
        case 'extending':
          this.updateExtending(claw, world, deltaSeconds);
          break;
        case 'latched':
          this.updateLatched(claw, input, deltaSeconds);
          break;
        case 'retracting':
          this.updateRetracting(claw, deltaSeconds);
          break;
      }
    }
  }

  // ---- Cable physics --------------------------------------------------------------------------------------------------

  /**
   * Spring-tension acceleration on the player from every anchored cable (a rope only pulls, never pushes):
   *   Δ = anchor − origin,  d = |Δ|,  û = Δ / d
   *   if d ≤ L: a = 0 (slack)
   *   stretch s = d − L;  separation speed ṡ = −(v · û)   (positive when moving away from the anchor)
   *   F = max(0, k·s + c·ṡ);  a = û · F
   * Plus swing pumping along the camera's flat forward, projected onto the plane ⟂ û so it only adds tangential energy:
   *   p = f − û(f·û);  a += p̂ · pump · input
   */
  public computeTensionAcceleration(motor: CharacterMotor): Vec3 {
    const acceleration: Vec3 = [0, 0, 0];
    const origin: Vec3 = motor.shoulderPosition;
    for (const claw of Object.values(this.claws) as ClawState[]) {
      if (claw.phase !== 'latched' || claw.target?.kind !== 'anchor') {
        continue;
      }
      const toAnchor: Vec3 = vec3Subtract(claw.position, origin);
      const distance: number = Math.hypot(toAnchor[0], toAnchor[1], toAnchor[2]);
      if (distance <= claw.restLength || distance < 1e-4) {
        continue;
      }
      const unit: Vec3 = vec3Scale(toAnchor, 1 / distance);
      const stretch: number = distance - claw.restLength;
      const separationSpeed: number = -vec3Dot(motor.velocity, unit);
      const force: number = Math.max(0, this.tuning.springStiffness * stretch + this.tuning.springDamping * separationSpeed);
      acceleration[0] += unit[0] * force;
      acceleration[1] += unit[1] * force;
      acceleration[2] += unit[2] * force;
    }
    return acceleration;
  }

  public computePumpAcceleration(motor: CharacterMotor, pumpInput: number): Vec3 {
    if (!this.isAnchored || motor.isGrounded || Math.abs(pumpInput) < 1e-3) {
      return [0, 0, 0];
    }
    const flatForward: Vec3 = vec3Normalize([this.cameraBasis.forward[0], 0, this.cameraBasis.forward[2]]);
    const result: Vec3 = [0, 0, 0];
    const origin: Vec3 = motor.shoulderPosition;
    for (const claw of Object.values(this.claws) as ClawState[]) {
      if (claw.phase !== 'latched' || claw.target?.kind !== 'anchor') {
        continue;
      }
      const unit: Vec3 = vec3Normalize(vec3Subtract(claw.position, origin));
      const projected: Vec3 = vec3Subtract(flatForward, vec3Scale(unit, vec3Dot(flatForward, unit)));
      const projectedUnit: Vec3 = vec3Normalize(projected);
      result[0] += projectedUnit[0] * this.tuning.swingPumpAcceleration * pumpInput;
      result[1] += projectedUnit[1] * this.tuning.swingPumpAcceleration * pumpInput;
      result[2] += projectedUnit[2] * this.tuning.swingPumpAcceleration * pumpInput;
    }
    return result;
  }

  /**
   * Hard distance constraint after integration (prevents the spring from over-stretching at high speed):
   *   L_max = L + s_max;  if d > L_max: translate by û·(d − L_max) with collision;
   *   radial velocity v_r = v·û; if v_r < 0 (moving away): v ← v − û·v_r
   */
  public enforceDistanceConstraints(motor: CharacterMotor, world: CollisionWorld): void {
    for (const claw of Object.values(this.claws) as ClawState[]) {
      if (claw.phase !== 'latched' || claw.target?.kind !== 'anchor') {
        continue;
      }
      const origin: Vec3 = motor.shoulderPosition;
      const toAnchor: Vec3 = vec3Subtract(claw.position, origin);
      const distance: number = Math.hypot(toAnchor[0], toAnchor[1], toAnchor[2]);
      const maximumLength: number = claw.restLength + this.tuning.maximumStretch;
      if (distance <= maximumLength || distance < 1e-4) {
        continue;
      }
      const unit: Vec3 = vec3Scale(toAnchor, 1 / distance);
      motor.translateWithCollision(vec3Scale(unit, distance - maximumLength), world);
      const radialVelocity: number = vec3Dot(motor.velocity, unit);
      if (radialVelocity < 0) {
        motor.velocity[0] -= unit[0] * radialVelocity;
        motor.velocity[1] -= unit[1] * radialVelocity;
        motor.velocity[2] -= unit[2] * radialVelocity;
      }
    }
  }

  /** Releases ropes whose span exceeds the physical cable (e.g. after a teleport). */
  public enforceCableLimit(): void {
    for (const side of ['left', 'right'] as const) {
      const claw: ClawState = this.claws[side];
      if (claw.phase === 'latched' && vec3Distance(this.socketPosition(side), claw.position) > this.tuning.maximumRange * 1.15) {
        this.forceRetract(side);
      }
    }
  }

  public reset(): void {
    for (const side of ['left', 'right'] as const) {
      const claw: ClawState = this.claws[side];
      claw.target = null;
      claw.traveledDistance = 0;
      this.setPhase(claw, 'holstered');
    }
  }

  // ---- Rendering ----------------------------------------------------------------------------------------------------

  private pushModel(output: DrawItem[], modelId: ImportedMeshId, matrix: Mat4, emissiveBoost: number): void {
    for (const part of this.meshes.get(modelId).parts) {
      output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: matrix, emissiveBoost });
    }
  }

  /**
   * Cable rendered as a sagging polyline:
   *   P(t) = lerp(a, b, t) − ŷ · sag · 4t(1 − t),  sag = slack · sagPerMetre  (slack = max(0, L_visual − |b − a|))
   * Each segment is a unit cylinder mapped onto [P_i, P_i+1] via the basis (x̂·r, ŷ·len, ẑ·r).
   */
  private pushCable(output: DrawItem[], start: Vec3, end: Vec3, slack: number): void {
    const sag: number = Math.max(0, slack) * this.tuning.cableSagPerSlackMeter;
    const segments: number = this.tuning.cableSegmentCount;
    let previous: Vec3 = start;
    for (let index = 1; index <= segments; index += 1) {
      const t: number = index / segments;
      const linear: Vec3 = vec3Lerp(start, end, t);
      const current: Vec3 = [linear[0], linear[1] - sag * 4 * t * (1 - t), linear[2]];
      const segment: Vec3 = vec3Subtract(current, previous);
      const segmentLength: number = Math.hypot(segment[0], segment[1], segment[2]);
      if (segmentLength > 1e-4) {
        const [xAxis, , zAxis] = orthonormalBasisFromForward(segment);
        const yAxis: Vec3 = vec3Scale(segment, 1 / segmentLength);
        const midpoint: Vec3 = vec3Lerp(previous, current, 0.5);
        output.push({ mesh: this.cableMesh, materialId: 'rusted_steel', modelMatrix: mat4FromBasis(midpoint, xAxis, vec3Scale(yAxis, segmentLength), zAxis) });
      }
      previous = current;
    }
  }

  public collectDrawItems(output: DrawItem[], timeSeconds: number): void {
    const basis = this.cameraBasis;
    for (const side of ['left', 'right'] as const) {
      const claw: ClawState = this.claws[side];
      const socket: Vec3 = this.socketPosition(side);
      // First person shows only the hands; the launchers stay out of view.
      const corePulse: number = claw.phase === 'latched' ? 2.2 : 0.8 + 0.2 * Math.sin(timeSeconds * 6 + (side === 'left' ? 0 : 1.7));
      if (claw.phase === 'holstered') {
        // Held: hand raised beside the launcher, fingers up, back of the hand toward the player, tilted slightly outward and forward.
        const outward: number = side === 'left' ? -1 : 1;
        const fingersUp: Vec3 = vec3Normalize(vec3Add(basis.up, vec3Add(vec3Scale(basis.forward, 0.3), vec3Scale(basis.right, outward * 0.18))));
        const [heldX, heldY, heldZ] = orthonormalBasisFromForward(fingersUp, vec3Scale(basis.forward, -1));
        const heldPosition: Vec3 = vec3Add(socket, vec3Add(vec3Scale(basis.right, outward * HELD_HAND_OFFSET[0]), vec3Add(vec3Scale(basis.up, HELD_HAND_OFFSET[1]), vec3Scale(basis.forward, HELD_HAND_OFFSET[2]))));
        this.pushModel(output, CLAW_MODEL[claw.polarity], mat4FromBasis(heldPosition, vec3Scale(heldX, HELD_HAND_SCALE), vec3Scale(heldY, HELD_HAND_SCALE), vec3Scale(heldZ, HELD_HAND_SCALE)), corePulse);
      } else {
        const target = claw.phase === 'latched' ? claw.target : null;
        if (target !== null && target !== undefined && !GRIPPABLE_TARGETS.has(target.kind)) {
          // Scanners and other press-targets: the open hand lies flat, palm on the surface, fingers pointing up.
          const normal: Vec3 = target.attachNormal;
          const worldUp: Vec3 = [0, 1, 0];
          const upOnSurface: Vec3 = vec3Normalize(vec3Subtract(worldUp, vec3Scale(normal, vec3Dot(worldUp, normal))));
          const [flatX, flatY, flatZ] = orthonormalBasisFromForward(upOnSurface, normal);
          const flatPosition: Vec3 = vec3Add(target.attachPoint, vec3Scale(normal, 0.022 * HAND_SCALE));
          this.pushModel(output, CLAW_MODEL[claw.polarity], mat4FromBasis(flatPosition, vec3Scale(flatX, HAND_SCALE), vec3Scale(flatY, HAND_SCALE), vec3Scale(flatZ, HAND_SCALE)), corePulse);
        } else {
          // In flight: fingers lead along the cable. Latched onto something meant to be held: the hand clamps shut around it.
          const [clawX, clawY, clawZ] = orthonormalBasisFromForward(claw.direction, basis.up);
          const model: ImportedMeshId = target !== null && target !== undefined ? CLAMPED_MODEL[claw.polarity] : CLAW_MODEL[claw.polarity];
          this.pushModel(output, model, mat4FromBasis(claw.position, vec3Scale(clawX, HAND_SCALE), vec3Scale(clawY, HAND_SCALE), vec3Scale(clawZ, HAND_SCALE)), corePulse);
        }
      }
      if (claw.phase !== 'holstered') {
        const span: number = vec3Distance(socket, claw.position);
        const visualLength: number =
          claw.phase === 'latched' && claw.target?.kind === 'anchor' ? claw.restLength : claw.phase === 'extending' ? claw.traveledDistance * 1.04 : span * 1.08;
        this.pushCable(output, socket, claw.position, visualLength - span);
      }
    }
  }

  public dispose(): void {
    this.cableMesh.dispose();
  }
}
