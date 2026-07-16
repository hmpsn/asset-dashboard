import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import { ZodError } from 'zod';
import {
  getBrandIntakeInputSchema,
  resolveBrandIntakeEvidenceInputSchema,
  submitBrandIntakeInputSchema,
} from '../../../shared/types/mcp-brand-intake-schemas.js';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolExecutionContext,
} from '../../../shared/types/mcp-runtime.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import {
  BrandIntakeConflictError,
  BrandIntakeIdempotencyConflictError,
  BrandIntakeNotFoundError,
  BrandIntakePersistenceContractError,
  getBrandIntakeRevision,
  resolveBrandIntakeEvidence,
  submitBrandIntake,
  type BrandIntakePostCommitEffect,
} from '../../domains/brand/intake/index.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { createLogger } from '../../logger.js';
import { getWorkspace } from '../../workspaces.js';
import { WS_EVENTS } from '../../ws-events.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { mcpJsonV1Error } from '../tool-errors.js';
import { mcpSuccess } from '../tool-helpers.js';

const log = createLogger('mcp-tools-brand-intake-actions');

export const brandIntakeActionTools: Tool[] = [
  {
    name: 'submit_brand_intake',
    description:
      'Submit the brand-intake questionnaire from MCP chat as a normalized immutable revision. Empty fields stay empty, never-invent rules apply, and a caller-stable idempotency key safely replays delayed retries.',
    inputSchema: toMcpJsonSchema(submitBrandIntakeInputSchema),
  },
  {
    name: 'get_brand_intake',
    description:
      'Read the current immutable brand-intake revision, or one exact named revision, with typed field-level evidence availability. Read-only; does not generate brand deliverables or expose authentication secrets.',
    inputSchema: toMcpJsonSchema(getBrandIntakeInputSchema),
  },
  {
    name: 'resolve_brand_intake_evidence',
    description:
      'Correct or evidence-resolve one exact current brand-intake field with a typed, durable factual source. Creates or idempotently reuses an immutable successor revision; stale revisions and mismatched requirement identities are rejected.',
    inputSchema: toMcpJsonSchema(resolveBrandIntakeEvidenceInputSchema),
  },
];

type MaybePromise<T> = T | Promise<T>;

export interface BrandIntakeActionDependencies {
  getWorkspace: typeof getWorkspace;
  submitBrandIntake: typeof submitBrandIntake;
  getBrandIntakeRevision: typeof getBrandIntakeRevision;
  resolveBrandIntakeEvidence: (
    request: Parameters<typeof resolveBrandIntakeEvidence>[0],
  ) => MaybePromise<ReturnType<typeof resolveBrandIntakeEvidence>>;
  addActivity: typeof addActivity;
  broadcastToWorkspace: typeof broadcastToWorkspace;
  invalidateIntelligenceCache: typeof invalidateIntelligenceCache;
}

const defaultDependencies: BrandIntakeActionDependencies = {
  getWorkspace,
  submitBrandIntake,
  getBrandIntakeRevision,
  resolveBrandIntakeEvidence,
  addActivity,
  broadcastToWorkspace,
  invalidateIntelligenceCache,
};

function snakeCaseKey(key: string): string {
  return key.replace(/[A-Z]/g, character => `_${character.toLowerCase()}`);
}

function toMcpPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => toMcpPayload(item));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [snakeCaseKey(key), toMcpPayload(child)]),
  );
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
    message: 'The requested workspace or brand-intake revision was not found.',
    retryable: false,
  });
}

function revisionConflictError(error: BrandIntakeConflictError): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.CONFLICT,
    message: 'The brand intake changed. Re-read it and retry against the current revision.',
    retryable: true,
    details: {
      expected_revision: error.expectedRevision,
      actual_revision: error.actualRevision,
    },
  });
}

function idempotencyConflictError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.CONFLICT,
    message: 'The idempotency key already represents a different brand-intake resolution.',
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
    message: 'Unknown brand intake tool: the requested tool does not exist.',
    retryable: false,
  });
}

