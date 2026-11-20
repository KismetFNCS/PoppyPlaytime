import type { ImportedMeshId, MaterialId } from '../assets/AssetManifest';
import type { MeshLibrary, ModelAsset } from '../assets/MeshLibrary';
import { FOUNDATION_HEAP_HALF_EXTENTS } from '../assets/ProceduralModels';
import { LIGHT_PALETTE } from '../config/GameConstants';
import type { MeshData } from '../graphics/Geometry';
import { MeshBuilder, createBoxMesh, createCylinderMesh } from '../graphics/Geometry';
import { GpuMesh } from '../graphics/GpuMesh';
import type { LightBehavior, LightingSystem, PointLight, PointLightDescriptor } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Aabb, RayHit } from '../math/Collision';
import { aabbContainsPoint, aabbFromCenter, aabbOverlaps, rayIntersectAabb } from '../math/Collision';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4Identity } from '../math/Mat4';
import { SeededRandom } from '../math/Random';
import type { Vec3 } from '../math/Vec3';
import { clamp, smoothstep, vec3Distance, vec3Dot, vec3Normalize, vec3Subtract } from '../math/Vec3';

export const CORRIDOR_DIMENSIONS = {
  chunkLength: 12,
  halfWidth: 3,
  height: 4.6,
  wallThickness: 0.3,
  /** Floor of the foundation chasms. Anything falling below `fallKillHeight` is lost. */
  chasmFloorHeight: -7,
  fallKillHeight: -2.5,
} as const;

/** Chunks between checkpoints. A checkpoint chunk saves progress when the player enters it. */
export const CHECKPOINT_INTERVAL: number = 6;
const IDENTITY_MATRIX: Mat4 = mat4Identity();

export type Polarity = 'amber' | 'violet';
export const POLARITIES: readonly Polarity[] = ['amber', 'violet'];

export type ChunkArchetype =
  | 'elevatorLanding'
  | 'maskStation'
  | 'standard'
  | 'toxicPassage'
  | 'relayGate'
  | 'foundationChasm'
  | 'collapsedCrawl';

export type TetherTargetKind = 'anchor' | 'relayPlate';

/** Something a Tether Rig claw can latch onto with special meaning (plain surfaces are handled as `null`). */
export interface TetherTarget {
  readonly id: string;
  readonly kind: TetherTargetKind;
  readonly chunkIndex: number;
  readonly bounds: Aabb;
  /** Exact point the claw snaps to on latch. */
  readonly attachPoint: Vec3;
  /** Outward surface normal at the attach point. */
  readonly attachNormal: Vec3;
  /** Relay plates accept exactly one polarity; anchors accept both (null). */
  readonly polarity: Polarity | null;
}

export interface WorldRayHit extends RayHit {
  readonly target: TetherTarget | null;
}

export interface ToxicZone {
  readonly bounds: Aabb;
  /** 0..1 strength; scales exposure gain and fog tint density. */
  readonly concentration: number;
}

export type PickupKind = 'gasMask';

export interface PickupRecord {
  readonly id: string;
  readonly kind: PickupKind;
  readonly position: Vec3;
  readonly modelMatrix: Mat4;
}

interface BlastGateRecord {
  readonly id: string;
  readonly baseZ: number;
  /** 0 = closed, 1 = fully raised into the ceiling. */
  openProgress: number;
}

interface RelayPlateRecord {
  readonly id: string;
  readonly polarity: Polarity;
  readonly linkedGateId: string;
  readonly modelMatrix: Mat4;
}

interface AnchorRecord {
  readonly id: string;
  readonly modelMatrix: Mat4;
}

interface ChunkBuildResult {
  readonly chunkIndex: number;
  readonly archetype: ChunkArchetype;
  readonly meshesByMaterial: ReadonlyMap<MaterialId, MeshData>;
  readonly lights: readonly PointLightDescriptor[];
  readonly colliders: readonly Aabb[];
  readonly targets: readonly TetherTarget[];
  readonly toxicZones: readonly ToxicZone[];
  readonly gates: readonly BlastGateRecord[];
  readonly plates: readonly RelayPlateRecord[];
  readonly anchors: readonly AnchorRecord[];
  readonly pickups: readonly PickupRecord[];
  readonly isCheckpoint: boolean;
}

