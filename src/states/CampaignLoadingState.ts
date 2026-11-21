import { GAME_IDENTITY, UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../config/GameConstants';
import type { GameServices } from '../core/GameServices';
import type { FrameContext, FrameRenderRequest, GameStateHandler, GameStatePayloadMap } from '../core/GameStateTypes';
import { GameStateId } from '../core/GameStateTypes';
import { clamp } from '../math/Vec3';
import type { ActDefinition } from '../story/CampaignScript';
import { actForChunk } from '../story/CampaignScript';
import { FactoryVistaScene, VISTA_ENVIRONMENT } from '../world/FactoryVistaScene';
import { chunkIndexAtZ } from '../world/LevelStreamer';

const MINIMUM_SECONDS: number = 4;
const LOADING_TIPS: readonly string[] = [
  'The Tallyman can barely see. It hears everything. Walk, don’t run.',
  'Gully only moves while you look away. Keep your eyes on him.',
  'Hushlings freeze in light. Keep Pip’s lantern close.',
  'Fit a spare filter cartridge with slot 2 and F.',
  'Hand scanners only accept the hand of their own colour.',
  'Shift tapes tell you what happened in 1987. Listen to all of them.',
  'The Choir Mother hunts by sound. Silence the music boxes while she is away.',
  'Low beams: jump. High beams: crouch.',
];

interface RainStreak {
  x: number;
  y: number;
  speed: number;
  length: number;
}

/**
 * Chapter loading screen: a night exterior of the factory (FactoryVistaScene) with rain, the chapter
 * and act being entered, a tip, a progress bar, and a press-to-continue prompt that hands off to the level.
 */
export class CampaignLoadingState implements GameStateHandler<GameStateId.CampaignLoading> {
  public readonly id = GameStateId.CampaignLoading;
  private vista: FactoryVistaScene | null = null;
  private payload: GameStatePayloadMap[GameStateId.CampaignLoading] | null = null;
  private elapsed: number = 0;
  private act: ActDefinition | null = null;
  private tip: string = LOADING_TIPS[0] as string;
  private readonly rain: RainStreak[] = [];
  private handedOff: boolean = false;

  public constructor(private readonly services: GameServices) {
    for (let streak = 0; streak < 140; streak += 1) {
      this.rain.push({ x: Math.random() * VIRTUAL_RESOLUTION.width, y: Math.random() * VIRTUAL_RESOLUTION.height, speed: 900 + Math.random() * 700, length: 30 + Math.random() * 40 });
    }
  }

  public enter(payload: GameStatePayloadMap[GameStateId.CampaignLoading]): void {
    this.payload = payload;
    this.elapsed = 0;
    this.handedOff = false;
    this.services.input.releasePointerLock();
    this.vista = new FactoryVistaScene(this.services.gl, this.services.meshes, this.services.lighting);
    const save = payload.save;
    const chunk: number = save.kind === 'session' && save.player !== null ? chunkIndexAtZ(save.player.transform.position[2]) : save.checkpointChunkIndex;
    this.act = actForChunk(chunk);
    this.tip = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)] as string;
    this.services.audio.startAmbientDrone();
    this.services.audio.setDreadLevel(0);
  }

  public exit(): void {
    this.vista?.dispose(this.services.lighting);
    this.vista = null;
  }

  private get progress(): number {
    return clamp(this.elapsed / MINIMUM_SECONDS, 0, 1);
  }

  public update(frame: FrameContext): void {
    this.elapsed += frame.deltaSeconds;
    this.vista?.update(frame.deltaSeconds, this.services.camera);
    for (const streak of this.rain) {
      streak.y += streak.speed * frame.deltaSeconds;
      streak.x -= streak.speed * 0.12 * frame.deltaSeconds;
      if (streak.y > VIRTUAL_RESOLUTION.height) {
        streak.y = -streak.length;
        streak.x = Math.random() * (VIRTUAL_RESOLUTION.width + 200);
      }
    }
    if (!this.handedOff && this.payload !== null && this.progress >= 1 && frame.inputEnabled && this.services.input.anyGestureThisFrame) {
      this.handedOff = true;
      this.services.audio.playUiCue('confirm');
      this.services.lifecycle.requestTransition({ target: GameStateId.ActiveLevelStreamer, payload: this.payload });
    }
  }

  public render(frame: FrameContext, request: FrameRenderRequest, context: CanvasRenderingContext2D): void {
    request.renderScene = true;
    request.environment = VISTA_ENVIRONMENT;
    this.vista?.collectDrawItems(request.drawItems);
    const fog = this.services.postParameters.fog;
    fog.density *= 0.45;
    fog.maxRayDistance = 90;
    fog.heightFalloff = 0.12;

    const width: number = VIRTUAL_RESOLUTION.width;
    const height: number = VIRTUAL_RESOLUTION.height;
    // Rain.
    context.save();
    context.strokeStyle = 'rgba(190, 200, 220, 0.18)';
    context.lineWidth = 1.5;
    context.beginPath();
    for (const streak of this.rain) {
      context.moveTo(streak.x, streak.y);
      context.lineTo(streak.x - streak.length * 0.12, streak.y + streak.length);
    }
    context.stroke();
    context.restore();

    // Letterbox and titles.
    context.save();
    context.fillStyle = '#000000';
    context.fillRect(0, 0, width, 110);
    context.fillRect(0, height - 150, width, 150);
    const reveal: number = clamp(this.elapsed / 1.5, 0, 1);
    context.globalAlpha = reveal;
    context.font = UI_FONTS.small;
    context.fillStyle = UI_COLORS.textDim;
    context.fillText(GAME_IDENTITY.companyName.toUpperCase(), 120, 72);
    context.textAlign = 'right';
    context.fillText('NIGHT SHIFT · RE-ENTRY', width - 120, 72);
    context.textAlign = 'left';
    context.font = UI_FONTS.chapter;
    context.fillStyle = UI_COLORS.accentRed;
    context.fillText(`${GAME_IDENTITY.chapterLabel} · ${GAME_IDENTITY.subtitle}`, 120, 230);
    context.font = UI_FONTS.title;
    context.fillStyle = UI_COLORS.textPrimary;
    context.shadowColor = 'rgba(0, 0, 0, 0.9)';
    context.shadowBlur = 24;
    context.fillText(GAME_IDENTITY.title, 112, 350);
    context.shadowBlur = 0;
    if (this.act !== null) {
      context.font = UI_FONTS.subtitle;
      context.fillStyle = UI_COLORS.textPrimary;
      const verb: string = this.payload?.mode === 'newGame' ? 'BEGINNING' : 'RESUMING';
      context.fillText(`${verb} · ACT ${this.act.numeral}: ${this.act.title}`, 120, 420);
      context.font = 'italic 400 28px "Georgia", serif';
      context.fillStyle = UI_COLORS.textDim;
      context.fillText(this.act.tagline, 120, 466);
    }
    // Tip + progress.
    context.font = UI_FONTS.small;
    context.fillStyle = UI_COLORS.textDim;
    context.fillText(`TIP · ${this.tip}`, 120, height - 92);
    context.fillStyle = 'rgba(233, 225, 207, 0.15)';
    context.fillRect(120, height - 62, width - 240, 6);
    context.fillStyle = UI_COLORS.accentRed;
    context.fillRect(120, height - 62, (width - 240) * this.progress, 6);
    if (this.progress >= 1) {
      context.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(frame.elapsedSeconds * 2.4));
      context.textAlign = 'right';
      context.font = UI_FONTS.chapter;
      context.fillStyle = UI_COLORS.textPrimary;
      context.fillText('PRESS ANY KEY TO CLOCK IN', width - 120, height - 86);
    }
    context.restore();
  }
}
