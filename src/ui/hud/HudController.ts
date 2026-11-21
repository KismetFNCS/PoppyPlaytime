import { UI_COLORS, UI_FONTS, VIRTUAL_RESOLUTION } from '../../config/GameConstants';
import type { BreathingAreaStatus, MaskPhase } from '../../gameplay/GasMaskSystem';
import type { ClawPhase } from '../../gameplay/TetherRig';
import { clamp, smoothstep } from '../../math/Vec3';
import type { Polarity } from '../../world/LevelStreamer';
import { GasMaskOverlay } from '../GasMaskOverlay';
import type { UIRect } from '../UILayout';
import { rectContains } from '../UILayout';
import type { VirtualPoint } from '../UISurface';

export type CrosshairKind = 'none' | 'surface' | 'anchor' | 'relayPlate';

export interface CrosshairSnapshot {
  readonly kind: CrosshairKind;
  readonly polarity: Polarity | null;
  readonly distance: number;
  readonly interactionPrompt: string | null;
}

export interface StatusSnapshot {
  readonly depthMeters: number;
  readonly stanceLabel: string;
  readonly airborne: boolean;
  readonly playTimeSeconds: number;
  readonly checkpointIndex: number;
  readonly stamina: number;
}

export interface ClawSnapshot {
  readonly polarity: Polarity;
  readonly phase: ClawPhase;
  readonly binding: string;
  /** Overrides the polarity name/colour (swappable right hands). */
  readonly label?: string;
  readonly color?: string;
  /** Replaces the phase word (e.g. RECHARGING). */
  readonly status?: string;
}

export interface ToxicitySnapshot {
  readonly exposure: number;
  readonly concentration: number;
  readonly areaStatus: BreathingAreaStatus;
  readonly maskAvailable: boolean;
  readonly maskPhase: MaskPhase;
  readonly filterRemaining: number;
  readonly flash: number;
}

export interface HotbarSlotSnapshot {
  readonly label: string;
  readonly keyHint: string;
  /** Stack count, or null for non-stacking slots. */
  readonly count: number | null;
  readonly available: boolean;
  readonly statusText: string;
  readonly accentColor: string;
}

export interface MaskOverlaySnapshot {
  readonly coverage: number;
  readonly lensFog: number;
  readonly filterStrain: number;
}

/** Pure per-frame data the HUD renders from; built by the level state. */
export interface HudSnapshot {
  readonly crosshair: CrosshairSnapshot;
  readonly status: StatusSnapshot;
  readonly claws: readonly [ClawSnapshot, ClawSnapshot];
  readonly toxicity: ToxicitySnapshot;
  readonly hotbar: { readonly slots: readonly HotbarSlotSnapshot[]; readonly selectedSlot: number };
  readonly mask: MaskOverlaySnapshot;
  readonly toast: { readonly text: string; readonly color: string; readonly alpha: number } | null;
  readonly dread: number;
  readonly letterbox: number;
  /** Cassette indicator shown while saving / after loading (alpha fades it). */
  readonly saveIndicator?: { readonly label: string; readonly alpha: number };
  readonly pointerLocked: boolean;
  readonly timeSeconds: number;
}

export const POLARITY_HUD_COLORS: Readonly<Record<Polarity, string>> = { teal: '#2fe3cc', rose: '#ff5c8f' };
const CLAW_PHASE_LABELS: Readonly<Record<ClawPhase, string>> = { holstered: 'READY', extending: 'OUT', latched: 'LOCKED', retracting: 'REEL' };
const HOTBAR_SLOT_SIZE: number = 104;
const HOTBAR_SLOT_GAP: number = 12;
const HOTBAR_TOP: number = VIRTUAL_RESOLUTION.height - 168;
const LETTERBOX_HEIGHT: number = 96;

/**
 * Master in-level HUD renderer. Stateless apart from the cached gas-mask overlay; owns hotbar hit-testing
 * so slots are clickable whenever the cursor is free.
 */
export class HudController {
  private readonly maskOverlay: GasMaskOverlay = new GasMaskOverlay();
  private readonly hotbarRects: UIRect[] = [];

