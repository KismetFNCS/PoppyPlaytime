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
  | 'shattered_foundation_concrete'
  | 'lamp_housing_toxic'
  | 'tether_claw_teal'
  | 'tether_claw_rose'
  | 'tether_core_teal'
  | 'tether_core_rose'
  | 'tallyman_dial'
  | 'tallyman_lamp'
  | 'brick_facade'
  | 'nursery_wallpaper'
  | 'nursery_wood'
  | 'porcelain_glaze'
  | 'hymn_paper'
  | 'wet_stone'
  | 'murky_water'
  | 'tin_plate'
  | 'conveyor_belt'
  | 'tether_brass'
  | 'lamp_housing_warm'
  | 'pip_lantern'
  | 'choir_glow'
  | 'foreman_core';

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
    proceduralFallback: { kind: 'ceramicTile', seed: 1101, resolution: 512, bumpStrength: 2.5 },
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
    proceduralFallback: { kind: 'stainedConcrete', seed: 2202, resolution: 512, bumpStrength: 1.8 },
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
    proceduralFallback: { kind: 'shatteredFoundation', seed: 7707, resolution: 512, bumpStrength: 3.2 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.1, 0.06],
    emissiveStrength: 3.5,
    uvScale: 0.6,
  },
  lamp_housing_toxic: {
    id: 'lamp_housing_toxic',
    displayName: 'Hazard Lamp (Toxic Green)',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 4406, resolution: 64, bumpStrength: 0 },
    baseTint: [0.3, 1, 0.3],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0.35, 1, 0.12],
    emissiveStrength: 5,
    uvScale: 1,
  },
  tether_claw_teal: {
    id: 'tether_claw_teal',
    displayName: 'Tether Rig · Teal Hand Paint',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'wornPaint', seed: 8801, resolution: 128, bumpStrength: 1.4 },
    baseTint: [0.1, 0.42, 0.4],
    normalStrength: 0.7,
    roughnessScale: 1,
    metallic: 0.05,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 2,
  },
  tether_claw_rose: {
    id: 'tether_claw_rose',
    displayName: 'Tether Rig · Rose Hand Paint',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'wornPaint', seed: 8802, resolution: 128, bumpStrength: 1.4 },
    baseTint: [0.58, 0.16, 0.24],
    normalStrength: 0.7,
    roughnessScale: 1,
    metallic: 0.05,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 2,
  },
  tether_core_teal: {
    id: 'tether_core_teal',
    displayName: 'Tether Rig · Teal Polarity Core',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 8803, resolution: 64, bumpStrength: 0 },
    baseTint: [0.1, 1, 0.85],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0.08, 0.95, 0.82],
    emissiveStrength: 8,
    uvScale: 1,
  },
  tether_core_rose: {
    id: 'tether_core_rose',
    displayName: 'Tether Rig · Rose Polarity Core',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 8804, resolution: 64, bumpStrength: 0 },
    baseTint: [1, 0.3, 0.55],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.22, 0.48],
    emissiveStrength: 8,
    uvScale: 1,
  },
  tallyman_dial: {
    id: 'tallyman_dial',
    displayName: 'Tallyman · Punch-Clock Dial',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'crackedPorcelain', seed: 9901, resolution: 256, bumpStrength: 2.4 },
    baseTint: [0.95, 0.88, 0.7],
    normalStrength: 1,
    roughnessScale: 0.9,
    metallic: 0,
    emissiveColor: [1, 0.55, 0.1],
    emissiveStrength: 1.6,
    uvScale: 1,
  },
  tallyman_lamp: {
    id: 'tallyman_lamp',
    displayName: 'Tallyman · Sight-Slit Lamp',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 9902, resolution: 64, bumpStrength: 0 },
    baseTint: [1, 0.7, 0.3],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.62, 0.15],
    emissiveStrength: 9,
    uvScale: 1,
  },
  brick_facade: {
    id: 'brick_facade',
    displayName: 'Factory Brick Facade',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'brickFacade', seed: 10101, resolution: 512, bumpStrength: 2.6 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 0.35,
  },
  nursery_wallpaper: {
    id: 'nursery_wallpaper',
    displayName: 'Choir Nursery · Damask Wallpaper',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'damaskWallpaper', seed: 10202, resolution: 512, bumpStrength: 1.4 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 0.45,
  },
  nursery_wood: {
    id: 'nursery_wood',
    displayName: 'Painted Nursery Wood',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'weatheredWood', seed: 10303, resolution: 256, bumpStrength: 1.8 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 1,
  },
  porcelain_glaze: {
    id: 'porcelain_glaze',
    displayName: 'Glazed Porcelain',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'glazedPorcelain', seed: 10404, resolution: 256, bumpStrength: 2 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 1.5,
  },
  hymn_paper: {
    id: 'hymn_paper',
    displayName: 'Hymn-Sheet Paper',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'hymnPaper', seed: 10505, resolution: 256, bumpStrength: 1 },
    baseTint: [1, 1, 1],
    normalStrength: 0.6,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 1,
  },
  wet_stone: {
    id: 'wet_stone',
    displayName: 'Drowned Archive · Wet Flagstone',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'wetStone', seed: 10606, resolution: 512, bumpStrength: 2.8 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 0.4,
  },
  murky_water: {
    id: 'murky_water',
    displayName: 'Standing Water',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'murkyWater', seed: 10707, resolution: 256, bumpStrength: 1.2 },
    baseTint: [1, 1, 1],
    normalStrength: 0.7,
    roughnessScale: 1,
    metallic: 0.35,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 0.25,
  },
  tin_plate: {
    id: 'tin_plate',
    displayName: 'Lithographed Tin',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'tinPlate', seed: 10808, resolution: 256, bumpStrength: 1.2 },
    baseTint: [1, 1, 1],
    normalStrength: 0.8,
    roughnessScale: 1,
    metallic: 0.6,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 1,
  },
  conveyor_belt: {
    id: 'conveyor_belt',
    displayName: 'Conveyor Belting',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'conveyorBelt', seed: 10909, resolution: 256, bumpStrength: 2 },
    baseTint: [1, 1, 1],
    normalStrength: 1,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 0.5,
  },
  tether_brass: {
    id: 'tether_brass',
    displayName: 'Tether Rig · Brass Fittings',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'rustedMetal', seed: 11010, resolution: 256, bumpStrength: 1 },
    baseTint: [1.7, 1.25, 0.55],
    normalStrength: 0.7,
    roughnessScale: 0.6,
    metallic: 0.85,
    emissiveColor: [0, 0, 0],
    emissiveStrength: 0,
    uvScale: 2,
  },
  lamp_housing_warm: {
    id: 'lamp_housing_warm',
    displayName: 'Warm Lamp (Tungsten)',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 11111, resolution: 64, bumpStrength: 0 },
    baseTint: [1, 0.8, 0.5],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.62, 0.3],
    emissiveStrength: 5,
    uvScale: 1,
  },
  pip_lantern: {
    id: 'pip_lantern',
    displayName: 'Pip · Lantern Tail',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 11212, resolution: 64, bumpStrength: 0 },
    baseTint: [1, 0.85, 0.55],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.7, 0.35],
    emissiveStrength: 8,
    uvScale: 1,
  },
  choir_glow: {
    id: 'choir_glow',
    displayName: 'Choir · Music-Box Glow',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 11313, resolution: 64, bumpStrength: 0 },
    baseTint: [1, 0.95, 0.8],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.86, 0.55],
    emissiveStrength: 6,
    uvScale: 1,
  },
  foreman_core: {
    id: 'foreman_core',
    displayName: 'The Foreman · Core',
    maps: proceduralMaps(),
    proceduralFallback: { kind: 'emissiveSolid', seed: 11414, resolution: 64, bumpStrength: 0 },
    baseTint: [1, 0.4, 0.3],
    normalStrength: 0,
    roughnessScale: 1,
    metallic: 0,
    emissiveColor: [1, 0.25, 0.12],
    emissiveStrength: 9,
    uvScale: 1,
  },
};

