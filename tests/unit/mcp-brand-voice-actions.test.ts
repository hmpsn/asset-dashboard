import type { Tool } from '@modelcontextprotocol/sdk/types';
import { describe, expect, it, vi } from 'vitest';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolExecutionContext,
} from '../../shared/types/mcp-runtime.js';
import type {
  FinalizeBrandVoiceResult,
  FinalizedVoiceSnapshot,
  GetBrandVoicePageResult,
} from '../../shared/types/voice-finalization.js';
import {
  VoiceFinalizationAuthorizationError,
  VoiceFinalizationConflictError,
  VoiceFinalizationIdempotencyConflictError,
  VoiceFinalizationNotFoundError,
  VoiceFinalizationPreconditionError,
  VoiceFinalizationReadConflictError,
  VoiceFinalizationReadCursorError,
} from '../../server/domains/brand/voice-finalization.js';
import {
  brandVoiceActionTools,
  createBrandVoiceActionHandler,
  type BrandVoiceActionDependencies,
} from '../../server/mcp/tools/brand-voice-actions.js';
import { isValidatedMcpJsonV1ErrorResult } from '../../server/mcp/tool-errors.js';

const WORKSPACE_ID = 'ws_brand_voice';
const OPERATOR = {
  actorType: 'operator' as const,
  actorId: 'operator_1',
  actorLabel: 'Brand strategist',
};

const VOICE_DNA = {
  personalityTraits: ['warm', 'direct'],
  toneSpectrum: {
    formal_casual: 7,
    serious_playful: 4,
    technical_accessible: 8,
  },
  sentenceStyle: 'Short, direct sentences with a calm cadence.',
  vocabularyLevel: 'Plain language with precise clinical terms.',
};

const GUARDRAILS = {
  forbiddenWords: ['guaranteed'],
  requiredTerminology: [],
  toneBoundaries: ['Never sound dismissive.'],
  antiPatterns: [],
};

function workspaceContext(): McpToolExecutionContext {
  return {
    requestId: 'request_brand_voice_1',
    toolName: 'finalize_brand_voice',
    targetWorkspaceId: WORKSPACE_ID,
    caller: {
      kind: 'workspace_key',
      scope: WORKSPACE_ID,
      workspaceId: WORKSPACE_ID,
      keyId: 'mcp_key_voice_1',
      keyLabel: 'Voice automation',
    },
  };
}

function masterContext(): McpToolExecutionContext {
  return {
    requestId: 'request_brand_voice_master',
    toolName: 'finalize_brand_voice',
    targetWorkspaceId: WORKSPACE_ID,
    caller: {
      kind: 'master_key',
      scope: 'all',
      keyId: null,
      keyLabel: null,
    },
  };
}

function snapshot(
  executionActor: FinalizedVoiceSnapshot['executionActor'] = {
    actorType: 'mcp',
    actorId: 'mcp_key_voice_1',
    actorLabel: 'Voice automation',
  },
): FinalizedVoiceSnapshot {
  const evidenceRef = {
    sourceType: 'voice_sample' as const,
    sourceId: 'voice_sample_1',
    voiceSampleSource: 'manual' as const,
    capturedAt: '2026-07-14T12:00:00.000Z',
    selectedBy: OPERATOR,
    selectedAt: '2026-07-14T12:05:00.000Z',
  };
  return {
    id: 'voice_finalization_1',
    workspaceId: WORKSPACE_ID,
    voiceProfileId: 'voice_profile_1',
    voiceVersion: 1,
    profileRevision: 4,
    finalizedBy: OPERATOR,
    finalizedAt: '2026-07-14T12:06:00.000Z',
    fingerprint: 'a'.repeat(64),
    anchorEvidenceRefs: [evidenceRef],
    voiceDNA: VOICE_DNA,
    guardrails: GUARDRAILS,
    contextModifiers: [{ context: 'CTA', description: 'Keep the action calm and specific.' }],
    anchors: [{
      selector: { kind: 'voice_sample', voiceSampleId: 'voice_sample_1' },
      content: 'You deserve a clear explanation before deciding.',
      context: 'body',
      evidenceRef,
    }],
    calibrationSelections: [{
      sessionId: 'calibration_1',
      variationIndex: 0,
      rating: 'on_brand',
      selected: true,
    }],
    executionActor,
    createdAt: '2026-07-14T12:06:00.000Z',
  };
}

