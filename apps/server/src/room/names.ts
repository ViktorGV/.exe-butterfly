// Player name sanitising and de-duplication inside one room.
import { LIMITS } from '@wobble/shared/constants';
import { cleanName } from '@wobble/shared/assets/index';

export const DEFAULT_NAME = 'Wobbler';

/** Clean `raw` and make it unique among `taken` (compared case-insensitively) by adding " 2", " 3", ... */
export function uniqueName(raw: unknown, taken: Iterable<string>): string {
  const base = cleanName(raw, LIMITS.nameMax, DEFAULT_NAME);
  const used = new Set<string>();
  for (const n of taken) used.add(n.toLowerCase());
  if (!used.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const name =
      Array.from(base)
        .slice(0, LIMITS.nameMax - suffix.length)
        .join('')
        .trimEnd() + suffix;
    if (!used.has(name.toLowerCase())) return name;
  }
}
