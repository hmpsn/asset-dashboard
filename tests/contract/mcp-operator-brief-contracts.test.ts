import { describe, expect, it } from 'vitest';
import {
  MCP_OPERATOR_BRIEF_LIMITS,
  clientViewDataSchema,
  clientViewOutputSchema,
  getClientViewInputSchema,
  getPortfolioBriefInputSchema,
  getWorkspaceDecisionBriefInputSchema,
  portfolioBriefOutputSchema,
  workspaceDecisionBriefOutputSchema,
} from '../../shared/types/mcp-operator-briefs.js';
import { operatorBriefTools } from '../../server/mcp/tools/operator-briefs.js';
import {
  OPERATOR_DECISION_INTELLIGENCE_SLICES,
} from '../../server/domains/analytics-intelligence/operator-read-models.js';
import { toMcpJsonSchema } from '../../server/mcp/json-schema.js';

function schemaRecord(value: unknown): Record<string, unknown> {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function expandLocalSchemaRefs(schema: Record<string, unknown>): Record<string, unknown> {
  const definitions = new Map<string, Record<string, unknown>>();
  const indexDefinitions = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(indexDefinitions);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (typeof node.$id === 'string') definitions.set(node.$id, node);
    Object.values(node).forEach(indexDefinitions);
  };
  indexDefinitions(schema);

  const expand = (value: unknown, resolving = new Set<string>()): unknown => {
    if (Array.isArray(value)) return value.map(child => expand(child, resolving));
    if (value === null || typeof value !== 'object') return value;
    const node = value as Record<string, unknown>;
    if (typeof node.$ref === 'string') {
      expect(node.$ref).toMatch(/^[A-Za-z_][-A-Za-z0-9._]*$/);
      const definitionId = node.$ref;
      const target = definitions.get(definitionId);
      expect(target, `unresolved schema ref ${node.$ref}`).toBeDefined();
      expect(resolving.has(definitionId), `cyclic schema ref ${node.$ref}`).toBe(false);
      return expand(target, new Set([...resolving, definitionId]));
    }
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => key !== 'definitions' && key !== '$id')
        .map(([key, child]) => [key, expand(child, resolving)]),
    );
  };

  return schemaRecord(expand(schema));
}

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

  it('losslessly represents every recursive output path and validation keyword through refs', () => {
    const canonicalSchemas = [
      portfolioBriefOutputSchema,
      workspaceDecisionBriefOutputSchema,
      clientViewOutputSchema,
    ];
    expect(operatorBriefTools).toHaveLength(canonicalSchemas.length);

    operatorBriefTools.forEach((tool, index) => {
      const compact = schemaRecord(tool.outputSchema);
      expect(compact).toHaveProperty('definitions');
      expect(JSON.stringify(compact)).toContain('"$ref"');
      expect(expandLocalSchemaRefs(compact)).toEqual(
        toMcpJsonSchema(canonicalSchemas[index]!),
      );
    });
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