interface LoadedChunk extends Omit<ChunkBuildResult, 'meshesByMaterial' | 'lights'> {
  readonly drawItems: readonly DrawItem[];
  readonly lights: readonly PointLight[];
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

/** After the tutorial beats, chunks cycle through this sequence: each Phase 2 system is introduced in turn. */
const CHALLENGE_CYCLE: readonly ChunkArchetype[] = ['toxicPassage', 'relayGate', 'collapsedCrawl', 'foundationChasm', 'standard'];

/** Fixed authoring rhythm: tutorial beats first, then the repeating five-chunk challenge cycle. */
export function archetypeForChunk(chunkIndex: number): ChunkArchetype {
  if (chunkIndex === 0) return 'elevatorLanding';
  if (chunkIndex === 1) return 'maskStation';
  if (chunkIndex === 2) return 'standard';
  const archetype: ChunkArchetype = CHALLENGE_CYCLE[(chunkIndex - 3) % CHALLENGE_CYCLE.length] as ChunkArchetype;
  // Never respawn the player inside gas: checkpoint chunks that would be toxic become standard.
  return isCheckpointChunk(chunkIndex) && archetype === 'toxicPassage' ? 'standard' : archetype;
}

/** Gap in the floor of a foundation chasm, measured from the chunk start along -Z. */
const CHASM_GAP_START_OFFSET: number = 3.5;
const CHASM_GAP_END_OFFSET: number = 8.5;
const CRAWL_CLEARANCE_HEIGHT: number = 1.25;
const CRAWL_HALF_LENGTH: number = 2.5;
const GATE_THICKNESS: number = 0.4;
const GATE_OPEN_SECONDS: number = 1.6;

/** Deterministically generates geometry, lights, colliders and interactables for one corridor chunk. */
export class LevelChunkBuilder {
  public constructor(private readonly meshes: MeshLibrary, private readonly worldSeed: number) {}

