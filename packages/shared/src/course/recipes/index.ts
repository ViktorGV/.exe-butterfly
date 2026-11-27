// Built-in course packs, read by resolveBuiltin() in ../../builtins.ts.
// Seeded by #2 with the fixture; #15 adds b:gumdrop-gauntlet, b:first-wobble and b:spin-cycle.
import { fixtureCoursePack } from '../../fixtures/index.ts';
import type { Pack } from '../../types.ts';

export const BUILTIN_COURSE_PACKS: Pack[] = [fixtureCoursePack];
