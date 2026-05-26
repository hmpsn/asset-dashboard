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
});
