import type { Vec3 } from '../math/Vec3';

/**
 * Central, data-only definition of identity, copy text and layout tuning.
 * All branding is original to this project.
 */
export const GAME_IDENTITY = {
  title: 'THE UNDERWORKS',
  chapterLabel: 'CHAPTER VI',
  subtitle: 'THE LAST SHIFT',
  companyName: 'Marrow & Finch Novelty Co.',
  companyMotto: 'Built to Delight. Built to Last.',
  buildVersion: 'v0.1.0 · Phase 1 Engine Build',
} as const;

export const STORY_OVERLAY_TEXT: string =
  'Far below the condemned assembly floors of Marrow & Finch, the night shift never clocked out. ' +
  'Follow the hum through the drowned foundations, learn what the workshop was really building, ' +
  'and outlast the thing that learned to build itself.';

/** UI is authored against this virtual canvas and uniformly scaled to fit the viewport. */
export const VIRTUAL_RESOLUTION = {
  width: 1920,
  height: 1080,
} as const;

export const UI_FONTS = {
  title: '700 128px "Georgia", "Times New Roman", serif',
  chapter: '700 34px "Courier New", "Courier", monospace',
  subtitle: '700 38px "Georgia", "Times New Roman", serif',
  menuButton: '700 54px "Courier New", "Courier", monospace',
  settingsRow: '700 40px "Courier New", "Courier", monospace',
  body: '400 30px "Georgia", "Times New Roman", serif',
  small: '400 22px "Courier New", "Courier", monospace',
  bootloader: '700 30px "Courier New", "Courier", monospace',
  deathHeadline: '700 112px "Georgia", "Times New Roman", serif',
} as const;

export const UI_COLORS = {
  textPrimary: '#e9e1cf',
  textDim: 'rgba(233, 225, 207, 0.35)',
  textDisabled: 'rgba(233, 225, 207, 0.18)',
  accentRed: '#d2262f',
  accentRedGlow: 'rgba(210, 38, 47, 0.85)',
  accentBlue: '#2f6bff',
  accentBlueGlow: 'rgba(47, 107, 255, 0.8)',
  panelFill: 'rgba(6, 6, 10, 0.62)',
  panelStroke: 'rgba(210, 38, 47, 0.55)',
  collisionDebug: 'rgba(0, 255, 140, 0.9)',
} as const;

/** Main menu placement, in virtual pixels. Tune these numbers to match the concept art 1:1. */
export const MAIN_MENU_LAYOUT = {
  titleOrigin: { x: 132, y: 236 },
  chapterOrigin: { x: 140, y: 108 },
  subtitleOrigin: { x: 140, y: 300 },
  titleUnderline: { x: 136, y: 330, width: 760, thickness: 4 },
  buttonColumn: { x: 140, firstBaselineY: 486, spacing: 82, paddingX: 22, paddingY: 14 },
  hoverIndent: 28,
  storyPanel: { x: 1100, y: 720, width: 700, height: 250, padding: 34, lineHeight: 42 },
  versionOrigin: { x: 140, y: 1030 },
  companyOrigin: { x: 1780, y: 1030 },
} as const;

export const MAIN_MENU_BUTTON_LABELS = ['CONTINUE', 'NEW GAME', 'SETTINGS', 'CREDITS', 'QUIT'] as const;
export type MainMenuButtonLabel = (typeof MAIN_MENU_BUTTON_LABELS)[number];

export const CREDITS_LINES: readonly string[] = [
  'THE UNDERWORKS',
  '',
  'ENGINE ARCHITECTURE',
  'Lifecycle Manager · Level Streamer · Material Registry',
  '',
  'GRAPHICS',
  'Volumetric Fog · Dynamic Point Lighting · CRT/VHS Composite',
  '',
  'AUDIO',
  'Procedural Web Audio Synthesis',
  '',
  'SPECIAL THANKS',
  'Everyone still on the night shift',
  '',
  'Marrow & Finch Novelty Co. is a fictional company.',
];

/** Red/blue industrial light palette in linear HDR units. */
export const LIGHT_PALETTE: Readonly<Record<'emergencyRed' | 'serviceBlue' | 'sodiumAmber' | 'deathFlash', Vec3>> = {
  emergencyRed: [1.0, 0.07, 0.05],
  serviceBlue: [0.12, 0.3, 1.0],
  sodiumAmber: [1.0, 0.55, 0.18],
  deathFlash: [1.0, 0.0, 0.02],
};

export const STORAGE_KEYS = {
  settings: 'underworks.settings.v1',
  save: 'underworks.save.v1',
} as const;

export const STATE_TRANSITION_FADE_SECONDS: number = 0.45;
export const MAX_FORWARD_LIGHTS: number = 8;
