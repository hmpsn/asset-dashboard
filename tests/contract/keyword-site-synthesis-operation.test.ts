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
import { getAIOperationPolicyMetadata, getAIOperationRuntimeDefaults } from '../../server/ai-operation-registry.js';

describe('keyword-site-synthesis operation contract', () => {
  const policy = getAIOperationPolicyMetadata('keyword-site-synthesis');
  const runtimeDefaults = getAIOperationRuntimeDefaults('keyword-site-synthesis');

  it('runs on the gpt-5.4 model tier (upgraded from gpt-5.4-mini)', () => {
    expect(runtimeDefaults.defaultModel).toBe('gpt-5.4');
  });

  it('keeps the long timeout profile appropriate for the bigger model', () => {
    expect(policy.timeoutProfile).toBe('long');
    expect(runtimeDefaults.defaultTimeoutMs).toBe(90_000);
  });

  it('stays background-only (runs inside the generation job, never sync)', () => {
    expect(policy.executionMode).toBe('background-only');
  });

  it('preserves the JSON schema-validation contract', () => {
    expect(policy.outputMode).toBe('json');
    expect(runtimeDefaults.defaultResponseFormat).toEqual({ type: 'json_object' });
    expect(policy.researchMode).toBe('required');
    expect(runtimeDefaults.defaultMaxRetries).toBe(3);
    expect(policy.providerIntent).toBe('openai');
  });
});
