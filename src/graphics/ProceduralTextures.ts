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
  | 'emissiveSolid';

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
