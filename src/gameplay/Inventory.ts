export type ItemId = 'gasMask' | 'filterCartridge';
export const ITEM_IDS: readonly ItemId[] = ['gasMask', 'filterCartridge'];

export interface ItemDefinition {
  readonly id: ItemId;
  readonly displayName: string;
  readonly shortLabel: string;
  readonly maximumStack: number;
  /** Consumed on use (removes one from the stack). */
  readonly consumable: boolean;
  /** Fixed hotbar slot (0-based). */
  readonly hotbarSlot: number;
}

export const ITEM_DEFINITIONS: Readonly<Record<ItemId, ItemDefinition>> = {
  gasMask: { id: 'gasMask', displayName: 'Gas Mask', shortLabel: 'MASK', maximumStack: 1, consumable: false, hotbarSlot: 0 },
  filterCartridge: { id: 'filterCartridge', displayName: 'Filter Cartridge', shortLabel: 'FILTER', maximumStack: 4, consumable: true, hotbarSlot: 1 },
};

/** Hotbar layout: two item slots followed by the two Tether Rig claws (status-only slots). */
export type HotbarSlotContent = { readonly kind: 'item'; readonly itemId: ItemId } | { readonly kind: 'claw'; readonly side: 'left' | 'right' };

export const HOTBAR_LAYOUT: readonly HotbarSlotContent[] = [
  { kind: 'item', itemId: 'gasMask' },
  { kind: 'item', itemId: 'filterCartridge' },
  { kind: 'claw', side: 'left' },
  { kind: 'claw', side: 'right' },
];

export type InventorySnapshot = Readonly<{ items: Readonly<Record<ItemId, number>>; selectedSlot: number }>;

/** Stack-counted item store with a selected hotbar slot. */
export class Inventory {
  private readonly counts: Record<ItemId, number> = { gasMask: 0, filterCartridge: 0 };
  public selectedSlot: number = 0;

  public count(itemId: ItemId): number {
    return this.counts[itemId];
  }

  public has(itemId: ItemId): boolean {
    return this.counts[itemId] > 0;
  }

  /** Adds up to the stack limit; returns how many were actually stored. */
  public add(itemId: ItemId, amount: number = 1): number {
    const definition: ItemDefinition = ITEM_DEFINITIONS[itemId];
    const before: number = this.counts[itemId];
    this.counts[itemId] = Math.min(definition.maximumStack, before + Math.max(0, Math.floor(amount)));
    return this.counts[itemId] - before;
  }

  public remove(itemId: ItemId, amount: number = 1): boolean {
    if (this.counts[itemId] < amount) {
      return false;
    }
    this.counts[itemId] -= amount;
    return true;
  }

  public isFull(itemId: ItemId): boolean {
    return this.counts[itemId] >= ITEM_DEFINITIONS[itemId].maximumStack;
  }

  public selectSlot(slot: number): void {
    this.selectedSlot = ((Math.floor(slot) % HOTBAR_LAYOUT.length) + HOTBAR_LAYOUT.length) % HOTBAR_LAYOUT.length;
  }

  public get selectedContent(): HotbarSlotContent {
    return HOTBAR_LAYOUT[this.selectedSlot] as HotbarSlotContent;
  }

  public snapshot(): InventorySnapshot {
    return { items: { ...this.counts }, selectedSlot: this.selectedSlot };
  }

  public restore(snapshot: InventorySnapshot): void {
    for (const itemId of ITEM_IDS) {
      const value: number = snapshot.items[itemId];
      this.counts[itemId] = Math.max(0, Math.min(ITEM_DEFINITIONS[itemId].maximumStack, Math.floor(Number.isFinite(value) ? value : 0)));
    }
    this.selectSlot(snapshot.selectedSlot);
  }
}
