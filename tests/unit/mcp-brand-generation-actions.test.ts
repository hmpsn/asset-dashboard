import type { Tool } from '@modelcontextprotocol/sdk/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  recordPaidCallOnce: vi.fn(
    (
      _eventKey: string,
      _increment = 1,
      _workspaceId?: string,
    ): { count: number; warning?: string } => ({ count: 1 }),
  ),
}));

vi.mock('../../server/domains/brand/generation/service.js', () => ({
  startBrandGeneration: vi.fn(),
  getBrandGeneration: vi.fn(),
  resumeBrandGeneration: vi.fn(),
  reviseBrandGenerationItem: vi.fn(),
}));

vi.mock('../../server/mcp/paid-call-counter.js', () => ({
  recordPaidCallOnce: h.recordPaidCallOnce,
}));

import type {
  GetBrandGenerationResult,
  StartBrandGenerationResult,
} from '../../shared/types/brand-generation.js';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolExecutionContext,
} from '../../shared/types/mcp-runtime.js';
import {
  BrandGenerationApprovedDeliverableError,
  BrandGenerationBudgetExceededError,
  BrandGenerationConcurrencyLimitError,
  BrandGenerationCursorError,
  BrandGenerationIdempotencyConflictError,
  BrandGenerationNotFoundError,
  BrandGenerationPreconditionError,
  BrandGenerationRevisionConflictError,
} from '../../server/domains/brand/generation/errors.js';
import {
  brandGenerationActionTools,
  createBrandGenerationActionHandler,
  type BrandGenerationActionDependencies,
} from '../../server/mcp/tools/brand-generation-actions.js';
import { isValidatedMcpJsonV1ErrorResult } from '../../server/mcp/tool-errors.js';

const WORKSPACE_ID = 'ws_brand_generation';
const RUN_ID = 'brand_run_1';
const ITEM_ID = 'brand_item_1';
const FINGERPRINT = 'a'.repeat(64);
const VOICE_FINGERPRINT = 'b'.repeat(64);
const SIGNED_ITEM_CURSOR = `${Buffer.from(JSON.stringify({
  schemaVersion: 1,
  workspaceId: WORKSPACE_ID,
  runId: RUN_ID,
  runRevision: 3,
})).toString('base64url')}.${Buffer.from('cursor-hmac-signature').toString('base64url')}`;

const BUDGET_INPUT = {
  max_provider_calls: 6,
  max_input_tokens: 50_000,
  max_output_tokens: 8_000,
  max_estimated_cost_micros: 2_000_000,
  max_concurrency: 2,
};

function workspaceContext(toolName = 'start_brand_deliverable_generation'): McpToolExecutionContext {
  return {
    requestId: 'brand_generation_request_1',
    toolName,
    targetWorkspaceId: WORKSPACE_ID,
    caller: {
      kind: 'workspace_key',
      scope: WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      keyId: 'mcp_brand_key_1',
      keyLabel: 'Brand automation',
    },
  };
}

function commandResult(
  existing = false,
  jobId = 'job_brand_1',
): StartBrandGenerationResult {
  return {
    runId: RUN_ID,
    runRevision: 0,
    jobId,
    selectionCount: 1,
    estimate: {
      providerCalls: 3,
      inputTokens: 12_000,
      outputTokens: 2_000,
      estimatedCostMicros: 500_000,
      maxConcurrency: 1,
    },
    dashboardUrl: `/ws/${WORKSPACE_ID}/brand`,
    existing,
  };
}

