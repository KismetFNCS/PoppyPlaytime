import type { ProceduralMeshBuilderId } from './AssetManifest';
import type { MeshData } from '../graphics/Geometry';
import { MeshBuilder, createBoxMesh, createCylinderMesh, createLatheMesh, createSphereMesh, createTubeMesh, sampleQuadraticBezier } from '../graphics/Geometry';
import { mat4Compose } from '../math/Mat4';
import { SeededRandom } from '../math/Random';
import type { Vec3 } from '../math/Vec3';

/**
 * Procedural models for the Chapter VI campaign cast, props and the factory exterior.
 * Units are metres; characters stand on y = 0 and face +Z unless noted.
 */

function place(builder: MeshBuilder, mesh: MeshData, translation: Vec3, rotation: Vec3 = [0, 0, 0], scale: Vec3 = [1, 1, 1]): void {
  builder.appendMesh(mesh, mat4Compose(translation, rotation, scale));
}

function build(compose: (builder: MeshBuilder) => void): () => MeshData {
  return () => {
    const builder = new MeshBuilder();
    compose(builder);
    return builder.build();
  };
}

/** Ring of short cylinders approximating a torus in the XY plane (local), radius R, tube r. */
function placeRing(builder: MeshBuilder, center: Vec3, ringRadius: number, tubeRadius: number, segments: number, rotation: Vec3): void {
  const path: Vec3[] = [];
  for (let segment = 0; segment <= segments; segment += 1) {
    const angle: number = (segment / segments) * Math.PI * 2;
    path.push([Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius, 0]);
  }
  builder.appendMesh(createTubeMesh(path, tubeRadius, 8), mat4Compose(center, rotation, [1, 1, 1]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Tether Rig launcher upgrade: brass collars, a top-mounted cable spool and a pressure gauge (barrel tip at origin, −Z back).
// ---------------------------------------------------------------------------------------------------------------------

const tetherLauncherBrass = build((builder) => {
  for (const collarZ of [-0.02, -0.33]) {
    place(builder, createCylinderMesh(0.066, 0.066, 0.03, 16), [0, -0.01, collarZ], [Math.PI / 2, 0, 0]);
  }
  // Spool drum riding on top of the housing, axle across X.
  place(builder, createCylinderMesh(0.055, 0.055, 0.075, 18), [0, 0.085, -0.2], [0, 0, Math.PI / 2]);
  place(builder, createCylinderMesh(0.07, 0.07, 0.008, 18), [0.04, 0.085, -0.2], [0, 0, Math.PI / 2]);
  place(builder, createCylinderMesh(0.07, 0.07, 0.008, 18), [-0.04, 0.085, -0.2], [0, 0, Math.PI / 2]);
  // Feed hose curling from the housing back toward the forearm.
  builder.appendMesh(createTubeMesh(sampleQuadraticBezier([0.05, -0.02, -0.36], [0.12, -0.1, -0.42], [0.08, -0.16, -0.55], 10), 0.016, 8), mat4Compose([0, 0, 0], [0, 0, 0], [1, 1, 1]));
});

const tetherLauncherGauge = build((builder) => {
  place(builder, createCylinderMesh(0.026, 0.026, 0.012, 16), [0.062, 0.01, -0.15], [0, 0, Math.PI / 2]);
});

// ---------------------------------------------------------------------------------------------------------------------
// Pip: wind-up tin mouse, ~0.38 m nose to tail-base, faces +Z.
// ---------------------------------------------------------------------------------------------------------------------

const pipBody = build((builder) => {
  // Egg-shaped body lathed around Y, then laid along Z.
  const body: MeshData = createLatheMesh(
    [
      [0.001, -0.17],
      [0.06, -0.15],
      [0.095, -0.08],
      [0.1, 0.0],
      [0.085, 0.08],
      [0.05, 0.15],
      [0.001, 0.19],
    ],
    20,
  );
  place(builder, body, [0, 0.1, 0], [Math.PI / 2, 0, 0], [1, 0.9, 1]);
  // Pointed snout.
  place(builder, createCylinderMesh(0.045, 0.006, 0.09, 12), [0, 0.095, 0.22], [Math.PI / 2, 0, 0]);
  // Round ears.
  for (const side of [-1, 1]) {
    place(builder, createCylinderMesh(0.045, 0.045, 0.01, 16), [side * 0.055, 0.19, 0.08], [0.25, 0, side * 0.35 + Math.PI / 2]);
  }
});

const pipFittings = build((builder) => {
  // Wheels instead of feet.
  for (const side of [-1, 1]) {
    for (const wheelZ of [-0.08, 0.09]) {
      place(builder, createCylinderMesh(0.03, 0.03, 0.02, 12), [side * 0.085, 0.03, wheelZ], [0, 0, Math.PI / 2]);
    }
  }
  // Wind-up key on the back: shaft + two lobes.
  place(builder, createCylinderMesh(0.008, 0.008, 0.07, 8), [0, 0.215, -0.02]);
  for (const side of [-1, 1]) {
    place(builder, createCylinderMesh(0.035, 0.035, 0.008, 14), [side * 0.034, 0.255, -0.02], [Math.PI / 2, 0, 0]);
  }
  // Rivet eyes and nose bead.
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.012, 8, 6), [side * 0.04, 0.13, 0.16]);
  }
  place(builder, createSphereMesh(0.014, 8, 6), [0, 0.095, 0.27]);
  // Curling tail running back and up to the lantern.
  builder.appendMesh(
    createTubeMesh(sampleQuadraticBezier([0, 0.09, -0.17], [0, 0.05, -0.38], [0, 0.32, -0.34], 14), [0.014, 0.013, 0.012, 0.011, 0.01, 0.009, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008, 0.008], 8),
    mat4Compose([0, 0, 0], [0, 0, 0], [1, 1, 1]),
  );
  // Lantern cage around the glow.
  placeRing(builder, [0, 0.36, -0.34], 0.032, 0.004, 12, [0, 0, 0]);
  placeRing(builder, [0, 0.36, -0.34], 0.032, 0.004, 12, [0, Math.PI / 2, 0]);
});

