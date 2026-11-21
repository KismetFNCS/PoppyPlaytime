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

/**
 * Gully, the old mascot the Foreman "improved". Built as separate posable pieces so the entity can snap him into a new
 * twisted pose whenever he moves unobserved. Limb pieces have their joint (shoulder / hip) at the local origin.
 */
export const JESTER_JOINTS = { shoulderX: 0.34, shoulderY: 1.96, hipX: 0.13, hipY: 1.04 } as const;

function buildJesterBody(): MeshData {
  const builder = new MeshBuilder();
  // Narrow-waisted torso and a pinched hip block.
  place(builder, createCylinderMesh(0.19, 0.31, 0.95, 14), [0, 1.55, 0], [0, 0, 0], [1, 1, 0.62]);
  place(builder, createBoxMesh(0.36, 0.2, 0.22), [0, 1.03, 0], [0, 0, 0], [1, 1, 1]);
  // Ruffled collar.
  const ruff: MeshData = createCylinderMesh(0.44, 0.38, 0.06, 12);
  place(builder, ruff, [0, 2.06, 0], [0, 0, 0], [1, 1, 0.8]);
  place(builder, ruff, [0, 2.11, 0], [0, Math.PI / 12, 0], [0.8, 1, 0.64]);
  // Tattered tunic hem: ragged flaps of uneven length hanging from the waist.
  const flapLengths: readonly number[] = [0.34, 0.22, 0.4, 0.18, 0.3, 0.26, 0.38, 0.2];
  flapLengths.forEach((length: number, index: number) => {
    const angle: number = (index / flapLengths.length) * Math.PI * 2;
    const x: number = Math.sin(angle) * 0.22;
    const z: number = Math.cos(angle) * 0.14;
    place(builder, createBoxMesh(0.11, length, 0.02), [x, 1.08 - length / 2, z], [Math.cos(angle) * 0.18, angle, -Math.sin(angle) * 0.18], [1, 1, 1]);
  });
  // Belt.
  place(builder, createCylinderMesh(0.25, 0.25, 0.05, 14), [0, 1.14, 0], [0, 0, 0], [1, 1, 0.66]);
  return builder.build();
}

/** Stuffing bursting from tears in the tunic, plus a Hushling's bonnet hanging from his belt (a trophy). */
function buildJesterStuffing(): MeshData {
  const builder = new MeshBuilder();
  const tufts: ReadonlyArray<[number, number, number, number]> = [
    [0.15, 1.72, 0.14, 0.06],
    [0.19, 1.68, 0.11, 0.045],
    [-0.12, 1.4, 0.15, 0.05],
    [0.05, 1.9, -0.16, 0.055],
    [-0.27, 1.95, 0.02, 0.045],
  ];
  for (const [x, y, z, r] of tufts) {
    place(builder, createSphereMesh(r, 8, 6), [x, y, z], [0, 0, 0], [1.2, 0.9, 1]);
  }
  // Bonnet: a frilled cloth cup with ties, hung by its ribbon at the left hip.
  place(builder, createCylinderMesh(0.07, 0.11, 0.12, 12), [-0.26, 0.98, 0.06], [0.3, 0, 0.5], [1, 1, 1]);
  place(builder, createCylinderMesh(0.13, 0.13, 0.015, 14), [-0.29, 0.93, 0.08], [0.3, 0, 0.5], [1, 1, 1]);
  builder.appendMesh(createTubeMesh([[-0.22, 1.14, 0.1], [-0.25, 1.06, 0.1], [-0.26, 1.0, 0.08]], 0.008, 6), mat4Identity());
  return builder.build();
}

/** Trophy: a curved shard of the Tallyman's lantern glass strapped to his right shoulder. */
function buildJesterLanternShard(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createCylinderMesh(0.09, 0.07, 0.16, 8), [0.33, 2.05, -0.04], [0.2, 0.3, -0.5], [0.9, 1, 0.35]);
  return builder.build();
}

