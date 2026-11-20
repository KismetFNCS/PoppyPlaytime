import type { ImportedMeshId, MaterialId } from '../assets/AssetManifest';
import type { MeshLibrary, ModelAsset } from '../assets/MeshLibrary';
import { FOUNDATION_HEAP_HALF_EXTENTS } from '../assets/ProceduralModels';
import { LIGHT_PALETTE } from '../config/GameConstants';
import type { MeshData } from '../graphics/Geometry';
import { MeshBuilder, createBoxMesh, createCylinderMesh } from '../graphics/Geometry';
import { GpuMesh } from '../graphics/GpuMesh';
import type { LightBehavior, LightingSystem, PointLight, PointLightDescriptor } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4Identity } from '../math/Mat4';
import { SeededRandom } from '../math/Random';
import type { Vec3 } from '../math/Vec3';
import { clamp } from '../math/Vec3';

export const CORRIDOR_DIMENSIONS = {
  chunkLength: 12,
  halfWidth: 3,
  height: 4.6,
  wallThickness: 0.3,
} as const;

/** Chunks between checkpoints. A checkpoint chunk saves progress when the player enters it. */
export const CHECKPOINT_INTERVAL: number = 6;
const IDENTITY_MATRIX: Mat4 = mat4Identity();

export interface ColliderBox2D {
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumZ: number;
  readonly maximumZ: number;
}

interface ChunkBuildResult {
  readonly chunkIndex: number;
  readonly meshesByMaterial: ReadonlyMap<MaterialId, MeshData>;
  readonly lights: readonly PointLightDescriptor[];
  readonly colliders: readonly ColliderBox2D[];
  readonly isCheckpoint: boolean;
}

interface LoadedChunk {
  readonly chunkIndex: number;
  readonly drawItems: readonly DrawItem[];
  readonly lights: readonly PointLight[];
  readonly colliders: readonly ColliderBox2D[];
  readonly isCheckpoint: boolean;
}

export function chunkStartZ(chunkIndex: number): number {
  return -chunkIndex * CORRIDOR_DIMENSIONS.chunkLength;
}

export function chunkIndexAtZ(z: number): number {
  return Math.max(0, Math.floor(-z / CORRIDOR_DIMENSIONS.chunkLength));
}

export function isCheckpointChunk(chunkIndex: number): boolean {
  return chunkIndex % CHECKPOINT_INTERVAL === 0;
}

/** Deterministically generates the geometry, lights and colliders for one corridor chunk. */
export class LevelChunkBuilder {
  public constructor(private readonly meshes: MeshLibrary, private readonly worldSeed: number) {}

  public build(chunkIndex: number): ChunkBuildResult {
    const random = new SeededRandom(this.worldSeed ^ Math.imul(chunkIndex + 1, 0x9e3779b1));
    const builders: Map<MaterialId, MeshBuilder> = new Map();
    const builderFor = (materialId: MaterialId): MeshBuilder => {
      let builder: MeshBuilder | undefined = builders.get(materialId);
      if (builder === undefined) {
        builder = new MeshBuilder();
        builders.set(materialId, builder);
      }
      return builder;
    };
    const place = (materialId: MaterialId, mesh: MeshData, translation: Vec3, rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]): void => {
      builderFor(materialId).appendMesh(mesh, mat4Compose(translation, rotation, scale));
    };
    const placeModel = (modelId: ImportedMeshId, translation: Vec3, rotation: Vec3, scale: Vec3): void => {
      const model: ModelAsset = this.meshes.get(modelId);
      const transform: Mat4 = mat4Compose(translation, rotation, scale);
      for (const part of model.parts) {
        builderFor(part.materialId).appendMesh(part.meshData, transform);
      }
    };

    const length: number = CORRIDOR_DIMENSIONS.chunkLength;
    const halfWidth: number = CORRIDOR_DIMENSIONS.halfWidth;
    const height: number = CORRIDOR_DIMENSIONS.height;
    const thickness: number = CORRIDOR_DIMENSIONS.wallThickness;
    const startZ: number = chunkStartZ(chunkIndex);
    const centerZ: number = startZ - length / 2;
    const isBreach: boolean = chunkIndex > 0 && chunkIndex % 5 === 3;
    const isCheckpoint: boolean = isCheckpointChunk(chunkIndex);
    const lights: PointLightDescriptor[] = [];
    const colliders: ColliderBox2D[] = [];

