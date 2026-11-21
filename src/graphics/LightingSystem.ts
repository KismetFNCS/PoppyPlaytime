import { MAX_FORWARD_LIGHTS } from '../config/GameConstants';
import type { Vec3 } from '../math/Vec3';
import { clamp, vec3Distance } from '../math/Vec3';
import { hashIntegers } from '../math/Random';

export type LightBehavior =
  | { readonly kind: 'steady' }
  | { readonly kind: 'flicker'; readonly rateHertz: number; readonly dropoutChance: number }
  | { readonly kind: 'pulse'; readonly frequencyHertz: number; readonly depth: number }
  | { readonly kind: 'strobe'; readonly frequencyHertz: number; readonly dutyCycle: number };

export interface PointLightDescriptor {
  readonly position: Vec3;
  readonly color: Vec3;
  readonly intensity: number;
  readonly range: number;
  readonly behavior: LightBehavior;
}

export interface PointLight extends PointLightDescriptor {
  readonly handle: number;
  position: Vec3;
  intensity: number;
  enabled: boolean;
  /** Result of the most recent `evaluate` call, already multiplied by intensity and behaviour. */
  effectiveScale: number;
  readonly phaseSeed: number;
}

/** Something (e.g. the stalking entity) that makes lights near it stutter and dim. */
export interface LightDisturbanceSource {
  position: Vec3;
  radius: number;
  strength: number;
}

/** Packed, upload-ready arrays matching the `uLight*` uniform arrays in the scene and fog shaders. */
export interface PackedLightBuffer {
  count: number;
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly ranges: Float32Array;
}

export function createPackedLightBuffer(): PackedLightBuffer {
  return {
    count: 0,
    positions: new Float32Array(MAX_FORWARD_LIGHTS * 3),
    colors: new Float32Array(MAX_FORWARD_LIGHTS * 3),
    ranges: new Float32Array(MAX_FORWARD_LIGHTS),
  };
}

/** Owns every dynamic point light in the world, animates them and selects the most relevant set per frame. */
export class LightingSystem {
  private readonly lights: Map<number, PointLight> = new Map();
  private nextHandle: number = 1;
  public readonly disturbances: LightDisturbanceSource[] = [];
  /** Global multiplier for blackout / jumpscare effects. */
  public globalIntensityScale: number = 1;

  public add(descriptor: PointLightDescriptor): PointLight {
    const handle: number = this.nextHandle;
    this.nextHandle += 1;
    const light: PointLight = {
      ...descriptor,
      position: [descriptor.position[0], descriptor.position[1], descriptor.position[2]],
      handle,
      enabled: true,
      effectiveScale: descriptor.intensity,
      phaseSeed: hashIntegers(handle, 91, 17) * 1000,
    };
    this.lights.set(handle, light);
    return light;
  }

  public remove(handle: number): void {
    this.lights.delete(handle);
  }

  public clear(): void {
    this.lights.clear();
    this.disturbances.length = 0;
    this.globalIntensityScale = 1;
  }

  public get lightCount(): number {
    return this.lights.size;
  }

  private static behaviorScale(light: PointLight, timeSeconds: number): number {
    const behavior: LightBehavior = light.behavior;
    switch (behavior.kind) {
      case 'steady':
        return 1;
      case 'flicker': {
        const tick: number = Math.floor((timeSeconds + light.phaseSeed) * behavior.rateHertz);
        const sample: number = hashIntegers(tick, light.handle, 7);
        if (sample < behavior.dropoutChance) {
          return 0.05;
        }
        const fine: number = hashIntegers(Math.floor((timeSeconds + light.phaseSeed) * 60), light.handle, 3);
        return 0.82 + fine * 0.18;
      }
      case 'pulse':
        return 1 - behavior.depth * (0.5 + 0.5 * Math.sin((timeSeconds + light.phaseSeed) * behavior.frequencyHertz * Math.PI * 2));
      case 'strobe': {
        const cycle: number = ((timeSeconds + light.phaseSeed) * behavior.frequencyHertz) % 1;
        return cycle < behavior.dutyCycle ? 1 : 0.02;
      }
    }
  }

  /** Updates `effectiveScale` for every light, applying behaviours and disturbance stutter. */
  public evaluate(timeSeconds: number): void {
    for (const light of this.lights.values()) {
      let scale: number = light.enabled ? light.intensity * LightingSystem.behaviorScale(light, timeSeconds) : 0;
      for (const disturbance of this.disturbances) {
        const distance: number = vec3Distance(disturbance.position, light.position);
        const influence: number = clamp(1 - distance / disturbance.radius, 0, 1) * disturbance.strength;
        if (influence > 0) {
          const stutter: number = hashIntegers(Math.floor(timeSeconds * 22), light.handle, 29);
          scale *= stutter < influence * 0.7 ? 0.03 : 1 - influence * 0.55;
        }
      }
      light.effectiveScale = scale * this.globalIntensityScale;
    }
  }

  /**
   * Scalar illuminance at a point (used by AI perception for player light exposure):
   *   E = Σ_i  lum(c_i) · s_i · w(d_i, r_i) / (1 + d_i²),   lum(c) = 0.2126 r + 0.7152 g + 0.0722 b
   * with the same windowed inverse-square falloff as the shaders.
   */
  public illuminanceAt(point: Readonly<Vec3>): number {
    let illuminance = 0;
    for (const light of this.lights.values()) {
      if (light.effectiveScale <= 0.001) {
        continue;
      }
      const distance: number = vec3Distance(point, light.position);
      if (distance >= light.range) {
        continue;
      }
      const ratio: number = distance / light.range;
      const window: number = Math.pow(clamp(1 - ratio * ratio * ratio * ratio, 0, 1), 2);
      const luminance: number = 0.2126 * light.color[0] + 0.7152 * light.color[1] + 0.0722 * light.color[2];
      illuminance += (luminance * light.effectiveScale * window) / (1 + distance * distance);
    }
    return illuminance;
  }

  /** Selects the lights contributing most at `viewerPosition` and packs them for upload. */
  public collectRelevant(viewerPosition: Readonly<Vec3>, output: PackedLightBuffer): void {
    const candidates: Array<{ light: PointLight; score: number }> = [];
    for (const light of this.lights.values()) {
      if (light.effectiveScale <= 0.001) {
        continue;
      }
      const distance: number = vec3Distance(viewerPosition, light.position);
      if (distance > light.range * 2.2) {
        continue;
      }
      candidates.push({ light, score: light.effectiveScale / (1 + distance * distance * 0.15) });
    }
    candidates.sort((left, right) => right.score - left.score);
    const count: number = Math.min(MAX_FORWARD_LIGHTS, candidates.length);
    for (let index = 0; index < count; index += 1) {
      const light: PointLight = (candidates[index] as { light: PointLight }).light;
      output.positions[index * 3] = light.position[0];
      output.positions[index * 3 + 1] = light.position[1];
      output.positions[index * 3 + 2] = light.position[2];
      output.colors[index * 3] = light.color[0] * light.effectiveScale;
      output.colors[index * 3 + 1] = light.color[1] * light.effectiveScale;
      output.colors[index * 3 + 2] = light.color[2] * light.effectiveScale;
      output.ranges[index] = light.range;
    }
    output.count = count;
  }
}