export const MATERIAL_IDS: readonly MaterialId[] = Object.keys(MATERIAL_PROFILES) as MaterialId[];

// ---------------------------------------------------------------------------------------------------------------------
// Custom-imported mesh profiles
// ---------------------------------------------------------------------------------------------------------------------

export type ImportedMeshId =
  | 'jester_entity'
  | 'gas_mask_prop'
  | 'shattered_foundation'
  | 'tether_claw_teal'
  | 'tether_claw_rose'
  | 'tether_launcher'
  | 'relay_plate_teal'
  | 'relay_plate_rose'
  | 'ceiling_anchor'
  | 'blast_gate'
  | 'tallyman_entity'
  | 'breaker_switch'
  | 'pip_companion'
  | 'choir_mother'
  | 'hushling'
  | 'foreman_core'
  | 'music_box'
  | 'nursery_crib'
  | 'archive_shelf'
  | 'lore_tape'
  | 'intercom_speaker'
  | 'conveyor_section'
  | 'factory_hall'
  | 'factory_smokestack';

export type ProceduralMeshBuilderId =
  | 'jester_body'
  | 'jester_head'
  | 'jester_eyes'
  | 'gas_mask_shell'
  | 'gas_mask_lenses'
  | 'gas_mask_filter'
  | 'foundation_slabs'
  | 'foundation_rebar'
  | 'tether_hand_shell_left'
  | 'tether_hand_shell_right'
  | 'tether_hand_cuff'
  | 'tether_launcher_body'
  | 'relay_plate_frame'
  | 'relay_plate_core'
  | 'ceiling_anchor_ring'
  | 'ceiling_anchor_beacon'
  | 'blast_gate_panel'
  | 'tallyman_frame'
  | 'tallyman_dial_face'
  | 'tallyman_sight_lamp'
  | 'breaker_switch_housing'
  | 'breaker_switch_lever'
  | 'breaker_switch_indicator'
  | 'tether_launcher_brass'
  | 'tether_launcher_gauge'
  | 'pip_body'
  | 'pip_fittings'
  | 'pip_lantern'
  | 'choir_scaffold'
  | 'choir_heads'
  | 'choir_wings'
  | 'choir_heart'
  | 'hushling_body'
  | 'hushling_eyes'
  | 'foreman_housing'
  | 'foreman_faces'
  | 'foreman_heart'
  | 'music_box_case'
  | 'music_box_figure'
  | 'music_box_glow'
  | 'crib_frame'
  | 'shelf_frame'
  | 'shelf_papers'
  | 'tape_case'
  | 'tape_label'
  | 'intercom_housing'
  | 'intercom_grille'
  | 'conveyor_belt_surface'
  | 'conveyor_rollers'
  | 'factory_hall_walls'
  | 'factory_hall_roof'
  | 'factory_hall_windows'
  | 'smokestack_column'
  | 'smokestack_beacon';

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
  tether_claw_teal: {
    id: 'tether_claw_teal',
    displayName: 'Tether Rig · Teal Hand (Left)',
    importScale: 1,
    parts: [
      { partId: 'shell', materialId: 'tether_claw_teal', importUri: null, fallbackBuilder: 'tether_hand_shell_left' },
      { partId: 'cuff', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'tether_hand_cuff' },
    ],
  },
  tether_claw_rose: {
    id: 'tether_claw_rose',
    displayName: 'Tether Rig · Rose Hand (Right)',
    importScale: 1,
    parts: [
      { partId: 'shell', materialId: 'tether_claw_rose', importUri: null, fallbackBuilder: 'tether_hand_shell_right' },
      { partId: 'cuff', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'tether_hand_cuff' },
    ],
  },
  tether_launcher: {
    id: 'tether_launcher',
    displayName: 'Tether Rig · Wrist Launcher',
    importScale: 1,
    parts: [
      { partId: 'body', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'tether_launcher_body' },
      { partId: 'brass', materialId: 'tether_brass', importUri: null, fallbackBuilder: 'tether_launcher_brass' },
      { partId: 'gauge', materialId: 'lamp_housing_warm', importUri: null, fallbackBuilder: 'tether_launcher_gauge' },
    ],
  },
  relay_plate_teal: {
    id: 'relay_plate_teal',
    displayName: 'Relay Plate · Teal Polarity',
    importScale: 1,
    parts: [
      { partId: 'frame', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'relay_plate_frame' },
      { partId: 'core', materialId: 'tether_core_teal', importUri: null, fallbackBuilder: 'relay_plate_core' },
    ],
  },
  relay_plate_rose: {
    id: 'relay_plate_rose',
    displayName: 'Relay Plate · Rose Polarity',
    importScale: 1,
    parts: [
      { partId: 'frame', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'relay_plate_frame' },
      { partId: 'core', materialId: 'tether_core_rose', importUri: null, fallbackBuilder: 'relay_plate_core' },
    ],
  },
  ceiling_anchor: {
    id: 'ceiling_anchor',
    displayName: 'Swing Anchor',
    importScale: 1,
    parts: [
      { partId: 'ring', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'ceiling_anchor_ring' },
      { partId: 'beacon', materialId: 'lamp_housing_blue', importUri: null, fallbackBuilder: 'ceiling_anchor_beacon' },
    ],
  },
  blast_gate: {
    id: 'blast_gate',
    displayName: 'Blast Gate',
    importScale: 1,
    parts: [{ partId: 'panel', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'blast_gate_panel' }],
  },
  tallyman_entity: {
    id: 'tallyman_entity',
    displayName: 'The Tallyman',
    importScale: 1,
    parts: [
      { partId: 'frame', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'tallyman_frame' },
      { partId: 'dial', materialId: 'tallyman_dial', importUri: null, fallbackBuilder: 'tallyman_dial_face' },
      { partId: 'lamp', materialId: 'tallyman_lamp', importUri: null, fallbackBuilder: 'tallyman_sight_lamp' },
    ],
  },
  breaker_switch: {
    id: 'breaker_switch',
    displayName: 'Breaker Switch',
    importScale: 1,
    parts: [
      { partId: 'housing', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'breaker_switch_housing' },
      { partId: 'lever', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'breaker_switch_lever' },
      { partId: 'indicator', materialId: 'lamp_housing_toxic', importUri: null, fallbackBuilder: 'breaker_switch_indicator' },
    ],
  },
  pip_companion: {
    id: 'pip_companion',
    displayName: 'Pip (Wind-Up Companion)',
    importScale: 1,
    parts: [
      { partId: 'body', materialId: 'tin_plate', importUri: null, fallbackBuilder: 'pip_body' },
      { partId: 'fittings', materialId: 'tether_brass', importUri: null, fallbackBuilder: 'pip_fittings' },
      { partId: 'lantern', materialId: 'pip_lantern', importUri: null, fallbackBuilder: 'pip_lantern' },
    ],
  },
  choir_mother: {
    id: 'choir_mother',
    displayName: 'The Choir Mother',
    importScale: 1,
    parts: [
      { partId: 'scaffold', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'choir_scaffold' },
      { partId: 'heads', materialId: 'porcelain_glaze', importUri: null, fallbackBuilder: 'choir_heads' },
      { partId: 'wings', materialId: 'hymn_paper', importUri: null, fallbackBuilder: 'choir_wings' },
      { partId: 'heart', materialId: 'choir_glow', importUri: null, fallbackBuilder: 'choir_heart' },
    ],
  },
  hushling: {
    id: 'hushling',
    displayName: 'Hushling',
    importScale: 1,
    parts: [
      { partId: 'body', materialId: 'porcelain_glaze', importUri: null, fallbackBuilder: 'hushling_body' },
      { partId: 'eyes', materialId: 'choir_glow', importUri: null, fallbackBuilder: 'hushling_eyes' },
    ],
  },
  foreman_core: {
    id: 'foreman_core',
    displayName: 'The Foreman',
    importScale: 1,
    parts: [
      { partId: 'housing', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'foreman_housing' },
      { partId: 'faces', materialId: 'tallyman_dial', importUri: null, fallbackBuilder: 'foreman_faces' },
      { partId: 'heart', materialId: 'foreman_core', importUri: null, fallbackBuilder: 'foreman_heart' },
    ],
  },
  music_box: {
    id: 'music_box',
    displayName: 'Chapel Music Box',
    importScale: 1,
    parts: [
      { partId: 'case', materialId: 'nursery_wood', importUri: null, fallbackBuilder: 'music_box_case' },
      { partId: 'figure', materialId: 'porcelain_glaze', importUri: null, fallbackBuilder: 'music_box_figure' },
      { partId: 'glow', materialId: 'choir_glow', importUri: null, fallbackBuilder: 'music_box_glow' },
    ],
  },
  nursery_crib: {
    id: 'nursery_crib',
    displayName: 'Nursery Crib',
    importScale: 1,
    parts: [
      { partId: 'frame', materialId: 'nursery_wood', importUri: null, fallbackBuilder: 'crib_frame' },
    ],
  },
  archive_shelf: {
    id: 'archive_shelf',
    displayName: 'Archive Shelving',
    importScale: 1,
    parts: [
      { partId: 'frame', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'shelf_frame' },
      { partId: 'papers', materialId: 'hymn_paper', importUri: null, fallbackBuilder: 'shelf_papers' },
    ],
  },
  lore_tape: {
    id: 'lore_tape',
    displayName: 'Shift Tape',
    importScale: 1,
    parts: [
      { partId: 'case', materialId: 'conveyor_belt', importUri: null, fallbackBuilder: 'tape_case' },
      { partId: 'label', materialId: 'hymn_paper', importUri: null, fallbackBuilder: 'tape_label' },
    ],
  },
  intercom_speaker: {
    id: 'intercom_speaker',
    displayName: 'Intercom Speaker',
    importScale: 1,
    parts: [
      { partId: 'housing', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'intercom_housing' },
      { partId: 'grille', materialId: 'lamp_housing_warm', importUri: null, fallbackBuilder: 'intercom_grille' },
    ],
  },
  conveyor_section: {
    id: 'conveyor_section',
    displayName: 'Conveyor Section',
    importScale: 1,
    parts: [
      { partId: 'belt', materialId: 'conveyor_belt', importUri: null, fallbackBuilder: 'conveyor_belt_surface' },
      { partId: 'rollers', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'conveyor_rollers' },
    ],
  },
  factory_hall: {
    id: 'factory_hall',
    displayName: 'Marrow & Finch Production Hall',
    importScale: 1,
    parts: [
      { partId: 'walls', materialId: 'brick_facade', importUri: null, fallbackBuilder: 'factory_hall_walls' },
      { partId: 'roof', materialId: 'rusted_steel', importUri: null, fallbackBuilder: 'factory_hall_roof' },
      { partId: 'windows', materialId: 'lamp_housing_warm', importUri: null, fallbackBuilder: 'factory_hall_windows' },
    ],
  },
  factory_smokestack: {
    id: 'factory_smokestack',
    displayName: 'Marrow & Finch Smokestack',
    importScale: 1,
    parts: [
      { partId: 'column', materialId: 'brick_facade', importUri: null, fallbackBuilder: 'smokestack_column' },
      { partId: 'beacon', materialId: 'lamp_housing_red', importUri: null, fallbackBuilder: 'smokestack_beacon' },
    ],
  },
};

export const IMPORTED_MESH_IDS: readonly ImportedMeshId[] = Object.keys(IMPORTED_MESH_PROFILES) as ImportedMeshId[];
