import type { MeshData } from './Geometry';
import { MeshBuilder } from './Geometry';
import type { Vec3 } from '../math/Vec3';
import { vec3Cross, vec3Normalize, vec3Subtract } from '../math/Vec3';

/**
 * Wavefront OBJ parser for custom-imported meshes (Jester Entity, Gas Mask Prop, Shattered Foundations).
 * Supports v / vt / vn, polygon fans, negative indices and missing normals (flat normals generated).
 */
export function parseWavefrontObj(source: string, debugName: string): MeshData {
  const positions: Vec3[] = [];
  const textureCoordinates: Array<[number, number]> = [];
  const normals: Vec3[] = [];
  const builder = new MeshBuilder();
  const vertexCache: Map<string, number> = new Map();
  const lines: string[] = source.split(/\r?\n/);

  const resolveIndex = (rawIndex: string, collectionLength: number): number => {
    const parsed: number = Number.parseInt(rawIndex, 10);
    if (Number.isNaN(parsed)) {
      return -1;
    }
    return parsed < 0 ? collectionLength + parsed : parsed - 1;
  };

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line: string = (lines[lineNumber] as string).trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const tokens: string[] = line.split(/\s+/);
    const keyword: string = tokens[0] as string;
    if (keyword === 'v') {
      positions.push([Number(tokens[1]), Number(tokens[2]), Number(tokens[3])]);
    } else if (keyword === 'vt') {
      textureCoordinates.push([Number(tokens[1]), Number(tokens[2] ?? 0)]);
    } else if (keyword === 'vn') {
      normals.push(vec3Normalize([Number(tokens[1]), Number(tokens[2]), Number(tokens[3])]));
    } else if (keyword === 'f') {
      const cornerTokens: string[] = tokens.slice(1);
      if (cornerTokens.length < 3) {
        throw new Error(`[ObjMeshLoader:${debugName}] face with fewer than 3 vertices at line ${lineNumber + 1}.`);
      }
      const cornerPositionIndices: number[] = cornerTokens.map((corner: string) => resolveIndex(corner.split('/')[0] ?? '', positions.length));
      const facePositions: Vec3[] = cornerPositionIndices.map((index: number) => {
        const position: Vec3 | undefined = positions[index];
        if (position === undefined) {
          throw new Error(`[ObjMeshLoader:${debugName}] invalid position index at line ${lineNumber + 1}.`);
        }
        return position;
      });
      const flatNormal: Vec3 = vec3Normalize(
        vec3Cross(vec3Subtract(facePositions[1] as Vec3, facePositions[0] as Vec3), vec3Subtract(facePositions[2] as Vec3, facePositions[0] as Vec3)),
      );
      const vertexIndices: number[] = cornerTokens.map((corner: string, cornerIndex: number) => {
        const cacheKey: string = normals.length > 0 ? corner : `${corner}|${flatNormal.join(',')}`;
        const cached: number | undefined = vertexCache.get(cacheKey);
        if (cached !== undefined) {
          return cached;
        }
        const parts: string[] = corner.split('/');
        const uvIndex: number = parts[1] !== undefined && parts[1] !== '' ? resolveIndex(parts[1], textureCoordinates.length) : -1;
        const normalIndex: number = parts[2] !== undefined && parts[2] !== '' ? resolveIndex(parts[2], normals.length) : -1;
        const uv: [number, number] = textureCoordinates[uvIndex] ?? [0, 0];
        const normal: Vec3 = normals[normalIndex] ?? flatNormal;
        const created: number = builder.addVertex(facePositions[cornerIndex] as Vec3, normal, uv[0], uv[1]);
        vertexCache.set(cacheKey, created);
        return created;
      });
      for (let fan = 1; fan < vertexIndices.length - 1; fan += 1) {
        builder.addTriangle(vertexIndices[0] as number, vertexIndices[fan] as number, vertexIndices[fan + 1] as number);
      }
    }
  }
  if (builder.isEmpty) {
    throw new Error(`[ObjMeshLoader:${debugName}] OBJ contained no faces.`);
  }
  return builder.build();
}

export async function fetchWavefrontObj(uri: string): Promise<MeshData> {
  const response: Response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`[ObjMeshLoader] HTTP ${response.status} fetching ${uri}`);
  }
  return parseWavefrontObj(await response.text(), uri);
}
