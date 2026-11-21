import type { MeshLibrary, ModelAsset } from '../assets/MeshLibrary';
import { PIP_LANTERN_OFFSET } from '../assets/CampaignModels';
import { LIGHT_PALETTE } from '../config/GameConstants';
import type { LightingSystem, PointLight } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4TransformPoint } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { clamp, damp } from '../math/Vec3';
import type { LevelStreamer, VentRecord } from './LevelStreamer';

export type PipState = 'dormant' | 'following' | 'toVent' | 'inVent' | 'returning';

export interface PipTuning {
  /** Desired offset from the player in their yaw frame: (right, back). */
  readonly followOffset: readonly [number, number];
  readonly cruiseSpeed: number;
  readonly sprintSpeed: number;
  /** Farther than this from its follow point, Pip catches up instantly (wound-up dash). */
  readonly leashDistance: number;
  readonly ventCrawlSeconds: number;
  readonly lanternIntensity: number;
  readonly lanternRange: number;
}

export const DEFAULT_PIP_TUNING: PipTuning = {
  followOffset: [0.7, 1.1],
  cruiseSpeed: 3.4,
  sprintSpeed: 6.2,
  leashDistance: 11,
  ventCrawlSeconds: 2.4,
  lanternIntensity: 2.8,
  lanternRange: 6,
};

export interface PipEvents {
  readonly ventOpened: (vent: VentRecord) => void;
}

/**
 * Pip, the wind-up repair mouse. Follows the player as a moving light source (its lantern is a real
 * point light, so it freezes Hushlings), and can be sent through vents to trip releases.
 */
export class PipCompanion {
  public state: PipState = 'dormant';
  public position: Vec3 = [0, 0, 0];
  public yawRadians: number = 0;
  private speed: number = 0;
  private wheelPhase: number = 0;
  private bobPhase: number = 0;
  private ventTarget: VentRecord | null = null;
  private ventTimer: number = 0;
  private lantern: PointLight | null = null;
  private lanternFlicker: number = 1;
  private readonly model: ModelAsset;

  public constructor(meshes: MeshLibrary, private readonly lighting: LightingSystem, private readonly events: PipEvents, public readonly tuning: PipTuning = DEFAULT_PIP_TUNING) {
    this.model = meshes.get('pip_companion');
  }

  public get isActive(): boolean {
    return this.state !== 'dormant';
  }

  public get isBusy(): boolean {
    return this.state === 'toVent' || this.state === 'inVent';
  }

  /** Wakes Pip at a position (wound up by the player, or restored from a save). */
  public activate(position: Readonly<Vec3>, yawRadians: number): void {
    this.position = [position[0], 0, position[2]];
    this.yawRadians = yawRadians;
    this.state = 'following';
    if (this.lantern === null) {
      this.lantern = this.lighting.add({
        position: this.lanternWorldPosition(),
        color: LIGHT_PALETTE.sodiumAmber,
        intensity: this.tuning.lanternIntensity,
        range: this.tuning.lanternRange,
        behavior: { kind: 'steady' },
      });
    }
  }

  public sendToVent(vent: VentRecord): boolean {
    if (this.state !== 'following') {
      return false;
    }
    this.ventTarget = vent;
    this.state = 'toVent';
    return true;
  }

  private modelMatrix(): Mat4 {
    const bob: number = Math.abs(Math.sin(this.bobPhase)) * 0.015 * clamp(this.speed / this.tuning.cruiseSpeed, 0, 1);
    return mat4Compose([this.position[0], this.position[1] + bob, this.position[2]], [0, this.yawRadians, 0], [1.3, 1.3, 1.3]);
  }

  private lanternWorldPosition(): Vec3 {
    return mat4TransformPoint(this.modelMatrix(), PIP_LANTERN_OFFSET);
  }

