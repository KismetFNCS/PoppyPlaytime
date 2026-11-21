import type { ActorKeyframe, AudioCueEvent, CameraKeyframe, CinematicHookId, CinematicTimeline, HookEvent, PostKeyframe, ReferenceFrame } from './CinematicTimeline';
import { applyEasing, sampleTrack } from './CinematicTimeline';
import type { AudioManager } from '../core/AudioManager';
import type { PerspectiveCamera } from '../graphics/Camera';
import type { PostProcessParameters } from '../graphics/PostProcessPipeline';
import type { Vec3 } from '../math/Vec3';
import { clamp, lerp, vec3Lerp, vec3Normalize } from '../math/Vec3';
import type { ThreatActorView } from '../world/JesterEntity';

export interface CameraPose {
  readonly position: Vec3;
  readonly yawRadians: number;
  readonly pitchRadians: number;
  readonly rollRadians: number;
  readonly fieldOfViewRadians: number;
}

interface FrameBasis {
  readonly origin: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly forward: Vec3;
  readonly yawRadians: number;
}

export interface CinematicPlaybackContext {
  readonly camera: PerspectiveCamera;
  readonly actor: ThreatActorView | null;
  readonly audio: AudioManager;
  readonly post: PostProcessParameters;
  /** Live gameplay camera pose, used to blend back out when the cinematic returns control. */
  readonly gameplayPose: () => CameraPose;
  readonly onHook: (hook: CinematicHookId) => void;
  readonly onComplete: () => void;
}

interface ActivePlayback {
  readonly timeline: CinematicTimeline;
  readonly context: CinematicPlaybackContext;
  readonly originBasis: FrameBasis;
  readonly actorStartBasis: FrameBasis | null;
  readonly startPose: CameraPose;
  time: number;
  nextAudioIndex: number;
  nextHookIndex: number;
  /** Final cinematic pose, captured when the timeline ends (blend-out source). */
  endPose: CameraPose | null;
  completed: boolean;
}

/** Flat basis from a horizontal forward: right = (−f_z, 0, f_x), up = +Y. */
function basisFromForward(origin: Readonly<Vec3>, forward: Readonly<Vec3>): FrameBasis {
  const flat: Vec3 = vec3Normalize([forward[0], 0, forward[2]]);
  const safeForward: Vec3 = flat[0] === 0 && flat[2] === 0 ? [0, 0, -1] : flat;
  return {
    origin: [origin[0], origin[1], origin[2]],
    right: [-safeForward[2], 0, safeForward[0]],
    up: [0, 1, 0],
    forward: safeForward,
    yawRadians: Math.atan2(safeForward[0], safeForward[2]),
  };
}

function actorBasis(actor: ThreatActorView): FrameBasis {
  return basisFromForward(actor.position, [Math.sin(actor.yawRadians), 0, Math.cos(actor.yawRadians)]);
}

