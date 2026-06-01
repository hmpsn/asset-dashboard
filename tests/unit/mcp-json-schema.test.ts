import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toMcpJsonSchema } from '../../server/mcp/json-schema.js';

describe('toMcpJsonSchema', () => {
  it('returns object schemas without $schema metadata', () => {
    const schema = z.object({
      topic: z.string(),
      count: z.number().int().optional(),
    });

    const result = toMcpJsonSchema(schema);
    expect(result.type).toBe('object');
    expect(Object.prototype.hasOwnProperty.call(result, '$schema')).toBe(false);
    expect(result.properties).toBeDefined();
  });

  it('preserves explicit primitive schema types', () => {
    const stringSchema = toMcpJsonSchema(z.string().min(1));
    expect(stringSchema.type).toBe('string');
  });

  it('adds object type when schema has no explicit type', () => {
    const anySchema = toMcpJsonSchema(z.any());
    expect(anySchema.type).toBe('object');
  });

  it('hoists top-level properties for union object schemas', () => {
    const unionSchema = z.union([
      z.object({
        workspace_id: z.string(),
        mode: z.literal('patch'),
        updates: z.object({ title: z.string() }),
      }),
      z.object({
        workspace_id: z.string(),
        mode: z.literal('replace'),
        content: z.object({ title: z.string() }),
      }),
    ]);

    const result = toMcpJsonSchema(unionSchema);
    expect(result.type).toBe('object');
    expect(result.properties).toBeDefined();
    const properties = result.properties as Record<string, unknown>;
    expect(properties.workspace_id).toBeDefined();
    expect(properties.mode).toBeDefined();
    expect(properties.updates).toBeDefined();
    expect(properties.content).toBeDefined();
  });
});