  public build(chunkIndex: number, collectedPickupIds: ReadonlySet<string>): ChunkBuildResult {
    const random = new SeededRandom(this.worldSeed ^ Math.imul(chunkIndex + 1, 0x9e3779b1));
    const archetype: ChunkArchetype = archetypeForChunk(chunkIndex);
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
    const placeModel = (modelId: ImportedMeshId, transform: Mat4): void => {
      const model: ModelAsset = this.meshes.get(modelId);
      for (const part of model.parts) {
        builderFor(part.materialId).appendMesh(part.meshData, transform);
      }
    };
    /** Solid box: rendered and added to the collision set. */
    const solid = (materialId: MaterialId, center: Vec3, size: Vec3, uvUnitsPerMeter: number = 0.5): void => {
      place(materialId, createBoxMesh(size[0], size[1], size[2], uvUnitsPerMeter), center);
      colliders.push(aabbFromCenter(center, [size[0] / 2, size[1] / 2, size[2] / 2]));
    };

    const length: number = CORRIDOR_DIMENSIONS.chunkLength;
    const halfWidth: number = CORRIDOR_DIMENSIONS.halfWidth;
    const height: number = CORRIDOR_DIMENSIONS.height;
    const thickness: number = CORRIDOR_DIMENSIONS.wallThickness;
    const startZ: number = chunkStartZ(chunkIndex);
    const endZ: number = startZ - length;
    const centerZ: number = startZ - length / 2;
    const isCheckpoint: boolean = isCheckpointChunk(chunkIndex);
    const lights: PointLightDescriptor[] = [];
    const colliders: Aabb[] = [];
    const targets: TetherTarget[] = [];
    const toxicZones: ToxicZone[] = [];
    const gates: BlastGateRecord[] = [];
    const plates: RelayPlateRecord[] = [];
    const anchors: AnchorRecord[] = [];
    const pickups: PickupRecord[] = [];
    const fullWidth: number = halfWidth * 2 + thickness * 2;
    const isChasm: boolean = archetype === 'foundationChasm';
    const wallBottom: number = isChasm ? CORRIDOR_DIMENSIONS.chasmFloorHeight : 0;

    // ---- Shell -------------------------------------------------------------------------------------------------
    if (isChasm) {
      const nearSlabLength: number = CHASM_GAP_START_OFFSET;
      const farSlabLength: number = length - CHASM_GAP_END_OFFSET;
      solid('factory_floor_concrete', [0, -0.1, startZ - nearSlabLength / 2], [fullWidth, 0.2, nearSlabLength]);
      solid('factory_floor_concrete', [0, -0.1, endZ + farSlabLength / 2], [fullWidth, 0.2, farSlabLength]);
      // Fractured slab lips hanging into the chasm.
      solid('shattered_foundation_concrete', [0, -0.6, startZ - nearSlabLength - 0.15], [fullWidth, 1, 0.3]);
      solid('shattered_foundation_concrete', [0, -0.6, endZ + farSlabLength + 0.15], [fullWidth, 1, 0.3]);
      solid('shattered_foundation_concrete', [0, CORRIDOR_DIMENSIONS.chasmFloorHeight - 0.1, centerZ], [fullWidth, 0.2, length]);
      lights.push({ position: [0, CORRIDOR_DIMENSIONS.chasmFloorHeight + 1.2, centerZ], color: LIGHT_PALETTE.emergencyRed, intensity: 5, range: 9, behavior: { kind: 'pulse', frequencyHertz: 0.25, depth: 0.6 } });
    } else {
      solid('factory_floor_concrete', [0, -0.1, centerZ], [fullWidth, 0.2, length]);
    }
    solid('factory_floor_concrete', [0, height + 0.1, centerZ], [fullWidth, 0.2, length]);
    const breachSide: number = random.chance(0.5) ? -1 : 1;
    for (const side of [-1, 1]) {
      const wallMaterial: MaterialId = isChasm || (archetype === 'collapsedCrawl' && side === breachSide) ? 'shattered_foundation_concrete' : 'factory_wall_tile';
      const wallHeight: number = height - wallBottom;
      solid(wallMaterial, [side * (halfWidth + thickness / 2), wallBottom + wallHeight / 2, centerZ], [thickness, wallHeight, length]);
      if (!isChasm) {
        place('rusted_steel', createBoxMesh(0.06, 0.9, length), [side * (halfWidth - 0.03), 0.45, centerZ]);
      }
    }
    if (chunkIndex === 0) {
      solid('rusted_steel', [0, height / 2, startZ + thickness / 2], [halfWidth * 2, height, thickness]);
      place('lamp_housing_red', createBoxMesh(0.5, 0.18, 0.06), [0, height - 0.8, startZ - 0.02]);
    }

    // ---- Structural frame ---------------------------------------------------------------------------------------
    const boundaryZ: number = startZ - 0.25;
    for (const side of [-1, 1]) {
      solid('rusted_steel', [side * (halfWidth - 0.25), height / 2, boundaryZ], [0.5, height, 0.5]);
    }
    place('rusted_steel', createBoxMesh(halfWidth * 2, 0.35, 0.4), [0, height - 0.18, boundaryZ]);
    place('rusted_steel', createCylinderMesh(0.12, 0.12, length, 10), [-halfWidth + 0.35, height - 0.5, centerZ], [Math.PI / 2, 0, 0]);
    place('rusted_steel', createCylinderMesh(0.07, 0.07, length, 8), [-halfWidth + 0.65, height - 0.42, centerZ], [Math.PI / 2, 0, 0]);

    // ---- Main ceiling lamp ----------------------------------------------------------------------------------------
    const isRed: boolean = chunkIndex % 2 === 0;
    const lampZ: number = isChasm ? startZ - 1.6 : centerZ + random.range(-2, 2);
    const behaviorRoll: number = random.next();
    const behavior: LightBehavior =
      behaviorRoll < 0.45
        ? { kind: 'steady' }
        : behaviorRoll < 0.7
          ? { kind: 'pulse', frequencyHertz: random.range(0.2, 0.6), depth: random.range(0.25, 0.6) }
          : behaviorRoll < 0.92
            ? { kind: 'flicker', rateHertz: random.range(6, 14), dropoutChance: random.range(0.08, 0.3) }
            : { kind: 'strobe', frequencyHertz: random.range(1.5, 3), dutyCycle: 0.35 };
    if (archetype !== 'toxicPassage') {
      place(isRed ? 'lamp_housing_red' : 'lamp_housing_blue', createBoxMesh(0.9, 0.1, 0.3), [0, height - 0.06, lampZ]);
      lights.push({ position: [0, height - 0.55, lampZ], color: isRed ? LIGHT_PALETTE.emergencyRed : LIGHT_PALETTE.serviceBlue, intensity: isRed ? 7.5 : 8.5, range: 10, behavior });
    }

    // ---- Archetype content ---------------------------------------------------------------------------------------
    switch (archetype) {
      case 'elevatorLanding':
      case 'standard': {
        if (chunkIndex >= 2 && chunkIndex % 4 === 2) {
          const heapSide: number = random.chance(0.5) ? -1 : 1;
          const heapX: number = heapSide * 1.7;
          const heapZ: number = centerZ + random.range(-2.5, 2.5);
          placeModel('shattered_foundation', mat4Compose([heapX, 0, heapZ], [0, random.range(0, Math.PI * 2), 0], [1, 1, 1]));
          const extent: number = Math.max(FOUNDATION_HEAP_HALF_EXTENTS.x, FOUNDATION_HEAP_HALF_EXTENTS.z) * 0.85;
          colliders.push({ minimum: [heapX - extent, 0, heapZ - extent], maximum: [heapX + extent, 1.1, heapZ + extent] });
          lights.push({ position: [heapX, 0.5, heapZ], color: LIGHT_PALETTE.emergencyRed, intensity: 1.6, range: 4, behavior: { kind: 'pulse', frequencyHertz: 0.3, depth: 0.5 } });
        }
        break;
      }
      case 'maskStation': {
        // Workbench pedestal with the gas mask pickup and an amber work light over it.
        const benchCenter: Vec3 = [1.9, 0.45, centerZ];
        solid('rusted_steel', benchCenter, [1.3, 0.9, 0.9], 1);
        const pickupId: string = `pickup.gasMask.${chunkIndex}`;
        const pickupPosition: Vec3 = [1.85, 0.92, centerZ];
        if (!collectedPickupIds.has(pickupId)) {
          pickups.push({ id: pickupId, kind: 'gasMask', position: pickupPosition, modelMatrix: mat4Compose([pickupPosition[0], pickupPosition[1] + 0.06, pickupPosition[2]], [-Math.PI / 2 + 0.2, -Math.PI / 2, 0], [1.15, 1.15, 1.15]) });
        }
        lights.push({ position: [1.6, 2.4, centerZ + 0.4], color: LIGHT_PALETTE.sodiumAmber, intensity: 3.2, range: 5, behavior: { kind: 'steady' } });
        break;
      }
      case 'toxicPassage': {
        const zoneBounds: Aabb = { minimum: [-halfWidth, 0, endZ + 0.6], maximum: [halfWidth, height, startZ - 0.6] };
        toxicZones.push({ bounds: zoneBounds, concentration: random.range(0.75, 1) });
        for (const offset of [-3.2, 3.2]) {
          const hazardZ: number = centerZ + offset;
          place('lamp_housing_toxic', createBoxMesh(0.6, 0.1, 0.25), [0, height - 0.06, hazardZ]);
          lights.push({ position: [0, height - 0.6, hazardZ], color: LIGHT_PALETTE.toxicGreen, intensity: 5.5, range: 9, behavior: { kind: 'pulse', frequencyHertz: 0.4, depth: 0.35 } });
        }
        // Vent stacks leaking the gas.
        for (const side of [-1, 1]) {
          solid('rusted_steel', [side * (halfWidth - 0.35), 0.6, centerZ + side * 2], [0.5, 1.2, 0.5], 1);
          place('lamp_housing_toxic', createBoxMesh(0.36, 0.04, 0.36), [side * (halfWidth - 0.35), 1.22, centerZ + side * 2]);
        }
        break;
      }
      case 'relayGate': {
        const gateId: string = `gate.${chunkIndex}`;
        const gateZ: number = centerZ - 1;
        gates.push({ id: gateId, baseZ: gateZ, openProgress: 0 });
        const plateSide: number = random.chance(0.5) ? -1 : 1;
        const plateZ: number = centerZ + 3;
        const plateY = 1.7;
        const plateX: number = plateSide * halfWidth;
        const polarity: Polarity = random.chance(0.5) ? 'amber' : 'violet';
        const plateId: string = `plate.${chunkIndex}`;
        const plateNormal: Vec3 = [-plateSide, 0, 0];
        const plateMatrix: Mat4 = mat4Compose([plateX, plateY, plateZ], [0, plateSide > 0 ? -Math.PI / 2 : Math.PI / 2, 0], [1, 1, 1]);
        plates.push({ id: plateId, polarity, linkedGateId: gateId, modelMatrix: plateMatrix });
        targets.push({
          id: plateId,
          kind: 'relayPlate',
          chunkIndex,
          polarity,
          bounds: { minimum: [plateSide > 0 ? halfWidth - 0.12 : -halfWidth, plateY - 0.46, plateZ - 0.36], maximum: [plateSide > 0 ? halfWidth : -halfWidth + 0.12, plateY + 0.46, plateZ + 0.36] },
          attachPoint: [plateX - plateSide * 0.09, plateY + 0.05, plateZ],
          attachNormal: plateNormal,
        });
        // Gate frame and a warning light keyed to the plate colour.
        place('rusted_steel', createBoxMesh(halfWidth * 2, 0.5, 0.7), [0, height - 0.25, gateZ]);
        lights.push({
          position: [-plateSide * 0.5 + plateX * 0.6, 2.6, plateZ + 0.4],
          color: polarity === 'amber' ? LIGHT_PALETTE.sodiumAmber : LIGHT_PALETTE.violetCore,
          intensity: 3,
          range: 6,
          behavior: { kind: 'pulse', frequencyHertz: 0.8, depth: 0.5 },
        });
        break;
      }
      case 'foundationChasm': {
        const anchorId: string = `anchor.${chunkIndex}`;
        const anchorCenter: Vec3 = [0, height - 0.75, startZ - (CHASM_GAP_START_OFFSET + CHASM_GAP_END_OFFSET) / 2];
        anchors.push({ id: anchorId, modelMatrix: mat4Compose(anchorCenter, [0, Math.PI / 2, 0], [1, 1, 1]) });
        targets.push({
          id: anchorId,
          kind: 'anchor',
          chunkIndex,
          polarity: null,
          bounds: aabbFromCenter(anchorCenter, [0.4, 0.4, 0.4]),
          attachPoint: anchorCenter,
          attachNormal: [0, -1, 0],
        });
        lights.push({ position: [anchorCenter[0], anchorCenter[1] - 0.3, anchorCenter[2]], color: LIGHT_PALETTE.serviceBlue, intensity: 3.5, range: 7, behavior: { kind: 'steady' } });
        break;
      }
      case 'collapsedCrawl': {
        // A fallen ceiling slab leaves a 1.25 m crawlspace that can only be cleared crouched.
        const slabBottom: number = CRAWL_CLEARANCE_HEIGHT;
        const slabHeight: number = height - slabBottom;
        solid('shattered_foundation_concrete', [0, slabBottom + slabHeight / 2, centerZ], [halfWidth * 2, slabHeight, CRAWL_HALF_LENGTH * 2], 0.6);
        for (const side of [-1, 1]) {
          place('rusted_steel', createCylinderMesh(0.02, 0.02, 1.4, 6), [side * 1.2, slabBottom - 0.3, centerZ + side], [0.8, 0, side * 0.6]);
        }
        lights.push({ position: [0, 0.6, centerZ], color: LIGHT_PALETTE.emergencyRed, intensity: 2.2, range: 5, behavior: { kind: 'flicker', rateHertz: 11, dropoutChance: 0.2 } });
        break;
      }
    }

    // ---- Shared dressing ---------------------------------------------------------------------------------------
    if (!isChasm && archetype !== 'relayGate' && random.chance(0.45)) {
      const side: number = random.chance(0.5) ? -1 : 1;
      const wallLampZ: number = centerZ + random.range(-4, 4);
      place(isRed ? 'lamp_housing_blue' : 'lamp_housing_red', createBoxMesh(0.08, 0.3, 0.3), [side * (halfWidth - 0.04), 1.4, wallLampZ]);
      lights.push({ position: [side * (halfWidth - 0.4), 1.4, wallLampZ], color: isRed ? LIGHT_PALETTE.serviceBlue : LIGHT_PALETTE.emergencyRed, intensity: 2.4, range: 5, behavior: { kind: 'flicker', rateHertz: 9, dropoutChance: 0.15 } });
    }
    if (isCheckpoint && chunkIndex > 0) {
      place('lamp_housing_red', createBoxMesh(halfWidth * 2 - 0.2, 0.02, 0.18), [0, 0.012, startZ - 1.2]);
      lights.push({ position: [halfWidth - 0.6, 2.2, startZ - 1.5], color: LIGHT_PALETTE.sodiumAmber, intensity: 4, range: 7, behavior: { kind: 'steady' } });
    }
    if (!isChasm && archetype !== 'collapsedCrawl') {
      const maskCount: number = random.integer(0, 2);
      for (let mask = 0; mask < maskCount; mask += 1) {
        placeModel('gas_mask_prop', mat4Compose([random.range(-2.3, 2.3), 0.1, centerZ + random.range(-5, 5)], [-Math.PI / 2 + random.range(-0.25, 0.25), random.range(0, Math.PI * 2), 0], [1, 1, 1]));
      }
      const crateCount: number = archetype === 'standard' ? random.integer(0, 3) : 0;
      for (let crate = 0; crate < crateCount; crate += 1) {
        const side: number = random.chance(0.5) ? -1 : 1;
        const size: number = random.range(0.5, 0.9);
        solid('rusted_steel', [side * (halfWidth - size / 2 - 0.1), size / 2, centerZ + random.range(-5, 5)], [size, size, size], 1);
      }
    }

    const meshesByMaterial: Map<MaterialId, MeshData> = new Map();
    for (const [materialId, builder] of builders) {
      if (!builder.isEmpty) {
        meshesByMaterial.set(materialId, builder.build());
      }
    }
    return { chunkIndex, archetype, meshesByMaterial, lights, colliders, targets, toxicZones, gates, plates, anchors, pickups, isCheckpoint };
  }
}

/**
 * Streams corridor chunks around a focus point and is the single authority for world queries:
 * box collision sets, ray casts, toxic zones, pickups, relay plates and blast gates.
 */
export class LevelStreamer {
  private readonly chunks: Map<number, LoadedChunk> = new Map();
  private readonly builder: LevelChunkBuilder;
  /** Survive chunk unload/reload for the whole session. */
  private readonly poweredPlateIds: Set<string> = new Set();
  private readonly collectedPickupIds: Set<string> = new Set();
  public chunksBehind: number = 2;
  public chunksAhead: number = 3;
  public buildBudgetPerFrame: number = 1;

