import { MAIN_MENU_LAYOUT, STORY_OVERLAY_TEXT, UI_COLORS, UI_FONTS } from '../config/GameConstants';
import { clamp } from '../math/Vec3';

export interface StoryOverlayRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly padding: number;
  readonly lineHeight: number;
}

/**
 * Game Text overlay block: a framed panel that word-wraps its copy to the panel width and reveals it
 * with a typewriter effect, then idles with a blinking tape cursor.
 */
export class StoryOverlay {
  private wrappedLines: string[] = [];
  private wrappedForFont: string = '';
  private revealedCharacters: number = 0;
  private readonly totalCharacters: number;
  public charactersPerSecond: number = 42;
  public opacity: number = 0;

  public constructor(
    private readonly text: string = STORY_OVERLAY_TEXT,
    private readonly rect: StoryOverlayRect = MAIN_MENU_LAYOUT.storyPanel,
    private readonly font: string = UI_FONTS.body,
  ) {
    this.totalCharacters = text.length;
  }

  public restart(): void {
    this.revealedCharacters = 0;
    this.opacity = 0;
  }

  public skipReveal(): void {
    this.revealedCharacters = this.totalCharacters;
  }

  public get isFullyRevealed(): boolean {
    return this.revealedCharacters >= this.totalCharacters;
  }

  public update(deltaSeconds: number): void {
    this.opacity = clamp(this.opacity + deltaSeconds * 1.5, 0, 1);
    this.revealedCharacters = Math.min(this.totalCharacters, this.revealedCharacters + deltaSeconds * this.charactersPerSecond);
  }

  /** Greedy word wrap against measured glyph widths. */
  private wrap(context: CanvasRenderingContext2D): void {
    if (this.wrappedForFont === this.font && this.wrappedLines.length > 0) {
      return;
    }
    context.font = this.font;
    const maximumWidth: number = this.rect.width - this.rect.padding * 2;
    const words: string[] = this.text.split(/\s+/);
    const lines: string[] = [];
    let currentLine: string = '';
    for (const word of words) {
      const candidate: string = currentLine.length === 0 ? word : `${currentLine} ${word}`;
      if (context.measureText(candidate).width > maximumWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    }
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
    this.wrappedLines = lines;
    this.wrappedForFont = this.font;
  }

  public draw(context: CanvasRenderingContext2D, timeSeconds: number): void {
    if (this.opacity <= 0) {
      return;
    }
    this.wrap(context);
    const contentHeight: number = this.wrappedLines.length * this.rect.lineHeight + this.rect.padding * 2;
    const panelHeight: number = Math.max(this.rect.height, contentHeight);
    const panelY: number = this.rect.y + this.rect.height - panelHeight;
    context.save();
    context.globalAlpha = this.opacity;
    context.fillStyle = UI_COLORS.panelFill;
    context.fillRect(this.rect.x, panelY, this.rect.width, panelHeight);
    context.strokeStyle = UI_COLORS.panelStroke;
    context.lineWidth = 2;
    context.strokeRect(this.rect.x + 0.5, panelY + 0.5, this.rect.width - 1, panelHeight - 1);
    // Corner brackets.
    context.fillStyle = UI_COLORS.accentRed;
    const bracket = 22;
    context.fillRect(this.rect.x - 4, panelY - 4, bracket, 4);
    context.fillRect(this.rect.x - 4, panelY - 4, 4, bracket);
    context.fillRect(this.rect.x + this.rect.width - bracket + 4, panelY + panelHeight, bracket, 4);
    context.fillRect(this.rect.x + this.rect.width, panelY + panelHeight - bracket + 4, 4, bracket);

    context.font = this.font;
    context.fillStyle = UI_COLORS.textPrimary;
    let remaining: number = Math.floor(this.revealedCharacters);
    let cursorX: number = this.rect.x + this.rect.padding;
    let cursorY: number = panelY + this.rect.padding + this.rect.lineHeight * 0.75;
    for (let lineIndex = 0; lineIndex < this.wrappedLines.length; lineIndex += 1) {
      const line: string = this.wrappedLines[lineIndex] as string;
      const baselineY: number = panelY + this.rect.padding + this.rect.lineHeight * (lineIndex + 0.75);
      if (remaining <= 0) {
        break;
      }
      const visible: string = line.slice(0, remaining);
      context.fillText(visible, this.rect.x + this.rect.padding, baselineY);
      cursorX = this.rect.x + this.rect.padding + context.measureText(visible).width + 4;
      cursorY = baselineY;
      remaining -= line.length + 1;
    }
    if (Math.floor(timeSeconds * 2.2) % 2 === 0) {
      context.fillStyle = UI_COLORS.accentRed;
      context.fillRect(cursorX, cursorY - 24, 14, 28);
    }
    context.restore();
  }
}
