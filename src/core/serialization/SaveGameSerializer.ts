import type { ItemId } from '../../gameplay/Inventory';
import { ITEM_IDS } from '../../gameplay/Inventory';
import type { Vec3 } from '../../math/Vec3';
import type {
  InventoryRecord,
  PlayerStateSnapshot,
  SaveEnvelope,
  SaveGame,
  SaveKind,
  SaveSlotId,
  SavedMaskPhase,
  ThreatRecord,
  WorldPuzzleRecord,
} from './SaveGameSchema';
import { SAVE_SCHEMA_VERSION, SAVE_SLOT_IDS } from './SaveGameSchema';

export type DeserializeFailure = 'malformed' | 'checksum' | 'unsupportedVersion' | 'invalidPayload';
export type DeserializeResult = { readonly ok: true; readonly save: SaveGame; readonly migratedFrom: number | null } | { readonly ok: false; readonly reason: DeserializeFailure };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readVec3(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((component: unknown) => typeof component === 'number' && Number.isFinite(component))) {
    return null;
  }
  return [value[0] as number, value[1] as number, value[2] as number];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry: unknown): entry is string => typeof entry === 'string') : [];
}

/**
 * Canonical JSON: object keys sorted recursively so the checksum is independent of property order.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry: unknown) => canonicalJson(entry)).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key: string) => value[key] !== undefined)
      .map((key: string) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 32-bit FNV-1a over UTF-16 code units:  h₀ = 0x811C9DC5;  hᵢ₊₁ = (hᵢ ⊕ cᵢ) · 0x01000193  (mod 2³²).
 */
