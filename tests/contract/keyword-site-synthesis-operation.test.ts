/**
 * F1 (#6) — keyword-site-synthesis operation contract.
 *
 * The site-level synthesis call (siteKeywords, opportunities, contentGaps,
 * quickWins) is the highest-leverage AI call in the platform. This contract pins
 * the upgraded model allocation (gpt-5.4) and asserts the schema-validation +
 * execution contract stays intact after the upgrade — the closed-set pool + Zod
 * validation + background-only execution must not regress.
 *
 * Deterministic registry assertion: no server port allocated.
 */
import { describe, expect, it } from 'vitest';
import { getAIOperationContract } from '../../server/ai-operation-registry.js';

describe('keyword-site-synthesis operation contract', () => {
  const contract = getAIOperationContract('keyword-site-synthesis');

  it('runs on the gpt-5.4 model tier (upgraded from gpt-5.4-mini)', () => {
    expect(contract.defaultModel).toBe('gpt-5.4');
  });

  it('keeps the long timeout profile appropriate for the bigger model', () => {
    expect(contract.timeoutProfile).toBe('long');
    expect(contract.defaultTimeoutMs).toBe(90_000);
  });

  it('stays background-only (runs inside the generation job, never sync)', () => {
    expect(contract.executionMode).toBe('background-only');
  });

  it('preserves the JSON schema-validation contract', () => {
    expect(contract.outputMode).toBe('json');
    expect(contract.defaultResponseFormat).toEqual({ type: 'json_object' });
    expect(contract.researchMode).toBe('required');
    expect(contract.defaultMaxRetries).toBe(3);
    expect(contract.providerIntent).toBe('openai');
  });
});
