// What the pack routes need from a store beyond the PackStore contract (#23). Both stores implement it.
import type { Pack, PackStore } from '@wobble/shared/types';

export interface ApiPackStore extends PackStore {
  /** One report per (pack, client). The pack is hidden from listings once enough clients reported it. */
  report(id: string, clientId: string): Promise<{ count: number; hidden: boolean }>;
  /** Batch read for GET /api/packs/batch. Unknown ids come back in `missing`. */
  getMany(ids: string[]): Promise<{ packs: Pack[]; missing: string[] }>;
  /** Admin: show a hidden pack in listings again and forget its reports. */
  unflag(id: string): Promise<void>;
  /** Admin: delete a pack. Resolves to false when it did not exist. */
  remove(id: string): Promise<boolean>;
}
