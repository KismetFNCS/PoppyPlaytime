import { GAME_IDENTITY, UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../config/GameConstants';
import type { GameServices } from '../core/GameServices';
import type { FrameContext, FrameRenderRequest, GameStateHandler, GameStatePayloadMap } from '../core/GameStateTypes';
import { GameStateId } from '../core/GameStateTypes';
import { MeshLibrary } from '../assets/MeshLibrary';
import { MaterialRegistry } from '../graphics/MaterialRegistry';
import { clamp } from '../math/Vec3';

type BootPhase = 'loadingMaterials' | 'loadingMeshes' | 'awaitingGesture' | 'failed';

/**
 * Core Bootloader: streams/bakes every material and imported mesh with a live terminal-style log,
 * then waits for a user gesture (required to unlock Web Audio) before handing over to the Title Screen.
 */
export class CoreBootloaderState implements GameStateHandler<GameStateId.CoreBootloader> {
  public readonly id = GameStateId.CoreBootloader;
  private phase: BootPhase = 'loadingMaterials';
  private progress: number = 0;
  private displayedProgress: number = 0;
  private readonly logLines: string[] = [];
  private failureMessage: string = '';
  private elapsedInState: number = 0;

  public constructor(private readonly services: GameServices) {}

  private log(line: string): void {
    this.logLines.push(line);
    if (this.logLines.length > 14) {
      this.logLines.shift();
    }
  }

  public enter(_payload: GameStatePayloadMap[GameStateId.CoreBootloader]): void {
    this.phase = 'loadingMaterials';
    this.progress = 0;
    this.displayedProgress = 0;
    this.elapsedInState = 0;
    this.logLines.length = 0;
    const gl: WebGL2RenderingContext = this.services.gl;
    this.log(`${GAME_IDENTITY.companyName.toUpperCase()} // MAINTENANCE TERMINAL`);
    this.log(`RENDERER: ${String(gl.getParameter(gl.VERSION))}`);
    this.log(`SHADER PROGRAMS: scene / volumetric-fog / crt-vhs-composite .... OK`);
    void this.runLoadSequence();
  }

  private async runLoadSequence(): Promise<void> {
    const materialWeight: number = MaterialRegistry.totalCount;
    const meshWeight: number = MeshLibrary.totalCount;
    const totalWeight: number = materialWeight + meshWeight;
    try {
      let lastMaterial: string = '';
      await this.services.materials.loadAll((progress) => {
        this.progress = progress.loadedCount / totalWeight;
        if (progress.currentMaterialName !== 'complete' && progress.currentMaterialName !== lastMaterial) {
          lastMaterial = progress.currentMaterialName;
          this.log(`BAKE MATERIAL  ${progress.currentMaterialName}`);
        }
      });
      this.log(`MATERIAL REGISTRY: ${materialWeight} profiles resident .... OK`);
      this.phase = 'loadingMeshes';
      await this.services.meshes.loadAll((loadedCount: number, _totalCount: number, currentName: string) => {
        this.progress = (materialWeight + loadedCount) / totalWeight;
        if (currentName !== 'complete') {
          this.log(`IMPORT MESH    ${currentName}`);
        }
      });
      this.log(`MESH LIBRARY: ${meshWeight} imported assets resident .... OK`);
      this.log('ALL SYSTEMS NOMINAL. THE NIGHT SHIFT IS WAITING.');
      this.progress = 1;
      this.phase = 'awaitingGesture';
    } catch (error: unknown) {
      this.phase = 'failed';
      this.failureMessage = error instanceof Error ? error.message : String(error);
      this.log('FATAL: asset bootstrap failed. See console.');
      console.error('[CoreBootloader] asset bootstrap failed', error);
    }
  }

  public exit(): void {
    this.logLines.length = 0;
  }

  public update(frame: FrameContext): void {
    this.elapsedInState += frame.deltaSeconds;
    this.displayedProgress = clamp(this.displayedProgress + (this.progress - this.displayedProgress) * Math.min(1, frame.deltaSeconds * 8), 0, 1);
    if (this.phase === 'awaitingGesture' && frame.inputEnabled && this.services.input.anyGestureThisFrame) {
      this.services.audio.unlock();
      this.services.audio.playUiCue('confirm');
      this.services.lifecycle.requestTransition({ target: GameStateId.TitleScreen, payload: { reason: 'boot' } });
    }
  }

  public render(frame: FrameContext, request: FrameRenderRequest, context: CanvasRenderingContext2D): void {
    request.renderScene = false;
    const centerX: number = VIRTUAL_RESOLUTION.width / 2;
    context.fillStyle = '#030304';
    context.fillRect(0, 0, VIRTUAL_RESOLUTION.width, VIRTUAL_RESOLUTION.height);

    context.font = UI_FONTS.bootloader;
    context.fillStyle = 'rgba(233, 225, 207, 0.75)';
    this.logLines.forEach((line: string, index: number) => {
      context.fillText(line, 120, 140 + index * 44);
    });

    const barWidth = 1100;
    const barX: number = centerX - barWidth / 2;
    const barY = 860;
    context.strokeStyle = UI_COLORS.panelStroke;
    context.lineWidth = 3;
    context.strokeRect(barX, barY, barWidth, 34);
    context.fillStyle = UI_COLORS.accentRed;
    const segments = 40;
    const filledSegments: number = Math.floor(this.displayedProgress * segments);
    for (let segment = 0; segment < filledSegments; segment += 1) {
      context.fillRect(barX + 6 + segment * ((barWidth - 12) / segments), barY + 6, (barWidth - 12) / segments - 4, 22);
    }
    context.font = UI_FONTS.small;
    context.fillStyle = UI_COLORS.textDim;
    context.textAlign = 'right';
    context.fillText(`${Math.round(this.displayedProgress * 100)}%`, barX + barWidth, barY - 14);
    context.textAlign = 'center';
    if (this.phase === 'awaitingGesture') {
      const blink: number = 0.45 + 0.55 * Math.abs(Math.sin(frame.elapsedSeconds * 2.4));
      context.globalAlpha = blink;
      context.font = UI_FONTS.chapter;
      context.fillStyle = UI_COLORS.textPrimary;
      context.fillText('PRESS ANY KEY OR CLICK TO CLOCK IN', centerX, 980);
      context.globalAlpha = 1;
    } else if (this.phase === 'failed') {
      context.font = UI_FONTS.small;
      context.fillStyle = UI_COLORS.accentRed;
      context.fillText(this.failureMessage.slice(0, 140), centerX, 980);
    } else {
      context.font = UI_FONTS.small;
      context.fillStyle = UI_COLORS.textDim;
      const dots: string = '.'.repeat(1 + (Math.floor(this.elapsedInState * 3) % 3));
      context.fillText(`${this.phase === 'loadingMaterials' ? 'BAKING MATERIALS' : 'IMPORTING MESHES'}${dots}`, centerX, 980);
    }
    context.textAlign = 'left';
  }
}
