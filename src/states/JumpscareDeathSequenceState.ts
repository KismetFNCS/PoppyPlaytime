import { LIGHT_PALETTE, UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../config/GameConstants';
import type { GameServices } from '../core/GameServices';
import type { DeathCause, FrameContext, FrameRenderRequest, GameStateHandler, GameStatePayloadMap } from '../core/GameStateTypes';
import { GameStateId } from '../core/GameStateTypes';
import type { SaveCheckpoint } from '../core/PersistentStores';
import type { PointLight } from '../graphics/LightingSystem';
import type { SceneEnvironment } from '../graphics/SceneRenderer';
import { clamp, lerp, smoothstep } from '../math/Vec3';
import type { UIFrameInput } from '../ui/UILayout';
import { UIFocusGroup, UITextButton } from '../ui/UILayout';
import { buildUiFrameInput } from '../ui/UIInputAdapter';
import { JesterEntity } from '../world/JesterEntity';

type DeathPhase = 'lunge' | 'hold' | 'blackout' | 'summary';

/** Phase boundaries in seconds from entry. */
const LUNGE_END: number = 0.28;
const HOLD_END: number = 1.35;
const BLACKOUT_END: number = 2.4;
const DEATH_ENVIRONMENT: SceneEnvironment = { ambientColor: [0.03, 0.006, 0.006], clearColor: [0, 0, 0] };
const DEATH_HEADLINES: Readonly<Record<DeathCause, string>> = {
  entity: 'YOUR SHIFT IS OVER',
  fall: 'LOST TO THE FOUNDATIONS',
  toxicity: 'THE AIR TOOK YOU',
};

/**
 * Jumpscare / Death sequence: the entity lunges into a close-up under a strobing red light with screen
 * shake, maximal aberration and a flash; cuts to black; then a summary with RETRY / RETURN TO TITLE.
 */
export class JumpscareDeathSequenceState implements GameStateHandler<GameStateId.JumpscareDeathSequence> {
  public readonly id = GameStateId.JumpscareDeathSequence;
  private elapsed: number = 0;
  private phase: DeathPhase = 'lunge';
  private jester: JesterEntity | null = null;
  private faceLight: PointLight | null = null;
  private checkpoint: SaveCheckpoint | null = null;
  private survivedSeconds: number = 0;
  private depthMeters: number = 0;
  private cause: DeathCause = 'entity';
  private pendingChoice: 'retry' | 'title' | null = null;
  private readonly focusGroup: UIFocusGroup;

  public constructor(private readonly services: GameServices) {
    const style = { font: UI_FONTS.menuButton, paddingX: 26, paddingY: 14, hoverIndent: 0, align: 'center' } as const;
    const centerX: number = VIRTUAL_RESOLUTION.width / 2;
    this.focusGroup = new UIFocusGroup(
      [
        new UITextButton('death.retry', 'RETRY FROM CHECKPOINT', centerX, 760, style, () => (this.pendingChoice = 'retry')),
        new UITextButton('death.title', 'RETURN TO TITLE', centerX, 850, style, () => (this.pendingChoice = 'title')),
      ],
      { onCue: (cue) => services.audio.playUiCue(cue), onBack: () => (this.pendingChoice = 'title') },
    );
  }

  public enter(payload: GameStatePayloadMap[GameStateId.JumpscareDeathSequence]): void {
    const services: GameServices = this.services;
    services.input.releasePointerLock();
    services.lighting.clear();
    this.elapsed = 0;
    this.phase = 'lunge';
    this.pendingChoice = null;
    this.checkpoint = payload.checkpoint;
    this.survivedSeconds = payload.survivedSeconds;
    this.depthMeters = payload.depthMeters;
    this.cause = payload.cause;
    const jester = new JesterEntity(services.meshes);
    jester.mode = 'lunging';
    jester.headTwitchStrength = 1.2;
    jester.eyeGlow = 2.4;
    jester.yawRadians = 0;
    jester.position = [0, 0, -4.5];
    this.jester = jester;
    this.faceLight = services.lighting.add({
      position: [0, 2.3, -0.6],
      color: LIGHT_PALETTE.deathFlash,
      intensity: 9,
      range: 8,
      behavior: { kind: 'strobe', frequencyHertz: 14, dutyCycle: 0.55 },
    });
    services.lighting.add({ position: [0.8, 1.2, -2.5], color: LIGHT_PALETTE.serviceBlue, intensity: 1.5, range: 6, behavior: { kind: 'flicker', rateHertz: 18, dropoutChance: 0.4 } });
    const camera = services.camera;
    camera.position = [0, 1.62, 0];
    camera.yawRadians = 0;
    camera.pitchRadians = 0.1;
    camera.rollRadians = 0;
    services.audio.stopAmbientDrone(0.05);
    services.audio.setDreadLevel(0);
    services.audio.setMaskAudioMix(0);
    if (this.cause === 'entity') {
      services.audio.playJumpscare();
    } else {
      // Non-entity deaths skip the lunge and cut straight to the blackout.
      this.elapsed = HOLD_END;
      this.phase = 'blackout';
      if (this.cause === 'toxicity') {
        services.audio.playChoke();
      } else {
        services.audio.playImpactThud(1);
      }
    }
    this.focusGroup.focusedIndex = 0;
    this.focusGroup.resetInteraction();
  }

  public exit(): void {
    this.jester = null;
    this.faceLight = null;
    this.services.lighting.clear();
  }

  public update(frame: FrameContext): void {
    this.elapsed += frame.deltaSeconds;
    this.phase = this.elapsed < LUNGE_END ? 'lunge' : this.elapsed < HOLD_END ? 'hold' : this.elapsed < BLACKOUT_END ? 'blackout' : 'summary';
    const jester: JesterEntity | null = this.jester;
    if (jester !== null) {
      jester.updateIdle(frame.deltaSeconds);
      const lungeProgress: number = smoothstep(0, LUNGE_END, this.elapsed);
      // Lowered so the head meets the lens at eye height; the face ends ~0.5 m from the camera, filling the frame.
      jester.position = [Math.sin(this.elapsed * 47) * 0.03, lerp(-0.35, -0.68, lungeProgress), lerp(-4.5, -0.78, lungeProgress)];
    }
    const camera = this.services.camera;
    camera.pitchRadians = lerp(0.1, 0.04, smoothstep(0, LUNGE_END, this.elapsed));
    if (this.faceLight !== null) {
      this.faceLight.enabled = this.phase === 'lunge' || this.phase === 'hold';
    }
    if (this.phase === 'summary') {
      this.services.audio.startAmbientDrone();
      const input: UIFrameInput = buildUiFrameInput(this.services, frame.inputEnabled);
      this.focusGroup.showCollisionBoxes = this.services.lifecycle.showCollisionBoxes;
      this.focusGroup.layout(this.services.ui.context);
      this.focusGroup.update(input, frame.deltaSeconds);
    }
    if (this.pendingChoice !== null && this.checkpoint !== null) {
      const choice: 'retry' | 'title' = this.pendingChoice;
      this.pendingChoice = null;
      if (choice === 'retry') {
        this.services.lifecycle.requestTransition({ target: GameStateId.ActiveLevelStreamer, payload: { mode: 'retry', checkpoint: this.checkpoint } });
      } else {
        this.services.lifecycle.requestTransition({ target: GameStateId.TitleScreen, payload: { reason: 'returnFromDeath' } });
      }
    }
  }

  public render(frame: FrameContext, request: FrameRenderRequest, context: CanvasRenderingContext2D): void {
    const crt = this.services.postParameters.crt;
    const fog = this.services.postParameters.fog;
    if (this.phase === 'lunge' || this.phase === 'hold') {
      request.renderScene = true;
      request.environment = DEATH_ENVIRONMENT;
      this.jester?.collectDrawItems(request.drawItems);
      const intensity: number = this.phase === 'lunge' ? 1 : 1 - smoothstep(LUNGE_END, HOLD_END, this.elapsed) * 0.5;
      const shake: number = 0.012 * intensity;
      crt.screenShake = [Math.sin(this.elapsed * 91) * shake, Math.cos(this.elapsed * 77) * shake];
      crt.chromaticAberration = 6 * intensity + crt.chromaticAberration;
      crt.trackingJitter = 6;
      crt.noiseIntensity = 0.22;
      crt.flashColor = [0.9, 0.02, 0.02];
      crt.flashIntensity = this.elapsed < 0.08 ? 0.85 : Math.max(0, 0.25 - (this.elapsed - 0.08)) * 0.8;
      fog.density *= 0.6;
    } else {
      request.renderScene = false;
      crt.noiseIntensity = this.phase === 'blackout' ? 0.14 : 0.08;
      context.fillStyle = '#000000';
      context.fillRect(0, 0, VIRTUAL_RESOLUTION.width, VIRTUAL_RESOLUTION.height);
    }
    if (this.phase === 'summary') {
      const reveal: number = clamp((this.elapsed - BLACKOUT_END) * 1.4, 0, 1);
      const centerX: number = VIRTUAL_RESOLUTION.width / 2;
      context.save();
      context.globalAlpha = reveal;
      context.textAlign = 'center';
      context.font = UI_FONTS.deathHeadline;
      context.fillStyle = UI_COLORS.accentRed;
      context.shadowColor = UI_COLORS.accentRedGlow;
      context.shadowBlur = 30;
      context.fillText(DEATH_HEADLINES[this.cause], centerX + Math.sin(frame.elapsedSeconds * 40) * (reveal < 1 ? 6 : 0), 420);
      context.shadowBlur = 0;
      context.font = UI_FONTS.chapter;
      context.fillStyle = UI_COLORS.textPrimary;
      const minutes: number = Math.floor(this.survivedSeconds / 60);
      const seconds: number = Math.floor(this.survivedSeconds % 60);
      context.fillText(`SURVIVED ${minutes}:${String(seconds).padStart(2, '0')}   ·   DEPTH -${this.depthMeters.toFixed(1)} M   ·   DEATHS ${this.checkpoint?.deathCount ?? 0}`, centerX, 520);
      context.restore();
      context.save();
      context.globalAlpha = reveal;
      this.focusGroup.draw(context, frame.elapsedSeconds);
      context.restore();
    }
  }
}
