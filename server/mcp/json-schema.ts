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

function compactOutputNode(
  value: unknown,
  depth: number,
): Record<string, unknown> {
  const node = toRecord(value) ?? {};
  const compact: Record<string, unknown> = {};

  for (const key of ['type', 'enum', 'const', 'minimum', 'maximum', 'minItems', 'maxItems']) {
    if (key in node) compact[key] = node[key];
  }

  for (const unionKey of ['anyOf', 'oneOf'] as const) {
    if (Array.isArray(node[unionKey])) {
      compact[unionKey] = node[unionKey].map(branch => compactOutputNode(branch, depth));
    }
  }

  const properties = toRecord(node.properties);
  if (properties && depth > 0) {
    compact.properties = Object.fromEntries(
      Object.entries(properties).map(([name, child]) => [
        name,
        compactOutputNode(child, depth - 1),
      ]),
    );
    const required = toStringArray(node.required);
    if (required.length > 0) compact.required = required;
    if (typeof node.additionalProperties === 'boolean') {
      compact.additionalProperties = node.additionalProperties;
    }
  }

  if (node.items !== undefined) {
    compact.items = compactOutputNode(node.items, Math.max(0, depth - 1));
  }
  return compact;
}

/**
 * Compact discovery projection for large structured read models.
 *
 * The canonical Zod schema still validates the complete result before dispatch.
 * Discovery retains the strict `{ data: ... }` root plus data-field names, types,
 * enums, bounds, and one nested field level without repeating deep item schemas.
 */
export function toMcpCompactOutputSchema(
  schema: ZodTypeAny,
): { type: 'object'; [key: string]: unknown } {
  return compactOutputNode(toMcpJsonSchema(schema), 3) as {
    type: 'object';
    [key: string]: unknown;
  };
}