const pipLantern = build((builder) => {
  place(builder, createSphereMesh(0.026, 12, 10), [0, 0.36, -0.34]);
});

export const PIP_LANTERN_OFFSET: Vec3 = [0, 0.36, -0.34];

// ---------------------------------------------------------------------------------------------------------------------
// The Choir Mother: tripod crane scaffold (~3.9 m), crown of porcelain angel heads with a halo, paper wings, music-box heart.
// ---------------------------------------------------------------------------------------------------------------------

export const CHOIR_MOTHER_HEAD_HEIGHT: number = 3.35;

const choirScaffold = build((builder) => {
  const strut: MeshData = createCylinderMesh(0.035, 0.035, 1, 8);
  // Square lattice mast from 1.2 m to 3.0 m.
  for (const [x, z] of [
    [-0.22, -0.22],
    [0.22, -0.22],
    [0.22, 0.22],
    [-0.22, 0.22],
  ] as const) {
    place(builder, strut, [x, 2.1, z], [0, 0, 0], [1, 1.8, 1]);
  }
  for (let level = 0; level < 4; level += 1) {
    const y: number = 1.25 + level * 0.55;
    place(builder, createBoxMesh(0.48, 0.04, 0.04), [0, y, -0.22]);
    place(builder, createBoxMesh(0.48, 0.04, 0.04), [0, y, 0.22]);
    place(builder, createBoxMesh(0.04, 0.04, 0.48), [-0.22, y, 0]);
    place(builder, createBoxMesh(0.04, 0.04, 0.48), [0.22, y, 0]);
    // Diagonal brace on the front face.
    place(builder, strut, [0, y + 0.27, 0.22], [0, 0, (level % 2 === 0 ? 1 : -1) * 0.68], [0.7, 0.68, 0.7]);
  }
  // Three jointed legs splayed 120° apart: thigh up to the knee, shin down to a hooked foot.
  for (let leg = 0; leg < 3; leg += 1) {
    const angle: number = (leg / 3) * Math.PI * 2 + Math.PI / 2;
    const outX: number = Math.cos(angle);
    const outZ: number = Math.sin(angle);
    const hip: Vec3 = [outX * 0.25, 1.25, outZ * 0.25];
    const knee: Vec3 = [outX * 1.05, 1.75, outZ * 1.05];
    const foot: Vec3 = [outX * 1.35, 0.04, outZ * 1.35];
    builder.appendMesh(createTubeMesh([hip, knee], 0.05, 8), mat4Compose([0, 0, 0], [0, 0, 0], [1, 1, 1]));
    builder.appendMesh(createTubeMesh([knee, foot], [0.045, 0.025], 8), mat4Compose([0, 0, 0], [0, 0, 0], [1, 1, 1]));
    place(builder, createSphereMesh(0.08, 10, 8), knee);
    place(builder, createCylinderMesh(0.03, 0.0, 0.22, 6), [foot[0] + outX * 0.06, 0.08, foot[2] + outZ * 0.06], [outZ * 1.2, 0, -outX * 1.2]);
  }
  // Crane jib and dangling hook chain from the crown.
  place(builder, createBoxMesh(0.08, 0.08, 1.4), [0, 3.05, 0.45]);
  builder.appendMesh(createTubeMesh([[0, 3.0, 1.1], [0.03, 2.4, 1.12], [0, 1.9, 1.1]], 0.012, 6), mat4Compose([0, 0, 0], [0, 0, 0], [1, 1, 1]));
  place(builder, createCylinderMesh(0.05, 0.0, 0.16, 8), [0, 1.82, 1.1], [Math.PI, 0, 0]);
});