  /** Hotbar slot under a virtual-space point, or -1. */
  public hotbarSlotAt(point: VirtualPoint | null): number {
    if (point === null) {
      return -1;
    }
    return this.hotbarRects.findIndex((rect: UIRect) => rectContains(rect, point));
  }

  private layoutHotbar(slotCount: number): void {
    const totalWidth: number = slotCount * HOTBAR_SLOT_SIZE + (slotCount - 1) * HOTBAR_SLOT_GAP;
    const left: number = (VIRTUAL_RESOLUTION.width - totalWidth) / 2;
    this.hotbarRects.length = 0;
    for (let slot = 0; slot < slotCount; slot += 1) {
      this.hotbarRects.push({ x: left + slot * (HOTBAR_SLOT_SIZE + HOTBAR_SLOT_GAP), y: HOTBAR_TOP, width: HOTBAR_SLOT_SIZE, height: HOTBAR_SLOT_SIZE });
    }
  }

  // ---- Widgets -----------------------------------------------------------------------------------------------

  private drawCrosshair(context: CanvasRenderingContext2D, crosshair: CrosshairSnapshot): void {
    const centerX: number = VIRTUAL_RESOLUTION.width / 2;
    const centerY: number = VIRTUAL_RESOLUTION.height / 2;
    context.save();
    context.font = UI_FONTS.small;
    context.textAlign = 'center';
    if (crosshair.kind === 'anchor') {
      context.strokeStyle = '#6fa0ff';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(centerX, centerY, 18, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = '#6fa0ff';
      context.fillText(`ANCHOR · ${crosshair.distance.toFixed(1)} M`, centerX, centerY + 50);
    } else if (crosshair.kind === 'relayPlate' && crosshair.polarity !== null) {
      const color: string = POLARITY_HUD_COLORS[crosshair.polarity];
      context.strokeStyle = color;
      context.lineWidth = 3;
      for (let bracket = 0; bracket < 4; bracket += 1) {
        const angle: number = (bracket / 4) * Math.PI * 2 + Math.PI / 4;
        context.beginPath();
        context.arc(centerX, centerY, 20, angle - 0.4, angle + 0.4);
        context.stroke();
      }
      context.fillStyle = color;
      context.fillText(`${crosshair.polarity.toUpperCase()} RELAY`, centerX, centerY + 50);
    } else {
      // Dot grows slightly when something solid is within tether range.
      const radius: number = crosshair.kind === 'surface' ? 2.5 : 2;
      context.fillStyle = 'rgba(233, 225, 207, 0.55)';
      context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
    }
    if (crosshair.interactionPrompt !== null) {
      context.font = UI_FONTS.chapter;
      context.fillStyle = UI_COLORS.textPrimary;
      context.fillText(crosshair.interactionPrompt, centerX, centerY + 90);
    }
    context.restore();
  }

  private drawStatus(context: CanvasRenderingContext2D, status: StatusSnapshot, timeSeconds: number): void {
    const width: number = VIRTUAL_RESOLUTION.width;
    const height: number = VIRTUAL_RESOLUTION.height;
    context.save();
    context.font = UI_FONTS.small;
    if (Math.floor(timeSeconds * 1.5) % 2 === 0) {
      context.fillStyle = UI_COLORS.accentRed;
      context.beginPath();
      context.arc(96, 86, 10, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = UI_COLORS.textPrimary;
    context.fillText('REC', 116, 94);
    context.fillText(`DEPTH  -${status.depthMeters.toFixed(1)} M`, 80, 136);
    context.fillText(`STANCE ${status.stanceLabel}${status.airborne ? ' · AIRBORNE' : ''}`, 80, 172);
    const totalSeconds: number = Math.floor(status.playTimeSeconds);
    const clock: string = `${String(Math.floor(totalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
    context.textAlign = 'right';
    context.fillText(`SHIFT ${clock}`, width - 80, 94);
    context.fillText(`CHECKPOINT ${String(status.checkpointIndex).padStart(3, '0')}`, width - 80, 136);
    context.textAlign = 'left';
    context.fillStyle = 'rgba(233, 225, 207, 0.12)';
    context.fillRect(80, height - 90, 360, 10);
    context.fillStyle = status.stamina < 0.3 ? UI_COLORS.accentRed : 'rgba(233, 225, 207, 0.7)';
    context.fillRect(80, height - 90, 360 * clamp(status.stamina, 0, 1), 10);
    context.fillStyle = UI_COLORS.textDim;
    context.fillText('STAMINA', 80, height - 104);
    context.restore();
  }

  /** Little tape cassette with turning reels beside the REC light: the game is writing (or has just read) your shift. */
  private drawCassette(context: CanvasRenderingContext2D, indicator: { readonly label: string; readonly alpha: number }, timeSeconds: number): void {
    const x = 188;
    const y = 56;
    const w = 84;
    const h = 50;
    context.save();
    context.globalAlpha *= indicator.alpha;
    context.strokeStyle = UI_COLORS.textPrimary;
    context.fillStyle = 'rgba(0, 0, 0, 0.45)';
    context.lineWidth = 3;
    context.fillRect(x, y, w, h);
    context.strokeRect(x, y, w, h);
    // Label window and tape window.
    context.lineWidth = 2;
    context.strokeRect(x + 10, y + 8, w - 20, 12);
    context.strokeRect(x + 16, y + 24, w - 32, 18);
    // Reels: hubs with three spokes, turning.
    for (const reelX of [x + 29, x + w - 29]) {
      context.beginPath();
      context.arc(reelX, y + 33, 7, 0, Math.PI * 2);
      context.stroke();
      for (let spoke = 0; spoke < 3; spoke += 1) {
        const angle: number = timeSeconds * 6 + (spoke * Math.PI * 2) / 3;
        context.beginPath();
        context.moveTo(reelX, y + 33);
        context.lineTo(reelX + Math.cos(angle) * 6, y + 33 + Math.sin(angle) * 6);
        context.stroke();
      }
    }
    context.fillStyle = UI_COLORS.textPrimary;
    context.font = UI_FONTS.small;
    context.fillText(indicator.label, x + w + 14, y + 36);
    context.restore();
  }

  private drawClaws(context: CanvasRenderingContext2D, claws: readonly [ClawSnapshot, ClawSnapshot]): void {
    const width: number = VIRTUAL_RESOLUTION.width;
    const height: number = VIRTUAL_RESOLUTION.height;
    context.save();
    context.font = UI_FONTS.small;
    claws.forEach((claw: ClawSnapshot, index: number) => {
      const x: number = width / 2 + (index === 0 ? -330 : 30);
      const y: number = height - 52;
      context.globalAlpha = claw.phase === 'holstered' ? 0.85 : 1;
      context.fillStyle = 'rgba(0, 0, 0, 0.45)';
      context.fillRect(x, y, 300, 36);
      context.fillStyle = claw.color ?? POLARITY_HUD_COLORS[claw.polarity];
      context.fillRect(x, y, 8, 36);
      context.fillText(`${claw.label ?? claw.polarity.toUpperCase()} ${claw.status ?? CLAW_PHASE_LABELS[claw.phase]}`, x + 18, y + 25);
      context.fillStyle = UI_COLORS.textDim;
      context.textAlign = 'right';
      context.fillText(claw.binding, x + 292, y + 25);
      context.textAlign = 'left';
    });
    context.restore();
  }

  /** Toxicity survival meter: 24 segments green→amber→red, the leading segment flashes on each tick. */
  private drawToxicity(context: CanvasRenderingContext2D, toxicity: ToxicitySnapshot): void {
    const showMeter: boolean = toxicity.exposure > 0.001 || toxicity.concentration > 0.01 || toxicity.maskAvailable;
    if (!showMeter) {
      return;
    }
    const panelX: number = VIRTUAL_RESOLUTION.width - 600;
    const panelY: number = VIRTUAL_RESOLUTION.height - 230;
    const segments = 24;
    const segmentWidth = 19;
    context.save();
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    context.fillRect(panelX - 16, panelY - 44, 536, 150);
    context.font = UI_FONTS.small;
    context.fillStyle = UI_COLORS.textPrimary;
    context.fillText('TOXICITY', panelX, panelY - 14);
    const statusLabels: Readonly<Record<BreathingAreaStatus, [string, string]>> = {
      clean: ['CLEAN AIR', '#8fd18a'],
      filtered: ['FILTERED AIR', '#e9c46a'],
      contaminated: ['CONTAMINATED', UI_COLORS.accentRed],
    };
    const [statusText, statusColor] = statusLabels[toxicity.areaStatus];
    context.textAlign = 'right';
    context.fillStyle = statusColor;
    context.fillText(statusText, panelX + 504, panelY - 14);
    context.textAlign = 'left';
    const filled: number = Math.ceil(toxicity.exposure * segments);
    for (let segment = 0; segment < segments; segment += 1) {
      const ratio: number = segment / (segments - 1);
      const red: number = Math.round(clamp(ratio * 2, 0, 1) * 220);
      const green: number = Math.round(clamp(2 - ratio * 2, 0, 1) * 200);
      const lit: boolean = segment < filled;
      context.fillStyle = lit ? `rgb(${red}, ${green}, 40)` : 'rgba(233, 225, 207, 0.1)';
      if (lit && segment === filled - 1 && toxicity.flash > 0.5) {
        context.fillStyle = '#ffffff';
      }
      context.fillRect(panelX + segment * (segmentWidth + 2), panelY, segmentWidth, 28);
    }
    context.fillStyle = UI_COLORS.textDim;
    if (toxicity.maskAvailable) {
      context.fillText(`FILTER ${Math.round(toxicity.filterRemaining * 100)}%`, panelX, panelY + 62);
      const maskStates: Readonly<Record<MaskPhase, string>> = {
        unavailable: '',
        stowed: '[G] EQUIP MASK',
        equipping: 'SEALING…',
        worn: '[G] REMOVE MASK',
        unequipping: 'REMOVING…',
      };
      context.textAlign = 'right';
      context.fillText(maskStates[toxicity.maskPhase], panelX + 504, panelY + 62);
      context.textAlign = 'left';
      context.fillStyle = 'rgba(233, 225, 207, 0.12)';
      context.fillRect(panelX, panelY + 74, 504, 6);
      context.fillStyle = toxicity.filterRemaining < 0.25 ? UI_COLORS.accentRed : '#8fd18a';
      context.fillRect(panelX, panelY + 74, 504 * toxicity.filterRemaining, 6);
    } else if (toxicity.concentration > 0.01) {
      context.fillStyle = UI_COLORS.accentRed;
      context.fillText('NO RESPIRATOR · LEAVE THE GAS', panelX, panelY + 62);
    }
    context.restore();
  }

  /** Item hotbar: numbered slots, selection frame, stack counts, availability dimming, status line. */
  private drawHotbar(context: CanvasRenderingContext2D, hotbar: HudSnapshot['hotbar'], timeSeconds: number): void {
    this.layoutHotbar(hotbar.slots.length);
    context.save();
    hotbar.slots.forEach((slot: HotbarSlotSnapshot, index: number) => {
      const rect: UIRect = this.hotbarRects[index] as UIRect;
      const selected: boolean = index === hotbar.selectedSlot;
      context.globalAlpha = slot.available ? 1 : 0.45;
      context.fillStyle = selected ? 'rgba(30, 10, 12, 0.78)' : 'rgba(0, 0, 0, 0.55)';
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.lineWidth = selected ? 3 : 1.5;
      context.strokeStyle = selected ? UI_COLORS.accentRed : 'rgba(233, 225, 207, 0.25)';
      if (selected) {
        context.shadowColor = UI_COLORS.accentRedGlow;
        context.shadowBlur = 12 + 4 * Math.sin(timeSeconds * 4);
      }
      context.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
      context.shadowBlur = 0;
      context.fillStyle = slot.accentColor;
      context.fillRect(rect.x + 8, rect.y + rect.height - 14, rect.width - 16, 5);
      context.font = UI_FONTS.small;
      context.fillStyle = UI_COLORS.textDim;
      context.fillText(slot.keyHint, rect.x + 8, rect.y + 22);
      context.textAlign = 'center';
      context.fillStyle = UI_COLORS.textPrimary;
      context.fillText(slot.label, rect.x + rect.width / 2, rect.y + 58);
      if (slot.count !== null) {
        context.textAlign = 'right';
        context.fillText(`×${slot.count}`, rect.x + rect.width - 8, rect.y + 22);
      }
      context.textAlign = 'left';
    });
    const selectedSlot: HotbarSlotSnapshot | undefined = hotbar.slots[hotbar.selectedSlot];
    if (selectedSlot !== undefined) {
      context.globalAlpha = 1;
      context.font = UI_FONTS.small;
      context.textAlign = 'center';
      context.fillStyle = UI_COLORS.textDim;
      context.fillText(`${selectedSlot.statusText} · [F] USE`, VIRTUAL_RESOLUTION.width / 2, HOTBAR_TOP - 14);
    }
    context.restore();
  }

  private drawAtmosphere(context: CanvasRenderingContext2D, snapshot: HudSnapshot): void {
    const width: number = VIRTUAL_RESOLUTION.width;
    const height: number = VIRTUAL_RESOLUTION.height;
    if (snapshot.dread > 0.01) {
      const gradient: CanvasGradient = context.createRadialGradient(width / 2, height / 2, height * 0.25, width / 2, height / 2, height * 0.85);
      gradient.addColorStop(0, 'rgba(120, 0, 0, 0)');
      gradient.addColorStop(1, `rgba(120, 0, 0, ${(snapshot.dread * 0.55).toFixed(3)})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
    }
    const exposure: number = snapshot.toxicity.exposure;
    if (exposure > 0.35) {
      const pulse: number = 0.5 + 0.5 * Math.sin(snapshot.timeSeconds * (2 + exposure * 6));
      const strength: number = smoothstep(0.35, 1, exposure) * (0.35 + pulse * 0.25);
      const sick: CanvasGradient = context.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.9);
      sick.addColorStop(0, 'rgba(60, 90, 10, 0)');
      sick.addColorStop(1, `rgba(60, 90, 10, ${strength.toFixed(3)})`);
      context.fillStyle = sick;
      context.fillRect(0, 0, width, height);
    }
  }

  // ---- Frame ----------------------------------------------------------------------------------------------------

  public draw(context: CanvasRenderingContext2D, snapshot: HudSnapshot): void {
    const width: number = VIRTUAL_RESOLUTION.width;
    const height: number = VIRTUAL_RESOLUTION.height;
    this.maskOverlay.draw(context, { ...snapshot.mask, timeSeconds: snapshot.timeSeconds });
    const hudAlpha: number = 1 - snapshot.letterbox;
    // The save cassette stays visible even when the rest of the HUD is hidden for a scene.
    if (snapshot.saveIndicator !== undefined && snapshot.saveIndicator.alpha > 0.01) {
      this.drawCassette(context, snapshot.saveIndicator, snapshot.timeSeconds);
    }
    if (hudAlpha > 0.01) {
      context.save();
      context.globalAlpha = hudAlpha;
      this.drawCrosshair(context, snapshot.crosshair);
      this.drawStatus(context, snapshot.status, snapshot.timeSeconds);
      this.drawClaws(context, snapshot.claws);
      this.drawToxicity(context, snapshot.toxicity);
      this.drawHotbar(context, snapshot.hotbar, snapshot.timeSeconds);
      if (!snapshot.pointerLocked) {
        context.font = UI_FONTS.small;
        context.textAlign = 'center';
        context.fillStyle = UI_COLORS.textDim;
        context.fillText('CLICK TO LOOK · 1–4 SELECT · F USE · P / ESC PAUSE · F5 QUICKSAVE', width / 2, 40);
      }
      context.restore();
    } else {
      this.hotbarRects.length = 0;
    }
    if (snapshot.toast !== null && snapshot.toast.alpha > 0.01) {
      context.save();
      context.globalAlpha = snapshot.toast.alpha;
      context.font = UI_FONTS.chapter;
      context.textAlign = 'center';
      context.fillStyle = snapshot.toast.color;
      context.shadowColor = UI_COLORS.accentRedGlow;
      context.shadowBlur = 18;
      context.fillText(snapshot.toast.text, width / 2, height * 0.7);
      context.restore();
    }
    this.drawAtmosphere(context, snapshot);
    if (snapshot.letterbox > 0.001) {
      const barHeight: number = LETTERBOX_HEIGHT * snapshot.letterbox;
      context.fillStyle = '#000000';
      context.fillRect(0, 0, width, barHeight);
      context.fillRect(0, height - barHeight, width, barHeight);
    }
  }
}
