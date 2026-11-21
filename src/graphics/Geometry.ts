import type { Mat4 } from '../math/Mat4';
import { mat4NormalMatrix, mat4TransformPoint } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { vec3Normalize } from '../math/Vec3';

/** CPU-side indexed triangle mesh with full tangent frames. */
export interface MeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly uvs: Float32Array;
  /** xyz tangent, w handedness (+1 / -1). */
  readonly tangents: Float32Array;
  readonly indices: Uint32Array;
}

export interface AxisAlignedBounds {
  readonly minimum: Vec3;
  readonly maximum: Vec3;
}

/** Growable mesh accumulator: primitives are appended with an optional transform, then finalised. */
export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  public get vertexCount(): number {
    return this.positions.length / 3;
  }

  public get isEmpty(): boolean {
    return this.indices.length === 0;
  }

  public addVertex(position: Readonly<Vec3>, normal: Readonly<Vec3>, u: number, v: number): number {
    const index: number = this.vertexCount;
    this.positions.push(position[0], position[1], position[2]);
    this.normals.push(normal[0], normal[1], normal[2]);
    this.uvs.push(u, v);
    return index;
  }

  public addTriangle(first: number, second: number, third: number): void {
    this.indices.push(first, second, third);
  }

  /** Appends another mesh, transforming its positions and normals by `transform`. */
  public appendMesh(source: MeshData, transform: Mat4): void {
    const normalMatrix: Float32Array = mat4NormalMatrix(transform);
    const baseIndex: number = this.vertexCount;
    const sourceVertexCount: number = source.positions.length / 3;
    for (let vertex = 0; vertex < sourceVertexCount; vertex += 1) {
      const position: Vec3 = mat4TransformPoint(transform, [
        source.positions[vertex * 3] as number,
        source.positions[vertex * 3 + 1] as number,
        source.positions[vertex * 3 + 2] as number,
      ]);
      const nx: number = source.normals[vertex * 3] as number;
      const ny: number = source.normals[vertex * 3 + 1] as number;
      const nz: number = source.normals[vertex * 3 + 2] as number;
      const normal: Vec3 = vec3Normalize([
        (normalMatrix[0] as number) * nx + (normalMatrix[3] as number) * ny + (normalMatrix[6] as number) * nz,
        (normalMatrix[1] as number) * nx + (normalMatrix[4] as number) * ny + (normalMatrix[7] as number) * nz,
        (normalMatrix[2] as number) * nx + (normalMatrix[5] as number) * ny + (normalMatrix[8] as number) * nz,
      ]);
      this.addVertex(position, normal, source.uvs[vertex * 2] as number, source.uvs[vertex * 2 + 1] as number);
    }
    for (const index of source.indices) {
      this.indices.push(baseIndex + index);
    }
  }

  public build(): MeshData {
    const positions = new Float32Array(this.positions);
    const normals = new Float32Array(this.normals);
    const uvs = new Float32Array(this.uvs);
    const indices = new Uint32Array(this.indices);
    return { positions, normals, uvs, indices, tangents: computeTangents(positions, normals, uvs, indices) };
  }
}