function finalizationResult(
  executionActor?: FinalizedVoiceSnapshot['executionActor'],
  created = true,
  replayed = false,
): FinalizeBrandVoiceResult {
  const finalizedSnapshot = snapshot(executionActor);
  return {
    snapshot: finalizedSnapshot,
    readiness: {
      state: 'finalized',
      snapshot: finalizedSnapshot,
      blockingReasons: [],
    },
    profileRevision: 4,
    created,
    replayed,
  };
}

function readResult(): GetBrandVoicePageResult {
  return {
    profile: {
      id: 'voice_profile_1',
      revision: 3,
      status: 'calibrating',
      voiceDNA: VOICE_DNA,
      guardrails: GUARDRAILS,
      contextModifiers: [],
      updatedAt: '2026-07-14T11:00:00.000Z',
    },
    readiness: {
      state: 'missing',
      blockingReasons: ['Brand voice has not been finalized.'],
    },
    eligibleAnchors: {
      items: [{
        selector: { kind: 'voice_sample', voiceSampleId: 'voice_sample_1' },
        content: 'You deserve a clear explanation before deciding.',
        context: 'body',
        sourceLabel: 'Manual voice sample',
        capturedAt: '2026-07-14T12:00:00.000Z',
      }],
      nextCursor: 'opaque-next-cursor',
      hasMore: true,
    },
    latestSnapshot: null,
  };
}

function dependencies() {
  const getBrandVoicePage = vi.fn<
    BrandVoiceActionDependencies['getBrandVoicePage']
  >(() => readResult());
  const consumeVoiceFinalizationAuthorization = vi.fn<
    BrandVoiceActionDependencies['consumeVoiceFinalizationAuthorization']
  >(request => finalizationResult(request.executionActor));
  const applyVoiceFinalizationPostCommitEffects = vi.fn<
    BrandVoiceActionDependencies['applyVoiceFinalizationPostCommitEffects']
  >();
  const value: BrandVoiceActionDependencies = {
    getBrandVoicePage,
    consumeVoiceFinalizationAuthorization,
    applyVoiceFinalizationPostCommitEffects,
  };
  return {
    value,
    getBrandVoicePage,
    consumeVoiceFinalizationAuthorization,
    applyVoiceFinalizationPostCommitEffects,
  };
}

function textPayload(result: Awaited<ReturnType<ReturnType<typeof createBrandVoiceActionHandler>>>): Record<string, unknown> {
  const content = result.content[0];
  expect(content?.type).toBe('text');
  return JSON.parse(content && 'text' in content ? content.text : '{}') as Record<string, unknown>;
}

