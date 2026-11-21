import type { ManagedThreat, ThreatEventMap } from '../ai/ThreatDirector';
import { JESTER_THREAT_ID, ThreatDirector } from '../ai/ThreatDirector';
import type { NoiseSource, PlayerSignature } from '../ai/Perception';
import { lightExposureFromIlluminance } from '../ai/Perception';
import type { CameraPose } from '../cinematics/CinematicDirector';
import { CinematicDirector } from '../cinematics/CinematicDirector';
import { CINEMATIC_LIBRARY } from '../cinematics/CinematicLibrary';
import type { CinematicHookId, CinematicId } from '../cinematics/CinematicTimeline';
import { LIGHT_PALETTE, UI_COLORS } from '../config/GameConstants';
import type { SpatialCueId } from '../core/AudioManager';
import type { GameServices } from '../core/GameServices';
import type { DeathCause, FrameContext, FrameRenderRequest, GameStateHandler, GameStatePayloadMap } from '../core/GameStateTypes';
import { GameStateId } from '../core/GameStateTypes';
import type { InputManager } from '../core/InputManager';
import type { PlayerStateSnapshot, SaveGame, SaveKind, SaveSlotId } from '../core/serialization/SaveGameSchema';
import type { MotorIntent, MotorStepReport } from '../gameplay/CharacterMotor';
import { CharacterMotor } from '../gameplay/CharacterMotor';
import type { GasMaskFrameReport } from '../gameplay/GasMaskSystem';
import { GasMaskSystem } from '../gameplay/GasMaskSystem';
import type { HotbarSlotContent } from '../gameplay/Inventory';
import { HOTBAR_LAYOUT, ITEM_DEFINITIONS, Inventory } from '../gameplay/Inventory';
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
import type { CrosshairKind, HotbarSlotSnapshot, HudSnapshot } from '../ui/hud/HudController';
import { HudController, POLARITY_HUD_COLORS } from '../ui/hud/HudController';
import { PauseMenu } from '../ui/PauseMenu';
import { buildUiFrameInput } from '../ui/UIInputAdapter';
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
const TOAST_COLORS: Readonly<Record<ToastTone, string>> = { info: UI_COLORS.textPrimary, success: '#8fd18a', warning: '#e9c46a', danger: UI_COLORS.accentRed };
/** Session autosaves are attempted at this interval, but only at safe moments. */
const AUTOSAVE_INTERVAL_SECONDS: number = 45;
const HOTBAR_KEY_CODES: readonly string[] = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

interface HudToast {
  text: string;
  remainingSeconds: number;
  color: string;
}

interface AimInfo {
  kind: CrosshairKind;
  polarity: Polarity | null;
  distance: number;
}

interface PendingDeath {
  readonly cause: DeathCause;
  readonly threat: ThreatKind | null;
}

