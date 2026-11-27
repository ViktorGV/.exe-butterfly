// --dry-run: what a real run would call and roughly cost, without calling anything (#59).
import { estimateCostUsd, MODEL_PRICES, resolveModels } from '@wobble/ai';
import type { ModelMap } from '@wobble/ai';
import { proceduralDraft } from './procedural.ts';
import type { Pick } from './selection.ts';
import { planSlots } from './slots.ts';
import type { PresetName } from './slots.ts';

/** Typical token counts, a little on the high side. */
const TYPICAL = { artInput: 12_000, artOutput: 7_000, qaInput: 4_000, qaOutput: 150 };

export interface Estimate {
  lines: string[];
  images: number;
  /** One attempt per image. */
  typicalUsd: number;
  /** Every image rejected twice. */
  worstUsd: number;
  /** Models with no known price: their calls are counted as $0 above. */
  unpriced: string[];
}

export function estimateRun(picks: Pick[], preset: PresetName, models: ModelMap = resolveModels()): Estimate {
  const art = estimateCostUsd(models.smart, TYPICAL.artInput * 3, TYPICAL.artOutput);
  const image = MODEL_PRICES[models.image]?.perImage ?? 0;
  const qa = estimateCostUsd(models.vision, TYPICAL.qaInput * 3, TYPICAL.qaOutput);
  let images = 0;
  const lines = picks.map((pick) => {
    const plan = proceduralDraft(pick).look.images;
    const slots = planSlots(plan, plan, preset);
    images += slots.length;
    return `${pick.slug}: 2 art-direction calls, ${slots.length} images (${slots.map((s) => s.id).join(', ')})`;
  });
  const artUsd = art * picks.length;
  return {
    lines,
    images,
    typicalUsd: artUsd + images * (image + qa),
    worstUsd: artUsd * 3 + images * (image + qa) * 3,
    unpriced: [...new Set([models.smart, models.image, models.vision])].filter((m) => !MODEL_PRICES[m]),
  };
}