/** Trophy: an oversized brass wind-up key driven into his back. */
function buildJesterWindKey(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createCylinderMesh(0.025, 0.025, 0.22, 8), [0, 1.62, -0.28], [Math.PI / 2, 0, 0], [1, 1, 1]);
  for (const side of [-1, 1]) {
    place(builder, createCylinderMesh(0.1, 0.1, 0.025, 14), [side * 0.1, 1.62, -0.4], [0, 0, Math.PI / 2], [1, 1, 0.55]);
  }
  return builder.build();
}

function buildJesterHead(): MeshData {
  const builder = new MeshBuilder();
  const [cx, cy, cz] = JESTER_HEAD_CENTER;
  // Elongated porcelain skull, jutting chin and a hooked puppet nose.
  place(builder, createSphereMesh(0.22, 20, 14), [cx, cy, cz], [0, 0, 0], [0.9, 1.16, 0.94]);
  place(builder, createSphereMesh(0.13, 16, 10), [cx, cy - 0.21, cz + 0.08], [0.35, 0, 0], [1, 0.62, 1.05]);
  place(builder, createSphereMesh(0.05, 10, 8), [cx, cy - 0.3, cz + 0.17], [0, 0, 0], [1.1, 0.9, 1]);
  builder.appendMesh(
    createTubeMesh(
      [
        [cx, cy + 0.02, cz + 0.18],
        [cx, cy - 0.01, cz + 0.27],
        [cx, cy - 0.06, cz + 0.33],
        [cx, cy - 0.12, cz + 0.33],
      ],
      [0.035, 0.03, 0.022, 0.012],
      10,
    ),
    mat4Identity(),
  );
  // Sunken cheeks around the grin.
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.06, 10, 8), [cx + side * 0.13, cy - 0.12, cz + 0.13], [0, 0, 0], [1, 0.75, 0.6]);
  }
  return builder.build();
}

/** One drooping hood horn from the crown of the cowl, ending at its bell. lateral: -1 left, 0 middle, 1 right. */
function hoodHornPath(lateral: number): Vec3Tuple[] {
  const [cx, cy, cz] = JESTER_HEAD_CENTER;
  const lift: number = lateral === 0 ? 0.55 : 0.25;
  // Horns rise from the hat crown (which sits on top of the hood), arc outward and droop to their bells.
  return [
    [cx + lateral * 0.1, cy + 0.36, cz - 0.05],
    [cx + lateral * 0.32, cy + 0.56 + lift * 0.15, cz - 0.09],
    [cx + lateral * 0.52, cy + 0.32 + lift * 0.1, cz - 0.09 - (lateral === 0 ? 0.2 : 0)],
    [cx + lateral * 0.58, cy + 0.08, cz - 0.07 - (lateral === 0 ? 0.3 : 0)],
  ];
}

function appendHoodHorn(builder: MeshBuilder, lateral: number): void {
  builder.appendMesh(createTubeMesh(hoodHornPath(lateral), [0.1, 0.065, 0.034, 0.016], 10), mat4Identity());
}

/** Rose hood: cowl framing the porcelain face, draping to the shoulders, plus the hat's left (rose) horn. */
function buildJesterHoodRose(): MeshData {
  const builder = new MeshBuilder();
  const [cx, cy, cz] = JESTER_HEAD_CENTER;
  place(builder, createSphereMesh(0.25, 18, 12), [cx, cy + 0.03, cz - 0.05], [0, 0, 0], [1.02, 1.12, 0.96]);
  // Draped collar falling from the cowl onto the shoulders.
  place(builder, createCylinderMesh(0.3, 0.2, 0.22, 16), [cx, cy - 0.27, cz - 0.04], [0, 0, 0], [1, 1, 0.82]);
  // Face opening rim.
  place(builder, createCylinderMesh(0.2, 0.2, 0.03, 18), [cx, cy - 0.01, cz + 0.17], [Math.PI / 2, 0, 0], [1, 1.18, 1]);
  appendHoodHorn(builder, -1);
  return builder.build();
}

