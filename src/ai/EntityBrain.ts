import type { NavigationGraph, NavigationWorld } from './NavigationGraph';
import type { HearingResult, NoiseEvent, PlayerSignature, SightResult } from './Perception';
import { evaluateHearing, evaluateSight, isPointObservedByPlayer } from './Perception';
import type { ThreatProfile, ThreatState } from './ThreatProfiles';
import type { Vec3 } from '../math/Vec3';
import { clamp } from '../math/Vec3';
import type { ThreatActorView } from '../world/JesterEntity';

/** Collision resolution for ground-bound bodies. Implemented by LevelStreamer. */
export interface BodyCollisionWorld extends NavigationWorld {
  resolveCircleCollision(position: Vec3, radius: number): Vec3;
}

export interface BrainContext {
  readonly world: BodyCollisionWorld;
  readonly navigation: NavigationGraph;
  readonly noises: readonly NoiseEvent[];
  readonly player: PlayerSignature;
  readonly nowSeconds: number;
  /** Scalar illuminance query used by light-freezing threats. */
  readonly illuminanceAt: (point: Readonly<Vec3>) => number;
}

export interface BrainTickReport {
  readonly stateChange: { readonly from: ThreatState; readonly to: ThreatState } | null;
  /** True on the frame the catch resolves (the kill). */
  readonly caughtPlayer: boolean;
  /** True on the frame the threat commits to Stalking/Hunting from a calmer state. */
  readonly spottedPlayer: boolean;
  readonly footstep: boolean;
  readonly idleCue: boolean;
  readonly observedByPlayer: boolean;
  readonly sight: SightResult;
  readonly hearing: HearingResult;
  readonly distanceToPlayer: number;
}

const WAYPOINT_REACHED_DISTANCE: number = 0.45;
const REPATH_TARGET_DRIFT: number = 1.5;

