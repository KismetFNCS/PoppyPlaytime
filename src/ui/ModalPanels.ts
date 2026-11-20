import { CREDITS_LINES, UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../config/GameConstants';
import type { UiCue } from '../core/AudioManager';
import { clamp } from '../math/Vec3';
import type { UIFrameInput } from './UILayout';
import { UIFocusGroup, UITextButton } from './UILayout';

const MODAL_BUTTON_STYLE = {
  font: '700 46px "Courier New", "Courier", monospace',
  paddingX: 26,
  paddingY: 16,
  hoverIndent: 0,
  align: 'center',
} as const;

function drawDimmer(context: CanvasRenderingContext2D, opacity: number): void {
  context.save();
  context.globalAlpha = opacity * 0.78;
  context.fillStyle = '#000000';
  context.fillRect(0, 0, VIRTUAL_RESOLUTION.width, VIRTUAL_RESOLUTION.height);
  context.restore();
}

function drawFramedPanel(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, opacity: number): void {
  context.save();
  context.globalAlpha = opacity;
  context.fillStyle = 'rgba(8, 6, 10, 0.92)';
  context.fillRect(x, y, width, height);
  context.strokeStyle = UI_COLORS.panelStroke;
  context.lineWidth = 3;
  context.strokeRect(x + 1.5, y + 1.5, width - 3, height - 3);
  context.fillStyle = UI_COLORS.accentRed;
  context.fillRect(x, y, width, 6);
  context.restore();
}

/** Two-choice confirmation dialog with its own focus group (used by NEW GAME overwrite and QUIT). */
export class ConfirmDialog {
  public isOpen: boolean = false;
  private opacity: number = 0;
  private readonly focusGroup: UIFocusGroup;
  private message: string = '';
  private onConfirm: () => void = () => undefined;

  public constructor(onCue: (cue: UiCue) => void) {
    const centerX: number = VIRTUAL_RESOLUTION.width / 2;
    const confirmButton = new UITextButton('dialog.confirm', 'YES', centerX - 170, 640, MODAL_BUTTON_STYLE, () => {
      this.isOpen = false;
      this.onConfirm();
    });
    const cancelButton = new UITextButton('dialog.cancel', 'NO', centerX + 170, 640, MODAL_BUTTON_STYLE, () => this.close());
    this.focusGroup = new UIFocusGroup([confirmButton, cancelButton], { onCue, onBack: () => this.close() });
  }

  public open(message: string, confirmLabel: string, cancelLabel: string, onConfirm: () => void): void {
    this.message = message;
    (this.focusGroup.widgets[0] as UITextButton).label = confirmLabel;
    (this.focusGroup.widgets[1] as UITextButton).label = cancelLabel;
    this.onConfirm = onConfirm;
    this.isOpen = true;
    this.focusGroup.focusedIndex = 1;
    this.focusGroup.resetInteraction();
  }

  public close(): void {
    this.isOpen = false;
  }

  public set showCollisionBoxes(value: boolean) {
    this.focusGroup.showCollisionBoxes = value;
  }

  public update(context: CanvasRenderingContext2D, input: UIFrameInput, deltaSeconds: number): void {
    this.opacity = clamp(this.opacity + (this.isOpen ? deltaSeconds * 6 : -deltaSeconds * 6), 0, 1);
    if (!this.isOpen) {
      return;
    }
    // Horizontal navigation maps onto the dialog's two buttons.
    const remapped: UIFrameInput = {
      ...input,
      navigateUp: input.navigateUp || input.navigateLeft,
      navigateDown: input.navigateDown || input.navigateRight,
      navigateLeft: false,
      navigateRight: false,
    };
    this.focusGroup.layout(context);
    this.focusGroup.update(remapped, deltaSeconds);
  }

  public get isVisible(): boolean {
    return this.opacity > 0.001;
  }

  public draw(context: CanvasRenderingContext2D, timeSeconds: number): void {
    if (!this.isVisible) {
      return;
    }
    drawDimmer(context, this.opacity);
    const panelWidth = 900;
    const panelHeight = 340;
    const panelX: number = (VIRTUAL_RESOLUTION.width - panelWidth) / 2;
    const panelY = 400;
    drawFramedPanel(context, panelX, panelY, panelWidth, panelHeight, this.opacity);
    context.save();
    context.globalAlpha = this.opacity;
    context.font = UI_FONTS.settingsRow;
    context.textAlign = 'center';
    context.fillStyle = UI_COLORS.textPrimary;
    context.fillText(this.message, VIRTUAL_RESOLUTION.width / 2, panelY + 120);
    context.restore();
    context.save();
    context.globalAlpha = this.opacity;
    this.focusGroup.draw(context, timeSeconds);
    context.restore();
  }
}

/** Auto-scrolling credits roll; any confirm/back input or click closes it. */
export class CreditsPanel {
  public isOpen: boolean = false;
  private opacity: number = 0;
  private scrollOffset: number = 0;

  public open(): void {
    this.isOpen = true;
    this.scrollOffset = 0;
  }

  public update(input: UIFrameInput, deltaSeconds: number, onClosed: () => void): void {
    this.opacity = clamp(this.opacity + (this.isOpen ? deltaSeconds * 5 : -deltaSeconds * 5), 0, 1);
    if (!this.isOpen) {
      return;
    }
    this.scrollOffset += deltaSeconds * 46;
    const rollHeight: number = CREDITS_LINES.length * 58 + 620;
    if (this.scrollOffset > rollHeight) {
      this.scrollOffset = 0;
    }
    if (input.back || input.activate || input.pointerReleased) {
      this.isOpen = false;
      onClosed();
    }
  }

  public get isVisible(): boolean {
    return this.opacity > 0.001;
  }

  public draw(context: CanvasRenderingContext2D): void {
    if (!this.isVisible) {
      return;
    }
    drawDimmer(context, this.opacity * 1.15);
    context.save();
    context.globalAlpha = this.opacity;
    context.beginPath();
    context.rect(0, 140, VIRTUAL_RESOLUTION.width, 800);
    context.clip();
    context.textAlign = 'center';
    let baselineY: number = 900 - this.scrollOffset;
    CREDITS_LINES.forEach((line: string, index: number) => {
      const isHeading: boolean = index === 0 || (CREDITS_LINES[index - 1] === '' && line === line.toUpperCase() && line.length > 0);
      context.font = index === 0 ? UI_FONTS.subtitle : isHeading ? UI_FONTS.chapter : UI_FONTS.body;
      context.fillStyle = isHeading ? UI_COLORS.accentRed : UI_COLORS.textPrimary;
      context.fillText(line, VIRTUAL_RESOLUTION.width / 2, baselineY);
      baselineY += 58;
    });
    context.restore();
    context.save();
    context.globalAlpha = this.opacity * 0.7;
    context.font = UI_FONTS.small;
    context.textAlign = 'center';
    context.fillStyle = UI_COLORS.textDim;
    context.fillText('PRESS ESC OR CLICK TO RETURN', VIRTUAL_RESOLUTION.width / 2, 1010);
    context.restore();
  }
}
