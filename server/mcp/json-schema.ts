import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function mergeBranchProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const branchKeys = ['anyOf', 'oneOf', 'allOf'] as const;
  const mergedProperties: Record<string, unknown> = {};
  const branchRequiredLists: string[][] = [];

  for (const key of branchKeys) {
    const rawBranches = schema[key];
    if (!Array.isArray(rawBranches)) continue;
    for (const rawBranch of rawBranches) {
      const branch = toRecord(rawBranch);
      if (!branch) continue;
      const branchProperties = toRecord(branch.properties);
      if (!branchProperties) continue;
      for (const [propName, propSchema] of Object.entries(branchProperties)) {
        if (!(propName in mergedProperties)) {
          mergedProperties[propName] = propSchema;
        }
      }
      const branchRequired = toStringArray(branch.required);
      if (branchRequired.length > 0) {
        branchRequiredLists.push(branchRequired);
      }
    }
  }

  if (Object.keys(mergedProperties).length === 0) return schema;
  if (!('properties' in schema)) {
    schema.properties = mergedProperties;
  }
  if (!('required' in schema) && branchRequiredLists.length > 0) {
    const commonRequired = branchRequiredLists.reduce<string[]>(
      (acc, list) => acc.filter(item => list.includes(item)),
      [...branchRequiredLists[0]],
    );
    if (commonRequired.length > 0) {
      schema.required = commonRequired;
    }
  }
  return schema;
}

export function toMcpJsonSchema(schema: ZodTypeAny): { type: 'object'; [key: string]: unknown } {
  const raw = zodToJsonSchema(schema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  const normalized = ('$schema' in raw)
    ? (() => {
      const { $schema: _drop, ...rest } = raw;
      return rest;
    })()
    : raw;

  if (normalized.type === 'object') {
    return mergeBranchProperties(normalized) as { type: 'object'; [key: string]: unknown };
  }

  const wrapped = { type: 'object', ...normalized };
  return mergeBranchProperties(wrapped) as { type: 'object'; [key: string]: unknown };
}

const SCHEMA_MAP_KEYWORDS = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
]);

const SCHEMA_ARRAY_KEYWORDS = new Set([
  'allOf',
  'anyOf',
  'oneOf',
  'prefixItems',
]);

const SCHEMA_VALUE_KEYWORDS = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
]);

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneJsonValue(child)]),
  );
}

function transformSchemaChildren(
  node: Record<string, unknown>,
  transform: (child: unknown) => unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (SCHEMA_MAP_KEYWORDS.has(key)) {
      const map = toRecord(value);
      result[key] = map
        ? Object.fromEntries(
          Object.entries(map).map(([name, child]) => [name, transform(child)]),
        )
        : cloneJsonValue(value);
      continue;
    }
    if (SCHEMA_ARRAY_KEYWORDS.has(key)) {
      result[key] = Array.isArray(value)
        ? value.map(transform)
        : cloneJsonValue(value);
      continue;
    }
    if (SCHEMA_VALUE_KEYWORDS.has(key)) {
      result[key] = Array.isArray(value)
        ? value.map(transform)
        : transform(value);
      continue;
    }
    if (key === 'dependencies') {
      const dependencies = toRecord(value);
      result[key] = dependencies
        ? Object.fromEntries(
          Object.entries(dependencies).map(([name, schemaOrNames]) => [
            name,
            Array.isArray(schemaOrNames)
              ? cloneJsonValue(schemaOrNames)
              : transform(schemaOrNames),
          ]),
        )
        : cloneJsonValue(value);
      continue;
    }
    result[key] = cloneJsonValue(value);
  }
  return result;
}

function visitSchemaChildren(
  node: Record<string, unknown>,
  visit: (child: unknown) => void,
): void {
  transformSchemaChildren(node, child => {
    visit(child);
    return child;
  });
}

function collectRepeatedSchemaNodes(
  value: unknown,
  counts: Map<string, { count: number; node: Record<string, unknown> }>,
  isRoot = true,
): void {
  const node = toRecord(value);
  if (!node) return;

  if (!isRoot && !('$ref' in node)) {
    const serialized = JSON.stringify(node);
    const prior = counts.get(serialized);
    counts.set(serialized, {
      count: (prior?.count ?? 0) + 1,
      node: prior?.node ?? node,
    });
  }

  visitSchemaChildren(node, child => collectRepeatedSchemaNodes(child, counts, false));
}

function replaceSchemaOccurrences(
  value: unknown,
  target: string,
  ref: string,
  isRoot = true,
): unknown {
  const node = toRecord(value);
  if (!node) return cloneJsonValue(value);
  if (!isRoot && JSON.stringify(node) === target) return { $ref: ref };
  return transformSchemaChildren(
    node,
    child => replaceSchemaOccurrences(child, target, ref, false),
  );
}

function nextDefinitionName(schema: Record<string, unknown>, index: number): string {
  const definitions = toRecord(schema.definitions);
  let candidateIndex = index;
  while (true) {
    const candidate = `d${candidateIndex.toString(36)}`;
    if (!definitions || !(candidate in definitions)) return candidate;
    candidateIndex += 1;
  }
}

/**
 * Deduplicate identical JSON Schema subtrees without removing validation data.
 *
 * Every repeated node is moved unchanged into a draft-07 `definitions` entry
 * with a short local `$id`; occurrences become standards-compatible `$ref`s. Candidates are
 * accepted only when the exact UTF-8 discovery representation becomes smaller.
 */
export function compactMcpJsonSchema<TSchema extends Record<string, unknown>>(
  schema: TSchema,
): TSchema {
  let compact = cloneJsonValue(schema) as TSchema;
  let definitionIndex = 0;

  while (true) {
    const counts = new Map<string, { count: number; node: Record<string, unknown> }>();
    collectRepeatedSchemaNodes(compact, counts);
    const currentLength = Buffer.byteLength(JSON.stringify(compact), 'utf8');
    let best: { schema: TSchema; length: number } | undefined;

    for (const [serialized, candidate] of counts) {
      if (candidate.count < 2) continue;
      const definitionName = nextDefinitionName(compact, definitionIndex);
      const ref = definitionName;
      const replaced = replaceSchemaOccurrences(compact, serialized, ref) as TSchema;
      const existingDefinitions = toRecord(replaced.definitions) ?? {};
      const projected = {
        ...replaced,
        definitions: {
          ...existingDefinitions,
          [definitionName]: {
            ...cloneJsonValue(candidate.node) as Record<string, unknown>,
            $id: definitionName,
          },
        },
      } as TSchema;
      const projectedLength = Buffer.byteLength(JSON.stringify(projected), 'utf8');
      if (projectedLength >= currentLength) continue;
      if (!best || projectedLength < best.length) {
        best = { schema: projected, length: projectedLength };
      }
    }

    if (!best) return compact;
    compact = best.schema;
    definitionIndex += 1;
  }
}

/**
 * Lossless discovery projection for large structured read models.
 *
 * The result retains every generated validation keyword and path. Only exact
 * repeated subtrees are represented once through local definitions and refs.
 */
export function toMcpCompactOutputSchema(
  schema: ZodTypeAny,
): { type: 'object'; [key: string]: unknown } {
  return compactMcpJsonSchema(toMcpJsonSchema(schema)) as {
    type: 'object';
    [key: string]: unknown;
  };
}
