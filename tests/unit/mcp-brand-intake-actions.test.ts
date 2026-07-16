import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import { brandIntakePayloadSchema } from '../../shared/types/brand-intake-schemas.js';
import { MCP_TOOL_ERROR_CODES, type McpToolExecutionContext } from '../../shared/types/mcp-runtime.js';
import type { ActivityEntry } from '../../server/activity-log.js';
import {
  BrandIntakePersistenceContractError,
  getBrandIntakeRevision,
  resolveBrandIntakeEvidence,
  submitBrandIntake,
} from '../../server/domains/brand/intake/index.js';
import {
  brandIntakeActionTools,
  createBrandIntakeActionHandler,
  type BrandIntakeActionDependencies,
} from '../../server/mcp/tools/brand-intake-actions.js';
import {
  getMcpToolExecutionContext,
  runWithMcpToolExecutionContext,
} from '../../server/mcp/tool-execution-context.js';
import { isValidatedMcpJsonV1ErrorResult } from '../../server/mcp/tool-errors.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace, getWorkspace } from '../../server/workspaces.js';

const cleanupWorkspaceIds: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const workspaceId of cleanupWorkspaceIds.splice(0)) deleteWorkspace(workspaceId);
});

function createTestWorkspace(label: string): string {
  const workspace = createWorkspace(`MCP Brand Intake ${label} ${randomUUID()}`);
  cleanupWorkspaceIds.push(workspace.id);
  return workspace.id;
}

function payload(description = 'Patient-first dental care.') {
  return brandIntakePayloadSchema.parse({
    schemaVersion: 1,
    business: {
      businessName: 'Northstar Dental',
      industry: 'Dentistry',
      description,
      services: 'Preventive care',
      locations: 'Austin, Texas',
      differentiators: 'Longer appointments.',
      website: '',
    },
    audience: {
      primaryAudience: 'Busy families',
      painPoints: 'Confusing treatment plans',
      goals: 'Understand every option',
      objections: 'Cost uncertainty',
      buyingStage: 'consideration',
      secondaryAudience: '',
    },
    brand: {
      tone: 'Warm and direct',
      personality: ['Patient', 'Clear'],
      avoidWords: 'Guaranteed',
      contentFormats: ['Guides'],
      existingExamples: 'We explain what matters.',
    },
    competitors: {
      competitors: '',
      whatTheyDoBetter: '',
      whatYouDoBetter: '',
      referenceUrls: '',
    },
    authenticSamples: [],
  });
}

function seedIntake(workspaceId: string, description?: string) {
  return submitBrandIntake({
    workspaceId,
    payload: payload(description),
    source: 'client_portal',
    submitter: {
      actorType: 'client',
      actorId: `client:${workspaceId}`,
      actorLabel: 'Client portal',
    },
  }).revision;
}

function workspaceContext(workspaceId: string): McpToolExecutionContext {
  return {
    requestId: 'request-brand-intake-1',
    toolName: 'resolve_brand_intake_evidence',
    targetWorkspaceId: workspaceId,
    caller: {
      kind: 'workspace_key',
      scope: workspaceId,
      workspaceId,
      keyId: 'mcp_key_brand_intake',
      keyLabel: 'Brand intake operator',
    },
  };
}

function masterContext(workspaceId: string): McpToolExecutionContext {
  return {
    requestId: 'request-brand-intake-master',
    toolName: 'resolve_brand_intake_evidence',
    targetWorkspaceId: workspaceId,
    caller: {
      kind: 'master_key',
      scope: 'all',
      keyId: null,
      keyLabel: null,
    },
  };
}

function resolutionArgs(
  workspaceId: string,
  intakeRevisionId: string,
  expectedRevision: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    workspace_id: workspaceId,
    intake_revision_id: intakeRevisionId,
    expected_revision: expectedRevision,
    requirement_id: 'brand-intake:business.website',
    field_path: 'business.website',
    value: { kind: 'url', value: 'https://verified.example' },
    source_ref: {
      source_type: 'operator_attestation',
      source_id: 'attestation-website-1',
      field_path: 'business.website',
      captured_at: '2026-07-13T12:00:00.000Z',
    },
    idempotency_key: 'resolve-website-1',
    ...overrides,
  };
}

