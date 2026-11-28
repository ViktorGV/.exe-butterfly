// Image file names referenced by a v2 theme (#24, #54), for event-mode prefetching.
import type { ThemeDefV2 } from '@wobble/shared';

interface Ref {
  src: string;
  lowSrc?: string | null;
}

function isRef(v: unknown): v is Ref {
  return typeof v === 'object' && v !== null && typeof (v as Ref).src === 'string' && 'w' in v && 'h' in v;
}

/** Every distinct image of the theme: the `@0.5x` variant when `low` and one exists, else full size. */
export function themeImages(theme: ThemeDefV2, low: boolean): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isRef(v)) out.add(low && v.lowSrc ? v.lowSrc : v.src);
    else if (typeof v === 'object' && v !== null) Object.values(v).forEach(walk);
  };
  walk(theme);
  return [...out];
}