/** Per-vertex tangent generation (Lengyel's method) with Gram-Schmidt orthogonalisation. */
export function computeTangents(positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array): Float32Array {
  const vertexCount: number = positions.length / 3;
  const tangentAccumulator = new Float32Array(vertexCount * 3);
  const bitangentAccumulator = new Float32Array(vertexCount * 3);
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const i0: number = indices[triangle] as number;
    const i1: number = indices[triangle + 1] as number;
    const i2: number = indices[triangle + 2] as number;
    const edge1x = (positions[i1 * 3] as number) - (positions[i0 * 3] as number);
    const edge1y = (positions[i1 * 3 + 1] as number) - (positions[i0 * 3 + 1] as number);
    const edge1z = (positions[i1 * 3 + 2] as number) - (positions[i0 * 3 + 2] as number);
    const edge2x = (positions[i2 * 3] as number) - (positions[i0 * 3] as number);
    const edge2y = (positions[i2 * 3 + 1] as number) - (positions[i0 * 3 + 1] as number);
    const edge2z = (positions[i2 * 3 + 2] as number) - (positions[i0 * 3 + 2] as number);
    const deltaU1 = (uvs[i1 * 2] as number) - (uvs[i0 * 2] as number);
    const deltaV1 = (uvs[i1 * 2 + 1] as number) - (uvs[i0 * 2 + 1] as number);
    const deltaU2 = (uvs[i2 * 2] as number) - (uvs[i0 * 2] as number);
    const deltaV2 = (uvs[i2 * 2 + 1] as number) - (uvs[i0 * 2 + 1] as number);
    const determinant = deltaU1 * deltaV2 - deltaU2 * deltaV1;
    const inverse = Math.abs(determinant) < 1e-10 ? 1 : 1 / determinant;
    const tx = (edge1x * deltaV2 - edge2x * deltaV1) * inverse;
    const ty = (edge1y * deltaV2 - edge2y * deltaV1) * inverse;
    const tz = (edge1z * deltaV2 - edge2z * deltaV1) * inverse;
    const bx = (edge2x * deltaU1 - edge1x * deltaU2) * inverse;
    const by = (edge2y * deltaU1 - edge1y * deltaU2) * inverse;
    const bz = (edge2z * deltaU1 - edge1z * deltaU2) * inverse;
    for (const vertexIndex of [i0, i1, i2]) {
      tangentAccumulator[vertexIndex * 3] = (tangentAccumulator[vertexIndex * 3] as number) + tx;
      tangentAccumulator[vertexIndex * 3 + 1] = (tangentAccumulator[vertexIndex * 3 + 1] as number) + ty;
      tangentAccumulator[vertexIndex * 3 + 2] = (tangentAccumulator[vertexIndex * 3 + 2] as number) + tz;
      bitangentAccumulator[vertexIndex * 3] = (bitangentAccumulator[vertexIndex * 3] as number) + bx;
      bitangentAccumulator[vertexIndex * 3 + 1] = (bitangentAccumulator[vertexIndex * 3 + 1] as number) + by;
      bitangentAccumulator[vertexIndex * 3 + 2] = (bitangentAccumulator[vertexIndex * 3 + 2] as number) + bz;
    }
  }
  const tangents = new Float32Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const normal: Vec3 = [normals[vertex * 3] as number, normals[vertex * 3 + 1] as number, normals[vertex * 3 + 2] as number];
    const rawTangent: Vec3 = [
      tangentAccumulator[vertex * 3] as number,
      tangentAccumulator[vertex * 3 + 1] as number,
      tangentAccumulator[vertex * 3 + 2] as number,
    ];
    const projection: number = normal[0] * rawTangent[0] + normal[1] * rawTangent[1] + normal[2] * rawTangent[2];
    let tangent: Vec3 = vec3Normalize([
      rawTangent[0] - normal[0] * projection,
      rawTangent[1] - normal[1] * projection,
      rawTangent[2] - normal[2] * projection,
    ]);
    if (tangent[0] === 0 && tangent[1] === 0 && tangent[2] === 0) {
      tangent = Math.abs(normal[0]) < 0.9 ? vec3Normalize([0, -normal[2], normal[1]]) : vec3Normalize([-normal[2], 0, normal[0]]);
    }
    const crossX = normal[1] * tangent[2] - normal[2] * tangent[1];
    const crossY = normal[2] * tangent[0] - normal[0] * tangent[2];
    const crossZ = normal[0] * tangent[1] - normal[1] * tangent[0];
    const handedness: number =
      crossX * (bitangentAccumulator[vertex * 3] as number) +
        crossY * (bitangentAccumulator[vertex * 3 + 1] as number) +
        crossZ * (bitangentAccumulator[vertex * 3 + 2] as number) <
      0
        ? -1
        : 1;
    tangents[vertex * 4] = tangent[0];
    tangents[vertex * 4 + 1] = tangent[1];
    tangents[vertex * 4 + 2] = tangent[2];
    tangents[vertex * 4 + 3] = handedness;
  }
  return tangents;
}

export function computeBounds(mesh: MeshData): AxisAlignedBounds {
  const minimum: Vec3 = [Infinity, Infinity, Infinity];
  const maximum: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value: number = mesh.positions[index + axis] as number;
      if (value < minimum[axis]!) minimum[axis] = value;
      if (value > maximum[axis]!) maximum[axis] = value;
    }
  }
  return { minimum, maximum };
}

