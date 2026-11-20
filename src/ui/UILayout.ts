import { UI_COLORS } from '../config/GameConstants';
import type { UiCue } from '../core/AudioManager';
import { clamp, damp } from '../math/Vec3';
import type { VirtualPoint } from './UISurface';

export interface UIRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type UIInteractionState = 'idle' | 'hovered' | 'pressed' | 'disabled';

/** Per-frame input already mapped into virtual UI space. */
export interface UIFrameInput {
  readonly pointer: VirtualPoint | null;
  readonly pointerDown: boolean;
  readonly pointerPressed: boolean;
  readonly pointerReleased: boolean;
  readonly pointerMoved: boolean;
  readonly navigateUp: boolean;
  readonly navigateDown: boolean;
  readonly navigateLeft: boolean;
  readonly navigateRight: boolean;
  readonly activate: boolean;
  readonly back: boolean;
}

export function rectContains(rect: Readonly<UIRect>, point: VirtualPoint): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

export abstract class UIWidget {
  public enabled: boolean = true;
  public visible: boolean = true;
  public interaction: UIInteractionState = 'idle';
  /** Eased 0..1 hover/focus amount for animation. */
  public focusBlend: number = 0;
  /** Eased 0..1 press amount for animation. */
  public pressBlend: number = 0;
  public readonly collisionBox: UIRect = { x: 0, y: 0, width: 0, height: 0 };

  protected constructor(public readonly id: string) {}

  /** Recomputes `collisionBox` from current content (text metrics etc.). */
  public abstract layout(context: CanvasRenderingContext2D): void;
  public abstract draw(context: CanvasRenderingContext2D, timeSeconds: number): void;
  /** Click / Enter. */
  public abstract activate(): void;
  /** Left / right adjustment. Returns true if the value changed. */
  public adjust(_direction: -1 | 1): boolean {
    return false;
  }
  /** Pointer drag while pressed, in virtual coordinates. Returns true if the value changed. */
  public drag(_point: VirtualPoint): boolean {
    return false;
  }

  public containsPoint(point: VirtualPoint): boolean {
    return this.visible && rectContains(this.collisionBox, point);
  }

  public animate(deltaSeconds: number): void {
    const focused: boolean = this.interaction === 'hovered' || this.interaction === 'pressed';
    this.focusBlend = damp(this.focusBlend, focused ? 1 : 0, 14, deltaSeconds);
    this.pressBlend = damp(this.pressBlend, this.interaction === 'pressed' ? 1 : 0, 24, deltaSeconds);
  }

  public drawCollisionBox(context: CanvasRenderingContext2D): void {
    context.save();
    context.strokeStyle = UI_COLORS.collisionDebug;
    context.lineWidth = 2;
    context.setLineDash([8, 6]);
    context.strokeRect(this.collisionBox.x, this.collisionBox.y, this.collisionBox.width, this.collisionBox.height);
    context.setLineDash([]);
    context.fillStyle = UI_COLORS.collisionDebug;
    context.font = '400 16px "Courier New", monospace';
    context.fillText(`${this.id} [${this.interaction}]`, this.collisionBox.x + 4, this.collisionBox.y - 6);
    context.restore();
  }
}

export interface TextButtonStyle {
  readonly font: string;
  readonly paddingX: number;
  readonly paddingY: number;
  readonly hoverIndent: number;
  readonly align: 'left' | 'center';
}

/** Interactive text label whose collision box is derived from real glyph metrics plus padding. */
export class UITextButton extends UIWidget {
  public constructor(
    id: string,
    public label: string,
    public anchorX: number,
    public baselineY: number,
    private readonly style: TextButtonStyle,
    private readonly onActivate: () => void,
  ) {
    super(id);
  }

  public layout(context: CanvasRenderingContext2D): void {
    context.font = this.style.font;
    const metrics: TextMetrics = context.measureText(this.label);
    const ascent: number = metrics.actualBoundingBoxAscent;
    const descent: number = metrics.actualBoundingBoxDescent;
    const textWidth: number = metrics.width + this.style.hoverIndent;
    const left: number = this.style.align === 'left' ? this.anchorX : this.anchorX - metrics.width / 2;
    this.collisionBox.x = left - this.style.paddingX;
    this.collisionBox.y = this.baselineY - ascent - this.style.paddingY;
    this.collisionBox.width = textWidth + this.style.paddingX * 2;
    this.collisionBox.height = ascent + descent + this.style.paddingY * 2;
  }

