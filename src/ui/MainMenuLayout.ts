import type { MainMenuButtonLabel } from '../config/GameConstants';
import { GAME_IDENTITY, MAIN_MENU_BUTTON_LABELS, MAIN_MENU_LAYOUT, UI_COLORS, UI_FONTS } from '../config/GameConstants';
import type { UiCue } from '../core/AudioManager';
import { StoryOverlay } from './StoryOverlay';
import type { UIFrameInput } from './UILayout';
import { UIFocusGroup, UITextButton } from './UILayout';

export type MainMenuAction = 'continue' | 'newGame' | 'settings' | 'credits' | 'quit';

const LABEL_TO_ACTION: Readonly<Record<MainMenuButtonLabel, MainMenuAction>> = {
  CONTINUE: 'continue',
  'NEW GAME': 'newGame',
  SETTINGS: 'settings',
  CREDITS: 'credits',
  QUIT: 'quit',
};

export interface MainMenuCallbacks {
  readonly onAction: (action: MainMenuAction) => void;
  readonly onCue: (cue: UiCue) => void;
}

/**
 * Title screen layout: wordmark block (chapter tag, title, subtitle, rule), the five-button column with
 * glyph-measured collision boxes, the Game Text story overlay panel, and footer tags.
 */
export class MainMenuLayout {
  public readonly focusGroup: UIFocusGroup;
  public readonly storyOverlay: StoryOverlay = new StoryOverlay();
  private readonly buttonsByAction: Map<MainMenuAction, UITextButton> = new Map();
  private introProgress: number = 0;
  /** One-line description of the save CONTINUE would load (null hides it). */
  private continueSummary: string | null = null;

  public constructor(callbacks: MainMenuCallbacks) {
    const column = MAIN_MENU_LAYOUT.buttonColumn;
    const buttons: UITextButton[] = MAIN_MENU_BUTTON_LABELS.map((label: MainMenuButtonLabel, index: number) => {
      const action: MainMenuAction = LABEL_TO_ACTION[label];
      const button = new UITextButton(
        `menu.${action}`,
        label,
        column.x,
        column.firstBaselineY + index * column.spacing,
        { font: UI_FONTS.menuButton, paddingX: column.paddingX, paddingY: column.paddingY, hoverIndent: MAIN_MENU_LAYOUT.hoverIndent, align: 'left' },
        () => callbacks.onAction(action),
      );
      this.buttonsByAction.set(action, button);
      return button;
    });
    this.focusGroup = new UIFocusGroup(buttons, { onCue: callbacks.onCue, onBack: null });
  }

  public button(action: MainMenuAction): UITextButton {
    const button: UITextButton | undefined = this.buttonsByAction.get(action);
    if (button === undefined) {
      throw new Error(`[MainMenuLayout] unknown action ${action}`);
    }
    return button;
  }

  public setContinueAvailable(isAvailable: boolean): void {
    this.button('continue').enabled = isAvailable;
  }

  public setContinueSummary(summary: string | null): void {
    this.continueSummary = summary;
  }

  public restartIntro(): void {
    this.introProgress = 0;
    this.storyOverlay.restart();
    this.focusGroup.resetInteraction();
    const firstEnabled: number = this.focusGroup.widgets.findIndex((widget) => widget.enabled);
    this.focusGroup.focusedIndex = firstEnabled;
  }

  public update(context: CanvasRenderingContext2D, input: UIFrameInput, deltaSeconds: number, interactive: boolean): void {
    this.introProgress = Math.min(1, this.introProgress + deltaSeconds * 0.9);
    this.storyOverlay.update(deltaSeconds);
    this.focusGroup.layout(context);
    if (interactive) {
      this.focusGroup.update(input, deltaSeconds);
    } else {
      for (const widget of this.focusGroup.widgets) {
        widget.animate(deltaSeconds);
      }
    }
  }