function getResult(): GetBrandGenerationResult {
  return {
    run: {
      id: RUN_ID,
      workspaceId: WORKSPACE_ID,
      intakeRevision: {
        intakeRevisionId: 'intake_revision_1',
        revision: 2,
        fingerprint: FINGERPRINT,
        auditedAt: '2026-07-14T10:00:00.000Z',
      },
      selection: { kind: 'atomic', target: 'voice_foundation' },
      selectedTargets: ['voice_foundation'],
      status: 'awaiting_review',
      stage: 'awaiting_voice_finalization',
      revision: 3,
      selectionFingerprint: 'c'.repeat(64),
      effectiveInputFingerprint: 'd'.repeat(64),
      currentJobId: null,
      voiceReadiness: {
        state: 'provisional',
        foundationItemId: ITEM_ID,
        blockingReasons: ['Voice requires explicit human finalization.'],
      },
      counts: {
        selected: 1,
        queued: 0,
        running: 0,
        readyForHumanReview: 1,
        needsAttention: 0,
        blocked: 0,
        conflicts: 0,
        failed: 0,
        cancelled: 0,
        approved: 0,
        changesRequested: 0,
      },
      budget: {
        estimate: {
          providerCalls: 3,
          inputTokens: 12_000,
          outputTokens: 2_000,
          estimatedCostMicros: 500_000,
          maxConcurrency: 1,
        },
        limits: {
          providerCalls: 6,
          inputTokens: 50_000,
          outputTokens: 8_000,
          maxEstimatedCostMicros: 2_000_000,
          maxConcurrency: 2,
        },
        reserved: {
          providerCalls: 2,
          inputTokens: 8_000,
          outputTokens: 1_000,
          estimatedCostMicros: 300_000,
        },
      },
      createdBy: { actorType: 'mcp' },
      createdAt: '2026-07-14T10:00:00.000Z',
      updatedAt: '2026-07-14T10:02:00.000Z',
      completedAt: null,
    },
    itemPage: {
      items: [],
      nextCursor: 'next_brand_item_cursor',
      hasMore: true,
    },
  };
}

function dependencies() {
  const startBrandGeneration = vi.fn<BrandGenerationActionDependencies['startBrandGeneration']>(
    () => commandResult(),
  );
  const getBrandGeneration = vi.fn<BrandGenerationActionDependencies['getBrandGeneration']>(
    () => getResult(),
  );
  const resumeBrandGeneration = vi.fn<BrandGenerationActionDependencies['resumeBrandGeneration']>(
    () => commandResult(false, 'job_brand_resume_1'),
  );
  const reviseBrandGenerationItem = vi.fn<
    BrandGenerationActionDependencies['reviseBrandGenerationItem']
  >(() => commandResult(false, 'job_brand_revision_1'));
  const value: BrandGenerationActionDependencies = {
    startBrandGeneration,
    getBrandGeneration,
    resumeBrandGeneration,
    reviseBrandGenerationItem,
  };
  return {
    value,
    startBrandGeneration,
    getBrandGeneration,
    resumeBrandGeneration,
    reviseBrandGenerationItem,
  };
}

function textPayload(
  result: Awaited<ReturnType<ReturnType<typeof createBrandGenerationActionHandler>>>,
): Record<string, unknown> {
  const content = result.content[0];
  expect(content?.type).toBe('text');
  return JSON.parse(content && 'text' in content ? content.text : '{}') as Record<string, unknown>;
}