  public constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly meshes: MeshLibrary,
    private readonly lighting: LightingSystem,
    worldSeed: number,
  ) {
    this.builder = new LevelChunkBuilder(meshes, worldSeed);
  }

  public get loadedChunkIndices(): number[] {
    return [...this.chunks.keys()].sort((left: number, right: number) => left - right);
  }

  public isCheckpoint(chunkIndex: number): boolean {
    return this.chunks.get(chunkIndex)?.isCheckpoint ?? isCheckpointChunk(chunkIndex);
  }

  public archetypeAt(chunkIndex: number): ChunkArchetype {
    return this.chunks.get(chunkIndex)?.archetype ?? archetypeForChunk(chunkIndex);
  }

  /** Marks pickups already owned (e.g. restored from a save) so their chunks never spawn them. */
  public markPickupCollected(pickupId: string): void {
    this.collectedPickupIds.add(pickupId);
  }

  private load(chunkIndex: number): void {
    const result: ChunkBuildResult = this.builder.build(chunkIndex, this.collectedPickupIds);
    const drawItems: DrawItem[] = [];
    for (const [materialId, meshData] of result.meshesByMaterial) {
      drawItems.push({ mesh: new GpuMesh(this.gl, `chunk${chunkIndex}.${materialId}`, meshData), materialId, modelMatrix: IDENTITY_MATRIX });
    }
    const lights: PointLight[] = result.lights.map((descriptor: PointLightDescriptor) => this.lighting.add(descriptor));
    for (const gate of result.gates) {
      const plate: RelayPlateRecord | undefined = result.plates.find((candidate: RelayPlateRecord) => candidate.linkedGateId === gate.id);
      if (plate !== undefined && this.poweredPlateIds.has(plate.id)) {
        gate.openProgress = 1;
      }
    }
    this.chunks.set(chunkIndex, {
      chunkIndex,
      archetype: result.archetype,
      drawItems,
      lights,
      colliders: result.colliders,
      targets: result.targets,
      toxicZones: result.toxicZones,
      gates: result.gates,
      plates: result.plates,
      anchors: result.anchors,
      pickups: [...result.pickups],
      isCheckpoint: result.isCheckpoint,
    });
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

  public primeAround(focusChunk: number): void {
    for (let chunkIndex = Math.max(0, focusChunk - this.chunksBehind); chunkIndex <= focusChunk + this.chunksAhead; chunkIndex += 1) {
      if (!this.chunks.has(chunkIndex)) {
        this.load(chunkIndex);
      }
    }
  }

  /** Streams chunks around `focusChunk` and advances blast-gate animation. */
  public update(focusChunk: number, deltaSeconds: number = 0): void {
    const desiredMinimum: number = Math.max(0, focusChunk - this.chunksBehind);
    const desiredMaximum: number = focusChunk + this.chunksAhead;
    for (const chunkIndex of [...this.chunks.keys()]) {
      if (chunkIndex < desiredMinimum - 1 || chunkIndex > desiredMaximum + 1) {
        this.unload(chunkIndex);
      }
    }
    let budget: number = this.buildBudgetPerFrame;
    for (let distance = 0; distance <= Math.max(this.chunksAhead, this.chunksBehind) && budget > 0; distance += 1) {
      for (const chunkIndex of distance === 0 ? [focusChunk] : [focusChunk + distance, focusChunk - distance]) {
        if (budget > 0 && chunkIndex >= desiredMinimum && chunkIndex <= desiredMaximum && !this.chunks.has(chunkIndex)) {
          this.load(chunkIndex);
          budget -= 1;
        }
      }
    }
    for (const chunk of this.chunks.values()) {
      for (const gate of chunk.gates) {
        const plate: RelayPlateRecord | undefined = chunk.plates.find((candidate: RelayPlateRecord) => candidate.linkedGateId === gate.id);
        const shouldOpen: boolean = plate !== undefined && this.poweredPlateIds.has(plate.id);
        if (shouldOpen && gate.openProgress < 1) {
          gate.openProgress = Math.min(1, gate.openProgress + deltaSeconds / GATE_OPEN_SECONDS);
        }
      }
    }
  }

  // ---- Collision ----------------------------------------------------------------------------------------------

  private static gateLift(gate: BlastGateRecord): number {
    return smoothstep(0, 1, gate.openProgress) * (CORRIDOR_DIMENSIONS.height - 0.2);
  }

  private static gateBounds(gate: BlastGateRecord): Aabb {
    const lift: number = LevelStreamer.gateLift(gate);
    return {
      minimum: [-CORRIDOR_DIMENSIONS.halfWidth, lift, gate.baseZ - GATE_THICKNESS / 2],
      maximum: [CORRIDOR_DIMENSIONS.halfWidth, CORRIDOR_DIMENSIONS.height + lift, gate.baseZ + GATE_THICKNESS / 2],
    };
  }

  /** Appends every static and dynamic collider overlapping `region` to `output`. */
  public queryColliders(region: Aabb, output: Aabb[]): void {
    const firstChunk: number = chunkIndexAtZ(region.maximum[2]);
    const lastChunk: number = chunkIndexAtZ(region.minimum[2]);
    for (let chunkIndex = firstChunk - 1; chunkIndex <= lastChunk + 1; chunkIndex += 1) {
      const chunk: LoadedChunk | undefined = this.chunks.get(chunkIndex);
      if (chunk === undefined) {
        continue;
      }
      for (const box of chunk.colliders) {
        if (aabbOverlaps(box, region)) {
          output.push(box);
        }
      }
      for (const gate of chunk.gates) {
        const bounds: Aabb = LevelStreamer.gateBounds(gate);
        if (aabbOverlaps(bounds, region)) {
          output.push(bounds);
        }
      }
    }
  }

  /**
   * Casts a ray against all colliders and tether targets in loaded chunks; returns the nearest hit.
   * Targets win ties against the surface they are mounted on.
   */
  public raycast(origin: Readonly<Vec3>, direction: Readonly<Vec3>, maximumDistance: number): WorldRayHit | null {
    let best: WorldRayHit | null = null;
    const consider = (hit: RayHit | null, target: TetherTarget | null): void => {
      if (hit === null) {
        return;
      }
      const bias: number = target !== null ? 0.05 : 0;
      if (best === null || hit.distance - bias < best.distance) {
        best = { ...hit, target };
      }
    };
    const endZ: number = origin[2] + direction[2] * maximumDistance;
    const firstChunk: number = chunkIndexAtZ(Math.max(origin[2], endZ));
    const lastChunk: number = chunkIndexAtZ(Math.min(origin[2], endZ));
    for (let chunkIndex = firstChunk - 1; chunkIndex <= lastChunk + 1; chunkIndex += 1) {
      const chunk: LoadedChunk | undefined = this.chunks.get(chunkIndex);
      if (chunk === undefined) {
        continue;
      }
      for (const box of chunk.colliders) {
        consider(rayIntersectAabb(origin, direction, box, maximumDistance), null);
      }
      for (const gate of chunk.gates) {
        consider(rayIntersectAabb(origin, direction, LevelStreamer.gateBounds(gate), maximumDistance), null);
      }
      for (const target of chunk.targets) {
        consider(rayIntersectAabb(origin, direction, target.bounds, maximumDistance), target);
      }
    }
    return best;
  }

  /** XZ circle resolution against low colliders (used by the ground-bound entity). */
  public resolveCircleCollision(position: Vec3, radius: number): Vec3 {
    const nearby: Aabb[] = [];
    this.queryColliders({ minimum: [position[0] - radius, 0.2, position[2] - radius], maximum: [position[0] + radius, 1, position[2] + radius] }, nearby);
    for (const box of nearby) {
      if (box.maximum[1] < 0.2 || box.minimum[1] > 1) {
        continue;
      }
      const closestX: number = clamp(position[0], box.minimum[0], box.maximum[0]);
      const closestZ: number = clamp(position[2], box.minimum[2], box.maximum[2]);
      const deltaX: number = position[0] - closestX;
      const deltaZ: number = position[2] - closestZ;
      const distanceSquared: number = deltaX * deltaX + deltaZ * deltaZ;
      if (distanceSquared >= radius * radius) {
        continue;
      }
      if (distanceSquared > 1e-8) {
        const distance: number = Math.sqrt(distanceSquared);
        position[0] += (deltaX / distance) * (radius - distance);
        position[2] += (deltaZ / distance) * (radius - distance);
      } else {
        const exitCandidates: Array<[number, number]> = [
          [box.minimum[0] - radius - position[0], 0],
          [box.maximum[0] + radius - position[0], 0],
          [0, box.minimum[2] - radius - position[2]],
          [0, box.maximum[2] + radius - position[2]],
        ];
        exitCandidates.sort((left, right) => Math.abs(left[0] + left[1]) - Math.abs(right[0] + right[1]));
        const best = exitCandidates[0] as [number, number];
        position[0] += best[0];
        position[2] += best[1];
      }
    }
    position[0] = clamp(position[0], -CORRIDOR_DIMENSIONS.halfWidth + radius, CORRIDOR_DIMENSIONS.halfWidth - radius);
    position[2] = Math.min(position[2], chunkStartZ(0) - radius);
    return position;
  }

  // ---- Hazards, pickups, relay plates ---------------------------------------------------------------------------

  /** Highest toxic concentration at `point` (0 when in clean air), with a 1 m soft edge. */
  public toxicConcentrationAt(point: Readonly<Vec3>): number {
    let concentration = 0;
    const chunk: LoadedChunk | undefined = this.chunks.get(chunkIndexAtZ(point[2]));
    const neighbours: Array<LoadedChunk | undefined> = [chunk, this.chunks.get(chunkIndexAtZ(point[2]) + 1), this.chunks.get(chunkIndexAtZ(point[2]) - 1)];
    for (const candidate of neighbours) {
      for (const zone of candidate?.toxicZones ?? []) {
        const outsideX: number = Math.max(zone.bounds.minimum[0] - point[0], 0, point[0] - zone.bounds.maximum[0]);
        const outsideY: number = Math.max(zone.bounds.minimum[1] - point[1], 0, point[1] - zone.bounds.maximum[1]);
        const outsideZ: number = Math.max(zone.bounds.minimum[2] - point[2], 0, point[2] - zone.bounds.maximum[2]);
        const outsideDistance: number = Math.hypot(outsideX, outsideY, outsideZ);
        concentration = Math.max(concentration, zone.concentration * (1 - smoothstep(0, 1, outsideDistance)));
      }
    }
    return concentration;
  }

  public nearestToxicZone(point: Readonly<Vec3>): ToxicZone | null {
    let best: ToxicZone | null = null;
    let bestDistance = Infinity;
    for (const chunk of this.chunks.values()) {
      for (const zone of chunk.toxicZones) {
        const center: Vec3 = [
          (zone.bounds.minimum[0] + zone.bounds.maximum[0]) / 2,
          (zone.bounds.minimum[1] + zone.bounds.maximum[1]) / 2,
          (zone.bounds.minimum[2] + zone.bounds.maximum[2]) / 2,
        ];
        const distance: number = vec3Distance(center, point);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = zone;
        }
      }
    }
    return best;
  }

