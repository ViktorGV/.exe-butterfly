// Fixed-size slot pool for the crowd (#9): player id -> dense slot index, reused on leave.

export interface SlotPool {
  readonly max: number;
  /** Slot for `id`, allocating one if needed; -1 when full. */
  acquire(id: number): number;
  release(id: number): void;
  slotOf(id: number): number;
  /** Player id in a slot, -1 when free. */
  idAt(slot: number): number;
  /** Highest used slot + 1 (loop bound). */
  readonly span: number;
  readonly size: number;
}

export function createSlotPool(max: number): SlotPool {
  const ids = new Int32Array(max).fill(-1);
  const free = new Int32Array(max);
  for (let i = 0; i < max; i++) free[i] = max - 1 - i; // the lowest slot is handed out first
  let freeTop = max;
  let span = 0;
  const byId = new Map<number, number>();

  return {
    max,
    acquire(id) {
      const have = byId.get(id);
      if (have !== undefined) return have;
      if (freeTop === 0) return -1;
      const slot = free[--freeTop]!;
      ids[slot] = id;
      byId.set(id, slot);
      if (slot >= span) span = slot + 1;
      return slot;
    },
    release(id) {
      const slot = byId.get(id);
      if (slot === undefined) return;
      byId.delete(id);
      ids[slot] = -1;
      free[freeTop++] = slot;
      while (span > 0 && ids[span - 1] === -1) span--;
    },
    slotOf: (id) => byId.get(id) ?? -1,
    idAt: (slot) => ids[slot] ?? -1,
    get span() {
      return span;
    },
    get size() {
      return byId.size;
    },
  };
}
