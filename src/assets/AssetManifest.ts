import type { ProceduralSurfaceParameters } from '../graphics/ProceduralTextures';
import type { Vec3 } from '../math/Vec3';

/**
 * Data-only asset manifest. Every material declares its four texture slots; a slot with a non-null `uri`
 * is streamed from disk (PNG/JPG/WebP), and falls back to the procedural bake if the file is missing.
 * Drop authored textures into /assets/textures and meshes into /assets/meshes and set the URIs below.
 */

export type MaterialId =
  | 'factory_wall_tile'
  | 'factory_floor_concrete'
  | 'rusted_steel'
  | 'lamp_housing_red'
  | 'lamp_housing_blue'
  | 'jester_entity_fabric'
  | 'jester_entity_porcelain'
  | 'jester_entity_eyes'
  | 'gas_mask_rubber'
  | 'gas_mask_lens'
  | 'shattered_foundation_concrete';

export type TextureSlot = 'diffuse' | 'normal' | 'roughness' | 'emissive';
export const TEXTURE_SLOTS: readonly TextureSlot[] = ['diffuse', 'normal', 'roughness', 'emissive'];

/** Diffuse + emissive are colour data (sRGB); normal + roughness are linear data. */
export const TEXTURE_SLOT_COLOR_SPACE: Readonly<Record<TextureSlot, 'srgb' | 'linear'>> = {
  diffuse: 'srgb',
  normal: 'linear',
  roughness: 'linear',
  emissive: 'srgb',
};

export interface TextureSlotDescriptor {
  readonly uri: string | null;
}

export interface MaterialProfile {
  readonly id: MaterialId;
  readonly displayName: string;
  readonly maps: Readonly<Record<TextureSlot, TextureSlotDescriptor>>;
  readonly proceduralFallback: ProceduralSurfaceParameters;
  readonly baseTint: Vec3;
  readonly normalStrength: number;
  readonly roughnessScale: number;
  readonly metallic: number;
  readonly emissiveColor: Vec3;
  readonly emissiveStrength: number;
  /** Texture repeats per UV unit. Geometry UVs are authored at 0.5 per metre. */
  readonly uvScale: number;
}

function proceduralMaps(): Readonly<Record<TextureSlot, TextureSlotDescriptor>> {
  return { diffuse: { uri: null }, normal: { uri: null }, roughness: { uri: null }, emissive: { uri: null } };
}

export const MATERIAL_PROFILES: Readonly<Record<MaterialId, MaterialProfile>> = {
  factory_wall_tile: {
    id: 'factory_wall_tile',
    displayName: 'Factory Wall Tile',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'ceramicTile', seed: 1101, resolution: 256, bumpStrength: 2.5 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 0.5,
  },
  factory_floor_concrete: {
    id: 'factory_floor_concrete',
    displayName: 'Stained Floor Concrete',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'stainedConcrete', seed: 2202, resolution: 256, bumpStrength: 1.8 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 0.35,
  },
  rusted_steel: {
    id: 'rusted_steel',
    displayName: 'Rusted Structural Steel',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'rustedMetal', seed: 3303, resolution: 256, bumpStrength: 1.5 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0.65,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 1,
  },
  lamp_housing_red: {
    id: 'lamp_housing_red',
    displayName: 'Emergency Lamp (Red)',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 4404, resolution: 64, bumpStrength: 0 },
    baseTint: [1, 0.2, 0.2],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.08, 0.05],
    emissiveStrength: 6,
    uvScale: 1,
  },
  lamp_housing_blue: {
    id: 'lamp_housing_blue',
    displayName: 'Service Lamp (Blue)',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 4405, resolution: 64, bumpStrength: 0 },
    baseTint: [0.2, 0.3, 1],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0.15, 0.32, 1],
    emissiveStrength: 6,
    uvScale: 1,
  },
  jester_entity_fabric: {
    id: 'jester_entity_fabric',
    displayName: 'Jester Entity · Harlequin Fabric',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'harlequinFabric', seed: 5505, resolution: 256, bumpStrength: 2.2 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 2,
  },
  jester_entity_porcelain: {
    id: 'jester_entity_porcelain',
    displayName: 'Jester Entity · Cracked Porcelain',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'crackedPorcelain', seed: 5506, resolution: 256, bumpStrength: 3 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.12, 0.1],
    emissiveStrength: 2.2,
    uvScale: 1,
  },
  jester_entity_eyes: {
    id: 'jester_entity_eyes',
    displayName: 'Jester Entity · Eye Glow',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 5507, resolution: 64, bumpStrength: 0 },
    baseTint: [1, 1, 1],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.85, 0.7],
    emissiveStrength: 14,
    uvScale: 1,
  },
  gas_mask_rubber: {
    id: 'gas_mask_rubber',
    displayName: 'Gas Mask Prop · Vulcanised Rubber',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'gasMaskRubber', seed: 6606, resolution: 256, bumpStrength: 1.6 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 1,
  },
  gas_mask_lens: {
    id: 'gas_mask_lens',
    displayName: 'Gas Mask Prop · Fractured Lens',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'gasMaskLens', seed: 6607, resolution: 128, bumpStrength: 1 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0.2,
    emissiveColor: [0.6, 1, 0.8],
    emissiveStrength: 0.9,
    uvScale: 1,
  },
  shattered_foundation_concrete: {
    id: 'shattered_foundation_concrete',
    displayName: 'Shattered Factory Foundation · Fissured Concrete',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'shatteredFoundation', seed: 7707, resolution: 256, bumpStrength: 3.2 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.1, 0.06],
    emissiveStrength: 3.5,
    uvScale: 0.6,
  },
};

