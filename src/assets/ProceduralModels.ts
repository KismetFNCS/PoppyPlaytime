import type { ProceduralMeshBuilderId } from './AssetManifest';
import type { MeshData } from '../graphics/Geometry';
import { MeshBuilder, createBoxMesh, createCylinderMesh, createSphereMesh } from '../graphics/Geometry';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose } from '../math/Mat4';
import { SeededRandom } from '../math/Random';

/**
 * Procedural stand-ins for every imported-mesh part. Units are metres; models stand on y = 0 and face +Z.
 * Replace with authored OBJ files by setting `importUri` in the AssetManifest.
 */

function place(builder: MeshBuilder, mesh: MeshData, translation: [number, number, number], rotation: [number, number, number], scale: [number, number, number]): void {
  const transform: Mat4 = mat4Compose(translation, rotation, scale);
  builder.appendMesh(mesh, transform);
}

/** Jester hat geometry: three drooping horns radiating from the crown, each tipped with a bell. */
const JESTER_HEAD_CENTER: [number, number, number] = [0, 2.36, 0];

function buildJesterBody(): MeshData {
  const builder = new MeshBuilder();
  const limb: MeshData = createCylinderMesh(0.07, 0.055, 1, 10);
  const torso: MeshData = createCylinderMesh(0.2, 0.32, 0.95, 14);
  // Torso: inverted taper (broad shoulders, narrow waist) and a pinched hip block.
  place(builder, torso, [0, 1.55, 0], [0, 0, 0], [1, 1, 0.62]);
  place(builder, createBoxMesh(0.38, 0.22, 0.24), [0, 1.02, 0], [0, 0, 0], [1, 1, 1]);
  // Ruffled collar: stacked flattened discs with alternating rotation.
  const ruff: MeshData = createCylinderMesh(0.46, 0.4, 0.06, 12);
  place(builder, ruff, [0, 2.06, 0], [0, 0, 0], [1, 1, 0.8]);
  place(builder, ruff, [0, 2.11, 0], [0, Math.PI / 12, 0], [0.82, 1, 0.66]);
  // Long, slack arms: upper arm angled out, forearm hanging past the knees, splayed fingers.
  for (const side of [-1, 1]) {
    place(builder, limb, [side * 0.42, 1.62, 0], [0, 0, side * 0.42], [1, 0.7, 1]);
    place(builder, limb, [side * 0.6, 0.98, 0.06], [0.12, 0, side * 0.08], [0.9, 0.85, 0.9]);
    for (let finger = 0; finger < 4; finger += 1) {
      const spread: number = (finger - 1.5) * 0.035;
      place(builder, createCylinderMesh(0.018, 0.006, 0.32, 6), [side * 0.64 + spread, 0.45, 0.1], [0.25, 0, side * 0.1 + spread * 2], [1, 1, 1]);
    }
    // Thin legs with a slight knock-kneed angle and curled pointed shoes.
    place(builder, limb, [side * 0.13, 0.5, 0], [0, 0, -side * 0.05], [1.15, 1, 1.15]);
    place(builder, createCylinderMesh(0.09, 0.0, 0.42, 10), [side * 0.16, 0.06, 0.16], [Math.PI / 2 - 0.25, 0, 0], [1, 1, 0.7]);
    place(builder, createSphereMesh(0.035, 8, 6), [side * 0.16, 0.12, 0.38], [0, 0, 0], [1, 1, 1]);
  }
  // Three-horned hat with bells.
  const hornDirections: Array<[number, number]> = [
    [-1, 0.25],
    [0, 0.5],
    [1, 0.25],
  ];
  for (const [lateral, lift] of hornDirections) {
    const baseX: number = JESTER_HEAD_CENTER[0] + lateral * 0.12;
    const baseY: number = JESTER_HEAD_CENTER[1] + 0.2;
    place(builder, createCylinderMesh(0.12, 0.045, 0.42, 10), [baseX + lateral * 0.14, baseY + 0.12 + lift * 0.12, -0.02], [0, 0, -lateral * 0.95], [1, 1, 0.8]);
    place(builder, createCylinderMesh(0.045, 0.0, 0.36, 8), [baseX + lateral * 0.42, baseY + 0.12 + lift * 0.05, -0.02], [0, 0, -lateral * 2.1], [1, 1, 1]);
    place(builder, createSphereMesh(0.05, 10, 8), [baseX + lateral * 0.55, baseY - 0.06, -0.02], [0, 0, 0], [1, 1, 1]);
  }
  return builder.build();
}

function buildJesterHead(): MeshData {
  const builder = new MeshBuilder();
  // Elongated porcelain skull with a protruding jaw.
  place(builder, createSphereMesh(0.22, 20, 14), JESTER_HEAD_CENTER, [0, 0, 0], [0.92, 1.18, 0.95]);
  place(builder, createSphereMesh(0.14, 16, 10), [0, JESTER_HEAD_CENTER[1] - 0.2, 0.06], [0.2, 0, 0], [1.05, 0.6, 1]);
  // Rounded cheek bulbs pushing the grin outward.
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.07, 10, 8), [side * 0.12, JESTER_HEAD_CENTER[1] - 0.1, 0.15], [0, 0, 0], [1, 0.8, 0.7]);
  }
  return builder.build();
}