  /** Steers toward a goal on the ground plane; returns remaining distance. */
  private steerToward(goal: Readonly<Vec3>, maximumSpeed: number, deltaSeconds: number, streamer: LevelStreamer): number {
    const deltaX: number = goal[0] - this.position[0];
    const deltaZ: number = goal[2] - this.position[2];
    const distance: number = Math.hypot(deltaX, deltaZ);
    // Arrive behaviour: speed ramps down inside 1.2 m so Pip settles instead of orbiting.
    const desiredSpeed: number = distance < 0.08 ? 0 : Math.min(maximumSpeed, maximumSpeed * (distance / 1.2));
    this.speed = damp(this.speed, desiredSpeed, 8, deltaSeconds);
    if (distance > 1e-3) {
      const step: number = Math.min(distance, this.speed * deltaSeconds);
      this.position[0] += (deltaX / distance) * step;
      this.position[2] += (deltaZ / distance) * step;
      const desiredYaw: number = Math.atan2(deltaX, deltaZ);
      let yawDelta: number = desiredYaw - this.yawRadians;
      while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
      while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
      this.yawRadians += yawDelta * clamp(deltaSeconds * 8, 0, 1);
    }
    streamer.resolveCircleCollision(this.position, 0.18);
    return distance;
  }

  public update(deltaSeconds: number, playerFeet: Readonly<Vec3>, playerYaw: number, streamer: LevelStreamer, timeSeconds: number): void {
    if (this.state === 'dormant') {
      return;
    }
    switch (this.state) {
      case 'following':
      case 'returning': {
        // Follow point: right-behind the player in their yaw frame.
        const [rightOffset, backOffset] = this.tuning.followOffset;
        const goal: Vec3 = [
          playerFeet[0] + Math.cos(playerYaw) * rightOffset + Math.sin(playerYaw) * backOffset,
          0,
          playerFeet[2] - Math.sin(playerYaw) * rightOffset + Math.cos(playerYaw) * backOffset,
        ];
        const distance: number = Math.hypot(goal[0] - this.position[0], goal[2] - this.position[2]);
        if (distance > this.tuning.leashDistance) {
          this.position = [goal[0], 0, goal[2]];
          this.speed = 0;
        } else {
          this.steerToward(goal, distance > 3 ? this.tuning.sprintSpeed : this.tuning.cruiseSpeed, deltaSeconds, streamer);
        }
        if (this.state === 'returning' && distance < 1.5) {
          this.state = 'following';
        }
        break;
      }
      case 'toVent': {
        const vent: VentRecord | null = this.ventTarget;
        if (vent === null) {
          this.state = 'returning';
          break;
        }
        const remaining: number = this.steerToward([vent.position[0], 0, vent.position[2]], this.tuning.sprintSpeed, deltaSeconds, streamer);
        if (remaining < 0.35) {
          this.state = 'inVent';
          this.ventTimer = 0;
        }
        break;
      }
      case 'inVent': {
        this.ventTimer += deltaSeconds;
        if (this.ventTimer >= this.tuning.ventCrawlSeconds && this.ventTarget !== null) {
          const vent: VentRecord = this.ventTarget;
          this.ventTarget = null;
          this.state = 'returning';
          this.events.ventOpened(vent);
        }
        break;
      }
    }
    this.wheelPhase += this.speed * deltaSeconds * 20;
    this.bobPhase += this.speed * deltaSeconds * 9;
    // Lantern: gentle candle flicker; dark while Pip is inside a vent.
    this.lanternFlicker = 0.85 + 0.15 * Math.sin(timeSeconds * 13.7) * Math.sin(timeSeconds * 7.1);
    if (this.lantern !== null) {
      this.lantern.position = this.lanternWorldPosition();
      this.lantern.intensity = this.state === 'inVent' ? 0 : this.tuning.lanternIntensity * this.lanternFlicker;
    }
  }

  public collectDrawItems(output: DrawItem[]): void {
    if (this.state === 'dormant' || this.state === 'inVent') {
      return;
    }
    const matrix: Mat4 = this.modelMatrix();
    for (const part of this.model.parts) {
      output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: matrix, emissiveBoost: part.partId === 'lantern' ? this.lanternFlicker * 1.2 : 1 });
    }
  }

  public dispose(): void {
    if (this.lantern !== null) {
      this.lighting.remove(this.lantern.handle);
      this.lantern = null;
    }
    this.state = 'dormant';
  }
}