function wrapAngle(angle: number): number {
  let wrapped: number = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function horizontalDistance(first: Readonly<Vec3>, second: Readonly<Vec3>): number {
  return Math.hypot(first[0] - second[0], first[2] - second[2]);
}

/**
 * Per-threat finite state machine.
 *
 *   ┌────────────┐ awareness ≥ alert   ┌────────┐ awareness ≥ hunt ∧ perceived  ┌──────────┐
 *   │ Patrolling │ ──────────────────▶ │ Alert  │ ─────────────────────────────▶│ Stalking │ (stalkers, far)
 *   └────────────┘ ◀────────────────── └────────┘ ──────────────┐               └────┬─────┘
 *        ▲   search expired ∧ awareness < forget                 │ (non-stalkers      │ escalate: close / impatient /
 *        │                                                       ▼  or close)         ▼ player sprinting nearby
 *        │                                                  ┌─────────┐ d ≤ r_catch ┌───────────┐
 *        └──────── (lost track) ◀── Alert ◀──── lost track ──│ Hunting │ ───────────▶│ CatchKill │ → kill after wind-up
 *                                                           └─────────┘ ◀── escape ─└───────────┘
 */
/** Seconds a threat ignores further hand strikes after a stun ends. */
const STUN_RESIST_SECONDS: number = 4;

export class EntityBrain {
  public state: ThreatState = 'dormant';
  public awareness: number = 0;
  public lastKnownPlayerPosition: Vec3 | null = null;
  public secondsSincePerceived: number = Infinity;
  public stateSeconds: number = 0;
  public facingYaw: number;
  private investigatePoint: Vec3 | null = null;
  private searchSeconds: number = 0;
  private stalkSeconds: number = 0;
  private catchSeconds: number = 0;
  private catchResolved: boolean = false;
  /** Seconds left in a hand-strike stun (no movement, no catching). */
  public stunSeconds: number = 0;
  /** Entrance grace: awareness is capped below the alert threshold while this counts down. */
  public graceSeconds: number = 0;
  /** After a stun wears off the threat shrugs off further strikes for a while, so it can't be stun-locked. */
  public stunImmuneSeconds: number = 0;
  private path: Vec3[] | null = null;
  private pathIndex: number = 0;
  private pathTarget: Vec3 | null = null;
  private repathTimer: number = 0;
  private patrolIndex: number = 0;
  private strideAccumulator: number = 0;
  private idleCueTimer: number;
  private lastProcessedNoiseStamp: number = -Infinity;
  private pendingSpotted: boolean = false;

  public constructor(
    public readonly id: string,
    public readonly profile: ThreatProfile,
    public readonly view: ThreatActorView,
    private readonly patrolRoute: readonly Vec3[],
  ) {
    this.facingYaw = view.yawRadians;
    this.idleCueTimer = profile.audio.idleIntervalSeconds * (0.5 + Math.random() * 0.5);
  }

  /** Wakes the brain into a state, optionally with prior knowledge of the player. */
  public activate(state: Exclude<ThreatState, 'dormant'>, awareness: number, knownPlayerPosition: Vec3 | null): void {
    this.awareness = clamp(awareness, 0, 1);
    this.lastKnownPlayerPosition = knownPlayerPosition;
    this.secondsSincePerceived = knownPlayerPosition !== null ? 0 : Infinity;
    this.investigatePoint = knownPlayerPosition;
    this.transition(state);
  }

  /**
   * Hand strike: stagger for `seconds` (breaking any catch in progress). Returns false while the threat is still
   * shrugging off a previous stun. A struck threat knows exactly where the player is.
   */
  public stun(seconds: number, playerFeet: Readonly<Vec3>): boolean {
    if (this.stunSeconds > 0 || this.stunImmuneSeconds > 0 || this.state === 'dormant') {
      return false;
    }
    this.stunSeconds = seconds;
    this.stunImmuneSeconds = seconds + STUN_RESIST_SECONDS;
    this.awareness = 1;
    this.lastKnownPlayerPosition = [playerFeet[0], 0, playerFeet[2]];
    this.secondsSincePerceived = 0;
    if (this.state === 'catchKill') {
      this.catchSeconds = 0;
      this.catchResolved = false;
    }
    return true;
  }

  public get isStunned(): boolean {
    return this.stunSeconds > 0;
  }

  private transition(next: ThreatState): void {
    if (next === this.state) {
      return;
    }
    const calm: boolean = this.state === 'patrolling' || this.state === 'alert' || this.state === 'dormant';
    if (calm && (next === 'stalking' || next === 'hunting')) {
      this.pendingSpotted = true;
    }
    this.state = next;
    this.stateSeconds = 0;
    this.searchSeconds = 0;
    this.path = null;
    if (next === 'stalking') this.stalkSeconds = 0;
    if (next === 'catchKill') {
      this.catchSeconds = 0;
      this.catchResolved = false;
    }
  }

  // ---- Perception + awareness --------------------------------------------------------------------------------

  private perceive(deltaSeconds: number, context: BrainContext): { sight: SightResult; hearing: HearingResult; observed: boolean } {
    const view: ThreatActorView = this.view;
    const profile: ThreatProfile = this.profile;
    const eye: Vec3 = [view.position[0], view.position[1] + profile.vision.eyeHeight, view.position[2]];
    // Model forward is +Z rotated by yaw: f = (sin ψ, 0, cos ψ).
    const forward: Vec3 = [Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw)];
    const sight: SightResult = evaluateSight(context.world, eye, forward, context.player, profile.vision);
    const freshNoises: NoiseEvent[] = context.noises.filter((noise: NoiseEvent) => noise.emittedAtSeconds > this.lastProcessedNoiseStamp);
    for (const noise of freshNoises) {
      this.lastProcessedNoiseStamp = Math.max(this.lastProcessedNoiseStamp, noise.emittedAtSeconds);
    }
    const hearing: HearingResult = evaluateHearing(context.world, eye, freshNoises, profile.hearing);
    const observedPoint: Vec3 = [view.position[0], view.position[1] + profile.vision.eyeHeight * 0.7, view.position[2]];
    const lightFrozen: boolean = profile.freezeIlluminanceThreshold !== null && context.illuminanceAt(observedPoint) > profile.freezeIlluminanceThreshold;
    const observed: boolean = lightFrozen || (profile.freezesWhenObserved && isPointObservedByPlayer(context.world, observedPoint, context.player, profile.observedHalfAngle));

    // Awareness integration:
    //   seen:  A += s · g_sight · dt     heard: A += h · g_hear (impulse)     neither: A −= decay · dt
    let stimulated = false;
    if (sight.visible) {
      this.awareness += sight.score * profile.awareness.sightGainPerSecond * deltaSeconds;
      this.lastKnownPlayerPosition = [context.player.feetPosition[0], 0, context.player.feetPosition[2]];
      this.secondsSincePerceived = 0;
      stimulated = true;
    }
    if (hearing.strength > 0 && hearing.position !== null) {
      this.awareness += hearing.strength * profile.hearing.awarenessGain;
      if (!sight.visible) {
        this.investigatePoint = [hearing.position[0], 0, hearing.position[2]];
        if (hearing.strength > 0.3) {
          this.lastKnownPlayerPosition = this.investigatePoint;
          this.secondsSincePerceived = Math.min(this.secondsSincePerceived, 0.5);
        }
      }
      stimulated = true;
    }
    if (!stimulated) {
      this.awareness -= profile.awareness.decayPerSecond * deltaSeconds;
      this.secondsSincePerceived += deltaSeconds;
    }
    this.awareness = clamp(this.awareness, 0, 1);
    return { sight, hearing, observed };
  }

  // ---- Locomotion -----------------------------------------------------------------------------------------------

  /** Path-follows toward `target` at `speed`; returns metres actually moved. */
  private moveToward(target: Readonly<Vec3>, speed: number, deltaSeconds: number, context: BrainContext): number {
    const view: ThreatActorView = this.view;
    this.repathTimer -= deltaSeconds;
    const targetDrift: number = this.pathTarget === null ? Infinity : horizontalDistance(this.pathTarget, target);
    if (this.path === null || this.repathTimer <= 0 || targetDrift > REPATH_TARGET_DRIFT) {
      this.path = context.navigation.findPath(view.position, target, this.profile.navigation);
      this.pathIndex = 0;
      this.pathTarget = [target[0], 0, target[2]];
      this.repathTimer = this.profile.navigation.repathIntervalSeconds;
    }
    let waypoint: Vec3 = [target[0], 0, target[2]];
    if (this.path !== null && this.path.length > 0) {
      while (this.pathIndex < this.path.length - 1 && horizontalDistance(view.position, this.path[this.pathIndex] as Vec3) < WAYPOINT_REACHED_DISTANCE) {
        this.pathIndex += 1;
      }
      waypoint = this.path[Math.min(this.pathIndex, this.path.length - 1)] as Vec3;
    }
    const deltaX: number = waypoint[0] - view.position[0];
    const deltaZ: number = waypoint[2] - view.position[2];
    const distance: number = Math.hypot(deltaX, deltaZ);
    if (distance < 1e-3 || speed <= 0) {
      return 0;
    }
    // Turn toward the waypoint at a bounded rate: ψ ← ψ + clamp(Δψ, −ω·dt, ω·dt).
    const desiredYaw: number = Math.atan2(deltaX, deltaZ);
    const turnStep: number = this.profile.turnRateRadiansPerSecond * deltaSeconds;
    this.facingYaw = wrapAngle(this.facingYaw + clamp(wrapAngle(desiredYaw - this.facingYaw), -turnStep, turnStep));
    // Slow down while facing away from the travel direction: v' = v · max(0.25, cos Δψ).
    const alignment: number = Math.max(0.25, Math.cos(wrapAngle(desiredYaw - this.facingYaw)));
    const step: number = Math.min(distance, speed * alignment * deltaSeconds);
    const before: Vec3 = [view.position[0], view.position[1], view.position[2]];
    view.position[0] += (deltaX / distance) * step;
    view.position[2] += (deltaZ / distance) * step;
    context.world.resolveCircleCollision(view.position, this.profile.navigation.bodyRadius);
    return horizontalDistance(before, view.position);
  }

  private faceToward(target: Readonly<Vec3>, deltaSeconds: number): void {
    const desiredYaw: number = Math.atan2(target[0] - this.view.position[0], target[2] - this.view.position[2]);
    const turnStep: number = this.profile.turnRateRadiansPerSecond * deltaSeconds;
    this.facingYaw = wrapAngle(this.facingYaw + clamp(wrapAngle(desiredYaw - this.facingYaw), -turnStep, turnStep));
  }

  // ---- Tick -------------------------------------------------------------------------------------------------------

  public tick(deltaSeconds: number, context: BrainContext): BrainTickReport {
    const previousState: ThreatState = this.state;
    const profile: ThreatProfile = this.profile;
    const view: ThreatActorView = this.view;
    this.stateSeconds += deltaSeconds;
    const playerFeet: Vec3 = [context.player.feetPosition[0], 0, context.player.feetPosition[2]];
    const distanceToPlayer: number = horizontalDistance(view.position, playerFeet);

    if (this.state === 'dormant') {
      view.gait = 0;
      view.advanceAnimation(deltaSeconds);
      return {
        stateChange: null,
        caughtPlayer: false,
        spottedPlayer: false,
        footstep: false,
        idleCue: false,
        observedByPlayer: false,
        sight: { visible: false, score: 0, distance: distanceToPlayer, withinProximity: false },
        hearing: { strength: 0, position: null, source: null },
        distanceToPlayer,
      };
    }

    this.stunImmuneSeconds = Math.max(0, this.stunImmuneSeconds - deltaSeconds);
    if (this.stunSeconds > 0) {
      // Staggered: rooted in place, head shaking, cannot catch. A broken lunge falls back to hunting.
      this.stunSeconds = Math.max(0, this.stunSeconds - deltaSeconds);
      if (this.state === 'catchKill') {
        this.transition('hunting');
      }
      view.gait = 0;
      view.lunging = false;
      view.scanAmount = 1;
      view.eyeGlow = 0.25;
      view.advanceAnimation(deltaSeconds * 0.4);
      return {
        stateChange: previousState !== this.state ? { from: previousState, to: this.state } : null,
        caughtPlayer: false,
        spottedPlayer: false,
        footstep: false,
        idleCue: false,
        observedByPlayer: false,
        sight: { visible: false, score: 0, distance: distanceToPlayer, withinProximity: false },
        hearing: { strength: 0, position: null, source: null },
        distanceToPlayer,
      };
    }

    const { sight, hearing, observed } = this.perceive(deltaSeconds, context);
    if (this.graceSeconds > 0) {
      // Entrance grace: no hunting, no catching. A threat that arrives already stalking keeps its distance.
      this.graceSeconds = Math.max(0, this.graceSeconds - deltaSeconds);
      if (this.state === 'hunting' || this.state === 'catchKill') {
        this.catchSeconds = 0;
        this.catchResolved = false;
        this.transition(profile.stalking.enabled ? 'stalking' : 'alert');
      }
      if (this.state !== 'stalking') {
        this.awareness = Math.min(this.awareness, profile.awareness.alertThreshold * 0.8);
      }
    }
    const perceivedRecently: boolean = sight.visible || this.secondsSincePerceived < 0.5;
    // Light-frozen threats stop dead; look-away threats crawl at their observed speed.
    const lightFrozen: boolean = profile.freezeIlluminanceThreshold !== null && context.illuminanceAt([view.position[0], view.position[1] + profile.vision.eyeHeight * 0.7, view.position[2]]) > profile.freezeIlluminanceThreshold;
    const freezeCap = (speed: number): number => (lightFrozen ? 0 : observed ? Math.min(speed, profile.speeds.observed) : speed);
    let moved = 0;
    let speedUsed = 0;
    let caughtPlayer = false;
    view.lunging = false;
    view.scanAmount = Math.max(0, view.scanAmount - deltaSeconds * 2);

    switch (this.state) {
      case 'patrolling': {
        if (this.awareness >= profile.awareness.alertThreshold) {
          this.investigatePoint = this.lastKnownPlayerPosition ?? this.investigatePoint;
          this.transition('alert');
          break;
        }
        if (this.patrolRoute.length > 0) {
          const waypoint: Vec3 = this.patrolRoute[this.patrolIndex % this.patrolRoute.length] as Vec3;
          if (horizontalDistance(view.position, waypoint) < WAYPOINT_REACHED_DISTANCE * 1.5) {
            this.patrolIndex = (this.patrolIndex + 1) % this.patrolRoute.length;
          }
          speedUsed = freezeCap(profile.speeds.patrol);
          moved = this.moveToward(waypoint, speedUsed, deltaSeconds, context);
        }
        break;
      }
      case 'alert': {
        if (this.awareness >= profile.awareness.huntThreshold && perceivedRecently) {
          const shouldStalk: boolean = profile.stalking.enabled && distanceToPlayer > profile.stalking.escalateDistance;
          this.transition(shouldStalk ? 'stalking' : 'hunting');
          break;
        }
        const point: Vec3 | null = this.investigatePoint ?? this.lastKnownPlayerPosition;
        if (point !== null && horizontalDistance(view.position, point) > 0.8) {
          speedUsed = freezeCap(profile.speeds.alert);
          moved = this.moveToward(point, speedUsed, deltaSeconds, context);
        } else {
          // At the investigation point: sweep the head and wait.
          this.searchSeconds += deltaSeconds;
          view.scanAmount = 1;
          this.facingYaw = wrapAngle(this.facingYaw + Math.sin(this.searchSeconds * 1.2) * deltaSeconds * 1.4);
        }
        const searchExpired: boolean = this.searchSeconds >= profile.alertSearchSeconds;
        if ((searchExpired && this.awareness < profile.awareness.forgetThreshold) || this.searchSeconds >= profile.alertSearchSeconds * 2) {
          this.investigatePoint = null;
          this.transition('patrolling');
        }
        break;
      }
      case 'stalking': {
        this.stalkSeconds += deltaSeconds;
        const sprintingNearby: boolean = hearing.source === 'footstepRun' && distanceToPlayer < 12;
        if (this.graceSeconds <= 0 && (distanceToPlayer <= profile.stalking.escalateDistance || this.stalkSeconds >= profile.stalking.patienceSeconds || sprintingNearby)) {
          this.transition('hunting');
          break;
        }
        if (this.secondsSincePerceived > profile.loseTrackSeconds) {
          this.investigatePoint = this.lastKnownPlayerPosition;
          this.transition('alert');
          break;
        }
        // Distance band: close in when far, drift when inside the band, hold when too close.
        const target: Vec3 = sight.visible ? playerFeet : (this.lastKnownPlayerPosition ?? playerFeet);
        const bandSpeed: number =
          distanceToPlayer > profile.stalking.preferredDistanceMaximum
            ? profile.speeds.stalk
            : distanceToPlayer > profile.stalking.preferredDistanceMinimum
              ? profile.speeds.stalk * 0.45
              : 0;
        speedUsed = freezeCap(bandSpeed);
        moved = this.moveToward(target, speedUsed, deltaSeconds, context);
        if (speedUsed === 0) {
          this.faceToward(playerFeet, deltaSeconds);
        }
        break;
      }
      case 'hunting': {
        if (this.secondsSincePerceived > profile.loseTrackSeconds) {
          this.investigatePoint = this.lastKnownPlayerPosition;
          this.transition('alert');
          break;
        }
        const canReach: boolean = sight.visible || sight.withinProximity;
        if (distanceToPlayer <= profile.catch.radius && canReach) {
          this.transition('catchKill');
          break;
        }
        const target: Vec3 = sight.visible ? playerFeet : (this.lastKnownPlayerPosition ?? playerFeet);
        speedUsed = freezeCap(profile.speeds.hunt);
        moved = this.moveToward(target, speedUsed, deltaSeconds, context);
        break;
      }
      case 'catchKill': {
        this.catchSeconds += deltaSeconds;
        view.lunging = true;
        if (distanceToPlayer > profile.catch.radius * profile.catch.escapeRadiusFactor && !this.catchResolved) {
          this.transition('hunting');
          break;
        }
        this.faceToward(playerFeet, deltaSeconds * 3);
        speedUsed = profile.speeds.hunt * 1.2;
        if (distanceToPlayer > 0.6) {
          moved = this.moveToward(playerFeet, speedUsed, deltaSeconds, context);
        }
        if (lightFrozen) {
          this.catchSeconds = 0;
        }
        if (!this.catchResolved && this.catchSeconds >= profile.catch.windupSeconds) {
          this.catchResolved = true;
          caughtPlayer = true;
        }
        break;
      }
    }

    // Presentation.
    view.yawRadians = this.facingYaw;
    view.gait = clamp(moved / Math.max(1e-4, deltaSeconds) / profile.speeds.hunt, 0, 1);
    const stateGlow: Readonly<Record<ThreatState, number>> = { dormant: 0.3, patrolling: 0.6, alert: 1, stalking: 1.2, hunting: 1.6, catchKill: 2.4 };
    view.eyeGlow = stateGlow[this.state] + this.awareness * 0.4;
    view.advanceAnimation(deltaSeconds);

    this.strideAccumulator += moved;
    let footstep = false;
    if (this.strideAccumulator >= profile.audio.strideMeters) {
      this.strideAccumulator -= profile.audio.strideMeters;
      footstep = true;
    }
    this.idleCueTimer -= deltaSeconds;
    let idleCue = false;
    if (this.idleCueTimer <= 0) {
      this.idleCueTimer = profile.audio.idleIntervalSeconds * (0.7 + Math.random() * 0.6);
      idleCue = this.state === 'patrolling' || this.state === 'alert' || this.state === 'stalking';
    }
    const spottedPlayer: boolean = this.pendingSpotted;
    this.pendingSpotted = false;
    return {
      stateChange: previousState !== this.state ? { from: previousState, to: this.state } : null,
      caughtPlayer,
      spottedPlayer,
      footstep,
      idleCue,
      observedByPlayer: observed,
      sight,
      hearing,
      distanceToPlayer,
    };
  }
}