/** The jester hat worn over the hood: gold band and rounded crown, the gold middle horn, and all three bells. */
function buildJesterHoodGold(): MeshData {
  const builder = new MeshBuilder();
  const [cx, cy, cz] = JESTER_HEAD_CENTER;
  place(builder, createCylinderMesh(0.255, 0.27, 0.07, 20), [cx, cy + 0.22, cz - 0.04], [0.08, 0, 0], [1, 1, 0.96]);
  place(builder, createSphereMesh(0.235, 18, 10), [cx, cy + 0.26, cz - 0.05], [0, 0, 0], [1, 0.55, 0.95]);
  appendHoodHorn(builder, 0);
  for (const lateral of [-1, 0, 1]) {
    const tip: Vec3Tuple = hoodHornPath(lateral)[3] as Vec3Tuple;
    place(builder, createSphereMesh(0.048, 10, 8), [tip[0], tip[1] - 0.045, tip[2]], [0, 0, 0], [1, 1.05, 1]);
    place(builder, createCylinderMesh(0.012, 0.012, 0.03, 6), [tip[0], tip[1] - 0.005, tip[2]], [0, 0, 0], [1, 1, 1]);
  }
  return builder.build();
}

/** The hat's right (teal) horn. */
function buildJesterHoodTeal(): MeshData {
  const builder = new MeshBuilder();
  appendHoodHorn(builder, 1);
  return builder.build();
}

/** Glowing slit eyes and a stitched grin (emissive). */
function buildJesterEyes(): MeshData {
  const builder = new MeshBuilder();
  const [cx, cy, cz] = JESTER_HEAD_CENTER;
  for (const side of [-1, 1]) {
    place(builder, createBoxMesh(0.075, 0.014, 0.02), [cx + side * 0.085, cy + 0.06, cz + 0.19], [0, 0, side * -0.35], [1, 1, 1]);
  }
  // Grin: a thin curved seam crossed by stitches.
  const stitches = 9;
  for (let index = 0; index < stitches; index += 1) {
    const t: number = index / (stitches - 1) - 0.5;
    const x: number = cx + t * 0.26;
    const y: number = cy - 0.12 + t * t * 0.22;
    const z: number = cz + 0.2 - Math.abs(t) * 0.05;
    place(builder, createBoxMesh(0.034, 0.008, 0.014), [x, y, z], [0, 0, t * 0.9], [1, 1, 1]);
    place(builder, createBoxMesh(0.006, 0.04, 0.014), [x, y, z + 0.002], [0, 0, t * 0.9], [1, 1, 1]);
  }
  return builder.build();
}