function wrapAngle(angle: number): number {
  let wrapped: number = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

/** Interpolates two poses; yaw takes the shortest arc. */
function blendPoses(from: CameraPose, to: CameraPose, weight: number): CameraPose {
  return {
    position: vec3Lerp(from.position, to.position, weight),
    yawRadians: from.yawRadians + wrapAngle(to.yawRadians - from.yawRadians) * weight,
    pitchRadians: lerp(from.pitchRadians, to.pitchRadians, weight),
    rollRadians: lerp(from.rollRadians, to.rollRadians, weight),
    fieldOfViewRadians: lerp(from.fieldOfViewRadians, to.fieldOfViewRadians, weight),
  };
}

function capturePose(camera: PerspectiveCamera): CameraPose {
  return {
    position: [camera.position[0], camera.position[1], camera.position[2]],
    yawRadians: camera.yawRadians,
    pitchRadians: camera.pitchRadians,
    rollRadians: camera.rollRadians,
    fieldOfViewRadians: camera.fieldOfViewRadians,
  };
}

function applyPose(camera: PerspectiveCamera, pose: CameraPose): void {
  camera.position = [pose.position[0], pose.position[1], pose.position[2]];
  camera.yawRadians = pose.yawRadians;
  camera.pitchRadians = pose.pitchRadians;
  camera.rollRadians = pose.rollRadians;
  camera.fieldOfViewRadians = pose.fieldOfViewRadians;
}

/**
 * Plays CinematicTimelines: camera takeover with blend-in/out, actor choreography, post-process
 * tracks layered on top of the frame's settings, spatial audio cues with listener override, and hooks.
 */
export class CinematicDirector {
  private playback: ActivePlayback | null = null;

  public get isPlaying(): boolean {
    return this.playback !== null && !this.playback.completed;
  }

  /** True while a cinematic holds the camera (including a non-returning one that has finished). */
  public get ownsCamera(): boolean {
    return this.playback !== null;
  }

  public get locksControls(): boolean {
    return this.playback !== null && this.playback.timeline.locksControls;
  }

  public get hidesHud(): boolean {
    return this.playback !== null && this.playback.timeline.hidesHud;
  }

  public get activeTimelineId(): string | null {
    return this.playback?.timeline.id ?? null;
  }

  public play(timeline: CinematicTimeline, context: CinematicPlaybackContext): void {
    this.stop();
    const camera: PerspectiveCamera = context.camera;
    const cameraForward: Vec3 = camera.flatForward;
    let originForward: Vec3 = cameraForward;
    if (timeline.originFacing === 'actor' && context.actor !== null) {
      const toActor: Vec3 = [context.actor.position[0] - camera.position[0], 0, context.actor.position[2] - camera.position[2]];
      if (Math.hypot(toActor[0], toActor[2]) > 1e-3) {
        originForward = toActor;
      }
    }
    this.playback = {
      timeline,
      context,
      originBasis: basisFromForward(camera.position, originForward),
      actorStartBasis: context.actor !== null ? actorBasis(context.actor) : null,
      startPose: capturePose(camera),
      time: 0,
      nextAudioIndex: 0,
      nextHookIndex: 0,
      endPose: null,
      completed: false,
    };
    context.audio.setCinematicDuck(timeline.ambientDuck);
  }

  /** Immediately ends playback and releases audio overrides (no completion callback). */
  public stop(): void {
    if (this.playback === null) {
      return;
    }
    this.playback.context.audio.overrideListener(null);
    this.playback.context.audio.setCinematicDuck(0);
    this.playback = null;
  }

  // ---- Frame resolution ----------------------------------------------------------------------------------------

  private basisFor(frame: ReferenceFrame, playback: ActivePlayback): FrameBasis {
    switch (frame) {
      case 'origin':
        return playback.originBasis;
      case 'actor':
        return playback.context.actor !== null ? actorBasis(playback.context.actor) : playback.originBasis;
      case 'actorStart':
        return playback.actorStartBasis ?? playback.originBasis;
      case 'world':
        return { origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], yawRadians: 0 };
    }
  }

  /** p = origin + right·x + up·y + forward·z */
  private resolvePoint(frame: ReferenceFrame, offset: Readonly<Vec3>, playback: ActivePlayback): Vec3 {
    const basis: FrameBasis = this.basisFor(frame, playback);
    return [
      basis.origin[0] + basis.right[0] * offset[0] + basis.up[0] * offset[1] + basis.forward[0] * offset[2],
      basis.origin[1] + basis.right[1] * offset[0] + basis.up[1] * offset[1] + basis.forward[1] * offset[2],
      basis.origin[2] + basis.right[2] * offset[0] + basis.up[2] * offset[1] + basis.forward[2] * offset[2],
    ];
  }

  /**
   * Camera from keyframes: position and look target interpolated in world space, then
   *   d̂ = normalize(look − position);  yaw = atan2(−d_x, −d_z);  pitch = asin(d_y)
   * (matching PerspectiveCamera's forward = (−sinψ·cosθ, sinθ, −cosψ·cosθ)).
   */
  private evaluateCamera(playback: ActivePlayback, time: number): CameraPose | null {
    const sample = sampleTrack<CameraKeyframe>(playback.timeline.camera, time);
    if (sample === null) {
      return null;
    }
    const position: Vec3 = vec3Lerp(this.resolvePoint(sample.from.frame, sample.from.offset, playback), this.resolvePoint(sample.to.frame, sample.to.offset, playback), sample.alpha);
    const look: Vec3 = vec3Lerp(
      this.resolvePoint(sample.from.lookFrame, sample.from.lookOffset, playback),
      this.resolvePoint(sample.to.lookFrame, sample.to.lookOffset, playback),
      sample.alpha,
    );
    const direction: Vec3 = vec3Normalize([look[0] - position[0], look[1] - position[1], look[2] - position[2]]);
    return {
      position,
      yawRadians: Math.atan2(-direction[0], -direction[2]),
      pitchRadians: Math.asin(clamp(direction[1], -1, 1)),
      rollRadians: lerp(sample.from.rollRadians, sample.to.rollRadians, sample.alpha),
      fieldOfViewRadians: (lerp(sample.from.fovDegrees, sample.to.fovDegrees, sample.alpha) * Math.PI) / 180,
    };
  }

  private evaluateActor(playback: ActivePlayback, time: number, deltaSeconds: number): void {
    const actor: ThreatActorView | null = playback.context.actor;
    if (actor === null) {
      return;
    }
    const sample = sampleTrack<ActorKeyframe>(playback.timeline.actor, time);
    if (sample !== null) {
      const position: Vec3 = vec3Lerp(this.resolvePoint(sample.from.frame, sample.from.offset, playback), this.resolvePoint(sample.to.frame, sample.to.offset, playback), sample.alpha);
      actor.position = position;
      const camera: PerspectiveCamera = playback.context.camera;
      const facing: ActorKeyframe['facing'] = sample.alpha < 0.5 ? sample.from.facing : sample.to.facing;
      if (facing === 'camera') {
        actor.yawRadians = Math.atan2(camera.position[0] - position[0], camera.position[2] - position[2]);
      } else if (playback.actorStartBasis !== null) {
        actor.yawRadians = playback.actorStartBasis.yawRadians;
      }
      actor.eyeGlow = lerp(sample.from.eyeGlow, sample.to.eyeGlow, sample.alpha);
      actor.gait = lerp(sample.from.gait, sample.to.gait, sample.alpha);
      actor.lunging = sample.alpha < 0.5 ? sample.from.lunging : sample.to.lunging;
      actor.scanAmount = 0;
    }
    actor.advanceAnimation(deltaSeconds);
  }

  /** Post tracks are additive / max-combined onto the frame's settings-derived parameters. */
  private evaluatePost(playback: ActivePlayback, time: number): void {
    const sample = sampleTrack<PostKeyframe>(playback.timeline.post, time);
    if (sample === null) {
      return;
    }
    const from: PostKeyframe = sample.from;
    const to: PostKeyframe = sample.to;
    const alpha: number = sample.alpha;
    const crt = playback.context.post.crt;
    const flashIntensity: number = lerp(from.flashIntensity, to.flashIntensity, alpha);
    if (flashIntensity > crt.flashIntensity) {
      crt.flashIntensity = flashIntensity;
      crt.flashColor = vec3Lerp(from.flashColor, to.flashColor, alpha);
    }
    crt.chromaticAberration += lerp(from.aberration, to.aberration, alpha);
    crt.noiseIntensity += lerp(from.noise, to.noise, alpha);
    const shake: number = lerp(from.shake, to.shake, alpha);
    crt.screenShake = [Math.sin(time * 97.3) * Math.cos(time * 41.7) * shake, Math.cos(time * 83.1) * Math.sin(time * 29.3) * shake];
    crt.fadeToBlack = Math.max(crt.fadeToBlack, lerp(from.fadeToBlack, to.fadeToBlack, alpha));
  }

  private fireEvents(playback: ActivePlayback, time: number): void {
    const audioCues: readonly AudioCueEvent[] = playback.timeline.audio;
    while (playback.nextAudioIndex < audioCues.length && (audioCues[playback.nextAudioIndex] as AudioCueEvent).time <= time) {
      const cue: AudioCueEvent = audioCues[playback.nextAudioIndex] as AudioCueEvent;
      playback.context.audio.playSpatialCue(cue.cue, this.resolvePoint(cue.frame, cue.offset, playback), cue.intensity);
      playback.nextAudioIndex += 1;
    }
    const hooks: readonly HookEvent[] = playback.timeline.hooks;
    while (playback.nextHookIndex < hooks.length && (hooks[playback.nextHookIndex] as HookEvent).time <= time) {
      playback.context.onHook((hooks[playback.nextHookIndex] as HookEvent).hook);
      playback.nextHookIndex += 1;
    }
  }

  // ---- Tick -------------------------------------------------------------------------------------------------------

  /**
   * Advances playback. Phases:
   *   [0, blendIn)        camera = blend(startPose, timeline pose, easeInOutSine(t / blendIn))
   *   [blendIn, T)        camera = timeline pose
   *   [T, T + blendOut)   (returning)  camera = blend(endPose, live gameplay pose, easeInOutSine)
   *   ≥ end               returning → released; non-returning → hold final frame, completion fired once
   */
  public update(deltaSeconds: number): void {
    const playback: ActivePlayback | null = this.playback;
    if (playback === null) {
      return;
    }
    const timeline: CinematicTimeline = playback.timeline;
    const context: CinematicPlaybackContext = playback.context;
    playback.time += deltaSeconds;
    const time: number = playback.time;
    const clampedTime: number = Math.min(time, timeline.durationSeconds);

    this.evaluateActor(playback, clampedTime, deltaSeconds);
    this.evaluatePost(playback, clampedTime);
    this.fireEvents(playback, clampedTime);

    let pose: CameraPose | null = this.evaluateCamera(playback, clampedTime);
    if (pose !== null && timeline.blendInSeconds > 0 && time < timeline.blendInSeconds) {
      pose = blendPoses(playback.startPose, pose, applyEasing('easeInOutSine', time / timeline.blendInSeconds));
    }
    if (time >= timeline.durationSeconds) {
      if (playback.endPose === null && pose !== null) {
        playback.endPose = pose;
      }
      if (timeline.returnsControl) {
        const blendOutProgress: number = timeline.blendOutSeconds > 0 ? (time - timeline.durationSeconds) / timeline.blendOutSeconds : 1;
        if (blendOutProgress >= 1) {
          this.stop();
          context.onComplete();
          return;
        }
        pose = blendPoses(playback.endPose ?? context.gameplayPose(), context.gameplayPose(), applyEasing('easeInOutSine', blendOutProgress));
      } else if (!playback.completed) {
        playback.completed = true;
        context.onComplete();
      }
    }
    if (pose !== null) {
      applyPose(context.camera, pose);
    }
    if (timeline.overridesListener) {
      context.audio.overrideListener({ position: context.camera.position, forward: context.camera.forward, up: [0, 1, 0] });
    }
  }
}
