// Loads the versioned prompts in tools/event/prompts/theme/ (#59).
import { join } from 'node:path';

export const PROMPT_DIR = join(import.meta.dir, '..', '..', 'prompts', 'theme');

const FILES = {
  styleGuide: 'style-guide.md',
  look: 'look.md',
  props: 'props.md',
  qa: 'qa.md',
  readability: 'readability.md',
  skybox: 'image-skybox.md',
  texture: 'image-texture.md',
  sprite: 'image-sprite.md',
  signage: 'image-signage.md',
  card: 'image-card.md',
} as const;

export type Prompts = Record<keyof typeof FILES, string>;

export async function loadPrompts(dir: string = PROMPT_DIR): Promise<Prompts> {
  const entries = await Promise.all(
    Object.entries(FILES).map(async ([key, file]) => {
      // Normalised line endings keep cache keys equal on Windows and Linux checkouts.
      const content = await Bun.file(join(dir, file)).text();
      return [key, content.replace(/\r\n/g, '\n').trim()];
    }),
  );
  return Object.fromEntries(entries) as Prompts;
}

/** Replace `{{name}}` placeholders. */
export const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
