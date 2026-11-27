// Canned, deterministic AI answers for WOBBLE_AI_MOCK=1: keyword heuristics, enough to exercise every status
// offline and in CI. This is not the real screening; the real run asks the models. Owned by #56.
import type { MockResponder } from '../lib/ai.ts';
import { seedFrom } from '../lib/hash.ts';
import type { Criteria, Screen } from './schemas.ts';

const UNSAFE = /\b(gore|gory|blood\w*|kill\w*|murder\w*|nude|naked|sexy?|drugs?|cocaine|torture\w*|massacre\w*)\b/i;
const IP =
  /\b(mario|pokemon|pikachu|minecraft|fortnite|sonic|star wars|harry potter|disney|batman|zelda|roblox|spider-?man|lego|barbie)\b/gi;
const MECHANICS =
  /\b(shoot\w*|weapons?|craft\w*|drive|driving|inventory|upgrades?|skill tree|level up|turn-based|deck-?building|combat|boss fights?|crafting)\b/i;
/** Words about gameplay, which say nothing about a look. */
const FILLER = new Set(
  'a an and the of to in on with where you your my it is are be make game race racing like but players player which that for from'.split(
    ' ',
  ),
);

interface Setting {
  words: RegExp;
  palette: string[];
  moods: string[];
}

const SETTINGS: Record<string, Setting> = {
  ocean: {
    words: /ocean|sea\b|underwater|coral|reef|kelp/i,
    palette: ['#0a5c8f', '#1fa7b8', '#7fe3d4'],
    moods: ['calm'],
  },
  space: {
    words: /space|planet|galaxy|moon|rocket|comet/i,
    palette: ['#2b1d63', '#6a3fbf', '#c7a6ff'],
    moods: ['epic'],
  },
  forest: { words: /forest|mushroom|tree|woodland|moss/i, palette: ['#1f6b2e', '#58a83c', '#b9dd6a'], moods: ['cosy'] },
  candy: {
    words: /candy|sweets|lollipop|cupcake|gumdrop|frosting/i,
    palette: ['#ff5fa8', '#ffa3cf', '#ffe3f1'],
    moods: ['sweet'],
  },
  desert: { words: /desert|dune|pyramid|cactus|sand\b/i, palette: ['#d98b2b', '#f0bb55', '#ffe29a'], moods: ['sunny'] },
  snow: {
    words: /snow|ice\b|frozen|glacier|penguin|igloo/i,
    palette: ['#bfe3f5', '#e8f7ff', '#ffffff'],
    moods: ['crisp'],
  },
  volcano: { words: /volcano|lava|magma|ember/i, palette: ['#7a1208', '#d9361a', '#ff8a2a'], moods: ['fiery'] },
  city: {
    words: /city|neon|skyscraper|street|rooftop/i,
    palette: ['#34344f', '#ff2fd0', '#22e0ff'],
    moods: ['electric'],
  },
  castle: {
    words: /castle|knight|dragon|medieval|drawbridge/i,
    palette: ['#6d6a75', '#a39d8f', '#8c2f39'],
    moods: ['heroic'],
  },
  jungle: { words: /jungle|vine|temple|parrot/i, palette: ['#0e4d3a', '#1d8f5a', '#e0a526'], moods: ['wild'] },
  farm: {
    words: /farm|barn|tractor|hay\b|vegetable/i,
    palette: ['#b8452f', '#e5c15a', '#7fae42'],
    moods: ['friendly'],
  },
  library: {
    words: /library|book|paper|ink\b|origami/i,
    palette: ['#6b4226', '#b98a5a', '#f3e6c8'],
    moods: ['curious'],
  },
  sky: { words: /sky|cloud|balloon|rainbow|kite/i, palette: ['#6fb7ff', '#b5dbff', '#fff2a8'], moods: ['dreamy'] },
  carnival: {
    words: /carnival|circus|fairground|ferris/i,
    palette: ['#e8323c', '#ffcf24', '#2456d6'],
    moods: ['festive'],
  },
  kitchen: {
    words: /kitchen|noodle|pancake|soup|teapot/i,
    palette: ['#d9d2c3', '#e2673f', '#4f9d9a'],
    moods: ['silly'],
  },
};

