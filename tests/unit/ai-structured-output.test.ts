import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Mock openai-helpers to control parseAIJson behavior
vi.mock('../../server/openai-helpers.js', () => ({
  parseAIJson: vi.fn((raw: string) => {
    // Replicate the real behavior: JSON.parse after stripping code fences
    const stripped = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(stripped);
  }),
}));

// Import after mock is set up
const { parseStructuredAIOutput, StructuredAIOutputError } = await import(
  '../../server/ai-structured-output.js'
);

describe('parseStructuredAIOutput', () => {
  const SimpleSchema = z.object({
    name: z.string(),
    count: z.number(),
  });

  it('parses valid JSON string against schema and returns typed data', () => {
    const raw = JSON.stringify({ name: 'test', count: 42 });
    const result = parseStructuredAIOutput(raw, SimpleSchema, 'test-context');
    expect(result).toEqual({ name: 'test', count: 42 });
  });

  it('parses JSON wrapped in code fences', () => {
    const raw = '```json\n{"name":"fenced","count":7}\n```';
    const result = parseStructuredAIOutput(raw, SimpleSchema, 'test-context');
    expect(result).toEqual({ name: 'fenced', count: 7 });
  });

  it('throws StructuredAIOutputError when raw is not valid JSON', () => {
    expect(() =>
      parseStructuredAIOutput('not json at all', SimpleSchema, 'bad-json')
    ).toThrowError(StructuredAIOutputError);
  });

  it('thrown error has the correct name', () => {
    try {
      parseStructuredAIOutput('{{invalid}}', SimpleSchema, 'ctx');
    } catch (err) {
      expect(err).toBeInstanceOf(StructuredAIOutputError);
      expect((err as StructuredAIOutputError).name).toBe('StructuredAIOutputError');
    }
  });

  it('throws StructuredAIOutputError when JSON does not match schema', () => {
    const raw = JSON.stringify({ name: 123, count: 'not-a-number' });
    expect(() =>
      parseStructuredAIOutput(raw, SimpleSchema, 'type-mismatch')
    ).toThrowError(StructuredAIOutputError);
  });

  it('includes Zod issues in the error when schema validation fails', () => {
    const raw = JSON.stringify({ name: 123, count: 'not-a-number' });
    let caughtError: StructuredAIOutputError | undefined;
    try {
      parseStructuredAIOutput(raw, SimpleSchema, 'issues-context');
    } catch (err) {
      caughtError = err as StructuredAIOutputError;
    }
    expect(caughtError).toBeDefined();
    expect(caughtError?.issues).toBeDefined();
    expect(Array.isArray(caughtError?.issues)).toBe(true);
    expect(caughtError!.issues!.length).toBeGreaterThan(0);
  });

  it('error message includes the context string', () => {
    const raw = JSON.stringify({ wrong: 'shape' });
    try {
      parseStructuredAIOutput(raw, SimpleSchema, 'my-feature-context');
    } catch (err) {
      expect((err as Error).message).toContain('my-feature-context');
    }
  });

  it('works with array schema', () => {
    const ArraySchema = z.array(z.string());
    const raw = JSON.stringify(['a', 'b', 'c']);
    const result = parseStructuredAIOutput(raw, ArraySchema, 'array-context');
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('works with nested object schema', () => {
    const NestedSchema = z.object({
      meta: z.object({ version: z.number() }),
      items: z.array(z.string()),
    });
    const raw = JSON.stringify({ meta: { version: 2 }, items: ['x', 'y'] });
    const result = parseStructuredAIOutput(raw, NestedSchema, 'nested-context');
    expect(result).toEqual({ meta: { version: 2 }, items: ['x', 'y'] });
  });
});

describe('StructuredAIOutputError', () => {
  it('is an instance of Error', () => {
    const err = new StructuredAIOutputError('ctx');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name set to StructuredAIOutputError', () => {
    const err = new StructuredAIOutputError('ctx');
    expect(err.name).toBe('StructuredAIOutputError');
  });

  it('message includes the context', () => {
    const err = new StructuredAIOutputError('my-context');
    expect(err.message).toContain('my-context');
  });

  it('issues is undefined when not provided', () => {
    const err = new StructuredAIOutputError('ctx');
    expect(err.issues).toBeUndefined();
  });

  it('issues is defined when provided', () => {
    const mockIssues = [{ code: 'invalid_type', message: 'bad', path: [] }] as z.ZodIssue[];
    const err = new StructuredAIOutputError('ctx', mockIssues);
    expect(err.issues).toEqual(mockIssues);
  });
});
