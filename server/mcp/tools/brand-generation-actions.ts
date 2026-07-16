import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';

import type {
  BrandGenerationAtomicTarget,
  BrandGenerationCommandResult,
  BrandGenerationPreset,
  GetBrandGenerationRequest,
  GetBrandGenerationResult,
  ResumeBrandGenerationRequest,
  ResumeBrandGenerationResult,
  ReviseBrandGenerationItemRequest,
  ReviseBrandGenerationItemResult,
  StartBrandGenerationRequest,
  StartBrandGenerationResult,
} from '../../../shared/types/brand-generation.js';
import {
  getBrandGenerationInputSchema,
  resumeBrandDeliverableGenerationInputSchema,
  startBrandDeliverableGenerationInputSchema,
  startBrandDeliverableRevisionInputSchema,
} from '../../../shared/types/mcp-brand-generation-schemas.js';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolExecutionContext,
} from '../../../shared/types/mcp-runtime.js';
import {
  BrandGenerationApprovedDeliverableError,
  BrandGenerationBudgetExceededError,
  BrandGenerationConcurrencyLimitError,
  BrandGenerationCursorError,
  BrandGenerationIdempotencyConflictError,
  BrandGenerationNotFoundError,
  BrandGenerationPreconditionError,
  BrandGenerationRevisionConflictError,
} from '../../domains/brand/generation/errors.js';
import {
  getBrandGeneration,
  resumeBrandGeneration,
  reviseBrandGenerationItem,
  startBrandGeneration,
} from '../../domains/brand/generation/service.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { recordPaidCallOnce } from '../paid-call-counter.js';
import { mcpJsonV1Error, mcpZodValidationError } from '../tool-errors.js';
import { mcpSuccess } from '../tool-helpers.js';

const log = createLogger('mcp-tools-brand-generation-actions');

export const brandGenerationActionTools: Tool[] = [
  {
    name: 'start_brand_deliverable_generation',
    description:
      '[Paid API] Start one grounded, review-gated brand target or preset from an exact immutable intake revision. Durable targets require exact finalized voice authority; full_brand_system starts only a provisional voice foundation. This is paid background work and requires explicit bounded budgets plus an idempotency key.',
    inputSchema: toMcpJsonSchema(startBrandDeliverableGenerationInputSchema),
  },
  {
    name: 'get_brand_generation',
    description:
      'Read one durable brand-generation run and a bounded page of its items. The public projection excludes idempotency keys and MCP key identity; use item_cursor while has_more is true.',
    inputSchema: toMcpJsonSchema(getBrandGenerationInputSchema),
  },
  {
    name: 'resume_brand_deliverable_generation',
    description:
      '[Paid API] Resume the dependent targets of a paused full_brand_system run after a human has finalized the exact voice version. Requires the exact run revision, voice fingerprint, and a caller-stable idempotency key.',
    inputSchema: toMcpJsonSchema(resumeBrandDeliverableGenerationInputSchema),
  },
  {
    name: 'start_brand_deliverable_revision',
    description:
      '[Paid API] Start one review-directed revision of a generated durable brand deliverable. Requires exact run, item, and deliverable versions; a later human edit wins and generated work never auto-approves.',
    inputSchema: toMcpJsonSchema(startBrandDeliverableRevisionInputSchema),
  },
];

type MaybePromise<T> = T | Promise<T>;

export interface BrandGenerationActionDependencies {
  startBrandGeneration: (
    request: StartBrandGenerationRequest,
  ) => MaybePromise<StartBrandGenerationResult>;
  getBrandGeneration: (
    request: GetBrandGenerationRequest,
  ) => MaybePromise<GetBrandGenerationResult>;
  resumeBrandGeneration: (
    request: ResumeBrandGenerationRequest,
  ) => MaybePromise<ResumeBrandGenerationResult>;
  reviseBrandGenerationItem: (
    request: ReviseBrandGenerationItemRequest,
  ) => MaybePromise<ReviseBrandGenerationItemResult>;
}

const defaultDependencies: BrandGenerationActionDependencies = {
  startBrandGeneration,
  getBrandGeneration,
  resumeBrandGeneration,
  reviseBrandGenerationItem,
};

const PRIVATE_PUBLIC_BOUNDARY_KEYS = new Set([
  'executionActor',
  'execution_actor',
  'idempotencyKey',
  'idempotency_key',
  'mcpExecutionContext',
  'mcp_execution_context',
  'requestSnapshot',
  'request_snapshot',
]);

