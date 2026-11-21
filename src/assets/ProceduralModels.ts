import { CAMPAIGN_MESH_BUILDERS } from './CampaignModels';
import type { ProceduralMeshBuilderId } from './AssetManifest';
import type { MeshData } from '../graphics/Geometry';
import { MeshBuilder, createBoxMesh, createCylinderMesh, createSphereMesh, createTubeMesh } from '../graphics/Geometry';
import type { Mat4 } from '../math/Mat4';
import { mat4Compose, mat4Identity } from '../math/Mat4';
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

// ---------------------------------------------------------------------------------------------------------------------
// Tether Rig, relay plates, anchors and gates. Local +Z is the "facing" axis (claw travel, launcher aim, plate normal).
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Tether hands: riveted steel work-gauntlets launched on the cables. Fingers reach along +Z in a half-curled grasp,
 * palm facing -Y, back of the hand (what the player sees) facing +Y. `mirror` = -1 builds the right hand.
 */
type HandSide = 1 | -1;

const FINGER_LAYOUT: ReadonlyArray<{ readonly x: number; readonly length: number; readonly splay: number; readonly radius: number }> = [
  { x: -0.031, length: 0.84, splay: -0.12, radius: 0.0112 },
  { x: -0.0105, length: 1, splay: -0.035, radius: 0.0122 },
  { x: 0.0105, length: 0.95, splay: 0.035, radius: 0.012 },
  { x: 0.03, length: 0.76, splay: 0.12, radius: 0.0105 },
];

/** Finger centreline: knuckle → three phalanges with a relaxed curl, sampled with midpoints for a smooth tube. */
function fingerJoints(baseX: number, lengthScale: number, splay: number): Vec3Tuple[] {
  const segments: readonly number[] = [0.044 * lengthScale, 0.03 * lengthScale, 0.024 * lengthScale];
  const curls: readonly number[] = [0.08, 0.14, 0.16];
  const joints: Vec3Tuple[] = [[baseX, 0.002, 0.044]];
  let angle = 0;
  let current: Vec3Tuple = joints[0] as Vec3Tuple;
  segments.forEach((length: number, index: number) => {
    angle += curls[index] as number;
    const next: Vec3Tuple = [current[0] + Math.sin(splay) * length, current[1] - Math.sin(angle) * length, current[2] + Math.cos(angle) * Math.cos(splay) * length];
    joints.push([(current[0] + next[0]) / 2, (current[1] + next[1]) / 2, (current[2] + next[2]) / 2]);
    joints.push(next);
    current = next;
  });
  return joints;
}

function thumbJoints(mirror: HandSide): Vec3Tuple[] {
  // Palm-down left hand: thumb on +X, angled forward and slightly under the palm; mirrored for the right hand.
  const side: number = -mirror;
  return [
    [side * 0.03, -0.008, -0.03],
    [side * 0.05, -0.012, -0.012],
    [side * 0.066, -0.014, 0.008],
    [side * 0.075, -0.015, 0.026],
    [side * 0.08, -0.015, 0.043],
  ];
}

type Vec3Tuple = [number, number, number];