function textPayload(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0];
  expect(content?.type).toBe('text');
  return JSON.parse(content && 'text' in content ? content.text : '{}') as Record<string, unknown>;
}

function sideEffectDependencies() {
  let activityContext: McpToolExecutionContext | undefined;
  const addActivity = vi.fn((
    workspaceId: string,
    type: ActivityEntry['type'],
    title: string,
    description?: string,
    metadata?: Record<string, unknown>,
  ): ActivityEntry => {
    activityContext = getMcpToolExecutionContext();
    return {
      id: 'activity-brand-intake-1',
      workspaceId,
      type,
      title,
      description,
      metadata: activityContext ? { ...metadata, mcpCaller: activityContext } : metadata,
      createdAt: '2026-07-13T12:01:00.000Z',
    };
  });
  const broadcastToWorkspace = vi.fn();
  const invalidateIntelligenceCache = vi.fn();
  const dependencies: BrandIntakeActionDependencies = {
    getWorkspace,
    submitBrandIntake,
    getBrandIntakeRevision,
    resolveBrandIntakeEvidence,
    addActivity,
    broadcastToWorkspace,
    invalidateIntelligenceCache,
  };
  return {
    dependencies,
    addActivity,
    broadcastToWorkspace,
    invalidateIntelligenceCache,
    activityContext: () => activityContext,
  };
}

