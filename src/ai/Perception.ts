import type { HearingSpec, VisionSpec } from './ThreatProfiles';
import type { Vec3 } from '../math/Vec3';
import { clamp, lerp, vec3Dot, vec3Subtract } from '../math/Vec3';
import type { WorldRayHit } from '../world/LevelStreamer';

/** Anything perception can cast rays against. Implemented by LevelStreamer. */
export interface PerceptionWorld {
  raycast(origin: Readonly<Vec3>, direction: Readonly<Vec3>, maximumDistance: number): WorldRayHit | null;
}

export type NoiseSource =
  | 'footstepWalk'
  | 'footstepRun'
  | 'footstepCrouch'
  | 'landing'
  | 'tetherFire'
  | 'tetherImpact'
  | 'relayEngaged'
  | 'gateMoving'
  | 'breakerSwitch'
  | 'alarm'
  | 'strainedBreathing';

/** Base audible radius (m) and loudness (0..1) for every noise source, before profile multipliers. */
export const NOISE_SIGNATURES: Readonly<Record<NoiseSource, { readonly radius: number; readonly loudness: number }>> = {
  footstepWalk: { radius: 5, loudness: 0.35 },
  footstepRun: { radius: 11, loudness: 0.7 },
  footstepCrouch: { radius: 1.6, loudness: 0.12 },
  landing: { radius: 9, loudness: 0.75 },
  tetherFire: { radius: 8, loudness: 0.55 },
  tetherImpact: { radius: 10, loudness: 0.65 },
  relayEngaged: { radius: 14, loudness: 0.8 },
  gateMoving: { radius: 16, loudness: 0.85 },
  breakerSwitch: { radius: 7, loudness: 0.5 },
  alarm: { radius: 40, loudness: 1 },
  strainedBreathing: { radius: 3, loudness: 0.3 },
};

export interface NoiseEvent {
  readonly source: NoiseSource;
  readonly position: Vec3;
  readonly radius: number;
  readonly loudness: number;
  readonly emittedAtSeconds: number;
}

/** Short-lived buffer of noises; every threat samples it each tick. */
export class NoiseChannel {
  private readonly events: NoiseEvent[] = [];
  /** Noises stay audible for this long so threats ticking on the next frame still hear them. */
  public lifetimeSeconds: number = 0.3;

  public emit(source: NoiseSource, position: Readonly<Vec3>, nowSeconds: number, loudnessScale: number = 1): NoiseEvent {
    const signature = NOISE_SIGNATURES[source];
    const event: NoiseEvent = {
      source,
      position: [position[0], position[1], position[2]],
      radius: signature.radius * Math.sqrt(Math.max(0, loudnessScale)),
      loudness: clamp(signature.loudness * loudnessScale, 0, 1),
      emittedAtSeconds: nowSeconds,
    };
    this.events.push(event);
    return event;
  }

  public prune(nowSeconds: number): void {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      if (nowSeconds - (this.events[index] as NoiseEvent).emittedAtSeconds > this.lifetimeSeconds) {
        this.events.splice(index, 1);
      }
    }
  }

  public get active(): readonly NoiseEvent[] {
    return this.events;
  }

  public clear(): void {
    this.events.length = 0;
  }
}

/** Everything perception needs to know about the player this frame. */
export interface PlayerSignature {
  readonly eyePosition: Vec3;
  readonly chestPosition: Vec3;
  readonly feetPosition: Vec3;
  readonly viewDirection: Vec3;
  readonly isCrouching: boolean;
  /** 0 (pitch dark) .. 1 (well lit), from the lighting system. */
  readonly lightExposure: number;
}

export interface SightResult {
  readonly visible: boolean;
  /** 0..1 detection strength this frame. */
  readonly score: number;
  readonly distance: number;
  readonly withinProximity: boolean;
}

export interface HearingResult {
  /** 0..1 strongest heard noise this frame. */
  readonly strength: number;
  readonly position: Vec3 | null;
  readonly source: NoiseSource | null;
}

/** Light exposure from raw illuminance: x = 1 − e^(−k·E), k = 1.4. */
export function lightExposureFromIlluminance(illuminance: number): number {
  return 1 - Math.exp(-1.4 * Math.max(0, illuminance));
}

/**
 * Unobstructed segment test: the ray from `from` toward `to` must not hit anything before reaching
 * within `tolerance` of the target.
 */
export function hasLineOfSight(world: PerceptionWorld, from: Readonly<Vec3>, to: Readonly<Vec3>, tolerance: number = 0.35): boolean {
  const delta: Vec3 = vec3Subtract(to, from);
  const distance: number = Math.hypot(delta[0], delta[1], delta[2]);
  if (distance < 1e-4) {
    return true;
  }
  const direction: Vec3 = [delta[0] / distance, delta[1] / distance, delta[2] / distance];
  const hit: WorldRayHit | null = world.raycast(from, direction, distance);
  return hit === null || hit.distance >= distance - tolerance;
}