  public activate(): void {
    this.onActivate();
  }

  public draw(context: CanvasRenderingContext2D, timeSeconds: number): void {
    if (!this.visible) {
      return;
    }
    context.save();
    context.font = this.style.font;
    context.textAlign = this.style.align;
    const indent: number = this.style.hoverIndent * this.focusBlend - this.pressBlend * 4;
    const x: number = this.anchorX + (this.style.align === 'left' ? indent : 0);
    if (!this.enabled) {
      context.fillStyle = this.focusBlend > 0.05 ? UI_COLORS.textDim : UI_COLORS.textDisabled;
      context.fillText(this.label, x, this.baselineY);
      context.restore();
      return;
    }
    if (this.focusBlend > 0.01) {
      // Glowing red under-layer with a faint blue ghost offset: the "misregistered tape" hover look.
      const flicker: number = 0.85 + 0.15 * Math.sin(timeSeconds * 31 + this.baselineY);
      context.globalAlpha = this.focusBlend * 0.55;
      context.fillStyle = UI_COLORS.accentBlue;
      context.fillText(this.label, x - 3, this.baselineY + 1);
      context.globalAlpha = 1;
      context.shadowColor = UI_COLORS.accentRedGlow;
      context.shadowBlur = 26 * this.focusBlend * flicker;
      context.fillStyle = UI_COLORS.accentRed;
      context.fillText(this.label, x + 2, this.baselineY);
      context.shadowBlur = 0;
      if (this.style.align === 'left') {
        // Cursor bar to the left of the label.
        context.globalAlpha = this.focusBlend;
        context.fillStyle = UI_COLORS.accentRed;
        const markerHeight: number = this.collisionBox.height - this.style.paddingY * 2;
        context.fillRect(this.anchorX - 18, this.baselineY - markerHeight * 0.82, 6, markerHeight * 0.9);
        context.globalAlpha = 1;
      }
    }
    context.fillStyle = UI_COLORS.textPrimary;
    context.globalAlpha = 1 - this.focusBlend * 0.15;
    context.fillText(this.label, x, this.baselineY);
    context.restore();
  }
}

export interface ValueRowStyle {
  readonly font: string;
  readonly labelX: number;
  readonly valueX: number;
  readonly trackWidth: number;
  readonly rowHeight: number;
}

/** Numeric slider row: label on the left, draggable track on the right. */
export class UISliderRow extends UIWidget {
  private readonly trackRect: UIRect = { x: 0, y: 0, width: 0, height: 0 };

  public constructor(
    id: string,
    public label: string,
    public baselineY: number,
    private readonly style: ValueRowStyle,
    private readonly minimum: number,
    private readonly maximum: number,
    private readonly step: number,
    private readonly readValue: () => number,
    private readonly writeValue: (value: number) => void,
    private readonly formatValue: (value: number) => string,
  ) {
    super(id);
  }

  public layout(context: CanvasRenderingContext2D): void {
    context.font = this.style.font;
    const ascent: number = context.measureText(this.label).actualBoundingBoxAscent;
    this.collisionBox.x = this.style.labelX - 24;
    this.collisionBox.y = this.baselineY - this.style.rowHeight / 2 - ascent / 2;
    this.collisionBox.width = this.style.valueX + this.style.trackWidth + 160 - this.collisionBox.x;
    this.collisionBox.height = this.style.rowHeight;
    this.trackRect.x = this.style.valueX;
    this.trackRect.y = this.baselineY - ascent / 2 - 6;
    this.trackRect.width = this.style.trackWidth;
    this.trackRect.height = 12;
  }

  public activate(): void {
    this.adjust(1);
  }

  public override adjust(direction: -1 | 1): boolean {
    const before: number = this.readValue();
    this.writeValue(clamp(before + direction * this.step, this.minimum, this.maximum));
    return this.readValue() !== before;
  }

  public override drag(point: VirtualPoint): boolean {
    const before: number = this.readValue();
    const ratio: number = clamp((point.x - this.trackRect.x) / this.trackRect.width, 0, 1);
    this.writeValue(this.minimum + ratio * (this.maximum - this.minimum));
    return this.readValue() !== before;
  }

  /** Dragging only engages when the press starts on (or near) the track. */
  public isOnTrack(point: VirtualPoint): boolean {
    return point.x >= this.trackRect.x - 20 && point.x <= this.trackRect.x + this.trackRect.width + 20;
  }