describe('MCP brand intake actions', () => {
  it('advertises one dedicated three-tool snake_case family', () => {
    expect(brandIntakeActionTools.map(tool => tool.name)).toEqual([
      'submit_brand_intake',
      'get_brand_intake',
      'resolve_brand_intake_evidence',
    ]);
    for (const tool of brandIntakeActionTools as Tool[]) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toHaveProperty('workspace_id');
      expect(tool.inputSchema.properties).not.toHaveProperty('workspaceId');
      expect(tool.description).toEqual(expect.any(String));
    }
  });

  it('submits an immutable MCP intake idempotently and emits effects once', async () => {
    const workspaceId = createTestWorkspace('submit');
    const effects = sideEffectDependencies();
    const handle = createBrandIntakeActionHandler(effects.dependencies);
    const args = {
      workspace_id: workspaceId,
      questionnaire: {
        business: {
          business_name: 'Northstar Dental',
          industry: 'Dentistry',
          description: 'Patient-first dental care.',
          services: 'Preventive care',
          locations: 'Austin, Texas',
        },
        brand: {
          tone: 'Warm and direct',
          personality: ['Patient', 'Clear'],
          avoid_words: 'Guaranteed',
        },
      },
      idempotency_key: 'mcp-intake-submit-1',
    };

    const first = await handle('submit_brand_intake', args, workspaceContext(workspaceId));
    const replay = await handle('submit_brand_intake', args, workspaceContext(workspaceId));

    expect(textPayload(first)).toMatchObject({
      revision: {
        workspace_id: workspaceId,
        source: 'mcp',
        submitter: { actor_type: 'mcp', actor_id: 'mcp_key_brand_intake' },
        payload: { business: { business_name: 'Northstar Dental' } },
      },
      created: true,
      replayed: false,
    });
    expect(textPayload(replay)).toMatchObject({ created: false, replayed: true });
    expect(effects.addActivity).toHaveBeenCalledTimes(1);
    expect(effects.broadcastToWorkspace).toHaveBeenCalledTimes(1);
    expect(effects.invalidateIntelligenceCache).toHaveBeenCalledTimes(1);
  });

  it('replays a delayed intake retry without restoring stale questionnaire content', async () => {
    const workspaceId = createTestWorkspace('delayed-replay');
    const handle = createBrandIntakeActionHandler();
    const firstArgs = {
      workspace_id: workspaceId,
      questionnaire: { business: { business_name: 'First Brand' } },
      idempotency_key: 'mcp-intake-delayed-first',
    };
    const first = await handle('submit_brand_intake', firstArgs, workspaceContext(workspaceId));
    await handle('submit_brand_intake', {
      workspace_id: workspaceId,
      questionnaire: { business: { business_name: 'Current Brand' } },
      idempotency_key: 'mcp-intake-delayed-second',
    }, workspaceContext(workspaceId));
    const replay = await handle('submit_brand_intake', firstArgs, workspaceContext(workspaceId));
    const current = await handle('get_brand_intake', {
      workspace_id: workspaceId,
    }, workspaceContext(workspaceId));

    expect(textPayload(replay)).toMatchObject({
      revision: { id: (textPayload(first).revision as { id: string }).id },
      created: false,
      replayed: true,
    });
    expect(textPayload(current)).toMatchObject({
      revision: { revision: 2, payload: { business: { business_name: 'Current Brand' } } },
    });
  });

  it('conflicts when an intake idempotency key is reused for different content', async () => {
    const workspaceId = createTestWorkspace('submit-conflict');
    const handle = createBrandIntakeActionHandler();
    const base = {
      workspace_id: workspaceId,
      questionnaire: { business: { business_name: 'Northstar Dental' } },
      idempotency_key: 'mcp-intake-submit-conflict',
    };
    await handle('submit_brand_intake', base, workspaceContext(workspaceId));
    const conflict = await handle('submit_brand_intake', {
      ...base,
      questionnaire: { business: { business_name: 'Changed Brand' } },
    }, workspaceContext(workspaceId));

    expect(isValidatedMcpJsonV1ErrorResult(conflict)).toBe(true);
    expect(textPayload(conflict)).toMatchObject({
      code: MCP_TOOL_ERROR_CODES.CONFLICT,
      retryable: false,
    });
  });

  it('reads the current or named immutable revision and returns an empty current read', async () => {
    const workspaceId = createTestWorkspace('read');
    const context = workspaceContext(workspaceId);
    const handle = createBrandIntakeActionHandler();

    const empty = await handle('get_brand_intake', { workspace_id: workspaceId }, context);
    expect(textPayload(empty)).toEqual({ revision: null, field_evidence: [] });

    const first = seedIntake(workspaceId);
    const second = seedIntake(workspaceId, 'A changed description.');
    const current = await handle('get_brand_intake', { workspace_id: workspaceId }, context);
    const named = await handle('get_brand_intake', {
      workspace_id: workspaceId,
      intake_revision_id: first.id,
    }, context);

    expect(textPayload(current)).toMatchObject({
      revision: { id: second.id, workspace_id: workspaceId, revision: 2 },
      field_evidence: expect.arrayContaining([
        expect.objectContaining({
          requirement_id: 'brand-intake:business.website',
          field_path: 'business.website',
          availability: 'missing',
        }),
      ]),
    });
    expect(textPayload(named)).toMatchObject({
      revision: {
        id: first.id,
        revision: 1,
        superseded_by_revision_id: second.id,
        payload: { business: { description: 'Patient-first dental care.' } },
      },
    });
  });

  it('returns not_found for an explicitly named absent revision', async () => {
    const workspaceId = createTestWorkspace('named-missing');
    const result = await createBrandIntakeActionHandler()('get_brand_intake', {
      workspace_id: workspaceId,
      intake_revision_id: 'intake-does-not-exist',
    }, workspaceContext(workspaceId));

    expect(result.isError).toBe(true);
    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toEqual({
      code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
      message: 'The requested workspace or brand-intake revision was not found.',
      retryable: false,
    });
  });

  it('returns not_found rather than an empty intake for a nonexistent workspace', async () => {
    const missingWorkspaceId = `missing-brand-intake-${randomUUID()}`;
    const result = await createBrandIntakeActionHandler()(
      'get_brand_intake',
      { workspace_id: missingWorkspaceId },
      masterContext(missingWorkspaceId),
    );

    expect(result.isError).toBe(true);
    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toEqual({
      code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
      message: 'The requested workspace or brand-intake revision was not found.',
      retryable: false,
    });
  });

  it('commits one attributed resolution and emits post-commit side effects exactly once', async () => {
    const workspaceId = createTestWorkspace('resolve');
    const source = seedIntake(workspaceId);
    const sideEffects = sideEffectDependencies();
    const handle = createBrandIntakeActionHandler(sideEffects.dependencies);
    const context = workspaceContext(workspaceId);
    const args = resolutionArgs(workspaceId, source.id, source.revision);

    const created = await runWithMcpToolExecutionContext(
      context,
      () => handle('resolve_brand_intake_evidence', args, context),
    );
    const replay = await runWithMcpToolExecutionContext(
      context,
      () => handle('resolve_brand_intake_evidence', args, context),
    );

    expect(textPayload(created)).toMatchObject({
      created: true,
      replayed: false,
      revision: {
        revision: 2,
        source: 'mcp',
        submitter: {
          actor_type: 'mcp',
          actor_id: 'mcp_key_brand_intake',
          actor_label: 'Brand intake operator',
        },
        evidence_resolutions: [{
          requirement_id: 'brand-intake:business.website',
          resolved_by: {
            actor_type: 'mcp',
            actor_id: 'mcp_key_brand_intake',
            actor_label: 'Brand intake operator',
          },
        }],
      },
    });
    expect(textPayload(replay)).toMatchObject({ created: false, replayed: true });
    expect(sideEffects.addActivity).toHaveBeenCalledTimes(1);
    expect(sideEffects.broadcastToWorkspace).toHaveBeenCalledTimes(1);
    expect(sideEffects.invalidateIntelligenceCache).toHaveBeenCalledTimes(1);
    expect(sideEffects.addActivity).toHaveBeenCalledWith(
      workspaceId,
      'brand_intake_evidence_resolved',
      'Resolved brand intake evidence',
      'Brand intake revision 2',
      expect.objectContaining({ source: 'mcp-chat', revision: 2 }),
    );
    expect(sideEffects.broadcastToWorkspace).toHaveBeenCalledWith(
      workspaceId,
      WS_EVENTS.WORKSPACE_UPDATED,
      expect.objectContaining({
        domain: 'brand-intake',
        action: 'revision_created',
        cause: 'evidence_resolution',
        revision: 2,
      }),
    );
    expect(sideEffects.activityContext()).toEqual(context);
    expect(sideEffects.addActivity.mock.invocationCallOrder[0])
      .toBeLessThan(sideEffects.broadcastToWorkspace.mock.invocationCallOrder[0]!);
    expect(sideEffects.broadcastToWorkspace.mock.invocationCallOrder[0])
      .toBeLessThan(sideEffects.invalidateIntelligenceCache.mock.invocationCallOrder[0]!);
    expect(JSON.stringify(textPayload(created))).not.toContain('authorization');
  });

  it('derives a bounded non-secret attribution for the master caller', async () => {
    const workspaceId = createTestWorkspace('master-attribution');
    const source = seedIntake(workspaceId);
    const sideEffects = sideEffectDependencies();
    const context = masterContext(workspaceId);
    const result = await createBrandIntakeActionHandler(sideEffects.dependencies)(
      'resolve_brand_intake_evidence',
      resolutionArgs(workspaceId, source.id, source.revision, {
        idempotency_key: 'resolve-master-website',
      }),
      context,
    );

    expect(textPayload(result)).toMatchObject({
      revision: {
        evidence_resolutions: [{
          resolved_by: {
            actor_type: 'mcp',
            actor_id: 'mcp:master-key',
            actor_label: 'MCP master key',
          },
        }],
      },
    });
  });

  it('returns the committed resolution and continues later effects when activity logging fails', async () => {
    const workspaceId = createTestWorkspace('best-effort-effects');
    const source = seedIntake(workspaceId);
    const sideEffects = sideEffectDependencies();
    const failingActivity = vi.fn(() => {
      throw new Error('activity storage unavailable');
    });
    const handle = createBrandIntakeActionHandler({
      ...sideEffects.dependencies,
      addActivity: failingActivity,
    });

    const result = await handle(
      'resolve_brand_intake_evidence',
      resolutionArgs(workspaceId, source.id, source.revision, {
        idempotency_key: 'resolve-best-effort-effects',
      }),
      workspaceContext(workspaceId),
    );

    expect(result.isError).not.toBe(true);
    expect(textPayload(result)).toMatchObject({ created: true, replayed: false });
    expect(failingActivity).toHaveBeenCalledTimes(1);
    expect(sideEffects.broadcastToWorkspace).toHaveBeenCalledTimes(1);
    expect(sideEffects.invalidateIntelligenceCache).toHaveBeenCalledTimes(1);
    expect(getBrandIntakeRevision({ workspaceId }).revision).toMatchObject({ revision: 2 });
  });

  it('maps stale, idempotency, missing, and cross-workspace resources without leaking rows', async () => {
    const sourceWorkspaceId = createTestWorkspace('errors-source');
    const otherWorkspaceId = createTestWorkspace('errors-other');
    const source = seedIntake(sourceWorkspaceId);
    const handle = createBrandIntakeActionHandler(sideEffectDependencies().dependencies);
    const context = workspaceContext(sourceWorkspaceId);
    const originalArgs = resolutionArgs(sourceWorkspaceId, source.id, source.revision);
    await handle('resolve_brand_intake_evidence', originalArgs, context);

    const stale = await handle('resolve_brand_intake_evidence', {
      ...originalArgs,
      idempotency_key: 'resolve-stale-website',
    }, context);
    expect(textPayload(stale)).toEqual({
      code: MCP_TOOL_ERROR_CODES.CONFLICT,
      message: 'The brand intake changed. Re-read it and retry against the current revision.',
      retryable: true,
      details: { expected_revision: 1, actual_revision: 2 },
    });

    const idempotencyConflict = await handle('resolve_brand_intake_evidence', {
      ...originalArgs,
      value: { kind: 'url', value: 'https://different.example' },
    }, context);
    expect(textPayload(idempotencyConflict)).toEqual({
      code: MCP_TOOL_ERROR_CODES.CONFLICT,
      message: 'The idempotency key already represents a different brand-intake resolution.',
      retryable: false,
    });

    const missing = await handle('resolve_brand_intake_evidence', resolutionArgs(
      sourceWorkspaceId,
      'intake-does-not-exist',
      999,
      { idempotency_key: 'resolve-missing-revision' },
    ), context);
    expect(textPayload(missing)).toMatchObject({ code: MCP_TOOL_ERROR_CODES.NOT_FOUND });

    const crossWorkspace = await handle('resolve_brand_intake_evidence', resolutionArgs(
      otherWorkspaceId,
      source.id,
      source.revision,
      { idempotency_key: 'resolve-cross-workspace' },
    ), workspaceContext(otherWorkspaceId));
    expect(textPayload(crossWorkspace)).toMatchObject({ code: MCP_TOOL_ERROR_CODES.NOT_FOUND });
    expect(getBrandIntakeRevision({ workspaceId: otherWorkspaceId })).toEqual({
      revision: null,
      fieldEvidence: [],
    });
  });

  it('returns branded validation and unknown-tool errors', async () => {
    const workspaceId = createTestWorkspace('validation');
    const handle = createBrandIntakeActionHandler();
    const context = workspaceContext(workspaceId);
    const invalid = await handle('resolve_brand_intake_evidence', {
      workspace_id: workspaceId,
      requirement_id: 'brand-intake:business.website',
      field_path: 'business.description',
    }, context);
    const unknown = await handle('not_a_brand_intake_tool', {}, context);

    expect(isValidatedMcpJsonV1ErrorResult(invalid)).toBe(true);
    expect(textPayload(invalid)).toMatchObject({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      retryable: false,
      details: { field_path: 'intake_revision_id' },
    });
    expect(isValidatedMcpJsonV1ErrorResult(unknown)).toBe(true);
    expect(textPayload(unknown)).toEqual({
      code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
      message: 'Unknown brand intake tool: the requested tool does not exist.',
      retryable: false,
    });
  });

  it('maps persistence-contract and unexpected failures to the same safe internal envelope', async () => {
    const workspaceId = createTestWorkspace('internal-errors');
    const context = workspaceContext(workspaceId);
    const base = sideEffectDependencies().dependencies;
    const persistenceHandler = createBrandIntakeActionHandler({
      ...base,
      getBrandIntakeRevision: () => {
        throw new BrandIntakePersistenceContractError('secret persisted payload');
      },
    });
    const unexpectedHandler = createBrandIntakeActionHandler({
      ...base,
      getBrandIntakeRevision: () => {
        throw new Error('Bearer secret-token-value');
      },
    });

    for (const result of [
      await persistenceHandler('get_brand_intake', { workspace_id: workspaceId }, context),
      await unexpectedHandler('get_brand_intake', { workspace_id: workspaceId }, context),
    ]) {
      expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
      expect(textPayload(result)).toEqual({
        code: MCP_TOOL_ERROR_CODES.INTERNAL_ERROR,
        message: 'The tool could not complete because of an internal error.',
        retryable: false,
      });
      expect(JSON.stringify(textPayload(result))).not.toContain('secret');
    }
  });
});