/**
 * Sight evaluation.
 *   d = |p_target − p_eye|;   d > range → not visible
 *   cosθ = ê_forward · (p_target − p_eye)/d
 *   zone: proximity (d ≤ r_prox) → weight 1 regardless of θ
 *         central   (θ ≤ θ_c)    → weight 1
 *         peripheral (θ ≤ θ_p ∧ d ≤ range·k_p) → weight w_p
 *         otherwise  → not visible
 *   line of sight: at least one of {eye, chest} sample points unobstructed
 *   score = weight · (1 − (d/range)²) · lerp(1 − λ, 1, exposure) · (crouched ∧ ¬proximity ? c : 1)
 */
export function evaluateSight(
  world: PerceptionWorld,
  observerEye: Readonly<Vec3>,
  observerForward: Readonly<Vec3>,
  target: PlayerSignature,
  vision: VisionSpec,
): SightResult {
  const toTarget: Vec3 = vec3Subtract(target.chestPosition, observerEye);
  const distance: number = Math.hypot(toTarget[0], toTarget[1], toTarget[2]);
  const notVisible: SightResult = { visible: false, score: 0, distance, withinProximity: false };
  if (distance > vision.range || distance < 1e-4) {
    return distance < 1e-4 ? { visible: true, score: 1, distance, withinProximity: true } : notVisible;
  }
  const direction: Vec3 = [toTarget[0] / distance, toTarget[1] / distance, toTarget[2] / distance];
  const cosine: number = vec3Dot(observerForward, direction);
  const withinProximity: boolean = distance <= vision.proximityRadius;
  let weight = 0;
  if (withinProximity || cosine >= Math.cos(vision.centralHalfAngle)) {
    weight = 1;
  } else if (cosine >= Math.cos(vision.peripheralHalfAngle) && distance <= vision.range * vision.peripheralRangeFactor) {
    weight = vision.peripheralWeight;
  }
  if (weight <= 0) {
    return notVisible;
  }
  const lineOfSight: boolean = hasLineOfSight(world, observerEye, target.eyePosition) || hasLineOfSight(world, observerEye, target.chestPosition);
  if (!lineOfSight) {
    return notVisible;
  }
  const distanceFactor: number = 1 - (distance / vision.range) * (distance / vision.range);
  const lightFactor: number = lerp(1 - vision.lightDependence, 1, clamp(target.lightExposure, 0, 1));
  const crouchFactor: number = target.isCrouching && !withinProximity ? vision.crouchVisibilityFactor : 1;
  const score: number = clamp(weight * distanceFactor * lightFactor * crouchFactor, 0, 1);
  return { visible: score > 0.01, score, distance, withinProximity };
}

/**
 * Hearing evaluation over the active noise buffer:
 *   R = r_noise · m_hearing;   d > R → inaudible
 *   strength = loudness · (1 − d/R) · (occluded ? k_occ : 1)
 * Returns the strongest noise heard.
 */
export function evaluateHearing(world: PerceptionWorld, listenerPosition: Readonly<Vec3>, noises: readonly NoiseEvent[], hearing: HearingSpec): HearingResult {
  let best: HearingResult = { strength: 0, position: null, source: null };
  for (const noise of noises) {
    const audibleRadius: number = noise.radius * hearing.radiusMultiplier;
    const distance: number = Math.hypot(noise.position[0] - listenerPosition[0], noise.position[1] - listenerPosition[1], noise.position[2] - listenerPosition[2]);
    if (distance > audibleRadius) {
      continue;
    }
    const occluded: boolean = !hasLineOfSight(world, listenerPosition, noise.position, 0.5);
    const strength: number = noise.loudness * (1 - distance / audibleRadius) * (occluded ? hearing.occlusionFactor : 1);
    if (strength > best.strength) {
      best = { strength, position: noise.position, source: noise.source };
    }
  }
  return best;
}

/**
 * Look-away test from the player's side: the threat point must lie inside the player's view cone
 * (ê_view · d̂ ≥ cos θ_obs) with an unobstructed line from the player's eye.
 */
export function isPointObservedByPlayer(world: PerceptionWorld, point: Readonly<Vec3>, player: PlayerSignature, halfAngle: number): boolean {
  if (halfAngle <= 0) {
    return false;
  }
  const toPoint: Vec3 = vec3Subtract(point, player.eyePosition);
  const distance: number = Math.hypot(toPoint[0], toPoint[1], toPoint[2]);
  if (distance < 1e-4) {
    return true;
  }
  const cosine: number = vec3Dot(player.viewDirection, [toPoint[0] / distance, toPoint[1] / distance, toPoint[2] / distance]);
  return cosine >= Math.cos(halfAngle) && hasLineOfSight(world, player.eyePosition, point, 0.6);
}
