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
  GetBrandVoiceResult,
} from '../../../shared/types/voice-finalization.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import {
  consumeVoiceFinalizationAuthorization,
  getBrandVoiceReadiness,
  VoiceFinalizationAuthorizationError,
  VoiceFinalizationConflictError,
  VoiceFinalizationIdempotencyConflictError,
  VoiceFinalizationNotFoundError,
  VoiceFinalizationPreconditionError,
} from '../../domains/brand/voice-finalization.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { createLogger } from '../../logger.js';
import { WS_EVENTS } from '../../ws-events.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { mcpJsonV1Error } from '../tool-errors.js';
import { mcpSuccess } from '../tool-helpers.js';

const log = createLogger('mcp-tools-brand-voice-actions');

export const brandVoiceActionTools: Tool[] = [
  {
    name: 'get_brand_voice',
    description:
      'Read structured brand-voice readiness, the current profile, eligible authentic anchor samples, and the latest immutable finalization snapshot. Never returns the raw brand intake or creates an authorization.',
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
  getBrandVoiceReadiness: (
    workspaceId: string,
  ) => MaybePromise<GetBrandVoiceResult>;
  consumeVoiceFinalizationAuthorization: (
    request: Parameters<typeof consumeVoiceFinalizationAuthorization>[0],
  ) => MaybePromise<FinalizeBrandVoiceResult>;
  addActivity: typeof addActivity;
  broadcastToWorkspace: typeof broadcastToWorkspace;
  invalidateIntelligenceCache: typeof invalidateIntelligenceCache;
}

const defaultDependencies: BrandVoiceActionDependencies = {
  getBrandVoiceReadiness,
  consumeVoiceFinalizationAuthorization,
  addActivity,
  broadcastToWorkspace,
  invalidateIntelligenceCache,
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

function projectBrandVoiceReadiness(result: GetBrandVoiceResult) {
  return {
    profile: result.profile,
    readiness: projectReadiness(result.readiness),
    eligibleAnchors: result.eligibleAnchors,
    latestSnapshot: projectSnapshot(result.latestSnapshot),
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

function applyPostCommitEffects(
  workspaceId: string,
  result: FinalizeBrandVoiceResult,
  dependencies: BrandVoiceActionDependencies,
): void {
  const bestEffort = (effect: string, run: () => void): void => {
    try {
      run();
    } catch (_error) {
      log.error(
        { workspaceId, effect, failureClass: 'post_commit_effect' },
        'Brand voice MCP post-commit effect failed',
      );
    }
  };
  const snapshot = result.snapshot;

  bestEffort('activity', () => {
    // mcp-action-must-tag-source-ok: ambient MCP execution context records the exact key, tool, and request; generic chat attribution is forbidden for this new write.
    dependencies.addActivity(
      workspaceId,
      'voice_calibrated',
      'Finalized brand voice',
      `Finalized voice profile revision ${result.profileRevision}.`,
      {
        voiceProfileId: snapshot.voiceProfileId,
        finalizationId: snapshot.id,
        profileRevision: result.profileRevision,
        voiceVersion: snapshot.voiceVersion,
        fingerprint: snapshot.fingerprint,
      },
      {
        id: snapshot.finalizedBy.actorId,
        name: snapshot.finalizedBy.actorLabel,
      },
    );
  });
  bestEffort('workspace_broadcast', () => dependencies.broadcastToWorkspace(
    workspaceId,
    WS_EVENTS.VOICE_PROFILE_UPDATED,
    {
      workspaceId,
      voiceProfileId: snapshot.voiceProfileId,
      finalizationId: snapshot.id,
      profileRevision: result.profileRevision,
      voiceVersion: snapshot.voiceVersion,
      status: 'calibrated',
    },
  ));
  bestEffort('intelligence_invalidation', () => {
    dependencies.invalidateIntelligenceCache(workspaceId);
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
        const result = await dependencies.getBrandVoiceReadiness(parsed.data.workspace_id);
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
        if (result.created) {
          applyPostCommitEffects(parsed.data.workspace_id, result, dependencies);
        }
        return mcpSuccess(toMcpPayload(projectFinalizationResult(result)));
      }

      return unknownToolError();
    } catch (error) {
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