/** Painted hand: rounded palm, padded thumb base, tapered fingers with rounded tips. Solid colour, no lights. */
function buildTetherHandShell(mirror: HandSide): MeshData {
  const builder = new MeshBuilder();
  const side: number = -mirror;
  // Palm: two overlapping ellipsoids give a soft, slightly cupped slab.
  place(builder, createSphereMesh(1, 18, 12), [0, 0, 0.006], [0, 0, 0], [0.047, 0.019, 0.05]);
  place(builder, createSphereMesh(1, 16, 10), [0, -0.002, -0.03], [0, 0, 0], [0.042, 0.018, 0.034]);
  // Knuckle ridge across the top of the palm.
  place(builder, createSphereMesh(1, 16, 8), [0, 0.004, 0.038], [0, 0, 0], [0.044, 0.015, 0.016]);
  // Thumb base (fleshy pad) on the thumb side of the palm.
  place(builder, createSphereMesh(1, 12, 8), [side * 0.028, -0.006, -0.02], [0, side * 0.5, 0], [0.024, 0.017, 0.034]);
  // Wrist: tapered neck into the cuff.
  place(builder, createCylinderMesh(0.03, 0.036, 0.04, 14), [0, 0, -0.064], [Math.PI / 2, 0, 0], [1, 0.72, 1]);
  // Fingers.
  for (const finger of FINGER_LAYOUT) {
    const joints: Vec3Tuple[] = fingerJoints(finger.x, finger.length, finger.splay);
    const radii: number[] = joints.map((_joint: Vec3Tuple, index: number) => finger.radius * (1 - (index / (joints.length - 1)) * 0.22));
    builder.appendMesh(createTubeMesh(joints, radii, 12), mat4Identity());
    // Rounded tip and subtle knuckle bumps at the two inner joints.
    place(builder, createSphereMesh(finger.radius * 0.8, 10, 8), joints[joints.length - 1] as Vec3Tuple, [0, 0, 0], [1, 1, 1]);
    for (const jointIndex of [2, 4]) {
      place(builder, createSphereMesh(finger.radius * 1.04, 10, 8), joints[jointIndex] as Vec3Tuple, [0, 0, 0], [1, 0.95, 1]);
    }
  }
  const thumb: Vec3Tuple[] = thumbJoints(mirror);
  builder.appendMesh(createTubeMesh(thumb, [0.0145, 0.0138, 0.0128, 0.0118, 0.0108], 12), mat4Identity());
  place(builder, createSphereMesh(0.0092, 10, 8), thumb[thumb.length - 1] as Vec3Tuple, [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Bare steel wrist cuff with two raised bands, where the cable couples in. */
function buildTetherHandCuff(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createCylinderMesh(0.04, 0.04, 0.04, 16), [0, 0, -0.098], [Math.PI / 2, 0, 0], [1, 0.75, 1]);
  for (const bandZ of [-0.116, -0.08]) {
    place(builder, createCylinderMesh(0.043, 0.043, 0.006, 16), [0, 0, bandZ], [Math.PI / 2, 0, 0], [1, 0.77, 1]);
  }
  place(builder, createCylinderMesh(0.016, 0.012, 0.04, 10), [0, 0, -0.135], [Math.PI / 2, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Wrist launcher: the barrel tip sits at the local origin; the housing extends back along -Z. */
function buildTetherLauncherBody(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createBoxMesh(0.11, 0.1, 0.34, 2), [0, -0.01, -0.21], [0, 0, 0], [1, 1, 1]);
  place(builder, createCylinderMesh(0.058, 0.052, 0.1, 12), [0, 0, -0.04], [Math.PI / 2, 0, 0], [1, 1, 1]);
  for (let coil = 0; coil < 3; coil += 1) {
    place(builder, createCylinderMesh(0.066, 0.066, 0.018, 12), [0, -0.01, -0.12 - coil * 0.06], [Math.PI / 2, 0, 0], [1, 1, 1]);
  }
  place(builder, createBoxMesh(0.03, 0.05, 0.16, 2), [0, 0.07, -0.24], [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Relay plate frame: wall-mounted housing; local +Z is the plate's outward normal. */
function buildRelayPlateFrame(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createBoxMesh(0.72, 0.92, 0.05, 1), [0, 0, 0.025], [0, 0, 0], [1, 1, 1]);
  const railThickness = 0.05;
  place(builder, createBoxMesh(0.72, railThickness, 0.09), [0, 0.46 - railThickness / 2, 0.045], [0, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(0.72, railThickness, 0.09), [0, -0.46 + railThickness / 2, 0.045], [0, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(railThickness, 0.92, 0.09), [0.36 - railThickness / 2, 0, 0.045], [0, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(railThickness, 0.92, 0.09), [-0.36 + railThickness / 2, 0, 0.045], [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Relay plate core: a glowing handprint scanner inside an outlined pad, with a scan bar underneath. */
const PLATE_PRINT_FINGERS: ReadonlyArray<{ readonly x: number; readonly length: number; readonly tilt: number }> = [
  { x: -0.075, length: 0.15, tilt: 0.16 },
  { x: -0.025, length: 0.19, tilt: 0.05 },
  { x: 0.025, length: 0.18, tilt: -0.05 },
  { x: 0.073, length: 0.14, tilt: -0.16 },
];

function buildRelayPlateCore(): MeshData {
  const builder = new MeshBuilder();
  const faceZ = 0.062;
  const printY = 0.0;
  // Palm: rounded pad built from a box and two discs.
  place(builder, createBoxMesh(0.2, 0.17, 0.012), [0, printY, faceZ], [0, 0, 0], [1, 1, 1]);
  place(builder, createCylinderMesh(0.1, 0.1, 0.012, 20), [0, printY - 0.085, faceZ], [Math.PI / 2, 0, 0], [1, 1, 0.45]);
  // Fingers: tilted bars with rounded tips, fanning out from the top of the palm.
  for (const finger of PLATE_PRINT_FINGERS) {
    const baseY: number = printY + 0.09;
    const centerX: number = finger.x - Math.sin(finger.tilt) * finger.length * 0.5;
    const centerY: number = baseY + Math.cos(finger.tilt) * finger.length * 0.5;
    place(builder, createBoxMesh(0.04, finger.length, 0.012), [centerX, centerY, faceZ], [0, 0, finger.tilt], [1, 1, 1]);
    const tipX: number = finger.x - Math.sin(finger.tilt) * finger.length;
    const tipY: number = baseY + Math.cos(finger.tilt) * finger.length;
    place(builder, createCylinderMesh(0.02, 0.02, 0.012, 12), [tipX, tipY, faceZ], [Math.PI / 2, 0, 0], [1, 1, 1]);
  }
  // Thumb: angled out from the lower side of the palm.
  const thumbTilt = 0.85;
  const thumbLength = 0.13;
  const thumbBase: [number, number] = [-0.1, printY - 0.03];
  place(builder, createBoxMesh(0.045, thumbLength, 0.012), [thumbBase[0] - Math.sin(thumbTilt) * thumbLength * 0.5, thumbBase[1] + Math.cos(thumbTilt) * thumbLength * 0.5, faceZ], [0, 0, thumbTilt], [1, 1, 1]);
  place(builder, createCylinderMesh(0.0225, 0.0225, 0.012, 12), [thumbBase[0] - Math.sin(thumbTilt) * thumbLength, thumbBase[1] + Math.cos(thumbTilt) * thumbLength, faceZ], [Math.PI / 2, 0, 0], [1, 1, 1]);
  // Pad outline: four thin rails around the print.
  const padHalfWidth = 0.25;
  const padTop = 0.36;
  const padBottom = -0.25;
  const rail = 0.014;
  place(builder, createBoxMesh(padHalfWidth * 2, rail, 0.01), [0, padTop, faceZ], [0, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(padHalfWidth * 2, rail, 0.01), [0, padBottom, faceZ], [0, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(rail, padTop - padBottom, 0.01), [-padHalfWidth, (padTop + padBottom) / 2, faceZ], [0, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(rail, padTop - padBottom, 0.01), [padHalfWidth, (padTop + padBottom) / 2, faceZ], [0, 0, 0], [1, 1, 1]);
  // Scan bar below the pad.
  place(builder, createBoxMesh(0.4, 0.04, 0.02), [0, -0.34, 0.06], [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Ceiling swing anchor: a ring of short cylinders hanging from a mounting rod; origin at ring centre. */
function buildCeilingAnchorRing(): MeshData {
  const builder = new MeshBuilder();
  const ringRadius = 0.22;
  const ringSegments = 14;
  const segmentLength: number = 2 * ringRadius * Math.sin(Math.PI / ringSegments) * 1.08;
  for (let segment = 0; segment < ringSegments; segment += 1) {
    const angle: number = ((segment + 0.5) / ringSegments) * Math.PI * 2;
    place(builder, createCylinderMesh(0.028, 0.028, segmentLength, 6), [Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, 0], [0, 0, angle], [1, 1, 1]);
  }
  place(builder, createCylinderMesh(0.035, 0.035, 0.6, 8), [0, ringRadius + 0.3, 0], [0, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(0.4, 0.06, 0.4), [0, ringRadius + 0.62, 0], [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

function buildCeilingAnchorBeacon(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createSphereMesh(0.045, 10, 8), [0, 0.22 + 0.14, 0.05], [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Ribbed blast gate filling the corridor cross-section; origin at bottom centre. */
function buildBlastGatePanel(): MeshData {
  const builder = new MeshBuilder();
  const width = 6;
  const height = 4.6;
  place(builder, createBoxMesh(width, height, 0.24, 0.5), [0, height / 2, 0], [0, 0, 0], [1, 1, 1]);
  for (let rib = 0; rib < 7; rib += 1) {
    place(builder, createBoxMesh(width, 0.14, 0.38, 0.5), [0, 0.35 + rib * 0.65, 0], [0, 0, 0], [1, 1, 1]);
  }
  // Hazard chevrons as raised diagonal bars across the lower section.
  for (let chevron = -4; chevron <= 4; chevron += 1) {
    place(builder, createBoxMesh(0.18, 1.1, 0.3, 0.5), [chevron * 0.7, 0.75, 0], [0, 0, 0.6], [1, 1, 1]);
  }
  return builder.build();
}

// ---------------------------------------------------------------------------------------------------------------------
// The Tallyman: a gaunt timekeeping automaton. Stands on y = 0, faces +Z, ~2.45 m tall.
// ---------------------------------------------------------------------------------------------------------------------

export const TALLYMAN_HEAD_HEIGHT: number = 2.22;

function buildTallymanFrame(): MeshData {
  const builder = new MeshBuilder();
  const strut: MeshData = createCylinderMesh(0.035, 0.03, 1, 6);
  // Spine and pelvis.
  place(builder, createCylinderMesh(0.05, 0.05, 0.8, 8), [0, 1.25, -0.02], [0.08, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(0.36, 0.1, 0.18), [0, 0.86, 0], [0, 0, 0], [1, 1, 1]);
  // Punch-clock chest cabinet (the dial is a separate emissive part on its front).
  place(builder, createBoxMesh(0.46, 0.52, 0.3, 1), [0, 1.62, 0.02], [0.05, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(0.5, 0.05, 0.34), [0, 1.9, 0.02], [0.05, 0, 0], [1, 1, 1]);
  // Ledger tape spilling from a slot under the dial.
  place(builder, createBoxMesh(0.14, 0.5, 0.008), [0.05, 1.18, 0.2], [0.25, 0, 0.06], [1, 1, 1]);
  // Lantern-cage head: four vertical bars around a hollow core, capped top and bottom.
  place(builder, createBoxMesh(0.26, 0.04, 0.26), [0, TALLYMAN_HEAD_HEIGHT - 0.14, 0], [0, 0, 0], [1, 1, 1]);
  place(builder, createCylinderMesh(0.17, 0.02, 0.16, 4), [0, TALLYMAN_HEAD_HEIGHT + 0.22, 0], [0, Math.PI / 4, 0], [1, 1, 1]);
  for (const [barX, barZ] of [
    [-0.11, -0.11],
    [0.11, -0.11],
    [-0.11, 0.11],
    [0.11, 0.11],
  ] as const) {
    place(builder, strut, [barX, TALLYMAN_HEAD_HEIGHT + 0.03, barZ], [0, 0, 0], [0.7, 0.32, 0.7]);
  }
  place(builder, createCylinderMesh(0.03, 0.03, 0.12, 6), [0, TALLYMAN_HEAD_HEIGHT - 0.22, 0], [0, 0, 0], [1, 1, 1]);
  // Long arms ending in stamping blocks with punch spikes.
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.06, 8, 6), [side * 0.28, 1.84, 0.02], [0, 0, 0], [1, 1, 1]);
    place(builder, strut, [side * 0.34, 1.48, 0.05], [0.1, 0, side * 0.18], [1, 0.75, 1]);
    place(builder, createSphereMesh(0.045, 8, 6), [side * 0.4, 1.12, 0.09], [0, 0, 0], [1, 1, 1]);
    place(builder, strut, [side * 0.42, 0.72, 0.16], [0.22, 0, side * 0.05], [0.9, 0.8, 0.9]);
    place(builder, createBoxMesh(0.12, 0.1, 0.16), [side * 0.43, 0.3, 0.25], [0.2, 0, 0], [1, 1, 1]);
    place(builder, createCylinderMesh(0.012, 0, 0.12, 5), [side * 0.43, 0.2, 0.27], [Math.PI, 0, 0], [1, 1, 1]);
    // Reverse-jointed legs.
    place(builder, strut, [side * 0.13, 0.66, -0.06], [-0.35, 0, 0], [1.2, 0.42, 1.2]);
    place(builder, createSphereMesh(0.05, 8, 6), [side * 0.13, 0.47, -0.14], [0, 0, 0], [1, 1, 1]);
    place(builder, strut, [side * 0.13, 0.25, -0.05], [0.4, 0, 0], [1.1, 0.48, 1.1]);
    place(builder, createBoxMesh(0.1, 0.04, 0.26), [side * 0.13, 0.02, 0.04], [0, 0, 0], [1, 1, 1]);
  }
  return builder.build();
}

function buildTallymanDialFace(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createCylinderMesh(0.17, 0.17, 0.02, 24), [0, 1.66, 0.18], [Math.PI / 2 + 0.05, 0, 0], [1, 1, 1]);
  // Two clock hands.
  place(builder, createBoxMesh(0.016, 0.12, 0.01), [0.03, 1.69, 0.2], [0.05, 0, -0.5], [1, 1, 1]);
  place(builder, createBoxMesh(0.012, 0.09, 0.01), [-0.03, 1.64, 0.2], [0.05, 0, 2.2], [1, 1, 1]);
  return builder.build();
}

/** The Tallyman's only "eye": a horizontal amber slit glowing inside the lantern cage. */
function buildTallymanSightLamp(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createBoxMesh(0.16, 0.025, 0.04), [0, TALLYMAN_HEAD_HEIGHT + 0.03, 0.06], [0, 0, 0], [1, 1, 1]);
  place(builder, createSphereMesh(0.05, 10, 8), [0, TALLYMAN_HEAD_HEIGHT + 0.03, 0], [0, 0, 0], [1, 0.6, 1]);
  return builder.build();
}

// ---------------------------------------------------------------------------------------------------------------------
// Breaker switch: wall-mounted, local +Z is the wall normal; origin at the housing centre.
// ---------------------------------------------------------------------------------------------------------------------

function buildBreakerSwitchHousing(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createBoxMesh(0.42, 0.62, 0.12, 1), [0, 0, 0.06], [0, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(0.06, 0.4, 0.06), [0, 0, 0.14], [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Lever pivots about the local X axis at the origin; the game rotates this part for up/down states. */
function buildBreakerSwitchLever(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createCylinderMesh(0.022, 0.022, 0.26, 8), [0, 0.13, 0.17], [0, 0, 0], [1, 1, 1]);
  place(builder, createBoxMesh(0.12, 0.05, 0.05), [0, 0.27, 0.17], [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

function buildBreakerSwitchIndicator(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createSphereMesh(0.045, 10, 8), [0, 0.42, 0.08], [0, 0, 0], [1, 1, 0.6]);
  return builder.build();
}

export const PROCEDURAL_MESH_BUILDERS: Readonly<Record<ProceduralMeshBuilderId, () => MeshData>> = {
  ...(CAMPAIGN_MESH_BUILDERS as Record<ProceduralMeshBuilderId, () => MeshData>),
  jester_body: buildJesterBody,
  jester_head: buildJesterHead,
  jester_eyes: buildJesterEyes,
  gas_mask_shell: buildGasMaskShell,
  gas_mask_lenses: buildGasMaskLenses,
  gas_mask_filter: buildGasMaskFilter,
  foundation_slabs: buildFoundationSlabs,
  foundation_rebar: buildFoundationRebar,
  tether_hand_shell_left: () => buildTetherHandShell(1),
  tether_hand_shell_right: () => buildTetherHandShell(-1),
  tether_hand_cuff: buildTetherHandCuff,
  tether_launcher_body: buildTetherLauncherBody,
  relay_plate_frame: buildRelayPlateFrame,
  relay_plate_core: buildRelayPlateCore,
  ceiling_anchor_ring: buildCeilingAnchorRing,
  ceiling_anchor_beacon: buildCeilingAnchorBeacon,
  blast_gate_panel: buildBlastGatePanel,
  tallyman_frame: buildTallymanFrame,
  tallyman_dial_face: buildTallymanDialFace,
  tallyman_sight_lamp: buildTallymanSightLamp,
  breaker_switch_housing: buildBreakerSwitchHousing,
  breaker_switch_lever: buildBreakerSwitchLever,
  breaker_switch_indicator: buildBreakerSwitchIndicator,
};

/** Approximate collision footprint (half-extents on X/Z) of the foundation heap, used by the level streamer. */
export const FOUNDATION_HEAP_HALF_EXTENTS: Readonly<{ x: number; z: number }> = { x: 1.25, z: 1.0 };
export const JESTER_HEAD_HEIGHT: number = JESTER_HEAD_CENTER[1];
