import type { ActorKeyframe, CameraKeyframe, CinematicId, CinematicTimeline, PostKeyframe } from './CinematicTimeline';

const NEUTRAL_POST: Omit<PostKeyframe, 'time' | 'ease'> = {
  flashIntensity: 0,
  flashColor: [0, 0, 0],
  aberration: 0,
  shake: 0,
  noise: 0,
  fadeToBlack: 0,
};

function post(time: number, values: Partial<Omit<PostKeyframe, 'time'>>): PostKeyframe {
  return { ...NEUTRAL_POST, ease: 'linear', ...values, time };
}

/** Camera at the origin looking along the origin frame (the most common hold pose). */
function originCamera(time: number, offset: [number, number, number], look: [number, number, number], fovDegrees: number, rollRadians: number, ease: CameraKeyframe['ease']): CameraKeyframe {
  return { time, frame: 'origin', offset, lookFrame: 'origin', lookOffset: look, fovDegrees, rollRadians, ease };
}

function actorKey(time: number, frame: ActorKeyframe['frame'], offset: [number, number, number], values: Partial<Omit<ActorKeyframe, 'time' | 'frame' | 'offset'>>): ActorKeyframe {
  return { facing: 'camera', eyeGlow: 1, gait: 0, lunging: false, ease: 'linear', ...values, time, frame, offset };
}

/**
 * Authored cinematic timelines. All times in seconds, offsets in metres in the named reference frame
 * (x right, y up, z forward). Origin y = 0 is the player's eye height at takeover.
 */
