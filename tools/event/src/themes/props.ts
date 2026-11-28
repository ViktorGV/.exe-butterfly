// Props art direction in small focused calls (#59). One call that asked for every obstacle part, landmark
// and costume piece at once came back nearly empty (a model answers a huge schema with the minimum), so the
// props are drafted in pieces that run in parallel: dressing in batches of obstacle kinds, scenery
// (landmarks and decor) and the costume kit. A piece that fails or under-delivers is asked once more with
// what was missing, then falls back to the procedural piece. Pieces are cached independently.
import { z } from 'zod';
import { isFatal } from './ai.ts';
import type { ThemeAi } from './ai.ts';
import { PropsDraftSchema } from './draft.ts';
import type { PropsDraft } from './draft.ts';
import { dressableBriefs, type ObstacleBrief } from './obstacles.ts';
import { RULES } from './legibility.ts';

const DressingPiece = z.object({ dressing: PropsDraftSchema.shape.dressing });
const SceneryPiece = z.object({ landmarks: PropsDraftSchema.shape.landmarks, decor: PropsDraftSchema.shape.decor });
const CostumePiece = z.object({ costume: PropsDraftSchema.shape.costume });

/** About six parts per dressing call keeps each answer short enough to come back whole. */
const PARTS_PER_BATCH = 6;

export function dressingBatches(briefs: ObstacleBrief[] = dressableBriefs()): ObstacleBrief[][] {
  const batches: ObstacleBrief[][] = [];
  let current: ObstacleBrief[] = [];
  let parts = 0;
  for (const b of briefs) {
    if (parts > 0 && parts + b.parts.length > PARTS_PER_BATCH) {
      batches.push(current);
      current = [];
      parts = 0;
    }
    current.push(b);
    parts += b.parts.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export interface PropsOptions {
  ai: ThemeAi;
  system: string;
  /** pick brief and theme summary, shared by every piece */
  context: Record<string, unknown>;
  procedural: PropsDraft;
  fresh?: boolean;
  /** problems from the legibility check, for a repair round */
  problems?: string[];
  /** the previous answer, for a repair round */
  previous?: PropsDraft;
}

type Piece<T> = { name: string; task: string; schema: z.ZodType<T>; input: Record<string, unknown>; maxTokens: number };

/** Number of props calls in one draft: the dressing batches, scenery and costume. */
export const PROPS_PIECES = dressingBatches().length + 2;

export async function draftProps(opts: PropsOptions): Promise<{ data: PropsDraft; notes: string[]; failed: string[] }> {
  const notes: string[] = [];
  const failed: string[] = [];
  const repair = opts.problems ? { fixTheseProblems: opts.problems } : {};

  async function run<T>(piece: Piece<T>, enough: (v: T) => string | null, fallback: T): Promise<T> {
    const call = (input: Record<string, unknown>, name: string) =>
      opts.ai.object({
        name,
        system: opts.system,
        input: { ...opts.context, task: piece.task, ...repair, ...input },
        schema: piece.schema,
        maxTokens: piece.maxTokens,
        fresh: opts.fresh,
      });
    try {
      const first = (await call(piece.input, piece.name)).data;
      const short = enough(first);
      if (!short) return first;
      notes.push(`${piece.name}: ${short}, asked again`);
      const second = (await call({ ...piece.input, previousAnswer: first, tooLittle: short }, `${piece.name}-more`))
        .data;
      if (!enough(second)) return second;
      notes.push(`${piece.name}: still ${enough(second)}, using the procedural piece`);
    } catch (err) {
      if (isFatal(err)) throw err;
      notes.push(`${piece.name}: ${(err as Error).message}, using the procedural piece`);
    }
    failed.push(piece.name);
    return fallback;
  }

  const prev = opts.previous;
  const dressing = dressingBatches().map((batch, i) => {
    const keys = new Set(batch.flatMap((b) => b.parts.map((p) => `${b.kind}|${p.part}`)));
    const mine = (list: PropsDraft['dressing']) => list.filter((d) => keys.has(`${d.kind}|${d.part}`));
    return run(
      {
        name: `props-dressing-${i + 1}`,
        task: 'Answer ONLY `dressing`: one entry for every part of every obstacle in `obstacles` (no other kinds).',
        schema: DressingPiece,
        input: { obstacles: batch, ...(prev ? { previousAnswer: { dressing: mine(prev.dressing) } } : {}) },
        maxTokens: 9000,
      },
      (v) => {
        const got = mine(v.dressing);
        const plain = got.filter((d) => d.prims.length < RULES.dressingPrims).length;
        if (got.length < keys.size) return `dressed ${got.length} of ${keys.size} parts`;
        return plain ? `${plain} entries have fewer than ${RULES.dressingPrims} primitives` : null;
      },
      { dressing: mine(opts.procedural.dressing) },
    );
  });

  const scenery = run(
    {
      name: 'props-scenery',
      task: 'Answer ONLY `landmarks` and `decor`.',
      schema: SceneryPiece,
      input: prev ? { previousAnswer: { landmarks: prev.landmarks, decor: prev.decor } } : {},
      maxTokens: 9000,
    },
    (v) =>
      v.landmarks.length < RULES.landmarks
        ? `only ${v.landmarks.length} landmarks`
        : v.landmarks.some((l) => l.prims.length < 12)
          ? 'landmarks are too simple (fewer than 12 primitives)'
          : null,
    { landmarks: opts.procedural.landmarks, decor: opts.procedural.decor },
  );

  const costume = run(
    {
      name: 'props-costume',
      task: 'Answer ONLY `costume`.',
      schema: CostumePiece,
      input: prev ? { previousAnswer: { costume: prev.costume } } : {},
      maxTokens: 6000,
    },
    (v) =>
      v.costume.accessories.length < RULES.accessories
        ? `only ${v.costume.accessories.length} costume accessories`
        : null,
    { costume: opts.procedural.costume },
  );

  const [pieces, s, c] = await Promise.all([Promise.all(dressing), scenery, costume]);
  return {
    data: { dressing: pieces.flatMap((p) => p.dressing), ...s, ...c },
    notes,
    failed,
  };
}
