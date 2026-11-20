import { STORAGE_KEYS } from '../config/GameConstants';
import { clamp } from '../math/Vec3';

// ---------------------------------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------------------------------

export interface GameSettings {
  masterVolume: number;
  brightness: number;
  fogDensityScale: number;
  crtEffectIntensity: number;
  mouseSensitivity: number;
  invertLookY: boolean;
  renderScale: number;
  fieldOfViewDegrees: number;
}

export type NumericSettingKey = { [Key in keyof GameSettings]: GameSettings[Key] extends number ? Key : never }[keyof GameSettings];
export type BooleanSettingKey = { [Key in keyof GameSettings]: GameSettings[Key] extends boolean ? Key : never }[keyof GameSettings];

export interface NumericSettingRange {
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
}

export const NUMERIC_SETTING_RANGES: Readonly<Record<NumericSettingKey, NumericSettingRange>> = {
  masterVolume: { minimum: 0, maximum: 1, step: 0.05 },
  brightness: { minimum: 0.6, maximum: 1.6, step: 0.05 },
  fogDensityScale: { minimum: 0, maximum: 2, step: 0.1 },
  crtEffectIntensity: { minimum: 0, maximum: 1, step: 0.05 },
  mouseSensitivity: { minimum: 0.2, maximum: 3, step: 0.1 },
  renderScale: { minimum: 0.5, maximum: 1, step: 0.05 },
  fieldOfViewDegrees: { minimum: 55, maximum: 100, step: 1 },
};

export const DEFAULT_SETTINGS: Readonly<GameSettings> = {
  masterVolume: 0.7,
  brightness: 1,
  fogDensityScale: 1,
  crtEffectIntensity: 1,
  mouseSensitivity: 1,
  invertLookY: false,
  renderScale: 1,
  fieldOfViewDegrees: 72,
};

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Storage may be unavailable (private mode / sandboxed iframe); the session continues in-memory.
  }
}

export class SettingsStore {
  private current: GameSettings;
  private readonly listeners: Set<(settings: Readonly<GameSettings>) => void> = new Set();

  public constructor() {
    this.current = { ...DEFAULT_SETTINGS };
    const raw: string | null = readStorage(STORAGE_KEYS.settings);
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          const record = parsed as Record<string, unknown>;
          for (const key of Object.keys(NUMERIC_SETTING_RANGES) as NumericSettingKey[]) {
            const value: unknown = record[key];
            if (typeof value === 'number' && Number.isFinite(value)) {
              const range: NumericSettingRange = NUMERIC_SETTING_RANGES[key];
              this.current[key] = clamp(value, range.minimum, range.maximum);
            }
          }
          if (typeof record['invertLookY'] === 'boolean') {
            this.current.invertLookY = record['invertLookY'];
          }
        }
      } catch {
        this.current = { ...DEFAULT_SETTINGS };
      }
    }
  }

  public get values(): Readonly<GameSettings> {
    return this.current;
  }

  public setNumeric(key: NumericSettingKey, value: number): void {
    const range: NumericSettingRange = NUMERIC_SETTING_RANGES[key];
    const stepped: number = Math.round((clamp(value, range.minimum, range.maximum) - range.minimum) / range.step) * range.step + range.minimum;
    this.current[key] = Number(clamp(stepped, range.minimum, range.maximum).toFixed(4));
    this.persistAndNotify();
  }

  public setBoolean(key: BooleanSettingKey, value: boolean): void {
    this.current[key] = value;
    this.persistAndNotify();
  }

  public resetToDefaults(): void {
    this.current = { ...DEFAULT_SETTINGS };
    this.persistAndNotify();
  }

  public subscribe(listener: (settings: Readonly<GameSettings>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persistAndNotify(): void {
    writeStorage(STORAGE_KEYS.settings, JSON.stringify(this.current));
    for (const listener of this.listeners) {
      listener(this.current);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Save data
// ---------------------------------------------------------------------------------------------------------------------

export interface SaveInventory {
  readonly hasGasMask: boolean;
}

export interface SaveCheckpoint {
  readonly version: 2;
  /** Index of the corridor chunk the player respawns at. */
  readonly checkpointChunkIndex: number;
  /** Deepest chunk index ever reached on this save. */
  readonly deepestChunkIndex: number;
  readonly playTimeSeconds: number;
  readonly deathCount: number;
  readonly inventory: SaveInventory;
  readonly savedAtIso: string;
}

export function createFreshCheckpoint(): SaveCheckpoint {
  return {
    version: 2,
    checkpointChunkIndex: 0,
    deepestChunkIndex: 0,
    playTimeSeconds: 0,
    deathCount: 0,
    inventory: { hasGasMask: false },
    savedAtIso: new Date().toISOString(),
  };
}

export class SaveSystem {
  public load(): SaveCheckpoint | null {
    const raw: string | null = readStorage(STORAGE_KEYS.save);
    if (raw === null) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        return null;
      }
      const record = parsed as Record<string, unknown>;
      // Version 1 saves predate the inventory block; they migrate with an empty inventory.
      if (
        (record['version'] !== 1 && record['version'] !== 2) ||
        typeof record['checkpointChunkIndex'] !== 'number' ||
        typeof record['deepestChunkIndex'] !== 'number' ||
        typeof record['playTimeSeconds'] !== 'number' ||
        typeof record['deathCount'] !== 'number' ||
        typeof record['savedAtIso'] !== 'string'
      ) {
        return null;
      }
      const rawInventory: unknown = record['inventory'];
      const hasGasMask: boolean =
        typeof rawInventory === 'object' && rawInventory !== null && (rawInventory as Record<string, unknown>)['hasGasMask'] === true;
      return {
        version: 2,
        checkpointChunkIndex: Math.max(0, Math.floor(record['checkpointChunkIndex'])),
        deepestChunkIndex: Math.max(0, Math.floor(record['deepestChunkIndex'])),
        playTimeSeconds: Math.max(0, record['playTimeSeconds']),
        deathCount: Math.max(0, Math.floor(record['deathCount'])),
        inventory: { hasGasMask },
        savedAtIso: record['savedAtIso'],
      };
    } catch {
      return null;
    }
  }

  public get hasSave(): boolean {
    return this.load() !== null;
  }

  public write(checkpoint: SaveCheckpoint): void {
    writeStorage(STORAGE_KEYS.save, JSON.stringify({ ...checkpoint, savedAtIso: new Date().toISOString() }));
  }

  public erase(): void {
    writeStorage(STORAGE_KEYS.save, null);
  }
}
