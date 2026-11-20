import { VIRTUAL_RESOLUTION } from '../config/GameConstants';
import { SeededRandom } from '../math/Random';
import { clamp } from '../math/Vec3';

interface LensDefinition {
  readonly centerX: number;
  readonly centerY: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly tiltRadians: number;
}

/** Two slightly toed-in lenses; everything outside them is the mask's rubber facepiece. */
const LENSES: readonly LensDefinition[] = [
  { centerX: 610, centerY: 500, radiusX: 360, radiusY: 315, tiltRadians: -0.12 },
  { centerX: 1310, centerY: 500, radiusX: 360, radiusY: 315, tiltRadians: 0.12 },
];
const GRID_SPACING: number = 44;
const SCRATCH_COUNT: number = 26;

export interface GasMaskOverlayFrame {
  /** 0 = off-screen above, 1 = fully seated over the eyes. */
  readonly coverage: number;
  /** 0..1 exhale condensation. */
  readonly lensFog: number;
  /** 0..1, how exhausted the filter is (drives a red rim tint). */
  readonly filterStrain: number;
  readonly timeSeconds: number;
}

/**
 * Full-screen mask view overlay. The rubber frame (with the lens cut-outs) is pre-rendered once into an
 * offscreen canvas; per frame we draw it with a slide-down transform, then paint the lens mesh grid,
 * scratches and breath condensation clipped to the lens ellipses.
 */
export class GasMaskOverlay {
  private readonly frameCanvas: HTMLCanvasElement;
  private readonly scratches: ReadonlyArray<{ lensIndex: number; x0: number; y0: number; x1: number; y1: number; alpha: number }>;

  public constructor() {
    this.frameCanvas = document.createElement('canvas');
    this.frameCanvas.width = VIRTUAL_RESOLUTION.width;
    this.frameCanvas.height = VIRTUAL_RESOLUTION.height + 200;
    this.renderFrame();
    const random = new SeededRandom(0x9a5);
    const scratches: Array<{ lensIndex: number; x0: number; y0: number; x1: number; y1: number; alpha: number }> = [];
    for (let index = 0; index < SCRATCH_COUNT; index += 1) {
      const lensIndex: number = index % LENSES.length;
      const lens: LensDefinition = LENSES[lensIndex] as LensDefinition;
      const angle: number = random.range(0, Math.PI * 2);
      const length: number = random.range(20, 140);
      const startX: number = lens.centerX + random.range(-lens.radiusX * 0.7, lens.radiusX * 0.7);
      const startY: number = lens.centerY + random.range(-lens.radiusY * 0.7, lens.radiusY * 0.7);
      scratches.push({ lensIndex, x0: startX, y0: startY, x1: startX + Math.cos(angle) * length, y1: startY + Math.sin(angle) * length, alpha: random.range(0.05, 0.16) });
    }
    this.scratches = scratches;
  }

  private static traceLens(context: CanvasRenderingContext2D, lens: LensDefinition, inflate: number = 0): void {
    context.ellipse(lens.centerX, lens.centerY, lens.radiusX + inflate, lens.radiusY + inflate, lens.tiltRadians, 0, Math.PI * 2);
  }

