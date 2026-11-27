// Zod -> strict-mode JSON Schema for OpenRouter structured outputs. Owned by #22.
//
// Strict providers require every object to have `additionalProperties: false` and every property listed in
// `required`. Optional fields therefore become required-but-nullable, and `restoreOptionals` turns those nulls
// back into missing keys before the Zod schema re-validates the model's answer.
import { z } from 'zod';

export type JsonSchema = { [key: string]: unknown };

/** Keywords strict providers reject or that mean nothing to a generator. */
const DROPPED_KEYWORDS = new Set(['$schema', '$id', 'default', 'examples', 'readOnly', 'writeOnly']);

const isObject = (v: unknown): v is JsonSchema => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The JSON Schema Zod would accept as input, before strict-mode rewriting. */
export function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'throw' }) as JsonSchema;
}

/** A Zod schema as a strict-mode JSON Schema: closed objects, all properties required, optional = nullable. */
export function toStrictJsonSchema(schema: z.ZodType): JsonSchema {
  return strictJsonSchema(zodToJsonSchema(schema));
}

/** Strict-mode rewrite of a plain JSON Schema (see toStrictJsonSchema). Does not mutate its input. */
export function strictJsonSchema(schema: JsonSchema): JsonSchema {
  return strictify(schema);
}

function allowsNull(s: unknown): boolean {
  if (!isObject(s)) return false;
  if (s.type === 'null' || (Array.isArray(s.type) && s.type.includes('null'))) return true;
  if (s.const === null) return true;
  if (Array.isArray(s.enum) && s.enum.includes(null)) return true;
  const branches = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  return Array.isArray(branches) && branches.some(allowsNull);
}

function strictify(node: unknown): JsonSchema {
  if (!isObject(node)) return {};
  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYWORDS.has(key)) continue;
    out[key] = value;
  }

  // Tuples (prefixItems) are not accepted by every strict provider: send a fixed-length array of the item union.
  if (Array.isArray(out.prefixItems)) {
    const items = (out.prefixItems as unknown[]).map(strictify);
    const distinct = dedupe(items);
    out.items = distinct.length === 1 ? distinct[0] : { anyOf: distinct };
    out.minItems = items.length;
    out.maxItems = items.length;
    delete out.prefixItems;
  } else if (isObject(out.items)) {
    out.items = strictify(out.items);
  }

  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(out[key])) out[key] = (out[key] as unknown[]).map(strictify);
  }

  const isObjectType = out.type === 'object' || isObject(out.properties);
  if (isObjectType) {
    if (!out.properties && isObject(out.additionalProperties) && Object.keys(out.additionalProperties).length) {
      throw new Error('strict JSON schema cannot express z.record(); use an array of { key, value } objects');
    }
    const props = isObject(out.properties) ? out.properties : {};
    const required = new Set(Array.isArray(out.required) ? (out.required as string[]) : []);
    const nextProps: JsonSchema = {};
    for (const [name, prop] of Object.entries(props)) {
      const strictProp = strictify(prop);
      nextProps[name] = required.has(name) || allowsNull(strictProp) ? strictProp : nullable(strictProp);
    }
    out.type = 'object';
    out.properties = nextProps;
    out.required = Object.keys(nextProps);
    out.additionalProperties = false;
  }
  return out;
}

function nullable(s: JsonSchema): JsonSchema {
  const { description, ...rest } = s;
  const out: JsonSchema = { anyOf: [rest, { type: 'null' }] };
  if (description !== undefined) out.description = description;
  return out;
}

function dedupe(list: JsonSchema[]): JsonSchema[] {
  const seen = new Map<string, JsonSchema>();
  for (const item of list) seen.set(JSON.stringify(item), item);
  return [...seen.values()];
}

/**
 * Undo the strict-mode rewrite on model output: drop `null` values for properties that are optional (and not
 * nullable) in the original schema, so Zod sees them as missing. Mutates and returns `data`.
 */
export function restoreOptionals(data: unknown, original: JsonSchema): unknown {
  walk(data, original);
  return data;
}

function walk(data: unknown, schema: unknown): void {
  if (!isObject(schema) || data === null || typeof data !== 'object') return;

  // Unions first: a nullable array or object is an anyOf wrapping the real schema.
  const branches = (schema.anyOf ?? schema.oneOf) as unknown[] | undefined;
  if (Array.isArray(branches)) {
    for (const branch of branches) if (matchesDiscriminator(data as JsonSchema, branch)) walk(data, branch);
    return;
  }

  if (Array.isArray(data)) {
    const prefix = Array.isArray(schema.prefixItems) ? (schema.prefixItems as unknown[]) : null;
    data.forEach((item, i) => walk(item, prefix ? prefix[i] : schema.items));
    return;
  }

  if (!isObject(schema.properties)) return;
  const record = data as JsonSchema;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  for (const [name, prop] of Object.entries(schema.properties)) {
    if (record[name] === null && !required.has(name) && !allowsNull(prop)) delete record[name];
    else walk(record[name], prop);
  }
}

/** For union branches: an object branch matches unless one of its `const` properties disagrees with the data. */
function matchesDiscriminator(data: JsonSchema, branch: unknown): boolean {
  if (!isObject(branch) || !isObject(branch.properties)) return isObject(branch);
  for (const [name, prop] of Object.entries(branch.properties)) {
    if (isObject(prop) && 'const' in prop && name in data && data[name] !== prop.const) return false;
  }
  return true;
}
