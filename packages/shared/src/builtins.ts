// Resolves built-in pack ids (b:<slug>) with no network. Owned by #2.
// Packs are registered by adding them to course/recipes/index.ts (#15) or assets/builtin/index.ts (#16).
import { BUILTIN_SKIN_PACKS, BUILTIN_THEME_PACKS } from './assets/builtin/index.ts';
import { BUILTIN_COURSE_PACKS } from './course/recipes/index.ts';
import type { Pack, PackKind } from './types.ts';

export function listBuiltins(kind?: PackKind): Pack[] {
  const all = [...BUILTIN_SKIN_PACKS, ...BUILTIN_THEME_PACKS, ...BUILTIN_COURSE_PACKS];
  return kind ? all.filter((p) => p.kind === kind) : all;
}

export function resolveBuiltin(id: string): Pack | null {
  if (typeof id !== 'string' || !id.startsWith('b:')) return null;
  return listBuiltins().find((p) => p.id === id) ?? null;
}
