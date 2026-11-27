// Colliders driven by a function of time, for tests and demo pages (real courses get their
// colliders from the course runtime, #7). update(t) keeps prevPose for surface velocities.
import type { Collider, PartDef, Pose } from '@wobble/shared/types';

export interface ScriptedCollider extends Collider {
  update(t: number): void;
}

export function createScriptedCollider(
  entityId: number,
  part: PartDef,
  poseAt: (t: number, out: Pose) => void,
): ScriptedCollider {
  const pose: Pose = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
  const prevPose: Pose = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
  poseAt(0, pose);
  poseAt(0, prevPose);
  return {
    entityId,
    part,
    pose,
    prevPose,
    update(t) {
      prevPose.pos[0] = pose.pos[0];
      prevPose.pos[1] = pose.pos[1];
      prevPose.pos[2] = pose.pos[2];
      prevPose.quat[0] = pose.quat[0];
      prevPose.quat[1] = pose.quat[1];
      prevPose.quat[2] = pose.quat[2];
      prevPose.quat[3] = pose.quat[3];
      poseAt(t, pose);
    },
  };
}

/** Writes a rotation of `yaw` about +Y followed by `roll` about local Z. */
export function setYawRoll(yaw: number, roll: number, out: Pose['quat']) {
  const cy = Math.cos(yaw / 2);
  const sy = Math.sin(yaw / 2);
  const cr = Math.cos(roll / 2);
  const sr = Math.sin(roll / 2);
  // q = qYaw * qRoll
  out[0] = sy * sr;
  out[1] = sy * cr;
  out[2] = cy * sr;
  out[3] = cy * cr;
}