const choirHeads = build((builder) => {
  // Three cherubic nursery-angel heads facing outward from the crown; the front one is largest.
  const heads: ReadonlyArray<{ position: Vec3; yaw: number; scale: number }> = [
    { position: [0, CHOIR_MOTHER_HEAD_HEIGHT, 0.18], yaw: 0, scale: 1.25 },
    { position: [-0.24, CHOIR_MOTHER_HEAD_HEIGHT - 0.08, -0.1], yaw: -2.1, scale: 0.95 },
    { position: [0.24, CHOIR_MOTHER_HEAD_HEIGHT - 0.08, -0.1], yaw: 2.1, scale: 0.95 },
  ];
  for (const head of heads) {
    const s: number = head.scale;
    place(builder, createSphereMesh(0.17 * s, 18, 14), head.position, [0, head.yaw, 0], [1, 1.08, 1]);
    const forwardX: number = Math.sin(head.yaw);
    const forwardZ: number = Math.cos(head.yaw);
    for (const side of [-1, 1]) {
      // Full cheeks.
      const rightX: number = Math.cos(head.yaw);
      const rightZ: number = -Math.sin(head.yaw);
      place(builder, createSphereMesh(0.06 * s, 10, 8), [head.position[0] + (forwardX * 0.11 + rightX * side * 0.08) * s, head.position[1] - 0.05 * s, head.position[2] + (forwardZ * 0.11 + rightZ * side * 0.08) * s]);
    }
    // Small pursed mouth, mid-hymn.
    place(builder, createCylinderMesh(0.022 * s, 0.022 * s, 0.03, 10), [head.position[0] + forwardX * 0.165 * s, head.position[1] - 0.08 * s, head.position[2] + forwardZ * 0.165 * s], [Math.PI / 2, head.yaw, 0]);
  }
  // Porcelain halo hovering over the crown.
  placeRing(builder, [0, CHOIR_MOTHER_HEAD_HEIGHT + 0.36, 0.03], 0.36, 0.022, 28, [Math.PI / 2, 0, 0]);
  // Neck collar joining heads to the mast.
  place(builder, createCylinderMesh(0.3, 0.2, 0.18, 16), [0, CHOIR_MOTHER_HEAD_HEIGHT - 0.28, 0]);
});

