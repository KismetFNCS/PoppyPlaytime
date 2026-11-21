import type { MeshLibrary, ModelAsset } from '../assets/MeshLibrary';
import { TALLYMAN_HEAD_HEIGHT } from '../assets/ProceduralModels';
import type { LightDisturbanceSource } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4Multiply, mat4Translation } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { clamp } from '../math/Vec3';
import type { ThreatActorView } from './JesterEntity';
import type { ThreatKind } from './LevelStreamer';

/**
 * The Tallyman view: a stilted, metronomic gait (vertical bob locked to stride), a lantern head that
 * sweeps side to side while searching, and a sight-slit whose glow tracks awareness.
 */
export class TallymanEntity implements ThreatActorView {
  public readonly kind: ThreatKind = 'tallyman';
  public position: Vec3 = [0, 0, 0];
  public yawRadians: number = 0;
  public gait: number = 0;
  public eyeGlow: number = 0.7;
  public scanAmount: number = 0;
  public lunging: boolean = false;
  public readonly disturbance: LightDisturbanceSource = { position: [0, 2, 0], radius: 6, strength: 0 };
  private animationTime: number = 0;
  private stridePhase: number = 0;
  private readonly model: ModelAsset;

  public constructor(meshes: MeshLibrary) {
    this.model = meshes.get('tallyman_entity');
  }

  public headPosition(): Vec3 {
    return [this.position[0], this.position[1] + TALLYMAN_HEAD_HEIGHT, this.position[2]];
  }

  public advanceAnimation(deltaSeconds: number): void {
    this.animationTime += deltaSeconds;
    // Stride frequency rises with gait: 0.9 Hz shuffle → 2.4 Hz run.
    this.stridePhase += deltaSeconds * Math.PI * 2 * (0.9 + clamp(this.gait, 0, 1) * 1.5);
    this.disturbance.position = [this.position[0], this.position[1] + 2.1, this.position[2]];
  }

  public collectDrawItems(output: DrawItem[]): void {
    const gait: number = clamp(this.gait, 0, 1);
    // Bob peaks twice per stride (each footfall): |sin|.
    const bob: number = Math.abs(Math.sin(this.stridePhase)) * 0.06 * gait;
    const roll: number = Math.sin(this.stridePhase) * 0.04 * gait;
    const lean: number = 0.12 * gait + (this.lunging ? 0.45 : 0);
    const root: Mat4 = mat4Compose([this.position[0], this.position[1] + bob, this.position[2]], [lean, this.yawRadians, roll], [1, 1, 1]);
    const scanYaw: number = Math.sin(this.animationTime * 1.1) * 1.1 * this.scanAmount;
    const pivot: Mat4 = mat4Translation(0, TALLYMAN_HEAD_HEIGHT - 0.2, 0);
    const unpivot: Mat4 = mat4Translation(0, -(TALLYMAN_HEAD_HEIGHT - 0.2), 0);
    const headWorld: Mat4 = mat4Multiply(root, mat4Multiply(mat4Multiply(pivot, mat4Compose([0, 0, 0], [0, scanYaw, 0], [1, 1, 1])), unpivot));
    const flicker: number = 0.85 + 0.15 * Math.sin(this.animationTime * 23);
    for (const part of this.model.parts) {
      output.push({
        mesh: part.gpuMesh,
        materialId: part.materialId,
        modelMatrix: part.partId === 'lamp' ? headWorld : root,
        emissiveBoost: part.partId === 'lamp' ? this.eyeGlow * flicker : part.partId === 'dial' ? 0.5 + this.eyeGlow * 0.3 : 1,
      });
    }
  }
}
