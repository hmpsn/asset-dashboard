import type { AiReliabilityScenarioAssertion } from '../shared/types/ai-reliability.js';

/** Normalize source evidence so harmless formatting changes do not invalidate a fixture. */
export function normalizeAiEvidence(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|\n)\s*(?:\/\/+|\/\*+|\*\/|\*)\s?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Evaluate one deterministic registry assertion against normalized source evidence. */
export function aiEvidenceMatchesAssertion(
  source: string,
  assertion: AiReliabilityScenarioAssertion,
): boolean {
  const normalizedSource = normalizeAiEvidence(source);
  const includes = (token: string) => normalizedSource.includes(normalizeAiEvidence(token));
  const allOfOk = (assertion.allOf ?? []).every(includes);
  const anyOf = assertion.anyOf ?? [];
  const anyOfOk = anyOf.length === 0 || anyOf.some(includes);
  const noneOfOk = (assertion.noneOf ?? []).every(token => !includes(token));
  return allOfOk && anyOfOk && noneOfOk;
}
