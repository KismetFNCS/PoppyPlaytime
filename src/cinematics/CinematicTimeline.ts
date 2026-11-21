import type { SpatialCueId } from '../core/AudioManager';
import type { Vec3 } from '../math/Vec3';
import { clamp } from '../math/Vec3';

export type CinematicId =
  | 'elevatorArrival'
  | 'checkpointDescent'
  | 'jesterReveal'
  | 'jesterJumpscare'
  | 'tallymanJumpscare'
  | 'fallDeath'
  | 'toxicCollapse';

export type EasingName = 'linear' | 'step' | 'easeInQuad' | 'easeOutQuad' | 'easeInOutSine' | 'easeOutCubic' | 'easeOutBack';

/**
 * Reference frames for keyframe offsets. Offsets are expressed in the frame's local basis
 * (x = right, y = up, z = forward):
 *  - origin:     camera pose captured when the cinematic starts (forward per the timeline's originFacing)
 *  - actor:      the actor's live position and facing
 *  - actorStart: the actor's position and facing when the cinematic started
 *  - world:      raw world coordinates
 */
export type ReferenceFrame = 'origin' | 'actor' | 'actorStart' | 'world';

export interface CameraKeyframe {
  readonly time: number;
  readonly frame: ReferenceFrame;
  readonly offset: Vec3;
  readonly lookFrame: ReferenceFrame;
  readonly lookOffset: Vec3;
  readonly fovDegrees: number;
  readonly rollRadians: number;
  /** Easing used for the segment that ENDS at this keyframe. */
  readonly ease: EasingName;
}

export interface ActorKeyframe {
  readonly time: number;
  readonly frame: ReferenceFrame;
  readonly offset: Vec3;
  /** 'camera' turns to face the camera, 'keep' preserves the starting yaw. */
  readonly facing: 'camera' | 'keep';
  readonly eyeGlow: number;
  readonly gait: number;
  readonly lunging: boolean;
  readonly ease: EasingName;
}

export interface PostKeyframe {
  readonly time: number;
  readonly flashIntensity: number;
  readonly flashColor: Vec3;
  /** Added to the frame's chromatic aberration. */
  readonly aberration: number;
  /** Screen shake amplitude in UV units. */
  readonly shake: number;
  readonly noise: number;
  readonly fadeToBlack: number;
  readonly ease: EasingName;
}

export interface AudioCueEvent {
  readonly time: number;
  readonly cue: SpatialCueId;
  readonly frame: ReferenceFrame;
  readonly offset: Vec3;
  readonly intensity: number;
}

export type CinematicHookId = 'lightsDip' | 'lightsRestore' | 'stopAmbient' | 'resumeAmbient' | 'choke' | 'blackout' | 'doorsOpen';

export interface HookEvent {
  readonly time: number;
  readonly hook: CinematicHookId;
}

export interface CinematicTimeline {
  readonly id: CinematicId;
  readonly durationSeconds: number;
  /** Blend from the live gameplay camera into the first keyframe. */
  readonly blendInSeconds: number;
  /** Blend back to the gameplay camera after the last keyframe (only when returning control). */
  readonly blendOutSeconds: number;
  readonly returnsControl: boolean;
  readonly locksControls: boolean;
  /** 'camera' keeps the player's facing as the origin frame's forward; 'actor' turns it toward the actor. */
  readonly originFacing: 'camera' | 'actor';
  /** Pin the audio listener to the cinematic camera. */
  readonly overridesListener: boolean;
  /** 0..1 ambient bed attenuation while playing. */
  readonly ambientDuck: number;
  readonly hidesHud: boolean;
  readonly camera: readonly CameraKeyframe[];
  readonly actor: readonly ActorKeyframe[];
  readonly post: readonly PostKeyframe[];
  readonly audio: readonly AudioCueEvent[];
  readonly hooks: readonly HookEvent[];
}

/** Easing curves e: [0,1] → [0,1] (easeOutBack overshoots). */
export function applyEasing(name: EasingName, t: number): number {
  const x: number = clamp(t, 0, 1);
  switch (name) {
    case 'linear':
      return x;
    case 'step':
      return x < 1 ? 0 : 1;
    case 'easeInQuad':
      return x * x;
    case 'easeOutQuad':
      return 1 - (1 - x) * (1 - x);
    case 'easeInOutSine':
      return -(Math.cos(Math.PI * x) - 1) / 2;
    case 'easeOutCubic':
      return 1 - Math.pow(1 - x, 3);
    case 'easeOutBack': {
      const overshoot = 1.70158;
      const shifted: number = x - 1;
      return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
    }
  }
}

/**
 * Locates the keyframe segment containing `time` in a time-sorted track and returns the pair plus the
 * eased interpolation factor. Before the first key → (k0, k0, 0); after the last → (kn, kn, 1).
 */
export function sampleTrack<TKey extends { readonly time: number; readonly ease: EasingName }>(
  track: readonly TKey[],
  time: number,
): { readonly from: TKey; readonly to: TKey; readonly alpha: number } | null {
  if (track.length === 0) {
    return null;
  }
  const first: TKey = track[0] as TKey;
  if (time <= first.time) {
    return { from: first, to: first, alpha: 0 };
  }
  for (let index = 0; index < track.length - 1; index += 1) {
    const from: TKey = track[index] as TKey;
    const to: TKey = track[index + 1] as TKey;
    if (time >= from.time && time < to.time) {
      const span: number = Math.max(1e-6, to.time - from.time);
      return { from, to, alpha: applyEasing(to.ease, (time - from.time) / span) };
    }
  }
  const last: TKey = track[track.length - 1] as TKey;
  return { from: last, to: last, alpha: 1 };
}
