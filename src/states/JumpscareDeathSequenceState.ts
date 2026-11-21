import { UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../config/GameConstants';
import type { GameServices } from '../core/GameServices';
import type { DeathCause, FrameContext, FrameRenderRequest, GameStateHandler, GameStatePayloadMap, KillerId } from '../core/GameStateTypes';
import { GameStateId } from '../core/GameStateTypes';
import type { SaveGame } from '../core/serialization/SaveGameSchema';
import { clamp } from '../math/Vec3';
import type { UIFrameInput } from '../ui/UILayout';
import { UIFocusGroup, UITextButton } from '../ui/UILayout';
import { buildUiFrameInput } from '../ui/UIInputAdapter';

type DeathPhase = 'blackout' | 'summary';

/** Seconds of static-filled black after the in-world death cinematic before the summary fades up. */
const BLACKOUT_SECONDS: number = 0.9;

const KILLER_HEADLINES: Readonly<Record<KillerId, string>> = {
  jester: 'YOUR SHIFT IS OVER',
  tallyman: 'THE TALLYMAN COUNTED YOU',
  choirMother: 'MOTHER SANG YOU TO SLEEP',
  hushling: 'HUSH NOW',
  foreman: 'YOUR CARD WAS PUNCHED',
};

function deathHeadline(cause: DeathCause, killer: KillerId | null): string {
  if (cause === 'fall') return 'LOST TO THE FOUNDATIONS';
  if (cause === 'toxicity') return 'THE AIR TOOK YOU';
  return killer !== null ? KILLER_HEADLINES[killer] : 'YOUR SHIFT IS OVER';
}

/**
 * Jumpscare / Death sequence state. The lethal cinematic itself plays in-world (CinematicDirector in
 * the level state) and cuts here on its blackout hook; this state holds the black, then presents the
 * run summary with RETRY FROM CHECKPOINT / RETURN TO TITLE.
 */
export class JumpscareDeathSequenceState implements GameStateHandler<GameStateId.JumpscareDeathSequence> {
  public readonly id = GameStateId.JumpscareDeathSequence;
  private elapsed: number = 0;
  public phase: DeathPhase = 'blackout';
  public cause: DeathCause = 'entity';
  private threat: KillerId | null = null;
  private checkpoint: SaveGame | null = null;
  private survivedSeconds: number = 0;
  private depthMeters: number = 0;
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
    services.audio.overrideListener(null);
    services.audio.setCinematicDuck(0);
    services.audio.setMaskAudioMix(0);
    services.audio.setDreadLevel(0);
    services.audio.stopAmbientDrone(0.05);
    this.elapsed = 0;
    this.phase = 'blackout';
    this.pendingChoice = null;
    this.checkpoint = payload.save;
    this.survivedSeconds = payload.survivedSeconds;
    this.depthMeters = payload.depthMeters;
    this.cause = payload.cause;
    this.threat = payload.threat;
    this.focusGroup.focusedIndex = 0;
    this.focusGroup.resetInteraction();
  }

  public exit(): void {
    this.checkpoint = null;
  }

  public update(frame: FrameContext): void {
    this.elapsed += frame.deltaSeconds;
    this.phase = this.elapsed < BLACKOUT_SECONDS ? 'blackout' : 'summary';
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
        this.services.lifecycle.requestTransition({ target: GameStateId.CampaignLoading, payload: { mode: 'retry', save: this.checkpoint } });
      } else {
        this.services.lifecycle.requestTransition({ target: GameStateId.TitleScreen, payload: { reason: 'returnFromDeath' } });
      }
    }
  }

  public render(frame: FrameContext, request: FrameRenderRequest, context: CanvasRenderingContext2D): void {
    request.renderScene = false;
    const crt = this.services.postParameters.crt;
    crt.noiseIntensity = this.phase === 'blackout' ? 0.16 : 0.08;
    context.fillStyle = '#000000';
    context.fillRect(0, 0, VIRTUAL_RESOLUTION.width, VIRTUAL_RESOLUTION.height);
    if (this.phase !== 'summary') {
      return;
    }
    const reveal: number = clamp((this.elapsed - BLACKOUT_SECONDS) * 1.4, 0, 1);
    const centerX: number = VIRTUAL_RESOLUTION.width / 2;
    context.save();
    context.globalAlpha = reveal;
    context.textAlign = 'center';
    context.font = UI_FONTS.deathHeadline;
    context.fillStyle = UI_COLORS.accentRed;
    context.shadowColor = UI_COLORS.accentRedGlow;
    context.shadowBlur = 30;
    context.fillText(deathHeadline(this.cause, this.threat), centerX + Math.sin(frame.elapsedSeconds * 40) * (reveal < 1 ? 6 : 0), 420);
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
