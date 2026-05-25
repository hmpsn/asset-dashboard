import { describe, expect, it } from 'vitest';
import { getAIOperationContract, isAIOperationId } from '../../server/ai-operation-registry.js';

const structuredOperationIds = [
  'content-post-seo-meta',
  'content-post-unify',
  'voice-scoring',
  'meeting-brief',
  'voice-feedback-suggest',
  'intelligence-profile-autofill',
] as const;

describe('AI operation registry', () => {
  it('registers the PR6 structured-output operations', () => {
    for (const id of structuredOperationIds) {
      expect(isAIOperationId(id)).toBe(true);
      const contract = getAIOperationContract(id);
      expect(contract.outputMode).toBe('json');
      expect(contract.defaultResponseFormat).toEqual({ type: 'json_object' });
    }
  });

  it('marks research-required operations explicitly', () => {
    expect(getAIOperationContract('content-post-unify').researchMode).toBe('required');
    expect(getAIOperationContract('content-post-seo-meta').researchMode).toBe('forbidden');
  });
});