  public draw(context: CanvasRenderingContext2D, timeSeconds: number): void {
    const value: number = this.readValue();
    const ratio: number = clamp((value - this.minimum) / (this.maximum - this.minimum), 0, 1);
    context.save();
    context.font = this.style.font;
    drawRowLabel(context, this.label, this.style.labelX, this.baselineY, this.focusBlend, timeSeconds);
    context.fillStyle = 'rgba(233, 225, 207, 0.15)';
    context.fillRect(this.trackRect.x, this.trackRect.y, this.trackRect.width, this.trackRect.height);
    context.fillStyle = this.focusBlend > 0.5 ? UI_COLORS.accentRed : 'rgba(233, 225, 207, 0.7)';
    context.fillRect(this.trackRect.x, this.trackRect.y, this.trackRect.width * ratio, this.trackRect.height);
    const knobX: number = this.trackRect.x + this.trackRect.width * ratio;
    context.fillStyle = UI_COLORS.textPrimary;
    context.fillRect(knobX - 5, this.trackRect.y - 10, 10, this.trackRect.height + 20);
    context.fillStyle = UI_COLORS.textPrimary;
    context.fillText(this.formatValue(value), this.trackRect.x + this.trackRect.width + 36, this.baselineY);
    context.restore();
  }
}

/** Boolean toggle row (ON / OFF). */
export class UIToggleRow extends UIWidget {
  public constructor(
    id: string,
    public label: string,
    public baselineY: number,
    private readonly style: ValueRowStyle,
    private readonly readValue: () => boolean,
    private readonly writeValue: (value: boolean) => void,
  ) {
    super(id);
  }

  public layout(context: CanvasRenderingContext2D): void {
    context.font = this.style.font;
    const ascent: number = context.measureText(this.label).actualBoundingBoxAscent;
    this.collisionBox.x = this.style.labelX - 24;
    this.collisionBox.y = this.baselineY - this.style.rowHeight / 2 - ascent / 2;
    this.collisionBox.width = this.style.valueX + this.style.trackWidth + 160 - this.collisionBox.x;
    this.collisionBox.height = this.style.rowHeight;
  }

  public activate(): void {
    this.writeValue(!this.readValue());
  }

  public override adjust(): boolean {
    this.activate();
    return true;
  }

  public draw(context: CanvasRenderingContext2D, timeSeconds: number): void {
    context.save();
    context.font = this.style.font;
    drawRowLabel(context, this.label, this.style.labelX, this.baselineY, this.focusBlend, timeSeconds);
    const isOn: boolean = this.readValue();
    context.fillStyle = isOn ? UI_COLORS.accentRed : UI_COLORS.textDim;
    context.fillText(isOn ? '[ ON ]' : '[ OFF ]', this.style.valueX, this.baselineY);
    context.restore();
  }
}

function drawRowLabel(context: CanvasRenderingContext2D, label: string, x: number, y: number, focusBlend: number, timeSeconds: number): void {
  if (focusBlend > 0.01) {
    context.globalAlpha = focusBlend;
    context.shadowColor = UI_COLORS.accentRedGlow;
    context.shadowBlur = 20 * focusBlend * (0.85 + 0.15 * Math.sin(timeSeconds * 29));
    context.fillStyle = UI_COLORS.accentRed;
    context.fillText(label, x + 2, y);
    context.shadowBlur = 0;
    context.fillRect(x - 22, y - 30, 6, 32);
    context.globalAlpha = 1;
  }
  context.fillStyle = UI_COLORS.textPrimary;
  context.fillText(label, x + focusBlend * 10, y);
}

export interface UIFocusGroupEvents {
  readonly onCue: (cue: UiCue) => void;
  readonly onBack: (() => void) | null;
}

/**
 * Owns a vertical list of widgets and arbitrates pointer + keyboard interaction:
 *  - pointer hover sets focus; press arms the widget; release over the same widget activates it;
 *  - arrow keys / WASD move focus (skipping invisible widgets) and adjust values; Enter / Space activates;
 *  - disabled widgets can be focused but refuse activation with a "denied" cue.
 */
export class UIFocusGroup {
  public focusedIndex: number = -1;
  private armedIndex: number = -1;
  private draggingIndex: number = -1;
  public showCollisionBoxes: boolean = false;

