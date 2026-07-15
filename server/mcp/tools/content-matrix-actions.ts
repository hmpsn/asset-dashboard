import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import {
  acceptContentTemplateGenerationUpgradeInputSchema,
  createContentMatrixFromPseoPlanInputSchema,
  getContentMatrixGenerationInputSchema,
  getContentMatrixInputSchema,
  getPseoMatrixPlanInputSchema,
  listContentMatricesInputSchema,
  listPseoBlueprintEntriesInputSchema,
  previewContentMatrixGenerationInputSchema,
  resolveContentMatrixEvidenceInputSchema,
  resolveContentMatrixCellsInputSchema,
  retryContentMatrixGenerationInputSchema,
  startContentMatrixGenerationInputSchema,
} from '../../../shared/types/mcp-matrix-schemas.js';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolExecutionContext,
} from '../../../shared/types/mcp-runtime.js';
import {
  MatrixGenerationSourceLimitError,
  type ContentTemplateGenerationUpgradeProposal,
  type PreviewMatrixGenerationResult,
  type ResolveMatrixStructuresResult,
} from '../../../shared/types/matrix-generation.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import {
  getContentMatrix,
  listContentMatrices,
  MatrixReadServiceError,
  resolveMatrixStructures,
} from '../../domains/content/matrix-generation/read-service.js';
import {
  MatrixGenerationEvidenceError,
  resolveContentMatrixEvidence,
} from '../../domains/content/matrix-generation/evidence.js';
import { previewMatrixGeneration } from '../../domains/content/matrix-generation/preview.js';
import {
  getMatrixGeneration,
  MatrixGenerationBatchNotFoundError,
  MatrixGenerationBatchPreconditionError,
  retryMatrixGeneration,
  startMatrixGeneration,
} from '../../domains/content/matrix-generation/batch-service.js';
import {
  acceptTemplateGenerationUpgrade,
  type AcceptTemplateGenerationUpgradeActionResult,
  TemplateGenerationUpgradeError,
} from '../../domains/content/matrix-generation/upgrade-action.js';
import { invalidateContentPipelineIntelligence } from '../../intelligence-freshness.js';
import { ActiveJobResourceConflict } from '../../jobs.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { recordPaidCallOnce } from '../paid-call-counter.js';
import { mcpJsonV1Error } from '../tool-errors.js';
import { mcpSuccess } from '../tool-helpers.js';
import { WS_EVENTS } from '../../ws-events.js';
import {
  createMatrixFromPseoPlan,
  getPseoMatrixPlan,
  listPseoBlueprintEntries,
  PseoMatrixBridgeError,
} from '../../domains/content/matrix-generation/pseo-bridge.js';
import { createLogger } from '../../logger.js';

const log = createLogger('mcp-content-matrix-actions');

