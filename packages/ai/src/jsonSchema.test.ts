import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { SkinDefSchema } from '@wobble/shared/schemas/packs';
import { restoreOptionals, toStrictJsonSchema, zodToJsonSchema } from './jsonSchema.ts';
import type { JsonSchema } from './jsonSchema.ts';

/** Every object node must be closed and list all its properties as required. */
function assertStrict(node: unknown, path = '$'): void {
  if (typeof node !== 'object' || node === null) return;
  if (Array.isArray(node)) return node.forEach((n, i) => assertStrict(n, `${path}[${i}]`));
  const s = node as JsonSchema;
  expect(s.$schema).toBeUndefined();
  expect(s.default).toBeUndefined();
  expect(s.prefixItems).toBeUndefined();
  if (s.type === 'object') {
    expect(s.additionalProperties).toBe(false);
    expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort());
  }
  for (const [k, v] of Object.entries(s)) assertStrict(v, `${path}.${k}`);
}

describe('toStrictJsonSchema', () => {
  const schema = z.object({
    a: z.string().optional(),
    b: z.number().default(3),
    n: z.string().nullable(),
    t: z.tuple([z.number(), z.number()]),
    nested: z.object({ x: z.number(), y: z.boolean().optional() }),
    list: z.array(z.object({ k: z.enum(['p', 'q']), v: z.number().optional() })),
  });

  test('closes objects, requires every property, makes optionals nullable', () => {
    const strict = toStrictJsonSchema(schema);
    assertStrict(strict);
    const props = strict.properties as Record<string, JsonSchema>;
    expect(props.a).toEqual({ anyOf: [{ type: 'string' }, { type: 'null' }] });
    expect(props.b).toEqual({ anyOf: [{ type: 'number' }, { type: 'null' }] });
    expect(props.n).toEqual({ type: ['string', 'null'] }); // already nullable: unchanged
  });

  test('tuples become fixed-length arrays', () => {
    const t = (toStrictJsonSchema(schema).properties as Record<string, JsonSchema>).t;
    expect(t).toMatchObject({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 });
  });

  test('the real SkinDef schema is strict all the way down', () => {
    assertStrict(toStrictJsonSchema(SkinDefSchema));
  });

  test('restoreOptionals drops nulls for optional fields only, then Zod accepts', () => {
    const original = zodToJsonSchema(schema);
    const fromModel = {
      a: null,
      b: null,
      n: null,
      t: [1, 2],
      nested: { x: 1, y: null },
      list: [{ k: 'p', v: null }],
    };
    const restored = restoreOptionals(fromModel, original);
    expect(restored).toEqual({ n: null, t: [1, 2], nested: { x: 1 }, list: [{ k: 'p' }] });
    expect(schema.parse(restored)).toMatchObject({ b: 3, n: null });
  });
});