/** Sleeve: shoulder at the origin, hanging down -Y with a slight forward bend at the elbow, ruffled cuff. */
function buildJesterArm(): MeshData {
  const builder = new MeshBuilder();
  builder.appendMesh(createTubeMesh([[0, 0, 0], [0, -0.26, 0.01], [0, -0.52, 0.03], [0, -0.78, 0.08], [0, -1.0, 0.12]], [0.075, 0.062, 0.055, 0.048, 0.045], 10), mat4Identity());
  place(builder, createCylinderMesh(0.09, 0.075, 0.07, 10), [0, -1.02, 0.12], [0.15, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Porcelain hand at the end of the sleeve: narrow palm and long needle-thin fingers. */
function buildJesterHand(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createBoxMesh(0.09, 0.12, 0.035), [0, -1.1, 0.13], [0.15, 0, 0], [1, 1, 1]);
  for (let finger = 0; finger < 4; finger += 1) {
    const offset: number = (finger - 1.5) * 0.026;
    const length: number = finger === 1 || finger === 2 ? 0.34 : 0.28;
    builder.appendMesh(
      createTubeMesh(
        [
          [offset, -1.15, 0.14],
          [offset * 1.4, -1.15 - length * 0.5, 0.17],
          [offset * 1.8, -1.15 - length, 0.24],
        ],
        [0.012, 0.009, 0.003],
        6,
      ),
      mat4Identity(),
    );
  }
  return builder.build();
}

/** Exposed gear at the elbow (steel). */
function buildJesterArmGear(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createCylinderMesh(0.07, 0.07, 0.03, 12), [0.06, -0.52, 0.03], [0, 0, Math.PI / 2], [1, 1, 1]);
  for (let tooth = 0; tooth < 8; tooth += 1) {
    const angle: number = (tooth / 8) * Math.PI * 2;
    place(builder, createBoxMesh(0.032, 0.022, 0.022), [0.06, -0.52 + Math.sin(angle) * 0.078, 0.03 + Math.cos(angle) * 0.078], [angle, 0, 0], [1, 1, 1]);
  }
  return builder.build();
}

/** Striped tights on backward-bending legs ending in curled, pointed shoes. Hip at the origin. */
function buildJesterLeg(): MeshData {
  const builder = new MeshBuilder();
  builder.appendMesh(createTubeMesh([[0, 0, 0], [0, -0.24, 0.08], [0, -0.48, 0.14], [0, -0.74, 0.0], [0, -0.96, -0.1]], [0.08, 0.068, 0.058, 0.05, 0.045], 10), mat4Identity());
  builder.appendMesh(createTubeMesh([[0, -0.98, -0.12], [0, -1.01, 0.05], [0, -0.99, 0.24], [0, -0.93, 0.3]], [0.07, 0.06, 0.035, 0.012], 10), mat4Identity());
  place(builder, createSphereMesh(0.03, 8, 6), [0, -0.92, 0.31], [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Exposed gear at the knee (steel). */
function buildJesterLegGear(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createCylinderMesh(0.075, 0.075, 0.03, 12), [0.07, -0.48, 0.14], [0, 0, Math.PI / 2], [1, 1, 1]);
  place(builder, createCylinderMesh(0.02, 0.02, 0.16, 8), [0, -0.48, 0.14], [0, 0, Math.PI / 2], [1, 1, 1]);
  return builder.build();
}

// ---------------------------------------------------------------------------------------------------------------------
// Cherub (clockwork tin toy angel) and the Seraph (robed six-winged mannequin).
// ---------------------------------------------------------------------------------------------------------------------

export const CHERUB_HEAD_HEIGHT: number = 0.62;
export const SERAPH_HEAD_HEIGHT: number = 3.2;
/** Seraph height used for hit tests (it is a tall machine). */
export const SERAPH_TOTAL_HEIGHT: number = 3.45;

// ---- Cherub Cheeks: a 1970s cry-baby vinyl doll, about 0.9 m tall, with an outsized head. --------------------------

function buildCherubBody(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createSphereMesh(0.14, 16, 12), [0, 0.3, 0], [0, 0, 0], [1, 1.05, 0.92]);
  // Ball-and-socket stubs: rigid limbs that never bend.
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.05, 10, 8), [side * 0.09, 0.18, 0], [0, 0, 0], [1, 1, 1]);
    place(builder, createCylinderMesh(0.05, 0.045, 0.18, 10), [side * 0.09, 0.08, 0.01], [0, 0, 0], [1, 1, 1]);
    place(builder, createSphereMesh(0.05, 10, 8), [side * 0.09, 0.0, 0.03], [0, 0, 0], [1, 0.6, 1.3]);
    place(builder, createSphereMesh(0.045, 10, 8), [side * 0.15, 0.38, 0], [0, 0, 0], [1, 1, 1]);
    place(builder, createCylinderMesh(0.04, 0.036, 0.16, 10), [side * 0.2, 0.3, 0.04], [0.4, 0, side * 0.5], [1, 1, 1]);
  }
  place(builder, createCylinderMesh(0.07, 0.08, 0.06, 12), [0, 0.43, 0], [0, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** The huge, seamless vinyl head (separate piece so it can snap round). */
function buildCherubHead(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createSphereMesh(0.25, 20, 16), [0, CHERUB_HEAD_HEIGHT, 0], [0, 0, 0], [1, 0.98, 0.96]);
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.07, 10, 8), [side * 0.13, CHERUB_HEAD_HEIGHT - 0.08, 0.17], [0, 0, 0], [1, 0.85, 0.6]);
  }
  return builder.build();
}