    // Shell: floor, ceiling, walls. Breach chunks expose the fissured foundation on one side.
    place('factory_floor_concrete', createBoxMesh(halfWidth * 2 + thickness * 2, 0.2, length), [0, -0.1, centerZ]);
    place('factory_floor_concrete', createBoxMesh(halfWidth * 2 + thickness * 2, 0.2, length), [0, height + 0.1, centerZ]);
    const breachSide: number = random.chance(0.5) ? -1 : 1;
    for (const side of [-1, 1]) {
      const wallMaterial: MaterialId = isBreach && side === breachSide ? 'shattered_foundation_concrete' : 'factory_wall_tile';
      place(wallMaterial, createBoxMesh(thickness, height, length), [side * (halfWidth + thickness / 2), height / 2, centerZ]);
      // Wainscot strip of steel along the base of each wall.
      place('rusted_steel', createBoxMesh(0.06, 0.9, length), [side * (halfWidth - 0.03), 0.45, centerZ]);
    }
    if (chunkIndex === 0) {
      // Sealed elevator doors behind the spawn point.
      place('rusted_steel', createBoxMesh(halfWidth * 2, height, thickness), [0, height / 2, startZ + thickness / 2]);
      place('lamp_housing_red', createBoxMesh(0.5, 0.18, 0.06), [0, height - 0.8, startZ - 0.02]);
    }

    // Structural frame at the chunk boundary: pillars + ceiling beam.
    const boundaryZ: number = startZ - 0.25;
    for (const side of [-1, 1]) {
      place('rusted_steel', createBoxMesh(0.5, height, 0.5), [side * (halfWidth - 0.25), height / 2, boundaryZ]);
      colliders.push({ minimumX: side > 0 ? halfWidth - 0.5 : -halfWidth, maximumX: side > 0 ? halfWidth : -halfWidth + 0.5, minimumZ: boundaryZ - 0.25, maximumZ: boundaryZ + 0.25 });
    }
    place('rusted_steel', createBoxMesh(halfWidth * 2, 0.35, 0.4), [0, height - 0.18, boundaryZ]);
    // Overhead conduit run.
    place('rusted_steel', createCylinderMesh(0.12, 0.12, length, 10), [-halfWidth + 0.35, height - 0.5, centerZ], [Math.PI / 2, 0, 0]);
    place('rusted_steel', createCylinderMesh(0.07, 0.07, length, 8), [-halfWidth + 0.65, height - 0.42, centerZ], [Math.PI / 2, 0, 0]);

    // Main ceiling lamp alternating emergency red / service blue with a random behaviour profile.
    const isRed: boolean = chunkIndex % 2 === 0;
    const lampZ: number = centerZ + random.range(-2, 2);
    const behaviorRoll: number = random.next();
    const behavior: LightBehavior =
      behaviorRoll < 0.45
        ? { kind: 'steady' }
        : behaviorRoll < 0.7
          ? { kind: 'pulse', frequencyHertz: random.range(0.2, 0.6), depth: random.range(0.25, 0.6) }
          : behaviorRoll < 0.92
            ? { kind: 'flicker', rateHertz: random.range(6, 14), dropoutChance: random.range(0.08, 0.3) }
            : { kind: 'strobe', frequencyHertz: random.range(1.5, 3), dutyCycle: 0.35 };
    place(isRed ? 'lamp_housing_red' : 'lamp_housing_blue', createBoxMesh(0.9, 0.1, 0.3), [0, height - 0.06, lampZ]);
    lights.push({
      position: [0, height - 0.55, lampZ],
      color: isRed ? LIGHT_PALETTE.emergencyRed : LIGHT_PALETTE.serviceBlue,
      intensity: isRed ? 7.5 : 8.5,
      range: 10,
      behavior,
    });

    // Occasional low wall lamp of the opposite colour for red/blue cross-lighting.
    if (random.chance(0.45)) {
      const side: number = random.chance(0.5) ? -1 : 1;
      const wallLampZ: number = centerZ + random.range(-4, 4);
      place(isRed ? 'lamp_housing_blue' : 'lamp_housing_red', createBoxMesh(0.08, 0.3, 0.3), [side * (halfWidth - 0.04), 1.4, wallLampZ]);
      lights.push({
        position: [side * (halfWidth - 0.4), 1.4, wallLampZ],
        color: isRed ? LIGHT_PALETTE.serviceBlue : LIGHT_PALETTE.emergencyRed,
        intensity: 2.4,
        range: 5,
        behavior: { kind: 'flicker', rateHertz: 9, dropoutChance: 0.15 },
      });
    }

    // Checkpoint marker: a steady amber work light over a painted floor stripe.
    if (isCheckpoint && chunkIndex > 0) {
      place('lamp_housing_red', createBoxMesh(halfWidth * 2 - 0.2, 0.02, 0.18), [0, 0.012, startZ - 1.2]);
      lights.push({ position: [halfWidth - 0.6, 2.2, startZ - 1.5], color: LIGHT_PALETTE.sodiumAmber, intensity: 4, range: 7, behavior: { kind: 'steady' } });
    }

