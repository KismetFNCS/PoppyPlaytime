import type { MaterialId } from '../assets/AssetManifest';
import { LIGHT_PALETTE } from '../config/GameConstants';
import type { Vec3 } from '../math/Vec3';
import type { ActId } from './CampaignScript';

export type LampStyle = 'red' | 'blue' | 'warm' | 'toxic';

export const LAMP_STYLES: Readonly<Record<LampStyle, { readonly material: MaterialId; readonly color: Vec3; readonly intensity: number }>> = {
  red: { material: 'lamp_housing_red', color: LIGHT_PALETTE.emergencyRed, intensity: 7.5 },
  blue: { material: 'lamp_housing_blue', color: LIGHT_PALETTE.serviceBlue, intensity: 8.5 },
  warm: { material: 'lamp_housing_warm', color: LIGHT_PALETTE.sodiumAmber, intensity: 5.5 },
  toxic: { material: 'lamp_housing_toxic', color: LIGHT_PALETTE.toxicGreen, intensity: 5.5 },
};

export interface ActTheme {
  readonly wallMaterial: MaterialId;
  readonly floorMaterial: MaterialId;
  readonly ceilingMaterial: MaterialId;
  readonly trimMaterial: MaterialId;
  /** Main ceiling lamps alternate primary / secondary chunk by chunk. */
  readonly lampPrimary: LampStyle;
  readonly lampSecondary: LampStyle;
  readonly fogDensityScale: number;
  readonly fogAlbedo: Vec3;
  readonly fogAmbient: Vec3;
  readonly sceneAmbient: Vec3;
}

/** Visual identity of each act: materials, light palette and atmosphere. */
export const ACT_THEMES: Readonly<Record<ActId, ActTheme>> = {
  theShaft: {
    wallMaterial: 'factory_wall_tile',
    floorMaterial: 'factory_floor_concrete',
    ceilingMaterial: 'factory_floor_concrete',
    trimMaterial: 'rusted_steel',
    lampPrimary: 'red',
    lampSecondary: 'blue',
    fogDensityScale: 1,
    fogAlbedo: [0.9, 0.9, 0.95],
    fogAmbient: [0.012, 0.012, 0.02],
    sceneAmbient: [0.012, 0.011, 0.016],
  },
  sortingHalls: {
    wallMaterial: 'brick_facade',
    floorMaterial: 'factory_floor_concrete',
    ceilingMaterial: 'rusted_steel',
    trimMaterial: 'rusted_steel',
    lampPrimary: 'warm',
    lampSecondary: 'red',
    fogDensityScale: 0.9,
    fogAlbedo: [0.95, 0.88, 0.8],
    fogAmbient: [0.016, 0.012, 0.01],
    sceneAmbient: [0.016, 0.012, 0.01],
  },
  choirNursery: {
    wallMaterial: 'nursery_wallpaper',
    floorMaterial: 'nursery_wood',
    ceilingMaterial: 'nursery_wood',
    trimMaterial: 'nursery_wood',
    lampPrimary: 'warm',
    lampSecondary: 'warm',
    fogDensityScale: 0.75,
    fogAlbedo: [1, 0.92, 0.82],
    fogAmbient: [0.008, 0.006, 0.006],
    sceneAmbient: [0.008, 0.006, 0.007],
  },
  drownedArchive: {
    wallMaterial: 'wet_stone',
    floorMaterial: 'wet_stone',
    ceilingMaterial: 'wet_stone',
    trimMaterial: 'rusted_steel',
    lampPrimary: 'blue',
    lampSecondary: 'toxic',
    fogDensityScale: 1.35,
    fogAlbedo: [0.78, 0.9, 0.95],
    fogAmbient: [0.008, 0.014, 0.018],
    sceneAmbient: [0.008, 0.012, 0.016],
  },
  assemblyHeart: {
    wallMaterial: 'rusted_steel',
    floorMaterial: 'factory_floor_concrete',
    ceilingMaterial: 'rusted_steel',
    trimMaterial: 'tether_brass',
    lampPrimary: 'red',
    lampSecondary: 'red',
    fogDensityScale: 1.15,
    fogAlbedo: [1, 0.8, 0.75],
    fogAmbient: [0.02, 0.006, 0.006],
    sceneAmbient: [0.018, 0.006, 0.006],
  },
};
