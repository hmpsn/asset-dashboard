import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import {
  finalizeBrandVoiceMcpInputSchema,
  getBrandVoiceInputSchema,
} from '../../../shared/types/mcp-brand-voice-schemas.js';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolExecutionContext,
} from '../../../shared/types/mcp-runtime.js';
import type {
  BrandVoiceReadiness,
  FinalizedVoiceSnapshotRef,
} from '../../../shared/types/brand-generation.js';
import type {
  FinalizeBrandVoiceResult,
  FinalizedVoiceSnapshot,
  GetBrandVoicePageResult,
} from '../../../shared/types/voice-finalization.js';
import {
  consumeVoiceFinalizationAuthorization,
  getBrandVoicePage,
  VoiceFinalizationAuthorizationError,
  VoiceFinalizationConflictError,
  VoiceFinalizationIdempotencyConflictError,
  VoiceFinalizationNotFoundError,
  VoiceFinalizationPreconditionError,
  VoiceFinalizationReadConflictError,
  VoiceFinalizationReadCursorError,
} from '../../domains/brand/voice-finalization.js';
import { applyVoiceFinalizationPostCommitEffects } from '../../domains/brand/voice-finalization-effects.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { mcpJsonV1Error } from '../tool-errors.js';
import { mcpSuccess } from '../tool-helpers.js';

const log = createLogger('mcp-tools-brand-voice-actions');

export const brandVoiceActionTools: Tool[] = [
  {
    name: 'get_brand_voice',
    description:
      'Read structured brand-voice readiness, a byte-bounded current profile, one bounded page of eligible authentic anchors, and a summary of the latest immutable finalization. The opaque anchor cursor is bound to the workspace plus current voice-profile and brand-intake revisions. Never returns raw brand intake or frozen snapshot content and never creates an authorization.',
    inputSchema: toMcpJsonSchema(getBrandVoiceInputSchema),
  },
  {
    name: 'finalize_brand_voice',
    description:
      'Consume one short-lived operator authorization bound to the exact brand-voice fields, profile revision, authentic anchors, ratings, and idempotency key. The MCP key is recorded only as internal execution provenance, is never returned, and cannot act as the finalizing operator.',
    inputSchema: toMcpJsonSchema(finalizeBrandVoiceMcpInputSchema),
  },
];

type MaybePromise<T> = T | Promise<T>;

export interface BrandVoiceActionDependencies {
  getBrandVoicePage: (
    request: Parameters<typeof getBrandVoicePage>[0],
  ) => MaybePromise<GetBrandVoicePageResult>;
  consumeVoiceFinalizationAuthorization: (
    request: Parameters<typeof consumeVoiceFinalizationAuthorization>[0],
  ) => MaybePromise<FinalizeBrandVoiceResult>;
  applyVoiceFinalizationPostCommitEffects: typeof applyVoiceFinalizationPostCommitEffects;
}

const defaultDependencies: BrandVoiceActionDependencies = {
  getBrandVoicePage,
  consumeVoiceFinalizationAuthorization,
  applyVoiceFinalizationPostCommitEffects,
};

function snakeCaseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function toMcpPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => toMcpPayload(item));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [snakeCaseKey(key), toMcpPayload(child)]),
  );
}

function projectSnapshot(snapshot: FinalizedVoiceSnapshot | null) {
  if (!snapshot) return null;
  const { executionActor: _internalExecutionActor, ...publicSnapshot } = snapshot;
  void _internalExecutionActor;
  return publicSnapshot;
}

function projectSnapshotRef(snapshot: FinalizedVoiceSnapshotRef) {
  return {
    voiceProfileId: snapshot.voiceProfileId,
    voiceVersion: snapshot.voiceVersion,
    finalizedBy: snapshot.finalizedBy,
    finalizedAt: snapshot.finalizedAt,
    fingerprint: snapshot.fingerprint,
    anchorEvidenceRefs: snapshot.anchorEvidenceRefs,
  };
}

function projectReadiness(readiness: BrandVoiceReadiness): BrandVoiceReadiness {
  if (readiness.state === 'finalized' || readiness.state === 'stale') {
    return {
      ...readiness,
      snapshot: projectSnapshotRef(readiness.snapshot),
    };
  }
  return readiness;
}

function projectSnapshotSummary(
  snapshot: GetBrandVoicePageResult['latestSnapshot'],
) {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    voiceProfileId: snapshot.voiceProfileId,
    profileRevision: snapshot.profileRevision,
    voiceVersion: snapshot.voiceVersion,
    fingerprint: snapshot.fingerprint,
    finalizedBy: snapshot.finalizedBy,
    finalizedAt: snapshot.finalizedAt,
    anchorCount: snapshot.anchorCount,
    calibrationSelectionCount: snapshot.calibrationSelectionCount,
  };
}

