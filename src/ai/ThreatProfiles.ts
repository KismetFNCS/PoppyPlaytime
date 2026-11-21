import type { SpatialCueId } from '../core/AudioManager';
import type { ThreatKind } from '../world/LevelStreamer';

/** The finite state machine every threat runs. */
export type ThreatState = 'dormant' | 'patrolling' | 'alert' | 'stalking' | 'hunting' | 'catchKill';
export const THREAT_STATES: readonly ThreatState[] = ['dormant', 'patrolling', 'alert', 'stalking', 'hunting', 'catchKill'];

export interface VisionSpec {
  /** Maximum sight distance (m). */
  readonly range: number;
  /** Half-angle of the central cone (radians); targets inside score fully. */
  readonly centralHalfAngle: number;
  /** Half-angle of the peripheral cone (radians); targets here score `peripheralWeight`. */
  readonly peripheralHalfAngle: number;
  readonly peripheralWeight: number;
  /** Peripheral detection only works within range × this factor. */
  readonly peripheralRangeFactor: number;
  /** Within this radius the target is perceived regardless of facing (still needs line of sight). */
  readonly proximityRadius: number;
  /** 0 = sees equally in darkness, 1 = only sees lit targets. */
  readonly lightDependence: number;
  /** Multiplier applied when the player is crouched (outside proximity radius). */
  readonly crouchVisibilityFactor: number;
  readonly eyeHeight: number;
}

export interface HearingSpec {
  /** Scales every noise's audible radius. */
  readonly radiusMultiplier: number;
  /** Strength multiplier when the straight path from noise to listener is blocked. */
  readonly occlusionFactor: number;
  /** Awareness gained per unit of heard strength (impulse). */
  readonly awarenessGain: number;
}

export interface AwarenessSpec {
  /** Awareness gained per second at sight score 1. */
  readonly sightGainPerSecond: number;
  readonly decayPerSecond: number;
  /** Patrolling → Alert. */
  readonly alertThreshold: number;
  /** Alert → Stalking / Hunting. */
  readonly huntThreshold: number;
  /** Below this while alert (and the search timer has expired) → back to Patrolling. */
  readonly forgetThreshold: number;
}

export interface StalkingSpec {
  readonly enabled: boolean;
  /** Keeps at least this far from the player while stalking. */
  readonly preferredDistanceMinimum: number;
  /** Closes in when farther than this. */
  readonly preferredDistanceMaximum: number;
  /** Seconds of stalking before escalating to a hunt regardless of distance. */
  readonly patienceSeconds: number;
  /** Escalates to hunting immediately inside this distance. */
  readonly escalateDistance: number;
}

export interface CatchSpec {
  readonly radius: number;
  /** Lunge wind-up before the kill resolves; the player can still break away during it. */
  readonly windupSeconds: number;
  /** During wind-up, distance > radius × this aborts the catch back to Hunting. */
  readonly escapeRadiusFactor: number;
}

export interface NavigationCapabilities {
  readonly bodyRadius: number;
  /** Can fold itself under low ceilings (collapsed crawlspaces). */
  readonly canSqueezeLowCeilings: boolean;
  /** Can climb along chasm walls instead of needing a floor. */
  readonly canCrossChasms: boolean;
  readonly repathIntervalSeconds: number;
}

export interface ThreatAudioSpec {
  readonly footstepCue: SpatialCueId;
  readonly strideMeters: number;
  /** Played when the threat first notices the player (Alert → Hunting / Stalking). */
  readonly spottedCue: SpatialCueId;
  readonly idleCue: SpatialCueId;
  readonly idleIntervalSeconds: number;
}

export interface ThreatProfile {
  readonly kind: ThreatKind;
  readonly displayName: string;
  readonly vision: VisionSpec;
  readonly hearing: HearingSpec;
  readonly awareness: AwarenessSpec;
  readonly speeds: Readonly<Record<'patrol' | 'alert' | 'stalk' | 'hunt' | 'observed', number>>;
  readonly turnRateRadiansPerSecond: number;
  readonly stalking: StalkingSpec;
  /** Look-away behaviour: while the player watches it, the threat moves at `speeds.observed`. */
  readonly freezesWhenObserved: boolean;
  /** Half-angle of the player's view cone that counts as "watching" (radians). */
  readonly observedHalfAngle: number;
  readonly catch: CatchSpec;
  readonly alertSearchSeconds: number;
  /** Seconds without perceiving the player before Hunting/Stalking degrades to Alert. */
  readonly loseTrackSeconds: number;
  readonly navigation: NavigationCapabilities;
  readonly audio: ThreatAudioSpec;
  /** Dread contribution (0..1) per metre-closeness, used for heartbeat / post effects. */
  readonly dreadRadius: number;
}

