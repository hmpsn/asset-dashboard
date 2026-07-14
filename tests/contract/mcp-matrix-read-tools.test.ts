import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import type { ContentTemplate } from '../../shared/types/content.js';
import {
  MatrixGenerationSourceLimitError,
  type ContentTemplateGenerationUpgradeProposal,
} from '../../shared/types/matrix-generation.js';
import { MCP_TOOL_ERROR_CODES } from '../../shared/types/mcp-runtime.js';
import {
  contentMatrixActionTools,
  createContentMatrixActionHandler,
} from '../../server/mcp/tools/content-matrix-actions.js';
import { isValidatedMcpJsonV1ErrorResult } from '../../server/mcp/tool-errors.js';

const context = {
  requestId: 'request_1',
  toolName: 'list_content_matrices',
  targetWorkspaceId: 'ws_1',
  caller: {
    kind: 'workspace_key' as const,
    scope: 'ws_1',
    workspaceId: 'ws_1',
    keyId: 'key_1',
    keyLabel: 'Test key',
  },
};

function template(): ContentTemplate {
  return {
    id: 'tpl_1',
    workspaceId: 'ws_1',
    revision: 4,
    generationContractVersion: 1,
    name: 'Service template',
    pageType: 'service',
    variables: [],
    sections: [],
    urlPattern: '/services/{service}',
    keywordPattern: '{service} service',
    titlePattern: '{service} Service',
    metaDescPattern: 'Learn about {service}.',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function legacyUpgradeProposal(): ContentTemplateGenerationUpgradeProposal {
  return {
    templateId: 'tpl_legacy',
    expectedTemplateRevision: 3,
    proposalFingerprint: 'f'.repeat(64),
    generationContractVersion: 1,
    blocks: [
      {
        id: 'system:introduction',
        source: 'system',
        generationRole: 'introduction',
        order: 0,
        heading: { level: 1, renderedText: null, locked: true },
        guidance: 'Open with the direct answer.',
        aeoContract: { modes: ['answer_first'], required: true },
        ctaContract: { role: 'none', required: false },
      },
      {
        id: 'system:conclusion',
        source: 'system',
        generationRole: 'conclusion',
        order: 1,
        heading: { level: null, renderedText: null, locked: true },
        guidance: 'Close with the primary action.',
        aeoContract: { modes: [], required: false },
        ctaContract: { role: 'primary', required: true },
      },
    ],
    blockers: [],
  };
}

function dependencies() {
  return {
    listContentMatrices: vi.fn(() => ({
      items: [{
        id: 'mtx_1',
        workspaceId: 'ws_1',
        revision: 2,
        name: 'Services',
        templateId: 'tpl_1',
        templateRevision: 4,
        dimensionCount: 0,
        urlPattern: '/services/{service}',
        keywordPattern: '{service} service',
        stats: {
          total: 1,
          planned: 1,
          briefGenerated: 0,
          drafted: 0,
          reviewed: 0,
          published: 0,
        },
        cellCount: 1,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
      }],
      nextCursor: null,
    })),
    getContentMatrix: vi.fn(() => ({
      matrix: {
        id: 'mtx_1',
        workspaceId: 'ws_1',
        revision: 2,
        name: 'Services',
        templateId: 'tpl_1',
        dimensions: [],
        urlPattern: '/services/{service}',
        keywordPattern: '{service} service',
        stats: {
          total: 1,
          planned: 1,
          briefGenerated: 0,
          drafted: 0,
          reviewed: 0,
          published: 0,
        },
        cellCount: 1,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
      templateRevision: 4,
      cells: { items: [], nextCursor: null },
    })),
    resolveMatrixStructures: vi.fn(async () => ({ results: [] })),
    acceptTemplateGenerationUpgrade: vi.fn(async () => ({
      status: 'accepted' as const,
      template: template(),
      proposalFingerprint: 'a'.repeat(64),
      replayed: false,
    })),
    addActivity: vi.fn(),
    broadcastToWorkspace: vi.fn(),
    invalidateContentPipelineIntelligence: vi.fn(),
  };
}

function textPayload(result: Awaited<ReturnType<ReturnType<typeof createContentMatrixActionHandler>>>): unknown {
  const text = result.content[0];
  expect(text?.type).toBe('text');
  return JSON.parse(text && 'text' in text ? text.text : '{}');
}

describe('MCP content matrix read tools', () => {
  it('advertises one dedicated four-tool snake_case family with described bounded inputs', () => {
    expect(contentMatrixActionTools.map(tool => tool.name)).toEqual([
      'list_content_matrices',
      'get_content_matrix',
      'resolve_content_matrix_cells',
      'accept_content_template_generation_upgrade',
    ]);

    for (const tool of contentMatrixActionTools as Tool[]) {
      expect(tool.inputSchema.type).toBe('object');
      const properties = tool.inputSchema.properties as Record<string, { description?: string }>;
      expect(properties.workspace_id?.description).toEqual(expect.any(String));
      expect(properties).not.toHaveProperty('workspaceId');
      for (const property of Object.values(properties)) {
        expect(property.description).toEqual(expect.any(String));
      }
    }

    const listSchema = contentMatrixActionTools[0].inputSchema as Record<string, unknown>;
    expect(listSchema).toMatchObject({
      properties: {
        limit: { minimum: 1, maximum: 100 },
      },
    });
    const resolveSchema = contentMatrixActionTools[2].inputSchema as Record<string, unknown>;
    expect(resolveSchema).toMatchObject({
      properties: {
        selections: { minItems: 1, maxItems: 25 },
      },
    });
  });

  it('returns only branded json_v1 validation errors', async () => {
    const handle = createContentMatrixActionHandler(dependencies());
    const result = await handle('get_content_matrix', { workspace_id: 'ws_1' }, context);

    expect(result.isError).toBe(true);
    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toEqual({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: 'The tool input is invalid.',
      retryable: false,
    });
  });

  it('maps bounded read results to snake_case without a giant cells blob', async () => {
    const deps = dependencies();
    const handle = createContentMatrixActionHandler(deps);
    const result = await handle('list_content_matrices', {
      workspace_id: 'ws_1',
      template_id: 'tpl_1',
      limit: 25,
    }, context);

    expect(result.isError).not.toBe(true);
    expect(deps.listContentMatrices).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      templateId: 'tpl_1',
      cursor: undefined,
      limit: 25,
    });
    expect(textPayload(result)).toMatchObject({
      items: [{
        id: 'mtx_1',
        workspace_id: 'ws_1',
        template_id: 'tpl_1',
        template_revision: 4,
        cell_count: 1,
        dimension_count: 0,
      }],
      next_cursor: null,
    });
    expect(JSON.stringify(textPayload(result))).not.toContain('"cells"');
    expect(JSON.stringify(textPayload(result))).not.toContain('"dimensions"');
  });

  it('maps exact structural source revisions and never starts generation', async () => {
    const deps = dependencies();
    const handle = createContentMatrixActionHandler(deps);
    const result = await handle('resolve_content_matrix_cells', {
      workspace_id: 'ws_1',
      matrix_id: 'mtx_1',
      selections: [{
        cell_id: 'cell_1',
        expected_source_revision: {
          matrix_revision: 2,
          template_revision: 4,
          cell_revision: 1,
        },
      }],
    }, { ...context, toolName: 'resolve_content_matrix_cells' });

    expect(result.isError).not.toBe(true);
    expect(deps.resolveMatrixStructures).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      matrixId: 'mtx_1',
      selections: [{
        cellId: 'cell_1',
        expectedSourceRevision: {
          matrixRevision: 2,
          templateRevision: 4,
          cellRevision: 1,
        },
      }],
    });
    expect(deps.acceptTemplateGenerationUpgrade).not.toHaveBeenCalled();
  });

  it('returns one bounded upgrade proposal for 25 identical legacy-template results', async () => {
    const deps = dependencies();
    const proposal = legacyUpgradeProposal();
    const selections = Array.from({ length: 25 }, (_, index) => ({
      cell_id: `cell_${index + 1}`,
      expected_source_revision: {
        matrix_revision: 2,
        template_revision: 3,
        cell_revision: index + 1,
      },
    }));
    deps.resolveMatrixStructures.mockResolvedValue({
      results: selections.map(selection => ({
        status: 'upgrade_required',
        matrixId: 'mtx_1',
        templateId: 'tpl_legacy',
        cellId: selection.cell_id,
        sourceRevision: {
          matrixRevision: selection.expected_source_revision.matrix_revision,
          templateRevision: selection.expected_source_revision.template_revision,
          cellRevision: selection.expected_source_revision.cell_revision,
        },
        proposal,
      })),
    } as never);
    const handle = createContentMatrixActionHandler(deps);

    const result = await handle('resolve_content_matrix_cells', {
      workspace_id: 'ws_1',
      matrix_id: 'mtx_1',
      selections,
    }, { ...context, toolName: 'resolve_content_matrix_cells' });

    expect(textPayload(result)).toEqual({
      results: selections.map(selection => ({
        status: 'upgrade_required',
        matrix_id: 'mtx_1',
        template_id: 'tpl_legacy',
        cell_id: selection.cell_id,
        source_revision: selection.expected_source_revision,
        proposal_fingerprint: 'f'.repeat(64),
      })),
      upgrade_proposals: [{
        template_id: 'tpl_legacy',
        expected_template_revision: 3,
        proposal_fingerprint: 'f'.repeat(64),
        generation_contract_version: 1,
        blocks: [
          {
            id: 'system:introduction',
            source: 'system',
            generation_role: 'introduction',
            order: 0,
            heading: { level: 1, rendered_text: null, locked: true },
            guidance: 'Open with the direct answer.',
            aeo_contract: { modes: ['answer_first'], required: true },
            cta_contract: { role: 'none', required: false },
          },
          {
            id: 'system:conclusion',
            source: 'system',
            generation_role: 'conclusion',
            order: 1,
            heading: { level: null, rendered_text: null, locked: true },
            guidance: 'Close with the primary action.',
            aeo_contract: { modes: [], required: false },
            cta_contract: { role: 'primary', required: true },
          },
        ],
        blockers: [],
      }],
    });
    expect(JSON.stringify(textPayload(result)).match(/"blocks"/g)).toHaveLength(1);
  });

  it('preserves resolved targets and blocked evidence while projecting no proposals', async () => {
    const deps = dependencies();
    deps.resolveMatrixStructures.mockResolvedValue({
      results: [
        {
          status: 'resolved',
          matrixId: 'mtx_1',
          templateId: 'tpl_1',
          cellId: 'cell_resolved',
          sourceRevision: { matrixRevision: 2, templateRevision: 4, cellRevision: 1 },
          target: {
            renderedUrl: '/services/seo-audit',
            variableValues: { serviceType: 'SEO Audit' },
          },
        },
        {
          status: 'blocked',
          matrixId: 'mtx_1',
          templateId: 'tpl_1',
          cellId: 'cell_blocked',
          sourceRevision: { matrixRevision: 2, templateRevision: 4, cellRevision: 2 },
          blockers: [{
            id: 'missing_keyword',
            fieldPath: 'cell.targetKeyword',
            status: 'missing',
          }],
        },
      ],
    } as never);
    const handle = createContentMatrixActionHandler(deps);

    const result = await handle('resolve_content_matrix_cells', {
      workspace_id: 'ws_1',
      matrix_id: 'mtx_1',
      selections: [
        {
          cell_id: 'cell_resolved',
          expected_source_revision: {
            matrix_revision: 2,
            template_revision: 4,
            cell_revision: 1,
          },
        },
        {
          cell_id: 'cell_blocked',
          expected_source_revision: {
            matrix_revision: 2,
            template_revision: 4,
            cell_revision: 2,
          },
        },
      ],
    }, context);

    expect(textPayload(result)).toEqual({
      results: [
        {
          status: 'resolved',
          matrix_id: 'mtx_1',
          template_id: 'tpl_1',
          cell_id: 'cell_resolved',
          source_revision: { matrix_revision: 2, template_revision: 4, cell_revision: 1 },
          target: {
            rendered_url: '/services/seo-audit',
            variable_values: { serviceType: 'SEO Audit' },
          },
        },
        {
          status: 'blocked',
          matrix_id: 'mtx_1',
          template_id: 'tpl_1',
          cell_id: 'cell_blocked',
          source_revision: { matrix_revision: 2, template_revision: 4, cell_revision: 2 },
          blockers: [{
            id: 'missing_keyword',
            field_path: 'cell.targetKeyword',
            status: 'missing',
          }],
        },
      ],
      upgrade_proposals: [],
    });
  });

  it('snake-cases contract fields without corrupting variable or CMS map identities', async () => {
    const deps = dependencies();
    deps.resolveMatrixStructures.mockResolvedValue({
      results: [{
        status: 'resolved',
        target: {
          variableValues: { serviceType: 'SEO Audit' },
          slugSubstitutions: { serviceType: 'seo-audit' },
          proseSubstitutions: { serviceType: 'SEO Audit' },
          cmsFieldMap: { heroHeading: 'hero_heading' },
        },
      }],
    } as never);
    const handle = createContentMatrixActionHandler(deps);
    const result = await handle('resolve_content_matrix_cells', {
      workspace_id: 'ws_1',
      matrix_id: 'mtx_1',
      selections: [{
        cell_id: 'cell_1',
        expected_source_revision: {
          matrix_revision: 2,
          template_revision: 4,
          cell_revision: 1,
        },
      }],
    }, context);

    expect(textPayload(result)).toMatchObject({
      results: [{
        target: {
          variable_values: { serviceType: 'SEO Audit' },
          slug_substitutions: { serviceType: 'seo-audit' },
          prose_substitutions: { serviceType: 'SEO Audit' },
          cms_field_map: { heroHeading: 'hero_heading' },
        },
      }],
    });
  });

  it('writes an accepted exact upgrade through the domain action and emits one MCP audit/event', async () => {
    const deps = dependencies();
    const handle = createContentMatrixActionHandler(deps);
    const result = await handle('accept_content_template_generation_upgrade', {
      workspace_id: 'ws_1',
      template_id: 'tpl_1',
      expected_template_revision: 3,
      proposal_fingerprint: 'a'.repeat(64),
      decision: 'accept',
      idempotency_key: 'upgrade-1',
    }, { ...context, toolName: 'accept_content_template_generation_upgrade' });

    expect(result.isError).not.toBe(true);
    expect(deps.acceptTemplateGenerationUpgrade).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      templateId: 'tpl_1',
      expectedTemplateRevision: 3,
      proposalFingerprint: 'a'.repeat(64),
      decision: 'accept',
      idempotencyKey: 'upgrade-1',
    });
    expect(deps.invalidateContentPipelineIntelligence).toHaveBeenCalledWith('ws_1');
    expect(deps.broadcastToWorkspace).toHaveBeenCalledOnce();
    expect(deps.addActivity).toHaveBeenCalledOnce();
    expect(deps.addActivity).toHaveBeenCalledWith(
      'ws_1',
      'content_updated',
      expect.any(String),
      undefined,
      expect.objectContaining({ source: 'mcp-chat' }),
    );
    expect(textPayload(result)).toEqual({
      status: 'accepted',
      template_id: 'tpl_1',
      template_revision: 4,
      generation_contract_version: 1,
      proposal_fingerprint: 'a'.repeat(64),
      replayed: false,
    });
    expect(JSON.stringify(textPayload(result))).not.toContain('sections');
  });

  it('keeps reject and accepted replays side-effect free', async () => {
    const deps = dependencies();
    deps.acceptTemplateGenerationUpgrade
      .mockResolvedValueOnce({
        status: 'rejected',
        template: template(),
        proposalFingerprint: 'a'.repeat(64),
        replayed: false,
      })
      .mockResolvedValueOnce({
        status: 'accepted',
        template: template(),
        proposalFingerprint: 'a'.repeat(64),
        replayed: true,
      });
    const handle = createContentMatrixActionHandler(deps);
    const base = {
      workspace_id: 'ws_1',
      template_id: 'tpl_1',
      expected_template_revision: 3,
      proposal_fingerprint: 'a'.repeat(64),
      idempotency_key: 'upgrade-1',
    };

    await handle('accept_content_template_generation_upgrade', {
      ...base,
      decision: 'reject',
    }, context);
    await handle('accept_content_template_generation_upgrade', {
      ...base,
      decision: 'accept',
    }, context);

    expect(deps.addActivity).not.toHaveBeenCalled();
    expect(deps.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(deps.invalidateContentPipelineIntelligence).not.toHaveBeenCalled();
  });

  it('reports an oversized stored template as a non-retryable precondition failure', async () => {
    const deps = dependencies();
    deps.acceptTemplateGenerationUpgrade.mockRejectedValue(
      new MatrixGenerationSourceLimitError('template', [{
        code: 'serialized_bytes_exceeded',
        fieldPath: 'template',
        actual: 1_048_577,
        limit: 1_048_576,
      }]),
    );
    const handle = createContentMatrixActionHandler(deps);

    const result = await handle('accept_content_template_generation_upgrade', {
      workspace_id: 'ws_1',
      template_id: 'tpl_1',
      expected_template_revision: 3,
      proposal_fingerprint: 'a'.repeat(64),
      decision: 'accept',
      idempotency_key: 'upgrade-oversized-template',
    }, { ...context, toolName: 'accept_content_template_generation_upgrade' });

    expect(result.isError).toBe(true);
    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toEqual({
      code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
      message: 'The stored generation source exceeds the bounded generation contract.',
      retryable: false,
    });
    expect(deps.addActivity).not.toHaveBeenCalled();
    expect(deps.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(deps.invalidateContentPipelineIntelligence).not.toHaveBeenCalled();
  });

  it('rethrows unexpected dependency failures for the central MCP executor to log and sanitize', async () => {
    const deps = dependencies();
    const unexpected = new Error('sensitive dependency detail');
    deps.listContentMatrices.mockImplementation(() => {
      throw unexpected;
    });
    const handle = createContentMatrixActionHandler(deps);

    await expect(handle('list_content_matrices', {
      workspace_id: 'ws_1',
    }, context)).rejects.toBe(unexpected);
  });
});
