import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  zodToJsonSchema: vi.fn(),
}));

vi.mock('zod-to-json-schema', () => ({
  zodToJsonSchema: h.zodToJsonSchema,
}));

import { toMcpJsonSchema } from '../../server/mcp/json-schema.js';

describe('toMcpJsonSchema branch behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('coerces $schema primitives into object-shaped schema', () => {
    h.zodToJsonSchema.mockReturnValueOnce({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'string',
      minLength: 1,
    });
    const result = toMcpJsonSchema({} as never);
    expect(result.type).toBe('string');
    expect(result.minLength).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(result, '$schema')).toBe(false);
  });

  it('passes through plain object schemas when no $schema key is present', () => {
    h.zodToJsonSchema.mockReturnValueOnce({ type: 'object', properties: { a: { type: 'string' } } });
    const result = toMcpJsonSchema({} as never);
    expect(result).toEqual({ type: 'object', properties: { a: { type: 'string' } } });
  });

  it('adds object type to schemata with no explicit type', () => {
    h.zodToJsonSchema.mockReturnValueOnce({ oneOf: [{ type: 'string' }, { type: 'number' }] });
    const result = toMcpJsonSchema({} as never);
    expect(result.type).toBe('object');
    expect(result.oneOf).toBeDefined();
  });
});
