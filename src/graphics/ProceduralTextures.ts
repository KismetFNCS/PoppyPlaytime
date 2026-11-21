import { clamp, smoothstep } from '../math/Vec3';
import { hashIntegers, tileableFbm2D } from '../math/Random';

/** One texel of a procedural surface, all channels normalised to [0, 1]. Albedo/emissive are sRGB-encoded. */
export interface SurfaceTexel {
  albedoRed: number;
  albedoGreen: number;
  albedoBlue: number;
  height: number;
  roughness: number;
  emissiveRed: number;
  emissiveGreen: number;
  emissiveBlue: number;
}

export type ProceduralSurfaceKind =
  | 'ceramicTile'
  | 'stainedConcrete'
  | 'rustedMetal'
  | 'harlequinFabric'
  | 'crackedPorcelain'
  | 'gasMaskRubber'
  | 'gasMaskLens'
  | 'shatteredFoundation'
  | 'emissiveSolid'
  | 'brickFacade'
  | 'damaskWallpaper'
  | 'glazedPorcelain'
  | 'hymnPaper'
  | 'wetStone'
  | 'murkyWater'
  | 'tinPlate'
  | 'conveyorBelt'
  | 'weatheredWood'
  | 'wornPaint';

export interface ProceduralSurfaceParameters {
  readonly kind: ProceduralSurfaceKind;
  readonly seed: number;
  readonly resolution: number;
  /** Height-to-normal conversion strength. */
  readonly bumpStrength: number;
}

export interface BakedSurfaceMaps {
  readonly resolution: number;
  readonly diffuse: Uint8Array;
  readonly normal: Uint8Array;
  readonly roughness: Uint8Array;
  readonly emissive: Uint8Array;
}

type SurfaceSampler = (u: number, v: number, seed: number) => SurfaceTexel;

function createTexel(): SurfaceTexel {
  return { albedoRed: 0, albedoGreen: 0, albedoBlue: 0, height: 0.5, roughness: 0.8, emissiveRed: 0, emissiveGreen: 0, emissiveBlue: 0 };
}

/** Tileable Worley noise returning [distanceToNearest, distanceToSecondNearest] in cell units. */
function tileableWorley(u: number, v: number, cellsPerSide: number, seed: number): [number, number] {
  const x: number = u * cellsPerSide;
  const y: number = v * cellsPerSide;
  const cellX: number = Math.floor(x);
  const cellY: number = Math.floor(y);
  let nearest = 9;
  let secondNearest = 9;
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const neighbourX: number = cellX + offsetX;
      const neighbourY: number = cellY + offsetY;
      const wrappedX: number = ((neighbourX % cellsPerSide) + cellsPerSide) % cellsPerSide;
      const wrappedY: number = ((neighbourY % cellsPerSide) + cellsPerSide) % cellsPerSide;
      const featureX: number = neighbourX + hashIntegers(wrappedX, wrappedY, seed);
      const featureY: number = neighbourY + hashIntegers(wrappedX, wrappedY, seed + 17);
      const distance: number = Math.hypot(featureX - x, featureY - y);
      if (distance < nearest) {
        secondNearest = nearest;
        nearest = distance;
      } else if (distance < secondNearest) {
        secondNearest = distance;
      }
    }
  }
  return [nearest, secondNearest];
}

