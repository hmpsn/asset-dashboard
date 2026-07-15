import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';

import type {
  GetBrandContentOnboardingRequest,
  PublicBrandContentOnboardingRun,
  ResumeBrandContentOnboardingRequest,
  ResumeBrandContentOnboardingResult,
  StartBrandContentOnboardingRequest,
  StartBrandContentOnboardingResult,
} from '../../../shared/types/brand-content-onboarding.js';
import {
  getBrandContentOnboardingInputSchema,
  resumeBrandContentOnboardingInputSchema,
  startBrandContentOnboardingInputSchema,
} from '../../../shared/types/mcp-brand-content-onboarding-schemas.js';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolExecutionContext,
} from '../../../shared/types/mcp-runtime.js';
import {
  BrandContentOnboardingServiceError,
  getBrandContentOnboarding,
  resumeBrandContentOnboarding,
  startBrandContentOnboarding,
} from '../../domains/brand-content-onboarding/service.js';
import {
  BrandContentOnboardingIdempotencyConflictError,
  BrandContentOnboardingNotFoundError,
  BrandContentOnboardingResumeIdempotencyConflictError,
  BrandContentOnboardingRevisionConflictError,
} from '../../domains/brand-content-onboarding/repository.js';
import { createLogger } from '../../logger.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { recordPaidCallOnce } from '../paid-call-counter.js';
import { mcpJsonV1Error, type McpToolErrorDetails } from '../tool-errors.js';
import { mcpSuccess } from '../tool-helpers.js';

const log = createLogger('mcp-tools-brand-content-onboarding');

export const brandContentOnboardingActionTools: Tool[] = [
  {
    name: 'start_brand_content_onboarding',
    description:
      '[Paid API] Start one durable intake→brand→content workflow from an exact immutable intake revision and non-empty matrix-cell selection. Starts only the existing full-brand-system child; every voice, operator, client, content, and page-review gate remains explicit. Never sends, approves, or publishes.',
    inputSchema: toMcpJsonSchema(startBrandContentOnboardingInputSchema),
  },
  {
    name: 'get_brand_content_onboarding',
    description:
      'Read one durable brand→content onboarding workflow, its current gate, frozen brand authority, and child references. Excludes operational idempotency and MCP key identity.',
    inputSchema: toMcpJsonSchema(getBrandContentOnboardingInputSchema),
  },
  {
    name: 'resume_brand_content_onboarding',
    description:
      '[Conditionally paid] Re-read durable child evidence and advance at most one onboarding gate. It may resume the existing dependent brand child after human voice finalization, but it cannot supply human content authorization, auto-send reviews, auto-approve pages, or publish.',
    inputSchema: toMcpJsonSchema(resumeBrandContentOnboardingInputSchema),
  },
];

type MaybePromise<T> = T | Promise<T>;

export interface BrandContentOnboardingActionDependencies {
  startBrandContentOnboarding: (
    request: StartBrandContentOnboardingRequest,
  ) => MaybePromise<StartBrandContentOnboardingResult>;
  getBrandContentOnboarding: (
    request: GetBrandContentOnboardingRequest,
  ) => MaybePromise<PublicBrandContentOnboardingRun>;
  resumeBrandContentOnboarding: (
    request: ResumeBrandContentOnboardingRequest,
  ) => MaybePromise<ResumeBrandContentOnboardingResult>;
}

const defaultDependencies: BrandContentOnboardingActionDependencies = {
  startBrandContentOnboarding,
  getBrandContentOnboarding,
  resumeBrandContentOnboarding,
};

function mcpAttribution(context: McpToolExecutionContext) {
  return context.caller.kind === 'workspace_key' ? {
    actorType: 'mcp' as const,
    actorId: context.caller.keyId,
    actorLabel: context.caller.keyLabel,
  } : {
    actorType: 'mcp' as const,
    actorId: 'mcp:master-key',
    actorLabel: 'MCP master key',
  };
}

function snakeCaseKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function toMcpPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toMcpPayload);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [snakeCaseKey(key), toMcpPayload(child)]),
  );
}

function error(
  code: (typeof MCP_TOOL_ERROR_CODES)[keyof typeof MCP_TOOL_ERROR_CODES],
  message: string,
  retryable: boolean,
  details?: McpToolErrorDetails,
): CallToolResult {
  return mcpJsonV1Error({ code, message, retryable, ...(details ? { details } : {}) });
}

function success(
  result: StartBrandContentOnboardingResult | ResumeBrandContentOnboardingResult,
  workspaceId: string,
): CallToolResult {
  let warning: string | undefined;
  if (result.paidJobId) {
    warning = recordPaidCallOnce(
      `mcp:brand-content-onboarding:accepted-child:${result.paidJobId}`,
      1,
      workspaceId,
    ).warning;
  }
  return mcpSuccess(toMcpPayload({ ...result, ...(warning ? { warning } : {}) }));
}

