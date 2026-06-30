import { describe, it, expect, beforeEach } from 'vitest';
import { mockOpenAIJsonResponse, mockOpenAIError, resetOpenAIMocks } from '../mocks/openai.js';
import { isAIOperationId } from '../../server/ai-operation-registry.js';
import { enrichLeadValue } from '../../server/the-issue-lead-value-ai.js';

beforeEach(() => {
  resetOpenAIMocks();
});

describe('the-issue-lead-value-enrich operation', () => {
  it('is registered in AI_OPERATION_REGISTRY', () => {
    expect(isAIOperationId('the-issue-lead-value-enrich')).toBe(true);
  });

  it('returns a Zod-validated estimate stamped basis=ai_enriched', async () => {
    mockOpenAIJsonResponse('the-issue-lead-value-enrich', { valuePerOutcome: 1200, unitLabel: 'qualified lead' });
    const out = await enrichLeadValue({ workspaceId: 'ws_x', industry: 'B2B SaaS', currency: 'USD' });
    expect(out?.basis).toBe('ai_enriched');
    expect(out?.valuePerOutcome).toBeGreaterThan(0);
    expect(out?.unitLabel).toBe('qualified lead');
    expect(out?.currency).toBe('USD');
  });

  it('returns null (honest degradation) when the model output fails schema validation', async () => {
    // Model returns a shape missing valuePerOutcome / with the wrong types → schema rejects → null.
    mockOpenAIJsonResponse('the-issue-lead-value-enrich', { foo: 'bar' });
    const out = await enrichLeadValue({ workspaceId: 'ws_bad', industry: '', currency: 'USD' });
    expect(out).toBeNull();
  });

  it('returns null (honest degradation) when the AI call errors (FM-2)', async () => {
    mockOpenAIError('the-issue-lead-value-enrich', 'rate limited');
    const out = await enrichLeadValue({ workspaceId: 'ws_err', industry: 'Dental', currency: 'USD' });
    expect(out).toBeNull();
  });
});