export function fnv1a32(text: string): string {
  let hash: number = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------------------------------------------------
// Migrations: each step upgrades a raw payload by exactly one schema version.
// ---------------------------------------------------------------------------------------------------------------------

type Migration = (payload: UnknownRecord) => UnknownRecord;

const MIGRATIONS: Readonly<Record<number, Migration>> = {
  /** v1 → v2: introduce the inventory block. */
  1: (payload: UnknownRecord) => ({ ...payload, version: 2, inventory: { hasGasMask: false } }),
  /** v2 → v3: introduce quest flags and world puzzle state. */
  2: (payload: UnknownRecord) => ({ ...payload, version: 3, questFlags: {}, world: { poweredPlateIds: [], solvedSequenceIds: [] } }),
  /** v3 → v4: item stacks replace the gas-mask boolean; add slot, kind, pickups, threats and player blocks. */
  3: (payload: UnknownRecord) => {
    const inventory: unknown = payload['inventory'];
    const hadMask: boolean = isRecord(inventory) && inventory['hasGasMask'] === true;
    const world: UnknownRecord = isRecord(payload['world']) ? payload['world'] : {};
    return {
      ...payload,
      version: 4,
      slot: 'autosave',
      kind: 'checkpoint',
      inventory: { items: { gasMask: hadMask ? 1 : 0, filterCartridge: 0 }, selectedSlot: 0 },
      world: { ...world, collectedPickupIds: hadMask ? ['pickup.gasMask.1'] : [] },
      threats: { jesterAwake: false, jesterPosition: null },
      player: null,
    };
  },
};

/** Applies migrations until the payload reaches the current schema (or fails). */
function migrate(payload: UnknownRecord): { payload: UnknownRecord; migratedFrom: number | null } | null {
  let version: number = finiteNumber(payload['version'], -1);
  const original: number = version;
  let current: UnknownRecord = payload;
  while (version < SAVE_SCHEMA_VERSION) {
    const step: Migration | undefined = MIGRATIONS[version];
    if (step === undefined) {
      return null;
    }
    current = step(current);
    version = finiteNumber(current['version'], -1);
  }
  return version === SAVE_SCHEMA_VERSION ? { payload: current, migratedFrom: original === SAVE_SCHEMA_VERSION ? null : original } : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Validation: rebuild a strictly typed SaveGame from an untrusted current-schema payload.
// ---------------------------------------------------------------------------------------------------------------------

function readInventory(value: unknown): InventoryRecord {
  const record: UnknownRecord = isRecord(value) ? value : {};
  const rawItems: UnknownRecord = isRecord(record['items']) ? record['items'] : {};
  const items = {} as Record<ItemId, number>;
  for (const itemId of ITEM_IDS) {
    items[itemId] = Math.max(0, Math.floor(finiteNumber(rawItems[itemId], 0)));
  }
  return { items, selectedSlot: Math.max(0, Math.floor(finiteNumber(record['selectedSlot'], 0))) };
}

function readWorld(value: unknown): WorldPuzzleRecord {
  const record: UnknownRecord = isRecord(value) ? value : {};
  return {
    poweredPlateIds: readStringArray(record['poweredPlateIds']),
    solvedSequenceIds: readStringArray(record['solvedSequenceIds']),
    collectedPickupIds: readStringArray(record['collectedPickupIds']),
    silencedMusicBoxIds: readStringArray(record['silencedMusicBoxIds']),
    openedVentIds: readStringArray(record['openedVentIds']),
  };
}

function readThreats(value: unknown): ThreatRecord {
  const record: UnknownRecord = isRecord(value) ? value : {};
  return { jesterAwake: record['jesterAwake'] === true, jesterPosition: readVec3(record['jesterPosition']) };
}

function readPlayer(value: unknown): PlayerStateSnapshot | null {
  if (!isRecord(value) || !isRecord(value['transform'])) {
    return null;
  }
  const transform: UnknownRecord = value['transform'];
  const position: Vec3 | null = readVec3(transform['position']);
  if (position === null) {
    return null;
  }
  const mask: UnknownRecord = isRecord(value['mask']) ? value['mask'] : {};
  const rawPhase: unknown = mask['phase'];
  const phase: SavedMaskPhase = rawPhase === 'stowed' || rawPhase === 'worn' ? rawPhase : 'unavailable';
  return {
    transform: {
      position,
      velocity: readVec3(transform['velocity']) ?? [0, 0, 0],
      yawRadians: finiteNumber(transform['yawRadians'], 0),
      pitchRadians: Math.max(-1.35, Math.min(1.35, finiteNumber(transform['pitchRadians'], 0))),
      crouching: transform['crouching'] === true,
    },
    stamina: Math.max(0, Math.min(1, finiteNumber(value['stamina'], 1))),
    mask: {
      phase,
      filterRemaining: Math.max(0, Math.min(1, finiteNumber(mask['filterRemaining'], 1))),
      exposure: Math.max(0, Math.min(0.95, finiteNumber(mask['exposure'], 0))),
    },
  };
}

function readQuestFlags(value: unknown): Record<string, number> {
  const flags: Record<string, number> = {};
  if (isRecord(value)) {
    for (const [flag, flagValue] of Object.entries(value)) {
      if (typeof flagValue === 'number' && Number.isFinite(flagValue)) {
        flags[flag] = flagValue;
      }
    }
  }
  return flags;
}

function validate(payload: UnknownRecord): SaveGame | null {
  const required: readonly string[] = ['checkpointChunkIndex', 'deepestChunkIndex', 'playTimeSeconds', 'deathCount'];
  if (!required.every((key: string) => typeof payload[key] === 'number' && Number.isFinite(payload[key]))) {
    return null;
  }
  const rawSlot: unknown = payload['slot'];
  const slot: SaveSlotId = SAVE_SLOT_IDS.includes(rawSlot as SaveSlotId) ? (rawSlot as SaveSlotId) : 'autosave';
  const kind: SaveKind = payload['kind'] === 'session' ? 'session' : 'checkpoint';
  const player: PlayerStateSnapshot | null = kind === 'session' ? readPlayer(payload['player']) : null;
  return {
    version: SAVE_SCHEMA_VERSION,
    slot,
    kind: player !== null ? kind : 'checkpoint',
    checkpointChunkIndex: Math.max(0, Math.floor(payload['checkpointChunkIndex'] as number)),
    deepestChunkIndex: Math.max(0, Math.floor(payload['deepestChunkIndex'] as number)),
    playTimeSeconds: Math.max(0, payload['playTimeSeconds'] as number),
    deathCount: Math.max(0, Math.floor(payload['deathCount'] as number)),
    inventory: readInventory(payload['inventory']),
    questFlags: readQuestFlags(payload['questFlags']),
    world: readWorld(payload['world']),
    threats: readThreats(payload['threats']),
    player,
    savedAtIso: typeof payload['savedAtIso'] === 'string' ? payload['savedAtIso'] : new Date(0).toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------------------------------

/** SaveGame → envelope JSON string (checksummed canonical payload). */
export function serializeSave(save: SaveGame): string {
  const payloadJson: string = canonicalJson(save);
  const envelope: SaveEnvelope = { format: 'underworks-save', schema: SAVE_SCHEMA_VERSION, checksum: fnv1a32(payloadJson), payload: JSON.parse(payloadJson) as unknown };
  return JSON.stringify(envelope);
}

/**
 * JSON string → SaveGame. Accepts checksummed envelopes (any schema with a migration path) and the bare
 * legacy documents written before envelopes existed (schema 1–3).
 */
export function deserializeSave(text: string): DeserializeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'malformed' };
  }
  let payload: unknown;
  if (parsed['format'] === 'underworks-save') {
    payload = parsed['payload'];
    if (typeof parsed['checksum'] !== 'string' || fnv1a32(canonicalJson(payload)) !== parsed['checksum']) {
      return { ok: false, reason: 'checksum' };
    }
  } else {
    payload = parsed;
  }
  if (!isRecord(payload)) {
    return { ok: false, reason: 'invalidPayload' };
  }
  const migrated = migrate(payload);
  if (migrated === null) {
    return { ok: false, reason: 'unsupportedVersion' };
  }
  const save: SaveGame | null = validate(migrated.payload);
  return save === null ? { ok: false, reason: 'invalidPayload' } : { ok: true, save, migratedFrom: migrated.migratedFrom };
}
