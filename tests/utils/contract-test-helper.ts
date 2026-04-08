import { expect } from 'vitest';
import { type ZodType } from 'zod';

/**
 * Asserts that a JSON response body matches a Zod schema.
 * Use in integration tests after calling an endpoint.
 */
export function assertResponseShape<T>(
  responseBody: unknown,
  schema: ZodType<T>,
  context?: string,
): T {
  const result = schema.safeParse(responseBody);
  if (!result.success) {
    const issues = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    expect.fail(
      `Response shape mismatch${context ? ` for ${context}` : ''}:\n${issues}\n\nReceived: ${JSON.stringify(responseBody, null, 2).slice(0, 500)}`
    );
  }
  return result.data;
}

/**
 * Asserts that every field declared as required in the schema
 * is present AND non-null/non-undefined in the response.
 * Catches FM-1: fields that exist in the type but are never populated.
 */
export function assertFieldsPopulated(
  responseBody: Record<string, unknown>,
  requiredFields: string[],
  context?: string,
): void {
  const missing: string[] = [];
  const nullish: string[] = [];
  for (const field of requiredFields) {
    if (!(field in responseBody)) {
      missing.push(field);
    } else if (responseBody[field] == null) {
      nullish.push(field);
    }
  }
  if (missing.length > 0 || nullish.length > 0) {
    const parts: string[] = [];
    if (missing.length) parts.push(`Missing: ${missing.join(', ')}`);
    if (nullish.length) parts.push(`Null/undefined: ${nullish.join(', ')}`);
    expect.fail(
      `Fields not populated${context ? ` for ${context}` : ''}:\n${parts.join('\n')}`
    );
  }
}

/**
 * Asserts that an array is non-empty before running .every() or .some(). // every-ok
 * Prevents FM-7: vacuous assertions.
 */
export function assertNonEmptyEvery<T>(
  arr: T[],
  predicate: (item: T) => boolean,
  context?: string,
): void {
  expect(arr.length, `Array should be non-empty${context ? ` (${context})` : ''}`).toBeGreaterThan(0);
  expect(arr.every(predicate), `Not all items match predicate${context ? ` (${context})` : ''}`).toBe(true); // every-ok: length checked on preceding line
}