export const contentMatrixActionTools: Tool[] = [
  {
    name: 'list_pseo_blueprint_entries',
    description:
      'List bounded collection blueprint entries with their durable blueprint_id, entry_id, linked template_id, and linked matrix_id. Read-only; get_pseo_matrix_plan performs authoritative readiness validation.',
    inputSchema: toMcpJsonSchema(listPseoBlueprintEntriesInputSchema),
  },
  {
    name: 'list_content_matrices',
    description:
      'List a workspace\'s content matrices as bounded summaries ordered by most recently updated, then stable matrix ID. Optionally filter by template_id. This read never returns cell blobs, calls AI, or creates a generation run.',
    inputSchema: toMcpJsonSchema(listContentMatricesInputSchema),
  },
  {
    name: 'get_content_matrix',
    description:
      'Get one content matrix\'s metadata and a bounded page of cells. The opaque cursor is tied to the matrix revision and exact cell snapshot, so a cell-only edit returns a conflict instead of mixing snapshots. Read-only; no AI or artifact writes.',
    inputSchema: toMcpJsonSchema(getContentMatrixInputSchema),
  },
  {
    name: 'resolve_content_matrix_cells',
    description:
      'Deterministically resolve up to 25 explicitly selected matrix cells from exact matrix/template/cell revisions. Returns structural targets, typed blockers, or fingerprint references to de-duplicated legacy-template upgrade proposals. Does not resolve voice, estimate paid work, call AI, create runs, or write artifacts.',
    inputSchema: toMcpJsonSchema(resolveContentMatrixCellsInputSchema),
  },
  {
    name: 'accept_content_template_generation_upgrade',
    description:
      'Accept or reject the exact deterministic generation-contract upgrade proposed for a legacy content template. Acceptance uses the expected template revision, proposal fingerprint, and idempotency key for a version-conditional write; rejection is a no-op.',
    inputSchema: toMcpJsonSchema(acceptContentTemplateGenerationUpgradeInputSchema),
  },
  {
    name: 'preview_content_matrix_generation',
    description:
      'Preview explicitly selected matrix cells for generation readiness without paid work. Resolves current source revisions, finalized voice, page-type-approved identity, evidence requirements, linked artifact revisions, effective input fingerprints, and bounded call/token/cost estimates.',
    inputSchema: toMcpJsonSchema(previewContentMatrixGenerationInputSchema),
  },
  {
    name: 'resolve_content_matrix_evidence',
    description:
      'Resolve one stable matrix-cell evidence requirement with a typed value and factual source. The version-conditional mutation advances only that cell revision, invalidating the prior preview; re-preview before any generation start.',
    inputSchema: toMcpJsonSchema(resolveContentMatrixEvidenceInputSchema),
  },
  {
    name: 'start_content_matrix_generation',
    description:
      '[Paid API] Start one bounded background generation run for explicitly previewed matrix cells. Requires exact source revisions, preview fingerprints, caller-accepted budget ceilings, and an idempotency key. Produces review-ready drafts only; never approves or publishes.',
    inputSchema: toMcpJsonSchema(startContentMatrixGenerationInputSchema),
  },
  {
    name: 'get_content_matrix_generation',
    description:
      'Read one durable matrix generation run and a cursor-paged set of per-cell outcomes, audit findings, artifact IDs, and human approval evidence.',
    inputSchema: toMcpJsonSchema(getContentMatrixGenerationInputSchema),
  },
  {
    name: 'retry_content_matrix_generation',
    description:
      '[Paid API] Resume explicitly selected failed or needs-attention matrix items from exact run, item, source, artifact, and reusable-checkpoint revisions. Does not replace approved work and never publishes.',
    inputSchema: toMcpJsonSchema(retryContentMatrixGenerationInputSchema),
  },
  {
    name: 'get_pseo_matrix_plan',
    description:
      'Read one collection blueprint entry, its linked template variables, and exact source authority for safe matrix materialization. Bounded and read-only; never creates a matrix or starts generation.',
    inputSchema: toMcpJsonSchema(getPseoMatrixPlanInputSchema),
  },
  {
    name: 'create_content_matrix_from_pseo_plan',
    description:
      'Idempotently materialize one collection blueprint entry into a validated content matrix from exact source authority plus explicit service/location or other template dimensions. Records the matrix source link. Never previews, starts AI generation, approves, sends, or publishes.',
    inputSchema: toMcpJsonSchema(createContentMatrixFromPseoPlanInputSchema),
  },
];

type MaybePromise<T> = T | Promise<T>;