const SURFACE_SAMPLERS: Readonly<Record<ProceduralSurfaceKind, SurfaceSampler>> = {
  ceramicTile: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const tilesPerSide = 4;
    const tileU: number = (u * tilesPerSide) % 1;
    const tileV: number = (v * tilesPerSide) % 1;
    const groutDistance: number = Math.min(tileU, 1 - tileU, tileV, 1 - tileV);
    const grout: number = 1 - smoothstep(0.02, 0.045, groutDistance);
    const tileIndexU: number = Math.floor(u * tilesPerSide);
    const tileIndexV: number = Math.floor(v * tilesPerSide);
    const tileVariation: number = hashIntegers(tileIndexU, tileIndexV, seed);
    const grime: number = tileableFbm2D(u, v, 4, 5, seed);
    const drip: number = smoothstep(0.55, 0.9, tileableFbm2D(u * 1, v * 0.25, 8, 3, seed + 9)) * (1 - v * 0.4);
    const [crackNearest, crackSecond] = tileableWorley(u, v, 6, seed + 3);
    const crack: number = (1 - smoothstep(0.0, 0.03, crackSecond - crackNearest)) * smoothstep(0.62, 0.7, tileVariation);
    const baseShade: number = 0.72 + tileVariation * 0.08 - grime * 0.25 - drip * 0.3;
    texel.albedoRed = clamp(baseShade * 0.93 - grout * 0.45 - crack * 0.4, 0, 1);
    texel.albedoGreen = clamp(baseShade * 0.9 - grout * 0.45 - crack * 0.4, 0, 1);
    texel.albedoBlue = clamp(baseShade * 0.82 - grout * 0.42 - crack * 0.4, 0, 1);
    texel.height = clamp(0.75 - grout * 0.5 - crack * 0.4 + grime * 0.05, 0, 1);
    texel.roughness = clamp(0.25 + grout * 0.6 + grime * 0.35 + drip * 0.2, 0, 1);
    return texel;
  },
  stainedConcrete: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const largeStains: number = tileableFbm2D(u, v, 3, 5, seed);
    const pores: number = tileableFbm2D(u, v, 32, 3, seed + 41);
    const puddle: number = smoothstep(0.58, 0.66, tileableFbm2D(u, v, 2, 4, seed + 77));
    const [nearest, second] = tileableWorley(u, v, 3, seed + 5);
    const seam: number = 1 - smoothstep(0, 0.025, second - nearest);
    const shade: number = 0.34 + largeStains * 0.22 - pores * 0.08 - seam * 0.12 - puddle * 0.1;
    texel.albedoRed = clamp(shade * 1.02, 0, 1);
    texel.albedoGreen = clamp(shade * 0.98, 0, 1);
    texel.albedoBlue = clamp(shade * 0.94, 0, 1);
    texel.height = clamp(0.6 + pores * 0.25 - seam * 0.4 - puddle * 0.2, 0, 1);
    texel.roughness = clamp(0.85 - puddle * 0.75 - largeStains * 0.1, 0.05, 1);
    return texel;
  },
  rustedMetal: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const rustMask: number = smoothstep(0.42, 0.62, tileableFbm2D(u, v, 4, 6, seed));
    const scratches: number = smoothstep(0.7, 0.75, tileableFbm2D(u * 1, v * 0.05, 64, 2, seed + 3));
    const flake: number = tileableFbm2D(u, v, 24, 3, seed + 11);
    const paintRed = 0.18;
    const paintGreen = 0.2;
    const paintBlue = 0.22;
    texel.albedoRed = clamp(paintRed + (0.42 - paintRed) * rustMask + flake * 0.06 + scratches * 0.25, 0, 1);
    texel.albedoGreen = clamp(paintGreen + (0.18 - paintGreen) * rustMask + flake * 0.04 + scratches * 0.25, 0, 1);
    texel.albedoBlue = clamp(paintBlue + (0.08 - paintBlue) * rustMask + flake * 0.02 + scratches * 0.25, 0, 1);
    texel.height = clamp(0.5 + rustMask * 0.25 * flake - scratches * 0.2, 0, 1);
    texel.roughness = clamp(0.35 + rustMask * 0.55 - scratches * 0.2, 0, 1);
    return texel;
  },
  harlequinFabric: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const diamondsPerSide = 4;
    const diagonalA: number = (u + v) * diamondsPerSide;
    const diagonalB: number = (u - v) * diamondsPerSide;
    const checker: number = (Math.floor(diagonalA) + Math.floor(diagonalB)) & 1;
    const seamDistance: number = Math.min(diagonalA % 1, 1 - (diagonalA % 1), ((diagonalB % 1) + 1) % 1, 1 - (((diagonalB % 1) + 1) % 1));
    const stitch: number = (1 - smoothstep(0.015, 0.04, seamDistance)) * (Math.sin((u + v) * 220) > 0.2 ? 1 : 0.4);
    const weave: number = (Math.sin(u * 512) * Math.sin(v * 512)) * 0.5 + 0.5;
    const fade: number = tileableFbm2D(u, v, 5, 4, seed);
    const tear: number = smoothstep(0.74, 0.78, tileableFbm2D(u, v, 6, 4, seed + 19));
    const crimsonRed = 0.48 - fade * 0.18;
    const crimsonGreen = 0.05;
    const crimsonBlue = 0.06;
    const charcoal = 0.06 + fade * 0.04;
    texel.albedoRed = clamp((checker === 1 ? crimsonRed : charcoal) + weave * 0.03 + stitch * 0.35 - tear * 0.1, 0, 1);
    texel.albedoGreen = clamp((checker === 1 ? crimsonGreen : charcoal) + weave * 0.02 + stitch * 0.32 - tear * 0.05, 0, 1);
    texel.albedoBlue = clamp((checker === 1 ? crimsonBlue : charcoal * 1.1) + weave * 0.02 + stitch * 0.28 - tear * 0.05, 0, 1);
    texel.height = clamp(0.55 + weave * 0.15 - stitch * 0.3 - tear * 0.45, 0, 1);
    texel.roughness = clamp(0.85 + weave * 0.1 - stitch * 0.2, 0, 1);
    return texel;
  },
  crackedPorcelain: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const [nearest, second] = tileableWorley(u, v, 7, seed);
    const crack: number = 1 - smoothstep(0.0, 0.035, second - nearest);
    const grime: number = tileableFbm2D(u, v, 6, 5, seed + 2);
    const shade: number = 0.82 - grime * 0.25;
    texel.albedoRed = clamp(shade - crack * 0.65, 0, 1);
    texel.albedoGreen = clamp(shade * 0.97 - crack * 0.68, 0, 1);
    texel.albedoBlue = clamp(shade * 0.92 - crack * 0.7, 0, 1);
    texel.height = clamp(0.8 - crack * 0.6, 0, 1);
    texel.roughness = clamp(0.15 + grime * 0.35 + crack * 0.6, 0, 1);
    texel.emissiveRed = crack * 0.55;
    texel.emissiveGreen = crack * 0.02;
    texel.emissiveBlue = crack * 0.03;
    return texel;
  },
  gasMaskRubber: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const grain: number = tileableFbm2D(u, v, 48, 3, seed);
    const ribs: number = Math.pow(Math.abs(Math.sin(v * Math.PI * 24)), 6);
    const wear: number = smoothstep(0.55, 0.8, tileableFbm2D(u, v, 5, 4, seed + 7));
    const shade: number = 0.07 + grain * 0.04 + wear * 0.12;
    texel.albedoRed = clamp(shade + wear * 0.04, 0, 1);
    texel.albedoGreen = clamp(shade + wear * 0.05, 0, 1);
    texel.albedoBlue = clamp(shade * 0.9, 0, 1);
    texel.height = clamp(0.5 + ribs * 0.35 + grain * 0.1, 0, 1);
    texel.roughness = clamp(0.6 + grain * 0.2 - wear * 0.25, 0, 1);
    return texel;
  },
  gasMaskLens: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const smudge: number = tileableFbm2D(u, v, 8, 4, seed);
    const [nearest, second] = tileableWorley(u, v, 3, seed + 1);
    const fracture: number = (1 - smoothstep(0.0, 0.02, second - nearest)) * smoothstep(0.5, 0.7, smudge);
    texel.albedoRed = 0.04 + fracture * 0.4;
    texel.albedoGreen = 0.07 + fracture * 0.4;
    texel.albedoBlue = 0.06 + fracture * 0.4;
    texel.height = 0.5 - fracture * 0.3;
    texel.roughness = clamp(0.05 + smudge * 0.3 + fracture * 0.5, 0, 1);
    texel.emissiveRed = 0.05;
    texel.emissiveGreen = 0.18 + smudge * 0.1;
    texel.emissiveBlue = 0.12;
    return texel;
  },
  shatteredFoundation: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const aggregate: number = tileableFbm2D(u, v, 20, 4, seed);
    const stains: number = tileableFbm2D(u, v, 3, 5, seed + 13);
    const [nearest, second] = tileableWorley(u, v, 4, seed + 29);
    const fissureWidth: number = second - nearest;
    const fissure: number = 1 - smoothstep(0.0, 0.05, fissureWidth);
    const fissureCore: number = 1 - smoothstep(0.0, 0.018, fissureWidth);
    const shade: number = 0.3 + aggregate * 0.18 - stains * 0.12;
    texel.albedoRed = clamp(shade - fissure * 0.25, 0, 1);
    texel.albedoGreen = clamp(shade * 0.96 - fissure * 0.25, 0, 1);
    texel.albedoBlue = clamp(shade * 0.9 - fissure * 0.25, 0, 1);
    texel.height = clamp(0.65 + aggregate * 0.2 - fissure * 0.6, 0, 1);
    texel.roughness = clamp(0.9 - stains * 0.15, 0, 1);
    texel.emissiveRed = fissureCore * 0.9;
    texel.emissiveGreen = fissureCore * 0.08;
    texel.emissiveBlue = fissureCore * 0.05;
    return texel;
  },
  /** Running-bond brick with recessed mortar, per-brick tint variation, soot streaks and wet sheen. */
  brickFacade: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const rows = 8;
    const bricksPerRow = 4;
    const row: number = Math.floor(v * rows);
    const rowOffset: number = (row % 2) * 0.5;
    const brickU: number = (u * bricksPerRow + rowOffset) % 1;
    const brickV: number = (v * rows) % 1;
    const column: number = Math.floor(u * bricksPerRow + rowOffset);
    const mortarDistance: number = Math.min(brickU, 1 - brickU, brickV * 0.5, (1 - brickV) * 0.5);
    const mortar: number = 1 - smoothstep(0.03, 0.06, mortarDistance);
    const brickTint: number = hashIntegers(column, row, seed);
    const pitting: number = tileableFbm2D(u, v, 32, 3, seed + 3);
    const soot: number = smoothstep(0.45, 0.85, tileableFbm2D(u * 1, v * 0.3, 6, 4, seed + 9)) * (1 - v * 0.6);
    const red: number = 0.42 + brickTint * 0.12 - pitting * 0.08;
    texel.albedoRed = clamp(red * (1 - mortar) + 0.36 * mortar - soot * 0.25, 0, 1);
    texel.albedoGreen = clamp((red * 0.45) * (1 - mortar) + 0.34 * mortar - soot * 0.18, 0, 1);
    texel.albedoBlue = clamp((red * 0.33) * (1 - mortar) + 0.31 * mortar - soot * 0.15, 0, 1);
    texel.height = clamp(0.75 - mortar * 0.55 + pitting * 0.12, 0, 1);
    texel.roughness = clamp(0.82 - soot * 0.35 + mortar * 0.1, 0, 1);
    return texel;
  },
  /** Faded damask wallpaper: mirrored floral medallions, vertical stripes, water stains and peeling seams. */
  damaskWallpaper: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const repeats = 3;
    const cellU: number = ((u * repeats) % 1) - 0.5;
    const cellV: number = ((v * repeats) % 1) - 0.5;
    const mirroredU: number = Math.abs(cellU);
    const radius: number = Math.hypot(mirroredU * 1.4, cellV);
    const petals: number = Math.cos(Math.atan2(cellV, mirroredU) * 6) * 0.5 + 0.5;
    const medallion: number = (1 - smoothstep(0.18, 0.2, Math.abs(radius - 0.22 - petals * 0.06))) + (1 - smoothstep(0.05, 0.07, radius));
    const stripe: number = Math.abs(Math.sin(u * Math.PI * 24)) > 0.96 ? 1 : 0;
    const stain: number = smoothstep(0.55, 0.75, tileableFbm2D(u, v, 3, 5, seed));
    const peel: number = smoothstep(0.82, 0.86, tileableFbm2D(u, v * 0.5, 4, 3, seed + 21));
    const base: Readonly<[number, number, number]> = [0.36, 0.3, 0.32];
    const ink: Readonly<[number, number, number]> = [0.5, 0.42, 0.33];
    const pattern: number = clamp(medallion + stripe * 0.4, 0, 1);
    texel.albedoRed = clamp(base[0] + (ink[0] - base[0]) * pattern - stain * 0.12 - peel * 0.15, 0, 1);
    texel.albedoGreen = clamp(base[1] + (ink[1] - base[1]) * pattern - stain * 0.1 - peel * 0.13, 0, 1);
    texel.albedoBlue = clamp(base[2] + (ink[2] - base[2]) * pattern - stain * 0.14 - peel * 0.12, 0, 1);
    texel.height = clamp(0.6 + pattern * 0.08 - peel * 0.4, 0, 1);
    texel.roughness = clamp(0.7 + stain * 0.15 - pattern * 0.15, 0, 1);
    return texel;
  },
  /** Glossy white glaze with fine crazing, chipped rims and painted blush. */
  glazedPorcelain: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const [nearest, second] = tileableWorley(u, v, 14, seed);
    const crazing: number = 1 - smoothstep(0.0, 0.025, second - nearest);
    const chip: number = smoothstep(0.86, 0.9, tileableFbm2D(u, v, 7, 4, seed + 5));
    const blush: number = smoothstep(0.5, 0.75, tileableFbm2D(u, v, 2, 3, seed + 13)) * 0.35;
    const grime: number = tileableFbm2D(u, v, 9, 4, seed + 31) * 0.15;
    texel.albedoRed = clamp(0.92 - grime - crazing * 0.28 - chip * 0.35, 0, 1);
    texel.albedoGreen = clamp(0.89 - grime - blush * 0.25 - crazing * 0.3 - chip * 0.4, 0, 1);
    texel.albedoBlue = clamp(0.86 - grime - blush * 0.3 - crazing * 0.3 - chip * 0.42, 0, 1);
    texel.height = clamp(0.8 - crazing * 0.2 - chip * 0.5, 0, 1);
    texel.roughness = clamp(0.08 + grime * 0.6 + crazing * 0.3 + chip * 0.6, 0, 1);
    return texel;
  },
  /** Aged hymn-sheet paper: staves of horizontal lines, note blobs, foxing and torn fibres. */
  hymnPaper: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const staffV: number = (v * 6) % 1;
    const staffLine: number = staffV > 0.25 && staffV < 0.75 && Math.abs(((staffV - 0.25) * 10) % 1 - 0.5) > 0.44 ? 1 : 0;
    const noteCellU: number = Math.floor(u * 18);
    const noteCellV: number = Math.floor(v * 30);
    const noteChance: number = hashIntegers(noteCellU, noteCellV, seed);
    const noteCenterU: number = (noteCellU + 0.5) / 18;
    const noteCenterV: number = (noteCellV + 0.5) / 30;
    const note: number = noteChance > 0.78 ? 1 - smoothstep(0.006, 0.01, Math.hypot((u - noteCenterU) * 1.6, v - noteCenterV)) : 0;
    const foxing: number = smoothstep(0.62, 0.8, tileableFbm2D(u, v, 8, 4, seed + 7));
    const fibre: number = tileableFbm2D(u * 1, v * 0.2, 64, 2, seed + 11);
    const shade: number = 0.78 - foxing * 0.25 + fibre * 0.05;
    const ink: number = clamp(staffLine * 0.8 + note, 0, 1);
    texel.albedoRed = clamp(shade - ink * 0.6, 0, 1);
    texel.albedoGreen = clamp(shade * 0.93 - ink * 0.6, 0, 1);
    texel.albedoBlue = clamp(shade * 0.78 - ink * 0.55, 0, 1);
    texel.height = clamp(0.5 + fibre * 0.2, 0, 1);
    texel.roughness = 0.92;
    return texel;
  },
  /** Flagstones slick with seep water: irregular cells, dark wet gaps, algae and puddle gloss. */
  wetStone: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const [nearest, second] = tileableWorley(u, v, 5, seed);
    const joint: number = 1 - smoothstep(0.0, 0.07, second - nearest);
    const grain: number = tileableFbm2D(u, v, 24, 4, seed + 3);
    const algae: number = smoothstep(0.55, 0.8, tileableFbm2D(u, v, 4, 5, seed + 17)) * joint;
    const wet: number = smoothstep(0.4, 0.65, tileableFbm2D(u, v, 3, 4, seed + 29));
    const shade: number = 0.3 + grain * 0.12 - wet * 0.08;
    texel.albedoRed = clamp(shade - joint * 0.18 - algae * 0.05, 0, 1);
    texel.albedoGreen = clamp(shade * 1.02 - joint * 0.16 + algae * 0.06, 0, 1);
    texel.albedoBlue = clamp(shade * 1.04 - joint * 0.15, 0, 1);
    texel.height = clamp(0.7 + grain * 0.15 - joint * 0.6, 0, 1);
    texel.roughness = clamp(0.75 - wet * 0.6 - joint * 0.1, 0.04, 1);
    return texel;
  },
  /** Dark standing water: near-black albedo, mirror-like roughness, slow ripple normals, floating scum. */
  murkyWater: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const ripple: number = tileableFbm2D(u, v, 6, 4, seed) * 0.6 + Math.sin((u + v) * Math.PI * 18) * 0.04;
    const scum: number = smoothstep(0.68, 0.85, tileableFbm2D(u, v, 5, 5, seed + 41));
    texel.albedoRed = clamp(0.03 + scum * 0.12, 0, 1);
    texel.albedoGreen = clamp(0.045 + scum * 0.14, 0, 1);
    texel.albedoBlue = clamp(0.05 + scum * 0.08, 0, 1);
    texel.height = clamp(0.5 + ripple * 0.3, 0, 1);
    texel.roughness = clamp(0.04 + scum * 0.7, 0, 1);
    return texel;
  },
  /** Lithographed tin: printed stripes and dots under scratched clear coat, rust at the seams. */
  /** Worn enamel (tinted by the material): grime build-up, chipped edges showing bare steel, fine scratches. */
  wornPaint: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const grime: number = smoothstep(0.34, 0.82, tileableFbm2D(u, v, 8, 5, seed));
    const smudge: number = smoothstep(0.58, 0.82, tileableFbm2D(u, v, 18, 4, seed + 11));
    const chips: number = smoothstep(0.76, 0.79, tileableFbm2D(u, v, 24, 4, seed + 23));
    const scratches: number = smoothstep(0.74, 0.78, tileableFbm2D(u * 0.06, v, 40, 2, seed + 31));
    const speckle: number = tileableFbm2D(u, v, 64, 2, seed + 41);
    const paint: number = 0.84 - grime * 0.3 - smudge * 0.1 + scratches * 0.08 - (speckle - 0.5) * 0.08;
    // Chipped spots read as dull grey steel regardless of tint; the material tint still multiplies them, so keep them dark.
    const steel: number = 0.32;
    const value: number = paint * (1 - chips) + steel * chips;
    texel.albedoRed = clamp(value * (1 - grime * 0.05), 0, 1);
    texel.albedoGreen = clamp(value * (1 - grime * 0.1), 0, 1);
    texel.albedoBlue = clamp(value * (1 - grime * 0.16), 0, 1);
    texel.height = clamp(0.55 - chips * 0.25 - scratches * 0.1 + grime * 0.08, 0, 1);
    texel.roughness = clamp(0.42 + grime * 0.38 + smudge * 0.1 - chips * 0.12, 0, 1);
    return texel;
  },
  tinPlate: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const stripe: number = Math.floor(v * 10) % 2;
    const dotU: number = ((u * 12) % 1) - 0.5;
    const dotV: number = ((v * 12) % 1) - 0.5;
    const dot: number = 1 - smoothstep(0.16, 0.2, Math.hypot(dotU, dotV));
    const scratches: number = smoothstep(0.72, 0.76, tileableFbm2D(u * 1, v * 0.04, 48, 2, seed));
    const rust: number = smoothstep(0.62, 0.82, tileableFbm2D(u, v, 6, 5, seed + 3));
    const printRed: number = stripe === 1 ? 0.72 : 0.86;
    const printGreen: number = stripe === 1 ? 0.52 : 0.78;
    const printBlue: number = stripe === 1 ? 0.22 : 0.62;
    texel.albedoRed = clamp(printRed - dot * 0.3 + scratches * 0.15 + (0.45 - printRed) * rust, 0, 1);
    texel.albedoGreen = clamp(printGreen - dot * 0.25 + scratches * 0.15 + (0.22 - printGreen) * rust, 0, 1);
    texel.albedoBlue = clamp(printBlue - dot * 0.1 + scratches * 0.15 + (0.1 - printBlue) * rust, 0, 1);
    texel.height = clamp(0.55 - scratches * 0.15 + rust * 0.2, 0, 1);
    texel.roughness = clamp(0.25 + rust * 0.6 + scratches * 0.1, 0, 1);
    return texel;
  },
  /** Rubberised conveyor belting with transverse cleats, wear polish down the centre and grease. */
  conveyorBelt: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const cleat: number = Math.pow(Math.abs(Math.sin(v * Math.PI * 12)), 18);
    const wear: number = 1 - smoothstep(0.1, 0.35, Math.abs(u - 0.5));
    const grease: number = smoothstep(0.6, 0.8, tileableFbm2D(u, v, 7, 4, seed));
    const grain: number = tileableFbm2D(u, v, 40, 2, seed + 9);
    const shade: number = 0.09 + grain * 0.04 + wear * 0.05;
    texel.albedoRed = clamp(shade + cleat * 0.05 - grease * 0.03, 0, 1);
    texel.albedoGreen = clamp(shade + cleat * 0.05 - grease * 0.03, 0, 1);
    texel.albedoBlue = clamp(shade * 1.05 + cleat * 0.05, 0, 1);
    texel.height = clamp(0.4 + cleat * 0.5 + grain * 0.08, 0, 1);
    texel.roughness = clamp(0.8 - wear * 0.35 - grease * 0.4, 0.05, 1);
    return texel;
  },
  /** Painted nursery wood: grain lines through chipped pastel paint, darkened end grain. */
  weatheredWood: (u: number, v: number, seed: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const warp: number = tileableFbm2D(u, v, 4, 3, seed) * 0.8;
    const rings: number = Math.abs(Math.sin((v * 8 + warp) * Math.PI * 4));
    const grain: number = Math.pow(rings, 3);
    const paintMask: number = smoothstep(0.42, 0.5, tileableFbm2D(u, v, 6, 5, seed + 7));
    const woodRed: number = 0.38 - grain * 0.12;
    const woodGreen: number = 0.26 - grain * 0.09;
    const woodBlue: number = 0.16 - grain * 0.06;
    const paintRed = 0.62;
    const paintGreen = 0.68;
    const paintBlue = 0.7;
    texel.albedoRed = clamp(woodRed + (paintRed - woodRed) * paintMask, 0, 1);
    texel.albedoGreen = clamp(woodGreen + (paintGreen - woodGreen) * paintMask, 0, 1);
    texel.albedoBlue = clamp(woodBlue + (paintBlue - woodBlue) * paintMask, 0, 1);
    texel.height = clamp(0.5 + paintMask * 0.15 - grain * 0.15, 0, 1);
    texel.roughness = clamp(0.85 - paintMask * 0.3, 0, 1);
    return texel;
  },
  emissiveSolid: (u: number, v: number): SurfaceTexel => {
    const texel: SurfaceTexel = createTexel();
    const radial: number = 1 - smoothstep(0.1, 0.72, Math.hypot(u - 0.5, v - 0.5) * 1.4);
    texel.albedoRed = 0.9;
    texel.albedoGreen = 0.9;
    texel.albedoBlue = 0.9;
    texel.height = 0.5;
    texel.roughness = 0.3;
    texel.emissiveRed = 0.35 + radial * 0.65;
    texel.emissiveGreen = 0.35 + radial * 0.65;
    texel.emissiveBlue = 0.35 + radial * 0.65;
    return texel;
  },
};