/** Defense in depth if a service accidentally returns a persisted/internal DTO. */
function projectPublicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectPublicValue);
  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const actorType = record.actorType ?? record.actor_type;
  if (actorType === 'mcp' || actorType === 'system') {
    return { actorType };
  }

  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !PRIVATE_PUBLIC_BOUNDARY_KEYS.has(key))
      .map(([key, child]) => [key, projectPublicValue(child)]),
  );
}

function snakeCaseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

function toMcpPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toMcpPayload);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [snakeCaseKey(key), toMcpPayload(child)]),
  );
}

function paidCommandSuccess(
  result: BrandGenerationCommandResult,
  workspaceId: string,
): CallToolResult {
  // Meter every successful result, including an exact domain replay. The
  // durable event key makes ordinary replays no-ops while allowing a replay to
  // repair metering if the process crashed after acceptance but before this
  // boundary committed the paid-trigger event.
  const eventKey = `mcp:brand-generation:accepted-command:${result.jobId}`;
  const warning = recordPaidCallOnce(eventKey, 1, workspaceId).warning;
  return mcpSuccess(toMcpPayload(projectPublicValue({
    ...result,
    ...(warning ? { warning } : {}),
  })));
}

function mcpAttribution(context: McpToolExecutionContext) {
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

function notFoundError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
    message: 'The requested brand-generation resource was not found.',
    retryable: false,
  });
}

function revisionConflictError(error: BrandGenerationRevisionConflictError): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.CONFLICT,
    message: 'The brand-generation resource changed. Re-read it before retrying.',
    retryable: true,
    details: {
      resource: error.resource,
      expected_revision: error.expectedRevision,
      actual_revision: error.actualRevision,
    },
  });
}

function idempotencyConflictError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.CONFLICT,
    message: 'The idempotency key already represents a different brand-generation command.',
    retryable: false,
  });
}

function concurrencyError(error: BrandGenerationConcurrencyLimitError): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.RATE_LIMITED,
    message: 'The brand-generation concurrency limit is currently full.',
    retryable: true,
    details: {
      running_attempts: error.runningAttempts,
      max_concurrency: error.maxConcurrency,
    },
  });
}

function budgetError(error: BrandGenerationBudgetExceededError): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
    message: 'The requested brand-generation budget is outside the allowed bounds.',
    retryable: false,
    details: {
      dimension: snakeCaseKey(error.dimension),
      requested: error.requested,
      limit: error.limit,
    },
  });
}

function preconditionError(error: BrandGenerationPreconditionError): CallToolResult {
  const publicPromptReasons = new Set([
    'input_too_large',
    'output_envelope_too_small',
    'stage_closure_failed',
    'voice_authority_invalid',
  ]);
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
    message: publicPromptReasons.has(error.reason)
      ? error.message
      : 'The brand-generation prerequisites are not satisfied.',
    retryable: false,
    details: { reason: error.reason },
  });
}

function approvedDeliverableError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
    message: 'An approved brand deliverable must be returned to draft before generation.',
    retryable: false,
  });
}

function cursorError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
    message: 'The item cursor is invalid or stale for this run.',
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
    message: 'Unknown brand generation tool: the requested tool does not exist.',
    retryable: false,
  });
}

function toStartRequest(
  data: ReturnType<typeof startBrandDeliverableGenerationInputSchema.parse>,
  context: McpToolExecutionContext,
): StartBrandGenerationRequest {
  const common = {
    workspaceId: data.workspace_id,
    intakeRevisionId: data.intake_revision_id,
    expectedIntakeRevision: data.expected_intake_revision,
    expectedIntakeFingerprint: data.expected_intake_fingerprint,
    budget: {
      maxProviderCalls: data.budget.max_provider_calls,
      maxInputTokens: data.budget.max_input_tokens,
      maxOutputTokens: data.budget.max_output_tokens,
      maxEstimatedCostMicros: data.budget.max_estimated_cost_micros,
      maxConcurrency: data.budget.max_concurrency,
    },
    idempotencyKey: data.idempotency_key,
    createdBy: mcpAttribution(context),
    mcpExecutionContext: context,
  };

  if (data.selection.kind === 'atomic' && data.selection.target === 'voice_foundation') {
    return { ...common, selection: { kind: 'atomic', target: 'voice_foundation' } };
  }
  if (data.selection.kind === 'preset' && data.selection.preset === 'full_brand_system') {
    return { ...common, selection: { kind: 'preset', preset: 'full_brand_system' } };
  }
  if (data.selection.kind === 'atomic') {
    return {
      ...common,
      selection: {
        kind: 'atomic',
        target: data.selection.target as Exclude<BrandGenerationAtomicTarget, 'voice_foundation'>,
      },
      expectedVoiceVersion: data.expected_voice_version as number,
      expectedVoiceFingerprint: data.expected_voice_fingerprint as string,
    };
  }

  return {
    ...common,
    selection: {
      kind: 'preset',
      preset: data.selection.preset as Exclude<BrandGenerationPreset, 'full_brand_system'>,
    },
    expectedVoiceVersion: data.expected_voice_version as number,
    expectedVoiceFingerprint: data.expected_voice_fingerprint as string,
  };
}

