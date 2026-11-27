// Primitive schemas reused by every other schema. Contract owned by #2.
import { z } from 'zod';

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export const QuatSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
/** Lower- or upper-case `#rrggbb`. */
export const HexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb');
/** `b:<slug>` = built-in (bundled), `g:<id>` = generated (served by the API). */
export const PackIdSchema = z.string().regex(/^[bg]:[a-z0-9][a-z0-9-]{0,63}$/, 'expected b:<slug> or g:<id>');
