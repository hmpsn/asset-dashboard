/**
 * Lightweight JSON parser for AI response text.
 *
 * Strips markdown code fences then JSON.parses.
 * Used by ai-*.ts schema modules so they don't need to import the
 * heavyweight openai-helpers.ts (which has file-system side effects
 * at module load time that break vitest mocks for helpers.js).
 */
export function parseAIJsonRaw<T = unknown>(raw: string): T {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(stripped) as T;
  } catch { // catch-ok: JSON.parse failure is expected for malformed AI responses; re-thrown with cleaner message
    throw new Error('Failed to parse AI response as JSON');
  }
}