    // Shattered foundation heaps block part of the corridor and force the player to weave.
    if (chunkIndex >= 2 && (chunkIndex % 4 === 2 || isBreach)) {
      const heapSide: number = isBreach ? breachSide : random.chance(0.5) ? -1 : 1;
      const heapX: number = heapSide * 1.7;
      const heapZ: number = centerZ + random.range(-2.5, 2.5);
      placeModel('shattered_foundation', [heapX, 0, heapZ], [0, random.range(0, Math.PI * 2), 0], [1, 1, 1]);
      const extent: number = Math.max(FOUNDATION_HEAP_HALF_EXTENTS.x, FOUNDATION_HEAP_HALF_EXTENTS.z) * 0.85;
      colliders.push({ minimumX: heapX - extent, maximumX: heapX + extent, minimumZ: heapZ - extent, maximumZ: heapZ + extent });
      // The fissures glow: a faint red light low in the rubble.
      lights.push({ position: [heapX, 0.5, heapZ], color: LIGHT_PALETTE.emergencyRed, intensity: 1.6, range: 4, behavior: { kind: 'pulse', frequencyHertz: 0.3, depth: 0.5 } });
    }

    // Discarded gas masks.
    const maskCount: number = random.integer(0, 2);
    for (let mask = 0; mask < maskCount; mask += 1) {
      placeModel('gas_mask_prop', [random.range(-2.3, 2.3), 0.1, centerZ + random.range(-5, 5)], [-Math.PI / 2 + random.range(-0.25, 0.25), random.range(0, Math.PI * 2), 0], [1, 1, 1]);
    }
    // Shelving crates along the walls.
    const crateCount: number = random.integer(0, 3);
    for (let crate = 0; crate < crateCount; crate += 1) {
      const side: number = random.chance(0.5) ? -1 : 1;
      const size: number = random.range(0.5, 0.9);
      const crateX: number = side * (halfWidth - size / 2 - 0.1);
      const crateZ: number = centerZ + random.range(-5, 5);
      place('rusted_steel', createBoxMesh(size, size, size), [crateX, size / 2, crateZ], [0, random.range(-0.3, 0.3), 0]);
      colliders.push({ minimumX: crateX - size / 2, maximumX: crateX + size / 2, minimumZ: crateZ - size / 2, maximumZ: crateZ + size / 2 });
    }

    const meshesByMaterial: Map<MaterialId, MeshData> = new Map();
    for (const [materialId, builder] of builders) {
      if (!builder.isEmpty) {
        meshesByMaterial.set(materialId, builder.build());
      }
    }
    return { chunkIndex, meshesByMaterial, lights, colliders, isCheckpoint };
  }
}

/**
 * Streams corridor chunks around a focus point: keeps [focus - behind, focus + ahead] resident,
 * builds at most `buildBudgetPerFrame` chunks per update, and unloads with hysteresis.
 */
export class LevelStreamer {
  private readonly chunks: Map<number, LoadedChunk> = new Map();
  private readonly builder: LevelChunkBuilder;
  public chunksBehind: number = 2;
  public chunksAhead: number = 3;
  public buildBudgetPerFrame: number = 1;

  public constructor(
    private readonly gl: WebGL2RenderingContext,
    meshes: MeshLibrary,
    private readonly lighting: LightingSystem,
    worldSeed: number,
  ) {
    this.builder = new LevelChunkBuilder(meshes, worldSeed);
  }

  public get loadedChunkIndices(): number[] {
    return [...this.chunks.keys()].sort((left: number, right: number) => left - right);
  }

  public isLoaded(chunkIndex: number): boolean {
    return this.chunks.has(chunkIndex);
  }

  public isCheckpoint(chunkIndex: number): boolean {
    return this.chunks.get(chunkIndex)?.isCheckpoint ?? isCheckpointChunk(chunkIndex);
  }

  private load(chunkIndex: number): void {
    const result: ChunkBuildResult = this.builder.build(chunkIndex);
    const drawItems: DrawItem[] = [];
    for (const [materialId, meshData] of result.meshesByMaterial) {
      drawItems.push({ mesh: new GpuMesh(this.gl, `chunk${chunkIndex}.${materialId}`, meshData), materialId, modelMatrix: IDENTITY_MATRIX });
    }
    const lights: PointLight[] = result.lights.map((descriptor: PointLightDescriptor) => this.lighting.add(descriptor));
    this.chunks.set(chunkIndex, { chunkIndex, drawItems, lights, colliders: result.colliders, isCheckpoint: result.isCheckpoint });
  }

