import { describe, expect, it } from 'vitest';
import { AI_OPERATION_REGISTRY, getAIOperationContract, isAIOperationId } from '../../server/ai-operation-registry.js';

describe('AI operation registry integrity', () => {
  it('keeps operation ids and feature keys aligned', () => {
    const ids = Object.keys(AI_OPERATION_REGISTRY) as Array<keyof typeof AI_OPERATION_REGISTRY>;
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const contract = getAIOperationContract(id);
      expect(contract.id).toBe(id);
      expect(contract.feature).toBe(id);
      expect(contract.domain.length).toBeGreaterThan(0);
      expect(contract.modelIntent.length).toBeGreaterThan(0);
      expect(contract.parserExpectation.length).toBeGreaterThan(0);
    }
  });

  it('declares JSON output operations with explicit parser expectations', () => {
    const contracts = Object.values(AI_OPERATION_REGISTRY);
    const jsonContracts = contracts.filter(contract => contract.outputMode === 'json');
    expect(jsonContracts.length).toBeGreaterThan(0);
    for (const contract of jsonContracts) {
      expect(contract.parserExpectation.toLowerCase()).toContain('json');
    }
  });

  it('resolves known operation ids and rejects unknown ids', () => {
    expect(isAIOperationId('schema-plan')).toBe(true);
    expect(isAIOperationId('client-search-chat')).toBe(true);
    expect(isAIOperationId('not-a-real-operation')).toBe(false);
  });
});
