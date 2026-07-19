import { describe, expect, it } from 'vitest';
import {
  MCP_OPERATOR_BRIEF_LIMITS,
  clientViewDataSchema,
  clientViewOutputSchema,
  getClientViewInputSchema,
  getPortfolioBriefInputSchema,
  getWorkspaceDecisionBriefInputSchema,
} from '../../shared/types/mcp-operator-briefs.js';
import { operatorBriefTools } from '../../server/mcp/tools/operator-briefs.js';
import {
  OPERATOR_DECISION_INTELLIGENCE_SLICES,
} from '../../server/domains/analytics-intelligence/operator-read-models.js';

describe('P2 MCP operator brief contracts', () => {
  it('defaults bounded list inputs to 10 and accepts only integers from 1 through 25', () => {
    expect(getPortfolioBriefInputSchema.parse({})).toEqual({ limit: 10 });
    expect(getWorkspaceDecisionBriefInputSchema.parse({ workspace_id: 'ws-1' }))
      .toEqual({ workspace_id: 'ws-1', queue_limit: 10 });

    for (const limit of [1, MCP_OPERATOR_BRIEF_LIMITS.maxListLimit]) {
      expect(getPortfolioBriefInputSchema.parse({ limit }).limit).toBe(limit);
      expect(getWorkspaceDecisionBriefInputSchema.parse({
        workspace_id: 'ws-1',
        queue_limit: limit,
      }).queue_limit).toBe(limit);
    }

    for (const invalid of [0, 26, -1, 1.5, '10', null]) {
      expect(getPortfolioBriefInputSchema.safeParse({ limit: invalid }).success).toBe(false);
      expect(getWorkspaceDecisionBriefInputSchema.safeParse({
        workspace_id: 'ws-1',
        queue_limit: invalid,
      }).success).toBe(false);
    }
    expect(getClientViewInputSchema.safeParse({ workspace_id: '' }).success).toBe(false);
    expect(getClientViewInputSchema.safeParse({ workspace_id: 'ws-1', extra: true }).success)
      .toBe(false);
  });

  it('locks workspace decision assembly to the five approved read slices', () => {
    expect(OPERATOR_DECISION_INTELLIGENCE_SLICES).toEqual([
      'insights',
      'contentPipeline',
      'siteHealth',
      'clientSignals',
      'operational',
    ]);
    expect(new Set(OPERATOR_DECISION_INTELLIGENCE_SLICES).size).toBe(5);
  });

  it('advertises strict root-object output schemas for all three tools', () => {
    expect(operatorBriefTools).toHaveLength(3);
    for (const tool of operatorBriefTools) {
      const jsonSchema = tool.outputSchema as Record<string, unknown>;
      expect(jsonSchema.type).toBe('object');
      expect(jsonSchema.required).toEqual(['data']);
      expect(jsonSchema.additionalProperties).toBe(false);
      expect(jsonSchema.properties).toHaveProperty('data');
    }
  });

  it('rejects raw payload, evidence, prompt, note, and activity fields at the wrapper boundary', () => {
    const unsafeKeys = [
      'payload',
      'evidence',
      'prompt',
      'notes',
      'description',
      'recentActivity',
      'knowledgeBase',
      'brandVoice',
      'churnRisk',
    ];
    const validClient = {
      workspaceId: 'ws-1',
      assembledAt: '2026-07-19T00:00:00.000Z',
      tier: 'free',
      insightsSummary: null,
      pipelineStatus: null,
    };
    expect(clientViewDataSchema.safeParse(validClient).success).toBe(true);

    for (const key of unsafeKeys) {
      expect(clientViewOutputSchema.safeParse({
        data: { ...validClient, [key]: 'must-not-cross-boundary' },
      }).success, key).toBe(false);
    }
  });
});
