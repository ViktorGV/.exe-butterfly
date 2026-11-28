// The racers' skeleton: 11 bones. Body-local space, feet at the origin, facing -Z; the racer's right is +X.

export const BONES = [
  'hips',
  'spine',
  'head',
  'upperArmR',
  'foreArmR',
  'upperArmL',
  'foreArmL',
  'thighR',
  'footR',
  'thighL',
  'footL',
] as const;
export type BoneName = (typeof BONES)[number];
export const BONE_COUNT = BONES.length;
/** Parent of each bone (-1 = root). */
export const BONE_PARENT = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9];

/** Limb bones that come in pairs. */
export type LimbBone = 'upperArm' | 'foreArm' | 'thigh' | 'foot';

/** Bone index of a body bone, or of a limb bone on one side (side > 0 = right, +X). */
export function boneIndex(name: 'hips' | 'spine' | 'head' | LimbBone, side = 1): number {
  const full = name === 'hips' || name === 'spine' || name === 'head' ? name : `${name}${side > 0 ? 'R' : 'L'}`;
  return BONES.indexOf(full as BoneName);
}