/** Axis-aligned box centred at the origin; UVs are world-scaled by `texelsPerUnit` so tiling is uniform. */
export function createBoxMesh(width: number, height: number, depth: number, uvUnitsPerMeter: number = 0.5): MeshData {
  const builder = new MeshBuilder();
  const halfWidth: number = width / 2;
  const halfHeight: number = height / 2;
  const halfDepth: number = depth / 2;
  type FaceDefinition = { normal: Vec3; uAxis: Vec3; vAxis: Vec3; uSize: number; vSize: number; offset: number };
  const faces: FaceDefinition[] = [
    { normal: [1, 0, 0], uAxis: [0, 0, -1], vAxis: [0, 1, 0], uSize: depth, vSize: height, offset: halfWidth },
    { normal: [-1, 0, 0], uAxis: [0, 0, 1], vAxis: [0, 1, 0], uSize: depth, vSize: height, offset: halfWidth },
    { normal: [0, 1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, -1], uSize: width, vSize: depth, offset: halfHeight },
    { normal: [0, -1, 0], uAxis: [1, 0, 0], vAxis: [0, 0, 1], uSize: width, vSize: depth, offset: halfHeight },
    { normal: [0, 0, 1], uAxis: [1, 0, 0], vAxis: [0, 1, 0], uSize: width, vSize: height, offset: halfDepth },
    { normal: [0, 0, -1], uAxis: [-1, 0, 0], vAxis: [0, 1, 0], uSize: width, vSize: height, offset: halfDepth },
  ];
  for (const face of faces) {
    const corners: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    const indices: number[] = corners.map(([uSign, vSign]: [number, number]) => {
      const position: Vec3 = [
        face.normal[0] * face.offset + face.uAxis[0] * uSign * (face.uSize / 2) + face.vAxis[0] * vSign * (face.vSize / 2),
        face.normal[1] * face.offset + face.uAxis[1] * uSign * (face.uSize / 2) + face.vAxis[1] * vSign * (face.vSize / 2),
        face.normal[2] * face.offset + face.uAxis[2] * uSign * (face.uSize / 2) + face.vAxis[2] * vSign * (face.vSize / 2),
      ];
      return builder.addVertex(
        position,
        face.normal,
        ((uSign + 1) / 2) * face.uSize * uvUnitsPerMeter,
        ((vSign + 1) / 2) * face.vSize * uvUnitsPerMeter,
      );
    });
    builder.addTriangle(indices[0] as number, indices[1] as number, indices[2] as number);
    builder.addTriangle(indices[0] as number, indices[2] as number, indices[3] as number);
  }
  return builder.build();
}

/** Horizontal plane facing +Y. */
export function createPlaneMesh(width: number, depth: number, uvUnitsPerMeter: number = 0.5): MeshData {
  const builder = new MeshBuilder();
  const halfWidth: number = width / 2;
  const halfDepth: number = depth / 2;
  const a = builder.addVertex([-halfWidth, 0, halfDepth], [0, 1, 0], 0, 0);
  const b = builder.addVertex([halfWidth, 0, halfDepth], [0, 1, 0], width * uvUnitsPerMeter, 0);
  const c = builder.addVertex([halfWidth, 0, -halfDepth], [0, 1, 0], width * uvUnitsPerMeter, depth * uvUnitsPerMeter);
  const d = builder.addVertex([-halfWidth, 0, -halfDepth], [0, 1, 0], 0, depth * uvUnitsPerMeter);
  builder.addTriangle(a, b, c);
  builder.addTriangle(a, c, d);
  return builder.build();
}

