import type { MeshLibrary, ModelAsset } from '../assets/MeshLibrary';
import { CHERUB_HEAD_HEIGHT, SERAPH_HEAD_HEIGHT } from '../assets/ProceduralModels';
import type { LightDisturbanceSource } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4FromBasis, mat4Multiply } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { clamp, vec3Normalize } from '../math/Vec3';
import type { ThreatActorView } from './JesterEntity';
import type { ThreatKind } from './LevelStreamer';

/**
 * Cherub: a knee-high clockwork tin angel. It waddles on stubby legs while its tin wings buzz; it never actually flies.
 */
export class CherubEntity implements ThreatActorView {
  public readonly kind: ThreatKind = 'cherub';
  public position: Vec3 = [0, 0, 0];
  public yawRadians: number = 0;
  public gait: number = 0;
  public eyeGlow: number = 1;
  public scanAmount: number = 0;
  public lunging: boolean = false;
  public readonly disturbance: LightDisturbanceSource = { position: [0, 0.5, 0], radius: 1, strength: 0 };
  private animationTime: number = Math.random() * 10;
  private readonly model: ModelAsset;

  public constructor(meshes: MeshLibrary) {
    this.model = meshes.get('cherub_entity');
  }

  public headPosition(): Vec3 {
    return [this.position[0], this.position[1] + CHERUB_HEAD_HEIGHT, this.position[2]];
  }

  public advanceAnimation(deltaSeconds: number): void {
    this.animationTime += deltaSeconds;
    this.disturbance.position = [this.position[0], this.position[1] + 0.5, this.position[2]];
  }

  public collectDrawItems(output: DrawItem[]): void {
    const time: number = this.animationTime;
    const gait: number = clamp(this.gait, 0, 1);
    const waddle: number = Math.sin(time * 9) * 0.16 * gait;
    const hop: number = Math.abs(Math.sin(time * 9)) * 0.025 * gait;
    const lean: number = this.lunging ? 0.5 : 0.08 * gait;
    const root: Mat4 = mat4Compose([this.position[0], this.position[1] + hop, this.position[2]], [lean, this.yawRadians, waddle], [1, 1, 1]);
    const flap: number = 0.35 + Math.sin(time * (gait > 0.05 || this.lunging ? 38 : 6)) * (gait > 0.05 || this.lunging ? 0.45 : 0.12);
    for (const part of this.model.parts) {
      if (part.partId === 'wing') {
        for (const side of [-1, 1] as const) {
          const hinge: Mat4 = mat4Compose([side * 0.06, 0.44, -0.12], [0, side === 1 ? -0.5 : Math.PI + 0.5, side * flap], [1, 1, 1]);
          output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: mat4Multiply(root, hinge), emissiveBoost: 1 });
        }
        continue;
      }
      output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: root, emissiveBoost: part.partId === 'eyes' ? this.eyeGlow : 1 });
    }
  }
}

/**
 * The Seraph: a tall robed mannequin. Two wings cross over its face, two fold around its body, two spread wide; they
 * breathe slowly while it walks and flare open when it lunges.
 */
export class SeraphEntity implements ThreatActorView {
  public readonly kind: ThreatKind = 'seraph';
  public position: Vec3 = [0, 0, 0];
  public yawRadians: number = 0;
  public gait: number = 0;
  public eyeGlow: number = 1;
  public scanAmount: number = 0;
  public lunging: boolean = false;
  public readonly disturbance: LightDisturbanceSource = { position: [0, 2, 0], radius: 7, strength: 0 };
  private animationTime: number = 0;
  private readonly model: ModelAsset;

  public constructor(meshes: MeshLibrary) {
    this.model = meshes.get('seraph_entity');
  }

  public headPosition(): Vec3 {
    return [this.position[0], this.position[1] + SERAPH_HEAD_HEIGHT, this.position[2]];
  }

  public advanceAnimation(deltaSeconds: number): void {
    this.animationTime += deltaSeconds;
    this.disturbance.position = [this.position[0], this.position[1] + 2, this.position[2]];
  }

  public collectDrawItems(output: DrawItem[]): void {
    const time: number = this.animationTime;
    const gait: number = clamp(this.gait, 0, 1);
    // It glides: no bob, only a slow sway.
    const sway: number = Math.sin(time * 1.1) * 0.03 + Math.sin(time * 3.2) * 0.015 * gait;
    const lean: number = this.lunging ? 0.3 : 0.04 * gait;
    const root: Mat4 = mat4Compose([this.position[0], this.position[1], this.position[2]], [lean, this.yawRadians, sway], [1, 1, 1]);
    const breathe: number = Math.sin(time * 1.6) * 0.08;
    const flare: number = this.lunging ? 1 : 0;
    const wings: Mat4[] = [];
    // Each wing: hinge point and the direction its blades run, in the Seraph's local space (+Z forward, +X its left).
    const wing = (hinge: Vec3, direction: Vec3): void => {
      const along: Vec3 = vec3Normalize(direction);
      const upHint: Vec3 = Math.abs(along[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
      // Blade width runs along the hint projected off the blade direction; thickness along their cross product.
      const dot: number = upHint[0] * along[0] + upHint[1] * along[1] + upHint[2] * along[2];
      const width: Vec3 = vec3Normalize([upHint[0] - along[0] * dot, upHint[1] - along[1] * dot, upHint[2] - along[2] * dot]);
      const thickness: Vec3 = [along[1] * width[2] - along[2] * width[1], along[2] * width[0] - along[0] * width[2], along[0] * width[1] - along[1] * width[0]];
      wings.push(mat4Multiply(root, mat4FromBasis(hinge, along, width, thickness)));
    };
    for (const side of [-1, 1] as const) {
      // Face wings cross in an X over the face; on a lunge they swing open.
      wing([side * 0.16, SERAPH_HEAD_HEIGHT + side * 0.04, 0.2], [-side * (1 - flare * 0.8), -side * 0.25 + flare * 0.5, 0.25 + flare * 0.6]);
      // Body wings curl around the front of the robe.
      wing([side * 0.32, 1.55, 0.02], [-side * (0.55 - flare * 0.4), -0.2, 0.85]);
      // Outer wings spread up and back from the shoulders, lifting on a lunge.
      wing([side * 0.22, 2.15, -0.15], [side * 0.9, 0.45 + breathe + flare * 0.5, -0.3]);
    }
    for (const part of this.model.parts) {
      if (part.partId === 'wing') {
        for (const matrix of wings) {
          output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: matrix, emissiveBoost: 1 });
        }
        continue;
      }
      output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: root, emissiveBoost: part.partId === 'eyes' ? this.eyeGlow * 1.4 : 1 });
    }
  }
}