const choirWings = build((builder) => {
  // Two fans of hymn sheets: each sheet pivots from the mast at a different angle.
  for (const side of [-1, 1]) {
    for (let sheet = 0; sheet < 7; sheet += 1) {
      const spread: number = -0.2 + sheet * 0.22;
      const length: number = 0.9 + Math.sin(sheet * 0.9) * 0.18;
      place(
        builder,
        createBoxMesh(0.32, length, 0.006),
        [side * (0.35 + Math.cos(spread) * length * 0.45), 2.75 + Math.sin(spread) * length * 0.45, -0.25 - sheet * 0.015],
        [0.12, side * 0.25, side * (Math.PI / 2 - spread)],
      );
    }
  }
});

const choirHeart = build((builder) => {
  // Gutted music-box drum glowing inside the mast, pins radiating outward.
  place(builder, createCylinderMesh(0.15, 0.15, 0.34, 18), [0, 2.05, 0], [0, 0, Math.PI / 2]);
  const random = new SeededRandom(0xc401);
  for (let pin = 0; pin < 14; pin += 1) {
    const angle: number = random.range(0, Math.PI * 2);
    place(builder, createCylinderMesh(0.008, 0.008, 0.06, 5), [random.range(-0.15, 0.15), 2.05 + Math.sin(angle) * 0.17, Math.cos(angle) * 0.17], [angle, 0, 0]);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Hushling: 0.55 m gowned porcelain figurine with folded stub wings and pinprick eyes.
// ---------------------------------------------------------------------------------------------------------------------

export const HUSHLING_HEAD_HEIGHT: number = 0.47;

const hushlingBody = build((builder) => {
  const gown: MeshData = createLatheMesh(
    [
      [0.001, 0],
      [0.16, 0.0],
      [0.15, 0.06],
      [0.11, 0.2],
      [0.075, 0.33],
      [0.06, 0.38],
      [0.001, 0.4],
    ],
    18,
  );
  place(builder, gown, [0, 0, 0]);
  place(builder, createSphereMesh(0.085, 14, 10), [0, HUSHLING_HEAD_HEIGHT, 0], [0, 0, 0], [1, 1.05, 1]);
  for (const side of [-1, 1]) {
    // Folded stub wings and clasped arms.
    place(builder, createBoxMesh(0.12, 0.16, 0.012), [side * 0.07, 0.32, -0.07], [0.3, side * 0.5, side * 0.3]);
    place(builder, createCylinderMesh(0.022, 0.018, 0.16, 8), [side * 0.05, 0.27, 0.06], [1.1, 0, -side * 0.3]);
  }
  // Tiny ring halo tilted back.
  placeRing(builder, [0, HUSHLING_HEAD_HEIGHT + 0.12, -0.02], 0.07, 0.007, 16, [Math.PI / 2 + 0.3, 0, 0]);
});

const hushlingEyes = build((builder) => {
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.012, 8, 6), [side * 0.03, HUSHLING_HEAD_HEIGHT + 0.01, 0.075]);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// The Foreman: wall-mounted machine heart, ~3.2 m across, facing +Z. Origin at floor centre below the face.
// ---------------------------------------------------------------------------------------------------------------------

export const FOREMAN_CORE_HEIGHT: number = 2.3;

const foremanHousing = build((builder) => {
  placeRing(builder, [0, FOREMAN_CORE_HEIGHT, 0], 1.3, 0.12, 36, [0, 0, 0]);
  placeRing(builder, [0, FOREMAN_CORE_HEIGHT, -0.15], 1.55, 0.06, 36, [0, 0, 0]);
  // Spokes from the ring to the core.
  for (let spoke = 0; spoke < 8; spoke += 1) {
    const angle: number = (spoke / 8) * Math.PI * 2;
    builder.appendMesh(
      createTubeMesh([[Math.cos(angle) * 1.25, FOREMAN_CORE_HEIGHT + Math.sin(angle) * 1.25, 0], [Math.cos(angle) * 0.35, FOREMAN_CORE_HEIGHT + Math.sin(angle) * 0.35, 0.1]], 0.05, 8),
      mat4Compose([0, 0, 0], [0, 0, 0], [1, 1, 1]),
    );
  }
  // Cable bundles drooping to the floor and into the walls.
  const random = new SeededRandom(0xf0e);
  for (let cable = 0; cable < 10; cable += 1) {
    const startAngle: number = random.range(Math.PI * 0.9, Math.PI * 2.1);
    const start: Vec3 = [Math.cos(startAngle) * 1.3, FOREMAN_CORE_HEIGHT + Math.sin(startAngle) * 1.3, -0.05];
    const end: Vec3 = [random.range(-2.8, 2.8), 0.05, random.range(-0.6, 0.6)];
    const control: Vec3 = [(start[0] + end[0]) / 2, Math.min(start[1], end[1]) - 0.4, 0.3];
    builder.appendMesh(createTubeMesh(sampleQuadraticBezier(start, control, end, 12), random.range(0.03, 0.06), 8), mat4Compose([0, 0, 0], [0, 0, 0], [1, 1, 1]));
  }
  // Base plinth.
  place(builder, createBoxMesh(2.4, 0.6, 1.0, 1), [0, 0.3, -0.2]);
});

const foremanFaces = build((builder) => {
  // Welded punch-clock dials arranged as a face: two eye dials, a brow row and a jaw row.
  const dials: ReadonlyArray<[number, number, number]> = [
    [-0.42, 0.25, 0.22],
    [0.42, 0.25, 0.22],
    [-0.75, 0.55, 0.14],
    [-0.25, 0.65, 0.13],
    [0.25, 0.65, 0.13],
    [0.75, 0.55, 0.14],
    [-0.6, -0.45, 0.15],
    [-0.2, -0.55, 0.15],
    [0.2, -0.55, 0.15],
    [0.6, -0.45, 0.15],
  ];
  for (const [x, y, radius] of dials) {
    place(builder, createCylinderMesh(radius, radius, 0.06, 20), [x, FOREMAN_CORE_HEIGHT + y, 0.18], [Math.PI / 2, 0, 0]);
  }
});

const foremanHeart = build((builder) => {
  place(builder, createSphereMesh(0.3, 20, 14), [0, FOREMAN_CORE_HEIGHT, 0.12]);
  for (const side of [-1, 1]) {
    // Pupils glowing inside the two eye dials.
    place(builder, createSphereMesh(0.07, 10, 8), [side * 0.42, FOREMAN_CORE_HEIGHT + 0.25, 0.26]);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------------------------------

const musicBoxCase = build((builder) => {
  place(builder, createBoxMesh(0.42, 0.22, 0.3, 2), [0, 0.11, 0]);
  // Open lid tilted back.
  place(builder, createBoxMesh(0.42, 0.02, 0.3, 2), [0, 0.3, -0.2], [-1.1, 0, 0]);
  // Pedestal stand.
  place(builder, createCylinderMesh(0.05, 0.08, 0.8, 12), [0, -0.4, 0]);
  place(builder, createCylinderMesh(0.25, 0.25, 0.04, 16), [0, -0.8, 0]);
});

const musicBoxFigure = build((builder) => {
  place(builder, createLatheMesh([[0.001, 0.22], [0.05, 0.22], [0.04, 0.28], [0.025, 0.34], [0.001, 0.36]], 14), [0, 0, 0]);
  place(builder, createSphereMesh(0.03, 10, 8), [0, 0.385, 0]);
});

const musicBoxGlow = build((builder) => {
  place(builder, createBoxMesh(0.3, 0.03, 0.12), [0, 0.2, 0.05]);
});

const cribFrame = build((builder) => {
  const width = 1.2;
  const depth = 0.62;
  for (const y of [0.38, 0.95]) {
    place(builder, createBoxMesh(width, 0.05, 0.05), [0, y, depth / 2]);
    place(builder, createBoxMesh(width, 0.05, 0.05), [0, y, -depth / 2]);
    place(builder, createBoxMesh(0.05, 0.05, depth), [width / 2, y, 0]);
    place(builder, createBoxMesh(0.05, 0.05, depth), [-width / 2, y, 0]);
  }
  for (const [x, z] of [
    [width / 2, depth / 2],
    [-width / 2, depth / 2],
    [width / 2, -depth / 2],
    [-width / 2, -depth / 2],
  ] as const) {
    place(builder, createCylinderMesh(0.035, 0.035, 1.05, 10), [x, 0.52, z]);
  }
  for (let bar = 1; bar < 12; bar += 1) {
    const x: number = -width / 2 + (bar / 12) * width;
    place(builder, createCylinderMesh(0.012, 0.012, 0.57, 6), [x, 0.665, depth / 2]);
    place(builder, createCylinderMesh(0.012, 0.012, 0.57, 6), [x, 0.665, -depth / 2]);
  }
  place(builder, createBoxMesh(width - 0.06, 0.06, depth - 0.06), [0, 0.42, 0]);
});

const shelfFrame = build((builder) => {
  for (const [x, z] of [
    [-0.78, -0.24],
    [0.78, -0.24],
    [-0.78, 0.24],
    [0.78, 0.24],
  ] as const) {
    place(builder, createBoxMesh(0.05, 2.3, 0.05), [x, 1.15, z]);
  }
  for (let level = 0; level < 5; level += 1) {
    place(builder, createBoxMesh(1.6, 0.03, 0.5, 1), [0, 0.12 + level * 0.52, 0]);
  }
});

const shelfPapers = build((builder) => {
  const random = new SeededRandom(0xa7c4);
  for (let level = 0; level < 5; level += 1) {
    let x = -0.72;
    while (x < 0.7) {
      const width: number = random.range(0.08, 0.26);
      const height: number = random.range(0.12, 0.4);
      if (random.chance(0.8)) {
        place(builder, createBoxMesh(width, height, random.range(0.28, 0.42)), [x + width / 2, 0.135 + level * 0.52 + height / 2, 0], [0, 0, random.range(-0.08, 0.08)]);
      }
      x += width + random.range(0.01, 0.05);
    }
  }
});

const tapeCase = build((builder) => {
  place(builder, createBoxMesh(0.19, 0.026, 0.105), [0, 0.013, 0]);
});

const tapeLabel = build((builder) => {
  place(builder, createBoxMesh(0.12, 0.004, 0.06), [0, 0.028, 0.008]);
});

const intercomHousing = build((builder) => {
  place(builder, createBoxMesh(0.36, 0.48, 0.1, 2), [0, 0, 0.05]);
  place(builder, createCylinderMesh(0.03, 0.03, 0.22, 8), [0, 0.32, 0.05]);
  for (let slat = 0; slat < 6; slat += 1) {
    place(builder, createBoxMesh(0.26, 0.012, 0.03), [0, 0.12 - slat * 0.045, 0.11]);
  }
});

const intercomGrille = build((builder) => {
  place(builder, createBoxMesh(0.06, 0.02, 0.02), [0.12, -0.17, 0.11]);
});

const conveyorBeltSurface = build((builder) => {
  place(builder, createBoxMesh(1.2, 0.06, 4, 0.5), [0, 0.86, 0]);
});

const conveyorRollers = build((builder) => {
  for (const side of [-1, 1]) {
    place(builder, createBoxMesh(0.08, 0.16, 4.1), [side * 0.64, 0.86, 0]);
    for (const legZ of [-1.7, 0, 1.7]) {
      place(builder, createBoxMesh(0.06, 0.82, 0.06), [side * 0.6, 0.41, legZ]);
    }
  }
  for (let roller = 0; roller < 9; roller += 1) {
    place(builder, createCylinderMesh(0.05, 0.05, 1.22, 10), [0, 0.8, -1.9 + roller * 0.475], [0, 0, Math.PI / 2]);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Factory exterior (loading-screen vista). A hall is 24 m wide (X), 10 m tall, 14 m deep (Z), facing +Z.
// ---------------------------------------------------------------------------------------------------------------------

const factoryHallWalls = build((builder) => {
  place(builder, createBoxMesh(24, 10, 14, 0.5), [0, 5, 0]);
  // Pilasters and a stepped parapet along the facade.
  for (let pilaster = 0; pilaster <= 6; pilaster += 1) {
    place(builder, createBoxMesh(0.8, 10.6, 0.6, 0.5), [-12 + pilaster * 4, 5.3, 7.2]);
  }
  place(builder, createBoxMesh(24.6, 0.8, 0.9, 0.5), [0, 10.2, 7.1]);
  // Loading dock door frame.
  place(builder, createBoxMesh(5.4, 5, 0.4, 0.5), [0, 2.5, 7.25]);
});

const factoryHallRoof = build((builder) => {
  // Sawtooth roof: four north-light bays.
  for (let bay = 0; bay < 4; bay += 1) {
    const z: number = -5.25 + bay * 3.5;
    place(builder, createBoxMesh(24, 0.2, 3.9), [0, 11.3, z], [0.45, 0, 0]);
    place(builder, createBoxMesh(24, 1.6, 0.15), [0, 11.0, z + 1.75]);
  }
  // Rolling shutter on the dock.
  place(builder, createBoxMesh(4.8, 4.6, 0.1, 1), [0, 2.3, 7.4]);
  // Water tower on the roof.
  place(builder, createCylinderMesh(1.6, 1.6, 2.6, 18), [7, 13.6, -3]);
  place(builder, createCylinderMesh(1.8, 0.1, 1.0, 18), [7, 15.4, -3]);
  for (const [x, z] of [
    [5.8, -4.2],
    [8.2, -4.2],
    [5.8, -1.8],
    [8.2, -1.8],
  ] as const) {
    place(builder, createCylinderMesh(0.08, 0.08, 2.2, 6), [x, 11.3, z]);
  }
});

const factoryHallWindows = build((builder) => {
  // Two rows of lit windows; a few are dark for variety.
  const random = new SeededRandom(0xfac7);
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 12; column += 1) {
      if (random.chance(0.72) && Math.abs(column - 5.5) > 1.6) {
        place(builder, createBoxMesh(1.1, 1.8, 0.05), [-11 + column * 2 + 0.0, 4.2 + row * 3.4, 7.05]);
      }
    }
  }
});

const smokestackColumn = build((builder) => {
  place(
    builder,
    createLatheMesh(
      [
        [2.3, 0],
        [2.2, 2],
        [1.9, 10],
        [1.6, 20],
        [1.5, 26],
        [1.75, 26.6],
        [1.75, 27.2],
        [1.35, 27.2],
      ],
      22,
    ),
    [0, 0, 0],
  );
  // Painted bands.
  for (const bandY of [18, 22]) {
    place(builder, createCylinderMesh(1.66, 1.62, 0.8, 22), [0, bandY, 0]);
  }
});

const smokestackBeacon = build((builder) => {
  for (let lamp = 0; lamp < 4; lamp += 1) {
    const angle: number = (lamp / 4) * Math.PI * 2;
    place(builder, createSphereMesh(0.22, 10, 8), [Math.cos(angle) * 1.8, 26.9, Math.sin(angle) * 1.8]);
  }
});

export const CAMPAIGN_MESH_BUILDERS: Readonly<Partial<Record<ProceduralMeshBuilderId, () => MeshData>>> = {
  tether_launcher_brass: tetherLauncherBrass,
  tether_launcher_gauge: tetherLauncherGauge,
  pip_body: pipBody,
  pip_fittings: pipFittings,
  pip_lantern: pipLantern,
  choir_scaffold: choirScaffold,
  choir_heads: choirHeads,
  choir_wings: choirWings,
  choir_heart: choirHeart,
  hushling_body: hushlingBody,
  hushling_eyes: hushlingEyes,
  foreman_housing: foremanHousing,
  foreman_faces: foremanFaces,
  foreman_heart: foremanHeart,
  music_box_case: musicBoxCase,
  music_box_figure: musicBoxFigure,
  music_box_glow: musicBoxGlow,
  crib_frame: cribFrame,
  shelf_frame: shelfFrame,
  shelf_papers: shelfPapers,
  tape_case: tapeCase,
  tape_label: tapeLabel,
  intercom_housing: intercomHousing,
  intercom_grille: intercomGrille,
  conveyor_belt_surface: conveyorBeltSurface,
  conveyor_rollers: conveyorRollers,
  factory_hall_walls: factoryHallWalls,
  factory_hall_roof: factoryHallRoof,
  factory_hall_windows: factoryHallWindows,
  smokestack_column: smokestackColumn,
  smokestack_beacon: smokestackBeacon,
};
