import { UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../config/GameConstants';
import type { UiCue } from '../core/AudioManager';
import { clamp } from '../math/Vec3';
import type { ActCardSnapshot, ObjectiveSnapshot, SubtitleSnapshot } from '../story/CampaignDirector';
import type { EndingDefinition, EndingId, LoreTape } from '../story/CampaignScript';
import { ENDINGS } from '../story/CampaignScript';
import type { UIFrameInput } from './UILayout';
import { UIFocusGroup, UITextButton } from './UILayout';

const WIDTH: number = VIRTUAL_RESOLUTION.width;
const HEIGHT: number = VIRTUAL_RESOLUTION.height;

/** Wraps `text` to `maximumWidth` using the context's current font. */
function wrapText(context: CanvasRenderingContext2D, text: string, maximumWidth: number): string[] {
  const words: string[] = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate: string = current.length === 0 ? word : `${current} ${word}`;
    if (context.measureText(candidate).width > maximumWidth && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------------
// HUD-level overlays (stateless draws)
// ---------------------------------------------------------------------------------------------------------------------

/** Radio subtitle bar above the hotbar: speaker tag + wrapped line. */
export function drawSubtitle(context: CanvasRenderingContext2D, subtitle: SubtitleSnapshot | null): void {
  if (subtitle === null || subtitle.alpha <= 0.01) {
    return;
  }
  context.save();
  context.globalAlpha = subtitle.alpha;
  context.font = '400 30px "Georgia", "Times New Roman", serif';
  const lines: string[] = wrapText(context, subtitle.text, 1100);
  const boxHeight: number = 56 + lines.length * 40;
  const boxY: number = HEIGHT - 330 - boxHeight;
  context.fillStyle = 'rgba(0, 0, 0, 0.6)';
  context.fillRect(WIDTH / 2 - 600, boxY, 1200, boxHeight);
  context.fillStyle = subtitle.speakerColor;
  context.fillRect(WIDTH / 2 - 600, boxY, 6, boxHeight);
  context.font = UI_FONTS.small;
  context.fillText(subtitle.speakerName, WIDTH / 2 - 572, boxY + 32);
  context.font = '400 30px "Georgia", "Times New Roman", serif';
  context.fillStyle = UI_COLORS.textPrimary;
  lines.forEach((line: string, index: number) => context.fillText(line, WIDTH / 2 - 572, boxY + 72 + index * 40));
  context.restore();
}

/** Full-width act title card: numeral, title rule and tagline. */
export function drawActCard(context: CanvasRenderingContext2D, card: ActCardSnapshot | null): void {
  if (card === null || card.alpha <= 0.01) {
    return;
  }
  context.save();
  context.globalAlpha = card.alpha * 0.55;
  context.fillStyle = '#000000';
  context.fillRect(0, HEIGHT * 0.3, WIDTH, 260);
  context.globalAlpha = card.alpha;
  context.textAlign = 'center';
  context.font = UI_FONTS.chapter;
  context.fillStyle = UI_COLORS.accentRed;
  context.fillText(`ACT ${card.numeral}`, WIDTH / 2, HEIGHT * 0.3 + 70);
  context.font = '700 96px "Georgia", "Times New Roman", serif';
  context.fillStyle = UI_COLORS.textPrimary;
  context.shadowColor = 'rgba(0, 0, 0, 0.9)';
  context.shadowBlur = 20;
  context.fillText(card.title, WIDTH / 2, HEIGHT * 0.3 + 170);
  context.shadowBlur = 0;
  context.fillRect(WIDTH / 2 - 300, HEIGHT * 0.3 + 192, 600 * clamp(card.alpha * 1.3, 0, 1), 3);
  context.font = 'italic 400 30px "Georgia", "Times New Roman", serif';
  context.fillStyle = UI_COLORS.textDim;
  context.fillText(card.tagline, WIDTH / 2, HEIGHT * 0.3 + 236);
  context.restore();
}

/** Objective list under the status block: current act's goals with check marks. */
export function drawObjectives(context: CanvasRenderingContext2D, actTitle: string, objectives: readonly ObjectiveSnapshot[], alpha: number): void {
  if (alpha <= 0.01 || objectives.length === 0) {
    return;
  }
  context.save();
  context.globalAlpha = alpha;
  context.font = UI_FONTS.small;
  context.fillStyle = UI_COLORS.accentRed;
  context.fillText(actTitle, 80, 230);
  objectives.forEach((objective: ObjectiveSnapshot, index: number) => {
    const y: number = 266 + index * 32;
    context.fillStyle = objective.complete ? '#8fd18a' : UI_COLORS.textPrimary;
    context.globalAlpha = alpha * (objective.complete ? 0.55 : 0.9);
    context.fillText(`${objective.complete ? '✓' : '□'}  ${objective.text}`, 80, y);
  });
  context.restore();
}

// ---------------------------------------------------------------------------------------------------------------------
// Lore tape reader
// ---------------------------------------------------------------------------------------------------------------------

/** Modal transcript viewer: typed-out lines on an aged paper panel. Freezes play while open. */
export class LoreTapeReader {
  private tape: LoreTape | null = null;
  private elapsed: number = 0;
  private opacity: number = 0;

  public get isOpen(): boolean {
    return this.tape !== null;
  }

  public open(tape: LoreTape): void {
    this.tape = tape;
    this.elapsed = 0;
  }

  /** Returns true on the frame the reader closes. */
  public update(input: UIFrameInput, deltaSeconds: number): boolean {
    this.opacity = clamp(this.opacity + (this.tape !== null ? deltaSeconds * 6 : -deltaSeconds * 6), 0, 1);
    if (this.tape === null) {
      return false;
    }
    this.elapsed += deltaSeconds;
    if (this.elapsed > 0.4 && (input.activate || input.back || input.pointerReleased)) {
      const totalCharacters: number = this.tape.transcript.join('').length;
      if (this.elapsed * 55 < totalCharacters) {
        // First press finishes the typing; the second press closes.
        this.elapsed = totalCharacters / 55 + 0.5;
        return false;
      }
      this.tape = null;
      return true;
    }
    return false;
  }

  public draw(context: CanvasRenderingContext2D, lastTape: LoreTape | null): void {
    const tape: LoreTape | null = this.tape ?? lastTape;
    if (this.opacity <= 0.01 || tape === null) {
      return;
    }
    context.save();
    context.globalAlpha = this.opacity * 0.8;
    context.fillStyle = '#000000';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.globalAlpha = this.opacity;
    const panelX = 360;
    const panelY = 150;
    const panelWidth = 1200;
    const panelHeight = 760;
    const paper: CanvasGradient = context.createLinearGradient(panelX, panelY, panelX + panelWidth, panelY + panelHeight);
    paper.addColorStop(0, '#d8ccae');
    paper.addColorStop(1, '#b9a982');
    context.fillStyle = paper;
    context.fillRect(panelX, panelY, panelWidth, panelHeight);
    context.strokeStyle = 'rgba(60, 40, 20, 0.5)';
    context.lineWidth = 2;
    context.strokeRect(panelX + 18, panelY + 18, panelWidth - 36, panelHeight - 36);
    context.fillStyle = '#3a2418';
    context.font = '700 26px "Courier New", monospace';
    context.fillText(`MARROW & FINCH · SHIFT TAPE · ${tape.date}`, panelX + 60, panelY + 80);
    context.font = '700 52px "Georgia", serif';
    context.fillText(tape.title, panelX + 60, panelY + 150);
    context.fillRect(panelX + 60, panelY + 172, panelWidth - 120, 3);
    context.font = '400 30px "Courier New", monospace';
    let budget: number = Math.floor(this.elapsed * 55);
    let y: number = panelY + 240;
    for (const paragraph of tape.transcript) {
      for (const line of wrapText(context, paragraph, panelWidth - 140)) {
        if (budget <= 0) break;
        context.fillText(line.slice(0, budget), panelX + 60, y);
        budget -= line.length;
        y += 44;
      }
      y += 18;
    }
    context.font = UI_FONTS.small;
    context.fillStyle = 'rgba(58, 36, 24, 0.7)';
    context.fillText('PRESS E / ENTER TO CLOSE', panelX + 60, panelY + panelHeight - 40);
    context.restore();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Ending sequence: choice → epilogue → credits
// ---------------------------------------------------------------------------------------------------------------------

type EndingPhase = 'hidden' | 'choice' | 'epilogue' | 'credits';

const ENDING_CREDITS: readonly string[] = [
  'THE UNDERWORKS',
  'CHAPTER VI · THE LAST SHIFT',
  '',
  'IN MEMORY OF THE NIGHT SHIFT',
  'T. Abernathy · R. Cole · J. Finch · M. Thorne',
  '',
  'PIP WILL RETURN',
  '',
  'Marrow & Finch Novelty Co. is a fictional company.',
];

export class EndingSequence {
  public phase: EndingPhase = 'hidden';
  private elapsed: number = 0;
  private ending: EndingDefinition | null = null;
  private readonly choiceGroup: UIFocusGroup;
  private pendingChoice: EndingId | null = null;

  public constructor(onCue: (cue: UiCue) => void, private readonly onChosen: (ending: EndingId) => void, private readonly onFinished: () => void) {
    const style = { font: UI_FONTS.menuButton, paddingX: 26, paddingY: 14, hoverIndent: 0, align: 'center' } as const;
    this.choiceGroup = new UIFocusGroup(
      [
        new UITextButton('ending.shutDown', ENDINGS.shutDown.choiceLabel, WIDTH / 2, 620, style, () => (this.pendingChoice = 'shutDown')),
        new UITextButton('ending.takeHisPlace', ENDINGS.takeHisPlace.choiceLabel, WIDTH / 2, 720, style, () => (this.pendingChoice = 'takeHisPlace')),
      ],
      { onCue, onBack: null },
    );
  }

  public get isActive(): boolean {
    return this.phase !== 'hidden';
  }

  public beginChoice(): void {
    this.phase = 'choice';
    this.elapsed = 0;
    this.choiceGroup.focusedIndex = 0;
    this.choiceGroup.resetInteraction();
  }

  public update(context: CanvasRenderingContext2D, input: UIFrameInput, deltaSeconds: number): void {
    this.elapsed += deltaSeconds;
    switch (this.phase) {
      case 'choice':
        this.choiceGroup.layout(context);
        if (this.elapsed > 1) {
          this.choiceGroup.update(input, deltaSeconds);
        }
        if (this.pendingChoice !== null) {
          this.ending = ENDINGS[this.pendingChoice];
          this.onChosen(this.pendingChoice);
          this.pendingChoice = null;
          this.phase = 'epilogue';
          this.elapsed = 0;
        }
        break;
      case 'epilogue': {
        const epilogueSeconds: number = (this.ending?.epilogue.length ?? 0) * 4 + 3;
        if (this.elapsed >= epilogueSeconds || (this.elapsed > 2 && input.activate)) {
          this.phase = 'credits';
          this.elapsed = 0;
        }
        break;
      }
      case 'credits':
        if (this.elapsed >= ENDING_CREDITS.length * 1.2 + 6 || (this.elapsed > 2 && (input.activate || input.back))) {
          this.phase = 'hidden';
          this.onFinished();
        }
        break;
      case 'hidden':
        break;
    }
  }

  public draw(context: CanvasRenderingContext2D, timeSeconds: number): void {
    if (this.phase === 'hidden') {
      return;
    }
    context.save();
    context.textAlign = 'center';
    if (this.phase === 'choice') {
      context.globalAlpha = clamp(this.elapsed, 0, 1) * 0.75;
      context.fillStyle = '#000000';
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.globalAlpha = clamp(this.elapsed, 0, 1);
      context.font = UI_FONTS.chapter;
      context.fillStyle = UI_COLORS.accentRed;
      context.fillText('LINE CONTROL · OPERATOR INPUT REQUIRED', WIDTH / 2, 430);
      context.textAlign = 'left';
      this.choiceGroup.draw(context, timeSeconds);
    } else if (this.phase === 'epilogue' && this.ending !== null) {
      context.fillStyle = '#000000';
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.font = '700 96px "Georgia", serif';
      context.fillStyle = UI_COLORS.accentRed;
      context.globalAlpha = clamp(this.elapsed, 0, 1);
      context.fillText(this.ending.title, WIDTH / 2, 300);
      context.font = 'italic 400 34px "Georgia", serif';
      context.fillStyle = UI_COLORS.textPrimary;
      this.ending.epilogue.forEach((line: string, index: number) => {
        context.globalAlpha = clamp(this.elapsed - 1.5 - index * 4, 0, 1);
        context.fillText(line, WIDTH / 2, 440 + index * 70);
      });
    } else if (this.phase === 'credits') {
      context.fillStyle = '#000000';
      context.fillRect(0, 0, WIDTH, HEIGHT);
      const scroll: number = this.elapsed * 60;
      ENDING_CREDITS.forEach((line: string, index: number) => {
        const y: number = HEIGHT + 60 + index * 80 - scroll;
        context.globalAlpha = clamp(1 - Math.abs(y - HEIGHT / 2) / (HEIGHT / 2), 0, 1);
        context.font = index === 0 ? '700 80px "Georgia", serif' : index === 1 ? UI_FONTS.chapter : UI_FONTS.body;
        context.fillStyle = index <= 1 ? UI_COLORS.accentRed : UI_COLORS.textPrimary;
        context.fillText(line, WIDTH / 2, y);
      });
    }
    context.restore();
  }
}