  private drawWordmark(context: CanvasRenderingContext2D, timeSeconds: number): void {
    const reveal: number = this.introProgress;
    context.save();
    context.globalAlpha = reveal;
    // Chapter tag with tape-style label block.
    context.font = UI_FONTS.chapter;
    const chapterWidth: number = context.measureText(GAME_IDENTITY.chapterLabel).width;
    context.fillStyle = UI_COLORS.accentRed;
    context.fillRect(MAIN_MENU_LAYOUT.chapterOrigin.x - 10, MAIN_MENU_LAYOUT.chapterOrigin.y - 30, chapterWidth + 20, 40);
    context.fillStyle = '#0b0b0d';
    context.fillText(GAME_IDENTITY.chapterLabel, MAIN_MENU_LAYOUT.chapterOrigin.x, MAIN_MENU_LAYOUT.chapterOrigin.y);

    // Title with chromatic ghosting that occasionally glitches sideways.
    const glitchGate: boolean = Math.floor(timeSeconds * 7) % 23 === 0;
    const glitchOffset: number = glitchGate ? Math.sin(timeSeconds * 90) * 10 : 0;
    context.font = UI_FONTS.title;
    context.globalAlpha = reveal * 0.6;
    context.fillStyle = UI_COLORS.accentRed;
    context.fillText(GAME_IDENTITY.title, MAIN_MENU_LAYOUT.titleOrigin.x + 4 + glitchOffset, MAIN_MENU_LAYOUT.titleOrigin.y);
    context.fillStyle = UI_COLORS.accentBlue;
    context.fillText(GAME_IDENTITY.title, MAIN_MENU_LAYOUT.titleOrigin.x - 4 - glitchOffset * 0.5, MAIN_MENU_LAYOUT.titleOrigin.y + 1);
    context.globalAlpha = reveal;
    context.fillStyle = UI_COLORS.textPrimary;
    context.shadowColor = 'rgba(0, 0, 0, 0.9)';
    context.shadowBlur = 18;
    context.fillText(GAME_IDENTITY.title, MAIN_MENU_LAYOUT.titleOrigin.x, MAIN_MENU_LAYOUT.titleOrigin.y);
    context.shadowBlur = 0;

    context.font = UI_FONTS.subtitle;
    context.fillStyle = UI_COLORS.accentRed;
    context.fillText(GAME_IDENTITY.subtitle, MAIN_MENU_LAYOUT.subtitleOrigin.x, MAIN_MENU_LAYOUT.subtitleOrigin.y);
    const underline = MAIN_MENU_LAYOUT.titleUnderline;
    context.fillStyle = UI_COLORS.textPrimary;
    context.globalAlpha = reveal * 0.6;
    context.fillRect(underline.x, underline.y, underline.width * reveal, underline.thickness);
    context.restore();
  }

  private drawFooter(context: CanvasRenderingContext2D): void {
    context.save();
    context.globalAlpha = this.introProgress;
    context.font = UI_FONTS.small;
    context.fillStyle = UI_COLORS.textDim;
    context.textAlign = 'left';
    context.fillText(GAME_IDENTITY.buildVersion, MAIN_MENU_LAYOUT.versionOrigin.x, MAIN_MENU_LAYOUT.versionOrigin.y);
    context.textAlign = 'right';
    context.fillText(`${GAME_IDENTITY.companyName} · ${GAME_IDENTITY.companyMotto}`, MAIN_MENU_LAYOUT.companyOrigin.x, MAIN_MENU_LAYOUT.companyOrigin.y);
    context.restore();
  }

  public draw(context: CanvasRenderingContext2D, timeSeconds: number): void {
    // Left-side legibility gradient behind the wordmark and buttons.
    const gradient: CanvasGradient = context.createLinearGradient(0, 0, 1100, 0);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1100, 1080);
    this.drawWordmark(context, timeSeconds);
    context.save();
    context.globalAlpha = this.introProgress;
    this.focusGroup.draw(context, timeSeconds);
    if (this.continueSummary !== null) {
      const continueButton = this.button('continue');
      context.font = UI_FONTS.small;
      context.fillStyle = UI_COLORS.textDim;
      context.fillText(this.continueSummary, continueButton.anchorX + 4 + continueButton.focusBlend * MAIN_MENU_LAYOUT.hoverIndent, continueButton.baselineY + 30);
    }
    context.restore();
    this.storyOverlay.draw(context, timeSeconds);
    this.drawFooter(context);
  }
}