export const CINEMATIC_LIBRARY: Readonly<Record<CinematicId, CinematicTimeline>> = {
  /** New game: a lift settles at the bottom of the shaft, the picture fades up from black. */
  elevatorArrival: {
    id: 'elevatorArrival',
    durationSeconds: 3.2,
    blendInSeconds: 0,
    blendOutSeconds: 0.4,
    returnsControl: true,
    locksControls: true,
    originFacing: 'camera',
    overridesListener: false,
    ambientDuck: 0.4,
    hidesHud: true,
    camera: [
      originCamera(0, [0, 0.12, 0], [0, -0.05, 4], 66, 0.01, 'linear'),
      originCamera(1.8, [0, 0.03, 0], [0, 0.0, 4], 68, -0.006, 'easeOutCubic'),
      originCamera(2.4, [0, -0.04, 0], [0, -0.02, 4], 70, 0, 'easeOutBack'),
      originCamera(3.2, [0, 0, 0], [0, 0, 4], 72, 0, 'easeInOutSine'),
    ],
    actor: [],
    post: [
      post(0, { fadeToBlack: 1, shake: 0.006, noise: 0.12 }),
      post(1.6, { fadeToBlack: 0.15, shake: 0.004, noise: 0.08, ease: 'easeOutQuad' }),
      post(2.4, { fadeToBlack: 0, shake: 0.012, ease: 'linear' }),
      post(3.2, { ease: 'easeOutCubic' }),
    ],
    audio: [{ time: 0, cue: 'elevatorRumble', frame: 'origin', offset: [0, 1.2, -0.8], intensity: 1 }],
    hooks: [
      { time: 0, hook: 'lightsDip' },
      { time: 2.3, hook: 'doorsOpen' },
      { time: 2.4, hook: 'lightsRestore' },
    ],
  },

  /** Short "descent" beat when a new checkpoint is reached: a lurch, a dim, the lift rumble. */
  checkpointDescent: {
    id: 'checkpointDescent',
    durationSeconds: 0.9,
    blendInSeconds: 0.08,
    blendOutSeconds: 0.25,
    returnsControl: true,
    locksControls: false,
    originFacing: 'camera',
    overridesListener: false,
    ambientDuck: 0.2,
    hidesHud: false,
    camera: [
      originCamera(0, [0, 0, 0], [0, 0, 4], 72, 0, 'linear'),
      originCamera(0.3, [0, -0.09, 0], [0, -0.25, 4], 70, 0.02, 'easeOutQuad'),
      originCamera(0.9, [0, 0, 0], [0, 0, 4], 72, 0, 'easeInOutSine'),
    ],
    actor: [],
    post: [post(0, {}), post(0.25, { fadeToBlack: 0.55, shake: 0.005, ease: 'easeOutQuad' }), post(0.9, { ease: 'easeInOutSine' })],
    audio: [{ time: 0, cue: 'elevatorRumble', frame: 'origin', offset: [0, -1, 0], intensity: 0.45 }],
    hooks: [],
  },

  /** Non-lethal reveal: the view is wrenched toward the newly awakened Jester, which shrieks, then control returns. */
  jesterReveal: {
    id: 'jesterReveal',
    durationSeconds: 2.1,
    blendInSeconds: 0.35,
    blendOutSeconds: 0.5,
    returnsControl: true,
    locksControls: true,
    originFacing: 'actor',
    overridesListener: true,
    ambientDuck: 0.6,
    hidesHud: true,
    camera: [
      { time: 0, frame: 'origin', offset: [0, 0, 0], lookFrame: 'actor', lookOffset: [0, 2.1, 0], fovDegrees: 72, rollRadians: 0, ease: 'linear' },
      { time: 0.9, frame: 'origin', offset: [0, -0.05, 0.15], lookFrame: 'actor', lookOffset: [0, 2.3, 0], fovDegrees: 52, rollRadians: 0.03, ease: 'easeOutCubic' },
      { time: 2.1, frame: 'origin', offset: [0, 0, 0], lookFrame: 'actor', lookOffset: [0, 2.2, 0], fovDegrees: 58, rollRadians: 0, ease: 'easeInOutSine' },
    ],
    actor: [
      actorKey(0, 'actorStart', [0, 0, 0], { eyeGlow: 0.5 }),
      actorKey(0.6, 'actorStart', [0, 0, 0], { eyeGlow: 2.6, ease: 'step' }),
      actorKey(2.1, 'actorStart', [0, 0, 0], { eyeGlow: 1.6, ease: 'linear' }),
    ],
    post: [
      post(0, { shake: 0.002 }),
      post(0.6, { aberration: 3, shake: 0.006, noise: 0.08, ease: 'step' }),
      post(1.4, { aberration: 1.2, shake: 0.002, noise: 0.04, ease: 'easeOutQuad' }),
      post(2.1, { ease: 'linear' }),
    ],
    audio: [
      { time: 0.6, cue: 'jesterShriek', frame: 'actor', offset: [0, 2.2, 0], intensity: 0.8 },
      { time: 0.62, cue: 'metalStinger', frame: 'origin', offset: [0, 0, 1], intensity: 0.7 },
    ],
    hooks: [
      { time: 0.55, hook: 'lightsDip' },
      { time: 1.1, hook: 'lightsRestore' },
    ],
  },

  /** Lethal: the view whips to the Jester, which lunges face-first into the lens; flash, shake, blackout. */
  jesterJumpscare: {
    id: 'jesterJumpscare',
    durationSeconds: 1.45,
    blendInSeconds: 0.1,
    blendOutSeconds: 0,
    returnsControl: false,
    locksControls: true,
    originFacing: 'actor',
    overridesListener: true,
    ambientDuck: 1,
    hidesHud: true,
    camera: [
      originCamera(0, [0, 0, 0], [0, 0.1, 4], 72, 0, 'linear'),
      originCamera(0.28, [0, -0.04, -0.05], [0, 0.05, 1], 64, 0.04, 'easeOutQuad'),
      originCamera(0.9, [0, -0.1, -0.12], [0.05, -0.05, 1], 60, -0.06, 'easeInOutSine'),
      originCamera(1.45, [0, -0.25, -0.2], [0, -0.3, 1], 58, 0.12, 'easeInQuad'),
    ],
    actor: [
      actorKey(0, 'actorStart', [0, 0, 0], { eyeGlow: 2, gait: 1, lunging: true }),
      // Head (2.36 m above the feet) ends level with the lens ~0.55 m away: feet at origin y − 0.7.
      actorKey(0.28, 'origin', [0, -2.36 + 0.02, 0.78], { eyeGlow: 2.8, gait: 1, lunging: true, ease: 'easeInQuad' }),
      actorKey(1.45, 'origin', [0.02, -2.36 - 0.05, 0.7], { eyeGlow: 3, gait: 0.2, lunging: true, ease: 'linear' }),
    ],
    post: [
      post(0, { aberration: 1, shake: 0.004, noise: 0.08 }),
      post(0.28, { flashIntensity: 0.85, flashColor: [0.9, 0.02, 0.02], aberration: 6, shake: 0.014, noise: 0.22, ease: 'step' }),
      post(0.5, { flashIntensity: 0.12, flashColor: [0.9, 0.02, 0.02], aberration: 4, shake: 0.01, noise: 0.18, ease: 'easeOutQuad' }),
      post(1.1, { aberration: 3, shake: 0.006, noise: 0.2, ease: 'linear' }),
      post(1.45, { aberration: 2, shake: 0.002, noise: 0.15, fadeToBlack: 1, ease: 'easeInQuad' }),
    ],
    audio: [
      { time: 0.05, cue: 'jesterShriek', frame: 'actor', offset: [0, 2.2, 0], intensity: 1.4 },
      { time: 0.28, cue: 'metalStinger', frame: 'origin', offset: [0, 0, 0.6], intensity: 1.2 },
      { time: 0.3, cue: 'impactCrunch', frame: 'origin', offset: [0, -0.2, 0.4], intensity: 1 },
    ],
    hooks: [
      { time: 0, hook: 'stopAmbient' },
      { time: 0.28, hook: 'lightsDip' },
      { time: 1.45, hook: 'blackout' },
    ],
  },

  /** Lethal: the Tallyman closes in with two jerky stamps, grabs, and drags the view down. */
  tallymanJumpscare: {
    id: 'tallymanJumpscare',
    durationSeconds: 1.6,
    blendInSeconds: 0.14,
    blendOutSeconds: 0,
    returnsControl: false,
    locksControls: true,
    originFacing: 'actor',
    overridesListener: true,
    ambientDuck: 1,
    hidesHud: true,
    camera: [
      originCamera(0, [0, 0, 0], [0, 0.3, 4], 72, 0, 'linear'),
      originCamera(0.35, [0, 0.02, 0], [0, 0.45, 2], 66, -0.03, 'step'),
      originCamera(0.62, [0, -0.08, -0.08], [0, 0.4, 1], 60, 0.05, 'step'),
      originCamera(1.0, [0.1, -0.7, -0.15], [0.3, 0.9, 1], 62, 0.28, 'easeInQuad'),
      originCamera(1.6, [0.15, -1.1, -0.2], [0.4, 1.4, 0.8], 64, 0.45, 'easeOutQuad'),
    ],
    actor: [
      actorKey(0, 'actorStart', [0, 0, 0], { eyeGlow: 1.8, gait: 0.6 }),
      actorKey(0.35, 'origin', [0.25, -1.62, 1.7], { eyeGlow: 2.4, gait: 0.9, ease: 'step' }),
      actorKey(0.62, 'origin', [0.05, -1.62, 0.85], { eyeGlow: 3, gait: 1, lunging: true, ease: 'step' }),
      actorKey(1.6, 'origin', [0.05, -1.62, 0.7], { eyeGlow: 3.2, gait: 0.1, lunging: true, ease: 'linear' }),
    ],
    post: [
      post(0, { aberration: 0.5, noise: 0.06 }),
      post(0.35, { aberration: 2, shake: 0.008, noise: 0.12, ease: 'step' }),
      post(0.62, { flashIntensity: 0.7, flashColor: [1, 0.6, 0.15], aberration: 5, shake: 0.016, noise: 0.22, ease: 'step' }),
      post(0.85, { flashIntensity: 0.05, flashColor: [1, 0.6, 0.15], aberration: 3.5, shake: 0.01, noise: 0.2, ease: 'easeOutQuad' }),
      post(1.6, { aberration: 2, shake: 0.004, noise: 0.18, fadeToBlack: 1, ease: 'easeInQuad' }),
    ],
    audio: [
      { time: 0, cue: 'tallymanBell', frame: 'actor', offset: [0, 2.2, 0], intensity: 1.2 },
      { time: 0.35, cue: 'tallymanStep', frame: 'origin', offset: [0.25, -1.6, 1.7], intensity: 1.4 },
      { time: 0.62, cue: 'tallymanPunch', frame: 'origin', offset: [0, -0.3, 0.8], intensity: 1.6 },
      { time: 0.64, cue: 'metalStinger', frame: 'origin', offset: [0, 0, 0.5], intensity: 1 },
      { time: 1.0, cue: 'impactCrunch', frame: 'origin', offset: [0, -1, 0.3], intensity: 1.2 },
    ],
    hooks: [
      { time: 0, hook: 'stopAmbient' },
      { time: 0.62, hook: 'lightsDip' },
      { time: 1.6, hook: 'blackout' },
    ],
  },

  /** Lethal: the floor is gone; the view drops, tumbles and hits darkness. */
  fallDeath: {
    id: 'fallDeath',
    durationSeconds: 1.1,
    blendInSeconds: 0.05,
    blendOutSeconds: 0,
    returnsControl: false,
    locksControls: true,
    originFacing: 'camera',
    overridesListener: true,
    ambientDuck: 0.8,
    hidesHud: true,
    camera: [
      originCamera(0, [0, 0, 0], [0, -0.6, 3], 74, 0, 'linear'),
      originCamera(0.8, [0, -3.2, 1.0], [0.4, -7, 1.6], 84, 0.65, 'easeInQuad'),
      originCamera(1.1, [0, -3.4, 1.05], [0.4, -7.2, 1.6], 84, 0.7, 'linear'),
    ],
    actor: [],
    post: [
      post(0, { noise: 0.06 }),
      post(0.75, { aberration: 2.5, shake: 0.008, noise: 0.18, fadeToBlack: 0.4, ease: 'easeInQuad' }),
      post(0.85, { flashIntensity: 0.35, flashColor: [0.25, 0.02, 0.02], aberration: 4, shake: 0.02, noise: 0.25, fadeToBlack: 0.6, ease: 'step' }),
      post(1.1, { fadeToBlack: 1, noise: 0.2, ease: 'easeOutQuad' }),
    ],
    audio: [{ time: 0.84, cue: 'impactCrunch', frame: 'origin', offset: [0, -3.2, 1], intensity: 1.4 }],
    hooks: [{ time: 1.1, hook: 'blackout' }],
  },

  /** Lethal: the lungs give out; the view sinks to the floor and the gas closes over it. */
  toxicCollapse: {
    id: 'toxicCollapse',
    durationSeconds: 2.0,
    blendInSeconds: 0.1,
    blendOutSeconds: 0,
    returnsControl: false,
    locksControls: true,
    originFacing: 'camera',
    overridesListener: false,
    ambientDuck: 0.7,
    hidesHud: false,
    camera: [
      originCamera(0, [0, 0, 0], [0, 0, 3], 72, 0, 'linear'),
      originCamera(0.6, [0.05, -0.25, 0.05], [0.2, -0.2, 3], 70, 0.12, 'easeInOutSine'),
      originCamera(1.6, [0.2, -1.25, 0.3], [1.2, -1.45, 1.5], 64, 0.95, 'easeInQuad'),
      originCamera(2.0, [0.22, -1.3, 0.32], [1.25, -1.5, 1.5], 62, 1.0, 'linear'),
    ],
    actor: [],
    post: [
      post(0, { flashIntensity: 0.05, flashColor: [0.2, 0.55, 0.08], noise: 0.08, aberration: 1 }),
      post(1.2, { flashIntensity: 0.3, flashColor: [0.2, 0.55, 0.08], noise: 0.2, aberration: 3, shake: 0.004, fadeToBlack: 0.3, ease: 'easeInQuad' }),
      post(2.0, { flashIntensity: 0.4, flashColor: [0.15, 0.4, 0.05], noise: 0.25, aberration: 3, fadeToBlack: 1, ease: 'easeInQuad' }),
    ],
    audio: [],
    hooks: [
      { time: 0, hook: 'choke' },
      { time: 2.0, hook: 'blackout' },
    ],
  },
};
