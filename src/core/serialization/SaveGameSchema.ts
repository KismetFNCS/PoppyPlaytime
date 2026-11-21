import type { ItemId } from '../../gameplay/Inventory';
import type { Vec3 } from '../../math/Vec3';

export const SAVE_SCHEMA_VERSION = 4 as const;

export type SaveSlotId = 'autosave' | 'quicksave';
export const SAVE_SLOT_IDS: readonly SaveSlotId[] = ['autosave', 'quicksave'];

/**
 * `checkpoint`: respawn record (player state ignored; spawn at the checkpoint chunk).
 * `session`:    exact resume record (player transform, mask and threat state restored verbatim).
 */
export type SaveKind = 'checkpoint' | 'session';

export interface PlayerTransformSnapshot {
  /** Feet position in world space. */
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly yawRadians: number;
  readonly pitchRadians: number;
  readonly crouching: boolean;
}

export type SavedMaskPhase = 'unavailable' | 'stowed' | 'worn';

export interface PlayerStateSnapshot {
  readonly transform: PlayerTransformSnapshot;
  readonly stamina: number;
  readonly mask: {
    readonly phase: SavedMaskPhase;
    readonly filterRemaining: number;
    readonly exposure: number;
  };
}

export interface InventoryRecord {
  readonly items: Readonly<Record<ItemId, number>>;
  readonly selectedSlot: number;
}

export interface WorldPuzzleRecord {
  readonly poweredPlateIds: readonly string[];
  readonly solvedSequenceIds: readonly string[];
  readonly collectedPickupIds: readonly string[];
  readonly silencedMusicBoxIds: readonly string[];
  readonly openedVentIds: readonly string[];
}

export interface ThreatRecord {
  readonly jesterAwake: boolean;
  readonly jesterPosition: Vec3 | null;
}

/** The full v4 save document. */
export interface SaveGame {
  readonly version: typeof SAVE_SCHEMA_VERSION;
  readonly slot: SaveSlotId;
  readonly kind: SaveKind;
  readonly checkpointChunkIndex: number;
  readonly deepestChunkIndex: number;
  readonly playTimeSeconds: number;
  readonly deathCount: number;
  readonly inventory: InventoryRecord;
  readonly questFlags: Readonly<Record<string, number>>;
  readonly world: WorldPuzzleRecord;
  readonly threats: ThreatRecord;
  /** Present only on session saves. */
  readonly player: PlayerStateSnapshot | null;
  readonly savedAtIso: string;
}

/** On-disk wrapper: schema tag + checksum over the canonical payload JSON. */
export interface SaveEnvelope {
  readonly format: 'underworks-save';
  readonly schema: number;
  readonly checksum: string;
  readonly payload: unknown;
}

export function createNewGameSave(): SaveGame {
  return {
    version: SAVE_SCHEMA_VERSION,
    slot: 'autosave',
    kind: 'checkpoint',
    checkpointChunkIndex: 0,
    deepestChunkIndex: 0,
    playTimeSeconds: 0,
    deathCount: 0,
    inventory: { items: { gasMask: 0, filterCartridge: 0 }, selectedSlot: 0 },
    questFlags: {},
    world: { poweredPlateIds: [], solvedSequenceIds: [], collectedPickupIds: [], silencedMusicBoxIds: [], openedVentIds: [] },
    threats: { jesterAwake: false, jesterPosition: null },
    player: null,
    savedAtIso: new Date().toISOString(),
  };
}

/** One-line description for menus: "DEPTH -24 M · 00:12:31 · 2 DEATHS". */
export function describeSave(save: SaveGame): string {
  const totalSeconds: number = Math.floor(save.playTimeSeconds);
  const clock: string = `${String(Math.floor(totalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(totalSeconds / 60) % 60).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
  const depth: number = save.player !== null ? Math.max(0, -save.player.transform.position[2] / 3) : save.checkpointChunkIndex * 4;
  return `DEPTH -${depth.toFixed(0)} M · ${clock} · ${save.deathCount} ${save.deathCount === 1 ? 'DEATH' : 'DEATHS'}`;
}
