import type { ManagedThreat, ThreatEventMap } from '../ai/ThreatDirector';
import { JESTER_THREAT_ID, ThreatDirector } from '../ai/ThreatDirector';
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
import type { PointLight } from '../graphics/LightingSystem';
import type { RightHandType } from '../gameplay/TetherRig';
import { SERAPH_CHUNK } from '../world/LevelStreamer';
import { CherubEntity, SeraphEntity } from '../world/AngelEntities';
import type { Vec3 } from '../math/Vec3';
import { clamp, smoothstep, vec3Add, vec3Scale } from '../math/Vec3';
import type { CrosshairKind, HotbarSlotSnapshot, HudSnapshot } from '../ui/hud/HudController';
import { HudController, POLARITY_HUD_COLORS } from '../ui/hud/HudController';
import { PauseMenu } from '../ui/PauseMenu';
import { buildUiFrameInput } from '../ui/UIInputAdapter';
import type { BreakerSwitchRecord, PickupRecord, Polarity, ThreatKind, ToxicZone, WorldRayHit } from '../world/LevelStreamer';
import { CORRIDOR_DIMENSIONS, LevelStreamer, chunkIndexAtZ, chunkStartZ } from '../world/LevelStreamer';
import type { MenuBackdropScene } from '../world/MenuBackdropScene';
import { PipCompanion } from '../world/PipCompanion';
import type { MusicBoxRecord, VentRecord } from '../world/LevelStreamer';
import { ForemanEncounter } from '../gameplay/ForemanEncounter';
import type { KillerId } from '../core/GameStateTypes';
import { CampaignDirector } from '../story/CampaignDirector';
import type { ActDefinition, ActId, DialogueId, DialogueLine, EndingId, LoreTape } from '../story/CampaignScript';
import { LORE_TAPES, ROSTER_TAPE_ID } from '../story/CampaignScript';
import type { ActTheme } from '../story/ActThemes';
import { ACT_THEMES } from '../story/ActThemes';
import { EndingSequence, LoreTapeReader, drawActCard, drawObjectives, drawSubtitle } from '../ui/CampaignOverlays';

/** Dialogue that plays when an act is first entered. */
const ACT_ENTRY_DIALOGUE: Readonly<Partial<Record<ActId, readonly DialogueId[]>>> = {
  sortingHalls: ['act2.enter', 'act2.foreman'],
  choirNursery: ['act3.enter', 'act3.foreman'],
  drownedArchive: ['act4.enter'],
  assemblyHeart: ['act5.enter'],
};
/** Lethal cinematic per killer. */
const KILLER_CINEMATICS: Readonly<Record<ThreatKind, CinematicId>> = {
  jester: 'jesterJumpscare',
  tallyman: 'tallymanJumpscare',
  choirMother: 'choirMotherJumpscare',
  hushling: 'hushlingSwarm',
  cherub: 'hushlingSwarm',
  seraph: 'choirMotherJumpscare',
};
const WADING_DEPTH: number = 0.12;
const WADING_SPEED_MULTIPLIER: number = 0.62;
const MUSIC_BOX_CHIME_SECONDS: number = 2.6;

const LEVEL_WORLD_SEED: number = 0x5eed_0006;
const LEVEL_ENVIRONMENT: SceneEnvironment = { ambientColor: [0.012, 0.011, 0.016], clearColor: [0, 0, 0] };
const METERS_PER_CHUNK: number = 4;
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
  readonly threat: KillerId | null;
}

/**
 * Active Level Streamer: physics-driven first-person play in the streamed corridor, wiring together the
 * Tether Rig, gas mask + inventory, AI threats, world event matrix, cinematics, master HUD, pause menu
 * and save serialization.
 */
/** Horizontal hit radius of each monster for hand strikes. */
const STRIKE_RADIUS: Readonly<Record<ThreatKind, number>> = { jester: 0.75, tallyman: 0.7, choirMother: 0.95, hushling: 0.5, cherub: 0.5, seraph: 0.85 };
const THREAT_DISPLAY_NAMES: Readonly<Record<ThreatKind, string>> = { jester: 'GULLY', tallyman: 'THE TALLYMAN', choirMother: 'THE CHOIR MOTHER', hushling: 'HUSHLING', cherub: 'CHERUB', seraph: 'THE SERAPH' };

/** Right-hand roster: unlocked by act; each changes how a strike lands. */
const RIGHT_HANDS: ReadonlyArray<{ readonly type: RightHandType; readonly label: string; readonly color: string; readonly unlockAct: number; readonly stunScale: number }> = [
  { type: 'rose', label: 'ROSE', color: '#ff5c8f', unlockAct: 0, stunScale: 1 },
  { type: 'volt', label: 'VOLT', color: '#f4e36a', unlockAct: 2, stunScale: 1.9 },
  { type: 'chime', label: 'CHIME', color: '#d7a74a', unlockAct: 3, stunScale: 0.8 },
];
const VOLT_RECHARGE_SECONDS: number = 5;
const CHIME_RADIUS_METERS: number = 5.5;

const AIM_ASSIST_RANGE_METERS: number = 16;
const AIM_ASSIST_COSINE: number = Math.cos((15 * Math.PI) / 180);
const CHERUB_WHISPER_METERS: number = 9;
const CHERUB_ALARM_METERS: number = 5;
const CHERUB_SCREAM_SECONDS: number = 1.6;
const CHERUB_FLEE_SECONDS: number = 2.4;
const CHERUB_FLEE_SPEED: number = 4.5;
const SERAPH_GAZE_RANGE_METERS: number = 16;
const SERAPH_GAZE_COSINE: number = Math.cos((8 * Math.PI) / 180);
const SERAPH_GAZE_SECONDS: number = 2;
const SERAPH_SIREN_RANGE_METERS: number = 30;
const SERAPH_CHASE_LINE_SECONDS: number = 7;
const SERAPH_LANDING_SECONDS: number = 0.9;
const SAVE_INDICATOR_SECONDS: number = 2.4;
const SECOND_WIND_STUN_SECONDS: number = 3.5;

interface ThreatEntrance {
  readonly kind: ThreatKind;
  readonly flag: QuestFlagId;
  /** First campaign chunk where the entrance plays. */
  readonly chunk: number;
  readonly dialogue: DialogueId;
  readonly cue: SpatialCueId;
  readonly graceSeconds: number;
}

