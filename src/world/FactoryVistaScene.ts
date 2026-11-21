import type { ImportedMeshId } from '../assets/AssetManifest';
import type { MeshLibrary } from '../assets/MeshLibrary';
import { LIGHT_PALETTE } from '../config/GameConstants';
import type { PerspectiveCamera } from '../graphics/Camera';
import { MeshBuilder, createBoxMesh, createCylinderMesh, createPlaneMesh } from '../graphics/Geometry';
import { GpuMesh } from '../graphics/GpuMesh';
import type { LightingSystem } from '../graphics/LightingSystem';
import type { DrawItem, SceneEnvironment } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4Identity } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { smoothstep } from '../math/Vec3';

export const VISTA_ENVIRONMENT: SceneEnvironment = { ambientColor: [0.02, 0.022, 0.035], clearColor: [0.004, 0.005, 0.01] };

interface VistaPlacement {
  readonly model: ImportedMeshId;
  readonly matrix: Mat4;
}

const DOLLY_SECONDS: number = 14;

/**
 * Exterior night shot of the Marrow & Finch works for the chapter loading screen: production halls,
 * smokestacks with beacons, sodium street lamps, a perimeter fence, and a slow dolly toward the dock.
 */
export class FactoryVistaScene {
  private readonly staticItems: DrawItem[] = [];
  private readonly placements: VistaPlacement[] = [];
  private readonly ownedMeshes: GpuMesh[] = [];
  private elapsedSeconds: number = 0;

  public constructor(gl: WebGL2RenderingContext, private readonly meshes: MeshLibrary, lighting: LightingSystem) {
    lighting.clear();
    const identity: Mat4 = mat4Identity();
    const ground = new GpuMesh(gl, 'vista.ground', createPlaneMesh(160, 160, 0.25));
    this.ownedMeshes.push(ground);
    this.staticItems.push({ mesh: ground, materialId: 'wet_stone', modelMatrix: identity });

    // Halls: main hall facing the camera road, two wings set back and angled.
    this.placements.push({ model: 'factory_hall', matrix: mat4Compose([0, 0, -40], [0, 0, 0], [1, 1, 1]) });
    this.placements.push({ model: 'factory_hall', matrix: mat4Compose([-30, 0, -52], [0, 0.35, 0], [0.9, 1.1, 1]) });
    this.placements.push({ model: 'factory_hall', matrix: mat4Compose([31, 0, -55], [0, -0.3, 0], [0.85, 0.9, 1]) });
    for (const [x, z, scale] of [
      [-9, -52, 1],
      [6, -58, 1.15],
      [22, -66, 0.9],
    ] as const) {
      this.placements.push({ model: 'factory_smokestack', matrix: mat4Compose([x, 0, z], [0, 0, 0], [scale, scale, scale]) });
      lighting.add({ position: [x, 27 * scale, z + 2], color: LIGHT_PALETTE.emergencyRed, intensity: 6, range: 14, behavior: { kind: 'strobe', frequencyHertz: 0.5, dutyCycle: 0.5 } });
    }

    // Perimeter fence along the approach road, street lamps every 12 m.
    const fence = new MeshBuilder();
    for (let post = 0; post < 18; post += 1) {
      const z: number = 18 - post * 4;
      for (const side of [-1, 1]) {
        fence.appendMesh(createBoxMesh(0.12, 2.4, 0.12, 1), mat4Compose([side * 9, 1.2, z], [0, 0, 0], [1, 1, 1]));
        fence.appendMesh(createBoxMesh(0.04, 0.04, 4), mat4Compose([side * 9, 2.2, z - 2], [0, 0, 0], [1, 1, 1]));
        fence.appendMesh(createBoxMesh(0.04, 0.04, 4), mat4Compose([side * 9, 1.1, z - 2], [0, 0, 0], [1, 1, 1]));
      }
    }
    const lampPosts = new MeshBuilder();
    for (let lamp = 0; lamp < 5; lamp += 1) {
      const z: number = 14 - lamp * 12;
      const side: number = lamp % 2 === 0 ? -1 : 1;
      lampPosts.appendMesh(createCylinderMesh(0.09, 0.12, 6, 8), mat4Compose([side * 7.5, 3, z], [0, 0, 0], [1, 1, 1]));
      lampPosts.appendMesh(createBoxMesh(1.4, 0.12, 0.2), mat4Compose([side * 6.9, 6, z], [0, 0, 0], [1, 1, 1]));
      lighting.add({ position: [side * 6.3, 5.7, z], color: LIGHT_PALETTE.sodiumAmber, intensity: 9, range: 13, behavior: lamp === 3 ? { kind: 'flicker', rateHertz: 6, dropoutChance: 0.25 } : { kind: 'steady' } });
    }
    const fenceMesh = new GpuMesh(gl, 'vista.fence', fence.build());
    const lampMesh = new GpuMesh(gl, 'vista.lamps', lampPosts.build());
    this.ownedMeshes.push(fenceMesh, lampMesh);
    this.staticItems.push({ mesh: fenceMesh, materialId: 'rusted_steel', modelMatrix: identity }, { mesh: lampMesh, materialId: 'rusted_steel', modelMatrix: identity });
    // Warm spill from the hall windows and the dock.
    lighting.add({ position: [0, 6, -30], color: LIGHT_PALETTE.sodiumAmber, intensity: 7, range: 16, behavior: { kind: 'pulse', frequencyHertz: 0.1, depth: 0.2 } });
    lighting.add({ position: [0, 2.5, -31.5], color: LIGHT_PALETTE.emergencyRed, intensity: 4, range: 8, behavior: { kind: 'flicker', rateHertz: 4, dropoutChance: 0.1 } });
  }

  public update(deltaSeconds: number, camera: PerspectiveCamera): void {
    this.elapsedSeconds += deltaSeconds;
    // Dolly from the gatehouse toward the loading dock, easing in, with a faint handheld sway.
    const progress: number = smoothstep(0, 1, Math.min(1, this.elapsedSeconds / DOLLY_SECONDS));
    const position: Vec3 = [Math.sin(this.elapsedSeconds * 0.3) * 0.3, 1.8 + progress * 0.6, 26 - progress * 30];
    camera.position = position;
    camera.yawRadians = Math.sin(this.elapsedSeconds * 0.17) * 0.03;
    camera.pitchRadians = 0.12 - progress * 0.05;
    camera.rollRadians = Math.sin(this.elapsedSeconds * 0.4) * 0.006;
    camera.fieldOfViewRadians = (62 * Math.PI) / 180;
  }

  public collectDrawItems(output: DrawItem[]): void {
    output.push(...this.staticItems);
    for (const placement of this.placements) {
      for (const part of this.meshes.get(placement.model).parts) {
        output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix: placement.matrix, emissiveBoost: part.partId === 'windows' ? 0.5 : part.partId === 'beacon' ? 1.5 : 1 });
      }
    }
  }

  public dispose(lighting: LightingSystem): void {
    for (const mesh of this.ownedMeshes) {
      mesh.dispose();
    }
    this.ownedMeshes.length = 0;
    lighting.clear();
  }
}
