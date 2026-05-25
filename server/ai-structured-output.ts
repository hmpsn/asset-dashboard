import { z } from 'zod';
import { parseAIJson } from './openai-helpers.js';

export class StructuredAIOutputError extends Error {
  readonly issues?: z.ZodIssue[];

  constructor(context: string, issues?: z.ZodIssue[]) {
    super(`Failed to parse AI structured output (${context})`);
    this.name = 'StructuredAIOutputError';
    this.issues = issues;
  }
}

export function parseStructuredAIOutput<T>(
  raw: string,
  schema: z.ZodType<T>,
  context: string,
): T {
  let parsed: unknown;
  try {
    parsed = parseAIJson<unknown>(raw);
  } catch (err) {
    void err;
    throw new StructuredAIOutputError(context);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StructuredAIOutputError(context, result.error.issues);
  }
  return result.data;
}