  /** Builds the static facepiece: rubber fill, lens cut-outs with feathered inner edges, rims and the filter boss. */
  private renderFrame(): void {
    const context: CanvasRenderingContext2D | null = this.frameCanvas.getContext('2d');
    if (context === null) {
      throw new Error('[GasMaskOverlay] 2D context unavailable.');
    }
    const width: number = this.frameCanvas.width;
    const height: number = this.frameCanvas.height;
    const rubber: CanvasGradient = context.createRadialGradient(width / 2, height * 0.45, 200, width / 2, height * 0.45, width * 0.75);
    rubber.addColorStop(0, '#16171a');
    rubber.addColorStop(1, '#050506');
    context.fillStyle = rubber;
    context.fillRect(0, 0, width, height);

    // Cut the lenses out; a radial alpha ramp feathers the inside of each rim so the view softly vignettes.
    context.globalCompositeOperation = 'destination-out';
    for (const lens of LENSES) {
      context.save();
      context.translate(lens.centerX, lens.centerY);
      context.rotate(lens.tiltRadians);
      context.scale(1, lens.radiusY / lens.radiusX);
      const feather: CanvasGradient = context.createRadialGradient(0, 0, lens.radiusX * 0.62, 0, 0, lens.radiusX);
      feather.addColorStop(0, 'rgba(0, 0, 0, 1)');
      feather.addColorStop(0.82, 'rgba(0, 0, 0, 0.92)');
      feather.addColorStop(1, 'rgba(0, 0, 0, 0)');
      context.fillStyle = feather;
      context.beginPath();
      context.arc(0, 0, lens.radiusX, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
    context.globalCompositeOperation = 'source-over';

    // Metal retaining rims with rivets.
    for (const lens of LENSES) {
      context.beginPath();
      GasMaskOverlay.traceLens(context, lens, 6);
      context.lineWidth = 18;
      context.strokeStyle = '#2a2b2f';
      context.stroke();
      context.lineWidth = 3;
      context.strokeStyle = 'rgba(160, 160, 170, 0.25)';
      context.stroke();
      for (let rivet = 0; rivet < 12; rivet += 1) {
        const angle: number = (rivet / 12) * Math.PI * 2;
        const localX: number = Math.cos(angle) * (lens.radiusX + 6);
        const localY: number = Math.sin(angle) * (lens.radiusY + 6);
        const rivetX: number = lens.centerX + localX * Math.cos(lens.tiltRadians) - localY * Math.sin(lens.tiltRadians);
        const rivetY: number = lens.centerY + localX * Math.sin(lens.tiltRadians) + localY * Math.cos(lens.tiltRadians);
        context.fillStyle = '#4a4b50';
        context.beginPath();
        context.arc(rivetX, rivetY, 5, 0, Math.PI * 2);
        context.fill();
      }
    }
    // Filter boss intruding at the bottom of the view.
    const bossGradient: CanvasGradient = context.createRadialGradient(width / 2, height - 40, 30, width / 2, height - 40, 260);
    bossGradient.addColorStop(0, '#26272b');
    bossGradient.addColorStop(1, '#0b0b0d');
    context.fillStyle = bossGradient;
    context.beginPath();
    context.ellipse(width / 2, height - 30, 260, 210, 0, 0, Math.PI * 2);
    context.fill();
    for (let ring = 0; ring < 5; ring += 1) {
      context.strokeStyle = 'rgba(120, 120, 130, 0.12)';
      context.lineWidth = 3;
      context.beginPath();
      context.ellipse(width / 2, height - 30, 230 - ring * 34, 180 - ring * 28, 0, Math.PI, Math.PI * 2);
      context.stroke();
    }
  }

  private clipToLenses(context: CanvasRenderingContext2D, offsetY: number): void {
    context.beginPath();
    for (const lens of LENSES) {
      context.ellipse(lens.centerX, lens.centerY + offsetY, lens.radiusX, lens.radiusY, lens.tiltRadians, 0, Math.PI * 2);
    }
    context.clip();
  }

  public draw(context: CanvasRenderingContext2D, frame: GasMaskOverlayFrame): void {
    const coverage: number = clamp(frame.coverage, 0, 1);
    if (coverage <= 0.001) {
      return;
    }
    // Ease-out slide from above: y = −H · (1 − c)^2.
    const offsetY: number = -(VIRTUAL_RESOLUTION.height + 200) * (1 - coverage) * (1 - coverage);
    context.save();
    context.drawImage(this.frameCanvas, 0, offsetY);

    context.save();
    this.clipToLenses(context, offsetY);
    // Mesh grid etched into the visor: two diagonal families of faint lines (visibility limiter).
    context.strokeStyle = 'rgba(200, 210, 200, 0.07)';
    context.lineWidth = 1.5;
    context.beginPath();
    for (let diagonal = -VIRTUAL_RESOLUTION.height; diagonal < VIRTUAL_RESOLUTION.width + VIRTUAL_RESOLUTION.height; diagonal += GRID_SPACING) {
      context.moveTo(diagonal, offsetY);
      context.lineTo(diagonal + VIRTUAL_RESOLUTION.height, VIRTUAL_RESOLUTION.height + offsetY);
      context.moveTo(diagonal, VIRTUAL_RESOLUTION.height + offsetY);
      context.lineTo(diagonal + VIRTUAL_RESOLUTION.height, offsetY);
    }
    context.stroke();
    // Inner-lens darkening toward the rim (depth of the eyecup).
    for (const lens of LENSES) {
      const rimShade: CanvasGradient = context.createRadialGradient(lens.centerX, lens.centerY + offsetY, lens.radiusY * 0.55, lens.centerX, lens.centerY + offsetY, lens.radiusX);
      rimShade.addColorStop(0, 'rgba(0, 0, 0, 0)');
      rimShade.addColorStop(1, `rgba(${Math.round(60 * frame.filterStrain)}, 0, 0, ${(0.5 + 0.25 * frame.filterStrain).toFixed(3)})`);
      context.fillStyle = rimShade;
      context.fillRect(lens.centerX - lens.radiusX, lens.centerY - lens.radiusY + offsetY, lens.radiusX * 2, lens.radiusY * 2);
    }
    // Scratches.
    context.lineWidth = 1.2;
    for (const scratch of this.scratches) {
      context.strokeStyle = `rgba(230, 230, 220, ${scratch.alpha.toFixed(3)})`;
      context.beginPath();
      context.moveTo(scratch.x0, scratch.y0 + offsetY);
      context.lineTo(scratch.x1, scratch.y1 + offsetY);
      context.stroke();
    }
    // Breath condensation blooming up from the bottom of each lens.
    const fog: number = clamp(frame.lensFog, 0, 1);
    if (fog > 0.01) {
      for (const lens of LENSES) {
        const bloomCenterY: number = lens.centerY + lens.radiusY * 0.85 + offsetY;
        const condensation: CanvasGradient = context.createRadialGradient(lens.centerX, bloomCenterY, 10, lens.centerX, bloomCenterY, lens.radiusX * (0.7 + fog * 0.5));
        condensation.addColorStop(0, `rgba(215, 222, 225, ${(0.42 * fog).toFixed(3)})`);
        condensation.addColorStop(1, 'rgba(215, 222, 225, 0)');
        context.fillStyle = condensation;
        context.fillRect(lens.centerX - lens.radiusX, lens.centerY - lens.radiusY + offsetY, lens.radiusX * 2, lens.radiusY * 2);
      }
    }
    context.restore();
    context.restore();
  }
}
