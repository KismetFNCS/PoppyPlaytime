import { STORAGE_KEYS } from '../../config/GameConstants';
import type { SaveGame, SaveSlotId } from './SaveGameSchema';
import { SAVE_SLOT_IDS } from './SaveGameSchema';
import type { DeserializeResult } from './SaveGameSerializer';
import { deserializeSave, serializeSave } from './SaveGameSerializer';

/** Minimal key/value storage contract (window.localStorage in the browser, a Map in tests). */
export interface SaveStorageAdapter {
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove(key: string): void;
}

export class LocalStorageAdapter implements SaveStorageAdapter {
  public read(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  public write(key: string, value: string): boolean {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  public remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Storage unavailable; nothing to remove.
    }
  }
}

export class MemoryStorageAdapter implements SaveStorageAdapter {
  private readonly entries: Map<string, string> = new Map();

  public read(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  public write(key: string, value: string): boolean {
    this.entries.set(key, value);
    return true;
  }

  public remove(key: string): void {
    this.entries.delete(key);
  }
}

export interface SaveLoadReport {
  readonly save: SaveGame | null;
  /** Where the returned save came from. */
  readonly source: 'primary' | 'backup' | 'legacy' | 'none';
  readonly failure: string | null;
}

/**
 * Slot-based save store:
 *   primary key  `${base}.${slot}`      — latest write
 *   backup key   `${base}.${slot}.bak`  — the previous verified write (restored if the primary is corrupt)
 *   legacy key   STORAGE_KEYS.save      — pre-v4 single save, imported into the autosave slot on first load
 */
export class SaveRepository {
  private static readonly BASE_KEY: string = 'underworks.save.v4';
  private readonly cache: Map<SaveSlotId, SaveGame | null> = new Map();

  public constructor(private readonly storage: SaveStorageAdapter = new LocalStorageAdapter()) {
    this.importLegacySave();
  }

  private primaryKey(slot: SaveSlotId): string {
    return `${SaveRepository.BASE_KEY}.${slot}`;
  }

  private backupKey(slot: SaveSlotId): string {
    return `${SaveRepository.BASE_KEY}.${slot}.bak`;
  }

  /** One-time import of the pre-envelope save so existing players keep their progress. */
  private importLegacySave(): void {
    const legacyText: string | null = this.storage.read(STORAGE_KEYS.save);
    if (legacyText === null || this.storage.read(this.primaryKey('autosave')) !== null) {
      return;
    }
    const result: DeserializeResult = deserializeSave(legacyText);
    if (result.ok) {
      this.write({ ...result.save, slot: 'autosave' });
    }
    this.storage.remove(STORAGE_KEYS.save);
  }

  public loadSlot(slot: SaveSlotId): SaveLoadReport {
    const primaryText: string | null = this.storage.read(this.primaryKey(slot));
    if (primaryText !== null) {
      const primary: DeserializeResult = deserializeSave(primaryText);
      if (primary.ok) {
        this.cache.set(slot, primary.save);
        return { save: primary.save, source: 'primary', failure: null };
      }
      const backupText: string | null = this.storage.read(this.backupKey(slot));
      if (backupText !== null) {
        const backup: DeserializeResult = deserializeSave(backupText);
        if (backup.ok) {
          console.warn(`[SaveRepository] ${slot}: primary save unreadable (${primary.reason}); restored backup.`);
          this.storage.write(this.primaryKey(slot), backupText);
          this.cache.set(slot, backup.save);
          return { save: backup.save, source: 'backup', failure: primary.reason };
        }
      }
      this.cache.set(slot, null);
      return { save: null, source: 'none', failure: primary.reason };
    }
    this.cache.set(slot, null);
    return { save: null, source: 'none', failure: null };
  }

  public load(slot: SaveSlotId): SaveGame | null {
    return this.cache.has(slot) ? (this.cache.get(slot) ?? null) : this.loadSlot(slot).save;
  }

  /** Writes a save: the current primary (if valid) rotates into the backup slot first. */
  public write(save: SaveGame): boolean {
    const slot: SaveSlotId = save.slot;
    const stamped: SaveGame = { ...save, savedAtIso: new Date().toISOString() };
    const previousText: string | null = this.storage.read(this.primaryKey(slot));
    if (previousText !== null && deserializeSave(previousText).ok) {
      this.storage.write(this.backupKey(slot), previousText);
    }
    const written: boolean = this.storage.write(this.primaryKey(slot), serializeSave(stamped));
    if (written) {
      this.cache.set(slot, stamped);
    }
    return written;
  }

  /** Most recently written save across all slots (CONTINUE target). */
  public latest(): SaveGame | null {
    let newest: SaveGame | null = null;
    for (const slot of SAVE_SLOT_IDS) {
      const candidate: SaveGame | null = this.load(slot);
      if (candidate !== null && (newest === null || candidate.savedAtIso > newest.savedAtIso)) {
        newest = candidate;
      }
    }
    return newest;
  }

  public get hasAnySave(): boolean {
    return this.latest() !== null;
  }

  public eraseAll(): void {
    for (const slot of SAVE_SLOT_IDS) {
      this.storage.remove(this.primaryKey(slot));
      this.storage.remove(this.backupKey(slot));
      this.cache.set(slot, null);
    }
  }
}