const JESTER_ENTRANCE_CHUNK: number = 22;
/** Gully's showdown: the last flooded archive hall of Act IV. */
const GULLY_SHOWDOWN_CHUNK: number = 28;
const GULLY_SHOWDOWN_STRIKES: number = 4;
/** One entrance per monster, in story order: Cherubs (Act I), Tallyman and Seraph (Act II), Hushlings and Choir Mother (Act III), Jester (Act IV). */
const THREAT_ENTRANCES: readonly ThreatEntrance[] = [
  { kind: 'cherub', flag: 'cherubsIntroduced', chunk: 2, dialogue: 'cherub.entrance', cue: 'musicBoxChime', graceSeconds: 5 },
  { kind: 'tallyman', flag: 'tallymanIntroduced', chunk: 7, dialogue: 'tallyman.entrance', cue: 'tallymanStep', graceSeconds: 8 },
  { kind: 'seraph', flag: 'seraphIntroduced', chunk: SERAPH_CHUNK, dialogue: 'seraph.entrance', cue: 'choirHymn', graceSeconds: 6 },
  { kind: 'hushling', flag: 'hushlingsIntroduced', chunk: 14, dialogue: 'hushling.entrance', cue: 'hushlingSkitter', graceSeconds: 6 },
  { kind: 'choirMother', flag: 'choirMotherIntroduced', chunk: 16, dialogue: 'choirMother.entrance', cue: 'choirHymn', graceSeconds: 8 },
  { kind: 'jester', flag: 'jesterAwakened', chunk: JESTER_ENTRANCE_CHUNK, dialogue: 'jester.entrance', cue: 'jesterBells', graceSeconds: 6 },
];
const ENTRANCE_FLICKER_SECONDS: number = 1.6;
const ENTRANCE_ARRIVAL_SECONDS: number = 1.1;

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
  private campaign: CampaignDirector | null = null;
  private pip: PipCompanion | null = null;
  /** Cherubs that have already whispered at the player this session. */
  private readonly whisperedCherubs: Set<string> = new Set();
  /** Seconds the player has held their gaze on the Seraph's eye. */
  private seraphGaze: number = 0;
  private seraphChaseLine: number = 0;
  /** Set when a Cherub's siren goes off; the Seraph drops if it is close enough. */
  private sirenAt: Vec3 | null = null;
  /** Cassette indicator: label and seconds left on screen. */
  private saveIndicator: { label: string; seconds: number } | null = null;
  /** Seconds before the Volt hand can fire again after a shock. */
  private voltRecharge: number = 0;
  /** One free escape from a catch per checkpoint. */
  private secondWindReady: boolean = true;
  /** The entrance scene currently playing (lights stutter, cue, line, then the monster arrives). */
  private entrance: { readonly definition: ThreatEntrance; seconds: number; arrived: boolean } | null = null;
  /** Where each launched hand was last frame, for swept hit tests against monsters. */
  private readonly handTrail: Record<'left' | 'right', { position: Vec3; phase: string }> = {
    left: { position: [0, 0, 0], phase: 'holstered' },
    right: { position: [0, 0, 0], phase: 'holstered' },
  };
  /** Dim cosmetic light just below the camera so the painted hands read in dark rooms. */
  private handFill: PointLight | null = null;
  /** Brief cosmetic flash where sparks fly. */
  private sparkLight: PointLight | null = null;
  private foreman: ForemanEncounter | null = null;
  private readonly loreReader: LoreTapeReader = new LoreTapeReader();
  private lastTape: LoreTape | null = null;
  private readonly ending: EndingSequence;
  private endingCountdown: number = -1;
  private musicBoxInView: MusicBoxRecord | null = null;
  private ventInView: VentRecord | null = null;
  private chimeTimer: number = 0;

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
    this.ending = new EndingSequence(
      (cue) => services.audio.playUiCue(cue),
      (endingId: EndingId) => this.chooseEnding(endingId),
      () => this.finishCampaign(),
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
    streamer.restoreCampaignState(save.world.silencedMusicBoxIds, save.world.openedVentIds);

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

    // Systems.
    const rig = new TetherRig(services.gl, services.meshes, this.tetherEvents);
    rig.aimAssist = (origin: Readonly<Vec3>, direction: Readonly<Vec3>) => this.assistAim(origin, direction);
    this.rig = rig;
    this.relayNetwork = new RelayPlateNetwork(this.tetherEvents, streamer, rig);
    this.threats = new ThreatDirector(services.meshes, services.lighting, streamer, services.audio);
    const worldEvents = new WorldEventSystem(streamer, this, LEVEL_TRIGGER_RULES);
    worldEvents.restoreFlags(save.questFlags as Partial<Record<QuestFlagId, number>>);
    this.worldEvents = worldEvents;
    for (const entrance of THREAT_ENTRANCES) {
      if (entrance.kind !== 'jester' && worldEvents.flag(entrance.flag) < 1) {
        this.threats.lockKind(entrance.kind);
      }
    }
    this.entrance = null;
    this.saveIndicator = { label: 'LOADING', seconds: SAVE_INDICATOR_SECONDS };
    this.campaign = new CampaignDirector({
      flag: (flag: QuestFlagId) => worldEvents.flag(flag),
      setFlag: (flag: QuestFlagId, value: number) => worldEvents.setFlag(flag, value),
      onLineStarted: (line: DialogueLine) => {
        const camera = services.camera;
        services.audio.playSpatialCue(line.speaker === 'pip' ? 'pipChirp' : 'radioCrackle', line.speaker === 'pip' && this.pip !== null ? this.pip.position : camera.position, 0.8);
      },
    });
    this.sparkLight = services.lighting.add({ position: [0, -100, 0], color: [1, 0.75, 0.4], intensity: 0, range: 4.5, behavior: { kind: 'steady' }, cosmetic: true });
    this.handFill = services.lighting.add({ position: [0, 0, 0], color: [1, 0.94, 0.86], intensity: 0.9, range: 1.0, behavior: { kind: 'steady' }, cosmetic: true });
    this.pip = new PipCompanion(services.meshes, services.lighting, {
      ventOpened: (vent: VentRecord) => {
        if (streamer.openVent(vent.id)) {
          this.campaign?.say('pip.vent', { allowRepeat: true });
          services.audio.playSpatialCue('breakerClunk', vent.position, 1);
          this.threats?.emitNoise('gateMoving', vent.position, 0.8);
        }
      },
    });
    if (worldEvents.flag('pipRecruited') >= 1) {
      this.pip.activate([this.motor.position[0] + 0.7, 0, this.motor.position[2] + 1.2], this.yawRadians);
    }
    this.foreman = null;
    this.endingCountdown = -1;
    this.chimeTimer = 0;
    this.lastTape = null;
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

    this.campaign.updateChunk(this.currentChunk, ACT_ENTRY_DIALOGUE);
    if (payload.mode === 'newGame' && worldEvents.flag('elevatorIntroSeen') < 1) {
      worldEvents.setFlag('elevatorIntroSeen', 1);
      this.playCinematic('elevatorArrival');
      this.showToast('FOLLOW THE LIGHTS DOWN', 4, 'info');
      this.campaign.say('intro.wake');
      this.campaign.say('intro.mabel');
      this.campaign.say('pip.found');
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
    this.pip?.dispose();
    this.pip = null;
    if (this.handFill !== null) {
      this.services.lighting.remove(this.handFill.handle);
      this.handFill = null;
    }
    if (this.sparkLight !== null) {
      this.services.lighting.remove(this.sparkLight.handle);
      this.sparkLight = null;
    }
    this.foreman?.dispose();
    this.foreman = null;
    this.campaign = null;
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
        const catcher: ManagedThreat | null = threats.threat(event.id);
        if (this.secondWindReady && catcher !== null) {
          // Second wind (once per checkpoint): shove it off instead of dying.
          this.secondWindReady = false;
          catcher.brain.forceStun(SECOND_WIND_STUN_SECONDS, this.motor.position);
          this.services.audio.playSpatialCue('breakerClunk', catcher.view.headPosition(), 1.4);
          this.showToast('YOU SHOVE IT OFF · RUN', 2.6, 'warning');
          if (worldEvents.flag('secondWindHint') < 1) {
            worldEvents.setFlag('secondWindHint', 1);
            this.campaign?.say('secondWind.first');
          }
          return;
        }
        this.beginLethalCinematic(KILLER_CINEMATICS[event.kind], { cause: 'entity', threat: event.kind }, catcher);
      }),
      worldEvents.events.on('zoneEntered', (event) => {
        if (event.zone.kind === 'checkpoint') {
          this.secondWindReady = true;
        }
        if (event.zone.kind === 'foremanArena' && this.foreman !== null && this.foreman.state === 'dormant' && worldEvents.flag('foremanPhasesCleared') < 3) {
          worldEvents.setFlag('foremanEncountered', 1);
          this.foreman.begin();
        }
      }),
    );
  }

  // ---- TriggerActionHost -------------------------------------------------------------------------------------------

  public playerPosition(): Vec3 {
    return [this.motor.position[0], this.motor.position[1], this.motor.position[2]];
  }

  /**
   * Swept hit test of each launched hand against every monster (vertical capsule). A hit snaps the hand back and
   * staggers the monster; in a scene where that monster can be beaten, strikes count toward finishing it.
   */
  private resolveHandStrikes(rig: TetherRig, threats: ThreatDirector, worldEvents: WorldEventSystem): void {
    for (const side of ['left', 'right'] as const) {
      const claw = rig.claws[side];
      const trail = this.handTrail[side];
      // Test the stretch the hand covered this frame: from last frame's position while flying, or from the launcher on
      // the frame it fired (a fast hand can pass a monster and hit the wall behind it within one frame).
      const justFired: boolean = trail.phase === 'holstered' && claw.phase !== 'holstered';
      const wasFlying: boolean = trail.phase === 'extending';
      const from: Vec3 = justFired ? rig.socketPosition(side) : [trail.position[0], trail.position[1], trail.position[2]];
      trail.phase = claw.phase;
      trail.position = [claw.position[0], claw.position[1], claw.position[2]];
      if (!justFired && !wasFlying) {
        continue;
      }
      const to: Vec3 = trail.position;
      for (const managed of threats.activeThreats) {
        const radius: number = STRIKE_RADIUS[managed.kind];
        const feet: Readonly<Vec3> = managed.view.position;
        const height: number = managed.kind === 'seraph' ? 4.6 : managed.profile.vision.eyeHeight * 1.1;
        let hit = false;
        for (let sample = 0; sample <= 8 && !hit; sample += 1) {
          const t: number = sample / 8;
          const x: number = from[0] + (to[0] - from[0]) * t;
          const y: number = from[1] + (to[1] - from[1]) * t;
          const z: number = from[2] + (to[2] - from[2]) * t;
          hit = Math.hypot(x - feet[0], z - feet[2]) <= radius && y >= feet[1] - 0.2 && y <= feet[1] + height;
        }
        if (!hit) {
          continue;
        }
        rig.recall(side);
        trail.phase = 'retracting';
        this.applyHandStrike(side, managed.id, managed.kind, [feet[0], feet[1] + height * 0.7, feet[2]], threats, worldEvents);
        break;
      }
    }
  }

  /** X: cycle the right launcher through the hands unlocked so far (the teal left hand never changes). */
  private cycleRightHand(rig: TetherRig, worldEvents: WorldEventSystem): void {
    if (rig.claws.right.phase !== 'holstered') {
      return;
    }
    const act: number = worldEvents.flag('actReached');
    const unlocked = RIGHT_HANDS.filter((hand) => act >= hand.unlockAct);
    if (unlocked.length <= 1) {
      this.showToast('NO OTHER HANDS YET', 1.4, 'info');
      return;
    }
    const index: number = unlocked.findIndex((hand) => hand.type === rig.rightHandType);
    const next = unlocked[(index + 1) % unlocked.length] ?? unlocked[0];
    if (next === undefined) {
      return;
    }
    rig.rightHandType = next.type;
    this.services.audio.playSpatialCue('breakerClunk', rig.socketPosition('right'), 0.5);
    this.showToast(`${next.label} HAND MOUNTED`, 1.6, 'info', next.color);
  }

  private applyHandStrike(side: ClawSide, id: string, kind: ThreatKind, impact: Vec3, threats: ThreatDirector, worldEvents: WorldEventSystem): void {
    const handType: RightHandType | null = side === 'right' ? (this.rig?.rightHandType ?? 'rose') : null;
    const hand = RIGHT_HANDS.find((candidate) => candidate.type === handType);
    const stunScale: number = hand?.stunScale ?? 1;
    if (handType === 'volt') {
      this.voltRecharge = VOLT_RECHARGE_SECONDS;
    }
    if (handType === 'chime') {
      // Clang: staggers everything else within reach of the impact too.
      for (const other of threats.activeThreats) {
        if (other.id !== id && Math.hypot(other.view.position[0] - impact[0], other.view.position[2] - impact[2]) <= CHIME_RADIUS_METERS) {
          threats.strike(other.id, this.motor.position, stunScale);
        }
      }
    }
    if (kind === 'seraph') {
      this.dropSeraph(threats, worldEvents, 'struck');
    }
    const result = threats.strike(id, this.motor.position, stunScale);
    const toPlayer: Vec3 = [this.motor.position[0] - impact[0], 0.4, this.motor.position[2] - impact[2]];
    const toPlayerLength: number = Math.hypot(toPlayer[0], toPlayer[1], toPlayer[2]) || 1;
    this.rig?.spawnSparks(impact, [toPlayer[0] / toPlayerLength, toPlayer[1] / toPlayerLength, toPlayer[2] / toPlayerLength], handType === 'volt' ? 26 : 16, handType === 'volt' ? 4.5 : 3.4);
    const name: string = THREAT_DISPLAY_NAMES[kind];
    this.services.audio.playSpatialCue('breakerClunk', impact, result.outcome === 'resisted' ? 0.6 : 1.3);
    threats.emitNoise('gateMoving', impact, 0.5);
    switch (result.outcome) {
      case 'resisted':
        this.showToast(`${name} SHRUGS IT OFF`, 1.6, 'danger');
        if (worldEvents.flag('combatResistedHint') < 1) {
          worldEvents.setFlag('combatResistedHint', 1);
          this.campaign?.say('combat.resisted');
        }
        break;
      case 'stunned':
        worldEvents.incrementFlag('monstersStunned');
        this.showToast(result.strikesLeft > 0 ? `${name} STAGGERED · ${result.strikesLeft} MORE` : `${name} STAGGERED`, 1.8, result.strikesLeft > 0 ? 'success' : 'warning');
        if (worldEvents.flag('combatFirstHint') < 1) {
          worldEvents.setFlag('combatFirstHint', 1);
          if (!threats.isDefeatable(kind)) {
            this.campaign?.say('combat.first');
          }
        }
        break;
      case 'defeated':
        worldEvents.setFlag(`${kind}Defeated`, 1);
        this.showToast(kind === 'cherub' ? `${name} SHATTERED` : `${name} DEFEATED`, kind === 'cherub' ? 1.8 : 3, 'success');
        this.services.audio.playSpatialCue('foremanBoom', impact, 0.8);
        if (kind === 'choirMother') {
          threats.setDefeatable('choirMother', null);
          this.campaign?.say('choirMother.defeated');
        } else if (kind === 'jester') {
          threats.setDefeatable('jester', null);
          this.campaign?.say('jester.defeated');
        } else if (kind === 'seraph') {
          threats.setDefeatable('seraph', null);
          this.campaign?.say('seraph.defeated');
        } else if (kind === 'cherub' && worldEvents.flag('cherubShatterHint') < 1) {
          worldEvents.setFlag('cherubShatterHint', 1);
          this.campaign?.say('cherub.shattered');
        }
        break;
    }
  }

  /**
   * Each monster enters the story once, at a fixed point, with a short scene: the lights stutter, its sound and a warning
   * line play, and it arrives during the flicker with a grace period before it can notice the player. Until then its
   * kind is locked out of the level entirely, so gates and noise can't pull it in early.
   */
  private updateEntrances(threats: ThreatDirector, worldEvents: WorldEventSystem, deltaSeconds: number): void {
    const services: GameServices = this.services;
    // A Jester that has already made its entrance keeps stalking after a checkpoint reload.
    if (this.entrance === null && worldEvents.flag('jesterAwakened') >= 1 && worldEvents.flag('jesterDefeated') < 1 && !threats.isJesterAwake && this.currentChunk >= JESTER_ENTRANCE_CHUNK) {
      threats.awakenJester(this.entranceSpawnBehind(), this.playerPosition());
    }
    if (this.entrance === null) {
      if (this.cinematics.locksControls || this.pendingDeath !== null) {
        return;
      }
      const next: ThreatEntrance | undefined = THREAT_ENTRANCES.find(
        (candidate: ThreatEntrance) => worldEvents.flag(candidate.flag) < 1 && this.currentChunk >= candidate.chunk,
      );
      if (next === undefined) {
        return;
      }
      this.entrance = { definition: next, seconds: 0, arrived: false };
      this.campaign?.say(next.dialogue);
      const forward: Vec3 = [-Math.sin(this.yawRadians), 0, -Math.cos(this.yawRadians)];
      const cueAt: Vec3 = next.kind === 'jester' ? vec3Add(this.motor.position, vec3Scale(forward, -10)) : vec3Add(this.motor.position, vec3Scale(forward, 10));
      services.audio.playSpatialCue(next.cue, cueAt, 1.3);
    }
    const entrance = this.entrance;
    entrance.seconds += deltaSeconds;
    const flickering: boolean = entrance.seconds < ENTRANCE_FLICKER_SECONDS;
    services.lighting.globalIntensityScale = flickering ? 0.25 + 0.75 * Math.abs(Math.sin(entrance.seconds * 17)) * (0.4 + 0.6 * Math.abs(Math.sin(entrance.seconds * 5.3))) : 1;
    if (!entrance.arrived && entrance.seconds >= ENTRANCE_ARRIVAL_SECONDS) {
      entrance.arrived = true;
      const definition: ThreatEntrance = entrance.definition;
      if (definition.kind === 'jester') {
        const jester: ManagedThreat = threats.awakenJester(this.entranceSpawnBehind(), this.playerPosition());
        jester.brain.graceSeconds = definition.graceSeconds;
        worldEvents.notify('threatAwakened', { kind: 'jester', position: jester.view.position });
      } else {
        threats.unlockKind(definition.kind, definition.graceSeconds);
      }
      worldEvents.setFlag(definition.flag, 1);
    }
    if (!flickering && entrance.arrived) {
      services.lighting.globalIntensityScale = 1;
      this.entrance = null;
    }
  }

  private entranceSpawnBehind(): Vec3 {
    return [0, 0, Math.min(chunkStartZ(0) - 1, this.motor.position[2] + ENTITY_SPAWN_BEHIND_METERS)];
  }

  /**
   * Cherub Cheeks: sits dormant with its back turned. Within 5 m its head snaps round and it wails a siren that every
   * monster hears (and that brings the Seraph down); then it drops flat and scurries off into the walls.
   */
  private updateCherubs(threats: ThreatDirector, worldEvents: WorldEventSystem, deltaSeconds: number): void {
    for (const managed of threats.activeThreats) {
      if (managed.kind !== 'cherub' || !(managed.view instanceof CherubEntity)) {
        continue;
      }
      const view: CherubEntity = managed.view;
      const toPlayer: Vec3 = [this.motor.position[0] - view.position[0], 0, this.motor.position[2] - view.position[2]];
      const distance: number = Math.hypot(toPlayer[0], toPlayer[2]);
      if (view.alarmState === 'passive') {
        if (distance < CHERUB_WHISPER_METERS && !this.whisperedCherubs.has(managed.id) && this.campaign !== null && this.campaign.subtitle === null) {
          // Each doll whispers once as you creep up on it.
          this.whisperedCherubs.add(managed.id);
          this.campaign.say('cherub.whisper', { allowRepeat: true });
        }
        if (distance < CHERUB_ALARM_METERS) {
          view.alarmState = 'alarm';
          view.alarmSeconds = 0;
          this.services.audio.playSpatialCue('cherubSiren', view.headPosition(), 1.6);
          threats.emitNoise('alarm', view.position, 1);
          this.sirenAt = [view.position[0], view.position[1], view.position[2]];
          this.showToast('A CHERUB IS SCREAMING', 2.2, 'danger');
          if (worldEvents.flag('combatResistedHint') < 2) {
            worldEvents.setFlag('combatResistedHint', 2);
            this.campaign?.say('cherub.alarm');
          }
        }
        continue;
      }
      if (view.alarmState === 'alarm' && view.alarmSeconds >= CHERUB_SCREAM_SECONDS) {
        view.alarmState = 'fleeing';
        this.services.audio.playSpatialCue('plasticScrape', view.position, 1.2);
      }
      if (view.alarmState === 'fleeing') {
        // Scuttle away from the player toward the nearest wall, then squeeze into it.
        const away: Vec3 = distance > 0.01 ? [-toPlayer[0] / distance, 0, -toPlayer[2] / distance] : [0, 0, -1];
        const wallward: number = view.position[0] >= 0 ? 1 : -1;
        const step: number = CHERUB_FLEE_SPEED * deltaSeconds;
        view.position = [
          clamp(view.position[0] + (away[0] * 0.6 + wallward * 0.8) * step, -CORRIDOR_DIMENSIONS.halfWidth + 0.35, CORRIDOR_DIMENSIONS.halfWidth - 0.35),
          view.position[1],
          view.position[2] + away[2] * 0.6 * step,
        ];
        view.yawRadians = Math.atan2(away[0] * 0.6 + wallward * 0.8, away[2] * 0.6);
        if (view.alarmSeconds >= CHERUB_SCREAM_SECONDS + CHERUB_FLEE_SECONDS) {
          threats.retire(managed.id);
        }
      }
    }
  }

  /**
   * Seraphim Sam: clings to the ceiling (it can't hunt or catch while up there) until a Cherub screams nearby, the player
   * stares at its red eye for 2 seconds, or a hand strikes it. Then it drops and hunts, booming over its PA.
   */
  private updateSeraph(threats: ThreatDirector, deltaSeconds: number): void {
    const managed: ManagedThreat | undefined = threats.activeThreats.find((candidate) => candidate.kind === 'seraph');
    const siren: Vec3 | null = this.sirenAt;
    this.sirenAt = null;
    if (managed === undefined || !(managed.view instanceof SeraphEntity)) {
      this.seraphGaze = 0;
      return;
    }
    const view: SeraphEntity = managed.view;
    if (view.onCeiling) {
      managed.brain.graceSeconds = Math.max(managed.brain.graceSeconds, 0.5);
      const eye: Vec3 = view.eyePosition();
      const camera: Vec3 = this.services.camera.position;
      const toEye: Vec3 = [eye[0] - camera[0], eye[1] - camera[1], eye[2] - camera[2]];
      const distance: number = Math.hypot(toEye[0], toEye[1], toEye[2]);
      const look: Vec3 = [-Math.sin(this.yawRadians) * Math.cos(this.pitchRadians), Math.sin(this.pitchRadians), -Math.cos(this.yawRadians) * Math.cos(this.pitchRadians)];
      const cosine: number = distance > 0 ? (toEye[0] * look[0] + toEye[1] * look[1] + toEye[2] * look[2]) / distance : 0;
      this.seraphGaze = distance < SERAPH_GAZE_RANGE_METERS && cosine > SERAPH_GAZE_COSINE ? this.seraphGaze + deltaSeconds : Math.max(0, this.seraphGaze - deltaSeconds * 2);
      const sirenClose: boolean = siren !== null && Math.hypot(siren[0] - view.position[0], siren[2] - view.position[2]) < SERAPH_SIREN_RANGE_METERS;
      if (sirenClose || this.seraphGaze >= SERAPH_GAZE_SECONDS) {
        this.dropSeraph(threats, this.worldEvents, sirenClose ? 'siren' : 'gaze');
      }
      return;
    }
    // On the floor: repeat its demand over the PA while it hunts.
    if (managed.brain.state === 'hunting' || managed.brain.state === 'catchKill') {
      this.seraphChaseLine -= deltaSeconds;
      if (this.seraphChaseLine <= 0) {
        this.seraphChaseLine = SERAPH_CHASE_LINE_SECONDS;
        this.services.audio.playSpatialCue('seraphStatic', view.eyePosition(), 1);
        this.campaign?.say('seraph.chase', { allowRepeat: true });
      }
    }
  }

  private dropSeraph(threats: ThreatDirector, worldEvents: WorldEventSystem | null, reason: 'siren' | 'gaze' | 'struck'): void {
    const managed: ManagedThreat | undefined = threats.activeThreats.find((candidate) => candidate.kind === 'seraph');
    if (managed === undefined || !(managed.view instanceof SeraphEntity) || !managed.view.onCeiling) {
      return;
    }
    managed.view.startDrop();
    managed.brain.graceSeconds = 0;
    managed.brain.activate('hunting', 1, this.playerPosition());
    if (reason !== 'struck') {
      // A beat to land and right itself before it charges (a hand strike staggers it instead, and still counts).
      managed.brain.forceStun(SERAPH_LANDING_SECONDS, this.motor.position);
      managed.brain.stunImmuneSeconds = 0;
    }
    this.seraphGaze = 0;
    this.seraphChaseLine = SERAPH_CHASE_LINE_SECONDS;
    this.services.audio.playSpatialCue('seraphDrop', managed.view.position, 1.5);
    this.services.audio.playSpatialCue('seraphStatic', managed.view.position, 1.2);
    this.campaign?.say('seraph.spotted', { allowRepeat: true });
    void worldEvents;
  }

  /** Decides which monsters can be beaten for good right now; everything else can only be staggered. */
  private updateCombatScenes(threats: ThreatDirector, worldEvents: WorldEventSystem): void {
    // Cherubs are always fragile: one strike shatters one.
    if (!threats.isDefeatable('cherub')) {
      threats.setDefeatable('cherub', 1);
    }
    // The Seraph can be folded for good once it has made its entrance, and stays down.
    if (worldEvents.flag('seraphDefeated') >= 1) {
      for (const managed of threats.activeThreats) {
        if (managed.kind === 'seraph') threats.retire(managed.id);
      }
    } else if (worldEvents.flag('seraphIntroduced') >= 1 && !threats.isDefeatable('seraph')) {
      threats.setDefeatable('seraph', 3);
    }
    this.updateChoirMotherScene(threats, worldEvents);
    this.updateGullyShowdown(threats, worldEvents);
  }

  /** Act III: once the chapel music boxes are silenced, the Choir Mother falls to three strikes. */
  private updateChoirMotherScene(threats: ThreatDirector, worldEvents: WorldEventSystem): void {
    if (worldEvents.flag('choirMotherDefeated') >= 1) {
      // Stay beaten across reloads: never let her spawn again.
      for (const managed of threats.activeThreats) {
        if (managed.kind === 'choirMother') {
          threats.retire(managed.id);
        }
      }
      return;
    }
    const songSilenced: boolean = worldEvents.flag('musicBoxesSilenced') >= 3;
    if (songSilenced && !threats.isDefeatable('choirMother')) {
      threats.setDefeatable('choirMother', 3);
      if (worldEvents.flag('choirMotherVulnerableHint') < 1) {
        worldEvents.setFlag('choirMotherVulnerableHint', 1);
        this.campaign?.say('choirMother.vulnerable');
      }
    }
  }

  /**
   * Act IV finale: in the last archive halls the floodwater has seized Gully's joints. Strikes landed while he stands
   * frozen under the player's gaze finally hurt him; four of them end him for good.
   */
  private updateGullyShowdown(threats: ThreatDirector, worldEvents: WorldEventSystem): void {
    if (worldEvents.flag('jesterDefeated') >= 1) {
      for (const managed of threats.activeThreats) {
        if (managed.kind === 'jester') {
          threats.retire(managed.id);
        }
      }
      return;
    }
    if (threats.isJesterAwake && this.currentChunk >= GULLY_SHOWDOWN_CHUNK && !threats.isDefeatable('jester')) {
      threats.setDefeatable('jester', GULLY_SHOWDOWN_STRIKES);
      if (worldEvents.flag('jesterShowdownHint') < 1) {
        worldEvents.setFlag('jesterShowdownHint', 1);
        this.campaign?.say('jester.vulnerable');
      }
    }
  }


  private flashSaveIndicator(label: string): void {
    this.saveIndicator = { label, seconds: SAVE_INDICATOR_SECONDS };
  }

  /** Mabel sends each new right hand down when its act begins. */
  private announceNewHands(worldEvents: WorldEventSystem): void {
    const act: number = worldEvents.flag('actReached');
    const known: number = worldEvents.flag('handsAnnounced');
    for (const hand of RIGHT_HANDS) {
      if (hand.unlockAct > known && hand.unlockAct <= act && hand.unlockAct > 0) {
        worldEvents.setFlag('handsAnnounced', hand.unlockAct);
        this.showToast(`NEW HAND · ${hand.label} · PRESS X TO SWAP`, 4, 'success', hand.color);
        this.campaign?.say(hand.type === 'volt' ? 'hand.volt' : 'hand.chime');
        return;
      }
    }
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

  public playDialogue(dialogueId: DialogueId): void {
    this.campaign?.say(dialogueId);
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
        silencedMusicBoxIds: this.streamer?.silencedMusicBoxes ?? previous.world.silencedMusicBoxIds,
        openedVentIds: this.streamer?.openedVents ?? previous.world.openedVentIds,
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
    this.flashSaveIndicator('SAVING');
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
    if (written) this.flashSaveIndicator('SAVING');
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
    const rightPressed: boolean = !(this.rig?.rightHandType === 'volt' && this.voltRecharge > 0) && ((locked && input.wasMouseButtonPressed(2)) || input.wasKeyPressed('KeyR') || (hotbarRight && input.wasKeyPressed('KeyF')));
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
    this.musicBoxInView = this.pickupInView === null ? streamer.findMusicBoxInView(camera.position, camera.forward, INTERACT_REACH_METERS) : null;
    this.ventInView = this.pickupInView === null && this.musicBoxInView === null ? streamer.findVentInView(camera.position, camera.forward, INTERACT_REACH_METERS + 0.6) : null;
    this.switchInView =
      this.pickupInView === null && this.musicBoxInView === null && this.ventInView === null ? streamer.findSwitchInView(camera.position, camera.forward, INTERACT_REACH_METERS) : null;
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
    } else if (collected.kind === 'filterCartridge') {
      this.inventory.add('filterCartridge');
      this.services.audio.playUiCue('confirm');
    } else if (collected.kind === 'pipCompanion') {
      this.pip?.activate(collected.position, this.yawRadians + Math.PI);
      worldEvents.setFlag('pipRecruited', 1);
      this.campaign?.say('pip.recruited');
      this.services.audio.playSpatialCue('pipChirp', collected.position, 1.2);
    } else if (collected.kind === 'loreTape' && collected.tapeId !== null) {
      const tape: LoreTape | undefined = LORE_TAPES.find((candidate: LoreTape) => candidate.id === collected.tapeId);
      if (tape !== undefined) {
        this.lastTape = tape;
        this.loreReader.open(tape);
        this.services.input.releasePointerLock();
        this.services.audio.playSpatialCue('radioCrackle', collected.position, 1);
        worldEvents.incrementFlag('loreTapesFound');
        if (tape.id === ROSTER_TAPE_ID) {
          worldEvents.setFlag('rosterTapeFound', 1);
          this.campaign?.say('roster.found');
        }
      }
    }
    worldEvents.reportPickup(collected.id, collected.kind, collected.position);
  }

  private silenceMusicBox(box: MusicBoxRecord, streamer: LevelStreamer, worldEvents: WorldEventSystem): void {
    if (!streamer.silenceMusicBox(box.id)) {
      return;
    }
    worldEvents.incrementFlag('musicBoxesSilenced');
    this.services.audio.playSpatialCue('breakerClunk', box.position, 0.6);
    // The lid snapping shut is audible: the Choir Mother may come to check.
    this.threats?.emitNoise('breakerSwitch', box.position, 0.7);
    const remaining: number = streamer.playingMusicBoxes.filter((other: MusicBoxRecord) => other.chunkIndex === box.chunkIndex).length;
    if (remaining === 0) {
      this.campaign?.say('musicbox.all');
      this.showToast('THE SONG STOPS · THE CHAPEL DOORS RELEASE', 3, 'success');
      this.threats?.emitNoise('gateMoving', box.position, 1);
    } else {
      this.campaign?.say('musicbox.silenced', { allowRepeat: true });
      this.showToast(`MUSIC BOX SILENCED · ${remaining} STILL PLAYING`, 2.2, 'info');
    }
  }

  private chooseEnding(endingId: EndingId): void {
    const worldEvents: WorldEventSystem | null = this.worldEvents;
    if (worldEvents === null) {
      return;
    }
    worldEvents.setFlag('endingChosen', endingId === 'shutDown' ? 1 : 2);
    worldEvents.setFlag('campaignComplete', 1);
    this.services.saves.write(this.buildSave('checkpoint', 'autosave', {}));
    this.flashSaveIndicator('SAVING');
    this.services.audio.playSpatialCue('foremanBoom', this.services.camera.position, endingId === 'shutDown' ? 1 : 0.6);
  }

  private finishCampaign(): void {
    this.leavingLevel = true;
    this.services.lifecycle.requestTransition({ target: GameStateId.TitleScreen, payload: { reason: 'returnFromLevel' } });
  }

  /**
   * Aim assist for hand launches: picks the monster closest to the crosshair (measured from the eye, within ~15° and
   * 16 m) and sends the hand from its launcher straight at that monster's chest.
   */
  private assistAim(origin: Readonly<Vec3>, direction: Readonly<Vec3>): Vec3 | null {
    const threats: ThreatDirector | null = this.threats;
    if (threats === null) {
      return null;
    }
    void direction;
    const eye: Vec3 = this.services.camera.position;
    const look: Vec3 = [-Math.sin(this.yawRadians) * Math.cos(this.pitchRadians), Math.sin(this.pitchRadians), -Math.cos(this.yawRadians) * Math.cos(this.pitchRadians)];
    let best: Vec3 | null = null;
    let bestScore = Infinity;
    for (const managed of threats.activeThreats) {
      const chest: Vec3 = [managed.view.position[0], managed.view.position[1] + managed.profile.vision.eyeHeight * 0.65, managed.view.position[2]];
      const fromEye: Vec3 = [chest[0] - eye[0], chest[1] - eye[1], chest[2] - eye[2]];
      const distance: number = Math.hypot(fromEye[0], fromEye[1], fromEye[2]);
      if (distance < 0.5 || distance > AIM_ASSIST_RANGE_METERS) {
        continue;
      }
      const cosine: number = (fromEye[0] * look[0] + fromEye[1] * look[1] + fromEye[2] * look[2]) / distance;
      if (cosine < AIM_ASSIST_COSINE) {
        continue;
      }
      const score: number = (1 - cosine) * 40 + distance * 0.05;
      if (score < bestScore) {
        bestScore = score;
        const fromHand: Vec3 = [chest[0] - origin[0], chest[1] - origin[1], chest[2] - origin[2]];
        const handDistance: number = Math.hypot(fromHand[0], fromHand[1], fromHand[2]) || 1;
        best = [fromHand[0] / handDistance, fromHand[1] / handDistance, fromHand[2] / handDistance];
      }
    }
    return best;
  }

  private retireBossHushlings(): void {
    const threats = this.threats;
    if (threats === null) {
      return;
    }
    for (const threat of [...threats.activeThreats]) {
      if (threat.id.startsWith('threat.hushling.boss.')) {
        threats.retire(threat.id);
      }
    }
  }

  private ensureForemanEncounter(streamer: LevelStreamer): void {
    if (this.foreman !== null || streamer.bossArena === null || this.worldEvents === null) {
      return;
    }
    const worldEvents: WorldEventSystem = this.worldEvents;
    this.foreman = new ForemanEncounter(this.services.gl, streamer, {
      playerBounds: () => this.motor.boundsAt(this.motor.position),
      say: (dialogueId: DialogueId) => this.campaign?.say(dialogueId),
      playCue: (cue: SpatialCueId, position: Vec3, intensity: number) => this.services.audio.playSpatialCue(cue, position, intensity),
      spawnHushling: (position: Vec3) => {
        this.threats?.spawnHunter(`threat.hushling.boss.${Math.floor(this.sessionSeconds * 1000)}`, 'hushling', position, this.playerPosition());
      },
      setPhasesCleared: (count: number) => {
        worldEvents.setFlag('foremanPhasesCleared', count);
        if (count >= 3) {
          // The Foreman's summoned Hushlings collapse with him: no cheap death during the ending countdown.
          this.retireBossHushlings();
        }
      },
      onBeamHit: () => this.beginLethalCinematic('foremanBeam', { cause: 'entity', threat: 'foreman' }, null),
      onDefeated: () => {
        this.endingCountdown = 5;
      },
    });
    if (worldEvents.flag('foremanPhasesCleared') >= 3) {
      this.foreman.restoreDefeated();
      if (worldEvents.flag('campaignComplete') < 1) {
        this.endingCountdown = 1;
      }
    }
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
    if (this.loreReader.isOpen) {
      input.consumeMouseDelta();
      // E (the same key that picked the tape up) and Esc close straight away; the browser may swallow Esc to
      // release pointer lock, so losing the lock closes it too. Enter / Space / click finish the text, then close.
      const quickClose: boolean = this.loreReader.secondsOpen > 0.35 && (input.wasAnyKeyPressed(['KeyE', 'Escape', 'Backspace']) || lostLock);
      if (quickClose) {
        this.loreReader.close();
      } else {
        this.loreReader.update(buildUiFrameInput(services, frame.inputEnabled), deltaSeconds);
      }
      return;
    }
    if (this.ending.isActive) {
      input.consumeMouseDelta();
      this.campaign?.update(deltaSeconds);
      this.ending.update(services.ui.context, buildUiFrameInput(services, frame.inputEnabled), deltaSeconds);
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
    const wading: boolean = streamer.waterDepthAt(this.motor.position) > WADING_DEPTH;
    this.motor.speedMultiplier = wading ? WADING_SPEED_MULTIPLIER : 1;
    if (!this.cinematics.ownsCamera) {
      this.placeCamera(0);
    }
    services.camera.updateMatrices();

    // 4–7. Tether claws, cable forces, motor integration, rope constraints.
    this.voltRecharge = Math.max(0, this.voltRecharge - deltaSeconds);
    if (controlsEnabled && input.wasKeyPressed('KeyX')) {
      this.cycleRightHand(rig, worldEvents);
    }
    rig.update(deltaSeconds, this.buildTetherInput(input, controlsEnabled, intent), streamer, services.camera);
    this.resolveHandStrikes(rig, threats, worldEvents);
    if (this.sparkLight !== null) {
      this.sparkLight.position[0] = rig.sparkFlash.position[0];
      this.sparkLight.position[1] = rig.sparkFlash.position[1];
      this.sparkLight.position[2] = rig.sparkFlash.position[2];
      this.sparkLight.intensity = rig.sparkFlash.strength * 5;
    }
    if (this.handFill !== null) {
      const fill: Vec3 = rig.handFillPosition();
      this.handFill.position[0] = fill[0];
      this.handFill.position[1] = fill[1];
      this.handFill.position[2] = fill[2];
    }
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
        threats.emitNoise(stepNoise, this.playerPosition(), wading ? 1.6 : 1);
        if (wading) {
          // Water carries every step: louder, and audible as a splash.
          services.audio.playSpatialCue('splash', this.playerPosition(), 0.6);
        }
      }
      this.lastFootstepPhase = stepPhase;
    }

    // E / Esc (or the browser taking the mouse back on Esc) skips a non-lethal scene.
    if (this.cinematics.isSkippable && frame.inputEnabled && (input.wasAnyKeyPressed(['KeyE', 'Escape', 'Enter']) || lostLock)) {
      this.cinematics.skip();
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
      } else if (this.musicBoxInView !== null) {
        this.silenceMusicBox(this.musicBoxInView, streamer, worldEvents);
      } else if (this.ventInView !== null) {
        if (this.pip === null || !this.pip.isActive) {
          this.showToast('TOO SMALL FOR YOU · SOMETHING SMALLER COULD FIT', 2.2, 'info', UI_COLORS.textDim);
        } else if (this.pip.sendToVent(this.ventInView)) {
          this.showToast('PIP SCURRIES INTO THE VENT', 2, 'info');
          services.audio.playSpatialCue('pipChirp', this.pip.position, 1);
        }
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
    this.campaign?.updateChunk(this.currentChunk, ACT_ENTRY_DIALOGUE);
    this.campaign?.update(deltaSeconds);
    this.pip?.update(deltaSeconds, this.playerPosition(), this.yawRadians, streamer, this.sessionSeconds);
    this.ensureForemanEncounter(streamer);
    // Start the fight whenever the player is inside the arena zone and the Foreman is still dormant.
    // (The entry event alone can fire before the encounter exists if the arena streamed in that frame.)
    const arena = streamer.bossArena;
    if (
      this.foreman !== null &&
      this.foreman.state === 'dormant' &&
      arena !== null &&
      worldEvents.flag('foremanPhasesCleared') < 3 &&
      worldEvents.isPlayerInsideZone(`zone.foremanArena.${arena.chunkIndex}`)
    ) {
      worldEvents.setFlag('foremanEncountered', 1);
      this.foreman.begin();
    }
    this.foreman?.update(deltaSeconds);
    if (this.endingCountdown > 0) {
      this.endingCountdown -= deltaSeconds;
      if (this.endingCountdown <= 0) {
        this.endingCountdown = -1;
        services.input.releasePointerLock();
        const lastLine = this.campaign?.subtitle ?? null;
        this.ending.beginChoice(lastLine !== null ? { speaker: lastLine.speakerName, text: lastLine.text } : null);
        this.campaign?.say('ending.prompt');
      }
    }
    // Chapel music boxes chime in space while they play.
    this.chimeTimer -= deltaSeconds;
    if (this.chimeTimer <= 0) {
      this.chimeTimer = MUSIC_BOX_CHIME_SECONDS;
      for (const box of streamer.playingMusicBoxes) {
        const distance: number = Math.hypot(box.position[0] - this.motor.position[0], box.position[2] - this.motor.position[2]);
        if (distance < 16) {
          services.audio.playSpatialCue('musicBoxChime', box.position, 0.8);
        }
      }
    }

    // 13. Threats: scripted entrances (no monster appears before its scene), then tick every brain.
    this.updateEntrances(threats, worldEvents, deltaSeconds);
    this.updateCombatScenes(threats, worldEvents);
    this.announceNewHands(worldEvents);
    this.updateCherubs(threats, worldEvents, deltaSeconds);
    this.updateSeraph(threats, deltaSeconds);
    if (this.saveIndicator !== null) {
      this.saveIndicator.seconds -= deltaSeconds;
      if (this.saveIndicator.seconds <= 0) this.saveIndicator = null;
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
      this.flashSaveIndicator('SAVING');
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
      const polarity: Polarity = content.side === 'left' ? 'teal' : 'rose';
      return {
        label: polarity.toUpperCase(),
        keyHint,
        count: null,
        available: claw !== undefined,
        statusText: `${polarity.toUpperCase()} HAND · ${claw?.phase.toUpperCase() ?? 'OFFLINE'}`,
        accentColor: POLARITY_HUD_COLORS[polarity],
      };
    });
  }

  private buildHudSnapshot(timeSeconds: number): HudSnapshot {
    const rig: TetherRig | null = this.rig;
    const rightHand = RIGHT_HANDS.find((hand) => hand.type === (rig?.rightHandType ?? 'rose'));
    const clawSnapshot = (side: ClawSide, binding: string) => ({
      polarity: (side === 'left' ? 'teal' : 'rose') as Polarity,
      phase: rig?.claws[side].phase ?? 'holstered',
      binding: side === 'right' ? `${binding} · X SWAP` : binding,
      ...(side === 'right' && rightHand !== undefined ? { label: rightHand.label, color: rightHand.color } : {}),
      ...(side === 'right' && rig?.rightHandType === 'volt' && this.voltRecharge > 0 ? { status: `RECHARGING ${Math.ceil(this.voltRecharge)}` } : {}),
    });
    const pickupPrompts: Readonly<Record<PickupRecord['kind'], string>> = {
      gasMask: '[E] TAKE GAS MASK',
      filterCartridge: '[E] TAKE FILTER CARTRIDGE',
      loreTape: '[E] PLAY SHIFT TAPE',
      pipCompanion: '[E] WIND UP THE REPAIR MOUSE',
    };
    const pickupPrompt: string | null =
      this.pickupInView !== null
        ? pickupPrompts[this.pickupInView.kind]
        : this.musicBoxInView !== null
          ? '[E] CLOSE THE MUSIC BOX'
          : this.ventInView !== null
            ? this.pip?.isActive
              ? '[E] SEND PIP INTO THE VENT'
              : 'A VENT · TOO SMALL FOR YOU'
            : null;
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
      ...(this.saveIndicator !== null ? { saveIndicator: { label: this.saveIndicator.label, alpha: clamp(this.saveIndicator.seconds / 0.4, 0, 1) } } : {}),
      pointerLocked: this.services.input.isPointerLocked,
      timeSeconds,
    };
  }

  // ---- Render ----------------------------------------------------------------------------------------------------

  public render(frame: FrameContext, request: FrameRenderRequest, context: CanvasRenderingContext2D): void {
    request.renderScene = true;
    const act: ActDefinition | null = this.campaign?.act ?? null;
    const theme: ActTheme | null = act !== null ? ACT_THEMES[act.id] : null;
    request.environment = theme !== null ? { ambientColor: theme.sceneAmbient, clearColor: [0, 0, 0] } : LEVEL_ENVIRONMENT;
    this.streamer?.collectDrawItems(request.drawItems, frame.elapsedSeconds);
    this.threats?.collectDrawItems(request.drawItems);
    this.pip?.collectDrawItems(request.drawItems);
    this.foreman?.collectDrawItems(request.drawItems);
    if (!this.cinematics.hidesHud) {
      this.rig?.collectDrawItems(request.drawItems, frame.elapsedSeconds);
    }

    const post = this.services.postParameters;
    if (theme !== null) {
      post.fog.density *= theme.fogDensityScale;
      post.fog.albedo = theme.fogAlbedo;
      post.fog.ambientColor = theme.fogAmbient;
    }
    const dreadCurve: number = smoothstep(0.2, 1, this.dread);
    post.crt.chromaticAberration *= 1 + dreadCurve * 2.5 + this.gasMask.exposure * 1.5;
    post.crt.noiseIntensity += dreadCurve * 0.08;
    post.crt.trackingJitter *= 1 + dreadCurve * 3;
    post.fog.ambientColor = [post.fog.ambientColor[0] + LIGHT_PALETTE.emergencyRed[0] * 0.02 * dreadCurve, post.fog.ambientColor[1], post.fog.ambientColor[2]];
    const zone: ToxicZone | null = this.streamer?.nearestToxicZone(this.services.camera.position) ?? null;
    if (zone !== null) {
      post.fog.toxicVolume = { ...post.fog.toxicVolume, minimum: zone.bounds.minimum, maximum: zone.bounds.maximum, density: 0.11 * zone.concentration };
    }
    // The ending owns the screen: no HUD, objectives or subtitles under the choice, epilogue or credits.
    const endingActive: boolean = this.ending.isActive;
    if (!endingActive) {
      this.hud.draw(context, this.buildHudSnapshot(frame.elapsedSeconds));
    }
    const campaign: CampaignDirector | null = this.campaign;
    if (campaign !== null && !endingActive) {
      if (act !== null) {
        drawObjectives(context, `ACT ${act.numeral} · ${act.title}`, campaign.objectives, (1 - this.letterbox) * (this.paused ? 0 : 0.9));
      }
      drawSubtitle(context, campaign.subtitle);
      drawActCard(context, campaign.actCardSnapshot);
    }
    this.loreReader.draw(context, this.lastTape);
    if (this.cinematics.isSkippable) {
      context.save();
      context.font = UI_FONTS.small;
      context.textAlign = 'right';
      context.fillStyle = 'rgba(0, 0, 0, 0.5)';
      context.fillRect(VIRTUAL_RESOLUTION.width - 330, VIRTUAL_RESOLUTION.height - 108, 270, 54);
      context.fillStyle = UI_COLORS.textPrimary;
      context.globalAlpha = 0.8 + 0.2 * Math.sin(frame.elapsedSeconds * 3);
      context.fillText('E / ESC · SKIP', VIRTUAL_RESOLUTION.width - 80, VIRTUAL_RESOLUTION.height - 72);
      context.restore();
    }
    this.ending.draw(context, frame.elapsedSeconds);
    this.pauseMenu.draw(context, frame.elapsedSeconds);
  }
}
