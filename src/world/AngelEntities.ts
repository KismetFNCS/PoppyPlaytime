import type { MeshLibrary, ModelAsset } from '../assets/MeshLibrary';
import { CHERUB_HEAD_HEIGHT, SERAPH_HEAD_HEIGHT } from '../assets/ProceduralModels';
import type { LightDisturbanceSource } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4FromBasis, mat4Multiply, mat4Translation } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { clamp, vec3Normalize } from '../math/Vec3';
import type { ThreatActorView } from './JesterEntity';
import type { ThreatKind } from './LevelStreamer';

export type CherubAlarmState = 'passive' | 'alarm' | 'fleeing';

/**
 * Cherub Cheeks: a cry-baby vinyl doll. It sits with its back to the player; when the player comes close its head
 * snaps round, its mouth splits open and it wails, then it drops flat and scurries off into the walls.
 * Behaviour is driven by the level (see ActiveLevelStreamerState.updateCherubs); the brain stays dormant.
 */
export class CherubEntity implements ThreatActorView {
  public readonly kind: ThreatKind = 'cherub';
  public position: Vec3 = [0, 0, 0];
  public yawRadians: number = Math.PI;
  public gait: number = 0;
  public eyeGlow: number = 1;
  public scanAmount: number = 0;
  public lunging: boolean = false;
  public readonly disturbance: LightDisturbanceSource = { position: [0, 0.5, 0], radius: 1, strength: 0 };
  public alarmState: CherubAlarmState = 'passive';
  public alarmSeconds: number = 0;
  /** Where it sat: the acid puddle stays here even after it flees. */
  public puddlePosition: Vec3 | null = null;
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
    if (this.alarmState !== 'passive') {
      this.alarmSeconds += deltaSeconds;
    }
    if (this.puddlePosition === null) {
      this.puddlePosition = [this.position[0], 0, this.position[2]];
    }
    this.disturbance.position = [this.position[0], this.position[1] + 0.5, this.position[2]];
  }

  public collectDrawItems(output: DrawItem[]): void {
    const time: number = this.animationTime;
    const fleeing: boolean = this.alarmState === 'fleeing';
    // Passive: perfectly still but for a faint rocking. Fleeing: flat on its stomach, juddering.
    const rock: number = this.alarmState === 'passive' ? Math.sin(time * 0.8) * 0.02 : 0;
    const judder: number = fleeing ? Math.sin(time * 40) * 0.12 : this.alarmState === 'alarm' ? Math.sin(time * 70) * 0.02 : 0;
    const pitch: number = fleeing ? Math.PI / 2 - 0.15 : 0;
    const lift: number = fleeing ? 0.16 : 0;
    const root: Mat4 = mat4Compose([this.position[0], this.position[1] + lift, this.position[2]], [pitch, this.yawRadians, rock + judder], [1, 1, 1]);
    // The head snaps 180 degrees round to face the player the instant the alarm trips (no in-between frames).
    const headTurn: number = this.alarmState === 'passive' ? 0 : Math.PI;
    const neck: Mat4 = mat4Translation(0, CHERUB_HEAD_HEIGHT - 0.2, 0);
    const unneck: Mat4 = mat4Translation(0, -(CHERUB_HEAD_HEIGHT - 0.2), 0);
    const head: Mat4 = mat4Multiply(root, mat4Multiply(mat4Multiply(neck, mat4Compose([0, 0, 0], [0, headTurn, judder * 2], [1, 1, 1])), unneck));
    // Mouth splitting open: the void and gears swell around the mouth.
    const split: number = this.alarmState === 'passive' ? 1 : 1.6 + Math.sin(time * 30) * 0.1;
    const mouthCentre: Vec3 = [0, CHERUB_HEAD_HEIGHT - 0.11, 0.235];
    const mouth: Mat4 = mat4Multiply(
      head,
      mat4Multiply(mat4Translation(mouthCentre[0], mouthCentre[1], mouthCentre[2]), mat4Multiply(mat4Compose([0, 0, 0], [0, 0, 0], [split, split, 1]), mat4Translation(-mouthCentre[0], -mouthCentre[1], -mouthCentre[2]))),
    );
    // The rose's stem pulses.
    const pulse: number = 1 + Math.sin(time * 3.4) * 0.06;
    for (const part of this.model.parts) {
      switch (part.partId) {
        case 'puddle':
          if (this.puddlePosition !== null) {
            output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: mat4Translation(this.puddlePosition[0], 0, this.puddlePosition[2]), emissiveBoost: 0.7 });
          }
          break;
        case 'body':
          output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: root, emissiveBoost: 1 });
          break;
        case 'gears':
        case 'voids':
          output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: part.partId === 'gears' || this.alarmState !== 'passive' ? mouth : head, emissiveBoost: 1 });
          break;
        case 'stem':
          output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: mat4Multiply(head, mat4Compose([0, 0, 0], [0, 0, 0], [pulse, 1, pulse])), emissiveBoost: 1 });
          break;
        case 'tears':
          output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: head, emissiveBoost: this.alarmState === 'passive' ? 0.8 : 1.6 });
          break;
        default:
          output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: head, emissiveBoost: 1 });
      }
    }
  }
}

/** Ceiling height the Seraph clings to (corridor height minus its own thickness). */
const SERAPH_CEILING_Y: number = 4.25;

