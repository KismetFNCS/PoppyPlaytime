import { UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../config/GameConstants';
import type { UiCue } from '../core/AudioManager';
import type { NumericSettingKey, SettingsStore } from '../core/PersistentStores';
import { NUMERIC_SETTING_RANGES } from '../core/PersistentStores';
import { clamp } from '../math/Vec3';
import { ConfirmDialog } from './ModalPanels';
import type { UIFrameInput, UIWidget, ValueRowStyle } from './UILayout';
import { UIFocusGroup, UISliderRow, UITextButton, UIToggleRow } from './UILayout';

export interface PauseMenuActions {
  readonly resume: () => void;
  /** Returns a short status string for the save result (e.g. "GAME SAVED"). */
  readonly saveGame: () => string;
  readonly restartFromCheckpoint: () => void;
  readonly saveAndQuit: () => void;
}

type PausePage = 'root' | 'settings';

const ROOT_BUTTON_STYLE = { font: UI_FONTS.menuButton, paddingX: 22, paddingY: 12, hoverIndent: 24, align: 'left' } as const;
const SETTINGS_ROW_STYLE: ValueRowStyle = { font: UI_FONTS.settingsRow, labelX: 300, valueX: 960, trackWidth: 460, rowHeight: 60 };
const ROOT_FIRST_BASELINE: number = 430;
const ROOT_SPACING: number = 80;
const SETTINGS_FIRST_BASELINE: number = 320;
const SETTINGS_SPACING: number = 70;

interface PauseSliderDefinition {
  readonly key: NumericSettingKey;
  readonly label: string;
  readonly format: (value: number) => string;
}

const PAUSE_SLIDERS: readonly PauseSliderDefinition[] = [
  { key: 'masterVolume', label: 'MASTER VOLUME', format: (value: number) => `${Math.round(value * 100)}%` },
  { key: 'brightness', label: 'BRIGHTNESS', format: (value: number) => value.toFixed(2) },
  { key: 'mouseSensitivity', label: 'LOOK SENSITIVITY', format: (value: number) => value.toFixed(1) },
  { key: 'fieldOfViewDegrees', label: 'FIELD OF VIEW', format: (value: number) => `${Math.round(value)}°` },
  { key: 'crtEffectIntensity', label: 'CRT / VHS EFFECT', format: (value: number) => `${Math.round(value * 100)}%` },
];

/**
 * In-level pause overlay with a root page and a live-applied settings sub-page.
 * The level state freezes simulation while `isOpen`.
 */
export class PauseMenu {
  public isOpen: boolean = false;
  private page: PausePage = 'root';
  private opacity: number = 0;
  private statusText: string = '';
  private statusSeconds: number = 0;
  private readonly rootGroup: UIFocusGroup;
  private readonly settingsGroup: UIFocusGroup;
  private readonly confirm: ConfirmDialog;
  private closeRequested: boolean = false;

  public constructor(settings: SettingsStore, private readonly actions: PauseMenuActions, private readonly onCue: (cue: UiCue) => void) {
    const x: number = 300;
    const rootButtons: UITextButton[] = [
      new UITextButton('pause.resume', 'RESUME', x, ROOT_FIRST_BASELINE, ROOT_BUTTON_STYLE, () => (this.closeRequested = true)),
      new UITextButton('pause.save', 'SAVE GAME', x, ROOT_FIRST_BASELINE + ROOT_SPACING, ROOT_BUTTON_STYLE, () => this.flashStatus(this.actions.saveGame())),
      new UITextButton('pause.settings', 'SETTINGS', x, ROOT_FIRST_BASELINE + ROOT_SPACING * 2, ROOT_BUTTON_STYLE, () => this.openPage('settings')),
      new UITextButton('pause.restart', 'RESTART FROM CHECKPOINT', x, ROOT_FIRST_BASELINE + ROOT_SPACING * 3, ROOT_BUTTON_STYLE, () =>
        this.confirm.open('LOSE PROGRESS SINCE THE LAST CHECKPOINT?', 'RESTART', 'CANCEL', () => this.actions.restartFromCheckpoint()),
      ),
      new UITextButton('pause.quit', 'SAVE & QUIT TO TITLE', x, ROOT_FIRST_BASELINE + ROOT_SPACING * 4, ROOT_BUTTON_STYLE, () => this.actions.saveAndQuit()),
    ];
    this.rootGroup = new UIFocusGroup(rootButtons, { onCue, onBack: () => (this.closeRequested = true) });

    const settingsWidgets: UIWidget[] = PAUSE_SLIDERS.map((definition: PauseSliderDefinition, index: number) => {
      const range = NUMERIC_SETTING_RANGES[definition.key];
      return new UISliderRow(
        `pause.settings.${definition.key}`,
        definition.label,
        SETTINGS_FIRST_BASELINE + index * SETTINGS_SPACING,
        SETTINGS_ROW_STYLE,
        range.minimum,
        range.maximum,
        range.step,
        () => settings.values[definition.key],
        (value: number) => settings.setNumeric(definition.key, value),
        definition.format,
      );
    });
    settingsWidgets.push(
      new UIToggleRow(
        'pause.settings.invertLookY',
        'INVERT LOOK Y',
        SETTINGS_FIRST_BASELINE + PAUSE_SLIDERS.length * SETTINGS_SPACING,
        SETTINGS_ROW_STYLE,
        () => settings.values.invertLookY,
        (value: boolean) => settings.setBoolean('invertLookY', value),
      ),
      new UITextButton('pause.settings.back', 'BACK', SETTINGS_ROW_STYLE.labelX, SETTINGS_FIRST_BASELINE + (PAUSE_SLIDERS.length + 1) * SETTINGS_SPACING + 30, { ...ROOT_BUTTON_STYLE, font: UI_FONTS.settingsRow }, () => this.openPage('root')),
    );
    this.settingsGroup = new UIFocusGroup(settingsWidgets, { onCue, onBack: () => this.openPage('root') });
    this.confirm = new ConfirmDialog(onCue);
  }

  private openPage(page: PausePage): void {
    this.page = page;
    const group: UIFocusGroup = page === 'root' ? this.rootGroup : this.settingsGroup;
    group.focusedIndex = 0;
    group.resetInteraction();
  }

  private flashStatus(text: string): void {
    this.statusText = text;
    this.statusSeconds = 2.5;
  }

  public open(): void {
    if (this.isOpen) {
      return;
    }
    this.isOpen = true;
    this.closeRequested = false;
    this.openPage('root');
    this.onCue('back');
  }

  public close(): void {
    this.isOpen = false;
    this.confirm.close();
  }

  public set showCollisionBoxes(value: boolean) {
    this.rootGroup.showCollisionBoxes = value;
    this.settingsGroup.showCollisionBoxes = value;
    this.confirm.showCollisionBoxes = value;
  }

  /** Returns true on the frame the menu asks to resume. */
  public update(context: CanvasRenderingContext2D, input: UIFrameInput, deltaSeconds: number): boolean {
    this.opacity = clamp(this.opacity + (this.isOpen ? deltaSeconds * 8 : -deltaSeconds * 8), 0, 1);
    this.statusSeconds = Math.max(0, this.statusSeconds - deltaSeconds);
    if (!this.isOpen) {
      return false;
    }
    if (this.confirm.isOpen) {
      this.confirm.update(context, input, deltaSeconds);
      return false;
    }
    this.confirm.update(context, input, deltaSeconds);
    const group: UIFocusGroup = this.page === 'root' ? this.rootGroup : this.settingsGroup;
    group.layout(context);
    group.update(input, deltaSeconds);
    if (this.closeRequested) {
      this.closeRequested = false;
      this.close();
      this.actions.resume();
      return true;
    }
    return false;
  }

  public draw(context: CanvasRenderingContext2D, timeSeconds: number): void {
    if (this.opacity <= 0.001) {
      return;
    }
    const width: number = VIRTUAL_RESOLUTION.width;
    const height: number = VIRTUAL_RESOLUTION.height;
    context.save();
    context.globalAlpha = this.opacity;
    context.fillStyle = 'rgba(0, 0, 0, 0.72)';
    context.fillRect(0, 0, width, height);
    context.font = UI_FONTS.subtitle;
    context.fillStyle = UI_COLORS.accentRed;
    context.fillText(this.page === 'root' ? 'PAUSED' : 'SETTINGS', 300, 250);
    context.globalAlpha = this.opacity * 0.5;
    context.fillStyle = UI_COLORS.textPrimary;
    context.fillRect(300, 272, 1320, 3);
    context.globalAlpha = this.opacity;
    (this.page === 'root' ? this.rootGroup : this.settingsGroup).draw(context, timeSeconds);
    if (this.statusSeconds > 0) {
      context.globalAlpha = this.opacity * clamp(this.statusSeconds, 0, 1);
      context.font = UI_FONTS.chapter;
      context.fillStyle = '#8fd18a';
      context.fillText(this.statusText, 300, height - 120);
    }
    context.globalAlpha = this.opacity * 0.7;
    context.font = UI_FONTS.small;
    context.fillStyle = UI_COLORS.textDim;
    context.fillText('↑↓ SELECT · ENTER CONFIRM · ←→ ADJUST · ESC BACK', 300, height - 60);
    context.restore();
    this.confirm.draw(context, timeSeconds);
  }
}