const DEGREES: number = Math.PI / 180;

export const THREAT_PROFILES: Readonly<Record<ThreatKind, ThreatProfile>> = {
  /** Sight hunter: sees far, stalks at a distance, surges when unwatched, freezes when watched. */
  jester: {
    kind: 'jester',
    displayName: 'Jester Entity',
    vision: {
      range: 30,
      centralHalfAngle: 55 * DEGREES,
      peripheralHalfAngle: 95 * DEGREES,
      peripheralWeight: 0.45,
      peripheralRangeFactor: 0.5,
      proximityRadius: 2.6,
      lightDependence: 0.45,
      crouchVisibilityFactor: 0.7,
      eyeHeight: 2.36,
    },
    hearing: { radiusMultiplier: 0.7, occlusionFactor: 0.5, awarenessGain: 0.25 },
    awareness: { sightGainPerSecond: 1.6, decayPerSecond: 0.08, alertThreshold: 0.2, huntThreshold: 0.65, forgetThreshold: 0.08 },
    speeds: { patrol: 1.4, alert: 2.4, stalk: 4.2, hunt: 5.1, observed: 0.6 },
    turnRateRadiansPerSecond: 4,
    stalking: { enabled: true, preferredDistanceMinimum: 6, preferredDistanceMaximum: 11, patienceSeconds: 14, escalateDistance: 4.5 },
    freezesWhenObserved: true,
    observedHalfAngle: 36 * DEGREES,
    catch: { radius: 1.3, windupSeconds: 0.18, escapeRadiusFactor: 1.8 },
    alertSearchSeconds: 6,
    loseTrackSeconds: 9,
    navigation: { bodyRadius: 0.45, canSqueezeLowCeilings: true, canCrossChasms: true, repathIntervalSeconds: 0.4 },
    audio: { footstepCue: 'jesterBells', strideMeters: 2.4, spottedCue: 'jesterShriek', idleCue: 'jesterBells', idleIntervalSeconds: 7 },
    dreadRadius: 17,
  },
  /** Sound hunter: nearly blind (short, light-dependent slit), hears footsteps and alarms from far away. */
  tallyman: {
    kind: 'tallyman',
    displayName: 'The Tallyman',
    vision: {
      range: 9,
      centralHalfAngle: 22 * DEGREES,
      peripheralHalfAngle: 40 * DEGREES,
      peripheralWeight: 0.3,
      peripheralRangeFactor: 0.6,
      proximityRadius: 1.8,
      lightDependence: 0.9,
      crouchVisibilityFactor: 0.45,
      eyeHeight: 2.25,
    },
    hearing: { radiusMultiplier: 1.6, occlusionFactor: 0.65, awarenessGain: 0.55 },
    awareness: { sightGainPerSecond: 1.2, decayPerSecond: 0.12, alertThreshold: 0.18, huntThreshold: 0.7, forgetThreshold: 0.1 },
    speeds: { patrol: 1.05, alert: 2.6, stalk: 2.0, hunt: 4.5, observed: 4.5 },
    turnRateRadiansPerSecond: 2.6,
    stalking: { enabled: false, preferredDistanceMinimum: 0, preferredDistanceMaximum: 0, patienceSeconds: 0, escalateDistance: 0 },
    freezesWhenObserved: false,
    observedHalfAngle: 0,
    catch: { radius: 1.4, windupSeconds: 0.35, escapeRadiusFactor: 1.6 },
    alertSearchSeconds: 8,
    loseTrackSeconds: 5,
    navigation: { bodyRadius: 0.4, canSqueezeLowCeilings: false, canCrossChasms: false, repathIntervalSeconds: 0.5 },
    audio: { footstepCue: 'tallymanStep', strideMeters: 1.1, spottedCue: 'tallymanBell', idleCue: 'tallymanPunch', idleIntervalSeconds: 4.5 },
    dreadRadius: 12,
  },
};
