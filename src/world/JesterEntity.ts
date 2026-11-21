import type { MeshLibrary, ModelAsset } from '../assets/MeshLibrary';
import { JESTER_HEAD_HEIGHT, JESTER_JOINTS } from '../assets/ProceduralModels';
import type { LightDisturbanceSource } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4Multiply, mat4Translation } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
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

/** One held pose. Gully snaps between these (no blending) whenever he moves while nobody is watching. */
interface JesterPose {
  readonly headRoll: number;
  readonly headYaw: number;
  readonly headPitch: number;
  readonly bodyLean: number;
  readonly bodyRoll: number;
  readonly armRaise: readonly [number, number];
  readonly armOut: readonly [number, number];
  readonly legSwing: readonly [number, number];
}

/** Deterministic 0..1 noise for pose `index`, channel `channel`. */
function poseNoise(index: number, channel: number): number {
  const value: number = Math.sin(index * 12.9898 + channel * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function poseAt(index: number): JesterPose {
  const n = (channel: number, minimum: number, maximum: number): number => minimum + (maximum - minimum) * poseNoise(index, channel);
  if (index === 0) {
    // Resting pose: head cocked, one hand lifted toward the viewer.
    return { headRoll: 0.42, headYaw: 0.12, headPitch: 0.08, bodyLean: 0.08, bodyRoll: -0.05, armRaise: [-0.15, -0.95], armOut: [0.12, 0.25], legSwing: [0.05, -0.08] };
  }
  return {
    headRoll: n(1, -0.8, 0.8),
    headYaw: n(2, -0.55, 0.55),
    headPitch: n(3, -0.25, 0.35),
    bodyLean: n(4, -0.05, 0.32),
    bodyRoll: n(5, -0.18, 0.18),
    armRaise: [n(6, -1.7, 0.25), n(7, -1.7, 0.25)],
    armOut: [n(8, 0, 0.95), n(9, 0, 0.95)],
    legSwing: [n(10, -0.35, 0.35), n(11, -0.35, 0.35)],
  };
}

/** Seconds of unobserved movement between pose snaps. */
const POSE_SNAP_SECONDS: number = 0.32;

/**
 * Gully, the Jester Entity view. He holds perfectly still while watched (the brain stops him) and, whenever he moves
 * unseen, jerks into a new twisted pose, so every time the player turns back he is closer and bent differently.
 * Behaviour is driven externally by an EntityBrain or a cinematic.
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
  private poseIndex: number = 0;
  private movingSeconds: number = 0;
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
    if (this.gait > 0.04 || this.lunging) {
      this.movingSeconds += deltaSeconds;
      if (this.movingSeconds >= POSE_SNAP_SECONDS) {
        this.movingSeconds = 0;
        this.poseIndex += 1;
      }
    }
  }

  /** Alias kept for menu / cinematic callers that only need idle motion. */
  public updateIdle(deltaSeconds: number): void {
    this.advanceAnimation(deltaSeconds);
  }

  public collectDrawItems(output: DrawItem[]): void {
    const time: number = this.animationTime;
    const pose: JesterPose = poseAt(this.poseIndex);
    // Barely-there breathing while held still; the creepiness is in the stillness.
    const breathe: number = Math.sin(time * 1.4) * 0.008;
    const lean: number = pose.bodyLean + (this.lunging ? 0.35 : 0);
    const root: Mat4 = mat4Compose([this.position[0], this.position[1] + breathe, this.position[2]], [lean, this.yawRadians, pose.bodyRoll], [1, 1, 1]);
    // Head: posed tilt plus a small twitch (menus / jumpscares raise headTwitchStrength).
    const twitchTick: number = Math.floor(time * 6);
    const twitchNoise: number = Math.sin(twitchTick * 12.9898) * 43758.5453;
    const twitchAmount: number = (twitchNoise - Math.floor(twitchNoise) - 0.5) * this.headTwitchStrength;
    const scanYaw: number = Math.sin(time * 1.3) * 0.9 * this.scanAmount;
    const pivot: Mat4 = mat4Translation(0, JESTER_HEAD_HEIGHT - 0.15, 0);
    const unpivot: Mat4 = mat4Translation(0, -(JESTER_HEAD_HEIGHT - 0.15), 0);
    const headLocal: Mat4 = mat4Multiply(
      mat4Multiply(pivot, mat4Compose([0, 0, 0], [pose.headPitch + twitchAmount * 0.4, pose.headYaw + twitchAmount * 0.6 + scanYaw, pose.headRoll + twitchAmount], [1, 1, 1])),
      unpivot,
    );
    const headWorld: Mat4 = mat4Multiply(root, headLocal);
    // Lunge: both arms thrown forward at the victim.
    const armRaise = (index: 0 | 1): number => (this.lunging ? -1.45 : pose.armRaise[index]);
    const armOut = (index: 0 | 1): number => (this.lunging ? 0.25 : pose.armOut[index]);
    const armWorld = (side: -1 | 1, index: 0 | 1): Mat4 =>
      mat4Multiply(root, mat4Compose([side * JESTER_JOINTS.shoulderX, JESTER_JOINTS.shoulderY, 0], [armRaise(index), 0, side * armOut(index)], [1, 1, 1]));
    const legWorld = (side: -1 | 1, index: 0 | 1): Mat4 =>
      mat4Multiply(root, mat4Compose([side * JESTER_JOINTS.hipX, JESTER_JOINTS.hipY, 0], [pose.legSwing[index] - lean * 0.6, 0, side * 0.04], [1, 1, 1]));
    const limbs: ReadonlyArray<{ readonly side: -1 | 1; readonly index: 0 | 1 }> = [
      { side: -1, index: 0 },
      { side: 1, index: 1 },
    ];
    const eyePulse: number = this.eyeGlow * (0.75 + 0.25 * Math.sin(time * 5.1));
    for (const part of this.model.parts) {
      const emissiveBoost: number = part.partId === 'eyes' ? eyePulse : part.partId === 'head' ? 0.6 + eyePulse * 0.4 : part.partId === 'shard' ? 0.5 : 1;
      const push = (modelMatrix: Mat4): void => {
        output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix, emissiveBoost });
      };
      switch (part.partId) {
        case 'head':
        case 'hoodRose':
        case 'hoodGold':
        case 'hoodTeal':
        case 'eyes':
          push(headWorld);
          break;
        case 'arm':
        case 'hand':
        case 'armGear':
          for (const limb of limbs) push(armWorld(limb.side, limb.index));
          break;
        case 'leg':
        case 'legGear':
          for (const limb of limbs) push(legWorld(limb.side, limb.index));
          break;
        default:
          push(root);
      }
    }
  }
}