  private unload(chunkIndex: number): void {
    const chunk: LoadedChunk | undefined = this.chunks.get(chunkIndex);
    if (chunk === undefined) {
      return;
    }
    for (const item of chunk.drawItems) {
      item.mesh.dispose();
    }
    for (const light of chunk.lights) {
      this.lighting.remove(light.handle);
    }
    this.chunks.delete(chunkIndex);
  }

  /** Synchronously loads the full window around `focusChunk` (used on spawn, behind a fade). */
  public primeAround(focusChunk: number): void {
    for (let chunkIndex = Math.max(0, focusChunk - this.chunksBehind); chunkIndex <= focusChunk + this.chunksAhead; chunkIndex += 1) {
      if (!this.chunks.has(chunkIndex)) {
        this.load(chunkIndex);
      }
    }
  }

  public update(focusChunk: number): void {
    const desiredMinimum: number = Math.max(0, focusChunk - this.chunksBehind);
    const desiredMaximum: number = focusChunk + this.chunksAhead;
    for (const chunkIndex of [...this.chunks.keys()]) {
      if (chunkIndex < desiredMinimum - 1 || chunkIndex > desiredMaximum + 1) {
        this.unload(chunkIndex);
      }
    }
    let budget: number = this.buildBudgetPerFrame;
    // Nearest-first so the chunk the player is walking into always wins the budget.
    const order: number[] = [];
    for (let distance = 0; distance <= Math.max(this.chunksAhead, this.chunksBehind); distance += 1) {
      order.push(focusChunk + distance);
      if (distance > 0) {
        order.push(focusChunk - distance);
      }
    }
    for (const chunkIndex of order) {
      if (budget <= 0) {
        break;
      }
      if (chunkIndex >= desiredMinimum && chunkIndex <= desiredMaximum && !this.chunks.has(chunkIndex)) {
        this.load(chunkIndex);
        budget -= 1;
      }
    }
  }

  public collectDrawItems(output: DrawItem[]): void {
    for (const chunk of this.chunks.values()) {
      for (const item of chunk.drawItems) {
        output.push(item);
      }
    }
  }

  /**
   * Resolves a circle (player / entity) against corridor walls and chunk colliders on the XZ plane.
   * Mutates and returns `position`.
   */
  public resolveCircleCollision(position: Vec3, radius: number): Vec3 {
    position[0] = clamp(position[0], -CORRIDOR_DIMENSIONS.halfWidth + radius, CORRIDOR_DIMENSIONS.halfWidth - radius);
    position[2] = Math.min(position[2], chunkStartZ(0) - radius);
    const focusChunk: number = chunkIndexAtZ(position[2]);
    for (let chunkIndex = focusChunk - 1; chunkIndex <= focusChunk + 1; chunkIndex += 1) {
      const chunk: LoadedChunk | undefined = this.chunks.get(chunkIndex);
      if (chunk === undefined) {
        continue;
      }
      for (const box of chunk.colliders) {
        const closestX: number = clamp(position[0], box.minimumX, box.maximumX);
        const closestZ: number = clamp(position[2], box.minimumZ, box.maximumZ);
        const deltaX: number = position[0] - closestX;
        const deltaZ: number = position[2] - closestZ;
        const distanceSquared: number = deltaX * deltaX + deltaZ * deltaZ;
        if (distanceSquared >= radius * radius) {
          continue;
        }
        if (distanceSquared > 1e-8) {
          const distance: number = Math.sqrt(distanceSquared);
          const push: number = radius - distance;
          position[0] += (deltaX / distance) * push;
          position[2] += (deltaZ / distance) * push;
        } else {
          // Centre is inside the box: eject along the axis of least penetration.
          const exits: Array<[number, number, number]> = [
            [box.minimumX - radius - position[0], 0, Math.abs(box.minimumX - position[0])],
            [box.maximumX + radius - position[0], 0, Math.abs(box.maximumX - position[0])],
            [0, box.minimumZ - radius - position[2], Math.abs(box.minimumZ - position[2])],
            [0, box.maximumZ + radius - position[2], Math.abs(box.maximumZ - position[2])],
          ];
          exits.sort((left, right) => left[2] - right[2]);
          const best = exits[0] as [number, number, number];
          position[0] += best[0];
          position[2] += best[1];
        }
      }
    }
    position[0] = clamp(position[0], -CORRIDOR_DIMENSIONS.halfWidth + radius, CORRIDOR_DIMENSIONS.halfWidth - radius);
    return position;
  }

  public dispose(): void {
    for (const chunkIndex of [...this.chunks.keys()]) {
      this.unload(chunkIndex);
    }
  }
}