/** Bakes a procedural surface into Diffuse / Normal / Roughness / Emissive RGBA8 maps. */
export function bakeProceduralSurface(parameters: ProceduralSurfaceParameters): BakedSurfaceMaps {
  const resolution: number = parameters.resolution;
  const texelCount: number = resolution * resolution;
  const sampler: SurfaceSampler = SURFACE_SAMPLERS[parameters.kind];
  const heights = new Float32Array(texelCount);
  const diffuse = new Uint8Array(texelCount * 4);
  const roughness = new Uint8Array(texelCount * 4);
  const emissive = new Uint8Array(texelCount * 4);
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const texelIndex: number = y * resolution + x;
      const texel: SurfaceTexel = sampler((x + 0.5) / resolution, (y + 0.5) / resolution, parameters.seed);
      heights[texelIndex] = texel.height;
      const byteOffset: number = texelIndex * 4;
      diffuse[byteOffset] = Math.round(clamp(texel.albedoRed, 0, 1) * 255);
      diffuse[byteOffset + 1] = Math.round(clamp(texel.albedoGreen, 0, 1) * 255);
      diffuse[byteOffset + 2] = Math.round(clamp(texel.albedoBlue, 0, 1) * 255);
      diffuse[byteOffset + 3] = 255;
      const roughnessByte: number = Math.round(clamp(texel.roughness, 0, 1) * 255);
      roughness[byteOffset] = roughnessByte;
      roughness[byteOffset + 1] = roughnessByte;
      roughness[byteOffset + 2] = roughnessByte;
      roughness[byteOffset + 3] = 255;
      emissive[byteOffset] = Math.round(clamp(texel.emissiveRed, 0, 1) * 255);
      emissive[byteOffset + 1] = Math.round(clamp(texel.emissiveGreen, 0, 1) * 255);
      emissive[byteOffset + 2] = Math.round(clamp(texel.emissiveBlue, 0, 1) * 255);
      emissive[byteOffset + 3] = 255;
    }
  }
  const normal = new Uint8Array(texelCount * 4);
  const heightAt = (x: number, y: number): number =>
    heights[(((y % resolution) + resolution) % resolution) * resolution + (((x % resolution) + resolution) % resolution)] as number;
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      // Sobel gradient over a wrapped neighbourhood keeps the normal map tileable.
      const gradientX: number =
        heightAt(x + 1, y - 1) + 2 * heightAt(x + 1, y) + heightAt(x + 1, y + 1) - heightAt(x - 1, y - 1) - 2 * heightAt(x - 1, y) - heightAt(x - 1, y + 1);
      const gradientY: number =
        heightAt(x - 1, y + 1) + 2 * heightAt(x, y + 1) + heightAt(x + 1, y + 1) - heightAt(x - 1, y - 1) - 2 * heightAt(x, y - 1) - heightAt(x + 1, y - 1);
      const normalX: number = -gradientX * parameters.bumpStrength;
      const normalY: number = -gradientY * parameters.bumpStrength;
      const inverseLength: number = 1 / Math.hypot(normalX, normalY, 1);
      const byteOffset: number = (y * resolution + x) * 4;
      normal[byteOffset] = Math.round((normalX * inverseLength * 0.5 + 0.5) * 255);
      normal[byteOffset + 1] = Math.round((normalY * inverseLength * 0.5 + 0.5) * 255);
      normal[byteOffset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
      normal[byteOffset + 3] = 255;
    }
  }
  return { resolution, diffuse, normal, roughness, emissive };
}