  public constructor(public readonly widgets: UIWidget[], private readonly events: UIFocusGroupEvents) {}

  public get focusedWidget(): UIWidget | null {
    return this.widgets[this.focusedIndex] ?? null;
  }

  public layout(context: CanvasRenderingContext2D): void {
    for (const widget of this.widgets) {
      widget.layout(context);
    }
  }

  private setFocus(index: number, playCue: boolean): void {
    if (index === this.focusedIndex) {
      return;
    }
    this.focusedIndex = index;
    if (playCue && index >= 0) {
      this.events.onCue('hover');
    }
  }

  private moveFocus(direction: -1 | 1): void {
    const count: number = this.widgets.length;
    if (count === 0) {
      return;
    }
    let candidate: number = this.focusedIndex < 0 ? (direction === 1 ? -1 : 0) : this.focusedIndex;
    for (let attempt = 0; attempt < count; attempt += 1) {
      candidate = (candidate + direction + count) % count;
      const widget: UIWidget | undefined = this.widgets[candidate];
      if (widget !== undefined && widget.visible) {
        this.setFocus(candidate, true);
        return;
      }
    }
  }

  private activateWidget(widget: UIWidget): void {
    if (!widget.enabled) {
      this.events.onCue('denied');
      return;
    }
    this.events.onCue('confirm');
    widget.activate();
  }

  public update(input: UIFrameInput, deltaSeconds: number): void {
    const hoveredIndex: number = input.pointer === null ? -1 : this.widgets.findIndex((widget: UIWidget) => widget.containsPoint(input.pointer as VirtualPoint));
    if (input.pointerMoved && hoveredIndex >= 0) {
      this.setFocus(hoveredIndex, true);
    }
    if (input.pointerPressed && hoveredIndex >= 0) {
      this.armedIndex = hoveredIndex;
      const hovered: UIWidget | undefined = this.widgets[hoveredIndex];
      if (hovered instanceof UISliderRow && hovered.enabled && input.pointer !== null && hovered.isOnTrack(input.pointer)) {
        this.draggingIndex = hoveredIndex;
      }
    }
    if (this.draggingIndex >= 0 && input.pointerDown && input.pointer !== null) {
      const dragged: UIWidget | undefined = this.widgets[this.draggingIndex];
      if (dragged !== undefined && dragged.drag(input.pointer)) {
        this.events.onCue('slider');
      }
    }
    if (input.pointerReleased) {
      const armed: UIWidget | undefined = this.widgets[this.armedIndex];
      const wasDragging: boolean = this.draggingIndex >= 0;
      if (armed !== undefined && this.armedIndex === hoveredIndex && !wasDragging) {
        this.activateWidget(armed);
      }
      this.armedIndex = -1;
      this.draggingIndex = -1;
    }

    if (input.navigateDown) {
      this.moveFocus(1);
    } else if (input.navigateUp) {
      this.moveFocus(-1);
    }
    const focused: UIWidget | null = this.focusedWidget;
    if (focused !== null && (input.navigateLeft || input.navigateRight)) {
      if (focused.enabled && focused.adjust(input.navigateLeft ? -1 : 1)) {
        this.events.onCue('slider');
      }
    }
    if (input.activate) {
      if (focused !== null) {
        this.activateWidget(focused);
      } else {
        this.moveFocus(1);
      }
    }
    if (input.back && this.events.onBack !== null) {
      this.events.onCue('back');
      this.events.onBack();
    }

    this.widgets.forEach((widget: UIWidget, index: number) => {
      if (!widget.enabled) {
        widget.interaction = index === this.focusedIndex ? 'hovered' : 'disabled';
      } else if (index === this.armedIndex && index === hoveredIndex && input.pointerDown) {
        widget.interaction = 'pressed';
      } else if (index === this.focusedIndex) {
        widget.interaction = 'hovered';
      } else {
        widget.interaction = 'idle';
      }
      widget.animate(deltaSeconds);
    });
  }

  public draw(context: CanvasRenderingContext2D, timeSeconds: number): void {
    for (const widget of this.widgets) {
      widget.draw(context, timeSeconds);
    }
    if (this.showCollisionBoxes) {
      for (const widget of this.widgets) {
        widget.drawCollisionBox(context);
      }
    }
  }

  public resetInteraction(): void {
    this.armedIndex = -1;
    this.draggingIndex = -1;
  }
}
