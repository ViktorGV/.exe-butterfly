import type { Builder } from './kit.ts';
import type { Mat } from './mesher.ts';

/** One playable racer: its random roll, its materials and how its clay is sculpted. */
export interface RacerDef {
  id: string;
  name: string;
  roll: { archetype: string; theme: string; palette: string };
  /**
   * Joint heights for the skeleton (arms and feet are found by the kit while sculpting): the pelvis root, the
   * waist bend, the neck, and the right hip joint [x, y] (mirrored for the left).
   */
  rig: { hips: number; spine: number; neck: number; hip: [number, number] };
  mats: Record<string, Mat>;
  sculpt(b: Builder): void;
}