/** Capped frustum along +Y, centred at the origin. `radiusTop` of 0 yields a cone. */
export function createCylinderMesh(radiusBottom: number, radiusTop: number, height: number, radialSegments: number = 16): MeshData {
  const builder = new MeshBuilder();
  const halfHeight: number = height / 2;
  const slope: number = (radiusBottom - radiusTop) / height;
  for (let segment = 0; segment <= radialSegments; segment += 1) {
    const angle: number = (segment / radialSegments) * Math.PI * 2;
    const cosine: number = Math.cos(angle);
    const sine: number = Math.sin(angle);
    const normal: Vec3 = vec3Normalize([cosine, slope, sine]);
    builder.addVertex([cosine * radiusBottom, -halfHeight, sine * radiusBottom], normal, segment / radialSegments, 0);
    builder.addVertex([cosine * radiusTop, halfHeight, sine * radiusTop], normal, segment / radialSegments, height);
  }
  for (let segment = 0; segment < radialSegments; segment += 1) {
    const bottomCurrent: number = segment * 2;
    const topCurrent: number = segment * 2 + 1;
    const bottomNext: number = (segment + 1) * 2;
    const topNext: number = (segment + 1) * 2 + 1;
    builder.addTriangle(bottomCurrent, topCurrent, bottomNext);
    builder.addTriangle(bottomNext, topCurrent, topNext);
  }
  const capDefinitions: Array<{ y: number; radius: number; normal: Vec3 }> = [
    { y: halfHeight, radius: radiusTop, normal: [0, 1, 0] },
    { y: -halfHeight, radius: radiusBottom, normal: [0, -1, 0] },
  ];
  for (const cap of capDefinitions) {
    if (cap.radius <= 1e-5) {
      continue;
    }
    const centerIndex: number = builder.addVertex([0, cap.y, 0], cap.normal, 0.5, 0.5);
    const ringStart: number = builder.vertexCount;
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const angle: number = (segment / radialSegments) * Math.PI * 2;
      builder.addVertex(
        [Math.cos(angle) * cap.radius, cap.y, Math.sin(angle) * cap.radius],
        cap.normal,
        0.5 + Math.cos(angle) * 0.5,
        0.5 + Math.sin(angle) * 0.5,
      );
    }
    for (let segment = 0; segment < radialSegments; segment += 1) {
      if (cap.normal[1] > 0) {
        builder.addTriangle(centerIndex, ringStart + segment + 1, ringStart + segment);
      } else {
        builder.addTriangle(centerIndex, ringStart + segment, ringStart + segment + 1);
      }
    }
  }
  return builder.build();
}

export function createSphereMesh(radius: number, widthSegments: number = 18, heightSegments: number = 12): MeshData {
  const builder = new MeshBuilder();
  for (let ring = 0; ring <= heightSegments; ring += 1) {
    const polar: number = (ring / heightSegments) * Math.PI;
    for (let segment = 0; segment <= widthSegments; segment += 1) {
      const azimuth: number = (segment / widthSegments) * Math.PI * 2;
      const normal: Vec3 = [Math.sin(polar) * Math.cos(azimuth), Math.cos(polar), Math.sin(polar) * Math.sin(azimuth)];
      builder.addVertex([normal[0] * radius, normal[1] * radius, normal[2] * radius], normal, segment / widthSegments, ring / heightSegments);
    }
  }
  const rowLength: number = widthSegments + 1;
  for (let ring = 0; ring < heightSegments; ring += 1) {
    for (let segment = 0; segment < widthSegments; segment += 1) {
      const current: number = ring * rowLength + segment;
      const below: number = current + rowLength;
      builder.addTriangle(current, current + 1, below);
      builder.addTriangle(current + 1, below + 1, below);
    }
  }
  return builder.build();
}

/**
 * Surface of revolution around +Y from a profile of (radius, height) points, bottom to top.
 * Normals come from the profile's 2D tangent: n = (cosθ·dy, −dr, sinθ·dy) normalised, where (dr, dy)
 * is the profile direction at each point (central differences).
 */
export function createLatheMesh(profile: ReadonlyArray<readonly [number, number]>, radialSegments: number = 20): MeshData {
  const builder = new MeshBuilder();
  const pointCount: number = profile.length;
  let accumulatedLength = 0;
  const lengths: number[] = [0];
  for (let index = 1; index < pointCount; index += 1) {
    const previous = profile[index - 1] as readonly [number, number];
    const current = profile[index] as readonly [number, number];
    accumulatedLength += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    lengths.push(accumulatedLength);
  }
  for (let index = 0; index < pointCount; index += 1) {
    const point = profile[index] as readonly [number, number];
    const before = profile[Math.max(0, index - 1)] as readonly [number, number];
    const after = profile[Math.min(pointCount - 1, index + 1)] as readonly [number, number];
    const deltaRadius: number = after[0] - before[0];
    const deltaHeight: number = after[1] - before[1];
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const angle: number = (segment / radialSegments) * Math.PI * 2;
      const cosine: number = Math.cos(angle);
      const sine: number = Math.sin(angle);
      const normal: Vec3 = vec3Normalize([cosine * deltaHeight, -deltaRadius, sine * deltaHeight]);
      builder.addVertex([cosine * point[0], point[1], sine * point[0]], normal, segment / radialSegments, (lengths[index] as number) * 2);
    }
  }
  const rowLength: number = radialSegments + 1;
  for (let ring = 0; ring < pointCount - 1; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const current: number = ring * rowLength + segment;
      const above: number = current + rowLength;
      builder.addTriangle(current, above, current + 1);
      builder.addTriangle(current + 1, above, above + 1);
    }
  }
  return builder.build();
}

