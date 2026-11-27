// The four model calls of character pregeneration (#63), over #56's EventAi (cache + budget),
// plus the mock responder that answers them offline.
import { SkinDefSchema } from '@wobble/shared/schemas/packs';
import type { SkinDef } from '@wobble/shared';
import type { EventAi, MockResponder } from '../lib/ai.ts';
import { buildSkin, poolTraits } from './build.ts';
import { finalizeScreen, mockScreen, preScreen } from './screen.ts';
import { PoolBatchSchema, ScreenSchema } from './types.ts';
import type { CastRole, Screen, ThemeInput, Traits } from './types.ts';

const PROMPT_DIR = new URL('../../prompts/character/', import.meta.url);
const prompts = new Map<string, string>();

async function system(name: 'screen' | 'fuse' | 'pool' | 'cast'): Promise<string> {
  let text = prompts.get(name);
  if (!text) {
    text = await Bun.file(new URL(`${name}.md`, PROMPT_DIR)).text();
    prompts.set(name, text);
  }
  return text;
}

function themeData(theme: ThemeInput) {
  const { title, tagline, costume } = theme.def;
  return { title, tagline, costume };
}

/** First word of the theme title, for names: "Sherbet Sky" -> "Sherbet". */
export function themeWord(theme: ThemeInput): string {
  return theme.def.title.split(/\s+/)[0] ?? theme.def.title;
}

export async function screenCharacter(ai: EventAi, characterIdea: string): Promise<Screen> {
  const pre = preScreen(characterIdea);
  if (pre) return pre;
  const res = await ai.object({
    role: 'fast',
    name: 'character_screen',
    system: await system('screen'),
    input: { characterIdea },
    schema: ScreenSchema,
    maxTokens: 400,
  });
  return finalizeScreen(res.data);
}

export interface FuseInput {
  theme: ThemeInput;
  description: string;
  traits: Traits;
  variation: number;
  avoidNames: string[];
}

export async function fuseCharacter(ai: EventAi, req: FuseInput): Promise<SkinDef> {
  const res = await ai.object({
    role: 'fast',
    name: 'character_fuse',
    system: await system('fuse'),
    input: {
      theme: themeData(req.theme),
      themeId: req.theme.id,
      character: { description: req.description, traits: req.traits },
      avoidNames: req.avoidNames.slice(-40),
      variation: req.variation,
    },
    schema: SkinDefSchema,
    maxTokens: 1500,
  });
  return res.data;
}

export async function poolBatch(
  ai: EventAi,
  req: { theme: ThemeInput; batch: number; count: number; variation: number; avoidNames: string[] },
): Promise<SkinDef[]> {
  const res = await ai.object({
    role: 'fast',
    name: 'character_pool',
    system: await system('pool'),
    input: {
      theme: themeData(req.theme),
      themeId: req.theme.id,
      count: req.count,
      batch: req.batch,
      avoidNames: req.avoidNames.slice(-60),
      variation: req.variation,
    },
    schema: PoolBatchSchema,
    maxTokens: 8000,
  });
  return res.data.characters;
}

export async function castCharacter(
  ai: EventAi,
  req: { theme: ThemeInput; role: CastRole; name: string; description: string; variation: number },
): Promise<SkinDef> {
  const res = await ai.object({
    role: 'fast',
    name: 'character_cast',
    system: await system('cast'),
    input: {
      theme: themeData(req.theme),
      themeId: req.theme.id,
      role: req.role,
      name: req.name,
      description: req.description,
      variation: req.variation,
    },
    schema: SkinDefSchema,
    maxTokens: 1500,
  });
  return res.data;
}

type Json = Record<string, unknown>;
type ThemeData = ReturnType<typeof themeData>;

/** Deterministic answers for --mock / WOBBLE_AI_MOCK=1, built from the same inputs the model sees. */
export const characterMockResponder: MockResponder = (name, raw) => {
  const input = raw as Json;
  const theme = input.theme as ThemeData;
  const word = theme ? (theme.title.split(/\s+/)[0] ?? theme.title) : '';
  const seed = `${String(input.themeId)}|${String(input.variation)}`;
  switch (name) {
    case 'character_screen':
      return mockScreen(String(input.characterIdea));
    case 'character_fuse': {
      const c = input.character as { description: string; traits: Traits };
      return buildSkin({ seed: `${seed}|${c.description}`, traits: c.traits, costume: theme.costume, themeWord: word });
    }
    case 'character_pool': {
      const count = Number(input.count);
      return {
        characters: Array.from({ length: count }, (_, i) => {
          const s = `${seed}|pool|${String(input.batch)}|${i}`;
          return buildSkin({ seed: s, traits: poolTraits(s, theme.costume), costume: theme.costume, themeWord: word });
        }),
      };
    }
    case 'character_cast': {
      const role = input.role as CastRole;
      const s = `${seed}|${role}`;
      const traits: Traits =
        role === 'hero'
          ? {
              colors: [theme.costume.palette[0]!],
              motifs: ['cape', 'star'],
              vibe: 'brave',
              silhouette: 'tall and thin',
            }
          : { colors: ['#3a2a4a'], motifs: ['horns', 'spikes'], vibe: 'grumpy', silhouette: 'big' };
      return buildSkin({ seed: s, traits, costume: theme.costume, themeWord: word, name: String(input.name) });
    }
    default:
      throw new Error(`no character mock for ${name}`);
  }
};
