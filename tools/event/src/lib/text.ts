// Text helpers. Owned by #56, shared with #59 and #63.

/**
 * Trim and cut to at most `max` UTF-16 units (what Zod's `.max()` and the contract schemas count),
 * never splitting an emoji or other surrogate pair.
 */
export function clip(text: string, max: number): string {
  let out = '';
  for (const ch of text.trim()) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out.trim();
}