describe('MCP brand generation actions', () => {
  beforeEach(() => {
    h.recordPaidCallOnce.mockReset();
    h.recordPaidCallOnce.mockReturnValue({ count: 1 });
  });

  it('advertises a dedicated four-tool snake_case JSON-v1 family', () => {
    expect(brandGenerationActionTools.map(tool => tool.name)).toEqual([
      'start_brand_deliverable_generation',
      'get_brand_generation',
      'resume_brand_deliverable_generation',
      'start_brand_deliverable_revision',
    ]);
    for (const tool of brandGenerationActionTools as Tool[]) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      const properties = tool.inputSchema.properties as Record<string, { description?: string }>;
      expect(properties.workspace_id?.description).toEqual(expect.any(String));
      expect(properties).not.toHaveProperty('workspaceId');
      for (const property of Object.values(properties)) {
        expect(property.description).toEqual(expect.any(String));
      }
    }
    expect(brandGenerationActionTools[0]?.description).toMatch(/^\[Paid API\]/);
    expect(brandGenerationActionTools[1]?.description).not.toMatch(/^\[Paid API\]/);
    expect(brandGenerationActionTools[2]?.description).toMatch(/^\[Paid API\]/);
    expect(brandGenerationActionTools[3]?.description).toMatch(/^\[Paid API\]/);
  });

  it('starts paid work with exact authority, budget, MCP attribution, and execution context', async () => {
    const deps = dependencies();
    const context = workspaceContext();
    const result = await createBrandGenerationActionHandler(deps.value)(
      'start_brand_deliverable_generation',
      {
        workspace_id: WORKSPACE_ID,
        intake_revision_id: 'intake_revision_1',
        expected_intake_revision: 2,
        expected_intake_fingerprint: FINGERPRINT,
        selection: { kind: 'atomic', target: 'mission' },
        expected_voice_version: 4,
        expected_voice_fingerprint: VOICE_FINGERPRINT,
        budget: BUDGET_INPUT,
        idempotency_key: 'brand-start-1',
      },
      context,
    );

    expect(result.isError).not.toBe(true);
    expect(deps.startBrandGeneration).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      intakeRevisionId: 'intake_revision_1',
      expectedIntakeRevision: 2,
      expectedIntakeFingerprint: FINGERPRINT,
      selection: { kind: 'atomic', target: 'mission' },
      expectedVoiceVersion: 4,
      expectedVoiceFingerprint: VOICE_FINGERPRINT,
      budget: {
        maxProviderCalls: 6,
        maxInputTokens: 50_000,
        maxOutputTokens: 8_000,
        maxEstimatedCostMicros: 2_000_000,
        maxConcurrency: 2,
      },
      idempotencyKey: 'brand-start-1',
      createdBy: {
        actorType: 'mcp',
        actorId: 'mcp_brand_key_1',
        actorLabel: 'Brand automation',
      },
      mcpExecutionContext: context,
    });
    expect(textPayload(result)).toEqual({
      run_id: RUN_ID,
      run_revision: 0,
      job_id: 'job_brand_1',
      selection_count: 1,
      estimate: {
        provider_calls: 3,
        input_tokens: 12_000,
        output_tokens: 2_000,
        estimated_cost_micros: 500_000,
        max_concurrency: 1,
      },
      dashboard_url: `/ws/${WORKSPACE_ID}/brand`,
      existing: false,
    });
  });

  it('supports the voice-foundation bootstrap without inventing finalized voice authority', async () => {
    const deps = dependencies();
    await createBrandGenerationActionHandler(deps.value)(
      'start_brand_deliverable_generation',
      {
        workspace_id: WORKSPACE_ID,
        intake_revision_id: 'intake_revision_1',
        expected_intake_revision: 2,
        expected_intake_fingerprint: FINGERPRINT,
        selection: { kind: 'preset', preset: 'full_brand_system' },
        budget: BUDGET_INPUT,
        idempotency_key: 'brand-bootstrap-1',
      },
      workspaceContext(),
    );

    expect(deps.startBrandGeneration).toHaveBeenCalledWith(expect.not.objectContaining({
      expectedVoiceVersion: expect.anything(),
      expectedVoiceFingerprint: expect.anything(),
    }));
  });

  it('pages a public read and strips persisted idempotency plus MCP identity defensively', async () => {
    const deps = dependencies();
    deps.getBrandGeneration.mockReturnValue({
      ...getResult(),
      run: {
        ...getResult().run,
        createdBy: {
          actorType: 'mcp',
          actorId: 'mcp_brand_key_1',
          actorLabel: 'Brand automation',
        },
        idempotencyKey: 'must-not-escape',
        mcpExecutionContext: workspaceContext('get_brand_generation'),
        requestSnapshot: { rawIntake: 'private' },
      },
    } as never);

    const result = await createBrandGenerationActionHandler(deps.value)(
      'get_brand_generation',
      {
        workspace_id: WORKSPACE_ID,
        run_id: RUN_ID,
        item_cursor: SIGNED_ITEM_CURSOR,
        item_limit: 25,
      },
      workspaceContext('get_brand_generation'),
    );

    expect(deps.getBrandGeneration).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      cursor: SIGNED_ITEM_CURSOR,
      limit: 25,
    });
    expect(textPayload(result)).toMatchObject({
      run: {
        id: RUN_ID,
        workspace_id: WORKSPACE_ID,
        created_by: { actor_type: 'mcp' },
        voice_readiness: { foundation_item_id: ITEM_ID },
      },
      item_page: {
        next_cursor: 'next_brand_item_cursor',
        has_more: true,
      },
    });
    const serialized = JSON.stringify(textPayload(result));
    expect(serialized).not.toContain('must-not-escape');
    expect(serialized).not.toContain('idempotency');
    expect(serialized).not.toContain('mcp_brand_key_1');
    expect(serialized).not.toContain('Brand automation');
    expect(serialized).not.toContain('request_snapshot');
    expect(serialized).not.toContain('raw_intake');
  });

  it('resumes against exact run and finalized voice authority', async () => {
    const deps = dependencies();
    const context = workspaceContext('resume_brand_deliverable_generation');
    await createBrandGenerationActionHandler(deps.value)(
      'resume_brand_deliverable_generation',
      {
        workspace_id: WORKSPACE_ID,
        run_id: RUN_ID,
        expected_run_revision: 3,
        expected_voice_version: 4,
        expected_voice_fingerprint: VOICE_FINGERPRINT,
        idempotency_key: 'brand-resume-1',
      },
      context,
    );

    expect(deps.resumeBrandGeneration).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      expectedRunRevision: 3,
      expectedVoiceVersion: 4,
      expectedVoiceFingerprint: VOICE_FINGERPRINT,
      idempotencyKey: 'brand-resume-1',
      resumedBy: {
        actorType: 'mcp',
        actorId: 'mcp_brand_key_1',
        actorLabel: 'Brand automation',
      },
      mcpExecutionContext: context,
    });
  });

  it('starts a version-conditional review-directed revision', async () => {
    const deps = dependencies();
    const context = workspaceContext('start_brand_deliverable_revision');
    await createBrandGenerationActionHandler(deps.value)(
      'start_brand_deliverable_revision',
      {
        workspace_id: WORKSPACE_ID,
        run_id: RUN_ID,
        item_id: ITEM_ID,
        expected_run_revision: 4,
        expected_item_revision: 2,
        deliverable_id: 'deliverable_1',
        expected_deliverable_version: 3,
        direction: 'Make the positioning more specific and keep every claim grounded.',
        idempotency_key: 'brand-revision-1',
      },
      context,
    );

    expect(deps.reviseBrandGenerationItem).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      runId: RUN_ID,
      itemId: ITEM_ID,
      expectedRunRevision: 4,
      expectedItemRevision: 2,
      deliverableId: 'deliverable_1',
      expectedDeliverableVersion: 3,
      direction: 'Make the positioning more specific and keep every claim grounded.',
      idempotencyKey: 'brand-revision-1',
      requestedBy: {
        actorType: 'mcp',
        actorId: 'mcp_brand_key_1',
        actorLabel: 'Brand automation',
      },
      mcpExecutionContext: context,
    });
  });

  it('submits each accepted paid command under a stable job event and leaves reads free', async () => {
    const deps = dependencies();
    const handle = createBrandGenerationActionHandler(deps.value);

    await handle(
      'start_brand_deliverable_generation',
      {
        workspace_id: WORKSPACE_ID,
        intake_revision_id: 'intake_revision_1',
        expected_intake_revision: 2,
        expected_intake_fingerprint: FINGERPRINT,
        selection: { kind: 'atomic', target: 'mission' },
        expected_voice_version: 4,
        expected_voice_fingerprint: VOICE_FINGERPRINT,
        budget: BUDGET_INPUT,
        idempotency_key: 'brand-start-metered',
      },
      workspaceContext(),
    );
    await handle(
      'get_brand_generation',
      { workspace_id: WORKSPACE_ID, run_id: RUN_ID },
      workspaceContext('get_brand_generation'),
    );
    await handle(
      'resume_brand_deliverable_generation',
      {
        workspace_id: WORKSPACE_ID,
        run_id: RUN_ID,
        expected_run_revision: 3,
        expected_voice_version: 4,
        expected_voice_fingerprint: VOICE_FINGERPRINT,
        idempotency_key: 'brand-resume-metered',
      },
      workspaceContext('resume_brand_deliverable_generation'),
    );
    await handle(
      'start_brand_deliverable_revision',
      {
        workspace_id: WORKSPACE_ID,
        run_id: RUN_ID,
        item_id: ITEM_ID,
        expected_run_revision: 4,
        expected_item_revision: 2,
        deliverable_id: 'deliverable_1',
        expected_deliverable_version: 3,
        direction: 'Keep every claim grounded.',
        idempotency_key: 'brand-revision-metered',
      },
      workspaceContext('start_brand_deliverable_revision'),
    );

    expect(h.recordPaidCallOnce).toHaveBeenCalledTimes(3);
    expect(h.recordPaidCallOnce).toHaveBeenNthCalledWith(
      1,
      'mcp:brand-generation:accepted-command:job_brand_1',
      1,
      WORKSPACE_ID,
    );
    expect(h.recordPaidCallOnce).toHaveBeenNthCalledWith(
      2,
      'mcp:brand-generation:accepted-command:job_brand_resume_1',
      1,
      WORKSPACE_ID,
    );
    expect(h.recordPaidCallOnce).toHaveBeenNthCalledWith(
      3,
      'mcp:brand-generation:accepted-command:job_brand_revision_1',
      1,
      WORKSPACE_ID,
    );
  });

  it('submits exact idempotent replays so a missing durable event can be repaired', async () => {
    const deps = dependencies();
    deps.startBrandGeneration.mockReturnValue(commandResult(true, 'job_brand_replay_start'));
    deps.resumeBrandGeneration.mockReturnValue(commandResult(true, 'job_brand_replay_resume'));
    deps.reviseBrandGenerationItem.mockReturnValue(commandResult(true, 'job_brand_replay_revision'));
    const handle = createBrandGenerationActionHandler(deps.value);

    const results = await Promise.all([
      handle(
        'start_brand_deliverable_generation',
        {
          workspace_id: WORKSPACE_ID,
          intake_revision_id: 'intake_revision_1',
          expected_intake_revision: 2,
          expected_intake_fingerprint: FINGERPRINT,
          selection: { kind: 'atomic', target: 'mission' },
          expected_voice_version: 4,
          expected_voice_fingerprint: VOICE_FINGERPRINT,
          budget: BUDGET_INPUT,
          idempotency_key: 'brand-start-replay',
        },
        workspaceContext(),
      ),
      handle(
        'resume_brand_deliverable_generation',
        {
          workspace_id: WORKSPACE_ID,
          run_id: RUN_ID,
          expected_run_revision: 3,
          expected_voice_version: 4,
          expected_voice_fingerprint: VOICE_FINGERPRINT,
          idempotency_key: 'brand-resume-replay',
        },
        workspaceContext('resume_brand_deliverable_generation'),
      ),
      handle(
        'start_brand_deliverable_revision',
        {
          workspace_id: WORKSPACE_ID,
          run_id: RUN_ID,
          item_id: ITEM_ID,
          expected_run_revision: 4,
          expected_item_revision: 2,
          deliverable_id: 'deliverable_1',
          expected_deliverable_version: 3,
          direction: 'Keep every claim grounded.',
          idempotency_key: 'brand-revision-replay',
        },
        workspaceContext('start_brand_deliverable_revision'),
      ),
    ]);

    expect(h.recordPaidCallOnce).toHaveBeenCalledTimes(3);
    expect(h.recordPaidCallOnce).toHaveBeenNthCalledWith(
      1,
      'mcp:brand-generation:accepted-command:job_brand_replay_start',
      1,
      WORKSPACE_ID,
    );
    expect(h.recordPaidCallOnce).toHaveBeenNthCalledWith(
      2,
      'mcp:brand-generation:accepted-command:job_brand_replay_resume',
      1,
      WORKSPACE_ID,
    );
    expect(h.recordPaidCallOnce).toHaveBeenNthCalledWith(
      3,
      'mcp:brand-generation:accepted-command:job_brand_replay_revision',
      1,
      WORKSPACE_ID,
    );
    for (const result of results) {
      expect(textPayload(result)).toMatchObject({ existing: true });
    }
  });

  it('returns the canonical paid-call threshold warning on an accepted command', async () => {
    const warning = 'paid_call_count: 100 (threshold 100; informational only)';
    h.recordPaidCallOnce.mockReturnValue({ count: 100, warning });
    const deps = dependencies();

    const result = await createBrandGenerationActionHandler(deps.value)(
      'start_brand_deliverable_generation',
      {
        workspace_id: WORKSPACE_ID,
        intake_revision_id: 'intake_revision_1',
        expected_intake_revision: 2,
        expected_intake_fingerprint: FINGERPRINT,
        selection: { kind: 'atomic', target: 'mission' },
        expected_voice_version: 4,
        expected_voice_fingerprint: VOICE_FINGERPRINT,
        budget: BUDGET_INPUT,
        idempotency_key: 'brand-start-warning',
      },
      workspaceContext(),
    );

    expect(h.recordPaidCallOnce).toHaveBeenCalledOnce();
    expect(h.recordPaidCallOnce).toHaveBeenCalledWith(
      'mcp:brand-generation:accepted-command:job_brand_1',
      1,
      WORKSPACE_ID,
    );
    expect(textPayload(result)).toMatchObject({ existing: false, warning });
  });

  it.each([
    {
      label: 'camelCase aliases',
      args: {
        workspace_id: WORKSPACE_ID,
        workspaceId: WORKSPACE_ID,
        run_id: RUN_ID,
      },
      tool: 'get_brand_generation',
    },
    {
      label: 'cursor with extra signature separators',
      args: {
        workspace_id: WORKSPACE_ID,
        run_id: RUN_ID,
        item_cursor: `${SIGNED_ITEM_CURSOR}.unexpected`,
      },
      tool: 'get_brand_generation',
    },
    {
      label: 'durable start without voice',
      args: {
        workspace_id: WORKSPACE_ID,
        intake_revision_id: 'intake_revision_1',
        expected_intake_revision: 2,
        expected_intake_fingerprint: FINGERPRINT,
        selection: { kind: 'atomic', target: 'mission' },
        budget: BUDGET_INPUT,
        idempotency_key: 'invalid-start',
      },
      tool: 'start_brand_deliverable_generation',
    },
  ])('rejects $label before calling a domain service', async ({ args, tool }) => {
    const deps = dependencies();
    const result = await createBrandGenerationActionHandler(deps.value)(
      tool,
      args,
      workspaceContext(tool),
    );

    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toMatchObject({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      retryable: false,
      details: { field_path: expect.any(String) },
    });
    expect(textPayload(result).message).toMatch(/^Invalid tool input at /);
    expect(deps.startBrandGeneration).not.toHaveBeenCalled();
    expect(deps.getBrandGeneration).not.toHaveBeenCalled();
    expect(h.recordPaidCallOnce).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'missing resource',
      error: new BrandGenerationNotFoundError('run'),
      expected: {
        code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
        message: 'The requested brand-generation resource was not found.',
        retryable: false,
      },
    },
    {
      label: 'revision conflict',
      error: new BrandGenerationRevisionConflictError('run', 3, 4),
      expected: {
        code: MCP_TOOL_ERROR_CODES.CONFLICT,
        message: 'The brand-generation resource changed. Re-read it before retrying.',
        retryable: true,
        details: { resource: 'run', expected_revision: 3, actual_revision: 4 },
      },
    },
    {
      label: 'idempotency conflict',
      error: new BrandGenerationIdempotencyConflictError('start'),
      expected: {
        code: MCP_TOOL_ERROR_CODES.CONFLICT,
        message: 'The idempotency key already represents a different brand-generation command.',
        retryable: false,
      },
    },
    {
      label: 'concurrency limit',
      error: new BrandGenerationConcurrencyLimitError(3, 3),
      expected: {
        code: MCP_TOOL_ERROR_CODES.RATE_LIMITED,
        message: 'The brand-generation concurrency limit is currently full.',
        retryable: true,
        details: { running_attempts: 3, max_concurrency: 3 },
      },
    },
    {
      label: 'budget ceiling',
      error: new BrandGenerationBudgetExceededError('providerCalls', 7, 6),
      expected: {
        code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
        message: 'The requested brand-generation budget is outside the allowed bounds.',
        retryable: false,
        details: { dimension: 'provider_calls', requested: 7, limit: 6 },
      },
    },
    {
      label: 'approved deliverable',
      error: new BrandGenerationApprovedDeliverableError('private-deliverable-id'),
      expected: {
        code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
        message: 'An approved brand deliverable must be returned to draft before generation.',
        retryable: false,
      },
    },
    {
      label: 'missing prerequisite',
      error: new BrandGenerationPreconditionError('missing_evidence', 'raw intake detail'),
      expected: {
        code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
        message: 'The brand-generation prerequisites are not satisfied.',
        retryable: false,
        details: { reason: 'missing_evidence' },
      },
    },
    {
      label: 'invalid cursor',
      error: new BrandGenerationCursorError('raw cursor detail'),
      expected: {
        code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
        message: 'The item cursor is invalid or stale for this run.',
        retryable: false,
      },
    },
  ])('maps $label to a stable sanitized JSON-v1 error', async ({ error, expected }) => {
    const deps = dependencies();
    deps.getBrandGeneration.mockImplementation(() => { throw error; });
    const result = await createBrandGenerationActionHandler(deps.value)(
      'get_brand_generation',
      { workspace_id: WORKSPACE_ID, run_id: RUN_ID },
      workspaceContext('get_brand_generation'),
    );

    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toEqual(expected);
    const serialized = JSON.stringify(textPayload(result));
    expect(serialized).not.toContain('raw');
    expect(serialized).not.toContain('private-deliverable-id');
  });

  it('sanitizes unexpected failures and does not reflect an unknown tool name', async () => {
    const deps = dependencies();
    deps.getBrandGeneration.mockImplementation(() => {
      throw new Error('private intake and stack must not escape');
    });
    const internal = await createBrandGenerationActionHandler(deps.value)(
      'get_brand_generation',
      { workspace_id: WORKSPACE_ID, run_id: RUN_ID },
      workspaceContext('get_brand_generation'),
    );
    const unknown = await createBrandGenerationActionHandler(deps.value)(
      'unknown_secret_brand_tool',
      { workspace_id: WORKSPACE_ID },
      workspaceContext('unknown_secret_brand_tool'),
    );

    expect(textPayload(internal)).toEqual({
      code: MCP_TOOL_ERROR_CODES.INTERNAL_ERROR,
      message: 'The tool could not complete because of an internal error.',
      retryable: false,
    });
    expect(JSON.stringify(textPayload(internal))).not.toContain('private intake');
    expect(textPayload(unknown)).toEqual({
      code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
      message: 'Unknown brand generation tool: the requested tool does not exist.',
      retryable: false,
    });
    expect(JSON.stringify(textPayload(unknown))).not.toContain('unknown_secret_brand_tool');
  });
});