export interface ContentMatrixActionDependencies {
  listPseoBlueprintEntries: typeof listPseoBlueprintEntries;
  listContentMatrices: typeof listContentMatrices;
  getContentMatrix: typeof getContentMatrix;
  resolveMatrixStructures: typeof resolveMatrixStructures;
  previewMatrixGeneration: typeof previewMatrixGeneration;
  resolveContentMatrixEvidence: typeof resolveContentMatrixEvidence;
  startMatrixGeneration: typeof startMatrixGeneration;
  getMatrixGeneration: typeof getMatrixGeneration;
  retryMatrixGeneration: typeof retryMatrixGeneration;
  getPseoMatrixPlan: typeof getPseoMatrixPlan;
  createMatrixFromPseoPlan: typeof createMatrixFromPseoPlan;
  acceptTemplateGenerationUpgrade: (
    request: Parameters<typeof acceptTemplateGenerationUpgrade>[0],
  ) => MaybePromise<ReturnType<typeof acceptTemplateGenerationUpgrade>>;
  addActivity: typeof addActivity;
  broadcastToWorkspace: typeof broadcastToWorkspace;
  invalidateContentPipelineIntelligence: typeof invalidateContentPipelineIntelligence;
  recordPaidCallOnce: typeof recordPaidCallOnce;
}

const defaultDependencies: ContentMatrixActionDependencies = {
  listPseoBlueprintEntries,
  listContentMatrices,
  getContentMatrix,
  resolveMatrixStructures,
  previewMatrixGeneration,
  resolveContentMatrixEvidence,
  startMatrixGeneration,
  getMatrixGeneration,
  retryMatrixGeneration,
  getPseoMatrixPlan,
  createMatrixFromPseoPlan,
  acceptTemplateGenerationUpgrade,
  addActivity,
  broadcastToWorkspace,
  invalidateContentPipelineIntelligence,
  recordPaidCallOnce,
};

function snakeCaseKey(key: string): string {
  return key.replace(/[A-Z]/g, character => `_${character.toLowerCase()}`);
}

const IDENTITY_KEYED_MAP_FIELDS = new Set([
  'variableValues',
  'slugSubstitutions',
  'proseSubstitutions',
  'cmsFieldMap',
]);

function toMcpPayload(value: unknown, preserveObjectKeys = false): unknown {
  if (Array.isArray(value)) return value.map(item => toMcpPayload(item));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      preserveObjectKeys ? key : snakeCaseKey(key),
      toMcpPayload(child, preserveObjectKeys || IDENTITY_KEYED_MAP_FIELDS.has(key)),
    ]),
  );
}

function paidMatrixCommandSuccess<T extends { jobId: string }>(
  result: T,
  workspaceId: string,
  dependencies: ContentMatrixActionDependencies,
): CallToolResult {
  const eventKey = `mcp:matrix-generation:accepted-command:${result.jobId}`;
  const warning = dependencies.recordPaidCallOnce(eventKey, 1, workspaceId).warning;
  return mcpSuccess(toMcpPayload({
    ...result,
    ...(warning ? { warning } : {}),
  }));
}

function projectResolveResult(result: ResolveMatrixStructuresResult): {
  results: Array<
    | Exclude<ResolveMatrixStructuresResult['results'][number], { status: 'upgrade_required' }>
    | (Omit<
        Extract<ResolveMatrixStructuresResult['results'][number], { status: 'upgrade_required' }>,
        'proposal'
      > & { proposalFingerprint: string })
  >;
  upgradeProposals: ContentTemplateGenerationUpgradeProposal[];
} {
  const upgradeProposals = new Map<string, ContentTemplateGenerationUpgradeProposal>();
  const results = result.results.map(item => {
    if (item.status !== 'upgrade_required') return item;
    upgradeProposals.set(item.proposal.proposalFingerprint, item.proposal);
    const { proposal, ...identity } = item;
    return {
      ...identity,
      proposalFingerprint: proposal.proposalFingerprint,
    };
  });
  return { results, upgradeProposals: [...upgradeProposals.values()] };
}