export function createBrandContentOnboardingActionHandler(
  dependencies: BrandContentOnboardingActionDependencies = defaultDependencies,
) {
  return async function handle(
    name: string,
    args: Record<string, unknown>,
    context: McpToolExecutionContext,
  ): Promise<CallToolResult> {
    try {
      if (name === 'start_brand_content_onboarding') {
        const parsed = startBrandContentOnboardingInputSchema.safeParse(args);
        if (!parsed.success) {
          return error(MCP_TOOL_ERROR_CODES.VALIDATION_FAILED, 'The tool input is invalid.', false);
        }
        const data = parsed.data;
        const mappedSelection = data.matrix_selection.map(selection => ({
          matrixId: selection.matrix_id,
          cellId: selection.cell_id,
          sourceRevision: {
            matrixRevision: selection.source_revision.matrix_revision,
            templateRevision: selection.source_revision.template_revision,
            cellRevision: selection.source_revision.cell_revision,
          },
          structuralFingerprint: selection.structural_fingerprint,
          previewFingerprint: selection.preview_fingerprint,
        }));
        const matrixSelection = [
          mappedSelection[0]!,
          ...mappedSelection.slice(1),
        ] as StartBrandContentOnboardingRequest['matrixSelection'];
        const result = await dependencies.startBrandContentOnboarding({
          workspaceId: data.workspace_id,
          intakeRevisionId: data.intake_revision_id,
          expectedIntakeRevision: data.expected_intake_revision,
          expectedIntakeFingerprint: data.expected_intake_fingerprint,
          matrixSelection,
          brandBudget: {
            maxProviderCalls: data.brand_budget.max_provider_calls,
            maxInputTokens: data.brand_budget.max_input_tokens,
            maxOutputTokens: data.brand_budget.max_output_tokens,
            maxEstimatedCostMicros: data.brand_budget.max_estimated_cost_micros,
            maxConcurrency: data.brand_budget.max_concurrency,
          },
          idempotencyKey: data.idempotency_key,
          startedBy: mcpAttribution(context),
          mcpExecutionContext: context,
        });
        return success(result, data.workspace_id);
      }

      if (name === 'get_brand_content_onboarding') {
        const parsed = getBrandContentOnboardingInputSchema.safeParse(args);
        if (!parsed.success) {
          return error(MCP_TOOL_ERROR_CODES.VALIDATION_FAILED, 'The tool input is invalid.', false);
        }
        const result = await dependencies.getBrandContentOnboarding({
          workspaceId: parsed.data.workspace_id,
          runId: parsed.data.run_id,
        });
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'resume_brand_content_onboarding') {
        const parsed = resumeBrandContentOnboardingInputSchema.safeParse(args);
        if (!parsed.success) {
          return error(MCP_TOOL_ERROR_CODES.VALIDATION_FAILED, 'The tool input is invalid.', false);
        }
        const data = parsed.data;
        const result = await dependencies.resumeBrandContentOnboarding({
          workspaceId: data.workspace_id,
          runId: data.run_id,
          expectedRevision: data.expected_revision,
          expectedStatus: data.expected_status,
          gateEvidenceId: data.gate_evidence_id,
          idempotencyKey: data.idempotency_key,
          resumedBy: mcpAttribution(context),
          mcpExecutionContext: context,
        });
        return success(result, data.workspace_id);
      }

      return error(
        MCP_TOOL_ERROR_CODES.NOT_FOUND,
        'Unknown brand content onboarding tool: the requested tool does not exist.',
        false,
      );
    } catch (caught) {
      if (caught instanceof BrandContentOnboardingNotFoundError
        || (caught instanceof BrandContentOnboardingServiceError && caught.code === 'not_found')) {
        return error(MCP_TOOL_ERROR_CODES.NOT_FOUND, 'The onboarding run was not found.', false);
      }
      if (caught instanceof BrandContentOnboardingRevisionConflictError) {
        return error(
          MCP_TOOL_ERROR_CODES.CONFLICT,
          'The onboarding run changed. Re-read it before retrying.',
          true,
          { expected_revision: caught.expectedRevision, actual_revision: caught.actualRevision },
        );
      }
      if (caught instanceof BrandContentOnboardingIdempotencyConflictError
        || caught instanceof BrandContentOnboardingResumeIdempotencyConflictError) {
        return error(MCP_TOOL_ERROR_CODES.CONFLICT, 'The idempotency key represents different onboarding inputs.', false);
      }
      if (caught instanceof BrandContentOnboardingServiceError) {
        return error(
          caught.code === 'authority_changed'
            ? MCP_TOOL_ERROR_CODES.CONFLICT
            : MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
          caught.message,
          caught.code === 'authority_changed',
        );
      }
      log.error({ tool: name, failureClass: 'handler_exception' }, 'Onboarding MCP tool failed');
      return error(MCP_TOOL_ERROR_CODES.INTERNAL_ERROR, 'The onboarding tool could not complete.', false);
    }
  };
}

export const handleBrandContentOnboardingActionTool =
  createBrandContentOnboardingActionHandler();