export const MATERIAL_IDS: readonly MaterialId[] = Object.keys(MATERIAL_PROFILES) as MaterialId[];

// ---------------------------------------------------------------------------------------------------------------------
// Custom-imported mesh profiles
// ---------------------------------------------------------------------------------------------------------------------

export type ImportedMeshId = 'jester_entity' | 'gas_mask_prop' | 'shattered_foundation';

export type ProceduralMeshBuilderId =
  | 'jester_body'
  | 'jester_head'
  | 'jester_eyes'
  | 'gas_mask_shell'
  | 'gas_mask_lenses'
  | 'gas_mask_filter'
  | 'foundation_slabs'
  | 'foundation_rebar';

export interface ImportedMeshPart {
  readonly partId: string;
  readonly materialId: MaterialId;
  /** Wavefront OBJ path for the authored part, or null to use the procedural stand-in. */
  readonly importUri: string | null;
  readonly fallbackBuilder: ProceduralMeshBuilderId;
}

export interface ImportedMeshProfile {
  readonly id: ImportedMeshId;
  readonly displayName: string;
  readonly parts: readonly ImportedMeshPart[];
  /** Uniform import scale applied to OBJ data (authoring tools often export centimetres). */
  readonly importScale: number;
}

export const IMPORTED_MESH_PROFILES: Readonly<Record<ImportedMeshId, ImportedMeshProfile>> = {
  jester_entity: {
    id: 'jester_entity',
    displayName: 'Jester Entity',
    importScale: 1,
    parts: [
      { partId: 'body', materialId: 'jester_entity_fabric', importUri: null, fallbackBuilder: 'jester_body' },
      { partId: 'head', materialId: 'jester_entity_porcelain', importUri: null, fallbackBuilder: 'jester_head' },
      { partId: 'eyes', materialId: 'jester_entity_eyes', importUri: null, fallbackBuilder: 'jester_eyes' },
    ],
  },
  gas_mask_prop: {
    id: 'gas_mask_prop',
    displayName: 'Gas Mask Prop',
    importScale: 1,
    parts: [
      { partId: 'shell', materialId: 'gas_mask_rubber', importUri: null, fallbackBuilder: 'gas_mask_shell' },
      { partId: 'lenses', materialId: 'gas_mask_lens', importUri: null, fallbackBuilder: 'gas_mask_lenses' },
      { partId: 'filter', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'gas_mask_filter' },
    ],
  },
  shattered_foundation: {
    id: 'shattered_foundation',
    displayName: 'Shattered Factory Foundations',
    importScale: 1,
    parts: [
      { partId: 'slabs', materialId: 'shattered_foundation_concrete', importUri: null, fallbackBuilder: 'foundation_slabs' },
      { partId: 'rebar', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'foundation_rebar' },
    ],
  },
};

export const IMPORTED_MESH_IDS: readonly ImportedMeshId[] = Object.keys(IMPORTED_MESH_PROFILES) as ImportedMeshId[];
