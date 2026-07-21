import { describe, expect, it } from 'vitest';
import { getAIOperationPolicyMetadata, getAIOperationRuntimeDefaults, isAIOperationId } from '../../server/ai-operation-registry.js';
import { MODEL_ROLES } from '../../server/model-manifest.js';

const structuredOperationIds = [
  'brandscript-import',
  'brandscript-complete',
  'voice-calibration',
  'voice-refinement',
  'discovery-extraction',
  'monthly-digest',
  'content-post-seo-meta',
  'content-matrix-item-audit',
  'content-matrix-item-revise',
  'content-matrix-set-audit',
  'content-post-unify',
  'voice-scoring',
  'voice-feedback-suggest',
  'intelligence-profile-autofill',
  'copy-generation',
  'copy-regeneration',
  'content-publish-field-mapping',
  'seo-metadata-variations',
  'seo-page-copy-set',
] as const;

describe('AI operation registry', () => {
  it('registers named structured-output operations with JSON defaults', () => {
    for (const id of structuredOperationIds) {
      expect(isAIOperationId(id)).toBe(true);
      const policy = getAIOperationPolicyMetadata(id);
      const runtimeDefaults = getAIOperationRuntimeDefaults(id);
      expect(policy.outputMode).toBe('json');
      if (policy.providerIntent === 'openai') {
        expect(runtimeDefaults.defaultResponseFormat).toEqual({ type: 'json_object' });
      }
    }
  });

  it('marks research-required operations explicitly', () => {
    expect(getAIOperationPolicyMetadata('content-post-unify').researchMode).toBe('required');
    expect(getAIOperationPolicyMetadata('content-post-seo-meta').researchMode).toBe('forbidden');
  });

  it('routes structured SEO copy operations through the canonical creative writer', () => {
    for (const id of ['seo-metadata-variations', 'seo-page-copy-set'] as const) {
      expect(isAIOperationId(id)).toBe(true);
      expect(getAIOperationPolicyMetadata(id)).toMatchObject({
        domain: 'seo-health',
        providerIntent: 'either',
        outputMode: 'json',
      });
      expect(getAIOperationRuntimeDefaults(id)).toMatchObject({
        defaultProvider: 'anthropic',
        defaultModel: MODEL_ROLES.creativeWriter,
      });
    }
    expect(getAIOperationPolicyMetadata('seo-metadata-variations').executionMode).toBe('sync-or-background');
    expect(getAIOperationPolicyMetadata('seo-page-copy-set').executionMode).toBe('sync-only');
    expect(getAIOperationRuntimeDefaults('seo-metadata-variations').feature).toBe('seo-rewrite');
    expect(getAIOperationRuntimeDefaults('seo-page-copy-set').feature).toBe('content-score');
  });

  it('defaults generation to inflight-only and requires explicit TTL opt-in', () => {
    expect(getAIOperationRuntimeDefaults('content-brief-regenerate').cachePolicy).toEqual({ mode: 'inflight' });
    expect(getAIOperationRuntimeDefaults('content-post-feedback-fix').cachePolicy).toEqual({ mode: 'none' });
    expect(getAIOperationRuntimeDefaults('content-matrix-item-audit').cachePolicy).toEqual({ mode: 'none' });
    expect(getAIOperationRuntimeDefaults('content-matrix-item-revise').cachePolicy).toEqual({ mode: 'none' });
    expect(getAIOperationRuntimeDefaults('content-matrix-set-audit').cachePolicy).toEqual({ mode: 'none' });
    expect(getAIOperationRuntimeDefaults('schema-plan').cachePolicy).toEqual({ mode: 'ttl', ttlMs: 300_000 });
  });

  it('registers Monthly Digest as a closed-world clause-selection operation', () => {
    expect(isAIOperationId('monthly-digest')).toBe(true);
    expect(getAIOperationPolicyMetadata('monthly-digest')).toMatchObject({
      domain: 'analytics-intelligence',
      outputMode: 'json',
      parserExpectation: 'parseStructuredAIOutput(monthly-digest-clause-selection)',
      researchMode: 'forbidden',
      executionMode: 'sync-only',
    });
    expect(getAIOperationRuntimeDefaults('monthly-digest')).toMatchObject({
      feature: 'monthly-digest',
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.6-luna',
      defaultResponseFormat: { type: 'json_object' },
    });
  });

  it('separates dispatcher runtime defaults from policy metadata', () => {
    const runtimeDefaults = getAIOperationRuntimeDefaults('content-post-seo-meta');
    expect(runtimeDefaults).toEqual({
      feature: 'content-post-seo-meta',
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.6-terra',
      defaultResponseFormat: { type: 'json_object' },
      defaultMaxRetries: 3,
      defaultTimeoutMs: 60_000,
      defaultResearchMode: false,
      cachePolicy: { mode: 'inflight' },
    });
    expect(runtimeDefaults).not.toHaveProperty('providerIntent');
    expect(runtimeDefaults).not.toHaveProperty('outputMode');
    expect(runtimeDefaults).not.toHaveProperty('executionMode');
    expect(runtimeDefaults).not.toHaveProperty('researchMode');

    const policy = getAIOperationPolicyMetadata('content-post-seo-meta');
    expect(policy).toMatchObject({
      id: 'content-post-seo-meta',
      domain: 'content-pipeline',
      providerIntent: 'openai',
      outputMode: 'json',
      researchMode: 'forbidden',
      executionMode: 'sync-or-background',
    });
    expect(policy).not.toHaveProperty('defaultProvider');
    expect(policy).not.toHaveProperty('defaultModel');
    expect(policy).not.toHaveProperty('defaultResponseFormat');
    expect(policy).not.toHaveProperty('defaultResearchMode');
  });
});