export function createBrandGenerationActionHandler(
  dependencies: BrandGenerationActionDependencies = defaultDependencies,
) {
  return async function handle(
    name: string,
    args: Record<string, unknown>,
    context: McpToolExecutionContext,
  ): Promise<CallToolResult> {
    try {
      if (name === 'start_brand_deliverable_generation') {
        const parsed = startBrandDeliverableGenerationInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const result = await dependencies.startBrandGeneration(toStartRequest(parsed.data, context));
        return paidCommandSuccess(result, parsed.data.workspace_id);
      }

      if (name === 'get_brand_generation') {
        const parsed = getBrandGenerationInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const result = await dependencies.getBrandGeneration({
          workspaceId: parsed.data.workspace_id,
          runId: parsed.data.run_id,
          cursor: parsed.data.item_cursor,
          limit: parsed.data.item_limit,
        });
        return mcpSuccess(toMcpPayload(projectPublicValue(result)));
      }

      if (name === 'resume_brand_deliverable_generation') {
        const parsed = resumeBrandDeliverableGenerationInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const result = await dependencies.resumeBrandGeneration({
          workspaceId: parsed.data.workspace_id,
          runId: parsed.data.run_id,
          expectedRunRevision: parsed.data.expected_run_revision,
          expectedVoiceVersion: parsed.data.expected_voice_version,
          expectedVoiceFingerprint: parsed.data.expected_voice_fingerprint,
          idempotencyKey: parsed.data.idempotency_key,
          resumedBy: mcpAttribution(context),
          mcpExecutionContext: context,
        });
        return paidCommandSuccess(result, parsed.data.workspace_id);
      }

      if (name === 'start_brand_deliverable_revision') {
        const parsed = startBrandDeliverableRevisionInputSchema.safeParse(args);
        if (!parsed.success) return mcpZodValidationError(parsed.error);
        const result = await dependencies.reviseBrandGenerationItem({
          workspaceId: parsed.data.workspace_id,
          runId: parsed.data.run_id,
          itemId: parsed.data.item_id,
          expectedRunRevision: parsed.data.expected_run_revision,
          expectedItemRevision: parsed.data.expected_item_revision,
          deliverableId: parsed.data.deliverable_id,
          expectedDeliverableVersion: parsed.data.expected_deliverable_version,
          direction: parsed.data.direction,
          idempotencyKey: parsed.data.idempotency_key,
          requestedBy: mcpAttribution(context),
          mcpExecutionContext: context,
        });
        return paidCommandSuccess(result, parsed.data.workspace_id);
      }

      return unknownToolError();
    } catch (error) {
      if (error instanceof BrandGenerationCursorError) return cursorError();
      if (error instanceof BrandGenerationNotFoundError) return notFoundError();
      if (error instanceof BrandGenerationRevisionConflictError) {
        return revisionConflictError(error);
      }
      if (error instanceof BrandGenerationIdempotencyConflictError) {
        return idempotencyConflictError();
      }
      if (error instanceof BrandGenerationConcurrencyLimitError) {
        return concurrencyError(error);
      }
      if (error instanceof BrandGenerationBudgetExceededError) return budgetError(error);
      if (error instanceof BrandGenerationApprovedDeliverableError) {
        return approvedDeliverableError();
      }
      if (error instanceof BrandGenerationPreconditionError) return preconditionError(error);
      log.error(
        {
          tool: brandGenerationActionTools.some(tool => tool.name === name)
            ? name
            : 'unknown_brand_generation_tool',
          failureClass: 'handler_exception',
        },
        'Brand generation MCP tool execution failed',
      );
      return internalError();
    }
  };
}

export const handleBrandGenerationActionTool = createBrandGenerationActionHandler();
