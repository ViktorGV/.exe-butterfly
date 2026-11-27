// Shared building blocks for obstacle kinds: parameter schemas with defaults and clamps,
// per-entity parameter caching (so pose() allocates nothing), and local-to-world placement.
import { z } from 'zod';
import { MATERIAL_SLOTS } from '../../constants.ts';
import type { EntityDef, MaterialSlot, ObstacleKind, PartDef, Pose, Quat, Vec3 } from '../../types.ts';
import { quatFromYaw, quatMul, rotateYaw } from './math.ts';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Number with a default (also used for invalid input) clamped to [lo, hi]. */
export const num = (def: number, lo: number, hi: number) =>
  z
    .number()
    .catch(def)
    .transform((v) => clamp(Number.isFinite(v) ? v : def, lo, hi));

/** Integer variant of num(). */
export const int = (def: number, lo: number, hi: number) => num(def, lo, hi).transform((v) => Math.round(v));

/** Vec3 with a default and per-component clamps. */
export const vec3 = (def: Vec3, lo: Vec3, hi: Vec3) =>
  z
    .tuple([z.number(), z.number(), z.number()])
    .catch(def)
    .transform((v): Vec3 => [clamp(v[0], lo[0], hi[0]), clamp(v[1], lo[1], hi[1]), clamp(v[2], lo[2], hi[2])]);

export const slot = (def: MaterialSlot) => z.enum(MATERIAL_SLOTS).catch(def);

/** +1 or -1. */
export const dir = () =>
  z
    .number()
    .catch(1)
    .transform((v) => (v < 0 ? -1 : 1));

export const TAU = Math.PI * 2;

export interface KindSpec<P> {
  kind: string;
  schema: z.ZodType<P>;
  parts(def: EntityDef, p: P): PartDef[];
  pose(def: EntityDef, p: P, t: number, out: Pose[]): void;
  /** Seconds per cycle, or 0 when static. */
  period(p: P): number;
  /** Fastest speed (m/s) of any surface point. */
  maxSpeed(p: P): number;
}

export interface ObstacleKindExt extends ObstacleKind {
  period(def: EntityDef): number;
  maxSpeed(def: EntityDef): number;
}

/** Wrap a spec into an ObstacleKind whose parsed params are cached per entity. */
export function defineKind<P>(spec: KindSpec<P>): ObstacleKindExt {
  const cache = new WeakMap<EntityDef, P>();
  const params = (def: EntityDef): P => {
    let p = cache.get(def);
    if (p === undefined) {
      p = spec.schema.parse(def.params ?? {});
      cache.set(def, p);
    }
    return p;
  };
  return {
    kind: spec.kind,
    paramsSchema: spec.schema,
    parts: (def) => spec.parts(def, params(def)),
    pose: (def, t, out) => spec.pose(def, params(def), t, out),
    period: (def) => spec.period(params(def)),
    maxSpeed: (def) => spec.maxSpeed(params(def)),
  };
}

export const part = (
  shape: PartDef['shape'],
  size: Vec3,
  slotName: MaterialSlot,
  extra: Partial<PartDef> = {},
): PartDef => ({ shape, size, surface: 'solid', slot: slotName, collide: true, visible: true, ...extra });

const yawQ: Quat = [0, 0, 0, 1];
const off: Vec3 = [0, 0, 0];
const IDENTITY: Quat = [0, 0, 0, 1];

/**
 * Place a part at a point given in the entity's local frame (rotated by the entity's yaw,
 * offset from its pos), with an extra local rotation applied first.
 */
export function place(def: EntityDef, lx: number, ly: number, lz: number, localQuat: Quat | null, out: Pose) {
  rotateYaw(lx, ly, lz, def.yaw, off);
  out.pos[0] = def.pos[0] + off[0];
  out.pos[1] = def.pos[1] + off[1];
  out.pos[2] = def.pos[2] + off[2];
  quatFromYaw(def.yaw, yawQ);
  quatMul(yawQ, localQuat ?? IDENTITY, out.quat);
}