function projectPreviewResult(result: PreviewMatrixGenerationResult) {
  const upgradeProposals = new Map<string, ContentTemplateGenerationUpgradeProposal>();
  const results = result.results.map(item => {
    if (item.status !== 'upgrade_required') return item;
    upgradeProposals.set(item.proposal.proposalFingerprint, item.proposal);
    const { proposal, ...identity } = item;
    return { ...identity, proposalFingerprint: proposal.proposalFingerprint };
  });
  return {
    results,
    estimatedBatchBudget: result.estimatedBatchBudget,
    upgradeProposals: [...upgradeProposals.values()],
  };
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

function projectTemplateUpgradeResult(result: AcceptTemplateGenerationUpgradeActionResult) {
  return {
    status: result.status,
    templateId: result.template.id,
    templateRevision: result.template.revision ?? 0,
    generationContractVersion: result.template.generationContractVersion ?? null,
    proposalFingerprint: result.proposalFingerprint,
    replayed: result.replayed,
  };
}

function validationError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.VALIDATION_FAILED,
    message: 'The tool input is invalid.',
    retryable: false,
  });
}

function readServiceError(error: MatrixReadServiceError): CallToolResult {
  const code = error.code === 'not_found'
    ? MCP_TOOL_ERROR_CODES.NOT_FOUND
    : error.code === 'conflict'
      ? MCP_TOOL_ERROR_CODES.CONFLICT
      : error.code === 'precondition_failed'
        ? MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED
        : MCP_TOOL_ERROR_CODES.VALIDATION_FAILED;
  const message = error.code === 'not_found'
    ? 'The requested matrix resource was not found.'
    : error.code === 'conflict'
      ? 'The matrix source changed. Re-read it and retry with current revisions.'
      : error.code === 'precondition_failed'
        ? 'The matrix operation prerequisites are not satisfied.'
        : 'The cursor is invalid for this query.';
  return mcpJsonV1Error({
    code,
    message,
    retryable: error.code === 'conflict',
    ...(error.details ? { details: error.details } : {}),
  });
}

function upgradeServiceError(error: TemplateGenerationUpgradeError): CallToolResult {
  if (error.code === 'not_found') {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
      message: 'The requested content template was not found.',
      retryable: false,
    });
  }
  if (error.code === 'conflict') {
    return mcpJsonV1Error({
      code: MCP_TOOL_ERROR_CODES.CONFLICT,
      message: 'The template or upgrade proposal changed. Resolve it again before retrying.',
      retryable: true,
    });
  }
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
    message: 'The template cannot accept this generation upgrade.',
    retryable: false,
  });
}

function generationSourceLimitError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
    message: 'The stored generation source exceeds the bounded generation contract.',
    retryable: false,
  });
}

function pseoBridgeError(error: PseoMatrixBridgeError): CallToolResult {
  const code = error.code === 'not_found'
    ? MCP_TOOL_ERROR_CODES.NOT_FOUND
    : error.code === 'conflict'
      ? MCP_TOOL_ERROR_CODES.CONFLICT
      : MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED;
  const message = error.code === 'not_found'
    ? 'The requested pSEO blueprint source was not found.'
    : error.code === 'conflict'
      ? 'The linked pSEO matrix source changed. Re-read the blueprint entry and matrix before retrying.'
      : 'The pSEO plan does not satisfy matrix materialization preflight.';
  return mcpJsonV1Error({
    code,
    message,
    retryable: error.code === 'conflict',
    details: { reason: error.reason },
  });
}

function runPseoPostCommitEffect(
  workspaceId: string,
  effect: string,
  callback: () => void,
): void {
  try {
    callback();
  } catch (error) {
    log.warn({ error, workspaceId, effect }, 'pSEO matrix post-commit effect failed');
  }
}

function unknownToolError(): CallToolResult {
  return mcpJsonV1Error({
    code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
    message: 'Unknown content matrix tool: the requested tool does not exist.',
    retryable: false,
  });
}

