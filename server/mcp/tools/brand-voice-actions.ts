import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import type { ZodError } from 'zod';
import {
  addBrandVoiceSampleMcpInputSchema,
  addBrandVoiceSamplesMcpInputSchema,
  createBrandVoiceProfileMcpInputSchema,
  finalizeBrandVoiceMcpInputSchema,
  getBrandVoiceInputSchema,
  getPendingApprovalsMcpInputSchema,
  updateBrandVoiceDraftMcpInputSchema,
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
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { createLogger } from '../../logger.js';
import {
  addVoiceSample,
  addVoiceSamples,
  createVoiceProfile,
  getVoiceProfile,
  updateVoiceProfileWithResult,
  VoiceProfileRevisionConflictError,
  VoiceProfileValidationError,
  VoiceSampleValidationError,
} from '../../voice-calibration.js';
import { listDeliverables } from '../../brand-deliverable-read-model.js';
import { getWorkspace } from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { mcpJsonV1Error, mcpZodValidationError } from '../tool-errors.js';
import { mcpSuccess } from '../tool-helpers.js';

const log = createLogger('mcp-tools-brand-voice-actions');

export const brandVoiceActionTools: Tool[] = [
  {
    name: 'get_brand_voice',
    description:
      'Read structured brand-voice readiness with exact missing prerequisites, all pending chat proposals, a byte-bounded current profile, one bounded page of eligible authentic anchors, and a summary of the latest immutable finalization. The opaque anchor cursor is bound to the workspace plus current voice-profile and brand-intake revisions. Never returns raw brand intake or frozen snapshot content and never creates an authorization.',
    inputSchema: toMcpJsonSchema(getBrandVoiceInputSchema),
  },
  {
    name: 'get_pending_approvals',
    description:
      'Read every Brand & AI item currently awaiting a human decision: voice finalization, full chat-proposed voice samples, and full draft brand deliverables. Each item explains why it is pending. Read-only; it cannot attest, approve, or finalize anything.',
    inputSchema: toMcpJsonSchema(getPendingApprovalsMcpInputSchema),
  },
  {
    name: 'create_brand_voice_profile',
    description:
      'Idempotently ensure a mutable brand-voice profile exists for the workspace. Returns the existing profile unchanged when one already exists.',
    inputSchema: toMcpJsonSchema(createBrandVoiceProfileMcpInputSchema),
  },
  {
    name: 'update_brand_voice_draft',
    description:
      'Replace one or more proposed voice-DNA, guardrail, or context-modifier fields at an exact profile revision. This reopens finalized voice for human review and never finalizes it.',
    inputSchema: toMcpJsonSchema(updateBrandVoiceDraftMcpInputSchema),
  },
  {
    name: 'add_brand_voice_sample',
    description:
      'Add an exact proposed voice sample at an exact profile revision. MCP-added samples are always ineligible as finalization anchors until a human operator explicitly attests them in the platform.',
    inputSchema: toMcpJsonSchema(addBrandVoiceSampleMcpInputSchema),
  },
  {
    name: 'add_brand_voice_samples',
    description:
      'Add a set of exact proposed voice samples with one optimistic revision check and one profile revision bump. Every sample remains ineligible as finalization evidence until a human operator approves it in the platform.',
    inputSchema: toMcpJsonSchema(addBrandVoiceSamplesMcpInputSchema),
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
  getWorkspace: typeof getWorkspace;
  getVoiceProfile: typeof getVoiceProfile;
  createVoiceProfile: typeof createVoiceProfile;
  updateVoiceProfileWithResult: typeof updateVoiceProfileWithResult;
  addVoiceSample: typeof addVoiceSample;
  addVoiceSamples: typeof addVoiceSamples;
  listDeliverables: typeof listDeliverables;
  addActivity: typeof addActivity;
  broadcastToWorkspace: typeof broadcastToWorkspace;
  invalidateIntelligenceCache: typeof invalidateIntelligenceCache;
  getBrandVoicePage: (
    request: Parameters<typeof getBrandVoicePage>[0],
  ) => MaybePromise<GetBrandVoicePageResult>;
  consumeVoiceFinalizationAuthorization: (
    request: Parameters<typeof consumeVoiceFinalizationAuthorization>[0],
  ) => MaybePromise<FinalizeBrandVoiceResult>;
  applyVoiceFinalizationPostCommitEffects: typeof applyVoiceFinalizationPostCommitEffects;
}

const defaultDependencies: BrandVoiceActionDependencies = {
  getWorkspace,
  getVoiceProfile,
  createVoiceProfile,
  updateVoiceProfileWithResult,
  addVoiceSample,
  addVoiceSamples,
  listDeliverables,
  addActivity,
  broadcastToWorkspace,
  invalidateIntelligenceCache,
  getBrandVoicePage,
  consumeVoiceFinalizationAuthorization,
  applyVoiceFinalizationPostCommitEffects,
};

function projectMutableProfile(profile: NonNullable<ReturnType<typeof getVoiceProfile>>) {
  return {
    id: profile.id,
    revision: profile.revision,
    status: profile.status,
    voiceDNA: profile.voiceDNA,
    guardrails: profile.guardrails,
    contextModifiers: profile.contextModifiers,
    updatedAt: profile.updatedAt,
  };
}

function runDraftPostCommitEffects(
  workspaceId: string,
  action: 'created' | 'updated' | 'sample_added',
  dependencies: BrandVoiceActionDependencies,
): void {
  const run = (effect: string, callback: () => void) => {
    try {
      callback();
    } catch (error) {
      log.warn({ error, workspaceId, effect }, 'Brand voice MCP post-commit effect failed');
    }
  };
  run('activity', () => dependencies.addActivity(
    workspaceId,
    action === 'created'
      ? 'voice_profile_created'
      : action === 'sample_added'
        ? 'voice_sample_added'
        : 'voice_profile_updated',
    action === 'created'
      ? 'Created brand voice profile'
      : action === 'sample_added'
        ? 'Added brand voice sample'
        : 'Updated brand voice draft',
    undefined,
    { source: 'mcp-chat', action },
  ));
  run('broadcast', () => dependencies.broadcastToWorkspace(
    workspaceId,
    WS_EVENTS.VOICE_PROFILE_UPDATED,
    { action },
  ));
  run('intelligence', () => dependencies.invalidateIntelligenceCache(workspaceId));
}

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

function specificBlockingReasons(
  result: GetBrandVoicePageResult,
  pendingProposalCount: number,
): string[] {
  if (result.readiness.state !== 'missing' || !result.profile) {
    return result.readiness.blockingReasons;
  }
  if (result.profile.status === 'calibrated') {
    return result.readiness.blockingReasons;
  }
  const reasons: string[] = [];
  if (!result.profile.voiceDNA) reasons.push('Voice DNA is missing.');
  if (!result.profile.guardrails) reasons.push('Voice guardrails are missing.');
  if (result.eligibleAnchors.items.length === 0 && !result.eligibleAnchors.hasMore) {
    reasons.push(pendingProposalCount > 0
      ? `${pendingProposalCount} chat-proposed voice sample${pendingProposalCount === 1 ? '' : 's'} ${pendingProposalCount === 1 ? 'requires' : 'require'} human approval before any can be used as an authentic anchor.`
      : 'At least one human-authenticated voice anchor is missing.');
  }
  if (reasons.length === 0) {
    reasons.push('Voice DNA, guardrails, and authentic anchors are ready for human finalization.');
  }
  return reasons;
}

function pendingVoiceProposals(
  profile: ReturnType<typeof getVoiceProfile>,
) {
  return (profile?.samples ?? [])
    .filter(sample => sample.source === 'mcp_proposed')
    .map(sample => ({
      id: sample.id,
      content: sample.content,
      context: sample.contextTag,
      source: sample.source,
      createdAt: sample.createdAt,
    }));
}

function projectBrandVoiceReadiness(
  result: GetBrandVoicePageResult,
  proposals: ReturnType<typeof pendingVoiceProposals>,
) {
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
    : { ...result.readiness, blockingReasons: specificBlockingReasons(result, proposals.length) };
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
    pendingProposals: {
      count: proposals.length,
      items: proposals,
    },
  };
}

function projectPendingApprovals(
  result: GetBrandVoicePageResult,
  proposals: ReturnType<typeof pendingVoiceProposals>,
  deliverables: ReturnType<typeof listDeliverables>,
) {
  const items: Array<Record<string, unknown>> = [];
  if (result.profile && result.readiness.state !== 'finalized') {
    items.push({
      id: `voice-finalization:${result.profile.id}:${result.profile.revision}`,
      type: 'voice_finalization',
      content: {
        profileRevision: result.profile.revision,
        voiceDNA: result.profile.voiceDNA ?? null,
        guardrails: result.profile.guardrails ?? null,
        contextModifiers: result.profile.contextModifiers,
      },
      whyPending: specificBlockingReasons(result, proposals.length).join(' '),
    });
  }
  for (const proposal of proposals) {
    items.push({
      id: proposal.id,
      type: 'voice_sample',
      content: proposal,
      whyPending: 'A human operator must confirm this chat proposal as authentic brand voice.',
    });
  }
  for (const deliverable of deliverables.filter(item => item.status === 'draft')) {
    items.push({
      id: deliverable.id,
      type: 'brand_deliverable',
      content: {
        deliverableType: deliverable.deliverableType,
        content: deliverable.content,
        version: deliverable.version,
      },
      whyPending: 'This brand deliverable is still a draft and requires human approval.',
    });
  }
  return {
    count: items.length,
    counts: {
      voiceFinalization: items.filter(item => item.type === 'voice_finalization').length,
      voiceSamples: proposals.length,
      brandDeliverables: deliverables.filter(item => item.status === 'draft').length,
    },
    items,
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

function validationError(error?: ZodError): CallToolResult {
  return error ? mcpZodValidationError(error) : mcpJsonV1Error({
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

function draftRevisionConflictError(error: VoiceProfileRevisionConflictError): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.CONFLICT,
    message: 'The brand voice changed. Re-read it and retry against the current profile revision.',
    retryable: true,
    details: {
      expected_revision: error.expectedRevision,
      actual_revision: error.actualRevision,
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
      if (name === 'create_brand_voice_profile') {
        const parsed = createBrandVoiceProfileMcpInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        if (!dependencies.getWorkspace(parsed.data.workspace_id)) return notFoundError();
        const existing = dependencies.getVoiceProfile(parsed.data.workspace_id);
        if (existing) {
          return mcpSuccess(toMcpPayload({ profile: projectMutableProfile(existing), created: false }));
        }
        const profile = dependencies.createVoiceProfile(parsed.data.workspace_id);
        runDraftPostCommitEffects(parsed.data.workspace_id, 'created', dependencies);
        return mcpSuccess(toMcpPayload({ profile: projectMutableProfile(profile), created: true }));
      }

      if (name === 'update_brand_voice_draft') {
        const parsed = updateBrandVoiceDraftMcpInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const result = dependencies.updateVoiceProfileWithResult(
          parsed.data.workspace_id,
          {
            ...(parsed.data.voice_dna ? {
              voiceDNA: {
                personalityTraits: parsed.data.voice_dna.personality_traits,
                toneSpectrum: parsed.data.voice_dna.tone_spectrum,
                sentenceStyle: parsed.data.voice_dna.sentence_style,
                vocabularyLevel: parsed.data.voice_dna.vocabulary_level,
                humorStyle: parsed.data.voice_dna.humor_style,
              },
            } : {}),
            ...(parsed.data.guardrails ? {
              guardrails: {
                forbiddenWords: parsed.data.guardrails.forbidden_words,
                requiredTerminology: parsed.data.guardrails.required_terminology.map(item => ({
                  use: item.use,
                  insteadOf: item.instead_of,
                })),
                toneBoundaries: parsed.data.guardrails.tone_boundaries,
                antiPatterns: parsed.data.guardrails.anti_patterns,
              },
            } : {}),
            ...(parsed.data.context_modifiers
              ? { contextModifiers: parsed.data.context_modifiers }
              : {}),
          },
          parsed.data.expected_profile_revision,
        );
        if (result.changed) {
          runDraftPostCommitEffects(parsed.data.workspace_id, 'updated', dependencies);
        }
        return mcpSuccess(toMcpPayload({
          profile: projectMutableProfile(result.profile),
          changed: result.changed,
        }));
      }

      if (name === 'add_brand_voice_sample') {
        const parsed = addBrandVoiceSampleMcpInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const sample = dependencies.addVoiceSample(
          parsed.data.workspace_id,
          parsed.data.content,
          parsed.data.context,
          'mcp_proposed',
          parsed.data.expected_profile_revision,
        );
        runDraftPostCommitEffects(parsed.data.workspace_id, 'sample_added', dependencies);
        return mcpSuccess(toMcpPayload({
          sample,
          profileRevision: parsed.data.expected_profile_revision + 1,
          eligibleAsFinalizationAnchor: false,
        }));
      }

      if (name === 'add_brand_voice_samples') {
        const parsed = addBrandVoiceSamplesMcpInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const samples = dependencies.addVoiceSamples(
          parsed.data.workspace_id,
          parsed.data.samples,
          parsed.data.expected_profile_revision,
        );
        runDraftPostCommitEffects(parsed.data.workspace_id, 'sample_added', dependencies);
        return mcpSuccess(toMcpPayload({
          samples,
          count: samples.length,
          profileRevision: parsed.data.expected_profile_revision + 1,
          eligibleAsFinalizationAnchor: false,
        }));
      }

      if (name === 'get_brand_voice') {
        const parsed = getBrandVoiceInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const result = await dependencies.getBrandVoicePage({
          workspaceId: parsed.data.workspace_id,
          anchorLimit: parsed.data.anchor_limit,
          anchorCursor: parsed.data.anchor_cursor,
        });
        const proposals = pendingVoiceProposals(
          dependencies.getVoiceProfile(parsed.data.workspace_id),
        );
        return mcpSuccess(toMcpPayload(projectBrandVoiceReadiness(result, proposals)));
      }

      if (name === 'get_pending_approvals') {
        const parsed = getPendingApprovalsMcpInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
        const result = await dependencies.getBrandVoicePage({
          workspaceId: parsed.data.workspace_id,
          anchorLimit: 1,
        });
        const proposals = pendingVoiceProposals(
          dependencies.getVoiceProfile(parsed.data.workspace_id),
        );
        return mcpSuccess(toMcpPayload(projectPendingApprovals(
          result,
          proposals,
          dependencies.listDeliverables(parsed.data.workspace_id),
        )));
      }

      if (name === 'finalize_brand_voice') {
        const parsed = finalizeBrandVoiceMcpInputSchema.safeParse(args);
        if (!parsed.success) return validationError(parsed.error);
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
      if (error instanceof VoiceProfileRevisionConflictError) {
        return draftRevisionConflictError(error);
      }
      if (error instanceof VoiceProfileValidationError || error instanceof VoiceSampleValidationError) {
        return validationError();
      }
      if (error instanceof Error && error.message === 'No voice profile exists for this workspace') {
        return notFoundError();
      }
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
          tool: name === 'get_brand_voice'
            || name === 'get_pending_approvals'
            || name === 'finalize_brand_voice'
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
