import { UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../config/GameConstants';
import type { GameServices } from '../core/GameServices';
import type { FrameContext, FrameRenderRequest, GameStateHandler, GameStatePayloadMap } from '../core/GameStateTypes';
import { GameStateId } from '../core/GameStateTypes';
import type { NumericSettingKey } from '../core/PersistentStores';
import { NUMERIC_SETTING_RANGES } from '../core/PersistentStores';
import type { UIFrameInput, UIWidget, ValueRowStyle } from '../ui/UILayout';
import { UIFocusGroup, UISliderRow, UITextButton, UIToggleRow } from '../ui/UILayout';
import { buildUiFrameInput } from '../ui/UIInputAdapter';
import type { MenuBackdropScene } from '../world/MenuBackdropScene';
import { MENU_ENVIRONMENT } from '../world/MenuBackdropScene';

const ROW_STYLE: ValueRowStyle = {
  font: UI_FONTS.settingsRow,
  labelX: 240,
  valueX: 940,
  trackWidth: 520,
  rowHeight: 62,
};
const FIRST_ROW_BASELINE: number = 268;
const ROW_SPACING: number = 72;

interface SliderDefinition {
  readonly key: NumericSettingKey;
  readonly label: string;
  readonly format: (value: number) => string;
}

const SLIDER_DEFINITIONS: readonly SliderDefinition[] = [
  { key: 'masterVolume', label: 'MASTER VOLUME', format: (value: number) => `${Math.round(value * 100)}%` },
  { key: 'brightness', label: 'BRIGHTNESS', format: (value: number) => value.toFixed(2) },
  { key: 'fogDensityScale', label: 'FOG DENSITY', format: (value: number) => `${Math.round(value * 100)}%` },
  { key: 'crtEffectIntensity', label: 'CRT / VHS EFFECT', format: (value: number) => `${Math.round(value * 100)}%` },
  { key: 'mouseSensitivity', label: 'LOOK SENSITIVITY', format: (value: number) => value.toFixed(1) },
  { key: 'fieldOfViewDegrees', label: 'FIELD OF VIEW', format: (value: number) => `${Math.round(value)}°` },
  { key: 'renderScale', label: 'RENDER SCALE', format: (value: number) => `${Math.round(value * 100)}%` },
];

/** Settings Menu: live-applied, persisted sliders and toggles over the shared 3D backdrop. */
export class SettingsMenuState implements GameStateHandler<GameStateId.SettingsMenu> {
  public readonly id = GameStateId.SettingsMenu;
  private readonly focusGroup: UIFocusGroup;
  private returnTo: GameStateId.TitleScreen = GameStateId.TitleScreen;
  private backRequested: boolean = false;

  public constructor(private readonly services: GameServices, private readonly backdrop: MenuBackdropScene) {
    const settings = services.settings;
    const widgets: UIWidget[] = SLIDER_DEFINITIONS.map((definition: SliderDefinition, index: number) => {
      const range = NUMERIC_SETTING_RANGES[definition.key];
      return new UISliderRow(
        `settings.${definition.key}`,
        definition.label,
        FIRST_ROW_BASELINE + index * ROW_SPACING,
        ROW_STYLE,
        range.minimum,
        range.maximum,
        range.step,
        () => settings.values[definition.key],
        (value: number) => settings.setNumeric(definition.key, value),
        definition.format,
      );
    });
    widgets.push(
      new UIToggleRow(
        'settings.invertLookY',
        'INVERT LOOK Y',
        FIRST_ROW_BASELINE + SLIDER_DEFINITIONS.length * ROW_SPACING,
        ROW_STYLE,
        () => settings.values.invertLookY,
        (value: boolean) => settings.setBoolean('invertLookY', value),
      ),
    );
    const buttonBaseline: number = FIRST_ROW_BASELINE + (SLIDER_DEFINITIONS.length + 1) * ROW_SPACING + 40;
    const buttonStyle = { font: UI_FONTS.settingsRow, paddingX: 20, paddingY: 12, hoverIndent: 18, align: 'left' } as const;
    widgets.push(new UITextButton('settings.reset', 'RESET DEFAULTS', ROW_STYLE.labelX, buttonBaseline, buttonStyle, () => settings.resetToDefaults()));
    widgets.push(new UITextButton('settings.back', 'BACK', ROW_STYLE.labelX + 520, buttonBaseline, buttonStyle, () => (this.backRequested = true)));
    this.focusGroup = new UIFocusGroup(widgets, {
      onCue: (cue) => services.audio.playUiCue(cue),
      onBack: () => (this.backRequested = true),
    });
  }

  public enter(payload: GameStatePayloadMap[GameStateId.SettingsMenu]): void {
    this.returnTo = payload.returnTo;
    this.backRequested = false;
    this.backdrop.ensureLoaded();
    this.focusGroup.focusedIndex = 0;
    this.focusGroup.resetInteraction();
  }

  public exit(): void {
    this.focusGroup.resetInteraction();
  }

  public update(frame: FrameContext): void {
    this.backdrop.update(frame.deltaSeconds);
    const input: UIFrameInput = buildUiFrameInput(this.services, frame.inputEnabled);
    this.focusGroup.showCollisionBoxes = this.services.lifecycle.showCollisionBoxes;
    this.focusGroup.layout(this.services.ui.context);
    this.focusGroup.update(input, frame.deltaSeconds);
    if (this.backRequested) {
      this.backRequested = false;
      this.services.lifecycle.requestTransition({ target: this.returnTo, payload: { reason: 'returnFromSettings' } });
    }
  }

  public render(frame: FrameContext, request: FrameRenderRequest, context: CanvasRenderingContext2D): void {
    request.renderScene = true;
    request.environment = MENU_ENVIRONMENT;
    this.backdrop.collectDrawItems(request.drawItems);
    context.fillStyle = 'rgba(0, 0, 0, 0.66)';
    context.fillRect(0, 0, VIRTUAL_RESOLUTION.width, VIRTUAL_RESOLUTION.height);
    context.font = UI_FONTS.subtitle;
    context.fillStyle = UI_COLORS.accentRed;
    context.fillText('SETTINGS', ROW_STYLE.labelX, 150);
    context.fillStyle = UI_COLORS.textPrimary;
    context.globalAlpha = 0.5;
    context.fillRect(ROW_STYLE.labelX, 172, 1420, 3);
    context.globalAlpha = 1;
    this.focusGroup.draw(context, frame.elapsedSeconds);
    context.font = UI_FONTS.small;
    context.fillStyle = UI_COLORS.textDim;
    context.fillText('↑↓ SELECT   ←→ ADJUST   ENTER TOGGLE   ESC BACK   F2 COLLISION BOXES', ROW_STYLE.labelX, 1030);
  }
}