const settingsOf = (text: string) =>
  Object.entries(SETTINGS)
    .map(([name, s]) => ({ name, at: text.search(s.words) }))
    .filter((s) => s.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((s) => s.name);

const words = (text: string) => text.split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);

function titleOf(text: string): string {
  const picked = words(text).filter((w) => !FILLER.has(w.toLowerCase()));
  const title = picked
    .slice(0, 3)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return title.slice(0, 32).trim();
}

export function mockScreen(prompt: string): Screen {
  const ip = [...new Set(prompt.match(IP) ?? [])];
  const stripped = prompt.replace(IP, '').replace(/\s+/g, ' ').trim();
  const settings = settingsOf(stripped);
  const original = words(stripped).filter((w) => !FILLER.has(w.toLowerCase()));
  const mechanics = MECHANICS.test(prompt);
  const feasibility = mechanics ? 'needsNewMechanics' : words(prompt).length < 6 ? 'tooVague' : 'visual';
  const setting = SETTINGS[settings[0] ?? ''];
  let rewrite: string | null = null;
  if (mechanics && setting) rewrite = `An obstacle course dressed as a bright ${settings.join(' and ')} world.`;
  else if (!mechanics && ip.length && setting && original.length >= 4) rewrite = stripped;
  const visualText = rewrite ?? stripped;
  const safe = !UNSAFE.test(prompt);
  return {
    safe,
    namesExistingIP: ip,
    feasibility,
    visualReinterpretation: rewrite,
    titleIdea: titleOf(visualText) || 'Untitled',
    summary: visualText.slice(0, 160),
    settingTags: settings.length ? settings : ['fantasy'],
    moodTags: setting?.moods ?? ['playful'],
    paletteHint: setting?.palette ?? ['#8a6fd1', '#f2a65a', '#6cc4a1'],
    manipulation: false,
    reason: !safe
      ? 'Contains content that is not suitable for children.'
      : feasibility === 'tooVague'
        ? 'No setting or look to build from.'
        : feasibility === 'needsNewMechanics'
          ? 'Asks for gameplay the course does not have.'
          : 'Describes a clear look.',
  };
}

/** Depends only on the idea text, so list order and ids never change a score. */
export function mockCriteria(idea: string): Criteria {
  const detail = Math.min(3, Math.floor(words(idea).length / 8));
  const roll = (key: string, base: number) => Math.min(10, base + (seedFrom(`${key}:${idea}`) % 4));
  return {
    themeability: roll('themeability', 3 + detail),
    distinctiveness: roll('distinctiveness', 4 + Math.min(2, settingsOf(idea).length)),
    readability: /\b(dark|black|invisible|pitch|shadow)\w*/i.test(idea) ? 2 : roll('readability', 6),
    partyFit: roll('partyFit', 4 + detail),
    originality: roll('originality', 3 + detail),
  };
}

interface ScoreInput {
  items: Array<{ id: string; idea: string }>;
}
interface PickInput {
  items: Array<{ id: string; score: number; settingTags: string[] }>;
}

export const selectMockResponder: MockResponder = (name, input) => {
  if (name === 'screen') return mockScreen((input as { gamePrompt: string }).gamePrompt);
  if (name === 'score') {
    return {
      scores: (input as ScoreInput).items.map((i) => ({
        id: i.id,
        ...mockCriteria(i.idea),
        reason: 'Mock score from the length and setting of the idea.',
      })),
    };
  }
  if (name === 'credit') {
    const { names } = input as { names: Array<{ id: string; name: string }> };
    return { names: names.map((n) => ({ id: n.id, ok: !UNSAFE.test(n.name) && !n.name.match(IP) })) };
  }
  if (name === 'pick') {
    const items = (input as PickInput).items.slice().sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const seen = new Set<string>();
    const picks = items.filter((i) => !seen.has(i.settingTags[0]) && seen.add(i.settingTags[0]));
    return {
      picks: picks.slice(0, 5).map((i) => ({ id: i.id, reason: `Best-scoring ${i.settingTags[0]} idea.` })),
    };
  }
  throw new Error(`no mock for AI task "${name}"`);
};
