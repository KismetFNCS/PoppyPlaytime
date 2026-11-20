import type { ImportedMeshId, ImportedMeshPart, ImportedMeshProfile, MaterialId } from './AssetManifest';
import { IMPORTED_MESH_IDS, IMPORTED_MESH_PROFILES } from './AssetManifest';
import { PROCEDURAL_MESH_BUILDERS } from './ProceduralModels';
import type { MeshData } from '../graphics/Geometry';
import { MeshBuilder } from '../graphics/Geometry';
import { GpuMesh } from '../graphics/GpuMesh';
import { fetchWavefrontObj } from '../graphics/ObjMeshLoader';
import { mat4Scaling } from '../math/Mat4';

export interface ModelPart {
  readonly partId: string;
  readonly materialId: MaterialId;
  readonly meshData: MeshData;
  readonly gpuMesh: GpuMesh;
  readonly origin: 'authored' | 'procedural';
}

export interface ModelAsset {
  readonly id: ImportedMeshId;
  readonly displayName: string;
  readonly parts: readonly ModelPart[];
}

/** Resolves every imported-mesh profile into GPU meshes, preferring authored OBJ files over procedural stand-ins. */
export class MeshLibrary {
  private readonly models: Map<ImportedMeshId, ModelAsset> = new Map();

  public constructor(private readonly gl: WebGL2RenderingContext) {}

  public static get totalCount(): number {
    return IMPORTED_MESH_IDS.length;
  }

  public async loadAll(onProgress: (loadedCount: number, totalCount: number, currentName: string) => void): Promise<void> {
    for (const meshId of IMPORTED_MESH_IDS) {
      const profile: ImportedMeshProfile = IMPORTED_MESH_PROFILES[meshId];
      onProgress(this.models.size, IMPORTED_MESH_IDS.length, profile.displayName);
      await new Promise<void>((resolve: () => void) => {
        requestAnimationFrame(() => resolve());
      });
      const parts: ModelPart[] = [];
      for (const part of profile.parts) {
        parts.push(await this.loadPart(profile, part));
      }
      this.models.set(meshId, { id: meshId, displayName: profile.displayName, parts });
    }
    onProgress(this.models.size, IMPORTED_MESH_IDS.length, 'complete');
  }

  private async loadPart(profile: ImportedMeshProfile, part: ImportedMeshPart): Promise<ModelPart> {
    let meshData: MeshData | null = null;
    let origin: 'authored' | 'procedural' = 'procedural';
    if (part.importUri !== null) {
      try {
        const imported: MeshData = await fetchWavefrontObj(part.importUri);
        const builder = new MeshBuilder();
        builder.appendMesh(imported, mat4Scaling(profile.importScale, profile.importScale, profile.importScale));
        meshData = builder.build();
        origin = 'authored';
      } catch (error: unknown) {
        console.warn(`[MeshLibrary] ${profile.id}.${part.partId}: failed to import "${part.importUri}", using procedural stand-in.`, error);
      }
    }
    if (meshData === null) {
      meshData = PROCEDURAL_MESH_BUILDERS[part.fallbackBuilder]();
    }
    return {
      partId: part.partId,
      materialId: part.materialId,
      meshData,
      gpuMesh: new GpuMesh(this.gl, `${profile.id}.${part.partId}`, meshData),
      origin,
    };
  }

  public get(meshId: ImportedMeshId): ModelAsset {
    const model: ModelAsset | undefined = this.models.get(meshId);
    if (model === undefined) {
      throw new Error(`[MeshLibrary] model "${meshId}" requested before it was loaded.`);
    }
    return model;
  }

  public dispose(): void {
    for (const model of this.models.values()) {
      for (const part of model.parts) {
        part.gpuMesh.dispose();
      }
    }
    this.models.clear();
  }
}
