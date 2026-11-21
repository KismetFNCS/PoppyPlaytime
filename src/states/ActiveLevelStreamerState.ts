import type { ManagedThreat, ThreatEventMap } from '../ai/ThreatDirector';
import { ThreatDirector } from '../ai/ThreatDirector';
import type { NoiseSource, PlayerSignature } from '../ai/Perception';
import { lightExposureFromIlluminance } from '../ai/Perception';
import type { CameraPose } from '../cinematics/CinematicDirector';
import { CinematicDirector } from '../cinematics/CinematicDirector';
import { CINEMATIC_LIBRARY } from '../cinematics/CinematicLibrary';
import type { CinematicHookId, CinematicId } from '../cinematics/CinematicTimeline';
import { LIGHT_PALETTE, UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../config/GameConstants';
import type { SpatialCueId } from '../core/AudioManager';
import type { GameServices } from '../core/GameServices';
import type { DeathCause, FrameContext, FrameRenderRequest, GameStateHandler, GameStatePayloadMap } from '../core/GameStateTypes';
import { GameStateId } from '../core/GameStateTypes';
import type { InputManager } from '../core/InputManager';
import type { SaveCheckpoint } from '../core/PersistentStores';
import type { MotorIntent, MotorStepReport } from '../gameplay/CharacterMotor';
import { CharacterMotor } from '../gameplay/CharacterMotor';
import type { GasMaskFrameReport } from '../gameplay/GasMaskSystem';
import { GasMaskSystem } from '../gameplay/GasMaskSystem';
import { LEVEL_TRIGGER_RULES } from '../gameplay/LevelRules';
import { RelayPlateNetwork } from '../gameplay/RelayPlateNetwork';
import type { ClawSide, ClawState, TetherControlInput, TetherEventMap } from '../gameplay/TetherRig';
import { TetherRig } from '../gameplay/TetherRig';
import { TypedEventBus } from '../gameplay/TypedEventBus';
import type { QuestFlagId, ToastTone, TriggerActionHost } from '../gameplay/WorldEventSystem';
import { WorldEventSystem } from '../gameplay/WorldEventSystem';
import type { SceneEnvironment } from '../graphics/SceneRenderer';
import type { Vec3 } from '../math/Vec3';
import { clamp, smoothstep, vec3Add } from '../math/Vec3';
import { GasMaskOverlay } from '../ui/GasMaskOverlay';
import type { BreakerSwitchRecord, PickupRecord, Polarity, ThreatKind, ToxicZone, WorldRayHit } from '../world/LevelStreamer';
import { CORRIDOR_DIMENSIONS, LevelStreamer, chunkIndexAtZ, chunkStartZ } from '../world/LevelStreamer';
import type { MenuBackdropScene } from '../world/MenuBackdropScene';

const LEVEL_WORLD_SEED: number = 0x5eed_0006;
const LEVEL_ENVIRONMENT: SceneEnvironment = { ambientColor: [0.012, 0.011, 0.016], clearColor: [0, 0, 0] };
const METERS_PER_CHUNK: number = 4;
const ENTITY_AWAKEN_DISTANCE_METERS: number = 16;
const ENTITY_AWAKEN_SECONDS: number = 14;
const ENTITY_SPAWN_BEHIND_METERS: number = 15;
const MASK_STATION_PICKUP_ID: string = 'pickup.gasMask.1';
const INTERACT_REACH_METERS: number = 2.4;
const MOUSE_RADIANS_PER_PIXEL: number = 0.0022;
const KEYBOARD_LOOK_RADIANS_PER_SECOND: number = 2.1;
const PITCH_LIMIT_RADIANS: number = 1.35;
/** Landing camera dip spring: ÿ = −k·y − c·ẏ. */
const LANDING_SPRING_STIFFNESS: number = 140;
const LANDING_SPRING_DAMPING: number = 16;
const POLARITY_COLORS: Readonly<Record<Polarity, string>> = { amber: '#ffa22e', violet: '#a54dff' };
const TOAST_COLORS: Readonly<Record<ToastTone, string>> = { info: UI_COLORS.textPrimary, success: '#8fd18a', warning: '#e9c46a', danger: UI_COLORS.accentRed };
const LETTERBOX_HEIGHT: number = 96;

interface HudToast {
  text: string;
  remainingSeconds: number;
  color: string;
}

type AimKind = 'none' | 'surface' | 'anchor' | 'relayPlate';

interface AimInfo {
  kind: AimKind;
  polarity: Polarity | null;
  distance: number;
}

interface PendingDeath {
  readonly cause: DeathCause;
  readonly threat: ThreatKind | null;
}

/**
 * Active Level Streamer: physics-driven first-person play in the streamed corridor, with the Tether Rig,
 * gas mask survival loop, AI threats (ThreatDirector), the world event / quest-flag matrix and the
 * cinematic driver for reveals, transitions and in-world jumpscares.
 */
export class ActiveLevelStreamerState implements GameStateHandler<GameStateId.ActiveLevelStreamer>, TriggerActionHost {
  public readonly id = GameStateId.ActiveLevelStreamer;
  private streamer: LevelStreamer | null = null;
  private rig: TetherRig | null = null;
  private relayNetwork: RelayPlateNetwork | null = null;
  private threats: ThreatDirector | null = null;
  private worldEvents: WorldEventSystem | null = null;
  private readonly cinematics: CinematicDirector = new CinematicDirector();
  private readonly tetherEvents: TypedEventBus<TetherEventMap> = new TypedEventBus();
  private readonly motor: CharacterMotor = new CharacterMotor();
  private readonly gasMask: GasMaskSystem = new GasMaskSystem();
  private readonly maskOverlay: GasMaskOverlay = new GasMaskOverlay();
  private readonly eventUnsubscribers: Array<() => void> = [];
  private checkpoint: SaveCheckpoint | null = null;
  private yawRadians: number = 0;
  private pitchRadians: number = 0;
  private sessionSeconds: number = 0;
  private spawnZ: number = 0;
  private currentChunk: number = 0;
  private dread: number = 0;
  private objectiveOpacity: number = 0;
  private toast: HudToast | null = null;
  private pendingDeath: PendingDeath | null = null;
  private deathRequested: boolean = false;
  private bobPhase: number = 0;
  private lastFootstepPhase: number = 0;
  private landingDip: number = 0;
  private landingDipVelocity: number = 0;
  private aim: AimInfo = { kind: 'none', polarity: null, distance: 0 };
  private pickupInView: PickupRecord | null = null;
  private switchInView: BreakerSwitchRecord | null = null;
  private meterFlash: number = 0;
  private letterbox: number = 0;

  public constructor(private readonly services: GameServices, private readonly backdrop: MenuBackdropScene) {}

  // ---- Lifecycle ------------------------------------------------------------------------------------------------

  public enter(payload: GameStatePayloadMap[GameStateId.ActiveLevelStreamer]): void {
    const services: GameServices = this.services;
    this.backdrop.unload();
    services.lighting.clear();
    this.checkpoint = payload.checkpoint;
    if (payload.mode === 'newGame') {
      services.save.write(payload.checkpoint);
    }
    const streamer = new LevelStreamer(services.gl, services.meshes, services.lighting, LEVEL_WORLD_SEED);
    if (payload.checkpoint.inventory.hasGasMask) {
      streamer.markPickupCollected(MASK_STATION_PICKUP_ID);
    }
    streamer.restoreSolvedState(payload.checkpoint.world.poweredPlateIds, payload.checkpoint.world.solvedSequenceIds);
    const spawnChunk: number = payload.checkpoint.checkpointChunkIndex;
    streamer.primeAround(spawnChunk);
    this.streamer = streamer;
    this.spawnZ = chunkStartZ(spawnChunk) - 2.6;
    this.motor.teleport([0, 0.02, this.spawnZ]);
    this.yawRadians = 0;
    this.pitchRadians = 0;
    this.currentChunk = spawnChunk;
    this.gasMask.restore(payload.checkpoint.inventory.hasGasMask);

    const rig = new TetherRig(services.gl, services.meshes, this.tetherEvents);
    this.rig = rig;
    this.relayNetwork = new RelayPlateNetwork(this.tetherEvents, streamer, rig);
    this.threats = new ThreatDirector(services.meshes, services.lighting, streamer, services.audio);
    const worldEvents = new WorldEventSystem(streamer, this, LEVEL_TRIGGER_RULES);
    worldEvents.restoreFlags(payload.checkpoint.questFlags as Partial<Record<QuestFlagId, number>>);
    this.worldEvents = worldEvents;
    this.subscribeFeedback();

    this.sessionSeconds = 0;
    this.dread = 0;
    this.objectiveOpacity = 0;
    this.pendingDeath = null;
    this.deathRequested = false;
    this.bobPhase = 0;
    this.lastFootstepPhase = 0;
    this.landingDip = 0;
    this.landingDipVelocity = 0;
    this.meterFlash = 0;
    this.letterbox = 0;
    this.cinematics.stop();
    services.audio.startAmbientDrone();
    services.audio.setMaskAudioMix(0);
    this.placeCamera(0);

    if (payload.mode === 'newGame' && worldEvents.flag('elevatorIntroSeen') < 1) {
      worldEvents.setFlag('elevatorIntroSeen', 1);
      this.playCinematic('elevatorArrival');
      this.showToast('FOLLOW THE LIGHTS DOWN', 4, 'info');
    } else {
      this.showToast(payload.mode === 'retry' ? 'RESUMING FROM LAST CHECKPOINT' : 'SHIFT RECORD RESTORED', 3.5, 'info');
    }
  }

  public exit(): void {
    for (const unsubscribe of this.eventUnsubscribers) {
      unsubscribe();
    }
    this.eventUnsubscribers.length = 0;
    this.cinematics.stop();
    this.worldEvents?.dispose();
    this.worldEvents = null;
    this.threats?.dispose();
    this.threats = null;
    this.relayNetwork?.dispose();
    this.relayNetwork = null;
    this.rig?.dispose();
    this.rig = null;
    this.tetherEvents.clear();
    this.services.input.releasePointerLock();
    this.streamer?.dispose();
    this.streamer = null;
    this.services.lighting.clear();
    this.services.audio.setDreadLevel(0);
    this.services.audio.setMaskAudioMix(0);
    this.services.audio.overrideListener(null);
    this.services.audio.setCinematicDuck(0);
  }

  /** Wires tether, relay and threat events into audio, noise, toasts and the world event matrix. */
  private subscribeFeedback(): void {
    const audio = this.services.audio;
    const bus: TypedEventBus<TetherEventMap> = this.tetherEvents;
    const threats: ThreatDirector = this.threats as ThreatDirector;
    const worldEvents: WorldEventSystem = this.worldEvents as WorldEventSystem;
    this.eventUnsubscribers.push(
      bus.on('clawFired', (event: TetherEventMap['clawFired']) => {
        audio.playTetherFire();
        threats.emitNoise('tetherFire', event.origin);
      }),
      bus.on('clawLatched', (event: TetherEventMap['clawLatched']) => {
        audio.playTetherLatch();
        threats.emitNoise('tetherImpact', event.point, 0.7);
        if (event.target.kind === 'anchor') {
          this.showToast('ANCHORED · HOLD TO SWING · SPACE / WHEEL TO REEL', 2.2, 'info');
        }
      }),
      bus.on('clawDeflected', (event: TetherEventMap['clawDeflected']) => {
        audio.playTetherClank();
        threats.emitNoise('tetherImpact', event.point);
      }),
      bus.on('clawRangeLimit', () => audio.playTetherRetract()),
      bus.on('clawRetracted', () => audio.playTetherRetract()),
      bus.on('plateActivated', (event: TetherEventMap['plateActivated']) => {
        audio.playRelayAccepted();
        this.showToast(`${event.polarity.toUpperCase()} RELAY ENGAGED · GATE OPENING`, 3, 'success', POLARITY_COLORS[event.polarity]);
        worldEvents.notify('relayPowered', { plateId: event.plateId, position: this.playerPosition() });
      }),
      bus.on('plateRejected', (event: TetherEventMap['plateRejected']) => {
        audio.playRelayRejected();
        this.showToast(`POLARITY MISMATCH · PLATE REQUIRES ${event.platePolarity.toUpperCase()}`, 2.6, 'danger');
        worldEvents.notify('polarityRejected', { plateId: event.plateId, position: this.playerPosition() });
      }),
      threats.events.on('threatSpotted', (event: ThreatEventMap['threatSpotted']) => {
        worldEvents.notify('threatSpotted', { kind: event.kind, position: event.position });
      }),
      threats.events.on('playerCaught', (event: ThreatEventMap['playerCaught']) => {
        this.beginLethalCinematic(event.kind === 'tallyman' ? 'tallymanJumpscare' : 'jesterJumpscare', { cause: 'entity', threat: event.kind }, threats.threat(event.id));
      }),
    );
  }

  // ---- TriggerActionHost -------------------------------------------------------------------------------------------

  public playerPosition(): Vec3 {
    return [this.motor.position[0], this.motor.position[1], this.motor.position[2]];
  }

  public showToast(text: string, seconds: number, tone: ToastTone, colorOverride: string | null = null): void {
    this.toast = { text, remainingSeconds: seconds, color: colorOverride ?? TOAST_COLORS[tone] };
  }

  public playCinematic(cinematicId: CinematicId): void {
    if (this.cinematics.ownsCamera || this.deathRequested) {
      return;
    }
    const actorThreat: ManagedThreat | null = cinematicId === 'jesterReveal' ? (this.threats?.threat('threat.jester.primary') ?? null) : null;
    this.startCinematic(cinematicId, actorThreat, () => undefined);
  }

  public emitNoise(source: NoiseSource, position: Vec3, loudness: number): void {
    this.threats?.emitNoise(source, position, loudness);
  }

  public playSpatialCue(cue: SpatialCueId, position: Vec3, intensity: number): void {
    this.services.audio.playSpatialCue(cue, position, intensity);
  }

  public saveCheckpoint(): void {
    this.commitCheckpoint(this.buildCheckpoint({}));
  }

  // ---- Cinematics --------------------------------------------------------------------------------------------------

  private handleCinematicHook(hook: CinematicHookId): void {
    const services: GameServices = this.services;
    switch (hook) {
      case 'lightsDip':
        services.lighting.globalIntensityScale = 0.12;
        break;
      case 'lightsRestore':
        services.lighting.globalIntensityScale = 1;
        break;
      case 'stopAmbient':
        services.audio.stopAmbientDrone(0.1);
        break;
      case 'resumeAmbient':
        services.audio.startAmbientDrone();
        break;
      case 'choke':
        services.audio.playChoke();
        break;
      case 'doorsOpen':
        services.audio.playSpatialCue('breakerClunk', [this.motor.position[0], 1.5, this.motor.position[2] + 0.4], 1.2);
        break;
      case 'blackout':
        this.finalizeDeath();
        break;
    }
  }

  private startCinematic(cinematicId: CinematicId, actorThreat: ManagedThreat | null, onComplete: () => void): void {
    const services: GameServices = this.services;
    if (actorThreat !== null && this.threats !== null) {
      // The cinematic owns the actor's pose for its duration.
      this.threats.suppressed = true;
    }
    this.cinematics.play(CINEMATIC_LIBRARY[cinematicId], {
      camera: services.camera,
      actor: actorThreat?.view ?? null,
      audio: services.audio,
      post: services.postParameters,
      gameplayPose: () => this.computeGameplayPose(),
      onHook: (hook: CinematicHookId) => this.handleCinematicHook(hook),
      onComplete: () => {
        services.lighting.globalIntensityScale = 1;
        if (this.threats !== null && this.pendingDeath === null) {
          this.threats.suppressed = false;
        }
        onComplete();
      },
    });
  }

  /** Lethal outcome: take over the camera in-world, then cut to the death state on the blackout hook. */
  private beginLethalCinematic(cinematicId: CinematicId, death: PendingDeath, actorThreat: ManagedThreat | null): void {
    if (this.pendingDeath !== null || this.deathRequested) {
      return;
    }
    this.pendingDeath = death;
    this.services.input.releasePointerLock();
    this.rig?.reset();
    if (this.threats !== null) {
      this.threats.suppressed = true;
    }
    this.startCinematic(cinematicId, actorThreat, () => this.finalizeDeath());
  }

  private finalizeDeath(): void {
    const death: PendingDeath | null = this.pendingDeath;
    if (death === null || this.deathRequested || this.checkpoint === null) {
      return;
    }
    this.deathRequested = true;
    const deathCheckpoint: SaveCheckpoint = this.buildCheckpoint({ deathCount: this.checkpoint.deathCount + 1 });
    this.services.save.write(deathCheckpoint);
    this.services.lifecycle.requestTransition(
      {
        target: GameStateId.JumpscareDeathSequence,
        payload: { checkpoint: deathCheckpoint, survivedSeconds: this.sessionSeconds, depthMeters: this.depthMeters, cause: death.cause, threat: death.threat },
      },
      'cut',
    );
  }

  // ---- Save helpers -----------------------------------------------------------------------------------------------

  private get depthMeters(): number {
    return Math.max(0, -this.motor.position[2] / CORRIDOR_DIMENSIONS.chunkLength) * METERS_PER_CHUNK;
  }

  private buildCheckpoint(overrides: Partial<Pick<SaveCheckpoint, 'checkpointChunkIndex' | 'deathCount'>>): SaveCheckpoint {
    const previous: SaveCheckpoint = this.checkpoint as SaveCheckpoint;
    return {
      version: 3,
      checkpointChunkIndex: overrides.checkpointChunkIndex ?? previous.checkpointChunkIndex,
      deepestChunkIndex: Math.max(previous.deepestChunkIndex, this.currentChunk),
      playTimeSeconds: Math.round((previous.playTimeSeconds + this.sessionSeconds) * 100) / 100,
      deathCount: overrides.deathCount ?? previous.deathCount,
      inventory: { hasGasMask: this.gasMask.isAvailable },
      questFlags: this.worldEvents?.flagSnapshot ?? previous.questFlags,
      world: {
        poweredPlateIds: this.streamer?.poweredPlates ?? previous.world.poweredPlateIds,
        solvedSequenceIds: this.streamer?.solvedSequences ?? previous.world.solvedSequenceIds,
      },
      savedAtIso: new Date().toISOString(),
    };
  }

  /** Writes the save and rebases session time so play time is never double counted. */
  private commitCheckpoint(checkpoint: SaveCheckpoint): void {
    this.services.save.write(checkpoint);
    this.checkpoint = { ...checkpoint, playTimeSeconds: checkpoint.playTimeSeconds - this.sessionSeconds };
  }

  private recordCheckpoint(chunkIndex: number): void {
    this.commitCheckpoint(this.buildCheckpoint({ checkpointChunkIndex: chunkIndex }));
    this.services.audio.playCheckpointChime();
    this.showToast('PROGRESS RECORDED', 2.8, 'success');
    this.playCinematic('checkpointDescent');
  }

  // ---- Input mapping -------------------------------------------------------------------------------------------

  private applyLook(input: InputManager, deltaSeconds: number, controlsEnabled: boolean): void {
    const [mouseDeltaX, mouseDeltaY] = input.consumeMouseDelta();
    if (!controlsEnabled) {
      return;
    }
    const settings = this.services.settings.values;
    const invert: number = settings.invertLookY ? -1 : 1;
    const lookScale: number = MOUSE_RADIANS_PER_PIXEL * settings.mouseSensitivity;
    this.yawRadians -= mouseDeltaX * lookScale;
    this.pitchRadians -= mouseDeltaY * lookScale * invert;
    const keyboardStep: number = KEYBOARD_LOOK_RADIANS_PER_SECOND * deltaSeconds * settings.mouseSensitivity;
    if (input.isKeyHeld('ArrowLeft')) this.yawRadians += keyboardStep;
    if (input.isKeyHeld('ArrowRight')) this.yawRadians -= keyboardStep;
    if (input.isKeyHeld('ArrowUp')) this.pitchRadians += keyboardStep * 0.6 * invert;
    if (input.isKeyHeld('ArrowDown')) this.pitchRadians -= keyboardStep * 0.6 * invert;
    this.pitchRadians = clamp(this.pitchRadians, -PITCH_LIMIT_RADIANS, PITCH_LIMIT_RADIANS);
  }

  private buildMotorIntent(input: InputManager, controlsEnabled: boolean): MotorIntent {
    if (!controlsEnabled) {
      return { moveForward: 0, moveRight: 0, wantsRun: false, wantsCrouch: this.motor.isCrouching, jumpPressed: false, yawRadians: this.yawRadians };
    }
    const axis = (positive: string, negative: string): number => (input.isKeyHeld(positive) ? 1 : 0) - (input.isKeyHeld(negative) ? 1 : 0);
    return {
      moveForward: axis('KeyW', 'KeyS'),
      moveRight: axis('KeyD', 'KeyA'),
      wantsRun: input.isKeyHeld('ShiftLeft') || input.isKeyHeld('ShiftRight'),
      wantsCrouch: input.isKeyHeld('KeyC'),
      jumpPressed: input.wasKeyPressed('Space'),
      yawRadians: this.yawRadians,
    };
  }

  private buildTetherInput(input: InputManager, controlsEnabled: boolean, motorIntent: MotorIntent): TetherControlInput {
    if (!controlsEnabled) {
      return { leftTriggerPressed: false, leftTriggerHeld: false, rightTriggerPressed: false, rightTriggerHeld: false, reelInput: 0, pumpInput: 0 };
    }
    const locked: boolean = input.isPointerLocked;
    const leftPressed: boolean = (locked && input.wasMouseButtonPressed(0)) || input.wasKeyPressed('KeyQ');
    const rightPressed: boolean = (locked && input.wasMouseButtonPressed(2)) || input.wasKeyPressed('KeyR');
    const leftHeld: boolean = (locked && input.isMouseButtonHeld(0)) || input.isKeyHeld('KeyQ');
    const rightHeld: boolean = (locked && input.isMouseButtonHeld(2)) || input.isKeyHeld('KeyR');
    const anchoredAirborne: boolean = (this.rig?.isAnchored ?? false) && !this.motor.isGrounded;
    // Wheel up (negative steps) reels in; holding Space while airborne on a rope also reels in.
    const reelInput: number = -input.wheelSteps * 6 + (anchoredAirborne && input.isKeyHeld('Space') ? 1 : 0);
    return { leftTriggerPressed: leftPressed, leftTriggerHeld: leftHeld, rightTriggerPressed: rightPressed, rightTriggerHeld: rightHeld, reelInput, pumpInput: motorIntent.moveForward };
  }

  // ---- Camera ------------------------------------------------------------------------------------------------------

  /** Gameplay camera pose from the motor, head bob, landing spring and swing roll (does not touch the camera). */
  private computeGameplayPose(): CameraPose {
    const settings = this.services.settings.values;
    const speedRatio: number = this.motor.isGrounded ? clamp(this.motor.horizontalSpeed / this.motor.tuning.stances.run.maximumSpeed, 0, 1) : 0;
    const bobVertical: number = Math.abs(Math.sin(this.bobPhase)) * 0.055 * speedRatio;
    const bobLateral: number = Math.sin(this.bobPhase) * 0.03 * speedRatio;
    const eye: Vec3 = this.motor.eyePosition;
    const lateralVelocity: number = this.motor.velocity[0] * Math.cos(this.yawRadians) - this.motor.velocity[2] * Math.sin(this.yawRadians);
    const swingRoll: number = this.rig?.isAnchored && !this.motor.isGrounded ? clamp(-lateralVelocity * 0.012, -0.12, 0.12) : 0;
    const sprintWiden: number = this.motor.stance === 'run' ? 6 * speedRatio : 0;
    const maskNarrow: number = this.gasMask.coverage * 4;
    return {
      position: [eye[0] + Math.cos(this.yawRadians) * bobLateral, eye[1] + bobVertical + this.landingDip, eye[2] - Math.sin(this.yawRadians) * bobLateral],
      yawRadians: this.yawRadians,
      pitchRadians: this.pitchRadians,
      rollRadians: Math.sin(this.bobPhase) * 0.005 * speedRatio + swingRoll,
      fieldOfViewRadians: ((settings.fieldOfViewDegrees + sprintWiden - maskNarrow) * Math.PI) / 180,
    };
  }

  private placeCamera(deltaSeconds: number): void {
    // Landing dip spring integration (semi-implicit Euler).
    this.landingDipVelocity += (-LANDING_SPRING_STIFFNESS * this.landingDip - LANDING_SPRING_DAMPING * this.landingDipVelocity) * deltaSeconds;
    this.landingDip += this.landingDipVelocity * deltaSeconds;
    const pose: CameraPose = this.computeGameplayPose();
    const camera = this.services.camera;
    camera.position = [pose.position[0], pose.position[1], pose.position[2]];
    camera.yawRadians = pose.yawRadians;
    camera.pitchRadians = pose.pitchRadians;
    camera.rollRadians = pose.rollRadians;
    camera.fieldOfViewRadians = pose.fieldOfViewRadians;
  }

  private updateAim(streamer: LevelStreamer): void {
    const camera = this.services.camera;
    const range: number = this.rig?.tuning.maximumRange ?? 20;
    const hit: WorldRayHit | null = streamer.raycast(camera.position, camera.forward, range);
    if (hit === null) {
      this.aim = { kind: 'none', polarity: null, distance: range };
    } else if (hit.target !== null) {
      this.aim = { kind: hit.target.kind, polarity: hit.target.polarity, distance: hit.distance };
    } else {
      this.aim = { kind: 'surface', polarity: null, distance: hit.distance };
    }
    this.pickupInView = streamer.findPickupInView(camera.position, camera.forward, INTERACT_REACH_METERS);
    this.switchInView = this.pickupInView === null ? streamer.findSwitchInView(camera.position, camera.forward, INTERACT_REACH_METERS) : null;
  }

  private buildPlayerSignature(): PlayerSignature {
    const camera = this.services.camera;
    const feet: Vec3 = this.playerPosition();
    const chest: Vec3 = [feet[0], feet[1] + this.motor.currentHeight * 0.65, feet[2]];
    return {
      eyePosition: [camera.position[0], camera.position[1], camera.position[2]],
      chestPosition: chest,
      feetPosition: feet,
      viewDirection: camera.forward,
      isCrouching: this.motor.isCrouching,
      lightExposure: lightExposureFromIlluminance(this.services.lighting.illuminanceAt(chest)),
    };
  }

  // ---- Frame update -------------------------------------------------------------------------------------------------

  public update(frame: FrameContext): void {
    const streamer: LevelStreamer | null = this.streamer;
    const rig: TetherRig | null = this.rig;
    const threats: ThreatDirector | null = this.threats;
    const worldEvents: WorldEventSystem | null = this.worldEvents;
    if (streamer === null || rig === null || threats === null || worldEvents === null || this.checkpoint === null) {
      return;
    }
    const services: GameServices = this.services;
    const input: InputManager = services.input;
    const deltaSeconds: number = frame.deltaSeconds;
    const dying: boolean = this.pendingDeath !== null || this.deathRequested;
    const controlsEnabled: boolean = frame.inputEnabled && !dying && !this.cinematics.locksControls;
    this.sessionSeconds += deltaSeconds;
    this.objectiveOpacity = clamp(this.objectiveOpacity + deltaSeconds * 0.8, 0, 1);
    this.meterFlash = Math.max(0, this.meterFlash - deltaSeconds * 4);
    this.letterbox = clamp(this.letterbox + (this.cinematics.hidesHud ? deltaSeconds : -deltaSeconds) * 3, 0, 1);
    if (this.toast !== null) {
      this.toast.remainingSeconds -= deltaSeconds;
      if (this.toast.remainingSeconds <= 0) {
        this.toast = null;
      }
    }

    if (controlsEnabled) {
      if (!input.isPointerLocked && input.pointer.primaryPressedThisFrame) {
        input.requestPointerLock();
      }
      if (input.wasKeyPressed('Escape') && !input.isPointerLocked) {
        services.save.write(this.buildCheckpoint({}));
        services.audio.playUiCue('back');
        services.lifecycle.requestTransition({ target: GameStateId.TitleScreen, payload: { reason: 'returnFromLevel' } });
        return;
      }
    }

    // While dying, only the lethal cinematic advances (the world holds still behind it).
    if (dying) {
      input.consumeMouseDelta();
      this.cinematics.update(deltaSeconds);
      return;
    }

    // 1–3. Look, intent, provisional camera so launcher sockets track the view.
    this.applyLook(input, deltaSeconds, controlsEnabled);
    const intent: MotorIntent = this.buildMotorIntent(input, controlsEnabled);
    if (!this.cinematics.ownsCamera) {
      this.placeCamera(0);
    }
    services.camera.updateMatrices();

    // 4–7. Tether claws, cable forces, motor integration, rope constraints.
    rig.update(deltaSeconds, this.buildTetherInput(input, controlsEnabled, intent), streamer, services.camera);
    this.relayNetwork?.tick(deltaSeconds);
    const tension: Vec3 = vec3Add(rig.computeTensionAcceleration(this.motor), rig.computePumpAcceleration(this.motor, intent.moveForward));
    const report: MotorStepReport = this.motor.step(deltaSeconds, intent, streamer, tension);
    rig.enforceDistanceConstraints(this.motor, streamer);
    rig.enforceCableLimit();

    // 8. Landing, footsteps and the noises they make.
    if (report.landedThisStep && report.landingImpactSpeed > 2.5) {
      const impact: number = clamp((report.landingImpactSpeed - 2.5) / 9, 0, 1);
      this.landingDipVelocity -= 0.6 + impact * 2.4;
      services.audio.playImpactThud(impact);
      threats.emitNoise('landing', this.playerPosition(), 0.5 + impact);
    }
    if (this.motor.isGrounded) {
      this.bobPhase += deltaSeconds * this.motor.horizontalSpeed * (this.motor.stance === 'run' ? 2.25 : 2.6);
      const stepPhase: number = Math.floor(this.bobPhase / Math.PI);
      if (this.motor.horizontalSpeed > 0.6 && stepPhase !== this.lastFootstepPhase) {
        services.audio.playFootstep(this.motor.stance === 'run');
        const stepNoise: NoiseSource = this.motor.stance === 'run' ? 'footstepRun' : this.motor.stance === 'crouch' ? 'footstepCrouch' : 'footstepWalk';
        threats.emitNoise(stepNoise, this.playerPosition());
      }
      this.lastFootstepPhase = stepPhase;
    }

    // Camera: cinematic takeover or gameplay pose.
    if (this.cinematics.ownsCamera) {
      this.cinematics.update(deltaSeconds);
    } else {
      this.placeCamera(deltaSeconds);
    }
    const camera = services.camera;
    services.audio.setListenerPose({ position: camera.position, forward: camera.forward, up: [0, 1, 0] });

    // 9. Fall kill plane.
    if (this.motor.position[1] < CORRIDOR_DIMENSIONS.fallKillHeight) {
      this.beginLethalCinematic('fallDeath', { cause: 'fall', threat: null }, null);
      return;
    }

    // 10. Interaction: pickups first, then breaker switches.
    this.updateAim(streamer);
    if (controlsEnabled && input.wasKeyPressed('KeyE')) {
      if (this.pickupInView !== null) {
        const collected: PickupRecord | null = streamer.collectPickup(this.pickupInView.id);
        if (collected !== null && collected.kind === 'gasMask') {
          this.gasMask.grant();
          services.audio.playMaskSeal(false);
          worldEvents.reportPickup(collected.id, collected.kind, collected.position);
        }
      } else if (this.switchInView !== null) {
        worldEvents.pressSwitch(this.switchInView);
      }
    }

    // 11. Gas mask + toxicity survival meter.
    const exertion: number = this.motor.stance === 'run' && this.motor.horizontalSpeed > 2 ? 1 : rig.isAnchored && !this.motor.isGrounded ? 0.6 : 0;
    const togglePressed: boolean = controlsEnabled && input.wasKeyPressed('KeyG');
    const maskReport: GasMaskFrameReport = this.gasMask.update(deltaSeconds, {
      toggleRequested: togglePressed,
      concentration: streamer.toxicConcentrationAt(camera.position),
      exertion,
    });
    if (togglePressed && !this.gasMask.isAvailable) {
      services.audio.playUiCue('denied');
      this.showToast('NO GAS MASK', 1.5, 'info', UI_COLORS.textDim);
    }
    if (maskReport.toggledTo !== null) {
      services.audio.playMaskSeal(maskReport.toggledTo === 'equipping');
    }
    services.audio.setMaskAudioMix(this.gasMask.coverage);
    if (maskReport.breathCycleStarted) {
      const strain: number = (this.gasMask.coverage > 0.5 ? 1 - this.gasMask.filterRemaining : 0) * 0.7 + this.gasMask.exposure * 0.3;
      services.audio.playBreathCycle(1 / this.gasMask.breathsPerSecond, strain);
      if (strain > 0.5) {
        // A clogged filter wheezes loudly enough for nearby threats to hear.
        threats.emitNoise('strainedBreathing', this.playerPosition(), strain);
      }
    }
    if (maskReport.meterTicked) {
      services.audio.playMeterTick(this.gasMask.exposure);
      this.meterFlash = 1;
    }
    if (maskReport.lethal) {
      this.beginLethalCinematic('toxicCollapse', { cause: 'toxicity', threat: null }, null);
      return;
    }

    // 12. Streaming, checkpoints, zones and sequences.
    const newChunk: number = chunkIndexAtZ(this.motor.position[2]);
    if (newChunk !== this.currentChunk) {
      this.currentChunk = newChunk;
      if (streamer.isCheckpoint(newChunk) && newChunk > this.checkpoint.checkpointChunkIndex) {
        this.recordCheckpoint(newChunk);
      }
    }
    streamer.update(this.currentChunk, deltaSeconds);
    worldEvents.update(deltaSeconds, this.motor.boundsAt(this.motor.position));

    // 13. Threats: awaken the Jester, then tick every brain.
    if (!threats.isJesterAwake) {
      const travelled: number = this.spawnZ - this.motor.position[2];
      if (travelled > ENTITY_AWAKEN_DISTANCE_METERS || (this.sessionSeconds > ENTITY_AWAKEN_SECONDS && travelled > 6)) {
        const spawnPosition: Vec3 = [0, 0, Math.min(chunkStartZ(0) - 1, this.motor.position[2] + ENTITY_SPAWN_BEHIND_METERS)];
        const jester: ManagedThreat = threats.awakenJester(spawnPosition, this.playerPosition());
        worldEvents.notify('threatAwakened', { kind: 'jester', position: jester.view.position });
      }
    }
    threats.update(deltaSeconds, this.buildPlayerSignature());
    this.dread = threats.dreadAt(this.playerPosition());
    services.audio.setDreadLevel(this.dread);
    services.audio.updateHeartbeat(deltaSeconds, this.dread);
  }

  // ---- HUD -----------------------------------------------------------------------------------------------------------

  private drawCrosshair(context: CanvasRenderingContext2D, centerX: number, centerY: number): void {
    const aim: AimInfo = this.aim;
    context.save();
    if (aim.kind === 'anchor') {
      context.strokeStyle = '#6fa0ff';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(centerX, centerY, 18, 0, Math.PI * 2);
      context.stroke();
      context.font = UI_FONTS.small;
      context.textAlign = 'center';
      context.fillStyle = '#6fa0ff';
      context.fillText(`ANCHOR · ${aim.distance.toFixed(1)} M`, centerX, centerY + 50);
    } else if (aim.kind === 'relayPlate' && aim.polarity !== null) {
      const color: string = POLARITY_COLORS[aim.polarity];
      context.strokeStyle = color;
      context.lineWidth = 3;
      for (let bracket = 0; bracket < 4; bracket += 1) {
        const angle: number = (bracket / 4) * Math.PI * 2 + Math.PI / 4;
        context.beginPath();
        context.arc(centerX, centerY, 20, angle - 0.4, angle + 0.4);
        context.stroke();
      }
      context.font = UI_FONTS.small;
      context.textAlign = 'center';
      context.fillStyle = color;
      context.fillText(`${aim.polarity.toUpperCase()} RELAY`, centerX, centerY + 50);
    } else {
      context.fillStyle = 'rgba(233, 225, 207, 0.55)';
      context.fillRect(centerX - 2, centerY - 2, 4, 4);
    }
    const prompt: string | null = this.pickupInView !== null ? '[E] TAKE GAS MASK' : this.switchInView !== null ? '[E] THROW BREAKER' : null;
    if (prompt !== null) {
      context.font = UI_FONTS.chapter;
      context.textAlign = 'center';
      context.fillStyle = UI_COLORS.textPrimary;
      context.fillText(prompt, centerX, centerY + 90);
    }
    context.restore();
  }

  private drawClawIndicators(context: CanvasRenderingContext2D, width: number, height: number): void {
    const rig: TetherRig | null = this.rig;
    if (rig === null) {
      return;
    }
    const labels: Readonly<Record<ClawState['phase'], string>> = { holstered: 'READY', extending: 'OUT', latched: 'LOCKED', retracting: 'REEL' };
    const sides: ReadonlyArray<[ClawSide, string]> = [
      ['left', 'LMB/Q'],
      ['right', 'RMB/R'],
    ];
    context.save();
    context.font = UI_FONTS.small;
    sides.forEach(([side, binding]: [ClawSide, string], index: number) => {
      const claw: ClawState = rig.claws[side];
      const x: number = width / 2 + (index === 0 ? -330 : 30);
      const y: number = height - 104;
      context.globalAlpha = claw.phase === 'holstered' ? 0.85 : 1;
      context.fillStyle = 'rgba(0, 0, 0, 0.45)';
      context.fillRect(x, y, 300, 36);
      context.fillStyle = POLARITY_COLORS[claw.polarity];
      context.fillRect(x, y, 8, 36);
      context.fillText(`${claw.polarity.toUpperCase()} ${labels[claw.phase]}`, x + 18, y + 25);
      context.fillStyle = UI_COLORS.textDim;
      context.textAlign = 'right';
      context.fillText(binding, x + 292, y + 25);
      context.textAlign = 'left';
    });
    context.restore();
  }

  /** Toxicity survival meter: 24 segments, green→amber→red, flashing on each tick while exposure rises. */
  private drawToxicityMeter(context: CanvasRenderingContext2D, width: number, height: number): void {
    const mask: GasMaskSystem = this.gasMask;
    const showMeter: boolean = mask.exposure > 0.001 || mask.concentration > 0.01 || mask.isAvailable;
    if (!showMeter) {
      return;
    }
    const panelX: number = width - 600;
    const panelY: number = height - 190;
    const segments = 24;
    const segmentWidth = 19;
    context.save();
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    context.fillRect(panelX - 16, panelY - 44, 536, 150);
    context.font = UI_FONTS.small;
    context.fillStyle = UI_COLORS.textPrimary;
    context.fillText('TOXICITY', panelX, panelY - 14);
    const statusLabels: Readonly<Record<typeof mask.areaStatus, [string, string]>> = {
      clean: ['CLEAN AIR', '#8fd18a'],
      filtered: ['FILTERED AIR', '#e9c46a'],
      contaminated: ['CONTAMINATED', UI_COLORS.accentRed],
    };
    const [statusText, statusColor] = statusLabels[mask.areaStatus];
    context.textAlign = 'right';
    context.fillStyle = statusColor;
    context.fillText(statusText, panelX + 504, panelY - 14);
    context.textAlign = 'left';
    const filled: number = Math.ceil(mask.exposure * segments);
    for (let segment = 0; segment < segments; segment += 1) {
      const ratio: number = segment / (segments - 1);
      const red: number = Math.round(clamp(ratio * 2, 0, 1) * 220);
      const green: number = Math.round(clamp(2 - ratio * 2, 0, 1) * 200);
      const lit: boolean = segment < filled;
      context.fillStyle = lit ? `rgb(${red}, ${green}, 40)` : 'rgba(233, 225, 207, 0.1)';
      if (lit && segment === filled - 1 && this.meterFlash > 0.5) {
        context.fillStyle = '#ffffff';
      }
      context.fillRect(panelX + segment * (segmentWidth + 2), panelY, segmentWidth, 28);
    }
    context.fillStyle = UI_COLORS.textDim;
    if (mask.isAvailable) {
      context.fillText(`FILTER ${Math.round(mask.filterRemaining * 100)}%`, panelX, panelY + 62);
      context.textAlign = 'right';
      const maskStates: Readonly<Record<typeof mask.phase, string>> = {
        unavailable: '',
        stowed: '[G] EQUIP MASK',
        equipping: 'SEALING…',
        worn: '[G] REMOVE MASK',
        unequipping: 'REMOVING…',
      };
      context.fillText(maskStates[mask.phase], panelX + 504, panelY + 62);
      context.textAlign = 'left';
      context.fillStyle = 'rgba(233, 225, 207, 0.12)';
      context.fillRect(panelX, panelY + 74, 504, 6);
      context.fillStyle = mask.filterRemaining < 0.25 ? UI_COLORS.accentRed : '#8fd18a';
      context.fillRect(panelX, panelY + 74, 504 * mask.filterRemaining, 6);
    } else if (mask.concentration > 0.01) {
      context.fillStyle = UI_COLORS.accentRed;
      context.fillText('NO RESPIRATOR · LEAVE THE GAS', panelX, panelY + 62);
    }
    context.restore();
  }

  private drawHud(context: CanvasRenderingContext2D, timeSeconds: number): void {
    const width: number = VIRTUAL_RESOLUTION.width;
    const height: number = VIRTUAL_RESOLUTION.height;
    this.maskOverlay.draw(context, {
      coverage: this.gasMask.coverage,
      lensFog: this.gasMask.lensFog * this.gasMask.coverage,
      filterStrain: this.gasMask.isWorn ? 1 - this.gasMask.filterRemaining : 0,
      timeSeconds,
    });
    context.save();
    const hudAlpha: number = 1 - this.letterbox;
    context.globalAlpha = hudAlpha;
    if (hudAlpha > 0.01) {
      this.drawCrosshair(context, width / 2, height / 2);
      context.font = UI_FONTS.small;
      if (Math.floor(timeSeconds * 1.5) % 2 === 0) {
        context.fillStyle = UI_COLORS.accentRed;
        context.beginPath();
        context.arc(96, 86, 10, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = UI_COLORS.textPrimary;
      context.fillText('REC', 116, 94);
      context.fillText(`DEPTH  -${this.depthMeters.toFixed(1)} M`, 80, 136);
      context.fillText(`STANCE ${this.motor.stance.toUpperCase()}${this.motor.isGrounded ? '' : ' · AIRBORNE'}`, 80, 172);
      const totalSeconds: number = Math.floor((this.checkpoint?.playTimeSeconds ?? 0) + this.sessionSeconds);
      const clock: string = `${String(Math.floor(totalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
      context.textAlign = 'right';
      context.fillText(`SHIFT ${clock}`, width - 80, 94);
      context.fillText(`CHECKPOINT ${String(this.checkpoint?.checkpointChunkIndex ?? 0).padStart(3, '0')}`, width - 80, 136);
      context.textAlign = 'left';
      context.fillStyle = 'rgba(233, 225, 207, 0.12)';
      context.fillRect(80, height - 90, 360, 10);
      context.fillStyle = this.motor.stamina < 0.3 ? UI_COLORS.accentRed : 'rgba(233, 225, 207, 0.7)';
      context.fillRect(80, height - 90, 360 * this.motor.stamina, 10);
      context.fillStyle = UI_COLORS.textDim;
      context.fillText('STAMINA', 80, height - 104);
      this.drawClawIndicators(context, width, height);
      this.drawToxicityMeter(context, width, height);
      if (!this.services.input.isPointerLocked) {
        context.textAlign = 'center';
        context.fillStyle = UI_COLORS.textDim;
        context.fillText('CLICK TO LOOK · WASD · SHIFT RUN · C CROUCH · SPACE JUMP · LMB/RMB TETHER · G MASK · E USE · ESC MENU', width / 2, height - 30);
        context.textAlign = 'left';
      }
    }
    context.globalAlpha = 1;
    if (this.toast !== null) {
      context.globalAlpha = clamp(this.toast.remainingSeconds, 0, 1) * this.objectiveOpacity;
      context.font = UI_FONTS.chapter;
      context.textAlign = 'center';
      context.fillStyle = this.toast.color;
      context.shadowColor = UI_COLORS.accentRedGlow;
      context.shadowBlur = 18;
      context.fillText(this.toast.text, width / 2, height * 0.74);
      context.shadowBlur = 0;
      context.globalAlpha = 1;
      context.textAlign = 'left';
    }
    if (this.dread > 0.01) {
      const gradient: CanvasGradient = context.createRadialGradient(width / 2, height / 2, height * 0.25, width / 2, height / 2, height * 0.85);
      gradient.addColorStop(0, 'rgba(120, 0, 0, 0)');
      gradient.addColorStop(1, `rgba(120, 0, 0, ${(this.dread * 0.55).toFixed(3)})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    }
    if (this.gasMask.exposure > 0.35) {
      const pulse: number = 0.5 + 0.5 * Math.sin(timeSeconds * (2 + this.gasMask.exposure * 6));
      const strength: number = smoothstep(0.35, 1, this.gasMask.exposure) * (0.35 + pulse * 0.25);
      const sick: CanvasGradient = context.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.9);
      sick.addColorStop(0, 'rgba(60, 90, 10, 0)');
      sick.addColorStop(1, `rgba(60, 90, 10, ${strength.toFixed(3)})`);
      context.fillStyle = sick;
      context.fillRect(0, 0, width, height);
    }
    // Cinematic letterbox bars.
    if (this.letterbox > 0.001) {
      const barHeight: number = LETTERBOX_HEIGHT * this.letterbox;
      context.fillStyle = '#000000';
      context.fillRect(0, 0, width, barHeight);
      context.fillRect(0, height - barHeight, width, barHeight);
    }
    context.restore();
  }

  // ---- Render ----------------------------------------------------------------------------------------------------

  public render(frame: FrameContext, request: FrameRenderRequest, context: CanvasRenderingContext2D): void {
    request.renderScene = true;
    request.environment = LEVEL_ENVIRONMENT;
    this.streamer?.collectDrawItems(request.drawItems, frame.elapsedSeconds);
    this.threats?.collectDrawItems(request.drawItems);
    if (!this.cinematics.hidesHud) {
      this.rig?.collectDrawItems(request.drawItems, frame.elapsedSeconds);
    }

    const post = this.services.postParameters;
    const dreadCurve: number = smoothstep(0.2, 1, this.dread);
    post.crt.chromaticAberration *= 1 + dreadCurve * 2.5 + this.gasMask.exposure * 1.5;
    post.crt.noiseIntensity += dreadCurve * 0.08;
    post.crt.trackingJitter *= 1 + dreadCurve * 3;
    post.fog.ambientColor = [post.fog.ambientColor[0] + LIGHT_PALETTE.emergencyRed[0] * 0.02 * dreadCurve, post.fog.ambientColor[1], post.fog.ambientColor[2]];
    const zone: ToxicZone | null = this.streamer?.nearestToxicZone(this.services.camera.position) ?? null;
    if (zone !== null) {
      post.fog.toxicVolume = { ...post.fog.toxicVolume, minimum: zone.bounds.minimum, maximum: zone.bounds.maximum, density: 0.11 * zone.concentration };
    }
    this.drawHud(context, frame.elapsedSeconds);
  }
}