/**
 * Tube swept along a polyline using parallel-transport frames (no twisting at bends).
 * `radii` may be a single radius or one radius per path point (tapering tails, hoses, cables).
 */
export function createTubeMesh(path: readonly Vec3[], radii: number | readonly number[], radialSegments: number = 10): MeshData {
  const builder = new MeshBuilder();
  const radiusAt = (index: number): number => (typeof radii === 'number' ? radii : ((radii as readonly number[])[index] ?? (radii as readonly number[])[radii.length - 1] ?? 0.02));
  const tangents: Vec3[] = path.map((_point: Vec3, index: number) => {
    const previous: Vec3 = path[Math.max(0, index - 1)] as Vec3;
    const next: Vec3 = path[Math.min(path.length - 1, index + 1)] as Vec3;
    return vec3Normalize([next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]]);
  });
  // Initial normal: any vector perpendicular to the first tangent.
  const firstTangent: Vec3 = tangents[0] as Vec3;
  let normal: Vec3 = Math.abs(firstTangent[1]) < 0.9 ? vec3Normalize([firstTangent[2], 0, -firstTangent[0]]) : [1, 0, 0];
  let travelled = 0;
  for (let index = 0; index < path.length; index += 1) {
    const tangent: Vec3 = tangents[index] as Vec3;
    // Parallel transport: remove the tangent component from the previous normal.
    const projection: number = normal[0] * tangent[0] + normal[1] * tangent[1] + normal[2] * tangent[2];
    normal = vec3Normalize([normal[0] - tangent[0] * projection, normal[1] - tangent[1] * projection, normal[2] - tangent[2] * projection]);
    const binormal: Vec3 = [
      tangent[1] * normal[2] - tangent[2] * normal[1],
      tangent[2] * normal[0] - tangent[0] * normal[2],
      tangent[0] * normal[1] - tangent[1] * normal[0],
    ];
    if (index > 0) {
      const previous: Vec3 = path[index - 1] as Vec3;
      const point: Vec3 = path[index] as Vec3;
      travelled += Math.hypot(point[0] - previous[0], point[1] - previous[1], point[2] - previous[2]);
    }
    const center: Vec3 = path[index] as Vec3;
    const radius: number = radiusAt(index);
    for (let segment = 0; segment <= radialSegments; segment += 1) {
      const angle: number = (segment / radialSegments) * Math.PI * 2;
      const ringNormal: Vec3 = [
        normal[0] * Math.cos(angle) + binormal[0] * Math.sin(angle),
        normal[1] * Math.cos(angle) + binormal[1] * Math.sin(angle),
        normal[2] * Math.cos(angle) + binormal[2] * Math.sin(angle),
      ];
      builder.addVertex([center[0] + ringNormal[0] * radius, center[1] + ringNormal[1] * radius, center[2] + ringNormal[2] * radius], ringNormal, segment / radialSegments, travelled * 2);
    }
  }
  const rowLength: number = radialSegments + 1;
  for (let ring = 0; ring < path.length - 1; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const current: number = ring * rowLength + segment;
      const next: number = current + rowLength;
      builder.addTriangle(current, current + 1, next);
      builder.addTriangle(current + 1, next + 1, next);
    }
  }
  return builder.build();
}

/** Samples a quadratic Bézier from a → b with control c into `segments` + 1 points (for tube paths). */
export function sampleQuadraticBezier(a: Readonly<Vec3>, c: Readonly<Vec3>, b: Readonly<Vec3>, segments: number): Vec3[] {
  const points: Vec3[] = [];
  for (let step = 0; step <= segments; step += 1) {
    const t: number = step / segments;
    const u: number = 1 - t;
    points.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]]);
  }
  return points;
}
