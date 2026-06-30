import { describe, expect, it } from 'vitest';
import { getAIOperationPolicyMetadata, getAIOperationRuntimeDefaults, isAIOperationId } from '../../server/ai-operation-registry.js';

const structuredOperationIds = [
  'content-post-seo-meta',
  'content-post-unify',
  'voice-scoring',
  'meeting-brief',
  'voice-feedback-suggest',
  'intelligence-profile-autofill',
  'copy-generation',
  'copy-regeneration',
  'content-publish-field-mapping',
] as const;

describe('AI operation registry', () => {
  it('registers the PR6 structured-output operations', () => {
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

  it('separates dispatcher runtime defaults from policy metadata', () => {
    const runtimeDefaults = getAIOperationRuntimeDefaults('content-post-seo-meta');
    expect(runtimeDefaults).toEqual({
      feature: 'content-post-seo-meta',
      defaultProvider: 'openai',
      defaultModel: 'gpt-5.4',
      defaultResponseFormat: { type: 'json_object' },
      defaultMaxRetries: 3,
      defaultTimeoutMs: 60_000,
      defaultResearchMode: false,
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
