import { LIGHT_PALETTE, UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../config/GameConstants';
import type { GameServices } from '../core/GameServices';
import type { FrameContext, FrameRenderRequest, GameStateHandler, GameStatePayloadMap } from '../core/GameStateTypes';
import { GameStateId } from '../core/GameStateTypes';
import type { SaveCheckpoint } from '../core/PersistentStores';
import type { SceneEnvironment } from '../graphics/SceneRenderer';
import { clamp, smoothstep } from '../math/Vec3';
import { JesterEntity } from '../world/JesterEntity';
import { CORRIDOR_DIMENSIONS, LevelStreamer, chunkIndexAtZ, chunkStartZ } from '../world/LevelStreamer';
import type { MenuBackdropScene } from '../world/MenuBackdropScene';
import { PlayerController } from '../world/PlayerController';

const LEVEL_WORLD_SEED: number = 0x5eed_0006;
const LEVEL_ENVIRONMENT: SceneEnvironment = { ambientColor: [0.012, 0.011, 0.016], clearColor: [0, 0, 0] };
/** Metres of descent represented by one corridor chunk, for the depth readout. */
const METERS_PER_CHUNK: number = 4;
const ENTITY_AWAKEN_DISTANCE_METERS: number = 16;
const ENTITY_AWAKEN_SECONDS: number = 14;
const ENTITY_SPAWN_BEHIND_METERS: number = 15;

interface HudToast {
  text: string;
  remainingSeconds: number;
}

/** Active Level Streamer: first-person exploration of streamed corridor chunks with the stalking Jester Entity. */
export class ActiveLevelStreamerState implements GameStateHandler<GameStateId.ActiveLevelStreamer> {
  public readonly id = GameStateId.ActiveLevelStreamer;
  private streamer: LevelStreamer | null = null;
  private jester: JesterEntity | null = null;
  private readonly player: PlayerController = new PlayerController();
  private checkpoint: SaveCheckpoint | null = null;
  private sessionSeconds: number = 0;
  private spawnZ: number = 0;
  private currentChunk: number = 0;
  private dread: number = 0;
  private objectiveOpacity: number = 0;
  private toast: HudToast | null = null;
  private caught: boolean = false;

  public constructor(private readonly services: GameServices, private readonly backdrop: MenuBackdropScene) {}

  public enter(payload: GameStatePayloadMap[GameStateId.ActiveLevelStreamer]): void {
    const services: GameServices = this.services;
    this.backdrop.unload();
    services.lighting.clear();
    this.checkpoint = payload.checkpoint;
    if (payload.mode === 'newGame') {
      services.save.write(payload.checkpoint);
    }
    const streamer = new LevelStreamer(services.gl, services.meshes, services.lighting, LEVEL_WORLD_SEED);
    const spawnChunk: number = payload.checkpoint.checkpointChunkIndex;
    streamer.primeAround(spawnChunk);
    this.streamer = streamer;
    this.spawnZ = chunkStartZ(spawnChunk) - 2.6;
    this.player.teleport([0, 0, this.spawnZ], 0);
    this.currentChunk = spawnChunk;
    const jester = new JesterEntity(services.meshes);
    jester.mode = 'dormant';
    this.jester = jester;
    services.lighting.disturbances.push(jester.disturbance);
    this.sessionSeconds = 0;
    this.dread = 0;
    this.objectiveOpacity = 0;
    this.caught = false;
    this.toast = {
      text: payload.mode === 'retry' ? 'RESUMING FROM LAST CHECKPOINT' : payload.mode === 'continue' ? 'SHIFT RECORD RESTORED' : 'FOLLOW THE LIGHTS DOWN',
      remainingSeconds: 4,
    };
    services.audio.startAmbientDrone();
  }

  public exit(): void {
    this.services.input.releasePointerLock();
    this.streamer?.dispose();
    this.streamer = null;
    this.jester = null;
    this.services.lighting.clear();
    this.services.audio.setDreadLevel(0);
  }

  private get depthMeters(): number {
    return Math.max(0, -this.player.position[2] / CORRIDOR_DIMENSIONS.chunkLength) * METERS_PER_CHUNK;
  }

  private buildCheckpoint(overrides: Partial<Pick<SaveCheckpoint, 'checkpointChunkIndex' | 'deathCount'>>): SaveCheckpoint {
    const previous: SaveCheckpoint = this.checkpoint as SaveCheckpoint;
    return {
      version: 1,
      checkpointChunkIndex: overrides.checkpointChunkIndex ?? previous.checkpointChunkIndex,
      deepestChunkIndex: Math.max(previous.deepestChunkIndex, this.currentChunk),
      playTimeSeconds: Math.round((previous.playTimeSeconds + this.sessionSeconds) * 100) / 100,
      deathCount: overrides.deathCount ?? previous.deathCount,
      savedAtIso: new Date().toISOString(),
    };
  }

  private recordCheckpoint(chunkIndex: number): void {
    const updated: SaveCheckpoint = this.buildCheckpoint({ checkpointChunkIndex: chunkIndex });
    this.services.save.write(updated);
    this.checkpoint = { ...updated, playTimeSeconds: updated.playTimeSeconds - this.sessionSeconds };
    this.services.audio.playCheckpointChime();
    this.toast = { text: 'PROGRESS RECORDED', remainingSeconds: 2.8 };
  }

  private awakenJester(): void {
    const jester: JesterEntity | null = this.jester;
    if (jester === null) {
      return;
    }
    jester.position = [0, 0, Math.min(chunkStartZ(0) - 1, this.player.position[2] + ENTITY_SPAWN_BEHIND_METERS)];
    jester.mode = 'stalking';
    this.services.lighting.globalIntensityScale = 0.15;
    window.setTimeout(() => (this.services.lighting.globalIntensityScale = 1), 450);
    this.services.audio.playUiCue('denied');
    this.toast = { text: 'SOMETHING IS FOLLOWING YOU', remainingSeconds: 3 };
  }

  public update(frame: FrameContext): void {
    const streamer: LevelStreamer | null = this.streamer;
    const jester: JesterEntity | null = this.jester;
    if (streamer === null || jester === null || this.checkpoint === null) {
      return;
    }
    const services: GameServices = this.services;
    const input = services.input;
    const deltaSeconds: number = frame.deltaSeconds;
    this.sessionSeconds += deltaSeconds;
    this.objectiveOpacity = clamp(this.objectiveOpacity + deltaSeconds * 0.8, 0, 1);
    if (this.toast !== null) {
      this.toast.remainingSeconds -= deltaSeconds;
      if (this.toast.remainingSeconds <= 0) {
        this.toast = null;
      }
    }

    if (frame.inputEnabled && !this.caught) {
      if (input.pointer.primaryPressedThisFrame && !input.isPointerLocked) {
        input.requestPointerLock();
      }
      if (input.wasKeyPressed('Escape') && !input.isPointerLocked) {
        services.save.write(this.buildCheckpoint({}));
        services.audio.playUiCue('back');
        services.lifecycle.requestTransition({ target: GameStateId.TitleScreen, payload: { reason: 'returnFromLevel' } });
        return;
      }
      if (this.player.update(deltaSeconds, input, services.settings.values, streamer)) {
        services.audio.playFootstep(this.player.isSprinting);
      }
    } else {
      input.consumeMouseDelta();
    }
    this.player.applyToCamera(services.camera, services.settings.values);

    const newChunk: number = chunkIndexAtZ(this.player.position[2]);
    if (newChunk !== this.currentChunk) {
      this.currentChunk = newChunk;
      if (streamer.isCheckpoint(newChunk) && newChunk > this.checkpoint.checkpointChunkIndex) {
        this.recordCheckpoint(newChunk);
      }
    }
    streamer.update(this.currentChunk);

    if (jester.mode === 'dormant') {
      const travelled: number = this.spawnZ - this.player.position[2];
      if (travelled > ENTITY_AWAKEN_DISTANCE_METERS || (this.sessionSeconds > ENTITY_AWAKEN_SECONDS && travelled > 6)) {
        this.awakenJester();
      }
    }
    const caught: boolean = jester.updateStalking(deltaSeconds, { position: services.camera.position, viewDirection: services.camera.forward }, streamer);
    const distance: number = jester.mode === 'dormant' ? Infinity : jester.distanceTo(this.player.position);
    this.dread = jester.mode === 'dormant' ? 0 : clamp(1 - (distance - 1.5) / 16, 0, 1);
    services.audio.setDreadLevel(this.dread);
    services.audio.updateHeartbeat(deltaSeconds, this.dread);

    if (caught && !this.caught && frame.inputEnabled) {
      this.caught = true;
      const deathCheckpoint: SaveCheckpoint = this.buildCheckpoint({ deathCount: this.checkpoint.deathCount + 1 });
      services.save.write(deathCheckpoint);
      services.lifecycle.requestTransition({
        target: GameStateId.JumpscareDeathSequence,
        payload: { checkpoint: deathCheckpoint, survivedSeconds: this.sessionSeconds, depthMeters: this.depthMeters },
      }, 'cut');
    }
  }

  private drawHud(context: CanvasRenderingContext2D, timeSeconds: number): void {
    const width: number = VIRTUAL_RESOLUTION.width;
    const height: number = VIRTUAL_RESOLUTION.height;
    context.save();
    // Crosshair.
    context.fillStyle = 'rgba(233, 225, 207, 0.55)';
    context.fillRect(width / 2 - 2, height / 2 - 2, 4, 4);
    // Depth + time readout (camcorder-style overlay).
    context.font = UI_FONTS.small;
    context.fillStyle = UI_COLORS.textPrimary;
    const recordingBlink: boolean = Math.floor(timeSeconds * 1.5) % 2 === 0;
    if (recordingBlink) {
      context.fillStyle = UI_COLORS.accentRed;
      context.beginPath();
      context.arc(96, 86, 10, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = UI_COLORS.textPrimary;
    context.fillText('REC', 116, 94);
    context.fillText(`DEPTH  -${this.depthMeters.toFixed(1)} M`, 80, 136);
    const totalSeconds: number = Math.floor((this.checkpoint?.playTimeSeconds ?? 0) + this.sessionSeconds);
    const clock: string = `${String(Math.floor(totalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
    context.textAlign = 'right';
    context.fillText(`SHIFT ${clock}`, width - 80, 94);
    context.fillText(`CHECKPOINT ${String(this.checkpoint?.checkpointChunkIndex ?? 0).padStart(3, '0')}`, width - 80, 136);
    context.textAlign = 'left';
    // Stamina bar.
    const staminaWidth = 360;
    context.fillStyle = 'rgba(233, 225, 207, 0.12)';
    context.fillRect(80, height - 90, staminaWidth, 10);
    context.fillStyle = this.player.stamina < 0.3 ? UI_COLORS.accentRed : 'rgba(233, 225, 207, 0.7)';
    context.fillRect(80, height - 90, staminaWidth * this.player.stamina, 10);
    context.fillStyle = UI_COLORS.textDim;
    context.fillText('STAMINA', 80, height - 104);
    // Pointer-lock hint.
    if (!this.services.input.isPointerLocked) {
      context.textAlign = 'center';
      context.fillStyle = UI_COLORS.textDim;
      context.fillText('CLICK TO LOOK AROUND · WASD MOVE · SHIFT SPRINT · ESC (UNLOCKED) RETURNS TO TITLE', width / 2, height - 60);
      context.textAlign = 'left';
    }
    // Toast.
    if (this.toast !== null) {
      const alpha: number = clamp(this.toast.remainingSeconds, 0, 1) * this.objectiveOpacity;
      context.globalAlpha = alpha;
      context.font = UI_FONTS.chapter;
      context.textAlign = 'center';
      context.fillStyle = UI_COLORS.textPrimary;
      context.shadowColor = UI_COLORS.accentRedGlow;
      context.shadowBlur = 18;
      context.fillText(this.toast.text, width / 2, height * 0.78);
      context.shadowBlur = 0;
      context.globalAlpha = 1;
      context.textAlign = 'left';
    }
    // Dread vignette in red.
    if (this.dread > 0.01) {
      const gradient: CanvasGradient = context.createRadialGradient(width / 2, height / 2, height * 0.25, width / 2, height / 2, height * 0.85);
      gradient.addColorStop(0, 'rgba(120, 0, 0, 0)');
      gradient.addColorStop(1, `rgba(120, 0, 0, ${(this.dread * 0.55).toFixed(3)})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    }
    context.restore();
  }

  public render(frame: FrameContext, request: FrameRenderRequest, context: CanvasRenderingContext2D): void {
    request.renderScene = true;
    request.environment = LEVEL_ENVIRONMENT;
    this.streamer?.collectDrawItems(request.drawItems);
    if (this.jester !== null && this.jester.mode !== 'dormant') {
      this.jester.collectDrawItems(request.drawItems);
    }
    const post = this.services.postParameters;
    const dreadCurve: number = smoothstep(0.2, 1, this.dread);
    post.crt.chromaticAberration *= 1 + dreadCurve * 2.5;
    post.crt.noiseIntensity += dreadCurve * 0.08;
    post.crt.trackingJitter *= 1 + dreadCurve * 3;
    post.fog.ambientColor = [
      post.fog.ambientColor[0] + LIGHT_PALETTE.emergencyRed[0] * 0.02 * dreadCurve,
      post.fog.ambientColor[1],
      post.fog.ambientColor[2],
    ];
    this.drawHud(context, frame.elapsedSeconds);
  }
}
