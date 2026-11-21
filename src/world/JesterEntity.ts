import type { MeshLibrary, ModelAsset } from '../assets/MeshLibrary';
import { JESTER_HEAD_HEIGHT } from '../assets/ProceduralModels';
import type { LightDisturbanceSource } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4Multiply, mat4Translation } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { clamp } from '../math/Vec3';
import type { ThreatKind } from './LevelStreamer';

/** Animation-facing view of any threat. The AI brain owns behaviour; views own presentation. */
export interface ThreatActorView {
  readonly kind: ThreatKind;
  position: Vec3;
  yawRadians: number;
  /** 0 = standing still, 1 = full-speed locomotion; drives gait amplitude. */
  gait: number;
  /** Emissive multiplier for eyes / lamps. */
  eyeGlow: number;
  /** 0..1 head-scanning amount (alert search sweeps). */
  scanAmount: number;
  /** True during the catch lunge. */
  lunging: boolean;
  readonly disturbance: LightDisturbanceSource;
  headPosition(): Vec3;
  advanceAnimation(deltaSeconds: number): void;
  collectDrawItems(output: DrawItem[]): void;
}

/**
 * The Jester Entity view: imported model with procedural secondary motion (breathing sway, gait bob,
 * twitching head). Behaviour is driven externally by an EntityBrain or a cinematic.
 */
export class JesterEntity implements ThreatActorView {
  public readonly kind: ThreatKind = 'jester';
  public position: Vec3 = [0, 0, 0];
  public yawRadians: number = 0;
  public gait: number = 0;
  public eyeGlow: number = 1;
  public scanAmount: number = 0;
  public lunging: boolean = false;
  /** Extra head roll/tilt; raised for menus and jumpscares. */
  public headTwitchStrength: number = 0.25;
  public readonly disturbance: LightDisturbanceSource = { position: [0, 2, 0], radius: 9, strength: 0 };
  private animationTime: number = 0;
  private readonly model: ModelAsset;

  public constructor(meshes: MeshLibrary) {
    this.model = meshes.get('jester_entity');
  }

  public headPosition(): Vec3 {
    return [this.position[0], this.position[1] + JESTER_HEAD_HEIGHT, this.position[2]];
  }

  public advanceAnimation(deltaSeconds: number): void {
    this.animationTime += deltaSeconds;
    this.disturbance.position = [this.position[0], this.position[1] + 2.2, this.position[2]];
  }

  /** Alias kept for menu / cinematic callers that only need idle motion. */
  public updateIdle(deltaSeconds: number): void {
    this.advanceAnimation(deltaSeconds);
  }

  public collectDrawItems(output: DrawItem[]): void {
    const time: number = this.animationTime;
    const gait: number = clamp(this.gait, 0, 1);
    const stride: number = 0.25 + gait * 0.75;
    const sway: number = Math.sin(time * 1.7) * 0.035 + Math.sin(time * 7.3) * 0.01 * stride;
    const bob: number = Math.abs(Math.sin(time * (3.1 + gait * 4))) * 0.04 * stride;
    const lean: number = 0.06 * stride + (this.lunging ? 0.35 : 0);
    const root: Mat4 = mat4Compose([this.position[0], this.position[1] + bob, this.position[2]], [lean, this.yawRadians, sway], [1, 1, 1]);
    const twitchTick: number = Math.floor(time * 6);
    const twitchNoise: number = Math.sin(twitchTick * 12.9898) * 43758.5453;
    const twitchAmount: number = (twitchNoise - Math.floor(twitchNoise) - 0.5) * this.headTwitchStrength;
    const scanYaw: number = Math.sin(time * 1.3) * 0.9 * this.scanAmount;
    const headTilt: number = Math.sin(time * 0.9) * 0.22 + twitchAmount;
    const pivot: Mat4 = mat4Translation(0, JESTER_HEAD_HEIGHT - 0.15, 0);
    const unpivot: Mat4 = mat4Translation(0, -(JESTER_HEAD_HEIGHT - 0.15), 0);
    const headLocal: Mat4 = mat4Multiply(mat4Multiply(pivot, mat4Compose([0, 0, 0], [twitchAmount * 0.4, twitchAmount * 0.6 + scanYaw, headTilt], [1, 1, 1])), unpivot);
    const headWorld: Mat4 = mat4Multiply(root, headLocal);
    const eyePulse: number = this.eyeGlow * (0.75 + 0.25 * Math.sin(time * 5.1));
    for (const part of this.model.parts) {
      const isHeadPart: boolean = part.partId === 'head' || part.partId === 'eyes';
      output.push({
        mesh: part.gpuMesh,
        materialId: part.materialId,
        modelMatrix: isHeadPart ? headWorld : root,
        emissiveBoost: part.partId === 'eyes' ? eyePulse : part.partId === 'head' ? 0.6 + eyePulse * 0.4 : 1,
      });
    }
  }
}