/** Eye sockets and the round "O" mouth (black voids). */
function buildCherubVoids(): MeshData {
  const builder = new MeshBuilder();
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.075, 14, 10), [side * 0.095, CHERUB_HEAD_HEIGHT + 0.04, 0.19], [0, 0, 0], [1, 1.1, 0.55]);
  }
  place(builder, createCylinderMesh(0.035, 0.035, 0.03, 16), [0, CHERUB_HEAD_HEIGHT - 0.11, 0.235], [Math.PI / 2, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** Glassy painted irises. */
function buildCherubIris(): MeshData {
  const builder = new MeshBuilder();
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.045, 14, 10), [side * 0.095, CHERUB_HEAD_HEIGHT + 0.035, 0.225], [0, 0, 0], [1, 1.05, 0.4]);
  }
  return builder.build();
}

/** Copper grinding teeth spiralling inside the "O" mouth. */
function buildCherubGears(): MeshData {
  const builder = new MeshBuilder();
  for (let tooth = 0; tooth < 10; tooth += 1) {
    const angle: number = (tooth / 10) * Math.PI * 2;
    const depth: number = (tooth % 3) * 0.01;
    place(builder, createCylinderMesh(0.008, 0.0, 0.03, 4), [Math.cos(angle) * 0.026, CHERUB_HEAD_HEIGHT - 0.11 + Math.sin(angle) * 0.026, 0.236 - depth], [Math.PI / 2, 0, angle], [1, 1, 1]);
  }
  return builder.build();
}

/** Two thick acid tear streaks from the inner eye corners to the jaw. */
function buildCherubTears(): MeshData {
  const builder = new MeshBuilder();
  for (const side of [-1, 1]) {
    builder.appendMesh(
      createTubeMesh(
        [
          [side * 0.05, CHERUB_HEAD_HEIGHT, 0.225],
          [side * 0.055, CHERUB_HEAD_HEIGHT - 0.08, 0.225],
          [side * 0.065, CHERUB_HEAD_HEIGHT - 0.17, 0.2],
          [side * 0.07, CHERUB_HEAD_HEIGHT - 0.23, 0.15],
        ],
        [0.012, 0.014, 0.013, 0.01],
        8,
      ),
      mat4Identity(),
    );
  }
  return builder.build();
}

/** A rose growing out of the soft spot on the skull: the bloom. */
function buildCherubRose(): MeshData {
  const builder = new MeshBuilder();
  const top: Vec3Tuple = [0.04, CHERUB_HEAD_HEIGHT + 0.42, -0.02];
  place(builder, createSphereMesh(0.05, 12, 10), top, [0, 0, 0], [1, 0.8, 1]);
  for (let petal = 0; petal < 6; petal += 1) {
    const angle: number = (petal / 6) * Math.PI * 2;
    place(builder, createSphereMesh(0.055, 10, 8), [top[0] + Math.cos(angle) * 0.055, top[1] - 0.01, top[2] + Math.sin(angle) * 0.055], [0, -angle, 0.5], [1, 0.45, 0.8]);
  }
  return builder.build();
}

/** The rose's fleshy stem, rooted in the top of the head. */
function buildCherubStem(): MeshData {
  const builder = new MeshBuilder();
  builder.appendMesh(
    createTubeMesh(
      [
        [0, CHERUB_HEAD_HEIGHT + 0.22, 0],
        [0.03, CHERUB_HEAD_HEIGHT + 0.3, 0.01],
        [0.01, CHERUB_HEAD_HEIGHT + 0.36, -0.02],
        [0.04, CHERUB_HEAD_HEIGHT + 0.4, -0.02],
      ],
      [0.03, 0.022, 0.018, 0.016],
      8,
    ),
    mat4Identity(),
  );
  return builder.build();
}

/** Acid puddle left beneath where a Cherub waits. */
function buildCherubPuddle(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createCylinderMesh(0.32, 0.32, 0.01, 18), [0.05, 0.006, -0.08], [0, 0, 0], [1, 1, 0.7]);
  place(builder, createCylinderMesh(0.14, 0.14, 0.01, 12), [-0.3, 0.006, 0.12], [0, 0, 0], [1, 1, 0.8]);
  return builder.build();
}

// ---- Seraphim Sam: a towering parade marionette on a single wheel, six tool arms, a half-smashed theatre mask. -----