function resolverAttribution(context: McpToolExecutionContext) {
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

function applyPostCommitEffect(
  workspaceId: string,
  effect: BrandIntakePostCommitEffect,
  dependencies: BrandIntakeActionDependencies,
): void {
  const bestEffort = (effectName: string, run: () => void): void => {
    try {
      run();
    } catch (_err) {
      log.error(
        { workspaceId, effectName, failureClass: 'post_commit_effect' },
        'Brand intake MCP post-commit effect failed',
      );
    }
  };

  bestEffort('activity', () => dependencies.addActivity(
    workspaceId,
    effect.activity.type,
    effect.activity.title,
    effect.activity.description,
    {
      source: 'mcp-chat',
      action: effect.workspaceUpdated.action,
      intakeRevisionId: effect.workspaceUpdated.intakeRevisionId,
      revision: effect.workspaceUpdated.revision,
    },
  ));
  bestEffort('workspace_broadcast', () => dependencies.broadcastToWorkspace(
    workspaceId,
    WS_EVENTS.WORKSPACE_UPDATED,
    effect.workspaceUpdated,
  ));
  bestEffort('intelligence_invalidation', () => {
    dependencies.invalidateIntelligenceCache(workspaceId);
  });
}

export function createBrandIntakeActionHandler(
  dependencies: BrandIntakeActionDependencies = defaultDependencies,
) {
  return async function handle(
    name: string,
    args: Record<string, unknown>,
    context: McpToolExecutionContext,
  ): Promise<CallToolResult> {
    try {
      if (name === 'submit_brand_intake') {
        const parsed = submitBrandIntakeInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        if (!dependencies.getWorkspace(parsed.data.workspace_id)) return notFoundError();
        const questionnaire = parsed.data.questionnaire;
        const result = dependencies.submitBrandIntake({
          workspaceId: parsed.data.workspace_id,
          source: 'mcp',
          submitter: resolverAttribution(context),
          idempotencyKey: parsed.data.idempotency_key,
          payload: {
            schemaVersion: 1,
            business: {
              businessName: questionnaire.business.business_name,
              industry: questionnaire.business.industry,
              description: questionnaire.business.description,
              services: questionnaire.business.services,
              locations: questionnaire.business.locations,
              differentiators: questionnaire.business.differentiators,
              website: questionnaire.business.website,
            },
            audience: {
              primaryAudience: questionnaire.audience.primary_audience,
              painPoints: questionnaire.audience.pain_points,
              goals: questionnaire.audience.goals,
              objections: questionnaire.audience.objections,
              buyingStage: questionnaire.audience.buying_stage,
              secondaryAudience: questionnaire.audience.secondary_audience,
            },
            brand: {
              tone: questionnaire.brand.tone,
              personality: questionnaire.brand.personality,
              avoidWords: questionnaire.brand.avoid_words,
              contentFormats: questionnaire.brand.content_formats,
              existingExamples: questionnaire.brand.existing_examples,
            },
            competitors: {
              competitors: questionnaire.competitors.competitors,
              whatTheyDoBetter: questionnaire.competitors.what_they_do_better,
              whatYouDoBetter: questionnaire.competitors.what_you_do_better,
              referenceUrls: questionnaire.competitors.reference_urls,
            },
            authenticSamples: [],
          },
        });
        if (result.created && !result.replayed && result.postCommitEffect) {
          applyPostCommitEffect(parsed.data.workspace_id, result.postCommitEffect, dependencies);
        }
        return mcpSuccess(toMcpPayload({
          revision: result.revision,
          created: result.created,
          replayed: result.replayed,
        }));
      }

      if (name === 'get_brand_intake') {
        const parsed = getBrandIntakeInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        if (!dependencies.getWorkspace(parsed.data.workspace_id)) return notFoundError();
        const result = dependencies.getBrandIntakeRevision({
          workspaceId: parsed.data.workspace_id,
          intakeRevisionId: parsed.data.intake_revision_id,
        });
        if (parsed.data.intake_revision_id && result.revision === null) {
          return notFoundError();
        }
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'resolve_brand_intake_evidence') {
        const parsed = resolveBrandIntakeEvidenceInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const result = await dependencies.resolveBrandIntakeEvidence({
          workspaceId: parsed.data.workspace_id,
          intakeRevisionId: parsed.data.intake_revision_id,
          expectedRevision: parsed.data.expected_revision,
          requirementId: parsed.data.requirement_id,
          fieldPath: parsed.data.field_path,
          value: parsed.data.value,
          sourceRef: {
            sourceType: parsed.data.source_ref.source_type,
            sourceId: parsed.data.source_ref.source_id,
            sourceRevision: parsed.data.source_ref.source_revision,
            fieldPath: parsed.data.source_ref.field_path,
            label: parsed.data.source_ref.label,
            uri: parsed.data.source_ref.uri,
            capturedAt: parsed.data.source_ref.captured_at,
          },
          resolvedBy: resolverAttribution(context),
          idempotencyKey: parsed.data.idempotency_key,
        });
        if (result.created && !result.replayed && result.postCommitEffect) {
          applyPostCommitEffect(parsed.data.workspace_id, result.postCommitEffect, dependencies);
        }
        return mcpSuccess(toMcpPayload({
          revision: result.revision,
          created: result.created,
          replayed: result.replayed,
        }));
      }

      return unknownToolError();
    } catch (error) {
      if (error instanceof ZodError) return validationError();
      if (error instanceof BrandIntakeNotFoundError) return notFoundError();
      if (error instanceof BrandIntakeConflictError) return revisionConflictError(error);
      if (error instanceof BrandIntakeIdempotencyConflictError) {
        return idempotencyConflictError();
      }
      log.error(
        {
          tool: name,
          failureClass: error instanceof BrandIntakePersistenceContractError
            ? 'persistence_contract'
            : 'handler_exception',
        },
        'Brand intake MCP tool execution failed',
      );
      return internalError();
    }
  };
}

export const handleBrandIntakeActionTool = createBrandIntakeActionHandler();
