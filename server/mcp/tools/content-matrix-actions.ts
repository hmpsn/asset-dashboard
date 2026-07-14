import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types';
import {
  acceptContentTemplateGenerationUpgradeInputSchema,
  getContentMatrixInputSchema,
  listContentMatricesInputSchema,
  resolveContentMatrixCellsInputSchema,
} from '../../../shared/types/mcp-matrix-schemas.js';
import {
  MCP_TOOL_ERROR_CODES,
  type McpToolExecutionContext,
} from '../../../shared/types/mcp-runtime.js';
import {
  MatrixGenerationSourceLimitError,
  type ContentTemplateGenerationUpgradeProposal,
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
  acceptTemplateGenerationUpgrade,
  type AcceptTemplateGenerationUpgradeActionResult,
  TemplateGenerationUpgradeError,
} from '../../domains/content/matrix-generation/upgrade-action.js';
import { invalidateContentPipelineIntelligence } from '../../intelligence-freshness.js';
import { toMcpJsonSchema } from '../json-schema.js';
import { mcpJsonV1Error } from '../tool-errors.js';
import { mcpSuccess } from '../tool-helpers.js';
import { WS_EVENTS } from '../../ws-events.js';

export const contentMatrixActionTools: Tool[] = [
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
];

type MaybePromise<T> = T | Promise<T>;

export interface ContentMatrixActionDependencies {
  listContentMatrices: typeof listContentMatrices;
  getContentMatrix: typeof getContentMatrix;
  resolveMatrixStructures: typeof resolveMatrixStructures;
  acceptTemplateGenerationUpgrade: (
    request: Parameters<typeof acceptTemplateGenerationUpgrade>[0],
  ) => MaybePromise<ReturnType<typeof acceptTemplateGenerationUpgrade>>;
  addActivity: typeof addActivity;
  broadcastToWorkspace: typeof broadcastToWorkspace;
  invalidateContentPipelineIntelligence: typeof invalidateContentPipelineIntelligence;
}

const defaultDependencies: ContentMatrixActionDependencies = {
  listContentMatrices,
  getContentMatrix,
  resolveMatrixStructures,
  acceptTemplateGenerationUpgrade,
  addActivity,
  broadcastToWorkspace,
  invalidateContentPipelineIntelligence,
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
    void context;
    try {
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

      return unknownToolError();
    } catch (error) {
      if (error instanceof MatrixReadServiceError) return readServiceError(error);
      if (error instanceof TemplateGenerationUpgradeError) return upgradeServiceError(error);
      if (error instanceof MatrixGenerationSourceLimitError) return generationSourceLimitError();
      throw error;
    }
  };
}

export const handleContentMatrixActionTool = createContentMatrixActionHandler();
