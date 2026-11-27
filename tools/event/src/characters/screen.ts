// Character prompt screening (#63): a local pre-screen, the rules every screen result must
// follow, and the deterministic screener used in mock mode.
import { COLOR_WORDS, IP_NAMES, MOTIF_WORDS, SILHOUETTE_WORDS, UNSAFE_WORDS, VIBE_WORDS } from './lexicon.ts';
import type { Screen, Traits } from './types.ts';

/** A prompt needs at least this many concrete visual traits (colours + motifs) to be `ok`. */
export const MIN_CONCRETE_TRAITS = 2;

const NO_TRAITS: Traits = { colors: [], motifs: [], vibe: '', silhouette: '' };

function rejected(status: Screen['status']): Screen {
  return { status, traits: { ...NO_TRAITS }, reinterpretedFromIP: false, description: '' };
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z-]*/g) ?? [];
}

/** Catches empty and plainly unsafe prompts without a model call. null = needs a real screen. */
export function preScreen(prompt: string): Screen | null {
  const text = prompt.trim();
  if (text.length < 3 || !/\p{L}/u.test(text)) return rejected('empty');
  const ws = new Set(words(text));
  if (UNSAFE_WORDS.some((w) => ws.has(w))) return rejected('unsafe');
  return null;
}

/** Rules every screen result must obey, whoever produced it. */
export function finalizeScreen(s: Screen): Screen {
  if (s.status !== 'ok') return rejected(s.status);
  const colors = [...new Set(s.traits.colors.map((c) => c.toLowerCase()))].slice(0, 4);
  const motifs = [...new Set(s.traits.motifs.map((m) => m.trim().toLowerCase()).filter(Boolean))].slice(0, 5);
  if (colors.length + motifs.length < MIN_CONCRETE_TRAITS) return rejected('tooVague');
  return {
    status: 'ok',
    traits: { colors, motifs, vibe: s.traits.vibe.slice(0, 40), silhouette: s.traits.silhouette.slice(0, 40) },
    reinterpretedFromIP: s.reinterpretedFromIP,
    description: s.description.trim().slice(0, 300),
  };
}

/** Removes known character and real-person names, replacing each with a neutral archetype. */
export function stripIP(prompt: string): { text: string; found: boolean } {
  let text = prompt;
  let found = false;
  for (const [name, archetype] of Object.entries(IP_NAMES)) {
    const re = new RegExp(`\\b${name.replace(/[-\s]/g, '[-\\s]?')}\\b`, 'gi');
    if (re.test(text)) {
      found = true;
      text = text.replace(re, archetype);
    }
  }
  return { text, found };
}

/** Deterministic screen from word lists, for mock mode and tests. */
export function mockScreen(prompt: string): Screen {
  const pre = preScreen(prompt);
  if (pre) return pre;
  const { text, found } = stripIP(prompt);
  const ws = words(text);
  const colors: string[] = [];
  const motifs: string[] = [];
  let silhouette = '';
  let vibe = '';
  for (const w of ws) {
    for (const part of [w, ...w.split('-')]) {
      const c = COLOR_WORDS[part];
      if (c && !colors.includes(c)) colors.push(c);
      const m = MOTIF_WORDS[part];
      if (m && !motifs.includes(m)) motifs.push(m);
      if (!silhouette && SILHOUETTE_WORDS[part]) silhouette = SILHOUETTE_WORDS[part]!;
      if (!vibe && VIBE_WORDS.includes(part)) vibe = part;
    }
  }
  return finalizeScreen({
    status: 'ok',
    traits: { colors, motifs, vibe: vibe || 'cheerful', silhouette: silhouette || 'round' },
    reinterpretedFromIP: found,
    description: text.replace(/\s+/g, ' ').trim(),
  });
}