function buildJesterEyes(): MeshData {
  const builder = new MeshBuilder();
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.035, 10, 8), [side * 0.082, JESTER_HEAD_CENTER[1] + 0.035, 0.19], [0, 0, side * 0.3], [1.5, 0.55, 0.6]);
  }
  // Thin glowing grin line.
  place(builder, createBoxMesh(0.2, 0.012, 0.02), [0, JESTER_HEAD_CENTER[1] - 0.14, 0.205], [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Gas mask face plate, modelled lying on its back by default; instances rotate it into place. */
function buildGasMaskShell(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createSphereMesh(0.16, 18, 12), [0, 0.16, 0], [0, 0, 0], [0.95, 1.2, 0.62]);
  // Head-harness straps.
  const strap: MeshData = createBoxMesh(0.03, 0.42, 0.012);
  place(builder, strap, [-0.11, 0.24, -0.08], [0.9, 0, 0.35], [1, 1, 1]);
  place(builder, strap, [0.11, 0.24, -0.08], [0.9, 0, -0.35], [1, 1, 1]);
  // Exhalation valve housing below the filter.
  place(builder, createCylinderMesh(0.05, 0.045, 0.05, 12), [0, 0.04, 0.09], [Math.PI / 2, 0, 0], [1, 1, 1]);
  return builder.build();
}

function buildGasMaskLenses(): MeshData {
  const builder = new MeshBuilder();
  for (const side of [-1, 1]) {
    place(builder, createCylinderMesh(0.055, 0.055, 0.02, 16), [side * 0.068, 0.22, 0.095], [Math.PI / 2 - 0.15, 0, 0], [1, 1, 1]);
  }
  return builder.build();
}

function buildGasMaskFilter(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createCylinderMesh(0.065, 0.065, 0.13, 16), [0, 0.07, 0.15], [Math.PI / 2 + 0.35, 0, 0], [1, 1, 1]);
  for (const side of [-1, 1]) {
    place(builder, createCylinderMesh(0.03, 0.03, 0.02, 10), [side * 0.068, 0.22, 0.1], [Math.PI / 2 - 0.15, 0, 0], [1.25, 1, 1.25]);
  }
  return builder.build();
}

/** Heap of broken, tilted foundation slabs centred on the origin. Deterministic for consistent collision sizing. */
function buildFoundationSlabs(): MeshData {
  const builder = new MeshBuilder();
  const random = new SeededRandom(0xf0da7104);
  for (let slab = 0; slab < 7; slab += 1) {
    const width: number = random.range(0.7, 1.6);
    const depth: number = random.range(0.6, 1.3);
    const thickness: number = random.range(0.18, 0.32);
    place(
      builder,
      createBoxMesh(width, thickness, depth, 0.5),
      [random.range(-0.9, 0.9), random.range(0.08, 0.6), random.range(-0.7, 0.7)],
      [random.range(-0.55, 0.55), random.range(0, Math.PI), random.range(-0.5, 0.5)],
      [1, 1, 1],
    );
  }
  // Tall tilted shard standing out of the heap.
  place(builder, createBoxMesh(0.9, 1.5, 0.22, 0.5), [0.2, 0.7, -0.15], [0.25, 0.4, -0.3], [1, 1, 1]);
  return builder.build();
}

function buildFoundationRebar(): MeshData {
  const builder = new MeshBuilder();
  const random = new SeededRandom(0x0eba4);
  for (let bar = 0; bar < 9; bar += 1) {
    const length: number = random.range(0.6, 1.5);
    place(
      builder,
      createCylinderMesh(0.014, 0.014, length, 6),
      [random.range(-0.8, 0.8), random.range(0.3, 0.9), random.range(-0.6, 0.6)],
      [random.range(-1.1, 1.1), random.range(0, Math.PI), random.range(-1.1, 1.1)],
      [1, 1, 1],
    );
  }
  return builder.build();
}

export const PROCEDURAL_MESH_BUILDERS: Readonly<Record<ProceduralMeshBuilderId, () => MeshData>> = {
  jester_body: buildJesterBody,
  jester_head: buildJesterHead,
  jester_eyes: buildJesterEyes,
  gas_mask_shell: buildGasMaskShell,
  gas_mask_lenses: buildGasMaskLenses,
  gas_mask_filter: buildGasMaskFilter,
  foundation_slabs: buildFoundationSlabs,
  foundation_rebar: buildFoundationRebar,
};

/** Approximate collision footprint (half-extents on X/Z) of the foundation heap, used by the level streamer. */
export const FOUNDATION_HEAP_HALF_EXTENTS: Readonly<{ x: number; z: number }> = { x: 1.25, z: 1.0 };
export const JESTER_HEAD_HEIGHT: number = JESTER_HEAD_CENTER[1];