  /** Pickup the viewer is looking at within reach (cone of ~18 degrees), or null. */
  public findPickupInView(viewOrigin: Readonly<Vec3>, viewDirection: Readonly<Vec3>, reach: number): PickupRecord | null {
    let best: PickupRecord | null = null;
    let bestAlignment: number = Math.cos((18 * Math.PI) / 180);
    for (const chunk of this.chunks.values()) {
      for (const pickup of chunk.pickups) {
        const toPickup: Vec3 = vec3Subtract(pickup.position, viewOrigin);
        const distance: number = Math.hypot(toPickup[0], toPickup[1], toPickup[2]);
        if (distance > reach) {
          continue;
        }
        const alignment: number = vec3Dot(vec3Normalize(toPickup), viewDirection);
        if (alignment > bestAlignment) {
          bestAlignment = alignment;
          best = pickup;
        }
      }
    }
    return best;
  }

  public collectPickup(pickupId: string): PickupRecord | null {
    for (const chunk of this.chunks.values()) {
      const index: number = chunk.pickups.findIndex((pickup: PickupRecord) => pickup.id === pickupId);
      if (index >= 0) {
        const [removed] = (chunk.pickups as PickupRecord[]).splice(index, 1);
        this.collectedPickupIds.add(pickupId);
        return removed ?? null;
      }
    }
    return null;
  }

