// Output file helpers. Owned by #56, shared with #59 and #63.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** tools/event/out (gitignored). */
export const DEFAULT_OUT_DIR = join(import.meta.dir, '..', '..', 'out');

/** Write text, creating parent folders. */
export async function writeText(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** Write pretty JSON with a trailing newline, creating parent folders. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}
