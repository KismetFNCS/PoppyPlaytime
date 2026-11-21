import type { MeshLibrary, ModelAsset } from '../assets/MeshLibrary';
import { CHOIR_MOTHER_HEAD_HEIGHT, HUSHLING_HEAD_HEIGHT } from '../assets/CampaignModels';
import type { LightDisturbanceSource } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4Multiply, mat4Translation } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { clamp } from '../math/Vec3';
import type { ThreatActorView } from './JesterEntity';
import type { ThreatKind } from './LevelStreamer';

/**
 * The Choir Mother view: a tripod crane that sways with each lurching step, a crown of heads that
 * slowly rotates as it listens, and a music-box heart whose glow swells with the hymn.
 */
export class ChoirMotherEntity implements ThreatActorView {
  public readonly kind: ThreatKind = 'choirMother';
  public position: Vec3 = [0, 0, 0];
  public yawRadians: number = 0;
  public gait: number = 0;
  public eyeGlow: number = 0.8;
  public scanAmount: number = 0;
  public lunging: boolean = false;
  public readonly disturbance: LightDisturbanceSource = { position: [0, 3, 0], radius: 8, strength: 0 };
  private animationTime: number = 0;
  private stridePhase: number = 0;
  private readonly model: ModelAsset;

  public constructor(meshes: MeshLibrary) {
    this.model = meshes.get('choir_mother');
  }

  public headPosition(): Vec3 {
    return [this.position[0], this.position[1] + CHOIR_MOTHER_HEAD_HEIGHT, this.position[2]];
  }

  public advanceAnimation(deltaSeconds: number): void {
    this.animationTime += deltaSeconds;
    // Three legs → three lurches per cycle; cycle rate rises with gait.
    this.stridePhase += deltaSeconds * Math.PI * 2 * (0.4 + clamp(this.gait, 0, 1) * 0.9);
    this.disturbance.position = [this.position[0], this.position[1] + 2.8, this.position[2]];
  }

  public collectDrawItems(output: DrawItem[]): void {
    const gait: number = clamp(this.gait, 0, 1);
    const lurch: number = Math.abs(Math.sin(this.stridePhase * 1.5)) * 0.08 * (0.3 + gait);
    const swayRoll: number = Math.sin(this.stridePhase * 1.5) * 0.05 * (0.4 + gait);
    const lean: number = 0.08 * gait + (this.lunging ? 0.4 : 0);
    const root: Mat4 = mat4Compose([this.position[0], this.position[1] + lurch, this.position[2]], [lean, this.yawRadians, swayRoll], [1, 1, 1]);
    // The crown turns slowly while listening, faster while searching.
    const crownYaw: number = Math.sin(this.animationTime * 0.45) * 0.5 + Math.sin(this.animationTime * 1.3) * 0.6 * this.scanAmount;
    const pivot: Mat4 = mat4Translation(0, CHOIR_MOTHER_HEAD_HEIGHT, 0);
    const unpivot: Mat4 = mat4Translation(0, -CHOIR_MOTHER_HEAD_HEIGHT, 0);
    const crown: Mat4 = mat4Multiply(root, mat4Multiply(mat4Multiply(pivot, mat4Compose([0, 0, 0], [0.05 * Math.sin(this.animationTime * 0.7), crownYaw, 0], [1, 1, 1])), unpivot));
    // Paper wings breathe open and closed.
    const wingBreath: number = 1 + 0.06 * Math.sin(this.animationTime * 1.1);
    const wingPivot: Mat4 = mat4Translation(0, 2.75, -0.25);
    const wingUnpivot: Mat4 = mat4Translation(0, -2.75, 0.25);
    const wings: Mat4 = mat4Multiply(root, mat4Multiply(mat4Multiply(wingPivot, mat4Compose([0, 0, 0], [0, 0, 0], [wingBreath, 1, 1])), wingUnpivot));
    const hymnSwell: number = this.eyeGlow * (0.7 + 0.3 * Math.sin(this.animationTime * 2.2));
    for (const part of this.model.parts) {
      const matrix: Mat4 = part.partId === 'heads' ? crown : part.partId === 'wings' ? wings : root;
      output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: matrix, emissiveBoost: part.partId === 'heart' ? hymnSwell : 1 });
    }
  }
}

/**
 * Hushling view: a tiny figurine that waddles stiffly while moving, trembles with a fine porcelain
 * shiver when frozen in light, and keeps its pinprick eyes lit.
 */
export class HushlingEntity implements ThreatActorView {
  public readonly kind: ThreatKind = 'hushling';
  public position: Vec3 = [0, 0, 0];
  public yawRadians: number = 0;
  public gait: number = 0;
  public eyeGlow: number = 1;
  public scanAmount: number = 0;
  public lunging: boolean = false;
  public readonly disturbance: LightDisturbanceSource = { position: [0, 0.5, 0], radius: 1, strength: 0 };
  private animationTime: number = 0;
  private readonly model: ModelAsset;
  private readonly phaseOffset: number = Math.random() * 10;

  public constructor(meshes: MeshLibrary) {
    this.model = meshes.get('hushling');
  }

  public headPosition(): Vec3 {
    return [this.position[0], this.position[1] + HUSHLING_HEAD_HEIGHT, this.position[2]];
  }

  public advanceAnimation(deltaSeconds: number): void {
    this.animationTime += deltaSeconds;
    this.disturbance.position = [this.position[0], this.position[1] + 0.5, this.position[2]];
  }

  public collectDrawItems(output: DrawItem[]): void {
    const time: number = this.animationTime + this.phaseOffset;
    const gait: number = clamp(this.gait, 0, 1);
    // Waddle: rock side to side at stride frequency; a stationary figurine shivers instead.
    const waddle: number = Math.sin(time * 14) * 0.18 * gait;
    const shiver: number = gait < 0.05 ? Math.sin(time * 61) * 0.012 : 0;
    const hop: number = Math.abs(Math.sin(time * 14)) * 0.03 * gait;
    const lean: number = this.lunging ? 0.55 : 0.1 * gait;
    const root: Mat4 = mat4Compose([this.position[0] + shiver, this.position[1] + hop, this.position[2]], [lean, this.yawRadians, waddle], [1, 1, 1]);
    for (const part of this.model.parts) {
      output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: root, emissiveBoost: part.partId === 'eyes' ? this.eyeGlow : 1 });
    }
  }
}