export function createContentMatrixActionHandler(
  dependencies: ContentMatrixActionDependencies = defaultDependencies,
) {
  return async function handle(
    name: string,
    args: Record<string, unknown>,
    context: McpToolExecutionContext,
  ): Promise<CallToolResult> {
    try {
      if (name === 'list_pseo_blueprint_entries') {
        const parsed = listPseoBlueprintEntriesInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const result = dependencies.listPseoBlueprintEntries({
          workspaceId: parsed.data.workspace_id,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
        });
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'list_content_matrices') {
        const parsed = listContentMatricesInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const result = dependencies.listContentMatrices({
          workspaceId: parsed.data.workspace_id,
          templateId: parsed.data.template_id,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
        });
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'get_content_matrix') {
        const parsed = getContentMatrixInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const result = dependencies.getContentMatrix({
          workspaceId: parsed.data.workspace_id,
          matrixId: parsed.data.matrix_id,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
        });
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'resolve_content_matrix_cells') {
        const parsed = resolveContentMatrixCellsInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const selections = parsed.data.selections.map(selection => ({
          cellId: selection.cell_id,
          expectedSourceRevision: {
            matrixRevision: selection.expected_source_revision.matrix_revision,
            templateRevision: selection.expected_source_revision.template_revision,
            cellRevision: selection.expected_source_revision.cell_revision,
          },
        }));
        const first = selections[0];
        if (!first) return validationError();
        const result = await dependencies.resolveMatrixStructures({
          workspaceId: parsed.data.workspace_id,
          matrixId: parsed.data.matrix_id,
          selections: [first, ...selections.slice(1)],
        });
        return mcpSuccess(toMcpPayload(projectResolveResult(result)));
      }

      if (name === 'accept_content_template_generation_upgrade') {
        const parsed = acceptContentTemplateGenerationUpgradeInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const result = await dependencies.acceptTemplateGenerationUpgrade({
          workspaceId: parsed.data.workspace_id,
          templateId: parsed.data.template_id,
          expectedTemplateRevision: parsed.data.expected_template_revision,
          proposalFingerprint: parsed.data.proposal_fingerprint,
          decision: parsed.data.decision,
          idempotencyKey: parsed.data.idempotency_key,
        });
        if (result.status === 'accepted' && !result.replayed) {
          dependencies.invalidateContentPipelineIntelligence(parsed.data.workspace_id);
          dependencies.broadcastToWorkspace(
            parsed.data.workspace_id,
            WS_EVENTS.CONTENT_UPDATED,
            {
              domain: 'content-plan',
              templateId: result.template.id,
              action: 'template_generation_upgrade_accepted',
            },
          );
          dependencies.addActivity(
            parsed.data.workspace_id,
            'content_updated',
            `Upgraded content template "${result.template.name}" for generation`,
            undefined,
            {
              source: 'mcp-chat',
              templateId: result.template.id,
              action: 'template_generation_upgrade_accepted',
            },
          );
        }
        return mcpSuccess(toMcpPayload(projectTemplateUpgradeResult(result)));
      }

      if (name === 'preview_content_matrix_generation') {
        const parsed = previewContentMatrixGenerationInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const selections = parsed.data.selections.map(selection => ({
          cellId: selection.cell_id,
          expectedSourceRevision: {
            matrixRevision: selection.expected_source_revision.matrix_revision,
            templateRevision: selection.expected_source_revision.template_revision,
            cellRevision: selection.expected_source_revision.cell_revision,
          },
        }));
        const first = selections[0];
        if (!first) return validationError();
        const result = await dependencies.previewMatrixGeneration({
          workspaceId: parsed.data.workspace_id,
          matrixId: parsed.data.matrix_id,
          selections: [first, ...selections.slice(1)],
        });
        return mcpSuccess(toMcpPayload(projectPreviewResult(result)));
      }

      if (name === 'resolve_content_matrix_evidence') {
        const parsed = resolveContentMatrixEvidenceInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const result = await dependencies.resolveContentMatrixEvidence({
          workspaceId: parsed.data.workspace_id,
          matrixId: parsed.data.matrix_id,
          cellId: parsed.data.cell_id,
          requirementId: parsed.data.requirement_id,
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
          resolvedBy: mcpAttribution(context),
          expectedSourceRevision: {
            matrixRevision: parsed.data.expected_source_revision.matrix_revision,
            templateRevision: parsed.data.expected_source_revision.template_revision,
            cellRevision: parsed.data.expected_source_revision.cell_revision,
          },
          expectedArtifactRevisions: {
            brief: {
              artifactType: 'content_brief',
              artifactId: parsed.data.expected_artifact_revisions.brief.artifact_id,
              generationRevision: parsed.data.expected_artifact_revisions.brief.generation_revision,
            },
            post: {
              artifactType: 'generated_post',
              artifactId: parsed.data.expected_artifact_revisions.post.artifact_id,
              generationRevision: parsed.data.expected_artifact_revisions.post.generation_revision,
            },
          },
          idempotencyKey: parsed.data.idempotency_key,
        });
        if (result.created) {
          dependencies.invalidateContentPipelineIntelligence(parsed.data.workspace_id);
          dependencies.broadcastToWorkspace(
            parsed.data.workspace_id,
            WS_EVENTS.CONTENT_UPDATED,
            {
              domain: 'content-plan',
              matrixId: parsed.data.matrix_id,
              cellId: parsed.data.cell_id,
              requirementId: parsed.data.requirement_id,
              action: 'matrix_generation_evidence_resolved',
            },
          );
          dependencies.addActivity(
            parsed.data.workspace_id,
            'content_updated',
            'Resolved content-matrix generation evidence',
            undefined,
            {
              source: 'mcp-chat',
              matrixId: parsed.data.matrix_id,
              cellId: parsed.data.cell_id,
              requirementId: parsed.data.requirement_id,
              action: 'matrix_generation_evidence_resolved',
            },
          );
        }
        return mcpSuccess(toMcpPayload(result));
      }

      if (name === 'start_content_matrix_generation') {
        const parsed = startContentMatrixGenerationInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const selections = parsed.data.selections.map(selection => ({
          cellId: selection.cell_id,
          expectedSourceRevision: {
            matrixRevision: selection.expected_source_revision.matrix_revision,
            templateRevision: selection.expected_source_revision.template_revision,
            cellRevision: selection.expected_source_revision.cell_revision,
          },
          expectedPreviewFingerprint: selection.expected_preview_fingerprint,
        }));
        const first = selections[0];
        if (!first) return validationError();
        const result = await dependencies.startMatrixGeneration({
          workspaceId: parsed.data.workspace_id,
          matrixId: parsed.data.matrix_id,
          selections: [first, ...selections.slice(1)],
          acceptedBudget: {
            maxProviderCalls: parsed.data.accepted_budget.max_provider_calls,
            maxInputTokens: parsed.data.accepted_budget.max_input_tokens,
            maxOutputTokens: parsed.data.accepted_budget.max_output_tokens,
            maxEstimatedUsd: parsed.data.accepted_budget.max_estimated_usd,
            maxConcurrency: parsed.data.accepted_budget.max_concurrency,
          },
          idempotencyKey: parsed.data.idempotency_key,
          createdBy: mcpAttribution(context),
          mcpExecutionContext: context,
        });
        if (!result.existing) {
          dependencies.broadcastToWorkspace(parsed.data.workspace_id, WS_EVENTS.CONTENT_UPDATED, {
            domain: 'content-plan',
            matrixId: parsed.data.matrix_id,
            runId: result.run.id,
            action: 'matrix_generation_started',
          });
          dependencies.addActivity(
            parsed.data.workspace_id,
            'content_updated',
            `Started generation for ${result.run.selections.length} matrix pages`,
            undefined,
            {
              source: 'mcp-chat',
              matrixId: parsed.data.matrix_id,
              runId: result.run.id,
              jobId: result.jobId,
              action: 'matrix_generation_started',
            },
          );
        }
        return paidMatrixCommandSuccess({
          ...result,
          dashboardUrl: `/ws/${encodeURIComponent(parsed.data.workspace_id)}/content-pipeline?tab=planner&matrix=${encodeURIComponent(parsed.data.matrix_id)}&run=${encodeURIComponent(result.run.id)}`,
        }, parsed.data.workspace_id, dependencies);
      }

      if (name === 'get_content_matrix_generation') {
        const parsed = getContentMatrixGenerationInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        return mcpSuccess(toMcpPayload(dependencies.getMatrixGeneration({
          workspaceId: parsed.data.workspace_id,
          runId: parsed.data.run_id,
          cursor: parsed.data.cursor,
          limit: parsed.data.limit,
        })));
      }

      if (name === 'retry_content_matrix_generation') {
        const parsed = retryContentMatrixGenerationInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const items = parsed.data.items.map(item => ({
          itemId: item.item_id,
          expectedItemRevision: item.expected_item_revision,
          sourceRevision: {
            matrixRevision: item.source_revision.matrix_revision,
            templateRevision: item.source_revision.template_revision,
            cellRevision: item.source_revision.cell_revision,
          },
          expectedArtifactRevisions: {
            brief: {
              artifactType: 'content_brief' as const,
              artifactId: item.expected_artifact_revisions.brief.artifact_id,
              generationRevision: item.expected_artifact_revisions.brief.generation_revision,
            },
            post: {
              artifactType: 'generated_post' as const,
              artifactId: item.expected_artifact_revisions.post.artifact_id,
              generationRevision: item.expected_artifact_revisions.post.generation_revision,
            },
          },
          reusableCheckpointFingerprint: item.reusable_checkpoint_fingerprint,
        }));
        const first = items[0];
        if (!first) return validationError();
        const result = dependencies.retryMatrixGeneration({
          workspaceId: parsed.data.workspace_id,
          runId: parsed.data.run_id,
          expectedRunRevision: parsed.data.expected_run_revision,
          items: [first, ...items.slice(1)],
          idempotencyKey: parsed.data.idempotency_key,
          mode: 'resume',
          requestedBy: mcpAttribution(context),
          mcpExecutionContext: context,
        });
        if (!result.existing) {
          dependencies.broadcastToWorkspace(parsed.data.workspace_id, WS_EVENTS.CONTENT_UPDATED, {
            domain: 'content-plan',
            runId: parsed.data.run_id,
            action: 'matrix_generation_retry_started',
          });
          dependencies.addActivity(
            parsed.data.workspace_id,
            'content_updated',
            `Retried ${items.length} matrix generation items`,
            undefined,
            {
              source: 'mcp-chat',
              runId: parsed.data.run_id,
              jobId: result.jobId,
              action: 'matrix_generation_retry_started',
            },
          );
        }
        return paidMatrixCommandSuccess(result, parsed.data.workspace_id, dependencies);
      }

      if (name === 'get_pseo_matrix_plan') {
        const parsed = getPseoMatrixPlanInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        return mcpSuccess(toMcpPayload(await dependencies.getPseoMatrixPlan({
          workspaceId: parsed.data.workspace_id,
          blueprintId: parsed.data.blueprint_id,
          entryId: parsed.data.entry_id,
        })));
      }

      if (name === 'create_content_matrix_from_pseo_plan') {
        const parsed = createContentMatrixFromPseoPlanInputSchema.safeParse(args);
        if (!parsed.success) return validationError();
        const result = await dependencies.createMatrixFromPseoPlan({
          workspaceId: parsed.data.workspace_id,
          blueprintId: parsed.data.blueprint_id,
          entryId: parsed.data.entry_id,
          expectedSourceRevision: {
            entryUpdatedAt: parsed.data.expected_source_revision.entry_updated_at,
            templateId: parsed.data.expected_source_revision.template_id,
            templateRevision: parsed.data.expected_source_revision.template_revision,
          },
          dimensions: parsed.data.dimensions.map(dimension => ({
            variableName: dimension.variable_name,
            values: dimension.values,
          })),
        });
        if (!result.replayed) {
          runPseoPostCommitEffect(
            parsed.data.workspace_id,
            'invalidate-content-pipeline-intelligence',
            () => dependencies.invalidateContentPipelineIntelligence(parsed.data.workspace_id),
          );
          runPseoPostCommitEffect(
            parsed.data.workspace_id,
            'broadcast-content-updated',
            () => dependencies.broadcastToWorkspace(
              parsed.data.workspace_id,
              WS_EVENTS.CONTENT_UPDATED,
              {
                domain: 'content-plan',
                matrixId: result.matrix.id,
                blueprintId: result.source.blueprintId,
                entryId: result.source.entryId,
                action: 'pseo_matrix_created',
              },
            ),
          );
          runPseoPostCommitEffect(
            parsed.data.workspace_id,
            'broadcast-blueprint-updated',
            () => dependencies.broadcastToWorkspace(
              parsed.data.workspace_id,
              WS_EVENTS.BLUEPRINT_UPDATED,
              {
                blueprintId: result.source.blueprintId,
                entryId: result.source.entryId,
                matrixId: result.matrix.id,
                action: 'entries_updated',
              },
            ),
          );
          runPseoPostCommitEffect(
            parsed.data.workspace_id,
            'record-activity',
            () => {
              dependencies.addActivity(
                parsed.data.workspace_id,
                'content_updated',
                `Created content matrix "${result.matrix.name}" from the page blueprint`,
                `${result.matrix.cellCount} planned page${result.matrix.cellCount === 1 ? '' : 's'}`,
                {
                  source: 'mcp-chat',
                  blueprintId: result.source.blueprintId,
                  entryId: result.source.entryId,
                  matrixId: result.matrix.id,
                  action: 'pseo_matrix_created',
                },
              );
            },
          );
        }
        return mcpSuccess(toMcpPayload(result));
      }

      return unknownToolError();
    } catch (error) {
      if (error instanceof MatrixReadServiceError) return readServiceError(error);
      if (error instanceof PseoMatrixBridgeError) return pseoBridgeError(error);
      if (error instanceof TemplateGenerationUpgradeError) return upgradeServiceError(error);
      if (error instanceof MatrixGenerationEvidenceError) {
        return mcpJsonV1Error({
          code: error.code === 'not_found'
            ? MCP_TOOL_ERROR_CODES.NOT_FOUND
            : error.code === 'conflict' || error.code === 'idempotency_conflict'
              ? MCP_TOOL_ERROR_CODES.CONFLICT
              : MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
          message: error.message,
          retryable: error.code === 'conflict',
        });
      }
      if (error instanceof MatrixGenerationSourceLimitError) return generationSourceLimitError();
      if (error instanceof MatrixGenerationBatchNotFoundError) {
        return mcpJsonV1Error({
          code: MCP_TOOL_ERROR_CODES.NOT_FOUND,
          message: error.message,
          retryable: false,
        });
      }
      if (error instanceof MatrixGenerationBatchPreconditionError) {
        return mcpJsonV1Error({
          code: MCP_TOOL_ERROR_CODES.PRECONDITION_FAILED,
          message: error.message,
          retryable: true,
        });
      }
      if (error instanceof ActiveJobResourceConflict) {
        return mcpJsonV1Error({
          code: MCP_TOOL_ERROR_CODES.CONFLICT,
          message: error.message,
          retryable: true,
          details: { active_job_id: error.jobId },
        });
      }
      throw error;
    }
  };
}

export const handleContentMatrixActionTool = createContentMatrixActionHandler();