function buildSeraphFrame(): MeshData {
  const builder = new MeshBuilder();
  // Wheel assembly.
  place(builder, createCylinderMesh(0.42, 0.42, 0.18, 20), [0, 0.42, 0], [0, 0, Math.PI / 2], [1, 1, 1]);
  place(builder, createCylinderMesh(0.12, 0.12, 0.3, 10), [0, 0.42, 0], [0, 0, Math.PI / 2], [1, 1, 1]);
  for (const side of [-1, 1]) {
    place(builder, createBoxMesh(0.05, 0.7, 0.08), [side * 0.16, 0.75, 0], [0, 0, side * 0.12], [1, 1, 1]);
  }
  // Spine rising into a broad shoulder yoke; no waist to speak of.
  builder.appendMesh(createTubeMesh([[0, 0.9, 0], [0.02, 1.6, 0.04], [-0.02, 2.3, 0.02], [0, 2.75, 0]], [0.07, 0.06, 0.06, 0.08], 10), mat4Identity());
  place(builder, createBoxMesh(1.4, 0.18, 0.32), [0, 2.82, 0], [0, 0, 0], [1, 1, 1]);
  for (const side of [-1, 1]) {
    place(builder, createSphereMesh(0.16, 12, 10), [side * 0.66, 2.86, 0], [0, 0, 0], [1, 0.9, 1]);
  }
  // Ribs off the spine.
  for (let rib = 0; rib < 4; rib += 1) {
    const y: number = 2.0 + rib * 0.18;
    for (const side of [-1, 1]) {
      builder.appendMesh(createTubeMesh([[0, y, 0.03], [side * 0.18, y - 0.04, 0.12], [side * 0.26, y - 0.1, 0.05]], 0.018, 6), mat4Identity());
    }
  }
  place(builder, createCylinderMesh(0.06, 0.07, 0.2, 10), [0, 2.98, 0], [0, 0, 0], [1, 1, 1]);
  // Iron skull behind the broken half of the mask.
  place(builder, createSphereMesh(0.22, 14, 10), [-0.04, SERAPH_HEAD_HEIGHT, -0.02], [0, 0, 0], [0.95, 1.1, 0.9]);
  return builder.build();
}

/** Tattered purple satin over the shoulders. */
function buildSeraphSatinPurple(): MeshData {
  const builder = new MeshBuilder();
  const lengths: readonly number[] = [0.9, 1.3, 0.7, 1.1, 0.8];
  lengths.forEach((length: number, index: number) => {
    const x: number = -0.6 + index * 0.15;
    place(builder, createBoxMesh(0.14, length, 0.02), [x, 2.75 - length / 2, 0.17], [0.05, 0, (index - 2) * 0.05], [1, 1, 1]);
  });
  return builder.build();
}