function projectBrandVoiceReadiness(result: GetBrandVoicePageResult) {
  const profile = result.profile
    ? {
        id: result.profile.id,
        revision: result.profile.revision,
        status: result.profile.status,
        voiceDNA: result.profile.voiceDNA,
        guardrails: result.profile.guardrails,
        contextModifiers: result.profile.contextModifiers,
        updatedAt: result.profile.updatedAt,
      }
    : null;
  const readiness = result.readiness.state === 'finalized' || result.readiness.state === 'stale'
    ? { ...result.readiness, snapshot: projectSnapshotSummary(result.readiness.snapshot) }
    : result.readiness;
  return {
    profile,
    readiness,
    eligibleAnchors: {
      items: result.eligibleAnchors.items.map(anchor => ({
        selector: anchor.selector,
        content: anchor.content,
        context: anchor.context,
        sourceLabel: anchor.sourceLabel,
        capturedAt: anchor.capturedAt,
      })),
      nextCursor: result.eligibleAnchors.nextCursor,
      hasMore: result.eligibleAnchors.hasMore,
    },
    latestSnapshot: projectSnapshotSummary(result.latestSnapshot),
  };
}

function projectFinalizationResult(result: FinalizeBrandVoiceResult) {
  return {
    snapshot: projectSnapshot(result.snapshot),
    readiness: projectReadiness(result.readiness),
    profileRevision: result.profileRevision,
    created: result.created,
    replayed: result.replayed,
  };
}

function executionActor(context: McpToolExecutionContext) {
  if (context.caller.kind === 'workspace_key') {
    return {
      actorType: 'mcp' as const,
      actorId: context.caller.keyId,
      actorLabel: context.caller.keyLabel,
    };
  }
  return {
    actorType: 'mcp' as const,
    actorId: 'mcp:master-key',
    actorLabel: 'MCP master key',
  };
}

function validationError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
    message: 'The tool input is invalid.',
    retryable: false,
  });
}

function notFoundError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
    message: 'The requested workspace or brand voice was not found.',
    retryable: false,
  });
}

function revisionConflictError(error: VoiceFinalizationConflictError): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.CONFLICT,
    message: 'The brand voice changed. Re-read it and request a new operator authorization before retrying.',
    retryable: true,
    details: {
      expected_revision: error.expected,
      actual_revision: error.actual,
    },
  });
}

function readConflictError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.CONFLICT,
    message: 'The brand voice changed after this cursor was issued. Re-read it from the first anchor page.',
    retryable: true,
  });
}

function idempotencyConflictError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.CONFLICT,
    message: 'The idempotency key already represents a different brand-voice finalization.',
    retryable: false,
  });
}

function preconditionError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
    message: 'The brand voice cannot be finalized because its prerequisites are not satisfied.',
    retryable: false,
  });
}

function authorizationError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.FORBIDDEN,
    message: 'A current operator authorization is required to finalize brand voice.',
    retryable: false,
  });
}

function internalError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.INTERNAL_ERROR,
    message: 'The tool could not complete because of an internal error.',
    retryable: false,
  });
}

function unknownToolError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
    message: 'Unknown brand voice tool: the requested tool does not exist.',
    retryable: false,
  });
}

export function createBrandVoiceActionHandler(
  dependencies: BrandVoiceActionDependencies = defaultDependencies,
) {
  return async function handle(
    name: string,
    args: Record<string, unknown>,
    context: McpToolExecutionContext,
  ): Promise<CallToolResult> {
    try {
      if (name === 'get_brand_voice') {
        const parsed = getBrandVoiceInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const result = await dependencies.getBrandVoicePage({
          workspaceId: parsed.data.workspace_id,
          anchorLimit: parsed.data.anchor_limit,
          anchorCursor: parsed.data.anchor_cursor,
        });
        return mcpSuccess(toMcpPayload(projectBrandVoiceReadiness(result)));
      }

      if (name === 'finalize_brand_voice') {
        const parsed = finalizeBrandVoiceMcpInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const result = await dependencies.consumeVoiceFinalizationAuthorization({
          workspaceId: parsed.data.workspace_id,
          authorizationToken: parsed.data.authorization_token,
          executionActor: executionActor(context),
        });
        dependencies.applyVoiceFinalizationPostCommitEffects(
          parsed.data.workspace_id,
          result,
        );
        return mcpSuccess(toMcpPayload(projectFinalizationResult(result)));
      }

      return unknownToolError();
    } catch (error) {
      if (error instanceof VoiceFinalizationReadCursorError) return validationError();
      if (error instanceof VoiceFinalizationReadConflictError) return readConflictError();
      if (error instanceof VoiceFinalizationNotFoundError) return notFoundError();
      if (error instanceof VoiceFinalizationConflictError) return revisionConflictError(error);
      if (error instanceof VoiceFinalizationIdempotencyConflictError) {
        return idempotencyConflictError();
      }
      if (error instanceof VoiceFinalizationPreconditionError) return preconditionError();
      if (error instanceof VoiceFinalizationAuthorizationError) return authorizationError();
      log.error(
        {
          tool: name === 'get_brand_voice' || name === 'finalize_brand_voice'
            ? name
            : 'unknown_brand_voice_tool',
          failureClass: 'handler_exception',
        },
        'Brand voice MCP tool execution failed',
      );
      return internalError();
    }
  };
}

export const handleBrandVoiceActionTool = createBrandVoiceActionHandler();