  public isPlatePowered(plateId: string): boolean {
    return this.poweredPlateIds.has(plateId);
  }

  /** Powers a relay plate (idempotent); its linked gate begins rising on the next update. */
  public powerRelayPlate(plateId: string): boolean {
    if (this.poweredPlateIds.has(plateId)) {
      return false;
    }
    this.poweredPlateIds.add(plateId);
    return true;
  }

  public isInsideAnyCollider(point: Readonly<Vec3>): boolean {
    const nearby: Aabb[] = [];
    this.queryColliders({ minimum: [point[0] - 0.01, point[1] - 0.01, point[2] - 0.01], maximum: [point[0] + 0.01, point[1] + 0.01, point[2] + 0.01] }, nearby);
    return nearby.some((box: Aabb) => aabbContainsPoint(box, point));
  }

  // ---- Rendering --------------------------------------------------------------------------------------------------

  public collectDrawItems(output: DrawItem[], timeSeconds: number = 0): void {
    const pushModel = (modelId: ImportedMeshId, modelMatrix: Mat4, emissiveBoost: number): void => {
      for (const part of this.meshes.get(modelId).parts) {
        output.push({ mesh: part.gpuMesh, materialId: part.materialId, modelMatrix, emissiveBoost });
      }
    };
    for (const chunk of this.chunks.values()) {
      for (const item of chunk.drawItems) {
        output.push(item);
      }
      for (const gate of chunk.gates) {
        pushModel('blast_gate', mat4Compose([0, LevelStreamer.gateLift(gate), gate.baseZ], [0, 0, 0], [1, 1, 1]), 1);
      }
      for (const plate of chunk.plates) {
        const powered: boolean = this.poweredPlateIds.has(plate.id);
        const idlePulse: number = 0.18 + 0.12 * Math.sin(timeSeconds * 3);
        pushModel(plate.polarity === 'amber' ? 'relay_plate_amber' : 'relay_plate_violet', plate.modelMatrix, powered ? 1.6 : idlePulse);
      }
      for (const anchor of chunk.anchors) {
        pushModel('ceiling_anchor', anchor.modelMatrix, 0.7 + 0.3 * Math.sin(timeSeconds * 2.2));
      }
      for (const pickup of chunk.pickups) {
        const bob: Mat4 = mat4Compose([0, 0.02 * Math.sin(timeSeconds * 2), 0], [0, 0, 0], [1, 1, 1]);
        const matrix: Mat4 = new Float32Array(pickup.modelMatrix);
        matrix[13] = (matrix[13] as number) + (bob[13] as number);
        pushModel('gas_mask_prop', matrix, 1);
      }
    }
  }

  public dispose(): void {
    for (const chunkIndex of [...this.chunks.keys()]) {
      this.unload(chunkIndex);
    }
  }
}