describe('MCP brand voice actions', () => {
  it('advertises one dedicated two-tool snake_case json-v1 family', () => {
    expect(brandVoiceActionTools.map(tool => tool.name)).toEqual([
      'get_brand_voice',
      'finalize_brand_voice',
    ]);
    for (const tool of brandVoiceActionTools as Tool[]) {
      expect(tool.inputSchema.type).toBe('object');
      const properties = tool.inputSchema.properties as Record<string, { description?: string }>;
      expect(properties.workspace_id?.description).toEqual(expect.any(String));
      expect(properties).not.toHaveProperty('workspaceId');
      for (const property of Object.values(properties)) {
        expect(property.description).toEqual(expect.any(String));
      }
    }
    expect(brandVoiceActionTools[1]?.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ['workspace_id', 'authorization_token'],
    });
  });

  it('returns only the safe readiness projection in snake_case', async () => {
    const deps = dependencies();
    const fullSnapshot = snapshot();
    deps.getBrandVoicePage.mockReturnValue({
      ...readResult(),
      latestSnapshot: {
        ...fullSnapshot,
        anchorCount: fullSnapshot.anchors.length,
        calibrationSelectionCount: fullSnapshot.calibrationSelections.length,
      },
      rawIntake: { privateAnswers: ['must not escape'] },
    } as never);
    const result = await createBrandVoiceActionHandler(deps.value)(
      'get_brand_voice',
      { workspace_id: WORKSPACE_ID },
      workspaceContext(),
    );

    expect(result.isError).not.toBe(true);
    expect(deps.getBrandVoicePage).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      anchorLimit: undefined,
      anchorCursor: undefined,
    });
    expect(textPayload(result)).toMatchObject({
      profile: {
        id: 'voice_profile_1',
        voice_dna: {
          personality_traits: ['warm', 'direct'],
          tone_spectrum: { formal_casual: 7 },
        },
      },
      readiness: { state: 'missing' },
      eligible_anchors: {
        items: [{
          selector: { kind: 'voice_sample', voice_sample_id: 'voice_sample_1' },
          source_label: 'Manual voice sample',
        }],
        next_cursor: 'opaque-next-cursor',
        has_more: true,
      },
      latest_snapshot: {
        id: 'voice_finalization_1',
        voice_profile_id: 'voice_profile_1',
        anchor_count: 1,
      },
    });
    const payload = textPayload(result);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('raw_intake');
    expect(serialized).not.toContain('privateAnswers');
    expect(serialized).not.toContain('execution_actor');
    expect(serialized).not.toContain('mcp_key_voice_1');
    expect(serialized).not.toContain('Voice automation');
    expect(payload.latest_snapshot).not.toHaveProperty('voice_dna');
    expect(payload.latest_snapshot).not.toHaveProperty('guardrails');
    expect(payload.latest_snapshot).not.toHaveProperty('anchors');
    expect(payload.latest_snapshot).not.toHaveProperty('calibration_selections');
  });

  it('forwards the bounded anchor page contract and rejects oversized input', async () => {
    const deps = dependencies();
    const handle = createBrandVoiceActionHandler(deps.value);
    const valid = await handle('get_brand_voice', {
      workspace_id: WORKSPACE_ID,
      anchor_limit: 100,
      anchor_cursor: 'opaque_cursor_1',
    }, workspaceContext());

    expect(valid.isError).not.toBe(true);
    expect(deps.getBrandVoicePage).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      anchorLimit: 100,
      anchorCursor: 'opaque_cursor_1',
    });

    deps.getBrandVoicePage.mockClear();
    const invalid = await handle('get_brand_voice', {
      workspace_id: WORKSPACE_ID,
      anchor_limit: 101,
    }, workspaceContext());
    expect(textPayload(invalid)).toEqual({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: 'The tool input is invalid.',
      retryable: false,
    });
    expect(deps.getBrandVoicePage).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'invalid or cross-workspace cursor',
      error: new VoiceFinalizationReadCursorError(),
      expected: {
        code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
        message: 'The tool input is invalid.',
        retryable: false,
      },
    },
    {
      label: 'stale authority cursor',
      error: new VoiceFinalizationReadConflictError(),
      expected: {
        code: MCP_TOOL_ERROR_CODES.CONFLICT,
        message: 'The brand voice changed after this cursor was issued. Re-read it from the first anchor page.',
        retryable: true,
      },
    },
  ])('maps $label to a stable read error', async ({ error, expected }) => {
    const deps = dependencies();
    deps.getBrandVoicePage.mockImplementation(() => { throw error; });
    const result = await createBrandVoiceActionHandler(deps.value)(
      'get_brand_voice',
      { workspace_id: WORKSPACE_ID, anchor_cursor: 'opaque_cursor_1' },
      workspaceContext(),
    );

    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toEqual(expected);
  });

  it('consumes stored operator authorization with MCP execution attribution and emits effects once', async () => {
    const deps = dependencies();
    const context = workspaceContext();
    const handle = createBrandVoiceActionHandler(deps.value);
    const args = {
      workspace_id: WORKSPACE_ID,
      authorization_token: 'one-time-authorization-secret',
    };

    const created = await handle('finalize_brand_voice', args, context);
    deps.consumeVoiceFinalizationAuthorization.mockReturnValue(
      finalizationResult(context.caller.kind === 'workspace_key'
        ? {
            actorType: 'mcp',
            actorId: context.caller.keyId,
            actorLabel: context.caller.keyLabel,
          }
        : undefined, false, true),
    );
    const replayed = await handle('finalize_brand_voice', args, context);

    expect(deps.consumeVoiceFinalizationAuthorization).toHaveBeenNthCalledWith(1, {
      workspaceId: WORKSPACE_ID,
      authorizationToken: 'one-time-authorization-secret',
      executionActor: {
        actorType: 'mcp',
        actorId: 'mcp_key_voice_1',
        actorLabel: 'Voice automation',
      },
    });
    expect(textPayload(created)).toMatchObject({
      created: true,
      replayed: false,
      profile_revision: 4,
      snapshot: {
        id: 'voice_finalization_1',
        finalized_by: {
          actor_type: 'operator',
          actor_id: 'operator_1',
        },
      },
    });
    expect(textPayload(replayed)).toMatchObject({ created: false, replayed: true });
    expect(deps.applyVoiceFinalizationPostCommitEffects).toHaveBeenCalledTimes(2);
    expect(deps.applyVoiceFinalizationPostCommitEffects).toHaveBeenNthCalledWith(
      1,
      WORKSPACE_ID,
      expect.objectContaining({ created: true, replayed: false }),
    );
    expect(deps.applyVoiceFinalizationPostCommitEffects).toHaveBeenNthCalledWith(
      2,
      WORKSPACE_ID,
      expect.objectContaining({ created: false, replayed: true }),
    );
    expect(JSON.stringify(textPayload(created))).not.toContain('authorization_token');
    expect(JSON.stringify(textPayload(created))).not.toContain('one-time-authorization-secret');
    expect(JSON.stringify(textPayload(created))).not.toContain('execution_actor');
    expect(JSON.stringify(textPayload(created))).not.toContain('mcp_key_voice_1');
    expect(JSON.stringify(textPayload(created))).not.toContain('Voice automation');
  });

  it('derives bounded MCP execution attribution for the master key', async () => {
    const deps = dependencies();
    await createBrandVoiceActionHandler(deps.value)(
      'finalize_brand_voice',
      {
        workspace_id: WORKSPACE_ID,
        authorization_token: 'master-authorization',
      },
      masterContext(),
    );

    expect(deps.consumeVoiceFinalizationAuthorization).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      authorizationToken: 'master-authorization',
      executionActor: {
        actorType: 'mcp',
        actorId: 'mcp:master-key',
        actorLabel: 'MCP master key',
      },
    });
  });

  it('rejects caller-authored operator identity before consuming authorization', async () => {
    const deps = dependencies();
    const result = await createBrandVoiceActionHandler(deps.value)(
      'finalize_brand_voice',
      {
        workspace_id: WORKSPACE_ID,
        authorization_token: 'authorization',
        finalized_by: {
          actor_type: 'operator',
          actor_id: 'caller-controlled',
        },
      },
      workspaceContext(),
    );

    expect(result.isError).toBe(true);
    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toEqual({
      code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
      message: 'The tool input is invalid.',
      retryable: false,
    });
    expect(deps.consumeVoiceFinalizationAuthorization).not.toHaveBeenCalled();
  });

  it('delegates a newly created result to the shared post-commit effect spine', async () => {
    const deps = dependencies();
    const result = await createBrandVoiceActionHandler(deps.value)(
      'finalize_brand_voice',
      {
        workspace_id: WORKSPACE_ID,
        authorization_token: 'authorization',
      },
      workspaceContext(),
    );

    expect(result.isError).not.toBe(true);
    expect(deps.applyVoiceFinalizationPostCommitEffects).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: 'missing resource',
      error: new VoiceFinalizationNotFoundError(),
      expected: {
        code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
        message: 'The requested workspace or brand voice was not found.',
        retryable: false,
      },
    },
    {
      label: 'stale revision',
      error: new VoiceFinalizationConflictError(3, 4),
      expected: {
        code: MCP_TOOL_ERROR_CODES.CONFLICT,
        message: 'The brand voice changed. Re-read it and request a new operator authorization before retrying.',
        retryable: true,
        details: { expected_revision: 3, actual_revision: 4 },
      },
    },
    {
      label: 'idempotency conflict',
      error: new VoiceFinalizationIdempotencyConflictError('must-not-escape'),
      expected: {
        code: MCP_TOOL_ERROR_CODES.CONFLICT,
        message: 'The idempotency key already represents a different brand-voice finalization.',
        retryable: false,
      },
    },
    {
      label: 'missing prerequisite',
      error: new VoiceFinalizationPreconditionError('raw generated-only anchor details'),
      expected: {
        code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
        message: 'The brand voice cannot be finalized because its prerequisites are not satisfied.',
        retryable: false,
      },
    },
    {
      label: 'invalid or expired operator authorization',
      error: new VoiceFinalizationAuthorizationError('raw authorization reason'),
      expected: {
        code: MCP_TOOL_ERROR_CODES.FORBIDDEN,
        message: 'A current operator authorization is required to finalize brand voice.',
        retryable: false,
      },
    },
  ])('maps $label to a stable sanitized json-v1 error', async ({ error, expected }) => {
    const deps = dependencies();
    deps.consumeVoiceFinalizationAuthorization.mockImplementation(() => {
      throw error;
    });
    const result = await createBrandVoiceActionHandler(deps.value)(
      'finalize_brand_voice',
      {
        workspace_id: WORKSPACE_ID,
        authorization_token: 'must-not-escape-authorization',
      },
      workspaceContext(),
    );

    expect(result.isError).toBe(true);
    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toEqual(expected);
    expect(JSON.stringify(textPayload(result))).not.toContain('must-not-escape');
    expect(JSON.stringify(textPayload(result))).not.toContain('raw');
    expect(deps.applyVoiceFinalizationPostCommitEffects).not.toHaveBeenCalled();
  });

  it('sanitizes unexpected failures and returns a branded internal error', async () => {
    const deps = dependencies();
    deps.getBrandVoicePage.mockImplementation(() => {
      throw new Error('private intake and stack must not escape');
    });
    const result = await createBrandVoiceActionHandler(deps.value)(
      'get_brand_voice',
      { workspace_id: WORKSPACE_ID },
      workspaceContext(),
    );

    expect(isValidatedMcpJsonV1ErrorResult(result)).toBe(true);
    expect(textPayload(result)).toEqual({
      code: MCP_TOOL_ERROR_CODES.INTERNAL_ERROR,
      message: 'The tool could not complete because of an internal error.',
      retryable: false,
    });
    expect(JSON.stringify(textPayload(result))).not.toContain('private intake');
  });

  it('returns the family sentinel for an unknown tool before touching dependencies', async () => {
    const deps = dependencies();
    const result = await createBrandVoiceActionHandler(deps.value)(
      'unknown_brand_voice_action',
      { workspace_id: WORKSPACE_ID },
      workspaceContext(),
    );

    expect(textPayload(result)).toEqual({
      code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
      message: 'Unknown brand voice tool: the requested tool does not exist.',
      retryable: false,
    });
    expect(deps.getBrandVoicePage).not.toHaveBeenCalled();
    expect(deps.consumeVoiceFinalizationAuthorization).not.toHaveBeenCalled();
  });
});