/** Gold satin on the other side (the costume is split purple and gold), plus cape scraps down the back. */
function buildSeraphSatinGold(): MeshData {
  const builder = new MeshBuilder();
  const lengths: readonly number[] = [1.2, 0.7, 1.0, 0.6, 1.3];
  lengths.forEach((length: number, index: number) => {
    const x: number = index * 0.15;
    place(builder, createBoxMesh(0.14, length, 0.02), [x, 2.75 - length / 2, 0.17], [0.05, 0, (index - 2) * -0.05], [1, 1, 1]);
  });
  place(builder, createBoxMesh(0.9, 1.4, 0.02), [0, 2.1, -0.18], [-0.08, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** The painted half of the theatre mask (the other half is smashed away). */
function buildSeraphMask(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createSphereMesh(0.26, 18, 14), [0.07, SERAPH_HEAD_HEIGHT, 0.06], [0, 0, 0], [0.62, 1.15, 0.85]);
  place(builder, createBoxMesh(0.12, 0.025, 0.03), [0.1, SERAPH_HEAD_HEIGHT + 0.1, 0.27], [0, 0, -0.2], [1, 1, 1]);
  builder.appendMesh(createTubeMesh([[-0.02, SERAPH_HEAD_HEIGHT - 0.12, 0.27], [0.08, SERAPH_HEAD_HEIGHT - 0.16, 0.26], [0.17, SERAPH_HEAD_HEIGHT - 0.1, 0.22]], 0.012, 6), mat4Identity());
  return builder.build();
}

/** The red camera sensor glaring out of the broken half. */
function buildSeraphEyeRed(): MeshData {
  const builder = new MeshBuilder();
  place(builder, createSphereMesh(0.05, 12, 10), [-0.1, SERAPH_HEAD_HEIGHT + 0.03, 0.17], [0, 0, 0], [1, 1, 0.6]);
  place(builder, createCylinderMesh(0.065, 0.065, 0.04, 14), [-0.1, SERAPH_HEAD_HEIGHT + 0.03, 0.13], [Math.PI / 2, 0, 0], [1, 1, 1]);
  return builder.build();
}

/** One tool arm, shoulder hinge at the origin, reaching along +X. */
function buildSeraphArm(tool: 'shears' | 'saw' | 'needle'): MeshData {
  const builder = new MeshBuilder();
  builder.appendMesh(createTubeMesh([[0, 0, 0], [0.7, 0.12, 0], [1.4, 0.05, 0.05], [2.0, -0.12, 0.08]], [0.05, 0.04, 0.035, 0.03], 8), mat4Identity());
  builder.appendMesh(createTubeMesh([[0.1, 0.06, 0.04], [0.9, 0.18, 0.05], [1.7, 0.02, 0.09]], 0.016, 6), mat4Identity());
  place(builder, createSphereMesh(0.06, 10, 8), [0.7, 0.12, 0], [0, 0, 0], [1, 1, 1]);
  place(builder, createSphereMesh(0.06, 10, 8), [1.4, 0.05, 0.05], [0, 0, 0], [1, 1, 1]);
  const tip: Vec3Tuple = [2.0, -0.12, 0.08];
  if (tool === 'shears') {
    for (const side of [-1, 1]) {
      place(builder, createBoxMesh(0.55, 0.05, 0.015), [tip[0] + 0.25, tip[1] + side * 0.05, tip[2]], [0, 0, side * 0.18], [1, 1, 1]);
    }
  } else if (tool === 'saw') {
    place(builder, createCylinderMesh(0.22, 0.22, 0.02, 24), [tip[0] + 0.18, tip[1], tip[2]], [Math.PI / 2, 0, 0], [1, 1, 1]);
    for (let tooth = 0; tooth < 12; tooth += 1) {
      const angle: number = (tooth / 12) * Math.PI * 2;
      place(builder, createCylinderMesh(0.025, 0, 0.05, 3), [tip[0] + 0.18 + Math.cos(angle) * 0.23, tip[1] + Math.sin(angle) * 0.23, tip[2]], [0, 0, angle - Math.PI / 2], [1, 1, 1]);
    }
  } else {
    place(builder, createCylinderMesh(0.02, 0.0, 0.8, 6), [tip[0] + 0.4, tip[1], tip[2]], [0, 0, -Math.PI / 2], [1, 1, 1]);
    place(builder, createCylinderMesh(0.015, 0.0, 0.6, 6), [tip[0] + 0.3, tip[1] + 0.06, tip[2]], [0, 0, -Math.PI / 2 + 0.1], [1, 1, 1]);
  }
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
function fingerJoints(baseX: number, lengthScale: number, splay: number, clamp: number = 0): Vec3Tuple[] {
  const segments: readonly number[] = [0.044 * lengthScale, 0.03 * lengthScale, 0.024 * lengthScale];
  const openCurls: readonly number[] = [0.08, 0.14, 0.16];
  const gripCurls: readonly number[] = [0.95, 1.15, 0.95];
  const curls: readonly number[] = openCurls.map((open: number, index: number) => open + ((gripCurls[index] as number) - open) * clamp);
  splay *= 1 - clamp * 0.7;
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

function thumbJoints(mirror: HandSide, clamp: number = 0): Vec3Tuple[] {
  // Palm-down left hand: thumb on +X, angled forward and slightly under the palm; mirrored for the right hand.
  // Gripping folds the thumb under the palm to oppose the curled fingers.
  const side: number = -mirror;
  const open: Vec3Tuple[] = [
    [side * 0.03, -0.008, -0.03],
    [side * 0.05, -0.012, -0.012],
    [side * 0.066, -0.014, 0.008],
    [side * 0.075, -0.015, 0.026],
    [side * 0.08, -0.015, 0.043],
  ];
  const grip: Vec3Tuple[] = [
    [side * 0.03, -0.008, -0.03],
    [side * 0.045, -0.02, -0.012],
    [side * 0.045, -0.034, 0.008],
    [side * 0.03, -0.044, 0.024],
    [side * 0.012, -0.048, 0.036],
  ];
  return open.map((point: Vec3Tuple, index: number) => {
    const target: Vec3Tuple = grip[index] as Vec3Tuple;
    return [point[0] + (target[0] - point[0]) * clamp, point[1] + (target[1] - point[1]) * clamp, point[2] + (target[2] - point[2]) * clamp];
  });
}

type Vec3Tuple = [number, number, number];

/** Painted hand: rounded palm, padded thumb base, tapered fingers with rounded tips. Solid colour, no lights. */
function buildTetherHandShell(mirror: HandSide, clamp: number = 0): MeshData {
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
    const joints: Vec3Tuple[] = fingerJoints(finger.x, finger.length, finger.splay, clamp);
    const radii: number[] = joints.map((_joint: Vec3Tuple, index: number) => finger.radius * (1 - (index / (joints.length - 1)) * 0.22));
    builder.appendMesh(createTubeMesh(joints, radii, 12), mat4Identity());
    // Rounded tip and subtle knuckle bumps at the two inner joints.
    place(builder, createSphereMesh(finger.radius * 0.8, 10, 8), joints[joints.length - 1] as Vec3Tuple, [0, 0, 0], [1, 1, 1]);
    for (const jointIndex of [2, 4]) {
      place(builder, createSphereMesh(finger.radius * 1.04, 10, 8), joints[jointIndex] as Vec3Tuple, [0, 0, 0], [1, 0.95, 1]);
    }
  }
  const thumb: Vec3Tuple[] = thumbJoints(mirror, clamp);
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
  cherub_body: buildCherubBody,
  cherub_head: buildCherubHead,
  cherub_voids: buildCherubVoids,
  cherub_iris: buildCherubIris,
  cherub_gears: buildCherubGears,
  cherub_tears: buildCherubTears,
  cherub_rose: buildCherubRose,
  cherub_stem: buildCherubStem,
  cherub_puddle: buildCherubPuddle,
  seraph_frame: buildSeraphFrame,
  seraph_satin_purple: buildSeraphSatinPurple,
  seraph_satin_gold: buildSeraphSatinGold,
  seraph_mask: buildSeraphMask,
  seraph_eye_red: buildSeraphEyeRed,
  seraph_arm_shears: () => buildSeraphArm('shears'),
  seraph_arm_saw: () => buildSeraphArm('saw'),
  seraph_arm_needle: () => buildSeraphArm('needle'),
  jester_stuffing: buildJesterStuffing,
  jester_lantern_shard: buildJesterLanternShard,
  jester_wind_key: buildJesterWindKey,
  jester_head: buildJesterHead,
  jester_hood_rose_part: buildJesterHoodRose,
  jester_hood_gold_part: buildJesterHoodGold,
  jester_hood_teal_part: buildJesterHoodTeal,
  jester_eyes: buildJesterEyes,
  jester_arm: buildJesterArm,
  jester_hand: buildJesterHand,
  jester_arm_gear: buildJesterArmGear,
  jester_leg: buildJesterLeg,
  jester_leg_gear: buildJesterLegGear,
  gas_mask_shell: buildGasMaskShell,
  gas_mask_lenses: buildGasMaskLenses,
  gas_mask_filter: buildGasMaskFilter,
  foundation_slabs: buildFoundationSlabs,
  foundation_rebar: buildFoundationRebar,
  // Held with the back of the hand to the player: teal (left) thumb points right, rose (right) thumb points left.
  tether_hand_shell_left: () => buildTetherHandShell(1),
  tether_hand_shell_right: () => buildTetherHandShell(-1),
  tether_hand_shell_left_clamped: () => buildTetherHandShell(1, 1),
  tether_hand_shell_right_clamped: () => buildTetherHandShell(-1, 1),
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
