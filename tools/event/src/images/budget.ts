// The per-theme image budget from the #54 contract: THEME_IMAGE_LIMITS (#59).
import { THEME_IMAGE_LIMITS } from '@wobble/shared';
import type { ImageKind, ProcessedImage } from './process.ts';

export interface BudgetItem {
  id: string;
  kind: ImageKind;
  /** Lower is more important; the least important images are dropped first. */
  priority: number;
  image: ProcessedImage;
}

export const imageBytes = (image: ProcessedImage): number => image.files.reduce((n, f) => n + f.bytes.length, 0);

export const totalBytes = (items: BudgetItem[]): number => items.reduce((n, i) => n + imageBytes(i.image), 0);

/** Problems with sizes or total bytes; empty when the set fits. */
export function budgetProblems(items: BudgetItem[], limitBytes: number = THEME_IMAGE_LIMITS.totalBytes): string[] {
  const problems: string[] = [];
  for (const item of items) {
    const [w, h] = THEME_IMAGE_LIMITS[item.kind];
    const { ref } = item.image;
    if (ref.w > w || ref.h > h) problems.push(`${item.id}: ${ref.w}x${ref.h} is larger than ${w}x${h}`);
  }
  const total = totalBytes(items);
  if (total > limitBytes) problems.push(`images take ${total} bytes, more than ${limitBytes}`);
  return problems;
}

const FALLBACK_QUALITIES = [70, 55, 40];

export interface FitResult {
  kept: BudgetItem[];
  dropped: string[];
}

/** Fit a theme's images in the byte budget: first re-encode the largest ones, then drop the least important. */
export async function fitBudget(
  items: BudgetItem[],
  limitBytes: number = THEME_IMAGE_LIMITS.totalBytes,
): Promise<FitResult> {
  const kept = items.map((i) => ({ ...i }));
  for (const quality of FALLBACK_QUALITIES) {
    const bySize = [...kept].sort((a, b) => imageBytes(b.image) - imageBytes(a.image));
    for (const item of bySize) {
      if (totalBytes(kept) <= limitBytes) return { kept, dropped: [] };
      const smaller = await item.image.reencode(quality);
      if (imageBytes(smaller) < imageBytes(item.image)) item.image = smaller;
    }
  }
  const dropped: string[] = [];
  while (totalBytes(kept) > limitBytes && kept.length) {
    const worst = kept.reduce((a, b) => (b.priority >= a.priority ? b : a));
    kept.splice(kept.indexOf(worst), 1);
    dropped.push(worst.id);
  }
  return { kept, dropped };
}