/**
 * Active Level Streamer: physics-driven first-person play in the streamed corridor, wiring together the
 * Tether Rig, gas mask + inventory, AI threats, world event matrix, cinematics, master HUD, pause menu
 * and save serialization.
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
  private readonly inventory: Inventory = new Inventory();
  private readonly hud: HudController = new HudController();
  private readonly pauseMenu: PauseMenu;
  private readonly eventUnsubscribers: Array<() => void> = [];
  /** The checkpoint record respawns use (play time excludes the current session). */
  private checkpoint: SaveGame | null = null;
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
  private paused: boolean = false;
  private pointerWasLocked: boolean = false;
  private autosaveTimer: number = 0;
  private leavingLevel: boolean = false;

  public constructor(private readonly services: GameServices, private readonly backdrop: MenuBackdropScene) {
    this.pauseMenu = new PauseMenu(
      services.settings,
      {
        resume: () => this.resumeFromPause(),
        saveGame: () => this.quickSave('quicksave'),
        restartFromCheckpoint: () => this.restartFromCheckpoint(),
        saveAndQuit: () => this.saveAndQuit(),
      },
      (cue) => services.audio.playUiCue(cue),
    );
  }

  // ---- Lifecycle ------------------------------------------------------------------------------------------------

  public enter(payload: GameStatePayloadMap[GameStateId.ActiveLevelStreamer]): void {
    const services: GameServices = this.services;
    const save: SaveGame = payload.save;
    this.backdrop.unload();
    services.lighting.clear();
    this.leavingLevel = false;
    this.checkpoint = { ...save, kind: 'checkpoint', player: null };
    if (payload.mode === 'newGame') {
      services.saves.write({ ...save, slot: 'autosave', kind: 'checkpoint', player: null });
    }

    // World and puzzle state.
    const streamer = new LevelStreamer(services.gl, services.meshes, services.lighting, LEVEL_WORLD_SEED);
    for (const pickupId of save.world.collectedPickupIds) {
      streamer.markPickupCollected(pickupId);
    }
    if (save.inventory.items.gasMask > 0) {
      streamer.markPickupCollected(MASK_STATION_PICKUP_ID);
    }
    streamer.restoreSolvedState(save.world.poweredPlateIds, save.world.solvedSequenceIds);

    // Player: exact session resume, or checkpoint spawn.
    const resume: PlayerStateSnapshot | null = payload.mode === 'continue' && save.kind === 'session' ? save.player : null;
    this.inventory.restore(save.inventory);
    this.gasMask.restore(this.inventory.has('gasMask'));
    const spawnChunk: number = resume !== null ? chunkIndexAtZ(resume.transform.position[2]) : save.checkpointChunkIndex;
    streamer.primeAround(spawnChunk);
    this.streamer = streamer;
    this.currentChunk = spawnChunk;
    if (resume !== null) {
      this.applyPlayerSnapshot(resume);
    } else {
      this.motor.teleport([0, 0.02, chunkStartZ(spawnChunk) - 2.6]);
      this.yawRadians = 0;
      this.pitchRadians = 0;
    }
    this.spawnZ = this.motor.position[2];

    // Systems.
    const rig = new TetherRig(services.gl, services.meshes, this.tetherEvents);
    this.rig = rig;
    this.relayNetwork = new RelayPlateNetwork(this.tetherEvents, streamer, rig);
    this.threats = new ThreatDirector(services.meshes, services.lighting, streamer, services.audio);
    const worldEvents = new WorldEventSystem(streamer, this, LEVEL_TRIGGER_RULES);
    worldEvents.restoreFlags(save.questFlags as Partial<Record<QuestFlagId, number>>);
    this.worldEvents = worldEvents;
    this.subscribeFeedback();
    if (resume !== null && save.threats.jesterAwake) {
      // Restored silently: the reveal rule already fired in the original session (flag set).
      const behind: Vec3 = [0, 0, Math.min(chunkStartZ(0) - 1, this.motor.position[2] + ENTITY_SPAWN_BEHIND_METERS)];
      this.threats.awakenJester(save.threats.jesterPosition ?? behind, this.playerPosition());
    }

    // Per-entry presentation state.
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
    this.paused = false;
    this.pointerWasLocked = false;
    this.autosaveTimer = 0;
    this.pauseMenu.close();
    this.cinematics.stop();
    services.audio.startAmbientDrone();
    services.audio.setMaskAudioMix(this.gasMask.coverage);
    this.placeCamera(0);

    if (payload.mode === 'newGame' && worldEvents.flag('elevatorIntroSeen') < 1) {
      worldEvents.setFlag('elevatorIntroSeen', 1);
      this.playCinematic('elevatorArrival');
      this.showToast('FOLLOW THE LIGHTS DOWN', 4, 'info');
    } else {
      this.showToast(resume !== null ? 'SHIFT RESUMED' : payload.mode === 'retry' ? 'RESUMING FROM LAST CHECKPOINT' : 'SHIFT RECORD RESTORED', 3.5, 'info');
    }
  }

  public exit(): void {
    for (const unsubscribe of this.eventUnsubscribers) {
      unsubscribe();
    }
    this.eventUnsubscribers.length = 0;
    this.cinematics.stop();
    this.pauseMenu.close();
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

  private applyPlayerSnapshot(snapshot: PlayerStateSnapshot): void {
    const transform = snapshot.transform;
    this.motor.teleport(transform.position);
    this.motor.velocity = [transform.velocity[0], transform.velocity[1], transform.velocity[2]];
    this.motor.stamina = snapshot.stamina;
    if (transform.crouching) {
      this.motor.isCrouching = true;
      this.motor.currentHeight = this.motor.tuning.crouchingHeight;
      this.motor.smoothedEyeHeight = this.motor.tuning.crouchingEyeHeight;
    }
    this.yawRadians = transform.yawRadians;
    this.pitchRadians = transform.pitchRadians;
    if (snapshot.mask.phase !== 'unavailable' && this.gasMask.isAvailable) {
      this.gasMask.filterRemaining = snapshot.mask.filterRemaining;
      this.gasMask.exposure = snapshot.mask.exposure;
      if (snapshot.mask.phase === 'worn') {
        this.gasMask.phase = 'worn';
        this.gasMask.coverage = 1;
      }
    }
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
        this.showToast(`${event.polarity.toUpperCase()} RELAY ENGAGED · GATE OPENING`, 3, 'success', POLARITY_HUD_COLORS[event.polarity]);
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
    const actorThreat: ManagedThreat | null = cinematicId === 'jesterReveal' ? (this.threats?.threat(JESTER_THREAT_ID) ?? null) : null;
    this.startCinematic(cinematicId, actorThreat, () => undefined);
  }

  public emitNoise(source: NoiseSource, position: Vec3, loudness: number): void {
    this.threats?.emitNoise(source, position, loudness);
  }

  public playSpatialCue(cue: SpatialCueId, position: Vec3, intensity: number): void {
    this.services.audio.playSpatialCue(cue, position, intensity);
  }

  public saveCheckpoint(): void {
    this.commitCheckpoint(this.buildSave('checkpoint', 'autosave', {}));
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
    const deathRecord: SaveGame = this.buildSave('checkpoint', 'autosave', { deathCount: this.checkpoint.deathCount + 1 });
    this.services.saves.write(deathRecord);
    this.services.lifecycle.requestTransition(
      {
        target: GameStateId.JumpscareDeathSequence,
        payload: { save: deathRecord, survivedSeconds: this.sessionSeconds, depthMeters: this.depthMeters, cause: death.cause, threat: death.threat },
      },
      'cut',
    );
  }

  // ---- Serialization ----------------------------------------------------------------------------------------------

  private get depthMeters(): number {
    return Math.max(0, -this.motor.position[2] / CORRIDOR_DIMENSIONS.chunkLength) * METERS_PER_CHUNK;
  }

  private capturePlayerSnapshot(): PlayerStateSnapshot {
    const maskPhase: PlayerStateSnapshot['mask']['phase'] = !this.gasMask.isAvailable ? 'unavailable' : this.gasMask.coverage >= 0.5 ? 'worn' : 'stowed';
    return {
      transform: {
        position: this.playerPosition(),
        velocity: [this.motor.velocity[0], this.motor.velocity[1], this.motor.velocity[2]],
        yawRadians: this.yawRadians,
        pitchRadians: this.pitchRadians,
        crouching: this.motor.isCrouching,
      },
      stamina: this.motor.stamina,
      mask: { phase: maskPhase, filterRemaining: this.gasMask.filterRemaining, exposure: this.gasMask.exposure },
    };
  }

  /** Assembles a full v4 save document from the live systems. */
  private buildSave(kind: SaveKind, slot: SaveSlotId, overrides: Partial<Pick<SaveGame, 'checkpointChunkIndex' | 'deathCount'>>): SaveGame {
    const previous: SaveGame = this.checkpoint as SaveGame;
    const jester: ManagedThreat | null = this.threats?.threat(JESTER_THREAT_ID) ?? null;
    return {
      version: 4,
      slot,
      kind,
      checkpointChunkIndex: overrides.checkpointChunkIndex ?? previous.checkpointChunkIndex,
      deepestChunkIndex: Math.max(previous.deepestChunkIndex, this.currentChunk),
      playTimeSeconds: Math.round((previous.playTimeSeconds + this.sessionSeconds) * 100) / 100,
      deathCount: overrides.deathCount ?? previous.deathCount,
      inventory: this.inventory.snapshot(),
      questFlags: this.worldEvents?.flagSnapshot ?? previous.questFlags,
      world: {
        poweredPlateIds: this.streamer?.poweredPlates ?? previous.world.poweredPlateIds,
        solvedSequenceIds: this.streamer?.solvedSequences ?? previous.world.solvedSequenceIds,
        collectedPickupIds: this.streamer?.collectedPickups ?? previous.world.collectedPickupIds,
      },
      threats: {
        jesterAwake: kind === 'session' && jester !== null,
        jesterPosition: kind === 'session' && jester !== null ? [jester.view.position[0], 0, jester.view.position[2]] : null,
      },
      player: kind === 'session' ? this.capturePlayerSnapshot() : null,
      savedAtIso: new Date().toISOString(),
    };
  }

  /** Writes a checkpoint record and rebases session time so play time is never double counted. */
  private commitCheckpoint(save: SaveGame): void {
    this.services.saves.write(save);
    this.checkpoint = { ...save, kind: 'checkpoint', player: null, playTimeSeconds: save.playTimeSeconds - this.sessionSeconds };
  }

  private recordCheckpoint(chunkIndex: number): void {
    this.commitCheckpoint(this.buildSave('checkpoint', 'autosave', { checkpointChunkIndex: chunkIndex }));
    this.services.audio.playCheckpointChime();
    this.showToast('PROGRESS RECORDED', 2.8, 'success');
    this.playCinematic('checkpointDescent');
  }

  /**
   * Session saves are only allowed at safe moments, so a resume never drops the player into certain death:
   * grounded, breathable air, no threat hunting nearby, no cinematic, not dying.
   */
  private get isSafeToSessionSave(): boolean {
    return (
      this.motor.isGrounded &&
      this.gasMask.areaStatus !== 'contaminated' &&
      this.gasMask.exposure < 0.5 &&
      this.dread < 0.35 &&
      !this.cinematics.ownsCamera &&
      this.pendingDeath === null &&
      !this.deathRequested
    );
  }

  private quickSave(slot: SaveSlotId): string {
    if (!this.isSafeToSessionSave) {
      return "CAN'T SAVE NOW · DANGER NEARBY";
    }
    const written: boolean = this.services.saves.write(this.buildSave('session', slot, {}));
    return written ? (slot === 'quicksave' ? 'GAME SAVED · QUICKSAVE SLOT' : 'GAME SAVED') : 'SAVE FAILED · STORAGE UNAVAILABLE';
  }

  // ---- Pause ---------------------------------------------------------------------------------------------------------

  private openPause(): void {
    if (this.paused || this.leavingLevel) {
      return;
    }
    this.paused = true;
    this.pauseMenu.open();
    this.services.input.releasePointerLock();
    this.services.audio.setCinematicDuck(0.55);
  }

  private resumeFromPause(): void {
    this.paused = false;
    this.services.audio.setCinematicDuck(0);
    this.services.input.requestPointerLock();
    this.pointerWasLocked = false;
  }

  private restartFromCheckpoint(): void {
    if (this.checkpoint === null) {
      return;
    }
    this.leavingLevel = true;
    this.pauseMenu.close();
    this.services.audio.setCinematicDuck(0);
    this.services.lifecycle.requestTransition({ target: GameStateId.ActiveLevelStreamer, payload: { mode: 'retry', save: this.checkpoint } });
  }

  private saveAndQuit(): void {
    // Prefer an exact resume; if the moment is unsafe, fall back to the checkpoint record.
    const record: SaveGame = this.isSafeToSessionSave ? this.buildSave('session', 'autosave', {}) : this.buildSave('checkpoint', 'autosave', {});
    this.services.saves.write(record);
    this.leavingLevel = true;
    this.pauseMenu.close();
    this.services.audio.setCinematicDuck(0);
    this.services.audio.playUiCue('back');
    this.services.lifecycle.requestTransition({ target: GameStateId.TitleScreen, payload: { reason: 'returnFromLevel' } });
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

  /** Claws fire from LMB/RMB, Q/R, or F when the matching hotbar slot is selected. */
  private buildTetherInput(input: InputManager, controlsEnabled: boolean, motorIntent: MotorIntent): TetherControlInput {
    if (!controlsEnabled) {
      return { leftTriggerPressed: false, leftTriggerHeld: false, rightTriggerPressed: false, rightTriggerHeld: false, reelInput: 0, pumpInput: 0 };
    }
    const locked: boolean = input.isPointerLocked;
    const selected: HotbarSlotContent = this.inventory.selectedContent;
    const hotbarLeft: boolean = selected.kind === 'claw' && selected.side === 'left';
    const hotbarRight: boolean = selected.kind === 'claw' && selected.side === 'right';
    const leftPressed: boolean = (locked && input.wasMouseButtonPressed(0)) || input.wasKeyPressed('KeyQ') || (hotbarLeft && input.wasKeyPressed('KeyF'));
    const rightPressed: boolean = (locked && input.wasMouseButtonPressed(2)) || input.wasKeyPressed('KeyR') || (hotbarRight && input.wasKeyPressed('KeyF'));
    const leftHeld: boolean = (locked && input.isMouseButtonHeld(0)) || input.isKeyHeld('KeyQ') || (hotbarLeft && input.isKeyHeld('KeyF'));
    const rightHeld: boolean = (locked && input.isMouseButtonHeld(2)) || input.isKeyHeld('KeyR') || (hotbarRight && input.isKeyHeld('KeyF'));
    const anchoredAirborne: boolean = (this.rig?.isAnchored ?? false) && !this.motor.isGrounded;
    // Wheel up (negative steps) reels in; holding Space while airborne on a rope also reels in.
    const reelInput: number = -input.wheelSteps * 6 + (anchoredAirborne && input.isKeyHeld('Space') ? 1 : 0);
    return { leftTriggerPressed: leftPressed, leftTriggerHeld: leftHeld, rightTriggerPressed: rightPressed, rightTriggerHeld: rightHeld, reelInput, pumpInput: motorIntent.moveForward };
  }

  /** Hotbar selection (digits / click) and F-use for item slots. Returns true if the mask should toggle. */
  private handleHotbar(input: InputManager, controlsEnabled: boolean): boolean {
    if (!controlsEnabled) {
      return false;
    }
    HOTBAR_KEY_CODES.forEach((code: string, slot: number) => {
      if (input.wasKeyPressed(code)) {
        this.inventory.selectSlot(slot);
        this.services.audio.playUiCue('hover');
      }
    });
    if (!input.isPointerLocked && input.pointer.primaryPressedThisFrame) {
      const point = this.services.ui.clientToVirtual(input.pointer.clientX, input.pointer.clientY);
      const slot: number = this.hud.hotbarSlotAt(point);
      if (slot >= 0) {
        this.inventory.selectSlot(slot);
        this.services.audio.playUiCue('hover');
      }
    }
    if (!input.wasKeyPressed('KeyF')) {
      return false;
    }
    const selected: HotbarSlotContent = this.inventory.selectedContent;
    if (selected.kind !== 'item') {
      return false;
    }
    if (selected.itemId === 'gasMask') {
      return true;
    }
    // Filter cartridge: refits the mask's filter to 100%.
    if (!this.inventory.has('filterCartridge')) {
      this.services.audio.playUiCue('denied');
      this.showToast('NO FILTER CARTRIDGES', 1.6, 'info', UI_COLORS.textDim);
    } else if (!this.gasMask.isAvailable) {
      this.services.audio.playUiCue('denied');
      this.showToast('NO MASK TO FIT IT TO', 1.6, 'warning');
    } else if (this.gasMask.filterRemaining > 0.95) {
      this.services.audio.playUiCue('denied');
      this.showToast('FILTER STILL FRESH', 1.6, 'info', UI_COLORS.textDim);
    } else {
      this.inventory.remove('filterCartridge');
      this.gasMask.filterRemaining = 1;
      this.services.audio.playMaskSeal(true);
      this.showToast('FRESH FILTER FITTED', 2, 'success');
    }
    return false;
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

  private collectPickupInView(streamer: LevelStreamer, worldEvents: WorldEventSystem): void {
    const pickup: PickupRecord | null = this.pickupInView;
    if (pickup === null) {
      return;
    }
    if (pickup.kind === 'filterCartridge' && this.inventory.isFull('filterCartridge')) {
      this.services.audio.playUiCue('denied');
      this.showToast("CAN'T CARRY MORE FILTERS", 1.8, 'warning');
      return;
    }
    const collected: PickupRecord | null = streamer.collectPickup(pickup.id);
    if (collected === null) {
      return;
    }
    if (collected.kind === 'gasMask') {
      this.inventory.add('gasMask');
      this.gasMask.grant();
      this.services.audio.playMaskSeal(false);
    } else {
      this.inventory.add('filterCartridge');
      this.services.audio.playUiCue('confirm');
    }
    worldEvents.reportPickup(collected.id, collected.kind, collected.position);
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
    this.pauseMenu.showCollisionBoxes = services.lifecycle.showCollisionBoxes;

    // ---- Pause handling: P / Esc (cursor free) or the browser releasing pointer lock opens the menu.
    const locked: boolean = input.isPointerLocked;
    const lostLock: boolean = this.pointerWasLocked && !locked;
    this.pointerWasLocked = locked;
    if (this.paused) {
      input.consumeMouseDelta();
      this.pauseMenu.update(services.ui.context, buildUiFrameInput(services, frame.inputEnabled), deltaSeconds);
      return;
    }
    const canPause: boolean = frame.inputEnabled && !dying && !this.cinematics.locksControls && !this.leavingLevel;
    if (canPause && (input.wasKeyPressed('KeyP') || (input.wasKeyPressed('Escape') && !locked) || lostLock)) {
      this.openPause();
      return;
    }
    if (canPause && input.wasKeyPressed('F5')) {
      this.showToast(this.quickSave('quicksave'), 2.2, 'success');
    }

    const controlsEnabled: boolean = frame.inputEnabled && !dying && !this.cinematics.locksControls && !this.leavingLevel;
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

    // While dying, only the lethal cinematic advances (the world holds still behind it).
    if (dying) {
      input.consumeMouseDelta();
      this.cinematics.update(deltaSeconds);
      return;
    }

    const hotbarToggledMask: boolean = this.handleHotbar(input, controlsEnabled);
    if (controlsEnabled && !locked && input.pointer.primaryPressedThisFrame && this.hud.hotbarSlotAt(services.ui.clientToVirtual(input.pointer.clientX, input.pointer.clientY)) < 0) {
      input.requestPointerLock();
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
        this.collectPickupInView(streamer, worldEvents);
      } else if (this.switchInView !== null) {
        worldEvents.pressSwitch(this.switchInView);
      }
    }

    // 11. Gas mask + toxicity survival meter.
    const exertion: number = this.motor.stance === 'run' && this.motor.horizontalSpeed > 2 ? 1 : rig.isAnchored && !this.motor.isGrounded ? 0.6 : 0;
    const togglePressed: boolean = controlsEnabled && (input.wasKeyPressed('KeyG') || hotbarToggledMask);
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

    // 14. Periodic session autosave at safe moments.
    this.autosaveTimer += deltaSeconds;
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL_SECONDS && this.isSafeToSessionSave) {
      this.autosaveTimer = 0;
      services.saves.write(this.buildSave('session', 'autosave', {}));
    }
  }

  // ---- HUD snapshot --------------------------------------------------------------------------------------------------

  private buildHotbarSlots(): HotbarSlotSnapshot[] {
    const rig: TetherRig | null = this.rig;
    return HOTBAR_LAYOUT.map((content: HotbarSlotContent, index: number): HotbarSlotSnapshot => {
      const keyHint: string = String(index + 1);
      if (content.kind === 'item') {
        const definition = ITEM_DEFINITIONS[content.itemId];
        const count: number = this.inventory.count(content.itemId);
        if (content.itemId === 'gasMask') {
          return {
            label: definition.shortLabel,
            keyHint,
            count: null,
            available: count > 0,
            statusText: count > 0 ? (this.gasMask.isWorn ? 'GAS MASK · WORN' : 'GAS MASK · STOWED') : 'GAS MASK · NOT FOUND',
            accentColor: this.gasMask.isWorn ? '#8fd18a' : 'rgba(233, 225, 207, 0.35)',
          };
        }
        return {
          label: definition.shortLabel,
          keyHint,
          count,
          available: count > 0,
          statusText: `FILTER CARTRIDGE · ${count}/${definition.maximumStack}`,
          accentColor: count > 0 ? '#e9c46a' : 'rgba(233, 225, 207, 0.2)',
        };
      }
      const claw: ClawState | undefined = rig?.claws[content.side];
      const polarity: Polarity = content.side === 'left' ? 'amber' : 'violet';
      return {
        label: polarity.toUpperCase(),
        keyHint,
        count: null,
        available: claw !== undefined,
        statusText: `${polarity.toUpperCase()} CLAW · ${claw?.phase.toUpperCase() ?? 'OFFLINE'}`,
        accentColor: POLARITY_HUD_COLORS[polarity],
      };
    });
  }

  private buildHudSnapshot(timeSeconds: number): HudSnapshot {
    const rig: TetherRig | null = this.rig;
    const clawSnapshot = (side: ClawSide, binding: string) => ({
      polarity: (side === 'left' ? 'amber' : 'violet') as Polarity,
      phase: rig?.claws[side].phase ?? 'holstered',
      binding,
    });
    const pickupPrompt: string | null =
      this.pickupInView === null ? null : this.pickupInView.kind === 'gasMask' ? '[E] TAKE GAS MASK' : '[E] TAKE FILTER CARTRIDGE';
    return {
      crosshair: {
        kind: this.aim.kind,
        polarity: this.aim.polarity,
        distance: this.aim.distance,
        interactionPrompt: pickupPrompt ?? (this.switchInView !== null ? '[E] THROW BREAKER' : null),
      },
      status: {
        depthMeters: this.depthMeters,
        stanceLabel: this.motor.stance.toUpperCase(),
        airborne: !this.motor.isGrounded,
        playTimeSeconds: (this.checkpoint?.playTimeSeconds ?? 0) + this.sessionSeconds,
        checkpointIndex: this.checkpoint?.checkpointChunkIndex ?? 0,
        stamina: this.motor.stamina,
      },
      claws: [clawSnapshot('left', 'LMB/Q'), clawSnapshot('right', 'RMB/R')],
      toxicity: {
        exposure: this.gasMask.exposure,
        concentration: this.gasMask.concentration,
        areaStatus: this.gasMask.areaStatus,
        maskAvailable: this.gasMask.isAvailable,
        maskPhase: this.gasMask.phase,
        filterRemaining: this.gasMask.filterRemaining,
        flash: this.meterFlash,
      },
      hotbar: { slots: this.buildHotbarSlots(), selectedSlot: this.inventory.selectedSlot },
      mask: {
        coverage: this.gasMask.coverage,
        lensFog: this.gasMask.lensFog * this.gasMask.coverage,
        filterStrain: this.gasMask.isWorn ? 1 - this.gasMask.filterRemaining : 0,
      },
      // Hidden while paused: the pause menu shows its own status line and the toast would overlap its buttons.
      toast: this.toast !== null && !this.paused ? { text: this.toast.text, color: this.toast.color, alpha: clamp(this.toast.remainingSeconds, 0, 1) * this.objectiveOpacity } : null,
      dread: this.dread,
      letterbox: this.letterbox,
      pointerLocked: this.services.input.isPointerLocked,
      timeSeconds,
    };
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
    this.hud.draw(context, this.buildHudSnapshot(frame.elapsedSeconds));
    this.pauseMenu.draw(context, frame.elapsedSeconds);
  }
}