/**
 * Seraphim Sam: a towering parade marionette on a single wheel with six tool arms. It crawls along the ceiling, lying
 * belly-down with its red eye watching, until something brings it down; then it drops and rights itself on its wheel.
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
  /** 0 = clinging to the ceiling, 1 = upright on the floor. */
  public dropProgress: number = 0;
  public dropping: boolean = false;
  private animationTime: number = 0;
  private wheelAngle: number = 0;
  private readonly model: ModelAsset;

  public constructor(meshes: MeshLibrary) {
    this.model = meshes.get('seraph_entity');
  }

  public get onCeiling(): boolean {
    return this.dropProgress <= 0 && !this.dropping;
  }

  /** World position of the red camera eye (the tell, and the gaze target). */
  public eyePosition(): Vec3 {
    const t: number = this.dropProgress;
    const ceilingEye: Vec3 = [this.position[0] - Math.sin(this.yawRadians) * 0.6, SERAPH_CEILING_Y - 0.35, this.position[2] - Math.cos(this.yawRadians) * 0.6];
    const floorEye: Vec3 = [this.position[0], this.position[1] + SERAPH_HEAD_HEIGHT, this.position[2]];
    return [ceilingEye[0] + (floorEye[0] - ceilingEye[0]) * t, ceilingEye[1] + (floorEye[1] - ceilingEye[1]) * t, ceilingEye[2] + (floorEye[2] - ceilingEye[2]) * t];
  }

  public headPosition(): Vec3 {
    return this.eyePosition();
  }

  public startDrop(): void {
    this.dropping = true;
  }

  public advanceAnimation(deltaSeconds: number): void {
    this.animationTime += deltaSeconds;
    if (this.dropping) {
      this.dropProgress = Math.min(1, this.dropProgress + deltaSeconds / 0.55);
      if (this.dropProgress >= 1) this.dropping = false;
    }
    this.wheelAngle += this.gait * deltaSeconds * 8;
    this.disturbance.position = [this.position[0], this.position[1] + 2, this.position[2]];
  }

  public collectDrawItems(output: DrawItem[]): void {
    const time: number = this.animationTime;
    const t: number = this.dropProgress;
    const eased: number = t * t * (3 - 2 * t);
    const gait: number = clamp(this.gait, 0, 1);
    // Ceiling pose: lying along its heading, belly down, centred over its floor position. Floor pose: upright.
    const pitch: number = (Math.PI / 2) * (1 - eased);
    const height: number = SERAPH_CEILING_Y * (1 - eased);
    const back: number = -1.6 * (1 - eased);
    const sway: number = Math.sin(time * 1.3) * 0.03 * eased;
    const lean: number = (this.lunging ? 0.3 : 0.05 * gait) * eased;
    const root: Mat4 = mat4Multiply(
      mat4Compose([this.position[0], this.position[1] + height, this.position[2]], [0, this.yawRadians, 0], [1, 1, 1]),
      mat4Multiply(mat4Translation(0, 0, back), mat4Compose([0, 0, 0], [pitch + lean, 0, sway], [1, 1, 1])),
    );
    // Arms: on the ceiling they grip overhead (local -Z); on the floor they spread: shears forward, saws out, needles up.
    const arms: Array<{ readonly part: string; readonly matrix: Mat4 }> = [];
    const arm = (part: string, hinge: Vec3, ceilingDirection: Vec3, floorDirection: Vec3): void => {
      const direction: Vec3 = vec3Normalize([
        ceilingDirection[0] + (floorDirection[0] - ceilingDirection[0]) * eased,
        ceilingDirection[1] + (floorDirection[1] - ceilingDirection[1]) * eased,
        ceilingDirection[2] + (floorDirection[2] - ceilingDirection[2]) * eased,
      ]);
      const upHint: Vec3 = Math.abs(direction[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0];
      const dot: number = upHint[0] * direction[0] + upHint[1] * direction[1] + upHint[2] * direction[2];
      const width: Vec3 = vec3Normalize([upHint[0] - direction[0] * dot, upHint[1] - direction[1] * dot, upHint[2] - direction[2] * dot]);
      const depth: Vec3 = [direction[1] * width[2] - direction[2] * width[1], direction[2] * width[0] - direction[0] * width[2], direction[0] * width[1] - direction[1] * width[0]];
      arms.push({ part, matrix: mat4Multiply(root, mat4FromBasis(hinge, direction, width, depth)) });
    };
    const reach: number = Math.sin(time * 2.1) * 0.12 + (this.lunging ? 0.4 : 0);
    for (const side of [-1, 1] as const) {
      arm('armShears', [side * 0.62, 2.86, 0.1], [side * 0.5, 0.6, -0.8], [side * (0.45 - reach * 0.3), -0.25, 0.85 + reach]);
      arm('armSaw', [side * 0.7, 2.8, 0], [side * 0.8, -0.4, -0.6], [side * 0.95, 0.05 + Math.sin(time * 1.4 + side) * 0.1, 0.2]);
      arm('armNeedle', [side * 0.55, 2.9, -0.1], [side * 0.3, 0.9, -0.5], [side * 0.45, 0.75, 0.4]);
    }
    const wheel: Mat4 = mat4Multiply(root, mat4Multiply(mat4Translation(0, 0.42, 0), mat4Multiply(mat4Compose([0, 0, 0], [this.wheelAngle, 0, 0], [1, 1, 1]), mat4Translation(0, -0.42, 0))));
    void wheel;
    for (const part of this.model.parts) {
      if (part.partId === 'armShears' || part.partId === 'armSaw' || part.partId === 'armNeedle') {
        for (const entry of arms) {
          if (entry.part === part.partId) output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: entry.matrix, emissiveBoost: 1 });
        }
        continue;
      }
      const glow: number = part.partId === 'eyes' ? this.eyeGlow * (this.onCeiling ? 1.8 : 1.3) * (0.8 + 0.2 * Math.sin(time * 6)) : 1;
      output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: root, emissiveBoost: glow });
    }
  }
}
