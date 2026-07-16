import { describe, expect, it, vi } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import type { ContentTemplate } from '../../shared/types/content.js';
import {
  MatrixGenerationSourceLimitError,
  type ContentTemplateGenerationUpgradeProposal,
  type GetMatrixGenerationResult,
  type MatrixGenerationRun,
  type RetryMatrixGenerationResult,
  type StartMatrixGenerationResult,
} from '../../shared/types/matrix-generation.js';
import { MCP_TOOL_ERROR_CODES } from '../../shared/types/mcp-runtime.js';
import {
  contentMatrixActionTools,
  createContentMatrixActionHandler,
} from '../../server/mcp/tools/content-matrix-actions.js';
import { isValidatedMcpJsonV1ErrorResult } from '../../server/mcp/tool-errors.js';
import { PseoMatrixBridgeError } from '../../server/domains/content/matrix-generation/pseo-bridge.js';
import {
  MatrixCellPlannedUrlError,
  MatrixCellRevisionConflictError,
} from '../../server/content-matrices.js';

const pseoExpectedSource = {
  entry_updated_at: '2026-07-14T00:00:00.000Z',
  template_id: 'tpl_1',
  template_revision: 4,
};

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

function generationRun(): MatrixGenerationRun {
  const timestamp = '2026-07-14T12:00:00.000Z';
  return {
    id: 'run_1',
    workspaceId: 'ws_1',
    matrixId: 'mtx_1',
    templateId: 'tpl_1',
    status: 'queued',
    revision: 0,
    selectionFingerprint: 'c'.repeat(64),
    selections: [{
      matrixId: 'mtx_1',
      cellId: 'cell_1',
      sourceRevision: { matrixRevision: 2, templateRevision: 4, cellRevision: 1 },
      structuralFingerprint: 'a'.repeat(64),
      previewFingerprint: 'b'.repeat(64),
    }],
    jobId: 'job_1',
    acceptedBudget: {
      estimate: {
        providerCalls: 15,
        inputTokens: 31_000,
        outputTokens: 27_500,
        estimatedUsd: 0.98,
        maxConcurrency: 1,
      },
      limits: {
        maxProviderCalls: 15,
        maxInputTokens: 31_000,
        maxOutputTokens: 27_500,
        maxEstimatedUsd: 0.98,
        maxConcurrency: 1,
      },
      reserved: {
        providerCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedUsd: 0,
      },
    },
    setAuditReport: null,
    counts: {
      selected: 1,
      queued: 1,
      running: 0,
      readyForHumanReview: 0,
      needsAttention: 0,
      blocked: 0,
      conflicts: 0,
      failed: 0,
      cancelled: 0,
    },
    createdBy: { actorType: 'mcp' },
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
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
    listTemplates: vi.fn(() => [template()]),
    getTemplate: vi.fn(() => template()),
    createTemplate: vi.fn(() => template()),
    updateTemplate: vi.fn(() => ({ ...template(), revision: 5, name: 'Updated service template' })),
    duplicateTemplate: vi.fn(() => ({ ...template(), id: 'tpl_copy', name: 'Service template copy' })),
    createMatrix: vi.fn(() => ({
      id: 'mtx_direct',
      workspaceId: 'ws_1',
      revision: 1,
      name: 'Direct services',
      templateId: 'tpl_1',
      dimensions: [{ variableName: 'service', values: ['Laundry', 'Dry Cleaning'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      cells: [
        { id: 'cell_laundry', revision: 1, variableValues: { service: 'Laundry' }, targetKeyword: 'Laundry service', plannedUrl: '/services/laundry', status: 'planned' as const },
        { id: 'cell_dry_cleaning', revision: 1, variableValues: { service: 'Dry Cleaning' }, targetKeyword: 'Dry Cleaning service', plannedUrl: '/services/dry-cleaning', status: 'planned' as const },
      ],
      stats: { total: 2, planned: 2, briefGenerated: 0, drafted: 0, reviewed: 0, published: 0 },
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    })),
    updateMatrixCell: vi.fn((_workspaceId, _matrixId, cellId, updates) => ({
      id: 'mtx_direct',
      workspaceId: 'ws_1',
      revision: 1,
      name: 'Direct services',
      templateId: 'tpl_1',
      dimensions: [{ variableName: 'feature', values: ['Projects'] }],
      urlPattern: '/features/{feature}',
      keywordPattern: '{feature} software',
      cells: [{
        id: cellId,
        revision: 2,
        variableValues: { feature: 'Projects' },
        targetKeyword: updates.targetKeyword ?? 'Projects software',
        plannedUrl: updates.plannedUrl ?? '/features/projects',
        plannedUrlOverridden: updates.plannedUrl === undefined ? undefined : true,
        expectedSchemaTypes: updates.expectedSchemaTypes,
        expectedSchemaTypesOverridden: updates.expectedSchemaTypes === undefined ? undefined : true,
        status: 'planned' as const,
      }],
      stats: { total: 1, planned: 1, briefGenerated: 0, drafted: 0, reviewed: 0, published: 0 },
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    })),
    listPseoBlueprintEntries: vi.fn(() => ({ items: [], nextCursor: null })),
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
    previewMatrixGeneration: vi.fn(async () => ({
      results: [],
      estimatedBatchBudget: null,
    })),
    resolveContentMatrixEvidence: vi.fn(),
    startMatrixGeneration: vi.fn(),
    getMatrixGeneration: vi.fn(),
    retryMatrixGeneration: vi.fn(),
    getPseoMatrixPlan: vi.fn(() => ({
      source: {
        workspaceId: 'ws_1',
        blueprintId: 'blueprint_1',
        entryId: 'entry_1',
        entryUpdatedAt: '2026-07-14T00:00:00.000Z',
        templateId: 'tpl_1',
        templateRevision: 4,
      },
      entry: {
        name: 'Service locations',
        pageType: 'location' as const,
        isCollection: true,
      },
      template: {
        name: 'Location template',
        pageType: 'location' as const,
        variables: [
          { name: 'service', label: 'Service' },
          { name: 'location', label: 'Location' },
        ],
        urlPattern: '/locations/{location}/{service}',
        keywordPattern: '{service} in {location}',
      },
    })),
    createMatrixFromPseoPlan: vi.fn(() => ({
      replayed: false,
      source: {
        workspaceId: 'ws_1',
        blueprintId: 'blueprint_1',
        entryId: 'entry_1',
        entryUpdatedAt: '2026-07-14T00:00:01.000Z',
        templateId: 'tpl_1',
        templateRevision: 4,
        matrixId: 'mtx_created',
      },
      matrix: {
        id: 'mtx_created',
        name: 'Service locations',
        revision: 1,
        templateRevision: 4,
        cellCount: 4,
        createdAt: '2026-07-14T00:00:00.000Z',
        updatedAt: '2026-07-14T00:00:00.000Z',
      },
    })),
    acceptTemplateGenerationUpgrade: vi.fn(async () => ({
      status: 'accepted' as const,
      template: template(),
      proposalFingerprint: 'a'.repeat(64),
      replayed: false,
    })),
    addActivity: vi.fn(),
    broadcastToWorkspace: vi.fn(),
    invalidateContentPipelineIntelligence: vi.fn(),
    recordPaidCallOnce: vi.fn(() => ({ count: 1 })),
  };
}

function textPayload(result: Awaited<ReturnType<ReturnType<typeof createContentMatrixActionHandler>>>): unknown {
  const text = result.content[0];
  expect(text?.type).toBe('text');
  return JSON.parse(text && 'text' in text ? text.text : '{}');
}

describe('MCP content matrix read tools', () => {
  it('advertises the template and direct-matrix surface with described bounded inputs', () => {
    expect(contentMatrixActionTools.map(tool => tool.name)).toEqual([
      'list_content_templates',
      'get_content_template',
      'create_content_template',
      'update_content_template',
      'duplicate_content_template',
      'create_content_matrix',
      'update_content_matrix_cell',
      'list_pseo_blueprint_entries',
      'list_content_matrices',
      'get_content_matrix',
      'resolve_content_matrix_cells',
      'accept_content_template_generation_upgrade',
      'preview_content_matrix_generation',
      'resolve_content_matrix_evidence',
      'start_content_matrix_generation',
      'get_content_matrix_generation',
      'retry_content_matrix_generation',
      'get_pseo_matrix_plan',
      'create_content_matrix_from_pseo_plan',
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
    const resolveSchema = contentMatrixActionTools
      .find(tool => tool.name === 'resolve_content_matrix_cells')?.inputSchema as Record<string, unknown>;
    expect(resolveSchema).toMatchObject({
      properties: {
        selections: { minItems: 1, maxItems: 25 },
      },
    });
  });

  it('authors, reads, revises, and duplicates a content template through the existing domain functions', async () => {
    const deps = dependencies();
    const handle = createContentMatrixActionHandler(deps);
    const templateInput = {
      name: 'Service template',
      pageType: 'service',
      variables: [{ name: 'service', label: 'Service' }],
      sections: [],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
    };

    const created = await handle('create_content_template', {
      workspace_id: 'ws_1',
      template: templateInput,
      idempotency_key: 'template-create-1',
    }, { ...context, toolName: 'create_content_template' });
    expect(created.isError).not.toBe(true);
    expect(deps.createTemplate).toHaveBeenCalledWith('ws_1', templateInput);
    expect(textPayload(created)).toMatchObject({ template: { id: 'tpl_1', revision: 4 } });

    const read = await handle('get_content_template', {
      workspace_id: 'ws_1',
      template_id: 'tpl_1',
    }, { ...context, toolName: 'get_content_template' });
    expect(textPayload(read)).toMatchObject({ id: 'tpl_1', revision: 4, sections: [] });

    const updated = await handle('update_content_template', {
      workspace_id: 'ws_1',
      template_id: 'tpl_1',
      patch: { name: 'Updated service template' },
      expected_revision: 4,
    }, { ...context, toolName: 'update_content_template' });
    expect(deps.updateTemplate).toHaveBeenCalledWith(
      'ws_1',
      'tpl_1',
      { name: 'Updated service template' },
      { expectedTemplateRevision: 4 },
    );
    expect(textPayload(updated)).toMatchObject({ template: { revision: 5 } });

    const duplicated = await handle('duplicate_content_template', {
      workspace_id: 'ws_1',
      template_id: 'tpl_1',
      new_name: 'Service template copy',
    }, { ...context, toolName: 'duplicate_content_template' });
    expect(deps.duplicateTemplate).toHaveBeenCalledWith('ws_1', 'tpl_1', 'Service template copy');
    expect(textPayload(duplicated)).toMatchObject({ template: { id: 'tpl_copy' } });
    expect(deps.addActivity).toHaveBeenCalledTimes(3);
  });

  it('lists bounded template summaries without returning section blobs', async () => {
    const deps = dependencies();
    const result = await createContentMatrixActionHandler(deps)(
      'list_content_templates',
      { workspace_id: 'ws_1', limit: 10 },
      context,
    );

    expect(textPayload(result)).toMatchObject({
      items: [{ id: 'tpl_1', revision: 4, section_count: 0, variable_count: 0 }],
      next_cursor: null,
    });
    expect(JSON.stringify(textPayload(result))).not.toContain('"sections"');
  });

  it('creates a direct matrix from template defaults with no blueprint prerequisite', async () => {
    const deps = dependencies();
    const result = await createContentMatrixActionHandler(deps)(
      'create_content_matrix',
      {
        workspace_id: 'ws_1',
        name: 'Direct services',
        template_id: 'tpl_1',
        dimensions: [{ variableName: 'service', values: ['Laundry', 'Dry Cleaning'] }],
      },
      { ...context, toolName: 'create_content_matrix' },
    );

    expect(deps.createMatrix).toHaveBeenCalledWith('ws_1', {
      name: 'Direct services',
      templateId: 'tpl_1',
      dimensions: [{ variableName: 'service', values: ['Laundry', 'Dry Cleaning'] }],
      urlPattern: '/services/{service}',
      keywordPattern: '{service} service',
      expectedSchemaTypes: undefined,
    }, { validateTemplate: true });
    expect(textPayload(result)).toMatchObject({
      matrix: { id: 'mtx_direct', template_id: 'tpl_1', revision: 1 },
      materialized_cell_count: 2,
    });
    expect(JSON.stringify(textPayload(result))).not.toContain('"cells"');
    expect(deps.getPseoMatrixPlan).not.toHaveBeenCalled();
    expect(deps.createMatrixFromPseoPlan).not.toHaveBeenCalled();
  });

  it('revision-safely overrides one matrix cell and emits workspace feedback once', async () => {
    const deps = dependencies();
    const result = await createContentMatrixActionHandler(deps)(
      'update_content_matrix_cell',
      {
        workspace_id: 'ws_1',
        matrix_id: 'mtx_direct',
        cell_id: 'cell_projects',
        patch: {
          target_keyword: 'asana alternative',
          planned_url: '/asana-alternative',
          variable_values: { feature: 'Projects' },
          expected_schema_types: ['SoftwareApplication', 'FAQPage'],
        },
        expected_cell_revision: 1,
      },
      { ...context, toolName: 'update_content_matrix_cell' },
    );

    expect(result.isError).not.toBe(true);
    expect(deps.updateMatrixCell).toHaveBeenCalledWith(
      'ws_1',
      'mtx_direct',
      'cell_projects',
      {
        targetKeyword: 'asana alternative',
        plannedUrl: '/asana-alternative',
        variableValues: { feature: 'Projects' },
        expectedSchemaTypes: ['SoftwareApplication', 'FAQPage'],
      },
      { expectedCellRevision: 1, requireExpectedCellRevision: true },
    );
    expect(textPayload(result)).toMatchObject({
      matrix_id: 'mtx_direct',
      cell: {
        id: 'cell_projects',
        revision: 2,
        target_keyword: 'asana alternative',
        planned_url: '/asana-alternative',
      },
    });
    expect(deps.invalidateContentPipelineIntelligence).toHaveBeenCalledWith('ws_1');
    expect(deps.broadcastToWorkspace).toHaveBeenCalledOnce();
    expect(deps.addActivity).toHaveBeenCalledOnce();
  });

  it('returns a field-addressed conflict for a stale cell override', async () => {
    const deps = dependencies();
    deps.updateMatrixCell.mockImplementation(() => {
      throw new MatrixCellRevisionConflictError('cell_projects', 1, 2);
    });
    const result = await createContentMatrixActionHandler(deps)(
      'update_content_matrix_cell',
      {
        workspace_id: 'ws_1',
        matrix_id: 'mtx_direct',
        cell_id: 'cell_projects',
        patch: { target_keyword: 'asana alternative' },
        expected_cell_revision: 1,
      },
      { ...context, toolName: 'update_content_matrix_cell' },
    );

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      code: MCP_TOOL_ERROR_CODES.CONFLICT,
      retryable: true,
      details: {
        field_path: 'expected_cell_revision',
        constraint: 'must equal the current cell revision',
        expected_revision: 1,
        actual_revision: 2,
      },
    });
  });

  it('returns a field-addressed validation error for a colliding planned URL', async () => {
    const deps = dependencies();
    deps.updateMatrixCell.mockImplementation(() => {
      throw new MatrixCellPlannedUrlError('planned_url_collision', {
        matrixId: 'mtx_other',
        cellId: 'cell_other',
      });
    });
    const result = await createContentMatrixActionHandler(deps)(
      'update_content_matrix_cell',
      {
        workspace_id: 'ws_1',
        matrix_id: 'mtx_direct',
        cell_id: 'cell_projects',
        patch: { planned_url: '/duplicate' },
        expected_cell_revision: 1,
      },
      { ...context, toolName: 'update_content_matrix_cell' },
    );

    expect(textPayload(result)).toMatchObject({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      retryable: false,
      details: {
        field_path: 'patch.planned_url',
        constraint: 'must be unique across all content matrix cells in this workspace',
        conflicting_matrix_id: 'mtx_other',
        conflicting_cell_id: 'cell_other',
      },
    });
  });

  it('lists bounded pSEO collection entry identities before plan lookup', async () => {
    const deps = dependencies();
    deps.listPseoBlueprintEntries.mockReturnValue({
      items: [{
        blueprintId: 'blueprint_1',
        blueprintName: 'Local services',
        blueprintStatus: 'active',
        blueprintUpdatedAt: '2026-07-14T00:00:00.000Z',
        entryId: 'entry_1',
        entryName: 'Service locations',
        entryUpdatedAt: '2026-07-14T00:00:00.000Z',
        pageType: 'location',
        templateId: 'tpl_1',
        matrixId: null,
      }],
      nextCursor: 'next-blueprint-page',
    });
    const result = await createContentMatrixActionHandler(deps)(
      'list_pseo_blueprint_entries',
      { workspace_id: 'ws_1', limit: 10 },
      context,
    );

    expect(deps.listPseoBlueprintEntries).toHaveBeenCalledWith({
      workspaceId: 'ws_1', cursor: undefined, limit: 10,
    });
    expect(textPayload(result)).toMatchObject({
      items: [{
        blueprint_id: 'blueprint_1',
        entry_id: 'entry_1',
        template_id: 'tpl_1',
      }],
      next_cursor: 'next-blueprint-page',
    });
  });

  it('reads bounded pSEO source authority before materialization', async () => {
    const deps = dependencies();
    const handle = createContentMatrixActionHandler(deps);
    const result = await handle('get_pseo_matrix_plan', {
      workspace_id: 'ws_1',
      blueprint_id: 'blueprint_1',
      entry_id: 'entry_1',
    }, { ...context, toolName: 'get_pseo_matrix_plan' });

    expect(result.isError).not.toBe(true);
    expect(deps.getPseoMatrixPlan).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      blueprintId: 'blueprint_1',
      entryId: 'entry_1',
    });
    expect(textPayload(result)).toMatchObject({
      source: {
        entry_updated_at: pseoExpectedSource.entry_updated_at,
        template_id: 'tpl_1',
        template_revision: 4,
      },
      template: {
        variables: [
          { name: 'service', label: 'Service' },
          { name: 'location', label: 'Location' },
        ],
      },
    });
  });

  it('materializes a pSEO plan once, maps its source identity, and emits no generation command', async () => {
    const deps = dependencies();
    const handle = createContentMatrixActionHandler(deps);

    const result = await handle('create_content_matrix_from_pseo_plan', {
      workspace_id: 'ws_1',
      blueprint_id: 'blueprint_1',
      entry_id: 'entry_1',
      expected_source_revision: pseoExpectedSource,
      dimensions: [
        { variable_name: 'service', values: ['Laundry', 'Dry Cleaning'] },
        { variable_name: 'location', values: ['Austin', 'Round Rock'] },
      ],
    }, { ...context, toolName: 'create_content_matrix_from_pseo_plan' });

    expect(result.isError).not.toBe(true);
    expect(deps.createMatrixFromPseoPlan).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      blueprintId: 'blueprint_1',
      entryId: 'entry_1',
      expectedSourceRevision: {
        entryUpdatedAt: pseoExpectedSource.entry_updated_at,
        templateId: 'tpl_1',
        templateRevision: 4,
      },
      dimensions: [
        { variableName: 'service', values: ['Laundry', 'Dry Cleaning'] },
        { variableName: 'location', values: ['Austin', 'Round Rock'] },
      ],
    });
    expect(textPayload(result)).toMatchObject({
      replayed: false,
      source: {
        workspace_id: 'ws_1',
        blueprint_id: 'blueprint_1',
        entry_id: 'entry_1',
        entry_updated_at: '2026-07-14T00:00:01.000Z',
        template_id: 'tpl_1',
        template_revision: 4,
        matrix_id: 'mtx_created',
      },
      matrix: { id: 'mtx_created', cell_count: 4 },
    });
    expect(deps.startMatrixGeneration).not.toHaveBeenCalled();
    expect(deps.addActivity).toHaveBeenCalledOnce();
    expect(deps.broadcastToWorkspace).toHaveBeenCalledTimes(2);
    expect(deps.invalidateContentPipelineIntelligence).toHaveBeenCalledWith('ws_1');
  });

  it('replays pSEO materialization without duplicate activity or broadcasts', async () => {
    const deps = dependencies();
    deps.createMatrixFromPseoPlan.mockReturnValue({
      ...deps.createMatrixFromPseoPlan(),
      replayed: true,
    });
    deps.createMatrixFromPseoPlan.mockClear();
    const handle = createContentMatrixActionHandler(deps);

    const result = await handle('create_content_matrix_from_pseo_plan', {
      workspace_id: 'ws_1',
      blueprint_id: 'blueprint_1',
      entry_id: 'entry_1',
      expected_source_revision: pseoExpectedSource,
      dimensions: [{ variable_name: 'service', values: ['Laundry'] }],
    }, { ...context, toolName: 'create_content_matrix_from_pseo_plan' });

    expect(result.isError).not.toBe(true);
    expect(textPayload(result)).toMatchObject({ replayed: true });
    expect(deps.addActivity).not.toHaveBeenCalled();
    expect(deps.broadcastToWorkspace).not.toHaveBeenCalled();
    expect(deps.invalidateContentPipelineIntelligence).not.toHaveBeenCalled();
  });

  it('returns the committed matrix when optional post-commit effects fail', async () => {
    const deps = dependencies();
    deps.invalidateContentPipelineIntelligence.mockImplementation(() => {
      throw new Error('cache unavailable');
    });
    deps.broadcastToWorkspace.mockImplementation(() => {
      throw new Error('socket unavailable');
    });
    deps.addActivity.mockImplementation(() => {
      throw new Error('activity unavailable');
    });
    const handle = createContentMatrixActionHandler(deps);

    const result = await handle('create_content_matrix_from_pseo_plan', {
      workspace_id: 'ws_1',
      blueprint_id: 'blueprint_1',
      entry_id: 'entry_1',
      expected_source_revision: pseoExpectedSource,
      dimensions: [{ variable_name: 'service', values: ['Laundry'] }],
    }, { ...context, toolName: 'create_content_matrix_from_pseo_plan' });

    expect(result.isError).not.toBe(true);
    expect(textPayload(result)).toMatchObject({ replayed: false, matrix: { id: 'mtx_created' } });
    expect(deps.invalidateContentPipelineIntelligence).toHaveBeenCalledOnce();
    expect(deps.broadcastToWorkspace).toHaveBeenCalledTimes(2);
    expect(deps.addActivity).toHaveBeenCalledOnce();
  });

  it.each([
    ['not_found', MCP_TOOL_ERROR_CODES.NOT_FOUND, false],
    ['conflict', MCP_TOOL_ERROR_CODES.CONFLICT, true],
    ['precondition_failed', MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED, false],
  ] as const)('maps pSEO %s failures to stable json_v1 errors', async (code, expectedCode, retryable) => {
    const deps = dependencies();
    deps.createMatrixFromPseoPlan.mockImplementation(() => {
      throw new PseoMatrixBridgeError(code, 'source_changed', 'sensitive detail');
    });
    const handle = createContentMatrixActionHandler(deps);

    const result = await handle('create_content_matrix_from_pseo_plan', {
      workspace_id: 'ws_1',
      blueprint_id: 'blueprint_1',
      entry_id: 'entry_1',
      expected_source_revision: pseoExpectedSource,
      dimensions: [{ variable_name: 'service', values: ['Laundry'] }],
    }, { ...context, toolName: 'create_content_matrix_from_pseo_plan' });

    expect(result.isError).toBe(true);
    expect(textPayload(result)).toMatchObject({
      code: expectedCode,
      retryable,
      details: { reason: 'source_changed' },
    });
    expect(JSON.stringify(textPayload(result))).not.toContain('sensitive detail');
  });

  it('returns field-addressed json_v1 validation errors', async () => {
    const handle = createContentMatrixActionHandler(dependencies());
    const result = await handle('get_content_matrix', { workspace_id: 'ws_1' }, context);

    expect(result.isError).toBe(true);
    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toMatchObject({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      retryable: false,
      details: { field_path: 'matrix_id' },
    });
    expect((textPayload(result) as { message: string }).message).toContain('matrix_id');
  });

  it('keeps direct-template not-found and cursor rejections field-addressed', async () => {
    const deps = dependencies();
    deps.getTemplate.mockReturnValue(null);
    const handle = createContentMatrixActionHandler(deps);

    const missing = await handle('get_content_template', {
      workspace_id: 'ws_1',
      template_id: 'tpl_missing',
    }, context);
    expect(textPayload(missing)).toMatchObject({
      code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
      details: {
        field_path: 'template_id',
        constraint: 'must identify an existing content template in this workspace',
      },
    });

    const invalidCursor = await handle('list_content_templates', {
      workspace_id: 'ws_1',
      cursor: 'e30',
    }, context);
    expect(textPayload(invalidCursor)).toMatchObject({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      details: {
        field_path: 'cursor',
        constraint: 'must be an opaque cursor returned by list_content_templates for this workspace',
      },
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

  it('maps generation preview selections and readiness to the snake_case MCP contract', async () => {
    const deps = dependencies();
    deps.previewMatrixGeneration.mockResolvedValue({
      estimatedBatchBudget: null,
      results: [{
        status: 'blocked',
        matrixId: 'mtx_1',
        templateId: 'tpl_1',
        cellId: 'cell_1',
        sourceRevision: { matrixRevision: 2, templateRevision: 4, cellRevision: 1 },
        evidenceRequirements: [{
          id: 'matrix-cell:cell_1:finalized-voice',
          fieldPath: 'brand.voice',
          claim: 'Current finalized voice is required.',
          reason: 'Paid generation requires finalized voice.',
          requirementStage: 'preflight',
          claimKind: 'structural',
          status: 'missing',
          sourceRefs: [],
        }],
        blockingRequirementIds: ['matrix-cell:cell_1:finalized-voice'],
        expectedArtifactRevisions: {
          brief: { artifactType: 'content_brief', artifactId: null, generationRevision: 0 },
          post: { artifactType: 'generated_post', artifactId: null, generationRevision: 0 },
        },
      }],
    });
    const handle = createContentMatrixActionHandler(deps);

    const result = await handle('preview_content_matrix_generation', {
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
    }, { ...context, toolName: 'preview_content_matrix_generation' });

    expect(deps.previewMatrixGeneration).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      matrixId: 'mtx_1',
      selections: [{
        cellId: 'cell_1',
        expectedSourceRevision: { matrixRevision: 2, templateRevision: 4, cellRevision: 1 },
      }],
    });
    expect(textPayload(result)).toMatchObject({
      estimated_batch_budget: null,
      results: [{
        status: 'blocked',
        cell_id: 'cell_1',
        source_revision: { matrix_revision: 2, template_revision: 4, cell_revision: 1 },
        blocking_requirement_ids: ['matrix-cell:cell_1:finalized-voice'],
        expected_artifact_revisions: {
          brief: { artifact_type: 'content_brief', artifact_id: null, generation_revision: 0 },
        },
      }],
      upgrade_proposals: [],
    });
  });

  it('attributes one evidence mutation to the MCP key and keeps replays side-effect free', async () => {
    const deps = dependencies();
    const expectedArtifactRevisions = {
      brief: { artifactType: 'content_brief' as const, artifactId: null, generationRevision: 0 },
      post: { artifactType: 'generated_post' as const, artifactId: null, generationRevision: 0 },
    };
    const resolution = {
      id: 'mce_1',
      workspaceId: 'ws_1',
      matrixId: 'mtx_1',
      cellId: 'cell_1',
      requirementId: 'matrix-cell:cell_1:service-availability',
      value: { kind: 'boolean' as const, value: true },
      sourceRef: {
        sourceType: 'operator_attestation' as const,
        sourceId: 'attestation_1',
        capturedAt: '2026-07-14T12:00:00.000Z',
      },
      resolvedBy: { actorType: 'mcp' as const, actorId: 'key_1', actorLabel: 'Test key' },
      expectedSourceRevision: { matrixRevision: 2, templateRevision: 4, cellRevision: 1 },
      expectedArtifactRevisions,
      resolvedAt: '2026-07-14T12:00:00.000Z',
    };
    deps.resolveContentMatrixEvidence.mockResolvedValueOnce({
      resolution,
      currentSourceRevision: { matrixRevision: 2, templateRevision: 4, cellRevision: 2 },
      created: true,
    }).mockResolvedValueOnce({
      resolution,
      currentSourceRevision: { matrixRevision: 2, templateRevision: 4, cellRevision: 2 },
      created: false,
    });
    const handle = createContentMatrixActionHandler(deps);
    const args = {
      workspace_id: 'ws_1',
      matrix_id: 'mtx_1',
      cell_id: 'cell_1',
      requirement_id: 'matrix-cell:cell_1:service-availability',
      value: { kind: 'boolean', value: true },
      source_ref: {
        source_type: 'operator_attestation',
        source_id: 'attestation_1',
        captured_at: '2026-07-14T12:00:00.000Z',
      },
      expected_source_revision: {
        matrix_revision: 2,
        template_revision: 4,
        cell_revision: 1,
      },
      expected_artifact_revisions: {
        brief: { artifact_type: 'content_brief', artifact_id: null, generation_revision: 0 },
        post: { artifact_type: 'generated_post', artifact_id: null, generation_revision: 0 },
      },
      idempotency_key: 'evidence-1',
    };

    const created = await handle(
      'resolve_content_matrix_evidence',
      args,
      { ...context, toolName: 'resolve_content_matrix_evidence' },
    );
    expect(deps.resolveContentMatrixEvidence).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      requirementId: 'matrix-cell:cell_1:service-availability',
      resolvedBy: { actorType: 'mcp', actorId: 'key_1', actorLabel: 'Test key' },
      expectedArtifactRevisions,
    }));
    expect(textPayload(created)).toMatchObject({
      created: true,
      current_source_revision: { cell_revision: 2 },
      resolution: { requirement_id: 'matrix-cell:cell_1:service-availability' },
    });
    expect(deps.invalidateContentPipelineIntelligence).toHaveBeenCalledOnce();
    expect(deps.broadcastToWorkspace).toHaveBeenCalledOnce();
    expect(deps.addActivity).toHaveBeenCalledOnce();

    await handle(
      'resolve_content_matrix_evidence',
      args,
      { ...context, toolName: 'resolve_content_matrix_evidence' },
    );
    expect(deps.invalidateContentPipelineIntelligence).toHaveBeenCalledOnce();
    expect(deps.broadcastToWorkspace).toHaveBeenCalledOnce();
    expect(deps.addActivity).toHaveBeenCalledOnce();
  });

  it('maps start, read, and selected retry through the batch service without approval authority', async () => {
    const deps = dependencies();
    const run = generationRun();
    const startResult: StartMatrixGenerationResult = {
      run,
      jobId: 'job_1',
      estimatedBudget: run.acceptedBudget!.estimate,
      existing: false,
    };
    deps.startMatrixGeneration
      .mockResolvedValueOnce(startResult)
      .mockResolvedValueOnce({ ...startResult, existing: true });
    const readResult: GetMatrixGenerationResult = {
      run,
      items: { items: [], nextCursor: null },
    };
    deps.getMatrixGeneration.mockReturnValue(readResult);
    const retryResult: RetryMatrixGenerationResult = {
      run: { ...run, status: 'running', revision: 1 },
      jobId: 'job_retry_1',
      existing: false,
    };
    deps.retryMatrixGeneration.mockReturnValue(retryResult);
    const handle = createContentMatrixActionHandler(deps);
    const startInput = {
      workspace_id: 'ws_1',
      matrix_id: 'mtx_1',
      selections: [{
        cell_id: 'cell_1',
        expected_source_revision: {
          matrix_revision: 2,
          template_revision: 4,
          cell_revision: 1,
        },
        expected_preview_fingerprint: 'b'.repeat(64),
      }],
      accepted_budget: {
        max_provider_calls: 15,
        max_input_tokens: 31_000,
        max_output_tokens: 27_500,
        max_estimated_usd: 0.98,
        max_concurrency: 1,
      },
      idempotency_key: 'matrix-start-1',
    };

    const started = await handle(
      'start_content_matrix_generation',
      startInput,
      { ...context, toolName: 'start_content_matrix_generation' },
    );
    await handle(
      'start_content_matrix_generation',
      startInput,
      { ...context, toolName: 'start_content_matrix_generation' },
    );
    expect(deps.startMatrixGeneration).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      matrixId: 'mtx_1',
      createdBy: {
        actorType: 'mcp',
        actorId: 'key_1',
        actorLabel: 'Test key',
      },
      mcpExecutionContext: expect.objectContaining({ toolName: 'start_content_matrix_generation' }),
    }));
    expect(textPayload(started)).toMatchObject({
      job_id: 'job_1',
      existing: false,
      dashboard_url: '/ws/ws_1/content-pipeline?tab=planner&matrix=mtx_1&run=run_1',
    });
    expect(deps.recordPaidCallOnce).toHaveBeenNthCalledWith(
      1,
      'mcp:matrix-generation:accepted-command:job_1',
      1,
      'ws_1',
    );
    expect(deps.recordPaidCallOnce).toHaveBeenNthCalledWith(
      2,
      'mcp:matrix-generation:accepted-command:job_1',
      1,
      'ws_1',
    );
    expect(deps.addActivity).toHaveBeenCalledTimes(1);

    const read = await handle('get_content_matrix_generation', {
      workspace_id: 'ws_1',
      run_id: 'run_1',
      limit: 10,
    }, { ...context, toolName: 'get_content_matrix_generation' });
    expect(deps.getMatrixGeneration).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      runId: 'run_1',
      cursor: undefined,
      limit: 10,
    });
    expect(textPayload(read)).toMatchObject({ run: { id: 'run_1' }, items: { items: [] } });

    const retried = await handle('retry_content_matrix_generation', {
      workspace_id: 'ws_1',
      run_id: 'run_1',
      expected_run_revision: 0,
      items: [{
        item_id: 'item_1',
        expected_item_revision: 3,
        source_revision: {
          matrix_revision: 2,
          template_revision: 4,
          cell_revision: 1,
        },
        expected_artifact_revisions: {
          brief: {
            artifact_type: 'content_brief',
            artifact_id: 'brief_1',
            generation_revision: 1,
          },
          post: {
            artifact_type: 'generated_post',
            artifact_id: 'post_1',
            generation_revision: 2,
          },
        },
        reusable_checkpoint_fingerprint: 'd'.repeat(64),
      }],
      idempotency_key: 'matrix-retry-1',
    }, { ...context, toolName: 'retry_content_matrix_generation' });
    expect(deps.retryMatrixGeneration).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws_1',
      runId: 'run_1',
      mode: 'resume',
      requestedBy: {
        actorType: 'mcp',
        actorId: 'key_1',
        actorLabel: 'Test key',
      },
      items: [expect.objectContaining({
        itemId: 'item_1',
        reusableCheckpointFingerprint: 'd'.repeat(64),
      })],
    }));
    expect(textPayload(retried)).toMatchObject({ job_id: 'job_retry_1', existing: false });
    expect(deps.recordPaidCallOnce).toHaveBeenNthCalledWith(
      3,
      'mcp:matrix-generation:accepted-command:job_retry_1',
      1,
      'ws_1',
    );
    expect(deps.addActivity).toHaveBeenCalledTimes(2);
    expect(deps.broadcastToWorkspace).toHaveBeenCalledTimes(2);
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
