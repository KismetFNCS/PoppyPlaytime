import type { MeshLibrary, ModelAsset, ModelPart } from '../assets/MeshLibrary';
import { JESTER_HEAD_HEIGHT } from '../assets/ProceduralModels';
import type { LightDisturbanceSource } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4Multiply, mat4Translation } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { clamp, vec3Distance, vec3Dot, vec3Normalize, vec3Subtract } from '../math/Vec3';
import type { LevelStreamer } from './LevelStreamer';

export type JesterBehaviorMode = 'dormant' | 'stalking' | 'frozen' | 'lunging';

export interface JesterObserver {
  readonly position: Readonly<Vec3>;
  readonly viewDirection: Readonly<Vec3>;
}

export interface JesterTuning {
  readonly speedUnobserved: number;
  readonly speedObserved: number;
  readonly catchDistance: number;
  readonly observationConeCosine: number;
  readonly collisionRadius: number;
}

export const DEFAULT_JESTER_TUNING: JesterTuning = {
  speedUnobserved: 4.6,
  speedObserved: 0.9,
  catchDistance: 1.25,
  observationConeCosine: Math.cos((38 * Math.PI) / 180),
  collisionRadius: 0.45,
};

/**
 * The Jester Entity: renders the imported model with procedural secondary motion and implements a
 * look-away stalking behaviour — it crawls while watched and surges when the observer looks away.
 */
export class JesterEntity {
  public position: Vec3 = [0, 0, 0];
  public yawRadians: number = 0;
  public mode: JesterBehaviorMode = 'dormant';
  public readonly disturbance: LightDisturbanceSource = { position: [0, 2, 0], radius: 9, strength: 0 };
  private animationTime: number = 0;
  private readonly model: ModelAsset;
  /** Extra head roll/tilt for menu idle and jumpscare twitching. */
  public headTwitchStrength: number = 0.25;
  public eyeGlow: number = 1;

  public constructor(meshes: MeshLibrary, private readonly tuning: JesterTuning = DEFAULT_JESTER_TUNING) {
    this.model = meshes.get('jester_entity');
  }

  public isObservedBy(observer: JesterObserver): boolean {
    const toEntity: Vec3 = vec3Normalize(vec3Subtract([this.position[0], JESTER_HEAD_HEIGHT * 0.7, this.position[2]], observer.position));
    return vec3Dot(toEntity, observer.viewDirection) > this.tuning.observationConeCosine;
  }

  public distanceTo(point: Readonly<Vec3>): number {
    return vec3Distance([this.position[0], 0, this.position[2]], [point[0], 0, point[2]]);
  }

  /** Returns true on the frame the entity catches the observer. */
  public updateStalking(deltaSeconds: number, observer: JesterObserver, streamer: LevelStreamer): boolean {
    this.animationTime += deltaSeconds;
    if (this.mode === 'dormant') {
      this.disturbance.strength = 0;
      return false;
    }
    const observed: boolean = this.isObservedBy(observer);
    this.mode = observed ? 'frozen' : 'stalking';
    const speed: number = observed ? this.tuning.speedObserved : this.tuning.speedUnobserved;
    const toTarget: Vec3 = vec3Subtract([observer.position[0], 0, observer.position[2]], [this.position[0], 0, this.position[2]]);
    const distance: number = Math.hypot(toTarget[0], toTarget[2]);
    if (distance > 1e-4) {
      const step: number = Math.min(distance, speed * deltaSeconds);
      this.position[0] += (toTarget[0] / distance) * step;
      this.position[2] += (toTarget[2] / distance) * step;
      this.yawRadians = Math.atan2(toTarget[0], toTarget[2]);
    }
    streamer.resolveCircleCollision(this.position, this.tuning.collisionRadius);
    this.disturbance.position = [this.position[0], 2.2, this.position[2]];
    this.disturbance.strength = clamp(1 - distance / 18, 0, 1);
    return distance < this.tuning.catchDistance;
  }

  public updateIdle(deltaSeconds: number): void {
    this.animationTime += deltaSeconds;
  }

  /** Emits draw items for every model part, with breathing sway on the body and a twitching head. */
  public collectDrawItems(output: DrawItem[]): void {
    const time: number = this.animationTime;
    const stalkingGait: number = this.mode === 'stalking' ? 1 : 0.25;
    const sway: number = Math.sin(time * 1.7) * 0.035 + Math.sin(time * 7.3) * 0.01 * stalkingGait;
    const bob: number = Math.abs(Math.sin(time * 3.1)) * 0.04 * stalkingGait;
    const root: Mat4 = mat4Compose([this.position[0], this.position[1] + bob, this.position[2]], [0.06 * stalkingGait, this.yawRadians, sway], [1, 1, 1]);
    const twitchTick: number = Math.floor(time * 6);
    const twitch: number = Math.sin(twitchTick * 12.9898) * 43758.5453;
    const twitchAmount: number = (twitch - Math.floor(twitch) - 0.5) * this.headTwitchStrength;
    const headTilt: number = Math.sin(time * 0.9) * 0.22 + twitchAmount;
    const pivot: Mat4 = mat4Translation(0, JESTER_HEAD_HEIGHT - 0.15, 0);
    const unpivot: Mat4 = mat4Translation(0, -(JESTER_HEAD_HEIGHT - 0.15), 0);
    const headLocal: Mat4 = mat4Multiply(mat4Multiply(pivot, mat4Compose([0, 0, 0], [twitchAmount * 0.4, twitchAmount * 0.6, headTilt], [1, 1, 1])), unpivot);
    const headWorld: Mat4 = mat4Multiply(root, headLocal);
    const eyePulse: number = this.eyeGlow * (0.75 + 0.25 * Math.sin(time * 5.1));
    for (const part of this.model.parts as readonly ModelPart[]) {
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
