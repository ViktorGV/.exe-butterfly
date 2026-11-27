// Crowd (#9): instanced remote players with a full-detail near tier.
export {
  createCrowd,
  CROWD_DEFAULTS,
  type Crowd,
  type CrowdOptions,
  type CrowdPlayer,
  type CrowdPose,
  type CrowdStats,
  type CrowdWobbler,
} from './crowd.ts';
export { assignTiers, createTierScratch, NEAR_STICKY } from './tiers.ts';
export { createSlotPool, type SlotPool } from './pool.ts';
